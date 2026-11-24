#!/bin/bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
    printf 'Usage: bash %s AI_WORLD_DIRECTORY R117_KERNEL WAYLAND_IMAGE NEW_OUTPUT_DIRECTORY\n' "$0" >&2
    exit 2
fi
tools=$(cd -- "$(dirname -- "$0")" && pwd -P)
repo=$(cd -- "$1" && pwd -P)
kernel=$(realpath -e -- "$2")
rootfs=$(realpath -e -- "$3")
output=$(realpath -m -- "$4")

if pgrep -af '^(/[^ ]*/)?qemu-system-aarch64( |$)'; then
    printf 'A QEMU guest is already running.\n' >&2
    exit 2
fi
mkdir -- "$output"
cd -- "$repo"
export PYTHONDONTWRITEBYTECODE=1
git rev-parse HEAD > "$output/git-head.txt"
python3 -B - "$output" <<'PY'
from pathlib import Path
import sys

from village import Provider, Village

out = Path(sys.argv[1])
village = Village(out / "village.json", Provider([]))
next(item for item in village.s["buildings"] if item["id"] == "farm")["built"] = True
village.s["paused"] = True
village.save()
village.close()
(out / "providers.json").write_text("[]", encoding="utf-8")
PY
python3 -B -u server.py --port 0 --qemu-guest --duration 1200 \
    --data "$output/village.json" --providers "$output/providers.json" > "$output/server.log" 2>&1 &
server_pid=$!
trap 'kill -TERM "$server_pid" 2>/dev/null || true; wait "$server_pid" || true' EXIT
port=''
for attempt in {1..80}; do
    port=$(sed -n 's/.*VILLAGE_READY http:\/\/127\.0\.0\.1:\([0-9][0-9]*\).*/\1/p' "$output/server.log")
    [ -n "$port" ] && break
    sleep .25
done
test -n "$port" || { cat -- "$output/server.log" >&2; exit 1; }
python3 -B -u "$tools/guest_ui.py" --run "$output/guest" launch --repo "$repo" \
    --kernel "$kernel" --rootfs "$rootfs" --port "$port" --duration 900 2>&1 | tee "$output/launch.log"
