/* #65: diagnóstico do HUD. Usa o hud/hud.json do teste (fonte importada com acentos, HUD na
 * janela, relógio em sprites, menu de pausa e caixa de diálogo). Os valores mudam sozinhos.
 * START abre o menu (cima/baixo, A confirma, B fecha); C mostra uma fala e depois uma escolha de
 * quatro opções, as duas pelo caminho das cenas (retroHudCutscenePresent). */
#include <genesis.h>
#include "hud_resources.h"
#include "generated/hud_config.h"
#include "retro_runtime/retro_hud_sgdk.h"
#include "retro_runtime/retro_hud_cutscene.h"
static RetroHudSgdk hud;
static u8 cells[2*RETRO_PROJECT_HUD_CELLS],overlayCells[2*RETRO_PROJECT_HUD_OVERLAY_CELLS];
static u32 score,life=5,energy=100,seconds;
static u8 chosen=255;
/* Estado de apresentação que o host de cenas preenche; aqui preenchido à mão, sem rodar uma cena. */
static RetroCutsceneHost cenas;
static u32 value(void *context,u16 id){
 (void)context;
 return id==RETRO_HUD_VALUE_SCORE?score:id==RETRO_HUD_VALUE_LIFE?life:id==RETRO_HUD_VALUE_ENERGY?energy:seconds;
}
static void selected(void *context,u16 menu,u16 item){
 (void)context;(void)menu;chosen=(u8)item;
 if(item==RETRO_HUD_ITEM_PAUSE_QUIT){score=0;life=5;energy=100;}
 retroHudOverlayHide(&hud.hud);
}
static void cancelled(void *context,u16 menu){(void)context;(void)menu;retroHudOverlayHide(&hud.hud);}
int main(bool hardReset){
 const RetroHudHost host={value,selected,cancelled,0};
 static const char *const lines[]={"Ol\303\241! A ponte est\303\241 fechada.","Volte amanh\303\243 de manh\303\243.","N\303\243o diga que n\303\243o avisei."};
 static const char *const options[]={"Sim","N\303\243o","Talvez","Depois"};
 u16 pad,last=0,frame=0;u8 talk=0,cursor=0;(void)hardReset;
 VDP_setScreenWidth320();SPR_init();
 /* Fundo para ver o que a janela cobre: linhas no plano A, cor de fundo azul. */
 PAL_setColor(0,0x0400);PAL_setColor(15,0x0EEE);
 {u16 row;for(row=0;row<28;row++)VDP_drawText("- plano A do jogo - plano A do jogo -",1,row);}
 if(!retroHudSgdkInitProject(&hud,&host,cells,overlayCells,&RETRO_HUD_GLYPHS,0)){PAL_setColor(0,0x000E);while(1)SYS_doVBlankProcess();}
 while(1){
  pad=JOY_readJoypad(JOY_1);
  u16 pressed=pad&~last;last=pad;frame++;
  if(!(frame&3))score+=37;
  if(!(frame&63)){life=life?life-1:5;seconds=seconds<99?seconds+1:0;}
  energy=(frame>>1)%201;if(energy>100)energy=200-energy;
  if(hud.hud.overlay==RETRO_HUD_MENU){
   retroHudMenuInput(&hud.hud,(u8)((pressed&BUTTON_UP?RETRO_HUD_UP:0)|(pressed&BUTTON_DOWN?RETRO_HUD_DOWN:0)|(pressed&BUTTON_A?RETRO_HUD_CONFIRM:0)|(pressed&BUTTON_B?RETRO_HUD_CANCEL:0)));
  }else if(pressed&BUTTON_START){talk=0;retroHudMenuOpen(&hud.hud,RETRO_HUD_MENU_PAUSE);}
  else if(pressed&BUTTON_C){
   u16 i;
   talk=(u8)(talk<2?talk+1:0);cursor=1;
   cenas.dialogueVisible=talk==1;cenas.choiceVisible=talk==2;cenas.textChanged=1;
   cenas.dialogue.speaker="Guardi\303\243o";cenas.dialogue.lineCount=3;for(i=0;i<3;i++)cenas.dialogue.lines[i]=lines[i];
   cenas.choice.prompt="Abrir a porta?";cenas.choice.count=4;cenas.choice.cursor=cursor;for(i=0;i<4;i++)cenas.choice.options[i]=options[i];
  }else if(talk==2&&(pressed&(BUTTON_UP|BUTTON_DOWN))){
   cursor=(u8)(pressed&BUTTON_UP?(cursor?cursor-1:3):(cursor<3?cursor+1:0));
   cenas.choice.cursor=cursor;cenas.textChanged=1;
  }
  retroHudCutscenePresent(&hud.hud,&cenas);
  retroHudSgdkUpdate(&hud);
  SPR_update();SYS_doVBlankProcess();
 }
 return 0;
}
