#ifndef RETRO_STUDIO_CUTSCENE_SGDK_H
#define RETRO_STUDIO_CUTSCENE_SGDK_H
#include <genesis.h>
#include "retro_cutscene_host.h"
#ifdef RETRO_CUTSCENE_HOST_AVAILABLE
/* SGDK 1.81 reference presentation for RetroCutsceneHost: text box on the
 * WINDOW plane, choice cursor and palette fades. Replace it freely; the host
 * state it reads is public. Text uses the current SGDK font and text palette. */
#define RETRO_CUTSCENE_SGDK_ROWS 7
/* New presses of a pad state -> runner input. A/C confirm, START skips the scene. */
static inline unsigned int retroCutsceneSgdkInput(const RetroInput *input){
 return (input->pressed&(BUTTON_A|BUTTON_C)?CUTSCENE_INPUT_CONFIRM:0)|(input->pressed&BUTTON_UP?CUTSCENE_INPUT_UP:0)|
  (input->pressed&BUTTON_DOWN?CUTSCENE_INPUT_DOWN:0)|(input->pressed&BUTTON_START?CUTSCENE_INPUT_SKIP:0);
}
/* Call once per frame after retroCutsceneHostUpdate. palette: the 64 colours
 * the game shows when not faded (used by fade in); it must outlive the fade. */
static inline void retroCutsceneSgdkPresent(RetroCutsceneHost *host,const u16 *palette){
 u16 rows=VDP_getScreenHeight()/8,top=rows-RETRO_CUTSCENE_SGDK_ROWS,i;
 if(host->fadeChanged){
  host->fadeChanged=0;
  if(PAL_isDoingFade())PAL_interruptFade();
  if(host->dark){if(host->fadeFrames)PAL_fadeOutAll(host->fadeFrames,TRUE);else PAL_setColors(0,palette_black,64,DMA);}
  else if(palette){if(host->fadeFrames)PAL_fadeInAll(palette,host->fadeFrames,TRUE);else PAL_setColors(0,palette,64,DMA);}
 }
 if(!host->textChanged)return;
 host->textChanged=0;
 if(!host->dialogueVisible&&!host->choiceVisible){VDP_setWindowVPos(FALSE,0);return;}
 VDP_setWindowVPos(TRUE,top);
 VDP_clearTextAreaBG(WINDOW,0,top,40,RETRO_CUTSCENE_SGDK_ROWS);
 if(host->dialogueVisible){
  if(host->dialogue.speaker)VDP_drawTextBG(WINDOW,host->dialogue.speaker,2,top+1);
  for(i=0;i<(u16)host->dialogue.lineCount&&i<CUTSCENE_MAX_LINES;i++)
   if(host->dialogue.lines[i])VDP_drawTextBG(WINDOW,host->dialogue.lines[i],2,top+2+i);
 }else{
  if(host->choice.prompt)VDP_drawTextBG(WINDOW,host->choice.prompt,2,top+1);
  for(i=0;i<(u16)host->choice.count&&i<CUTSCENE_MAX_CHOICES;i++){
   VDP_drawTextBG(WINDOW,i==(u16)host->choice.cursor?">":" ",2,top+2+i);
   if(host->choice.options[i])VDP_drawTextBG(WINDOW,host->choice.options[i],4,top+2+i);
  }
 }
}
#endif
#endif
