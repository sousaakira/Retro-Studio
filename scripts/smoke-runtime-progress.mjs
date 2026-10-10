// #60: versioned progress, two-copy integrity, recovery and migration on the host.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {decodeProgressCopy,encodeProgressCopy,inspectProgressImage,progressCrc} from '../shared/retro/progressRecord.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-progress-'))
const library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
try{
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test'),image=path.join(temporary,'image.bin')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "retro_progress.h"
static uint8_t memory[2048];
static int failRead,failWrite,tearAfter=-1,writes;
static uint8_t readBytes(void *context,uint16_t offset,uint8_t *bytes,uint16_t count){
 (void)context;if(failRead)return 0;assert(offset+count<=sizeof(memory));memcpy(bytes,memory+offset,count);return 1;
}
/* tearAfter: power loss after that many bytes of the next write. */
static uint8_t writeBytes(void *context,uint16_t offset,const uint8_t *bytes,uint16_t count){
 (void)context;if(failWrite)return 0;assert(offset+count<=sizeof(memory));writes++;
 if(tearAfter>=0){memcpy(memory+offset,bytes,(size_t)tearAfter);tearAfter=-1;return 1;}
 memcpy(memory+offset,bytes,count);return 1;
}
static const RetroProgressLayout history[]={{1,8,4},{2,16,2}};
static const RetroProgressConfig v1={{1,8,4},0,0,2,64};
static const RetroProgressConfig v2={{2,16,2},history,1,2,64};
static const RetroProgressConfig v3={{3,40,12},history,2,2,64};
static const RetroProgressConfig ram={{3,40,12},history,2,0,0};
int main(int argc,char **argv){
 RetroProgressStorage s={readBytes,writeBytes,0,sizeof(memory)},small=s,none={0,0,0,0};
 RetroProgress p,q,before;RetroProgressInfo info;RetroProgressConfig bad;uint32_t value;int i;
 RetroProgressLayout twice[]={{1,8,4},{1,8,4}},same[]={{3,8,4}};
 memset(memory,0xFF,sizeof(memory));
 /* Configuration contract. */
 assert(retroProgressValidate(&v1)&&retroProgressValidate(&v3)&&retroProgressValidate(&ram)&&!retroProgressValidate(0));
 bad=v3;bad.layout.schema=0;assert(!retroProgressValidate(&bad));
 bad=v3;bad.layout.flagCount=257;assert(!retroProgressValidate(&bad));
 bad=v3;bad.layout.dataSize=65;assert(!retroProgressValidate(&bad));
 bad=v3;bad.slots=9;assert(!retroProgressValidate(&bad));
 bad=v3;bad.history=0;assert(!retroProgressValidate(&bad));
 bad=v3;bad.history=twice;assert(!retroProgressValidate(&bad));
 bad=v3;bad.history=same;bad.historyCount=1;assert(!retroProgressValidate(&bad));
 bad=v3;bad.offset=65100;assert(!retroProgressValidate(&bad));
 /* New game, flags and fields. */
 memset(&p,0xAA,sizeof(p));assert(!retroProgressNew(0,&v3)&&!retroProgressNew(&p,0));
 assert(retroProgressNew(&p,&v3)&&p.room==RETRO_ID_NONE&&p.checkpoint==RETRO_ID_NONE);
 for(i=0;i<40;i++)assert(!retroProgressFlag(&p,&v3,(uint16_t)i));
 assert(retroProgressSetFlag(&p,&v3,0,1)&&retroProgressSetFlag(&p,&v3,39,1)&&retroProgressSetFlag(&p,&v3,9,7));
 assert(retroProgressFlag(&p,&v3,0)==1&&retroProgressFlag(&p,&v3,39)==1&&retroProgressFlag(&p,&v3,9)==1&&!retroProgressFlag(&p,&v3,8));
 assert(!retroProgressSetFlag(&p,&v3,40,1)&&!retroProgressFlag(&p,&v3,40)&&!retroProgressSetFlag(&p,&v3,65535,1));
 assert(retroProgressSetFlag(&p,&v3,9,0)&&!retroProgressFlag(&p,&v3,9));
 assert(retroProgressWrite(&p,&v3,0,1,200)&&retroProgressWrite(&p,&v3,2,2,0xBEEF)&&retroProgressWrite(&p,&v3,8,4,0x12345678u));
 assert(retroProgressRead(&p,&v3,0,1,&value)&&value==200);
 assert(retroProgressRead(&p,&v3,2,2,&value)&&value==0xBEEF&&p.data[2]==0xBE&&p.data[3]==0xEF);
 assert(retroProgressRead(&p,&v3,8,4,&value)&&value==0x12345678u);
 before=p;
 assert(!retroProgressWrite(&p,&v3,0,1,256)&&!retroProgressWrite(&p,&v3,2,2,65536)&&!retroProgressWrite(&p,&v3,9,4,1));
 assert(!retroProgressWrite(&p,&v3,0,3,1)&&!retroProgressRead(&p,&v3,12,1,&value)&&!retroProgressRead(&p,&v3,0,1,0));
 assert(!memcmp(&p,&before,sizeof(p)));
 p.room=4321;p.checkpoint=77;
 /* Games without SRAM: every storage call reports it and nothing is touched. */
 q=p;assert(retroProgressLoad(&q,&ram,&s,0,0)==RETRO_PROGRESS_NO_STORAGE&&retroProgressSave(&p,&ram,&s,0)==RETRO_PROGRESS_NO_STORAGE);
 assert(retroProgressLoad(&q,&v3,0,0,0)==RETRO_PROGRESS_NO_STORAGE&&retroProgressSave(&p,&v3,&none,0)==RETRO_PROGRESS_NO_STORAGE);
 assert(retroProgressErase(&ram,&s,0)==RETRO_PROGRESS_NO_STORAGE&&!memcmp(&q,&p,sizeof(p))&&!writes);
 /* Rejected arguments. */
 assert(retroProgressLoad(0,&v3,&s,0,0)==RETRO_PROGRESS_INVALID&&retroProgressSave(0,&v3,&s,0)==RETRO_PROGRESS_INVALID);
 assert(retroProgressLoad(&q,&v3,&s,2,0)==RETRO_PROGRESS_INVALID&&retroProgressSave(&p,&v3,&s,2)==RETRO_PROGRESS_INVALID);
 small.size=64+2*256-1;assert(retroProgressSave(&p,&v3,&small,0)==RETRO_PROGRESS_INVALID&&!writes);
 /* Bits beyond an odd flag count would not survive a load; saving them is refused. */
 {RetroProgressConfig odd={{5,12,0},0,0,2,64};before=p;p.flags[1]=0x10;
  assert(retroProgressSave(&p,&odd,&s,0)==RETRO_PROGRESS_INVALID&&!writes);p=before;}
 /* Erased cartridge (0xFF) and zeroed cartridge are both empty. */
 assert(retroProgressLoad(&q,&v3,&s,0,&info)==RETRO_PROGRESS_EMPTY&&!memcmp(&q,&p,sizeof(p)));
 memset(memory,0,sizeof(memory));assert(retroProgressLoad(&q,&v3,&s,1,0)==RETRO_PROGRESS_EMPTY);
 memset(memory,0xFF,sizeof(memory));
 /* Save and continue; slots are independent and bytes outside them survive. */
 assert(retroProgressSave(&p,&v3,&s,0)==RETRO_PROGRESS_OK&&writes==1);
 memset(&q,0,sizeof(q));memset(&info,0xEE,sizeof(info));
 assert(retroProgressLoad(&q,&v3,&s,0,&info)==RETRO_PROGRESS_OK&&!memcmp(&q,&p,sizeof(p)));
 assert(info.sequence==1&&info.schema==3&&!info.migrated&&!info.recovered);
 assert(retroProgressLoad(&q,&v3,&s,1,0)==RETRO_PROGRESS_EMPTY);
 for(i=0;i<64;i++)assert(memory[i]==0xFF);
 for(i=64+512;i<(int)sizeof(memory);i++)assert(memory[i]==0xFF);
 assert(memory[64]=='R'&&memory[65]=='P'&&memory[64+128]==0xFF);
 /* Alternating copies: the second save goes to the other copy. */
 retroProgressSetFlag(&p,&v3,20,1);assert(retroProgressSave(&p,&v3,&s,0)==RETRO_PROGRESS_OK&&memory[64+128]=='R');
 retroProgressWrite(&p,&v3,0,1,3);assert(retroProgressSave(&p,&v3,&s,0)==RETRO_PROGRESS_OK);
 assert(retroProgressLoad(&q,&v3,&s,0,&info)==RETRO_PROGRESS_OK&&info.sequence==3&&!memcmp(&q,&p,sizeof(p)));
 /* Power loss while writing: the previous save is still loaded, flagged as recovered. */
 before=p;retroProgressSetFlag(&p,&v3,21,1);
 for(i=0;i<128;i+=7){
  uint8_t snapshot[sizeof(memory)];memcpy(snapshot,memory,sizeof(memory));
  tearAfter=i;assert(retroProgressSave(&p,&v3,&s,0)==(i<37?RETRO_PROGRESS_STORAGE:RETRO_PROGRESS_OK));
  memset(&q,0,sizeof(q));
  if(retroProgressLoad(&q,&v3,&s,0,&info)==RETRO_PROGRESS_OK){
   if(info.sequence==3){assert(!memcmp(&q,&before,sizeof(q)));assert(i<37&&info.recovered==(i>=14));}
   else{assert(i>=37&&info.sequence==4&&!info.recovered&&!memcmp(&q,&p,sizeof(q)));}
  }else assert(0);
  memcpy(memory,snapshot,sizeof(memory));
 }
 p=before;
 /* Every single-bit error inside the newest record is detected. */
 {
  int newest=memory[64+13]==3?64:64+128,older=newest==64?64+128:64,bit;
  for(bit=0;bit<37*8;bit++){
   memory[newest+bit/8]^=(uint8_t)(1<<(bit&7));memset(&q,0,sizeof(q));
   assert(retroProgressLoad(&q,&v3,&s,0,&info)==RETRO_PROGRESS_OK&&info.sequence==2);
   assert(info.recovered==(bit>=16)); /* a destroyed signature reads as a blank copy */
   memory[newest+bit/8]^=(uint8_t)(1<<(bit&7));
  }
  /* Both copies damaged: reported, caller keeps its state, a save repairs the slot. */
  memory[newest+20]^=1;memory[older+20]^=1;q=p;
  assert(retroProgressLoad(&q,&v3,&s,0,&info)==RETRO_PROGRESS_CORRUPT&&!memcmp(&q,&p,sizeof(p)));
  assert(retroProgressSave(&p,&v3,&s,0)==RETRO_PROGRESS_OK);
  assert(retroProgressLoad(&q,&v3,&s,0,&info)==RETRO_PROGRESS_OK&&info.sequence==1&&info.recovered&&!memcmp(&q,&p,sizeof(p)));
  assert(retroProgressSave(&p,&v3,&s,0)==RETRO_PROGRESS_OK);
  assert(retroProgressLoad(&q,&v3,&s,0,&info)==RETRO_PROGRESS_OK&&info.sequence==2&&!info.recovered);
 }
 /* Storage failures are reported and never change the caller's progress. */
 failRead=1;q=p;assert(retroProgressLoad(&q,&v3,&s,0,0)==RETRO_PROGRESS_STORAGE&&retroProgressSave(&p,&v3,&s,0)==RETRO_PROGRESS_STORAGE);
failRead=0;
 failWrite=1;assert(retroProgressSave(&p,&v3,&s,0)==RETRO_PROGRESS_STORAGE&&retroProgressErase(&v3,&s,0)==RETRO_PROGRESS_STORAGE);failWrite=0;
 assert(retroProgressLoad(&q,&v3,&s,0,&info)==RETRO_PROGRESS_OK&&!memcmp(&q,&p,sizeof(p)));
 /* Erase one slot only. */
 assert(retroProgressSave(&p,&v3,&s,1)==RETRO_PROGRESS_OK&&retroProgressErase(&v3,&s,0)==RETRO_PROGRESS_OK);
 assert(retroProgressLoad(&q,&v3,&s,0,0)==RETRO_PROGRESS_EMPTY&&retroProgressLoad(&q,&v3,&s,1,0)==RETRO_PROGRESS_OK);
 assert(retroProgressErase(&v3,&s,1)==RETRO_PROGRESS_OK);
 /* Migration: schema 1 -> 2 -> 3 keeps flags by bit and the data prefix. */
 assert(retroProgressNew(&p,&v1));p.room=11;p.checkpoint=22;
 retroProgressSetFlag(&p,&v1,1,1);retroProgressSetFlag(&p,&v1,7,1);retroProgressWrite(&p,&v1,0,2,0xCAFE);retroProgressWrite(&p,&v1,2,2,0x0102);
 assert(retroProgressSave(&p,&v1,&s,0)==RETRO_PROGRESS_OK);
 /* A build that does not know schema 1 refuses it instead of misreading it. */
 {RetroProgressConfig blind=v2;blind.history=0;blind.historyCount=0;
  assert(retroProgressLoad(&q,&blind,&s,0,0)==RETRO_PROGRESS_UNSUPPORTED);}
 assert(retroProgressLoad(&q,&v2,&s,0,&info)==RETRO_PROGRESS_OK&&info.migrated&&info.schema==1&&q.room==11&&q.checkpoint==22);
 assert(retroProgressFlag(&q,&v2,1)&&retroProgressFlag(&q,&v2,7)&&!retroProgressFlag(&q,&v2,8));
 assert(retroProgressRead(&q,&v2,0,2,&value)&&value==0xCAFE&&q.data[2]==0&&q.data[3]==0); /* shrunk data is cut */
 assert(retroProgressLoad(&q,&v3,&s,0,&info)==RETRO_PROGRESS_OK&&info.migrated&&info.schema==1);
 assert(retroProgressRead(&q,&v3,2,2,&value)&&value==0x0102&&retroProgressRead(&q,&v3,8,4,&value)&&value==0);
 /* Saving after migration writes the current schema and keeps the old copy once. */
 retroProgressSetFlag(&q,&v3,39,1);assert(retroProgressSave(&q,&v3,&s,0)==RETRO_PROGRESS_OK);
 assert(retroProgressLoad(&p,&v3,&s,0,&info)==RETRO_PROGRESS_OK&&!info.migrated&&info.schema==3&&info.sequence==2&&!memcmp(&p,&q,sizeof(p)));
 /* A newer save than this build knows wins over the older copy it could read:
  * progress is never silently rolled back. */
 before=q;assert(retroProgressLoad(&q,&v1,&s,0,0)==RETRO_PROGRESS_UNSUPPORTED&&retroProgressLoad(&q,&v2,&s,0,0)==RETRO_PROGRESS_UNSUPPORTED);
 assert(!memcmp(&q,&before,sizeof(q)));
 /* ...and it is never overwritten by a build that cannot read it, until erased. */
 {uint8_t snapshot[sizeof(memory)];memcpy(snapshot,memory,sizeof(memory));
  assert(retroProgressSave(&q,&v1,&s,0)==RETRO_PROGRESS_UNSUPPORTED&&retroProgressSave(&q,&v2,&s,0)==RETRO_PROGRESS_UNSUPPORTED&&!memcmp(snapshot,memory,sizeof(memory)));
  assert(retroProgressNew(&q,&v1)&&retroProgressErase(&v1,&s,0)==RETRO_PROGRESS_OK&&retroProgressSave(&q,&v1,&s,0)==RETRO_PROGRESS_OK);
  memcpy(memory,snapshot,sizeof(memory));q=before;}
 /* Same schema number with a different size is not trusted either. */
 {RetroProgressConfig other={{3,40,8},0,0,2,64};assert(retroProgressLoad(&q,&other,&s,0,0)==RETRO_PROGRESS_UNSUPPORTED);}
 if(argc>1){FILE *f=fopen(argv[1],"wb");assert(f&&fwrite(memory,1,sizeof(memory),f)==sizeof(memory));fclose(f);}
 return 0;
}
`)
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I'+path.join(library,'core'),'-I'+path.join(library,'progress')]
 const built=spawnSync('cc',[...flags,fixture,path.join(library,'progress/retro_progress.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[image],{encoding:'utf8'});assert.equal(ran.status,0,ran.stdout+ran.stderr)
 // The JS mirror of the record format reads what the C module wrote.
 const bytes=new Uint8Array(fs.readFileSync(image)),[slot0,slot1]=inspectProgressImage(bytes,{offset:64,slots:2})
 assert.deepEqual(slot1.map(copy=>copy.state),['blank','blank'])
 assert.deepEqual(slot0.map(copy=>[copy.state,copy.schema,copy.sequence]).sort(),[['valid',1,1],['valid',3,2]])
 const current=slot0.find(copy=>copy.schema===3)
 assert.deepEqual([current.flagCount,current.dataSize,current.room,current.checkpoint],[40,12,11,22])
 assert.deepEqual([...current.flags],[0x82,0,0,0,0x80]);assert.deepEqual([...current.data.slice(0,4)],[0xCA,0xFE,1,2])
 const position=64+(slot0[0].schema===3?0:128)
 assert.deepEqual([...encodeProgressCopy(current)],[...bytes.subarray(position,position+128)],'JS encoder reproduces the C bytes')
 assert.equal(progressCrc(new TextEncoder().encode('123456789')),0x29B1,'CRC-16/CCITT-FALSE check value')
 const damaged=bytes.slice(position,position+128);damaged[30]^=4;assert.equal(decodeProgressCopy(damaged).state,'damaged')
 assert.throws(()=>inspectProgressImage(bytes.subarray(0,300),{offset:64,slots:1}),/smaller/)
 const cross=process.argv.indexOf('--m68k-cc')
 if(cross>=0){
  const object=path.join(temporary,'progress.o')
  const compiled=spawnSync(process.argv[cross+1],['-m68000','-std=c99','-Wall','-Wextra','-Werror','-O2','-I'+path.join(library,'core'),'-c',path.join(library,'progress/retro_progress.c'),'-o',object],{encoding:'utf8'})
  assert.equal(compiled.status,0,compiled.stderr);console.log('PASS progress module compiled for 68000 ('+fs.statSync(object).size+' bytes object)')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime progress: new game, flags, fields, no-SRAM path, slots, alternating copies, torn writes, bit errors, corruption repair, storage failures, erase, migration and JS record parity passed.')
