# Key script for hud-diagnostic.c under scripts/capture-rom.sh (gen_sdl2 keys:
# arrows, a/s/d = A/B/C, f = START). HUD, pause menu, dialogue, choice, back to HUD.
shot hud
sleep 2; shot hud-values-changed
tap f; sleep 0.6; shot menu
tap Down; sleep 0.4; shot menu-second-item
tap s; sleep 0.6; shot menu-closed
tap d; sleep 0.6; shot dialogue
tap d; sleep 0.6; shot choice
tap Down; sleep 0.4; shot choice-third
tap Down; sleep 0.4; shot choice-fourth-scrolled
tap d; sleep 0.6; shot hud-again
