"""Run a local x-kernel comparison on the team's unmodified competition pages."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import time

from qemu_demo import cached_boot_disk, emulator_command


PROJECT = Path(__file__).resolve().parents[1]
COMMIT = "0b6c59600a8782762a6112eb02cfd96347e496e6"
SCRIPT = "outputs/ict-chromium/scripts/guest-browser.sh"
SCRIPT_SHA256 = "c68ea39d6977316ba9e63af487984d446a9216548ad3c33767642d3fbda93541"
STARTUP_OBSERVATION_SECONDS = 10
GUEST_MEMORY_PROBE_DELAY_SECONDS = 105
PAGE_URL = "file:///opt/ict/testpages/"
PAGE_HASHES = {
    "index.html": "831cf28f3748940b450d1da325aa39a2dcaea2fee15b0532bf4111144d176b38",
    "interaction.html": "58130daa4a2f426fd16b8bde93d964713f20e147da8af1537ab2d8b506d2fd58",
    "layout.html": "a1b04f9aba81b4b7818be2e7a858d482d471bd0d625dee257f605b2129b8fc4c",
}
HOME_COLORS = ("e5534b", "2da44e", "bf8700", "8250df")
BROWSER_START_MARKER = b"ICT_BROWSER_START"
STAGES = {b"VILLAGE_WESTON_READY": "weston_ready", BROWSER_START_MARKER: "browser_start",
          b"FINALS_RENDERER_SEEN_FIRST pid=": "renderer_inventory_seen"}


class IncompleteObservation(RuntimeError):
    """The guest did not reach the browser observation criteria in time."""


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def kvm_preflight():
    if sys.platform != "linux" or os.uname().machine.lower() not in ("aarch64", "arm64"):
        raise ValueError("--accel kvm 需要原生 AArch64 Linux 宿主")
    import fcntl
    import stat

    try:
        with open("/dev/kvm", "r+b", buffering=0) as device:
            if not stat.S_ISCHR(os.fstat(device.fileno()).st_mode):
                raise ValueError("/dev/kvm 不是字符设备")
            # Linux KVM UAPI: KVM_GET_API_VERSION = _IO(0xAE, 0x00).
            version = fcntl.ioctl(device.fileno(), 0xAE00)
    except OSError as exc:
        raise ValueError(f"无法以读写方式使用 /dev/kvm：{exc}") from exc
    if version != 12:
        raise ValueError(f"/dev/kvm 返回不支持的 KVM API 版本 {version}")
    return {"device": "/dev/kvm", "api_version": version, "host_machine": os.uname().machine}


def verify_kvm(monitor, evidence):
    state = monitor.call("query-kvm")
    evidence["query_kvm"] = state
    if (not isinstance(state, dict) or state.get("enabled") is not True
            or state.get("present") is not True):
        raise RuntimeError(f"QMP 未确认 KVM 已启用：{state!r}")
    evidence["verified"] = True


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(args, work, browser_modes):
    if args.prepared_assets:
        script = (args.prepared_assets / "guest-browser.sh").read_bytes()
        if hashlib.sha256(script).hexdigest() != SCRIPT_SHA256:
            raise ValueError("离线浏览器启动脚本与固定提交不同")
        watcher = args.prepared_assets / "renderer-watch"
    else:
        script = subprocess.check_output(["git", "-C", args.upstream, "show", f"{COMMIT}:{SCRIPT}"])
        watcher = work / "renderer-watch"
        subprocess.run(["aarch64-linux-gnu-gcc", "-O2", "-static", "-s", "-Wall", "-Wextra",
                        Path(__file__).with_name("renderer_watch.c"), "-o", watcher], check=True)
    watcher_data = watcher.read_bytes()
    for filename, expected in PAGE_HASHES.items():
        contents = subprocess.check_output(["debugfs", "-R", f"cat /opt/ict/testpages/{filename}",
                                           args.rootfs], stderr=subprocess.DEVNULL)
        if hashlib.sha256(contents).hexdigest() != expected:
            raise ValueError(f"原盘内页面校验失败：{filename}")
    start = b"/opt/finals-watch &\nexec sh /opt/finals-browser.sh\n"
    if args.soak:
        start = b"sh /opt/finals-heartbeat.sh &\n" + start
    if args.memory_probe:
        start = (
            "sh /opt/finals-memory-probe.sh before\n"
            f"(sleep {GUEST_MEMORY_PROBE_DELAY_SECONDS}; "
            "sh /opt/finals-memory-probe.sh after) </dev/null &\n"
        ).encode("ascii") + start
    if args.controls:
        start = b"export WAYLAND_DEBUG=client\n" + start
    scripts = {"baseline": script, "lowend": script.replace(
        b"--no-zygote ", b"--no-zygote --enable-low-end-device-mode ", 1)}
    if scripts["baseline"] == scripts["lowend"]:
        raise ValueError("队友启动脚本中缺少预期的启动参数")
    disks = {}
    for mode in browser_modes:
        browser = scripts[mode]
        files = [("/opt/finals-watch", watcher_data, True),
                 ("/opt/finals-browser.sh", browser, False), ("/opt/finals-start.sh", start, False)]
        if args.soak:
            files.append(("/opt/finals-heartbeat.sh", Path(__file__).with_name(
                "guest-heartbeat.sh").read_bytes(), False))
        if args.memory_probe:
            files.append(("/opt/finals-memory-probe.sh", Path(__file__).with_name(
                "guest-memory-probe.sh").read_bytes(), False))
        disks[mode], _ = cached_boot_disk(args.rootfs, session_args=[
            PAGE_URL + "index.html", "sh", "/opt/finals-start.sh"], guest_files=files)
    return disks, {"browser_script_sha256": hashlib.sha256(script).hexdigest(),
                   "renderer_watch_sha256": hashlib.sha256(watcher_data).hexdigest()}


class Monitor:
    def __init__(self, stream):
        self.stream = stream
        if "QMP" not in self.read():
            raise RuntimeError("QMP 握手失败")
        self.call("qmp_capabilities")
        if self.call("query-target")["arch"] != "aarch64":
            raise RuntimeError("需要 AArch64 客体")

    def read(self):
        line = self.stream.readline()
        if not line:
            raise ConnectionError("QMP 已关闭")
        return json.loads(line)

    def call(self, name, **arguments):
        request = {"execute": name, "id": name}
        if arguments:
            request["arguments"] = arguments
        self.stream.write(json.dumps(request).encode() + b"\n")
        self.stream.flush()
        while True:
            message = self.read()
            if message.get("id") == name:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message["return"]

    def key(self, *keys):
        self.call("send-key", keys=[{"type": "qcode", "data": key} for key in keys], **{"hold-time": 15})
        time.sleep(.044)

    def type_text(self, text):
        for char in text:
            if char == ":":
                self.key("shift", "semicolon")
            else:
                self.key({"/": "slash", ".": "dot", " ": "spc", "-": "minus"}.get(char, char))

    def address(self, name):
        self.key("ctrl", "l")
        time.sleep(.3)
        self.type_text(PAGE_URL + name)
        time.sleep(.25)

    def screenshot(self, path):
        self.call("screendump", filename=str(path), format="png")

    def colors(self, path, capture_times=None):
        from PIL import Image
        width, height, rgb = self.display_pixels(path, capture_times)
        histogram = {color: count for count, color in
                     Image.frombytes("RGB", (width, height), rgb).getcolors(width * height)}
        return {color: histogram.get(tuple(bytes.fromhex(color)), 0)
                for color in (*HOME_COLORS, "ffffff", "dbeafe", "dafbe1")}

    def display_pixels(self, path, capture_times=None):
        if capture_times is not None:
            capture_times.append(time.monotonic())
        self.call("screendump", filename=str(path))
        if capture_times is not None:
            capture_times.append(time.monotonic())
        magic, dimensions, scale, rgb = path.read_bytes().split(b"\n", 3)
        width, height = map(int, dimensions.split())
        if magic != b"P6" or scale != b"255" or len(rgb) != width * height * 3:
            raise ValueError("QMP 截图格式异常")
        return width, height, rgb

    def move(self, dx, dy):
        events = [{"type": "rel", "data": {"axis": axis, "value": value}}
                  for axis, value in [("x", dx), ("y", dy)] if value]
        if events:
            self.call("input-send-event", events=events)

    def move_steps(self, dx, dy):
        count = max(abs(dx), abs(dy))
        old_x = old_y = 0
        for step in range(1, count + 1):
            x, y = round(step * dx / count), round(step * dy / count)
            self.move(x - old_x, y - old_y)
            old_x, old_y = x, y
            time.sleep(.012)

    def left_click(self):
        for down in (True, False):
            self.call("input-send-event", events=[{"type": "btn", "data": {"button": "left", "down": down}}])
            time.sleep(.12)


def pointer_position(serial, log):
    command = r"grep -E 'wl_pointer.*(motion|enter)\(' /tmp/ict-browser.log | tail -1"
    with socket.socket(socket.AF_UNIX) as sock:
        sock.connect(str(serial))
        sock.settimeout(.35)
        for char in (command + "\r").encode():
            sock.sendall(bytes([char]))
            time.sleep(.004)
        response = bytearray()
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline and b"kylin-x:~#" not in response:
            try:
                block = sock.recv(4096)
            except TimeoutError:
                continue
            if not block:
                break
            response.extend(block)
    matches = re.findall(rb"wl_pointer[#@]\d+\.(?:motion|enter)\([^\r\n]*?,\s*(-?[\d.]+),\s*(-?[\d.]+)\)",
                         response)
    if not matches:
        raise RuntimeError("未读到 Chromium 接收的 Wayland 指针坐标")
    point = tuple(map(float, matches[-1]))
    print(point, file=log, flush=True)
    return point


def click_link(monitor, work, output, x, y, rgb, width, height):
    # The page background and Chromium tab strip identify the visible window
    # origin. Wayland reports pointer positions relative to the client surface.
    row = rgb[width * (height // 2) * 3:width * (height // 2 + 1) * 3]
    page = row.find(bytes.fromhex("f4f6f8") * 3)
    top = rgb.find(bytes.fromhex("d3e3fd") * 20)
    if page < 0 or top < 0:
        raise RuntimeError("未能定位客体 Chromium 窗口")
    target_x, target_y = x - page // 3, y - top // (3 * width)
    for _ in range(9):
        monitor.move(-400, 400)
        time.sleep(.04)
    monitor.move_steps(400, -220)
    time.sleep(.3)
    with (output / "pointer-motion.log").open("w", encoding="utf-8") as log:
        serial = work / "serial.sock"
        px, py = pointer_position(serial, log)
        # Chromium draws a shadow around its window; allow small differences
        # between the visible border and the Wayland surface.
        for offset in (8, 0, -8, 16, -16):
            for _ in range(10):
                dx, dy = target_x - px, target_y + offset - py
                if abs(dx) < 12 and abs(dy) < 2:
                    break
                factor = max(1, abs(dx) / 60, abs(dy) / 60)
                monitor.move_steps(round(dx / factor), round(dy / factor))
                time.sleep(.15)
                px, py = pointer_position(serial, log)
            monitor.left_click()
            time.sleep(1)
            if monitor.colors(work / "probe.ppm")["dbeafe"] > 4000:
                return
    raise RuntimeError("已发出原生鼠标点击，未观测到布局页")


def wait_frame(monitor, work, test, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        colors = monitor.colors(work / "probe.ppm")
        if test(colors):
            return
        time.sleep(.5)
    raise TimeoutError("客体画面未出现预期特征")


def controls(monitor, work, output):
    is_home = lambda c: all(c[x] > 3000 for x in HOME_COLORS) and c["dbeafe"] < 500
    is_css = lambda c: c["dbeafe"] > 4000
    monitor.key("ctrl", "t")
    time.sleep(1)
    monitor.address("index.html")
    monitor.key("ret")
    wait_frame(monitor, work, is_home, 60)
    for key, match, name in [("1", is_css, "tab-1-css"), ("2", is_home, "tab-2-index")]:
        monitor.key("ctrl", key)
        wait_frame(monitor, work, match)
        monitor.screenshot(output / f"{name}.png")

    monitor.address("interaction.html")
    monitor.key("ret")
    wait_frame(monitor, work, lambda c: c["ffffff"] > 250000 and c["e5534b"] < 100)
    time.sleep(2)
    monitor.key("tab")
    monitor.key("ret")
    time.sleep(2)
    monitor.key("ctrl", "end")
    wait_frame(monitor, work, lambda c: c["dafbe1"] > 15000)
    monitor.screenshot(output / "javascript.png")
    monitor.key("tab")
    monitor.key("tab")
    time.sleep(.4)
    monitor.screenshot(output / "keyboard-before.png")
    monitor.type_text("hello x-kernel")
    time.sleep(1)
    monitor.screenshot(output / "keyboard-echo.png")

    # Locate the underlined native link in the QMP frame. Its visited color may
    # differ because tab one has already opened the layout page.
    width, height, rgb = monitor.display_pixels(work / "probe.ppm")
    matches = []
    for color in ("0000ee", "551a8b"):
        pixel = bytes.fromhex(color)
        offset = width * (height // 2) * 3
        while (offset := rgb.find(pixel, offset)) >= 0:
            if offset % 3 == 0:
                matches.append((offset // 3 % width, offset // 3 // width))
            offset += 3
    if len(matches) < 15:
        raise RuntimeError("键盘截图已保存，未定位到跳转链接")
    bottom = max(y for _, y in matches)
    x = int(statistics.median(x for x, y in matches if bottom - 12 <= y <= bottom))
    click_link(monitor, work, output, x, bottom - 3, rgb, width, height)
    wait_frame(monitor, work, is_css)
    monitor.screenshot(output / "mouse-css.png")
    monitor.key("ctrl", "end")
    wait_frame(monitor, work, lambda c: c["dafbe1"] > 15000)
    monitor.screenshot(output / "css-checks.png")


def soak(monitor, work, output, pid):
    started = time.monotonic()
    reloads = 0
    identity = None
    last_beat = started
    last_count = 0
    with (output / "soak.jsonl").open("w", encoding="utf-8", buffering=1) as log:
        while time.monotonic() - started < 1800 or reloads < 10:
            elapsed = time.monotonic() - started
            status = Path(f"/proc/{pid}/status").read_text()
            rss = int(re.search(r"^VmRSS:\s+(\d+)", status, re.M)[1]) * 1024
            entry = {"elapsed_s": round(elapsed, 2), "qemu_rss_bytes": rss}
            serial = (work / "serial.log").read_bytes()
            beats = re.findall(rb"FINALS_LIVE browser=(\d+) weston=(\d+)", serial)
            if re.search(rb"FINALS_PROCESS_LOST|out of memory|oom.kill|kernel panic", serial, re.I):
                raise RuntimeError("客体出现 OOM、内核错误或图形进程退出")
            if beats:
                identity = identity or beats[0]
                if beats[-1] != identity:
                    raise RuntimeError("浏览器或 Weston 进程已更换")
                if len(beats) != last_count:
                    last_count, last_beat = len(beats), time.monotonic()
                entry["guest_pids"] = [int(p) for p in identity]
            if time.monotonic() - last_beat > 16:
                raise TimeoutError("未收到客体图形进程心跳")
            if reloads < 10 and elapsed >= (reloads + 1) * 120:
                layout = reloads % 2 == 1
                monitor.address("layout.html" if layout else "index.html")
                monitor.key("ret")
                wait_frame(monitor, work, (lambda c: c["dbeafe"] > 4000) if layout else
                           (lambda c: c["dbeafe"] < 500 and all(c[x] > 3000 for x in HOME_COLORS)))
                reloads += 1
                monitor.screenshot(output / f"load-{reloads:02}.png")
                entry["load"] = reloads
                print(f"soak load {reloads}/10 at {elapsed:.1f}s", flush=True)
            log.write(json.dumps(entry) + "\n")
            time.sleep(1)
    # The final input and frame check test responsiveness past the 30-minute mark.
    monitor.address("index.html")
    monitor.key("ret")
    wait_frame(monitor, work, lambda c: c["dbeafe"] < 500 and all(c[x] > 3000 for x in HOME_COLORS))
    monitor.screenshot(output / "soak-finished.png")
    return {"elapsed_s": round(time.monotonic() - started, 3), "successful_loads": reloads,
            "browser_pid": int(identity[0]), "weston_pid": int(identity[1])}


def save_sample_image(monitor, probe, destination, is_kvm):
    if is_kvm:
        from PIL import Image
        with Image.open(probe) as screenshot:
            screenshot.save(destination)
    else:
        monitor.screenshot(destination)


def measure(monitor, work, output, start, result, *, startup_only=False, accel="tcg"):
    stages = result["stages_s"]
    is_kvm = accel == "kvm"
    first_frame = "window_visible" if is_kvm else "window_white"
    def mark(label, observed_at=None):
        if label not in stages:
            stages[label] = round((time.monotonic() if observed_at is None else observed_at) - start, 3)
            print(f"{output.name} {label} {stages[label]:.3f}s", flush=True)

    next_frame = 0
    probe = work / "probe.ppm"
    previous_no_launch = None
    previous_no_window = None
    raw = b""
    while time.monotonic() - start < 160:
        serial_read_started = time.monotonic() if is_kvm else None
        raw = (work / "serial.log").read_bytes()
        if is_kvm and "browser_start" not in stages:
            if BROWSER_START_MARKER in raw:
                result["launch_marker_host_observation_s"] = [previous_no_launch, round(time.monotonic() - start, 6)]
            else:
                previous_no_launch = round(serial_read_started - start, 6)
        for token, label in STAGES.items():
            if token in raw:
                mark(label)
        if "browser_start" in stages and time.monotonic() >= next_frame:
            next_frame = time.monotonic() + .7
            capture = [] if is_kvm else None
            counts = monitor.colors(probe, capture) if is_kvm else monitor.colors(probe)
            observed_at = capture[-1] if is_kvm else None
            sample_time = observed_at if is_kvm else time.monotonic()
            result["frames"].append([round(sample_time - start, 3), counts])
            white_visible = counts["ffffff"] > 250000
            home_visible = all(counts[c] > 3000 for c in HOME_COLORS)
            if first_frame not in stages:
                window_visible = white_visible or (is_kvm and home_visible)
                if window_visible:
                    mark(first_frame, observed_at)
                    if is_kvm:
                        native_frame = output / "first-visible.ppm"
                        shutil.copyfile(probe, native_frame)
                        result["first_visible_capture"] = {
                            "previous_negative_request_s": previous_no_window,
                            "positive_request_s": [round(point - start, 6) for point in capture],
                            "used_home_colors": home_visible and not white_visible,
                            "screendump_sha256": file_hash(native_frame),
                        }
                    save_sample_image(monitor, probe, output / "browser-window.png", is_kvm)
                elif is_kvm:
                    previous_no_window = round(capture[0] - start, 6)
            if home_visible and "home_colors" not in stages:
                mark("home_colors", observed_at)
                save_sample_image(monitor, probe, output / "home.png", is_kvm)
            if startup_only:
                if home_visible and time.monotonic() - start >= stages["home_colors"] + STARTUP_OBSERVATION_SECONDS:
                    mark("startup_observation_complete")
                    break
            elif ("home_colors" in stages and "return_css" not in stages
                    and time.monotonic() - start > stages["home_colors"] + 3):
                monitor.address("layout.html")
                mark("return_css")
                monitor.key("ret")
            elif "return_css" in stages and counts["dbeafe"] > 4000:
                mark("css_visible", observed_at)
                save_sample_image(monitor, probe, output / "css.png", is_kvm)
                break
        time.sleep(.1)
    final_stage = "startup_observation_complete" if startup_only else "css_visible"
    result["valid_visual"] = "home_colors" in stages and final_stage in stages
    result["renderer_pid"] = None
    matched = re.search(rb"FINALS_RENDERER_SEEN_FIRST pid=(\d+)", raw)
    if matched:
        result["renderer_pid"] = int(matched[1])
    if not result["valid_visual"] or not result["renderer_pid"] or first_frame not in stages:
        with contextlib.suppress(OSError, RuntimeError, ValueError):
            monitor.screenshot(output / "observation-timeout.png")
        raise IncompleteObservation(f"客体观测不完整，已保留运行记录：{output}")


def capture_guest_memory(work, output, pid):
    """Read guest accounting around browser launch, separate from timing runs."""
    boundary = re.compile(
        rb"^FINALS_MEMORY_BEGIN (before|after) (meminfo|memscope)\n(.*?)"
        rb"^FINALS_MEMORY_END \1 \2$", re.M | re.S,
    )
    serial = work / "serial.log"
    if b"FINALS_MEMORY_BEGIN after" in serial.read_bytes():
        raise RuntimeError("客体内存终点快照早于布局页观测，串口记录已保留")
    deadline = time.monotonic() + GUEST_MEMORY_PROBE_DELAY_SECONDS
    while time.monotonic() < deadline:
        raw = serial.read_bytes().replace(b"\r\n", b"\n")
        samples = {
            f"{phase.decode()}_{source.decode()}": content.decode("ascii").strip()
            for phase, source, content in boundary.findall(raw)
        }
        if len(samples) == 4:
            if any("Cached:" not in samples[f"{phase}_meminfo"] for phase in ("before", "after")):
                raise RuntimeError("客体内存快照缺少缓存计数")
            status = Path(f"/proc/{pid}/status").read_text()
            qemu_kib = {key: int(value) for key, value in re.findall(
                r"^(VmRSS|RssAnon|RssFile|RssShmem):\s+(\d+) kB$", status, re.M)}
            if "VmRSS" not in qemu_kib:
                raise RuntimeError("宿主 QEMU 内存快照缺少 RSS")
            write_json(output / "guest-memory.json", {
                "guest_snapshots": samples, "host_qemu_after_layout_kib": qemu_kib,
            })
            return
        time.sleep(.2)
    raise RuntimeError("客体内存快照缺失，串口记录已保留")


def run_once(kernel, disk, output, mode, *, check_controls=False, long_run=False,
             startup_only=False, memory_probe=False, accel="tcg"):
    output.mkdir()
    result = {"mode": mode, "stages_s": {}, "frames": []}
    if accel == "kvm":
        result["acceleration"] = {"requested": "kvm", "verified": False}
    with tempfile.TemporaryDirectory(prefix="finals-qemu-") as directory:
        work = Path(directory)
        command = emulator_command(kernel, disk, work, accel=accel)
        write_json(output / "command.json", command)
        with (output / "qemu.log").open("wb") as log:
            start = time.monotonic()
            emulator = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        try:
            path = work / "monitor.sock"
            while not path.exists() and time.monotonic() - start < 8:
                time.sleep(.05)
            with socket.socket(socket.AF_UNIX) as sock:
                sock.settimeout(5)
                sock.connect(str(path))
                with sock.makefile("rwb") as stream:
                    monitor = Monitor(stream)
                    try:
                        if accel == "kvm":
                            verify_kvm(monitor, result["acceleration"])
                        measure(monitor, work, output, start, result, startup_only=startup_only, accel=accel)
                        if memory_probe:
                            capture_guest_memory(work, output, emulator.pid)
                        if check_controls:
                            controls(monitor, work, output)
                            result["native_inputs_and_screenshots_completed"] = True
                            result["review_images_for"] = ["JS 6/6", "CSS 6/6", "hello x-kernel input and echo"]
                        if long_run:
                            result["soak"] = soak(monitor, work, output, emulator.pid)
                            result["soak_completed"] = True
                    finally:
                        with contextlib.suppress(OSError, RuntimeError):
                            monitor.call("quit")
        finally:
            limit = time.monotonic() + 6
            while True:
                pid, status, usage = os.wait4(emulator.pid, os.WNOHANG)
                if pid:
                    break
                if time.monotonic() > limit:
                    os.kill(emulator.pid, 9)
                time.sleep(.05)
            emulator.returncode = os.waitstatus_to_exitcode(status)
            result["qemu_wait4"] = {"exit": emulator.returncode, "maxrss_bytes": usage.ru_maxrss * 1024,
                                     "user_s": usage.ru_utime, "system_s": usage.ru_stime}
            if (work / "serial.log").exists():
                shutil.copyfile(work / "serial.log", output / "serial.log")
            write_json(output / "metrics.json", result)
    if emulator.returncode:
        raise RuntimeError(f"QEMU 异常退出：{output}")
    return result


def sample_metrics(run):
    stages = run["stages_s"]
    browser = stages["browser_start"]
    if "window_visible" in stages:
        first_frame = {"browser_to_first_visible_s": stages["window_visible"] - browser}
    else:
        first_frame = {"browser_to_window_s": stages["window_white"] - browser}
    metrics = {**first_frame, "browser_to_home_s": stages["home_colors"] - browser,
               "browser_to_renderer_observed_s": stages["renderer_inventory_seen"] - browser,
               "qemu_maxrss_bytes": run["qemu_wait4"]["maxrss_bytes"]}
    if "css_visible" in stages:
        metrics["return_to_css_s"] = stages["css_visible"] - stages["return_css"]
    return {key: round(value, 3) for key, value in metrics.items()}


def metric_statistics(values):
    return {"values": values, "median": statistics.median(values), "min": min(values), "max": max(values)}


def summarize(runs):
    samplings = {}
    for run in runs:
        for key, value in sample_metrics(run).items():
            samplings.setdefault(run["mode"], {}).setdefault(key, []).append(value)
    return {mode: {key: metric_statistics(values) for key, values in metrics.items()}
            for mode, metrics in samplings.items()}


def summarize_pairs(groups, samples):
    reference, candidate = groups[0]
    pairs = []
    deltas = {}
    complete = 0
    for pair, measured in enumerate(samples, 1):
        order = groups[pair - 1]
        row = {"pair": pair, "order": order, "samples": measured,
               "missing_observations": [label for label in order if label not in measured]}
        if not row["missing_observations"]:
            complete += 1
            before, after = measured[reference], measured[candidate]
            differences = {key: round(after[key] - value, 3) for key, value in before.items() if key in after}
            row["candidate_minus_reference"] = differences
            for key, value in differences.items():
                deltas.setdefault(key, []).append(value)
        pairs.append(row)
    return {"reference": reference, "candidate": candidate, "planned_pairs": len(groups),
            "complete_pairs": complete, "pairs": pairs,
            "candidate_minus_reference": {key: metric_statistics(values) for key, values in deltas.items()}}


def paired_order(labels, runs, order):
    forward = list(labels)
    reverse = forward[::-1]
    return [reverse if order == "alternate" and i % 2 else forward for i in range(runs)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path, default=PROJECT / ".git/kernelbridge-source",
                        help="本地队友 KernelBridge Git 仓库，需含固定提交")
    parser.add_argument("--prepared-assets", type=Path,
                        help="离线使用目录内的冻结 guest-browser.sh 和 AArch64 静态 renderer-watch")
    parser.add_argument("--kernel", type=Path, default=PROJECT / "data/platform/candidate/kernel.bin")
    parser.add_argument("--accel", choices=("tcg", "kvm"), default="tcg",
                        help="默认使用 TCG；原生 AArch64 Linux 可显式选择 KVM")
    parser.add_argument("--candidate-kernel", type=Path,
                        help="与 --kernel 在同一运行盘、同一浏览器设置下进行内核对照")
    parser.add_argument("--browser-mode", choices=("baseline", "lowend"),
                        help="内核对照或独立验证的浏览器设置；默认分别为 baseline 和 lowend")
    parser.add_argument("--rootfs", type=Path, default=PROJECT / "data/platform/wayland.img")
    parser.add_argument("--output", type=Path, required=True, help="新建原始数据目录")
    parser.add_argument("--runs", type=int, default=5, help="每种模式独立启动次数")
    parser.add_argument("--order", choices=("alternate", "baseline-first"), default="alternate",
                        help="默认奇数组先原版、偶数组先候选；baseline-first 复现首次矩阵顺序")
    parser.add_argument("--keep-going", action="store_true",
                        help="记录出图超时并继续剩余样本，有超时时整批返回失败")
    validation = parser.add_mutually_exclusive_group()
    validation.add_argument("--controls", action="store_true", help="单独验证键鼠、双标签、CSS 和 JS")
    validation.add_argument("--soak", action="store_true", help="单独验证 30 分钟长稳与 10 次页面加载")
    validation.add_argument("--startup-only", action="store_true",
                            help=f"首页出现后继续观测 {STARTUP_OBSERVATION_SECONDS} 秒，不触发键盘导航")
    validation.add_argument("--memory-probe", action="store_true",
                            help="单独采集浏览器启动前和布局页出图后的客体内存快照")
    args = parser.parse_args()
    kvm_host = kvm_preflight() if args.accel == "kvm" else None
    validation_only = args.controls or args.soak
    if args.runs < 1:
        parser.error("--runs 至少为 1")
    if args.browser_mode and not (args.candidate_kernel or validation_only):
        parser.error("--browser-mode 需要 --candidate-kernel、--controls 或 --soak")
    if args.candidate_kernel and validation_only:
        parser.error("内核对照与 --controls、--soak 分开运行")
    if args.keep_going and validation_only:
        parser.error("--keep-going 仅用于批次对照")
    args.kernel, args.rootfs = args.kernel.resolve(strict=True), args.rootfs.resolve(strict=True)
    if args.candidate_kernel:
        args.candidate_kernel = args.candidate_kernel.resolve(strict=True)
        browser_mode = args.browser_mode or "baseline"
        runs = {"baseline": (args.kernel, browser_mode), "candidate": (args.candidate_kernel, browser_mode)}
    else:
        browser_modes = (args.browser_mode or "lowend",) if validation_only else ("baseline", "lowend")
        runs = {mode: (args.kernel, mode) for mode in browser_modes}
    output = args.output.resolve()
    version = subprocess.check_output(["qemu-system-aarch64", "--version"], text=True).splitlines()[0]
    if not re.search(r"version (?:[89]|[1-9]\d+)\.", version):
        parser.error("需要 QEMU 8.0 或以上")
    output.mkdir(parents=True)
    cpu = next((x.split(":", 1)[1].strip() for x in Path("/proc/cpuinfo").read_text().splitlines()
                if x.startswith("model name")), os.uname().machine)
    groups = [list(runs)] if validation_only else paired_order(runs, args.runs, args.order)
    inputs = {"kernel_sha256": file_hash(args.kernel),
               "rootfs_sha256": file_hash(args.rootfs), "guest_files_sha256": PAGE_HASHES,
               "upstream_commit": COMMIT, "host_kernel": os.uname().release, "host_cpu": cpu,
               "host_memtotal": Path("/proc/meminfo").read_text().splitlines()[0], "qemu": version,
               "run_order": groups, "comparison": "kernels" if args.candidate_kernel else "browser_modes"}
    if kvm_host:
        inputs["acceleration"] = {"requested": "kvm", "preflight": kvm_host}
        os_release = Path("/etc/os-release")
        if os_release.is_file():
            inputs["host_os_release"] = os_release.read_text(encoding="utf-8").splitlines()
    if args.startup_only:
        inputs["measurement_scope"] = {
            "navigation": "initial static home only",
            "seconds_after_home_visible": STARTUP_OBSERVATION_SECONDS,
        }
    if args.memory_probe:
        inputs["measurement_scope"] = {
            "guest_memory_probe": "before-browser and after-layout",
            "guest_endpoint_delay_seconds": GUEST_MEMORY_PROBE_DELAY_SECONDS,
        }
    if args.candidate_kernel:
        inputs["candidate_kernel_sha256"] = file_hash(args.candidate_kernel)
        inputs["browser_mode"] = browser_mode
    elif validation_only:
        inputs["comparison"] = "soak" if args.soak else "controls"
        inputs["browser_mode"] = next(iter(runs))
    if args.keep_going:
        inputs["incomplete_observation_policy"] = "record-and-continue"
    write_json(output / "inputs.json", inputs)
    results = []
    failures = []
    samples = []
    with tempfile.TemporaryDirectory() as tmp:
        disks, asset_hashes = prepare(args, Path(tmp), dict.fromkeys(mode for _, mode in runs.values()))
        if args.prepared_assets:
            inputs["prepared_assets"] = asset_hashes
            write_json(output / "inputs.json", inputs)
        if validation_only:
            mode = next(iter(runs))
            run_once(args.kernel, disks[mode], output / "functional", mode,
                     check_controls=args.controls, long_run=args.soak, accel=args.accel)
            return
        for pair, order in enumerate(groups, 1):
            measured = {}
            for label in order:
                kernel, mode = runs[label]
                case = output / f"{pair:02}-{label}"
                try:
                    result = run_once(kernel, disks[mode], case, label,
                                      startup_only=args.startup_only, memory_probe=args.memory_probe,
                                      accel=args.accel)
                except IncompleteObservation as exc:
                    if not args.keep_going:
                        raise
                    failures.append({"pair": pair, "mode": label, "output": case.name})
                    write_json(output / "failures.json", failures)
                    print(exc, file=sys.stderr, flush=True)
                    continue
                results.append(result)
                measured[label] = sample_metrics(result)
                write_json(output / "summary.json", summarize(results))
            samples.append(measured)
            write_json(output / "paired.json", summarize_pairs(groups, samples))
        if failures:
            raise RuntimeError(f"{len(failures)} 次客体观测未完成，详见 {output / 'failures.json'}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
