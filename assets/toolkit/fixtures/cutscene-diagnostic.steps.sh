# Key script for cutscene-diagnostic.c under scripts/capture-rom.sh (gen_sdl2 keys:
# arrows, a/s/d = A/B/C, f = START). CUTSCENE_PHASE: first (default), second
# (after a power cycle, with the saved game.srm) or skip (START during the scene).
case "${CUTSCENE_PHASE:-first}" in
first)
 shot enter-trigger-scene
 tap a; sleep 0.4; shot player-control
 hold Right 1.6; sleep 0.3; shot touch-scene-started
 sleep 3.2; shot dialogue
 tap a; sleep 0.4; shot choice-default
 tap Up; sleep 0.2; shot choice-first
 tap a; sleep 0.25; shot fading
 sleep 2.2; shot player-control-again
 hold Right 0.6; sleep 0.2; tap s; sleep 0.4; shot interact-scene
 tap a; sleep 0.4; shot interact-ended
 quit;;
second)
 shot boot-continued
 hold Right 2.2; sleep 0.5; shot once-not-repeated
 quit;;
skip)
 tap a; sleep 0.4
 hold Right 1.6; sleep 0.8; shot scene-running
 tap f; sleep 0.5; shot skipped
 quit;;
esac
