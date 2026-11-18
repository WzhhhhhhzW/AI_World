#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."

for file in data/platform/candidate/kernel.bin data/platform/wayland.img; do
    if [[ ! -s "$file" ]]; then
        echo "缺少 $file，请依照平台说明准备内核和运行盘。" >&2
        exit 1
    fi
done

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
    echo "当前会话没有图形显示，请在桌面终端或带 WSLg 的 Ubuntu 中启动。" >&2
    exit 1
fi

# The local WSL installation keeps the distro's matching GUI modules in a user cache.
gui_lib="$HOME/.cache/qilin-kernelbridge/host-gui/root/usr/lib/x86_64-linux-gnu"
if ! qemu-system-aarch64 -display help | grep -qx gtk; then
    if [[ -f "$gui_lib/qemu/ui-gtk.so" ]]; then
        export QEMU_MODULE_DIR="$gui_lib/qemu"
        export LD_LIBRARY_PATH="$gui_lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    fi
    if ! qemu-system-aarch64 -display help | grep -qx gtk; then
        echo "此 QEMU 缺少图形窗口支持。Ubuntu 可安装与 qemu-system-arm 同版本的 qemu-system-gui。" >&2
        exit 1
    fi
fi

save_dir="${XDG_DATA_HOME:-$HOME/.local/share}/qilin-village"
log_file=$(mktemp)
python3 -u server.py --port 0 --qemu-guest --data "$save_dir/village.json" >"$log_file" 2>&1 &
server_pid=$!
cleanup() {
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    rm -f -- "$log_file"
}
trap cleanup EXIT
for ((i=0; i<120; i++)); do
    port=$(sed -n 's|^VILLAGE_READY http://127\.0\.0\.1:\([0-9]*\).*|\1|p' "$log_file")
    [[ -n "$port" ]] && break
    if ! kill -0 "$server_pid" 2>/dev/null; then cat "$log_file" >&2; exit 1; fi
    sleep 0.1
done
if [[ -z "$port" ]]; then cat "$log_file" >&2; exit 1; fi

echo "正在启动赛题客体，Weston 桌面出现后请等待 Chromium 打开村庄。存档位置为 $save_dir"
python3 platform/qemu_demo.py launch --port "$port"
