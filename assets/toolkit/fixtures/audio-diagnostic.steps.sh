# Key script for audio-diagnostic.c under scripts/capture-rom.sh (gen_sdl2 keys).
# Run with SDL_AUDIODRIVER=disk SDL_DISKAUDIOFILE=<out>/audio.raw to record what
# the emulator plays; marks.txt gives the wall-clock time of every step.
mark(){ echo "$1 $(date +%s.%N)" >> "$OUT/marks.txt"; }
: > "$OUT/marks.txt"
mark silence; sleep 1.5; shot silence
mark room0; tap f; sleep 2; shot room-music-0
mark room1; tap f; sleep 2; shot room-music-1
mark effect2; tap d; sleep 0.1; shot effect-auto; sleep 1.4
mark effect0; tap a; sleep 0.5; shot effect-fixed-channel; sleep 1.5
mark burst; tap Right; sleep 0.1; shot burst-interrupts; sleep 1
mark script; tap Up; sleep 2; shot scripted-music
mark restore; tap Down; sleep 2; shot restored-room-music
mark pause; tap Left; sleep 2; shot paused
mark resume; tap Left; sleep 2; shot resumed
mark end
quit
