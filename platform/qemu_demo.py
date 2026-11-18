"""Launch the village on a graphical AArch64 QEMU guest, or capture its display."""
import argparse
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
from urllib.request import Request, build_opener, ProxyHandler


def prepare_session_disk(rootfs, work, url):
    """Install a login hook on a private raw image; preserve the original filesystem."""
    disk = work / "session.img"
    subprocess.run(["cp", "--reflink=auto", "--sparse=always", "--", rootfs, disk], check=True)
    disk.chmod(0o600)
    # debugfs may report a missing inode while exiting successfully.
    def debugfs(command, write=False):
        mode = ["-w"] if write else []
        return subprocess.check_output(["debugfs", *mode, "-R", command, disk],
                                       cwd=work, stderr=subprocess.STDOUT, text=True)

    shutil.copyfile(Path(__file__).with_name("guest-session.sh"), work / "session.sh")
    (work / "login.sh").write_text(
        f"if [ ! -e /tmp/village-started ]; then\n"
        "  touch /tmp/village-started\n"
        f"  sh /opt/village-session.sh '{url}' </dev/null >/dev/console 2>&1 &\nfi\n",
        encoding="ascii",
    )
    for local, remote in [("session.sh", "/opt/village-session.sh"),
                          ("login.sh", "/etc/profile.d/99-village-demo.sh")]:
        debugfs(f"write {local} {remote}", write=True)
        content = (work / local).read_text(encoding="utf-8")
        if content not in debugfs(f"cat {remote}"):
            raise RuntimeError(f"临时镜像中未读回 {remote}")
    return disk


def launch(args):
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
    host = f"10.0.2.100:{args.port}"
    url = f"http://{host}/?render=tcg"
    request = Request(f"http://127.0.0.1:{args.port}/api/health", headers={"Host": host})
    with build_opener(ProxyHandler({})).open(request, timeout=5) as response:
        health = json.load(response)
    if health.get("mode") != "local-village" or not health.get("ok"):
        raise ValueError("对应端口没有运行村庄服务")

    with tempfile.TemporaryDirectory(prefix="village-qemu-") as directory:
        work = Path(directory).resolve()
        disk = prepare_session_disk(rootfs, work, url)
        monitor = work / "monitor.sock"
        serial = work / "serial.sock"
        # Double commas encode literal commas in QEMU option strings.
        drive = f"if=none,id=disk0,format=raw,snapshot=on,file={str(disk).replace(',', ',,')}"
        command = [
            "qemu-system-aarch64", "-machine", "virt,gic-version=3", "-cpu", "cortex-a76",
            "-accel", "tcg,tb-size=160", "-m", str(args.memory), "-smp", str(args.cpus),
            "-kernel", str(kernel), "-drive", drive, "-device", "virtio-blk-pci,drive=disk0",
            "-netdev", f"user,id=net0,restrict=on,guestfwd=tcp:{host}-cmd:{nc} 127.0.0.1 {args.port}",
            "-device", "virtio-net-pci,netdev=net0,romfile=",
            "-device", "virtio-gpu-pci", "-device", "virtio-keyboard-pci",
            "-device", "virtio-mouse-pci", "-device", "virtio-rng-pci",
            "-vga", "none", "-no-reboot", "-monitor", "none",
            "-chardev", f"socket,id=console,path={serial},server=on,wait=off,logfile={work}/serial.log",
            "-serial", "chardev:console", "-qmp", f"unix:{monitor},server=on,wait=off",
        ]
        if args.append:
            command.extend(["-append", args.append])
        command.extend(["-display", "none" if args.headless else "gtk,gl=off"])
        print(version, "\n" + shlex.join(command), flush=True)
        print(f"客体 Chromium 地址 {url}\nQMP 监视器 {monitor}\n串口记录 {work}/serial.log", flush=True)
        return subprocess.call(command)


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
