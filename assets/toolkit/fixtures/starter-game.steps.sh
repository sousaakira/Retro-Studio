# Key script for the playable starter under scripts/capture-rom.sh (gen_sdl2 keys:
# arrows, a/s/d = A/B/C, f = START). With SDL_AUDIODRIVER=disk the room music
# and the effects are recorded; marks.txt gives the time of every step.
mark(){ echo "$1 $(date +%s.%N)" >> "$OUT/marks.txt"; }
: > "$OUT/marks.txt"
mark hall; sleep 1.5; shot hall-start
hold Right 0.8; shot walking
mark jump; tap s; sleep 0.12; shot jumping; sleep 0.9
mark walk; hold Right 6; sleep 0.6
mark cave; sleep 1.5; shot cave-after-exit
mark checkpoint; hold Right 3.2; sleep 0.3; shot cave-checkpoint
hold Right 1.5; shot cave-further
mark respawn; tap f; sleep 0.8; shot respawned-at-checkpoint
mark back; hold Left 6; sleep 0.6
mark hall2; sleep 1.5; shot back-in-hall
mark end
quit
