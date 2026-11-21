#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."

save_dir="${XDG_DATA_HOME:-$HOME/.local/share}/qilin-village"
mkdir -p -- "$save_dir"
save_dir=$(cd -- "$save_dir" && pwd -P)
session_key=$(printf '%s' "$save_dir" | sha256sum)
window_name="Qilin Village ${session_key:0:12}"
window_title="QEMU ($window_name)"

focus_existing() {
    # A duplicate can arrive while the launch owner is still preparing the disk.
    # Wait for the original window instead of starting another guest or host service.
    if pgrep -f -- "^([^ ]*/)?qemu-system-aarch64 .* -name guest=$window_name( |$)" >/dev/null 2>&1; then
        if [[ -n "${DISPLAY:-}" ]] && command -v wmctrl >/dev/null && wmctrl -a "$window_title" 2>/dev/null; then
            return 0
        fi
        if [[ -n "${WSL_DISTRO_NAME:-}" ]] && command -v powershell.exe >/dev/null; then
            local script
            printf -v script '$shell = New-Object -ComObject WScript.Shell; if ($shell.AppActivate("%s")) { exit 0 }; exit 1' "$window_title"
            timeout 4s powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$script" </dev/null >/dev/null 2>&1
            return $?
        fi
    fi
    return 1
}

# The launch owner keeps this descriptor for the session. Child processes must
# not inherit it, so an ended launcher cannot leave a stale launch lock behind.
exec {launch_lock}>>"$save_dir/launcher.lock"
if flock -n -E 75 "$launch_lock"; then
    :
else
    result=$?
    if [[ "$result" != 75 ]]; then exit "$result"; fi
    if focus_existing; then
        echo "已请求切回正在运行的赛题村庄。"
        exit 0
    fi
    printf '赛题村庄已在运行或启动中。请从任务栏切回 %s；若窗口尚未出现，请等待原启动窗口。\n' "$window_title"
    exit 75
fi

kernel=data/platform/candidate/kernel.bin
if [[ -s data/platform/candidate/finals-kernel.bin ]]; then
    kernel=data/platform/candidate/finals-kernel.bin
fi
for file in "$kernel" data/platform/wayland.img; do
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

log_file=$(mktemp)
python3 -u server.py --port 0 --qemu-guest --data "$save_dir/village.json" >"$log_file" 2>&1 {launch_lock}>&- &
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

echo "正在启动赛题客体，Chromium 会自动打开村庄。存档位置为 $save_dir"
python3 platform/qemu_demo.py launch --kernel "$kernel" --port "$port" --window-name "$window_name" {launch_lock}>&-
