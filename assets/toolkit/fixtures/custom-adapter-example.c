/* Exemplo de adaptador próprio (#47): como ligar os módulos de runtime a um
 * sistema que não é o do SGDK. Os módulos só conhecem callbacks; o adaptador
 * é o código do jogo que os implementa.
 *
 * Este arquivo compila e roda no computador (scripts/smoke-custom-adapter.mjs),
 * sem SGDK, com dois adaptadores:
 *  1. um driver de som próprio para o módulo audio;
 *  2. um armazenamento próprio para o módulo progress (um vetor em memória no
 *     lugar da SRAM; em um jogo real seria EEPROM, outro mapeador, etc.). */
#include <stdio.h>
#include <string.h>
#include "retro_audio.h"
#include "retro_progress.h"

/* ---- 1. Driver de som próprio ------------------------------------------- */
/* O contexto é qualquer estrutura do jogo; o módulo só a repassa. */
typedef struct {int track;int voices[4];int paused;} MySoundChip;

static void myMusic(void *context,uint16_t track){
 MySoundChip *chip=(MySoundChip *)context;
 chip->track=track==RETRO_ID_NONE?-1:(int)track; /* RETRO_ID_NONE = silêncio */
}
static void myEffect(void *context,uint16_t effect,uint8_t channel,uint8_t priority){
 MySoundChip *chip=(MySoundChip *)context;
 (void)priority;
 chip->voices[channel-1]=(int)effect;             /* canais começam em 1 */
}
static void myPause(void *context,uint8_t paused){((MySoundChip *)context)->paused=paused;}
/* Sem esta função, um canal só é liberado por outro efeito de prioridade igual ou maior. */
static uint8_t myBusy(void *context,uint8_t channel){return (uint8_t)(((MySoundChip *)context)->voices[channel-1]>=0);}

/* ---- 2. Armazenamento próprio -------------------------------------------- */
typedef struct {uint8_t bytes[512];} MyCartridge;

static uint8_t myRead(void *context,uint16_t offset,uint8_t *bytes,uint16_t count){
 memcpy(bytes,((MyCartridge *)context)->bytes+offset,count);return 1;  /* 1 = sucesso */
}
static uint8_t myWrite(void *context,uint16_t offset,const uint8_t *bytes,uint16_t count){
 memcpy(((MyCartridge *)context)->bytes+offset,bytes,count);return 1;
}

int main(void){
 /* Tabelas que em um projeto vêm dos headers gerados pela IDE. */
 static const RetroAudioEffect effects[]={{2,0},{8,0}};            /* prioridade, canal (0 = automático) */
 static const RetroProgressConfig saveConfig={{1,16,4},0,0,1,0};   /* versão 1, 16 flags, 4 bytes, 1 slot */
 MySoundChip chip={-1,{-1,-1,-1,-1},0};
 MyCartridge cartridge;
 RetroAudioDriver driver={myMusic,myEffect,myPause,myBusy,&chip};
 RetroProgressStorage storage={myRead,myWrite,&cartridge,sizeof(cartridge.bytes)};
 RetroAudio audio;RetroProgress progress,loaded;RetroAudioPlay played;
 memset(cartridge.bytes,0xFF,sizeof(cartridge.bytes));

 /* O jogo usa só a API do módulo; o adaptador recebe as decisões. */
 if(!retroAudioInit(&audio,&driver,2,effects,2,2))return 1;
 retroAudioRoomMusic(&audio,1);
 played=retroAudioPlayEffect(&audio,0);
 retroAudioTick(&audio);
 printf("music=%d effect0->channel %u voices=%d,%d\n",chip.track,played.channel,chip.voices[0],chip.voices[1]);

 retroProgressNew(&progress,&saveConfig);
 retroProgressSetFlag(&progress,&saveConfig,3,1);progress.room=7;progress.checkpoint=2;
 if(retroProgressSave(&progress,&saveConfig,&storage,0)!=RETRO_PROGRESS_OK)return 2;
 if(retroProgressLoad(&loaded,&saveConfig,&storage,0,0)!=RETRO_PROGRESS_OK)return 3;
 printf("saved room=%u checkpoint=%u flag3=%u\n",loaded.room,loaded.checkpoint,retroProgressFlag(&loaded,&saveConfig,3));
 return 0;
}
