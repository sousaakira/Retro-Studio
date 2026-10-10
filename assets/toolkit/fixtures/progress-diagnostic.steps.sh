# Key script for progress-diagnostic.c under scripts/capture-rom.sh (gen_sdl2 keys).
# PROGRESS_PHASE selects the run: first (default), second (after a power cycle)
# or third (after one byte of the .srm file was damaged outside the emulator).
case "${PROGRESS_PHASE:-first}" in
first)
 shot boot-empty
 tap a; tap a; tap a; sleep 0.5; shot saved-three
 tap f; sleep 0.5; shot new-game
 tap s; sleep 0.5; shot continued
 tap Up; tap s; sleep 0.5; shot recovered-previous
 tap Down; tap s; sleep 0.5; shot corrupt
 tap a; tap s; sleep 0.5; shot repaired
 tap d; tap s; sleep 0.5; shot erased
 tap Left; tap s; sleep 0.5; shot migrated
 tap Right; tap a; sleep 0.5; shot saved-current-schema
 quit;;
second) shot boot-after-power-cycle; tap a; sleep 0.5; shot saved-again; quit;;
third) shot boot-damaged-file; quit;;
esac
