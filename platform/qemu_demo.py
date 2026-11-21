"""Launch the village on a graphical AArch64 QEMU guest, or capture its display."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, build_opener, ProxyHandler


GUEST_HOST = "10.0.2.100:8766"
GUEST_URL = f"http://{GUEST_HOST}/?render=tcg"


def cached_boot_disk(rootfs, *, session_args=None, guest_files=()):
    """Build an immutable native Linux disk once per source and guest hook revision."""
    import fcntl

    session_script = Path(__file__).with_name("guest-session.sh").read_bytes()
    args = " ".join(map(shlex.quote, session_args)) if session_args else f"'{GUEST_URL}'"
    login = (
        "if [ ! -e /tmp/village-started ]; then\n"
        "  touch /tmp/village-started\n"
        f"  sh /opt/village-session.sh {args} </dev/null >/dev/console 2>&1 &\nfi\n"
    ).encode("ascii")

    def source_identity():
        stat = rootfs.stat()
        return (str(rootfs), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino)

    identity = source_identity()
    fingerprint = json.dumps(identity).encode() + session_script + login
    digest = hashlib.sha256(fingerprint)
    for path, content, executable in guest_files:
        digest.update(json.dumps([path, executable, hashlib.sha256(content).hexdigest()]).encode())
    key = digest.hexdigest()
    cache_root = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache").resolve()
    cache = cache_root / "qilin-village" / "disks"
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    disk = cache / (key + ".img")
    with (cache / (key + ".lock")).open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if disk.is_file() and disk.stat().st_size == rootfs.stat().st_size:
            return disk, "disk-cache-hit"
        print("首次准备客体启动盘，后续启动将复用此盘。", flush=True)
        with tempfile.TemporaryDirectory(dir=cache) as tmp:
            work = Path(tmp)
            candidate = work / "disk.img"
            subprocess.run(["cp", "--reflink=auto", "--sparse=always", "--", rootfs, candidate], check=True)
            candidate.chmod(0o600)
            files = [("/opt/village-session.sh", session_script, False),
                     ("/etc/profile.d/99-village-demo.sh", login, False), *guest_files]
            for index, (remote, data, executable) in enumerate(files):
                local = f"file-{index}"
                (work / local).write_bytes(data)
                if executable:
                    (work / local).chmod(0o755)
                subprocess.run(["debugfs", "-w", "-R", f"write {local} {remote}", candidate],
                               cwd=work, stdout=subprocess.DEVNULL, check=True)
                # debugfs can return success for a missing target. Read actual bytes.
                result = subprocess.check_output(["debugfs", "-R", f"cat {remote}", candidate],
                                                 stderr=subprocess.DEVNULL)
                if result != data:
                    raise RuntimeError(f"启动盘脚本回读失败：{remote}")
            if source_identity() != identity:
                raise RuntimeError("准备期间原镜像已更改，请重新启动")
            candidate.chmod(0o400)
            candidate.replace(disk)
    return disk, "disk-cache-built"


def report_guest_stages(emulator, serial_log, started):
    markers = iter([(b"platform = kplat-aarch64", "kernel-boot"),
                    (b"VILLAGE_WESTON_READY", "weston-ready"),
                    (b"VILLAGE_BROWSER_URL", "chromium-launch")])
    marker, label = next(markers)
    deadline = time.monotonic() + 120
    while emulator.poll() is None and time.monotonic() < deadline:
        if serial_log.exists():
            contents = serial_log.read_bytes()
            while marker in contents:
                print(f"VILLAGE_STAGE {time.monotonic() - started:.2f}s {label}", flush=True)
                following = next(markers, None)
                if following is None:
                    return
                marker, label = following
        time.sleep(.15)
    if emulator.poll() is None:
        print(f"仍在等待 {label}，详情见 {serial_log}", flush=True)


def emulator_command(kernel, disk, work, *, network="user,id=net0,restrict=on",
                     cpus=4, memory=2048, headless=True, append=None):
    monitor = work / "monitor.sock"
    serial = work / "serial.sock"
    # Double commas encode literal commas in QEMU option strings.
    drive = f"if=none,id=disk0,format=raw,snapshot=on,file={str(disk).replace(',', ',,')}"
    command = [
        "qemu-system-aarch64", "-machine", "virt,gic-version=3", "-cpu", "cortex-a76",
        "-accel", "tcg,tb-size=160", "-m", str(memory), "-smp", str(cpus),
        "-kernel", str(kernel), "-drive", drive, "-device", "virtio-blk-pci,drive=disk0",
        "-netdev", network,
        "-device", "virtio-net-pci,netdev=net0,romfile=",
        "-device", "virtio-gpu-pci", "-device", "virtio-keyboard-pci",
        "-device", "virtio-mouse-pci", "-device", "virtio-rng-pci",
        "-vga", "none", "-no-reboot", "-monitor", "none",
        "-chardev", f"socket,id=console,path={serial},server=on,wait=off,logfile={work}/serial.log",
        "-serial", "chardev:console", "-qmp", f"unix:{monitor},server=on,wait=off",
    ]
    if append:
        command.extend(["-append", append])
    command.extend(["-display", "none" if headless else "gtk,gl=off"])
    return command


def launch(args):
    started = time.monotonic()
    kernel = args.kernel.resolve(strict=True)
    rootfs = args.rootfs.resolve(strict=True)
    version = subprocess.check_output(["qemu-system-aarch64", "--version"], text=True).splitlines()[0]
    match = re.search(r"version (\d+)\.", version)
    if not match or int(match[1]) < 8:
        raise ValueError("需要 qemu-system-aarch64 8.0 及以上版本")
    if not 1 <= args.port <= 65535:
        raise ValueError("无效端口")
    nc = shutil.which("nc")
    if not nc:
        raise ValueError("需要宿主机安装 netcat-openbsd (nc)")
    request = Request(f"http://127.0.0.1:{args.port}/api/health", headers={"Host": GUEST_HOST})
    with build_opener(ProxyHandler({})).open(request, timeout=5) as response:
        health = json.load(response)
    if health.get("mode") != "local-village" or not health.get("ok"):
        raise ValueError("对应端口没有运行村庄服务")

    with tempfile.TemporaryDirectory(prefix="village-qemu-") as directory:
        work = Path(directory).resolve()
        disk, cache_stage = cached_boot_disk(rootfs)
        print(f"VILLAGE_STAGE {time.monotonic() - started:.2f}s {cache_stage}", flush=True)
        monitor = work / "monitor.sock"
        network = f"user,id=net0,restrict=on,guestfwd=tcp:{GUEST_HOST}-cmd:{nc} 127.0.0.1 {args.port}"
        command = emulator_command(kernel, disk, work, network=network, cpus=args.cpus,
                                   memory=args.memory, headless=args.headless, append=args.append)
        if args.window_name:
            command.extend(["-name", "guest=" + args.window_name.replace(",", ",,")])
        print(version, "\n" + shlex.join(command), flush=True)
        print(f"客体 Chromium 地址 {GUEST_URL}\nQMP 监视器 {monitor}\n串口记录 {work}/serial.log", flush=True)
        with subprocess.Popen(command) as emulator:
            print(f"VILLAGE_STAGE {time.monotonic() - started:.2f}s qemu-start", flush=True)
            try:
                report_guest_stages(emulator, work / "serial.log", started)
                return emulator.wait()
            finally:
                if emulator.poll() is None:
                    emulator.terminate()


def capture(args):
    destination = args.output.resolve()
    if destination.suffix.lower() != ".png":
        raise ValueError("请指定 .png 输出文件")
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(20)
        connection.connect(os.fspath(args.monitor))
        with connection.makefile("rwb") as channel:
            def execute(name, arguments=None):
                payload = {"execute": name, "id": name}
                if arguments:
                    payload["arguments"] = arguments
                channel.write(json.dumps(payload).encode("utf-8") + b"\n")
                channel.flush()
                while True:
                    message = json.loads(channel.readline())
                    if message.get("id") == name:
                        if "error" in message:
                            raise RuntimeError(message["error"]["desc"])
                        return message["return"]

            if "QMP" not in json.loads(channel.readline()):
                raise ValueError("无效的 QMP 监视器")
            execute("qmp_capabilities")
            if execute("query-target")["arch"] != "aarch64":
                raise ValueError("当前 QEMU 客体架构不是 AArch64")
            with tempfile.TemporaryDirectory(dir=destination.parent) as directory:
                temporary = Path(directory) / "display.png"
                execute("screendump", {"filename": str(temporary), "format": "png"})
                with temporary.open("rb") as shot:
                    if shot.read(8) != b"\x89PNG\r\n\x1a\n":
                        raise ValueError("QEMU 返回了无效 PNG")
                    shot.seek(0)
                    with destination.open("xb") as output:
                        shutil.copyfileobj(shot, output)
    print(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    run = commands.add_parser("launch", help="用已有的 x-kernel 和 raw rootfs 启动演示")
    assets = Path(__file__).resolve().parents[1] / "data" / "platform"
    run.add_argument("--kernel", default=assets / "candidate" / "kernel.bin", type=Path)
    run.add_argument("--rootfs", default=assets / "wayland.img", type=Path)
    run.add_argument("--port", type=int, default=8766)
    run.add_argument("--cpus", type=int, default=4)
    run.add_argument("--memory", type=int, default=2048, help="演示 VM 内存，单位 MiB")
    run.add_argument("--append", help="沿用当前内核构建的启动参数")
    run.add_argument("--window-name", help="设置 QEMU 窗口的识别名称")
    run.add_argument("--headless", action="store_true", help="仅使用 monitor 读取虚拟显示")
    shot = commands.add_parser("capture", help="调用 QEMU monitor screendump 保存 PNG")
    shot.add_argument("--monitor", required=True, type=Path)
    shot.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    return launch(args) if args.action == "launch" else capture(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
