// #56: diagnostics formatting on the host: measured vs unmeasured values, peaks and transport records.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parseDebugRecord,collectDebugRecords} from '../shared/retro/debugRecord.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-debug-'))
const library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
try{
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "retro_debug.h"
int main(void){
 char line[RETRO_DEBUG_LINE+8],record[200],tiny[16];RetroDebugPeaks peaks;uint8_t n;
 RetroDebugSample none={0,99,99,99,99,99,99,99,99,99};
 RetroDebugSample full={RETRO_DEBUG_CPU|RETRO_DEBUG_FPS|RETRO_DEBUG_DMA|RETRO_DEBUG_VRAM|RETRO_DEBUG_SPRITES,37,60,5,1234,96,64,128,12,31};
 RetroDebugSample worst={RETRO_DEBUG_CPU|RETRO_DEBUG_FPS|RETRO_DEBUG_DMA|RETRO_DEBUG_VRAM|RETRO_DEBUG_SPRITES,65535,65535,65535,65535,65535,65535,65535,65535,65535};
 RetroDebugSubject hero={3,2,1,-12,176,-384,640,0x0005},far={65535,65535,65535,-32768,32767,(RetroFixed)-2147483647-1,2147483647,0xFFFF};
 memset(line,'#',sizeof(line));
 /* Unmeasured values are shown as "--", never as numbers left in the struct. */
 n=retroDebugLinePerformance(line,&none,0);assert(!strcmp(line,"CPU -- FPS -- DMA --")&&n==strlen(line));
 retroDebugLineMemory(line,&none,"A1B2");assert(!strcmp(line,"#A1B2 VRAM -- SPR --"));
 retroDebugLineMemory(line,&none,0);assert(!strcmp(line,"VRAM -- SPR --"));
 /* Measured values, with the peak next to the instant value. */
 retroDebugPeaksReset(&peaks);assert(peaks.vramLowest==0xFFFF&&!peaks.frames);
 retroDebugPeaksUpdate(&peaks,&none);assert(!peaks.cpu&&peaks.vramLowest==0xFFFF&&peaks.frames==1);
 retroDebugPeaksUpdate(&peaks,&full);full.cpu=20;full.dmaQueue=1;full.vramFree=100;retroDebugPeaksUpdate(&peaks,&full);
 assert(peaks.cpu==37&&peaks.dmaQueue==5&&peaks.dmaBytes==1234&&peaks.sprites==12&&peaks.vdpSprites==31&&peaks.vramLowest==96&&peaks.frames==3);
 retroDebugLinePerformance(line,&full,&peaks);assert(!strcmp(line,"CPU 20% MAX 37% FPS 60 DMA 1/1234B"));
 retroDebugLineMemory(line,&full,"A1B2");assert(!strcmp(line,"#A1B2 VRAM 100/128 BLK 64 SPR 12<=31"));
 full.measured=RETRO_DEBUG_FPS|RETRO_DEBUG_SPRITES;retroDebugLinePerformance(line,&full,&peaks);assert(!strcmp(line,"CPU -- FPS 60 DMA --"));
 retroDebugLineMemory(line,&full,"");assert(!strcmp(line,"VRAM -- SPR 12<=31"));
 /* Subject: state, animation:frame, position; velocity in pixels with two decimals; contacts in hex. */
 retroDebugLineSubject(line,&hero);assert(!strcmp(line,"ST 3 AN 2:1 X -12 Y 176"));
 retroDebugLineMotion(line,&hero);assert(!strcmp(line,"VX -1.50 VY 2.50 CT 0005"));
 hero.velocityX=1;hero.velocityY=-255;retroDebugLineMotion(line,&hero);assert(!strcmp(line,"VX 0.00 VY -0.99 CT 0005"));
 /* Extremes never overflow a line, and a field that does not fit is dropped whole:
  * a number cut in the middle would be another value shown as measured. */
 n=retroDebugLinePerformance(line,&worst,&peaks);assert(n<RETRO_DEBUG_LINE&&line[n]==0&&line[RETRO_DEBUG_LINE]=='#');
 assert(!strcmp(line,"CPU 65535% MAX 37% FPS 65535>")); /* the DMA field did not fit */
 n=retroDebugLineMemory(line,&worst,"A1ED2F");assert(n<RETRO_DEBUG_LINE&&!strcmp(line,"#A1ED2F VRAM 65535/65535 BLK 65535>")); /* identifier first, never cut */
 {RetroDebugSample big=full;big.measured=RETRO_DEBUG_VRAM|RETRO_DEBUG_SPRITES;big.vramFree=1000;big.vramTotal=1536;big.vramLargest=900;
  retroDebugLineMemory(line,&big,"A1ED2F");assert(!strcmp(line,"#A1ED2F VRAM 1000/1536 BLK 900>"));} /* the sprite field did not fit and is marked, not shortened */
 n=retroDebugLineSubject(line,&far);assert(n<RETRO_DEBUG_LINE&&!strcmp(line,"ST 65535 AN 65535:65535 X -32768>")); /* Y left out, not shortened */
 n=retroDebugLineMotion(line,&far);assert(n<RETRO_DEBUG_LINE&&!strcmp(line,"VX -8388608.00 VY 8388607.99 CT FFFF"));
 n=retroDebugLineMemory(line,&none,"0123456789ABCDEF0123456789ABCDEF0123456789");assert(!strcmp(line,">")&&n==1); /* an identifier that cannot fit is not shown in part */
 assert(!retroDebugLinePerformance(0,&full,0)&&!retroDebugLineSubject(line,0)&&line[0]==0);
 retroDebugPeaksReset(0);retroDebugPeaksUpdate(0,&full);retroDebugPeaksUpdate(&peaks,0);
 /* Transport record: unmeasured fields are omitted. */
 hero.velocityX=-384;hero.velocityY=640;full.measured=RETRO_DEBUG_CPU|RETRO_DEBUG_FPS|RETRO_DEBUG_DMA|RETRO_DEBUG_VRAM|RETRO_DEBUG_SPRITES;
 n=retroDebugRecord(record,sizeof(record),"A1B2",1234567,&full,&hero);puts(record);assert(n==strlen(record));
 retroDebugRecord(record,sizeof(record),"A1B2",7,&none,&hero);puts(record);
 retroDebugRecord(record,sizeof(record),0,8,&full,0);puts(record);
 retroDebugRecord(record,sizeof(record),"X",9,0,0);puts(record);
 retroDebugRecord(record,sizeof(record),"A1B2",4294967295u,&worst,&far);puts(record);
 /* A record that does not fit is not produced at all. */
 memset(tiny,'#',sizeof(tiny));n=retroDebugRecord(tiny,12,"A1B2",1,&full,&hero);assert(n==0&&tiny[0]==0&&tiny[12]=='#');
 assert(!retroDebugRecord(tiny,4,"A",1,&full,&hero)&&!retroDebugRecord(0,64,"A",1,&full,&hero));
 {char exact[128];n=retroDebugRecord(exact,sizeof(exact),"A1ED2F",1234567,&worst,&hero);assert(n==0||exact[n-1]==';');}
 return 0;
}
`)
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I'+path.join(library,'core'),'-I'+path.join(library,'debug')]
 const built=spawnSync('cc',[...flags,fixture,path.join(library,'debug/retro_debug.c'),'-o',binary],{encoding:'utf8'});assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8'});assert.equal(ran.status,0,ran.stdout+ran.stderr)
 // The IDE-side reader understands exactly what the ROM writes.
 const lines=ran.stdout.trim().split('\n')
 assert.deepEqual(parseDebugRecord(lines[0]),{build:'A1B2',frame:1234567,cpu:20,fps:60,dma:{queue:1,bytes:1234},vram:{free:100,largest:64,total:128},sprites:{engine:12,hardware:31},state:3,animation:{id:2,frame:1},x:-12,y:176,velocityX:-1.5,velocityY:2.5,contacts:5})
 const unmeasured=parseDebugRecord(lines[1]);assert.deepEqual(Object.keys(unmeasured),['build','frame','state','animation','x','y','velocityX','velocityY','contacts'],'unmeasured values are absent, not zero')
 assert.deepEqual(parseDebugRecord(lines[2]),{build:'',frame:8,cpu:20,fps:60,dma:{queue:1,bytes:1234},vram:{free:100,largest:64,total:128},sprites:{engine:12,hardware:31}})
 assert.deepEqual(parseDebugRecord(lines[3]),{build:'X',frame:9})
 assert.equal(parseDebugRecord(lines[4]).frame,4294967295);assert.equal(parseDebugRecord(lines[4]).velocityY,2147483647/256)
 // A cut record (no terminator) is rejected whole, never read with a shortened number.
 assert.equal(parseDebugRecord(lines[0].replace(/ ;$/,'')),null);assert.equal(parseDebugRecord(lines[0].slice(0,-6)),null)
 for(const text of ['','hello','RSD2 b=A f=1 ;','RSD1 b=A f=x ;','RSD1 b=A f=1 cpu=abc ;','RSD1 b=A f=1 dma=1 ;','RSD1 b=A f=1 zz=1 ;','RSD1 b=A f=1 ct=12 ;','RSD1 b=A f=1 cpu=-5 ;','RSD1 b=A f=1 x=1=2 ;','RSD1 b=A f=1 x=1 x=2 ;','RSD1 b=A f=1 cpu=20'])assert.equal(parseDebugRecord(text),null,text)
 assert.equal(parseDebugRecord('[kdebug] '+lines[0]).cpu,20,'an emulator prefix before the record is accepted')
 assert.deepEqual(collectDebugRecords(ran.stdout+'\nnoise\nRSD1 b=OTHER f=1 cpu=99 ;\n','A1B2').map(record=>record.frame).slice(0,2),[1234567,7],'records of another build are never mixed in')
 assert.throws(()=>collectDebugRecords(ran.stdout,''),/required/)
 const cross=process.argv.indexOf('--m68k-cc')
 if(cross>=0){
  const object=path.join(temporary,'debug.o')
  const compiled=spawnSync(process.argv[cross+1],['-m68000','-std=c99','-Wall','-Wextra','-Werror','-O2','-I'+path.join(library,'core'),'-c',path.join(library,'debug/retro_debug.c'),'-o',object],{encoding:'utf8'})
  assert.equal(compiled.status,0,compiled.stderr);console.log('PASS debug module compiled for 68000 ('+fs.statSync(object).size+' bytes object)')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime debug: unmeasured values shown as --, peaks, subject and motion lines, bounded text, transport records and IDE reader passed.')
