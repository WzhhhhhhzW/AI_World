"""Prepare or check the dedicated forge preview fixture."""
from hashlib import sha256
import json
from pathlib import Path
import sys
from urllib.request import ProxyHandler, build_opener

root = Path(__file__).resolve().parent
source = root / "previous-forge-receipt.json"
assert sha256(source.read_bytes()).hexdigest() == "dcffb57f790e6fd162814c285de976877299e60ea32ebe8ee79593c67ba51a62"
skill = json.loads(source.read_bytes())["new_skill"]
assert skill["id"] == "1451e6fe5d95"
save = root / "village.json"

def check(world):
    assert world["harness"]["tasks"] == [] and world["ledger"] == []
    assert world["paused"] and world["clock"] == 480 and not world["autonomy"]
    skills = world["harness"]["skills"]
    assert len(skills) == 3 and [s for s in skills if s["id"] == skill["id"]] == [skill]
    assert all(any(b["id"] == n and b["built"] for b in world["buildings"]) for n in ("farm","workshop"))

if sys.argv[1] == "seed":
    from village import Village, Provider
    assert not save.exists()
    village = Village(save, Provider([]))
    h = village.s["harness"]
    assert len(h["skills"]) == 2 and not h["tasks"]
    h["skills"].insert(0, skill)
    h["revision"] += 1
    for b in village.s["buildings"]:
        if b["id"] in ("farm", "workshop"):
            b["built"] = True
    village.s["paused"] = True
    check(village.s)
    village.save()
    village.close()
    (root / "providers.json").write_text("[]", encoding="utf-8")
elif sys.argv[1] == "verify":
    meta = json.loads((root / "guest/launch.json").read_bytes())
    client = build_opener(ProxyHandler({}))
    def get(endpoint):
        with client.open(f"http://127.0.0.1:{meta['port']}/api/" + endpoint, timeout=4) as response:
            return json.load(response)
    assert get("health") == meta["server"]
    before = json.loads((root / "guest/before.json").read_bytes())
    state = get("state")
    saved = json.loads(save.read_bytes())
    for world in (before, saved, state):
        check(world)
    assert state["providers"] == before["providers"] == []
    assert state["harness"]["skills"] == saved["harness"]["skills"] == before["harness"]["skills"]
    report = {"skill":skill,"source_saved_live_match":True,"provider_count":0,"tasks":0,"ledger_entries":0,"game_clock":480,
              "expected_markdown_sha256":sha256((root/"expected-SKILL.md").read_bytes()).hexdigest(),
              "comparison":"Expected source bytes. Guest UI observations are recorded separately."}
    with (root/"state-receipt.json").open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2, ensure_ascii=False)
else:
    raise ValueError("choose seed or verify")
