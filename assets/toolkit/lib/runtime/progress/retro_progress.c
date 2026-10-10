#include "retro_progress.h"
/* Copy: 'R' 'P' format 0 | schema flagCount dataSize (u16) | sequence (u32) |
 * room checkpoint (u16) | flags | data | CRC-16/CCITT-FALSE. Big-endian. */
#define HEADER 18
#define FORMAT 1
enum {COPY_BLANK=0,COPY_DAMAGED=1,COPY_VALID=2};
static uint16_t get16(const uint8_t *b){return (uint16_t)((b[0]<<8)|b[1]);}
static void put16(uint8_t *b,uint16_t v){b[0]=(uint8_t)(v>>8);b[1]=(uint8_t)v;}
static uint32_t get32(const uint8_t *b){return ((uint32_t)get16(b)<<16)|get16(b+2);}
static void put32(uint8_t *b,uint32_t v){put16(b,(uint16_t)(v>>16));put16(b+2,(uint16_t)v);}
static uint16_t crc(const uint8_t *bytes,uint16_t count){
 uint16_t value=0xFFFF;uint8_t bit;
 while(count--){
  value^=(uint16_t)(*bytes++<<8);
  for(bit=0;bit<8;bit++)value=(uint16_t)(value&0x8000?(value<<1)^0x1021:value<<1);
 }
 return value;
}
static uint8_t layout(const RetroProgressLayout *l){
 return (uint8_t)(l->schema>0&&l->flagCount<=RETRO_PROGRESS_MAX_FLAGS&&l->dataSize<=RETRO_PROGRESS_MAX_DATA);
}
static uint16_t flagBytes(uint16_t count){return (uint16_t)((count+7)/8);}
uint8_t retroProgressValidate(const RetroProgressConfig *c){
 uint8_t i,j;
 if(!c||!layout(&c->layout)||c->slots>RETRO_PROGRESS_MAX_SLOTS||c->historyCount>RETRO_PROGRESS_MAX_HISTORY||
  (c->historyCount&&!c->history)||(uint32_t)c->offset+(uint32_t)c->slots*RETRO_PROGRESS_SLOT_BYTES>0xFFFF)return 0;
 for(i=0;i<c->historyCount;i++){
  if(!layout(&c->history[i])||c->history[i].schema==c->layout.schema)return 0;
  for(j=0;j<i;j++)if(c->history[j].schema==c->history[i].schema)return 0;
 }
 return 1;
}
uint8_t retroProgressNew(RetroProgress *p,const RetroProgressConfig *config){
 uint16_t i;
 if(!p||!retroProgressValidate(config))return 0;
 p->room=p->checkpoint=RETRO_ID_NONE;
 for(i=0;i<sizeof(p->flags);i++)p->flags[i]=0;
 for(i=0;i<sizeof(p->data);i++)p->data[i]=0;
 return 1;
}
static uint8_t usable(const RetroProgressConfig *config,const RetroProgressStorage *storage,uint8_t slot){
 if(!retroProgressValidate(config))return RETRO_PROGRESS_INVALID;
 if(!config->slots||!storage||!storage->read||!storage->write)return RETRO_PROGRESS_NO_STORAGE;
 if(slot>=config->slots)return RETRO_PROGRESS_INVALID;
 if((uint32_t)config->offset+(uint32_t)config->slots*RETRO_PROGRESS_SLOT_BYTES>storage->size)return RETRO_PROGRESS_INVALID;
 return RETRO_PROGRESS_OK;
}
static uint16_t address(const RetroProgressConfig *config,uint8_t slot,uint8_t copy){
 return (uint16_t)(config->offset+slot*RETRO_PROGRESS_SLOT_BYTES+copy*RETRO_PROGRESS_COPY_BYTES);
}
/* Unused padding bits of the last flag byte must be zero in a valid record. */
static uint8_t padding(const uint8_t *flags,uint16_t count){
 return (uint8_t)(!(count&7)||!(flags[count/8]>>(count&7)));
}
static uint8_t inspect(const uint8_t *b,RetroProgressLayout *found,uint32_t *sequence){
 uint16_t length;
 if(b[0]!='R'||b[1]!='P')return COPY_BLANK;
 found->schema=get16(b+4);found->flagCount=get16(b+6);found->dataSize=get16(b+8);
 if(b[2]!=FORMAT||b[3]||!layout(found))return COPY_DAMAGED;
 length=(uint16_t)(HEADER+flagBytes(found->flagCount)+found->dataSize);
 if(crc(b,length)!=get16(b+length)||!padding(b+HEADER,found->flagCount))return COPY_DAMAGED;
 *sequence=get32(b+10);return COPY_VALID;
}
static const RetroProgressLayout *known(const RetroProgressConfig *c,const RetroProgressLayout *found){
 uint8_t i;
 if(found->schema==c->layout.schema)
  return found->flagCount==c->layout.flagCount&&found->dataSize==c->layout.dataSize?&c->layout:0;
 for(i=0;i<c->historyCount;i++)
  if(c->history[i].schema==found->schema)
   return c->history[i].flagCount==found->flagCount&&c->history[i].dataSize==found->dataSize?&c->history[i]:0;
 return 0;
}
uint8_t retroProgressLoad(RetroProgress *progress,const RetroProgressConfig *config,
 const RetroProgressStorage *storage,uint8_t slot,RetroProgressInfo *info){
 uint8_t buffer[2][RETRO_PROGRESS_COPY_BYTES],state[2],copy,best=2,damaged=0,status;
 RetroProgressLayout found[2];uint32_t sequence[2]={0,0};uint16_t i,count;
 const uint8_t *b;RetroProgress next;
 if(!progress)return RETRO_PROGRESS_INVALID;
 status=usable(config,storage,slot);
 if(status!=RETRO_PROGRESS_OK)return status;
 for(copy=0;copy<2;copy++){
  if(!storage->read(storage->context,address(config,slot,copy),buffer[copy],RETRO_PROGRESS_COPY_BYTES))return RETRO_PROGRESS_STORAGE;
  state[copy]=inspect(buffer[copy],&found[copy],&sequence[copy]);
  if(state[copy]==COPY_DAMAGED)damaged=1;
  else if(state[copy]==COPY_VALID&&(best==2||sequence[copy]>sequence[best]))best=copy;
 }
 if(best==2)return damaged?RETRO_PROGRESS_CORRUPT:RETRO_PROGRESS_EMPTY;
 /* The newest save decides: an older copy this build understands is never
  * loaded in its place, so newer progress is not silently rolled back. */
 if(!known(config,&found[best]))return RETRO_PROGRESS_UNSUPPORTED;
 /* Migration keeps flags by bit and the data prefix; the rest starts cleared. */
 retroProgressNew(&next,config);b=buffer[best];
 next.room=get16(b+14);next.checkpoint=get16(b+16);
 count=found[best].flagCount<config->layout.flagCount?found[best].flagCount:config->layout.flagCount;
 for(i=0;i<count;i++)if(b[HEADER+i/8]&(1<<(i&7)))next.flags[i/8]|=(uint8_t)(1<<(i&7));
 count=found[best].dataSize<config->layout.dataSize?found[best].dataSize:config->layout.dataSize;
 for(i=0;i<count;i++)next.data[i]=b[HEADER+flagBytes(found[best].flagCount)+i];
 *progress=next;
 if(info){
  info->sequence=sequence[best];info->schema=found[best].schema;
  info->migrated=(uint8_t)(found[best].schema!=config->layout.schema);info->recovered=damaged;
 }
 return RETRO_PROGRESS_OK;
}
uint8_t retroProgressSave(const RetroProgress *progress,const RetroProgressConfig *config,
 const RetroProgressStorage *storage,uint8_t slot){
 uint8_t buffer[RETRO_PROGRESS_COPY_BYTES],check[RETRO_PROGRESS_COPY_BYTES],state[2],copy,target,status;
 RetroProgressLayout found[2];uint32_t sequence[2]={0,0},next;uint16_t i,length,flags;
 if(!progress)return RETRO_PROGRESS_INVALID;
 status=usable(config,storage,slot);
 if(status!=RETRO_PROGRESS_OK)return status;
 flags=flagBytes(config->layout.flagCount);
 if(!padding(progress->flags,config->layout.flagCount))return RETRO_PROGRESS_INVALID;
 for(copy=0;copy<2;copy++){
  if(!storage->read(storage->context,address(config,slot,copy),buffer,RETRO_PROGRESS_COPY_BYTES))return RETRO_PROGRESS_STORAGE;
  state[copy]=inspect(buffer,&found[copy],&sequence[copy]);
 }
 if(state[0]!=COPY_VALID)target=0;
 else if(state[1]!=COPY_VALID)target=1;
 else target=(uint8_t)(sequence[0]<sequence[1]?0:1);
 /* The copy Load would pick is the other one (or the only valid one). A save
  * this build cannot read is only replaced after an explicit erase. */
 copy=(uint8_t)(state[0]==COPY_VALID&&state[1]==COPY_VALID?!target:state[0]==COPY_VALID?0:1);
 if(state[copy]==COPY_VALID&&!known(config,&found[copy]))return RETRO_PROGRESS_UNSUPPORTED;
 next=state[0]==COPY_VALID?sequence[0]:0;
 if(state[1]==COPY_VALID&&sequence[1]>next)next=sequence[1];
 if(next==0xFFFFFFFFu)return RETRO_PROGRESS_STORAGE;
 for(i=0;i<RETRO_PROGRESS_COPY_BYTES;i++)buffer[i]=0;
 buffer[0]='R';buffer[1]='P';buffer[2]=FORMAT;
 put16(buffer+4,config->layout.schema);put16(buffer+6,config->layout.flagCount);put16(buffer+8,config->layout.dataSize);
 put32(buffer+10,next+1);put16(buffer+14,progress->room);put16(buffer+16,progress->checkpoint);
 /* A validated layout always fits; checking before the copies also lets the
  * compiler see the bounds (link-time optimization warned about them). */
 length=(uint16_t)(HEADER+flags+config->layout.dataSize);
 if(flags>sizeof(progress->flags)||config->layout.dataSize>sizeof(progress->data)||length>RETRO_PROGRESS_COPY_BYTES-2)return RETRO_PROGRESS_INVALID;
 for(i=0;i<flags;i++)buffer[HEADER+i]=progress->flags[i];
 for(i=0;i<config->layout.dataSize;i++)buffer[HEADER+flags+i]=progress->data[i];
 put16(buffer+length,crc(buffer,length));
 if(!storage->write(storage->context,address(config,slot,target),buffer,RETRO_PROGRESS_COPY_BYTES)||
  !storage->read(storage->context,address(config,slot,target),check,RETRO_PROGRESS_COPY_BYTES))return RETRO_PROGRESS_STORAGE;
 for(i=0;i<RETRO_PROGRESS_COPY_BYTES;i++)if(check[i]!=buffer[i])return RETRO_PROGRESS_STORAGE;
 return RETRO_PROGRESS_OK;
}
uint8_t retroProgressErase(const RetroProgressConfig *config,const RetroProgressStorage *storage,uint8_t slot){
 uint8_t buffer[RETRO_PROGRESS_COPY_BYTES],copy,status=usable(config,storage,slot);uint16_t i;
 if(status!=RETRO_PROGRESS_OK)return status;
 for(copy=0;copy<2;copy++){
  for(i=0;i<RETRO_PROGRESS_COPY_BYTES;i++)buffer[i]=0;
  if(!storage->write(storage->context,address(config,slot,copy),buffer,RETRO_PROGRESS_COPY_BYTES)||
   !storage->read(storage->context,address(config,slot,copy),buffer,RETRO_PROGRESS_COPY_BYTES))return RETRO_PROGRESS_STORAGE;
  for(i=0;i<RETRO_PROGRESS_COPY_BYTES;i++)if(buffer[i])return RETRO_PROGRESS_STORAGE;
 }
 return RETRO_PROGRESS_OK;
}
uint8_t retroProgressFlag(const RetroProgress *p,const RetroProgressConfig *config,uint16_t flag){
 if(!p||!config||flag>=config->layout.flagCount||flag>=RETRO_PROGRESS_MAX_FLAGS)return 0;
 return (uint8_t)((p->flags[flag/8]>>(flag&7))&1);
}
uint8_t retroProgressSetFlag(RetroProgress *p,const RetroProgressConfig *config,uint16_t flag,uint8_t value){
 if(!p||!config||flag>=config->layout.flagCount||flag>=RETRO_PROGRESS_MAX_FLAGS)return 0;
 if(value)p->flags[flag/8]|=(uint8_t)(1<<(flag&7));
 else p->flags[flag/8]&=(uint8_t)~(1<<(flag&7));
 return 1;
}
static uint8_t field(const RetroProgressConfig *config,uint16_t offset,uint8_t bytes){
 return (uint8_t)(config&&(bytes==1||bytes==2||bytes==4)&&config->layout.dataSize<=RETRO_PROGRESS_MAX_DATA&&
  (uint32_t)offset+bytes<=config->layout.dataSize);
}
uint8_t retroProgressRead(const RetroProgress *p,const RetroProgressConfig *config,
 uint16_t offset,uint8_t bytes,uint32_t *value){
 uint32_t result=0;uint8_t i;
 if(!p||!value||!field(config,offset,bytes))return 0;
 for(i=0;i<bytes;i++)result=(result<<8)|p->data[offset+i];
 *value=result;return 1;
}
uint8_t retroProgressWrite(RetroProgress *p,const RetroProgressConfig *config,
 uint16_t offset,uint8_t bytes,uint32_t value){
 uint8_t i;
 if(!p||!field(config,offset,bytes)||(bytes<4&&value>>(bytes*8)))return 0;
 for(i=0;i<bytes;i++)p->data[offset+i]=(uint8_t)(value>>((bytes-1-i)*8));
 return 1;
}
