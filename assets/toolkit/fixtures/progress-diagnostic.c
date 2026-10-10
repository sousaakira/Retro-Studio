/* #60 diagnostic host: exported progress layout saved to SRAM through SGDK.
 * Isolated fixture; it replaces main.c only inside a temporary project.
 * A: +1 coin, key flag, checkpoint and save. B: continue (load). C: erase.
 * START: new game (RAM only). RIGHT: toggle boss flag. UP: damage the newest
 * copy. DOWN: damage both copies. LEFT: write a schema 1 save (migration). */
#include <genesis.h>
#include "generated/progress_config.h"
#include "retro_runtime/retro_progress_sgdk.h"
static const RetroProgressConfig legacy={{1,8,2},0,0,RETRO_PROJECT_PROGRESS_SLOTS,0};
static const char *const names[]={"OK","EMPTY","CORRUPT","UNSUPPORTED","INVALID","STORAGE","NO STORAGE"};
static RetroProgress progress;
static RetroProgressInfo info;
static RetroProgressStorage storage;
static RetroInput input;
static const char *operation="BOOT";
static u8 status;
static u32 sequenceOf(u16 copy){
 u16 base=retroProjectProgress.offset+copy*RETRO_PROGRESS_COPY_BYTES;u32 value;
 SRAM_enableRO();
 value=SRAM_readByte(base)=='R'?((u32)SRAM_readByte(base+12)<<8|SRAM_readByte(base+13))+1:0;
 SRAM_disable();return value;
}
/* Distinct bytes, so damaging both never undoes an earlier single damage. */
static void damage(u16 copy,u16 byte){
 u16 address=retroProjectProgress.offset+copy*RETRO_PROGRESS_COPY_BYTES+byte;u8 value;
 SRAM_enable();value=SRAM_readByte(address);SRAM_writeByte(address,value^0x40);SRAM_disable();
}
static void load(void){
 info.sequence=0;info.schema=0;info.migrated=info.recovered=0;
 status=retroProgressLoad(&progress,&retroProjectProgress,&storage,0,&info);
}
static void draw(void){
 char line[48];u32 coins=0,lives=0;
 retroProgressRead(&progress,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FIELD_COINS_OFFSET,RETRO_PROJECT_PROGRESS_FIELD_COINS_BYTES,&coins);
 retroProgressRead(&progress,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FIELD_LIVES_OFFSET,RETRO_PROJECT_PROGRESS_FIELD_LIVES_BYTES,&lives);
 sprintf(line,"PROGRESS SCHEMA %u SRAM %u SLOTS %u",RETRO_PROJECT_PROGRESS_SCHEMA,RETRO_PROJECT_PROGRESS_SRAM_BYTES,RETRO_PROJECT_PROGRESS_SLOTS);
 VDP_drawText(line,1,1);
 sprintf(line,"%-9s -> %-12s",operation,names[status]);VDP_drawText(line,1,4);
 sprintf(line,"SEQ %5lu SCHEMA %u MIG %u REC %u ",info.sequence,info.schema,info.migrated,info.recovered);VDP_drawText(line,1,6);
 sprintf(line,"ROOM %5u CHECKPOINT %5u ",progress.room,progress.checkpoint);VDP_drawText(line,1,9);
 sprintf(line,"KEY %u BOSS %u COINS %5lu LIVES %3lu ",
  retroProgressFlag(&progress,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FLAG_KEY),
  retroProgressFlag(&progress,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FLAG_BOSS),coins,lives);
 VDP_drawText(line,1,11);
 VDP_drawText("A SAVE+COIN  B CONTINUE  C ERASE",1,20);
 VDP_drawText("START NEW  RIGHT BOSS  LEFT LEGACY",1,22);
 VDP_drawText("UP DAMAGE NEWEST  DOWN DAMAGE BOTH",1,24);
}
int main(void){
 PAL_setColor(15,0x0EEE);JOY_init();
 storage=retroProgressSgdkStorage(RETRO_PROJECT_PROGRESS_SRAM_BYTES);
 retroProgressNew(&progress,&retroProjectProgress);
 retroProgressWrite(&progress,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FIELD_LIVES_OFFSET,RETRO_PROJECT_PROGRESS_FIELD_LIVES_BYTES,3);
 load();
 while(TRUE){
  u32 coins=0;
  retroInputUpdate(&input,JOY_readJoypad(JOY_1));
  if(input.pressed&BUTTON_A){
   retroProgressRead(&progress,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FIELD_COINS_OFFSET,RETRO_PROJECT_PROGRESS_FIELD_COINS_BYTES,&coins);
   coins++;
   retroProgressWrite(&progress,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FIELD_COINS_OFFSET,RETRO_PROJECT_PROGRESS_FIELD_COINS_BYTES,coins);
   retroProgressSetFlag(&progress,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FLAG_KEY,1);
   progress.room=(u16)(100+coins);progress.checkpoint=(u16)coins;
   operation="SAVE";status=retroProgressSave(&progress,&retroProjectProgress,&storage,0);
  }
  if(input.pressed&BUTTON_B){operation="CONTINUE";load();}
  if(input.pressed&BUTTON_C){operation="ERASE";status=retroProgressErase(&retroProjectProgress,&storage,0);}
  if(input.pressed&BUTTON_START){
   operation="NEW GAME";status=retroProgressNew(&progress,&retroProjectProgress)?RETRO_PROGRESS_OK:RETRO_PROGRESS_INVALID;
   info.sequence=0;info.schema=0;info.migrated=info.recovered=0;
  }
  if(input.pressed&BUTTON_RIGHT)retroProgressSetFlag(&progress,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FLAG_BOSS,
   !retroProgressFlag(&progress,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FLAG_BOSS));
  if(input.pressed&BUTTON_UP){operation="DAMAGE 1";status=RETRO_PROGRESS_OK;damage(sequenceOf(1)>sequenceOf(0)?1:0,20);}
  if(input.pressed&BUTTON_DOWN){operation="DAMAGE 2";status=RETRO_PROGRESS_OK;damage(0,21);damage(1,21);}
  if(input.pressed&BUTTON_LEFT){
   RetroProgress old;
   retroProgressNew(&old,&legacy);old.room=7;old.checkpoint=9;
   retroProgressSetFlag(&old,&legacy,RETRO_PROJECT_PROGRESS_FLAG_KEY,1);retroProgressWrite(&old,&legacy,0,2,513);
   operation="LEGACY";status=retroProgressErase(&legacy,&storage,0);
   if(status==RETRO_PROGRESS_OK)status=retroProgressSave(&old,&legacy,&storage,0);
  }
  draw();SYS_doVBlankProcess();
 }
 return 0;
}
