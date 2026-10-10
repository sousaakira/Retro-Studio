# Key script for runtime-input-sgdk.c under scripts/capture-rom.sh (gen_sdl2 keys:
# arrows, a/s/d = A/B/C, f = START). Default three-button preset: A attack,
# B jump, C dash, DOWN+C transform, UP interact, START menu.
held(){ for key in $1; do xdotool keydown "$key"; done; sleep 0.35; shot "$2"; for key in $1; do xdotool keyup "$key"; done; sleep 0.3; }
shot idle
held a held-attack
held s held-jump
tap s; tap s; sleep 0.2; shot three-jumps-counted
held d held-dash
held "Down d" held-down-and-c-transform
held "Left Up" held-left-and-up
held f held-menu
shot all-released
quit
