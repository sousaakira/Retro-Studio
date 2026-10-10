# Key script for palette-diagnostic.c under scripts/capture-rom.sh (gen_sdl2: a/s/d = A/B/C).
shot boot
tap a; sleep 0.4; shot cycles-1
sleep 0.35; shot cycles-2
tap a; sleep 0.3
tap s; sleep 0.25; shot fade-out-middle
sleep 1.5; shot fade-out-done
tap d; sleep 1.5; shot fade-in-done
quit
