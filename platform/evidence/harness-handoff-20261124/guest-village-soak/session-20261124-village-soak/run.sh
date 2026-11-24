#!/bin/bash
set -eu
case_dir=$(cd -- "$(dirname "$0")" && pwd)
repo=/mnt/e/qilin-harness-handoff-20261124
cd "$repo"
gitdir=/mnt/e/qilin/.git/worktrees/qilin-harness-handoff-20261124
test "$(git --git-dir="$gitdir" --work-tree="$repo" rev-parse HEAD)" = a68c9eec38f34cdcea7b4a512310d9d567e056b6
git -c core.filemode=false -c core.autocrlf=true --git-dir="$gitdir" --work-tree="$repo" diff --quiet HEAD -- web village.py village_harness.py server.py platform
if ps -C qemu-system-aarch64 -o pid= | grep -q '[0-9]'; then echo "Existing QEMU"; exit 1; fi
export PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$repo"
python3 -B "$case_dir/watch.py" seed
python3 -B -u server.py --port 0 --qemu-guest --duration 2030 --data "$case_dir/village.json" --providers "$case_dir/providers.json" >"$case_dir/server.log" 2>&1 &
sp=$!
cleanup() {
    rc=$?
    trap - EXIT
    if kill -0 "$sp" 2>/dev/null; then kill -TERM "$sp"; fi
    set +e
    wait "$sp"; server_rc=$?
    echo "$server_rc" >"$case_dir/service.exitcode"
    echo "$rc" >"$case_dir/launcher.exitcode"
    exit "$rc"
}
trap cleanup EXIT
for n in {1..80}; do grep -q 'VILLAGE_READY' "$case_dir/server.log" && break; sleep .25; done
port=$(sed -n 's/.*VILLAGE_READY http:\/\/127\.0\.0\.1:\([0-9][0-9]*\).*/\1/p' "$case_dir/server.log" | head -1)
test -n "$port"
python3 -B -u "$case_dir/../guest_ui.py" --run "$case_dir/guest" launch --repo "$repo" --kernel /mnt/e/qilin/data/platform/finals-next/build-0645c85-r109-rust-heap-growth-floor-r117/kernel.bin --rootfs /mnt/e/qilin/data/platform/wayland.img --port "$port" --duration 2010 >"$case_dir/launch.log" 2>&1
