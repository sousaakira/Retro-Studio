# Key script for scenery-diagnostic.c under scripts/capture-rom.sh (gen_sdl2 keys:
# arrows, a/s/d = A/B/C, f = START). Tour of the streamed room, room change both ways.
shot start
sleep 3; shot tour-right-1
sleep 4; shot tour-right-2
sleep 5; shot tour-right-end
sleep 3; shot tour-down
sleep 4; shot tour-left
tap a; sleep 1.5; shot legacy-room
tap a; sleep 1.5; shot back-to-streamed
xdotool keydown s; hold Right 2; xdotool keyup s; shot fast-right
hold Down 2; shot manual-down
