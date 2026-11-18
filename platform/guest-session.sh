#!/bin/sh
# Sourced by the login shell only on the temporary demo disk.
set -eu
url=$1
export XDG_RUNTIME_DIR=/run/user/0 WAYLAND_DISPLAY=ict-wayland
export WESTON_DISABLE_ATOMIC=1 SEATD_VTBOUND=0 LIBSEAT_BACKEND=seatd
mkdir -p "$XDG_RUNTIME_DIR" /run/udev/data /dev/input /dev/dri
chmod 700 "$XDG_RUNTIME_DIR"

# The competition image supplies this helper. The reconstructed disk exposes
# the same major/minor identities through sysfs but has no installed helper.
if [ -x /opt/ict/prepare-unified-devices.sh ]; then
    ICT_PREPARE_FRESH_SNAPSHOT=1 sh /opt/ict/prepare-unified-devices.sh
else
    for entry in /sys/class/drm/card0 /sys/class/input/event*; do
        number=$(cat "$entry/dev")
        leaf=${entry##*/}
        case "$leaf" in
            card0) node=/dev/dri/card0; property= ;;
            event*) node=/dev/input/$leaf
                case "$(cat "$entry/device/name")" in
                    *Mouse*) property=ID_INPUT_MOUSE ;;
                    *Keyboard*) property=ID_INPUT_KEYBOARD ;;
                    *) continue ;;
                esac ;;
        esac
        if [ ! -c "$node" ] || [ "$(stat -c '%t:%T' "$node")" != "$(printf '%x:%x' "${number%:*}" "${number#*:}")" ]; then
            mknod "$node.village" c "${number%:*}" "${number#*:}"
            mv -f "$node.village" "$node"
        fi
        {
            printf 'E:ID_SEAT=seat0\nG:seat\n'
            if [ -n "$property" ]; then printf 'E:ID_INPUT=1\nE:%s=1\n' "$property"; fi
        } >"/run/udev/data/c$number"
        printf 'VILLAGE_DEVICE %s %s %s\n' "$node" "$number" "$property"
    done
fi
seatd -g root >/tmp/village-seat.log 2>&1 &
i=0
while [ ! -S /run/seatd.sock ]; do
    i=$((i+1)); [ "$i" -lt 60 ] || { cat /tmp/village-seat.log; exit 1; }
    sleep 1
done
weston --backend=drm-backend.so --renderer=pixman --drm-device=card0 \
    --seat=seat0 --continue-without-input --idle-time=0 --socket="$WAYLAND_DISPLAY" \
    --log=/tmp/village-weston.log &
i=0
while [ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]; do
    i=$((i+1)); [ "$i" -lt 60 ] || { cat /tmp/village-weston.log; exit 1; }
    sleep 1
done
printf 'VILLAGE_WESTON_READY\n'
printf 'VILLAGE_BROWSER_URL %s\n' "$url"
exec chromium --no-sandbox --no-zygote --ozone-platform=wayland --disable-gpu \
    --disable-software-rasterizer --disable-dev-shm-usage --no-first-run \
    --disable-background-networking --disable-component-update --disable-extensions \
    --ipc-connection-timeout=120 --start-maximized --user-data-dir=/tmp/village-profile \
    "$url" >/tmp/village-chromium.log 2>&1
