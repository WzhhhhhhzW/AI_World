#!/bin/sh
# The dedicated soak run is the only session that starts this observer.
set -eu
while :; do
    browser=$(ps -o pid,comm | awk '$2 == "chromium" { print $1; exit }')
    weston=$(ps -o pid,comm | awk '$2 == "weston" { print $1; exit }')
    if [ -n "$browser" ] && [ -n "$weston" ]; then break; fi
    sleep 1
done
while :; do
    if [ "$(cat "/proc/$browser/comm" 2>/dev/null || :)" != chromium ] ||
       [ "$(cat "/proc/$weston/comm" 2>/dev/null || :)" != weston ]; then
        echo FINALS_PROCESS_LOST
        exit 1
    fi
    printf 'FINALS_LIVE browser=%s weston=%s\n' "$browser" "$weston"
    sleep 5
done
