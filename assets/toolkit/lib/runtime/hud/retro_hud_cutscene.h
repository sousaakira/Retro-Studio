#ifndef RETRO_STUDIO_HUD_CUTSCENE_H
#define RETRO_STUDIO_HUD_CUTSCENE_H
/* Cutscene dialogue and choices in the HUD's dialogue box, with the HUD font
 * (accents included when the font has them). Needs the cutscene-host module.
 * Call once per frame after retroCutsceneHostUpdate, instead of letting
 * retroCutsceneSgdkPresent draw the text: this function consumes textChanged, so
 * retroCutsceneSgdkPresent called afterwards only handles the fades. */
#include "retro_hud.h"
#include "retro_cutscene_host.h"
static inline void retroHudCutscenePresent(RetroHud *hud,RetroCutsceneHost *host){
 if(!host->textChanged)return;
 host->textChanged=0;
 if(host->choiceVisible)retroHudChoiceShow(hud,host->choice.prompt,(const char*const*)host->choice.options,(uint8_t)host->choice.count,(uint8_t)host->choice.cursor);
 else if(host->dialogueVisible)retroHudDialogueShow(hud,host->dialogue.speaker,(const char*const*)host->dialogue.lines,(uint8_t)host->dialogue.lineCount);
 else retroHudOverlayHide(hud);
}
#endif
