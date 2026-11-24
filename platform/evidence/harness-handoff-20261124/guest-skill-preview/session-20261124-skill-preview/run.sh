#!/bin/bash
set -eu
case_dir=$(cd -- "$(dirname "$0")" && pwd)
cd /mnt/e/qilin-harness-handoff-20261124
repo=$PWD
tools=$(dirname "$case_dir")
if ps -C qemu-system-aarch64 -o pid= | grep -q '[0-9]'; then echo existing VM; exit 1; fi
test "$(git --git-dir=/mnt/e/qilin/.git/worktrees/qilin-harness-handoff-20261124 --work-tree=/mnt/e/qilin-harness-handoff-20261124 rev-parse HEAD)" = 73db41e931cc0bcbbd6a5014bf7ce5b6cd21f9bf
export PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$repo"
python3 -B "$case_dir/fixture.py" seed
python3 -B -u server.py --port 0 --qemu-guest --duration 465 --data "$case_dir/village.json" --providers "$case_dir/providers.json" >"$case_dir/server.log" 2>&1 &
sp=$!
trap 'kill -TERM "$sp" 2>/dev/null || true; wait "$sp" || true' EXIT
for n in {1..80}; do grep -q 'VILLAGE_READY' "$case_dir/server.log" && break; sleep .25; done
port=$(sed -n 's/.*VILLAGE_READY http:\/\/127\.0\.0\.1:\([0-9][0-9]*\).*/\1/p' "$case_dir/server.log" | head -1)
test -n "$port"
python3 -B -u "$tools/guest_ui.py" --run "$case_dir/guest" launch --repo "$repo" --kernel /mnt/e/qilin/data/platform/finals-next/build-0645c85-r109-rust-heap-growth-floor-r117/kernel.bin --rootfs /mnt/e/qilin/data/platform/wayland.img --port "$port" --duration 405 >"$case_dir/launch.log" 2>&1
