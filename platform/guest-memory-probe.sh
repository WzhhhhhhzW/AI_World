#!/bin/sh
# Run by the dedicated benchmark observer at each measurement endpoint.
case "${1-}" in
    before|after) ;;
    *) exit 2 ;;
esac
for source in meminfo memscope; do
    printf '\nFINALS_MEMORY_BEGIN %s %s\n' "$1" "$source"
    cat "/proc/$source" 2>/dev/null || printf 'unavailable\n'
    printf 'FINALS_MEMORY_END %s %s\n' "$1" "$source"
done
