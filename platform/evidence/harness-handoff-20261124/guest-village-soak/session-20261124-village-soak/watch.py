"""Thirty minutes of active local-village simulation viewed from an R117 guest."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parent
GUEST = ROOT / "guest"
SAVE = ROOT / "village.json"
TOOLS = ROOT.parent / "guest_ui.py"
ZONE = timezone(timedelta(hours=8))
END_START = datetime(2026, 11, 24, 11, 18, 0, tzinfo=ZONE)

def put(name, obj):
    with (ROOT / name).open("x", encoding="utf8") as handle:
        json.dump(obj, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

def apply_invariants(s):
    assert s["ledger"] == [] and not s["autonomy"] and s["harness"]["tasks"] == []
    assert len(s["residents"]) == 3 and all(r["used"] == r["reserved"] == 0 for r in s["residents"])
    assert all(any(b["id"] == name and b["built"] for b in s["buildings"]) for name in ["farm","workshop"])
    assert len(s["harness"]["skills"]) == 2

def seed():
    from village import Provider, Village
    now = datetime.now(ZONE)
    assert now <= END_START and now.date() == END_START.date(), "launch after slot cut-off"
    assert not SAVE.exists()
    world = Village(SAVE, Provider([]))
    for b in world.s["buildings"]:
        if b["id"] in ("farm", "workshop"): b["built"] = True
    world.s["paused"] = True
    apply_invariants(world.s)
    assert world.s["clock"] == 480
    world.save()
    world.close()
    (ROOT / "providers.json").write_text("[]", encoding="utf8")
    put("start.json", {"beijing":now.isoformat(),"monotonic_ns":time.monotonic_ns()})

def control(verb, label, *args):
    subprocess.run([sys.executable, "-B", str(TOOLS), "--run", str(GUEST), verb, label, *map(str,args)], check=True, timeout=70)
    row = json.loads((GUEST/label/"step.json").read_bytes())
    assert row["session"] == META["session"] and row["transport"] == "ok"
    if verb == "click": assert row["guest_received_left_click"]
    return row

def api(endpoint):
    with CLIENT.open(f"http://127.0.0.1:{META['port']}/api/"+endpoint, timeout=5) as r:
        return json.load(r)

def sample(label, paused):
    begin = time.monotonic_ns()
    disk_raw = SAVE.read_bytes()  # atomically replaced by the game
    disk = json.loads(disk_raw)
    assert api("health") == META["server"]
    state = api("state")
    end = time.monotonic_ns()
    stamp = datetime.now(ZONE).isoformat()
    (ROOT/("disk-"+label+".json")).write_bytes(disk_raw)
    put("api-"+label+".json", state)
    for side in (disk,state):
        apply_invariants(side)
        assert side["paused"] is paused
    assert state["providers"] == [] and disk["clock"] <= state["clock"]
    if paused:
        assert state["clock"] == disk["clock"] and state["resources"] == disk["resources"]
    pair = {"label":label,"monotonic_start_ns":begin,"monotonic_end_ns":end,"beijing":stamp,
            "paused":paused,"api_clock":state["clock"],"disk_clock":disk["clock"],"api_resources":state["resources"],
            "disk_resources":disk["resources"],"saved_sha256":hashlib.sha256(disk_raw).hexdigest()}
    put("sample-"+label+".json",pair)
    return pair

def board(label):
    control("click",label+"-board","--x",56,"--y",736,"--settle",1.5)
    control("key",label+"-map","--keys","esc","--settle",1.5)

def wait_until(origin, delay):
    target = origin + delay * 1_000_000_000
    while True:
        remaining = target - time.monotonic_ns()
        if remaining <= 0:
            return
        time.sleep(min(60, remaining/1e9))
        if api("health") != META["server"]: raise RuntimeError("fixture identity changed")
        state = api("state")
        apply_invariants(state)
        if state["paused"] or state["providers"]: raise RuntimeError("active local simulation stopped")
        with (ROOT/"heartbeat.jsonl").open("a", encoding="utf8") as h:
            h.write(json.dumps({"mono_ns":time.monotonic_ns(),"clock":state["clock"],"resources":state["resources"]})+"\n")

def observe():
    initial = sample("initial-paused", True)
    assert initial["api_clock"] == 480
    control("click","01-resume","--x",156,"--y",110,"--settle",1.0)
    start = sample("start-running",False)
    origin = start["monotonic_end_ns"]
    board("02-start")
    wait_until(origin, 900)
    mid = sample("middle-running",False)
    board("03-middle")
    wait_until(origin, 1800)
    end = sample("end-running",False)
    board("04-end")
    control("click","05-pause","--x",156,"--y",110,"--settle",1.0)
    paused = sample("end-paused",True)
    time.sleep(1.6)
    still = sample("end-paused-again",True)
    assert paused["api_clock"] == still["api_clock"]
    assert start["api_clock"] < mid["api_clock"] < end["api_clock"] <= paused["api_clock"]
    assert start["disk_clock"] < mid["disk_clock"] < end["disk_clock"]
    assert start["api_resources"] != end["api_resources"], "no observed work deliveries"
    span = end["monotonic_start_ns"] - origin
    assert span >= 1_800_000_000_000
    put("interactive-observations.json",{"elapsed_active_monotonic_ns":span,
        "session":META["session"],"clock_at_start_middle_end":[v["api_clock"] for v in [start,mid,end]],
        "scope":"Local hosted village simulation displayed in a single R117 TCG guest; three framebuffer interactions require visual review."})

if __name__ == "__main__":
    if sys.argv[1:] == ["seed"]: seed()
    elif sys.argv[1:] == ["observe"]:
        CLIENT = build_opener(ProxyHandler({}))
        META = json.loads((GUEST/"launch.json").read_bytes())
        try: observe()
        finally: control("quit","99-quit")
    else: raise SystemExit("use seed or observe")
