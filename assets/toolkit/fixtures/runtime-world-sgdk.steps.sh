# Key script for runtime-world-sgdk.c under scripts/capture-rom.sh (gen_sdl2 keys:
# arrows, a/s/d = A/B/C, f = START). Hall -> key -> exit -> cave arena -> unlock.
shot hall-start
hold Right 2; shot hall-follow
xdotool keydown Right; tap s; sleep 0.25; shot hall-jump; sleep 0.8; xdotool keyup Right
tap d; hold Right 3.5; shot hall-exit-area
tap a; sleep 1.5; shot cave-entry
hold Left 2.6; sleep 1; shot cave-arena-locked
hold Left 3; sleep 0.5; shot cave-arena-wall
tap Up; sleep 0.3; hold Left 3; sleep 1; shot cave-unlocked-left
tap f; sleep 1.5; shot respawn
