#!/bin/bash
# Developer tool: run a temporary diagnostic ROM in an installed emulator under
# Xvfb, replay a key script and save real emulator screenshots. Never pass an
# original game ROM; the emulator HOME is a scratch directory inside <out-dir>.
# usage: scripts/capture-rom.sh <rom> <out-dir> <emulator-binary> <steps.sh>
# steps.sh may call: shot <name>, hold <key> <seconds>, tap <key>, quit, sleep.
# The emulator runs with <out-dir>/home as working directory, so files it writes
# there (Genesis Plus GX: game.srm on a clean quit) never touch the installed one.
# Verified with Genesis Plus GX (gen_sdl2: arrows, a/s/d = A/B/C, f = START).
set -eu
if [ "${1:-}" != "--inside" ]; then
  [ $# -eq 4 ] || { echo "usage: $0 <rom> <out-dir> <emulator-binary> <steps.sh>" >&2; exit 2; }
  for tool in xvfb-run xdotool import; do command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 3; }; done
  mkdir -p "$2/home"
  exec xvfb-run -a -s "-screen 0 640x480x24" "$0" --inside "$(realpath "$1")" "$(realpath "$2")" "$(realpath "$3")" "$(realpath "$4")"
fi
ROM="$2"; OUT="$3"; EMU="$4"; STEPS="$5"
cd "$OUT/home"
HOME="$OUT/home" "$EMU" "$ROM" >"$OUT/emulator.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
sleep 5
kill -0 $PID || { echo "emulator exited; see $OUT/emulator.log" >&2; exit 4; }
WINDOW=$(xdotool search --onlyvisible --name "" | tail -1)
xdotool windowfocus "$WINDOW"; xdotool mousemove 300 300
count=0
shot(){ count=$((count+1)); import -window "$WINDOW" "$OUT/$(printf %02d $count)-$1.png"; echo "saved $OUT/$(printf %02d $count)-$1.png"; }
hold(){ xdotool keydown "$1"; sleep "$2"; xdotool keyup "$1"; sleep 0.2; }
tap(){ hold "$1" 0.15; }
# Clean exit (Escape) so the emulator flushes its save files.
quit(){ xdotool key Escape; for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 $PID 2>/dev/null || return 0; sleep 0.3; done; }
. "$STEPS"
