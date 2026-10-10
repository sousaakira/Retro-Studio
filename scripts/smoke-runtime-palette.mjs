// #57: ciclos e fades de paleta no host; paridade C/JS para a prévia do editor.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createPaletteRuntime} from '../shared/retro/paletteRuntime.js'
import {PALETTE_STATE_BYTES} from '../shared/retro/paletteConfiguration.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-palette-'))
const library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
try{
 let seed=0x9A1E77
 const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*n)}
 const base=Array.from({length:64},()=>(random(8)<<1)|(random(8)<<5)|(random(8)<<9))
 const cycles=[{first:1,count:15,frames:1,backward:0},{first:17,count:2,frames:3,backward:1},{first:36,count:5,frames:7,backward:0},{first:40,count:8,frames:2,backward:1},{first:50,count:14,frames:255,backward:0}]
 // Operações: 0 tick, 1 ciclo liga/desliga, 2 fade, 3 brilho direto, 4 troca de paleta, 5 enviado.
 const trace=Array.from({length:6000},()=>{const kind=random(20);return kind<12?[0,0,0,0]:kind<14?[1,random(6),random(2),0]:kind<16?[2,random(16),random(40),random(2)]:kind<17?[3,random(16),random(300),0]:kind<18?[4,random(5),random(4096),0]:[5,0,0,0]})
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "retro_palette.h"
static const uint16_t base[64]={${base.join(',')}};
static const RetroPaletteCycle cycles[]={${cycles.map(c=>'{'+[c.first,c.count,c.frames,c.backward]+'}').join(',')}};
static const int trace[][4]={${trace.map(row=>'{'+row+'}').join(',')}};
static uint32_t sum(const RetroPalette *p){uint32_t s=0;unsigned i;for(i=0;i<64;i++)s=s*31u+p->colors[i];return s;}
int main(void){
 RetroPalette p;unsigned i,k;uint16_t set[16];
 static const RetroPaletteCycle zero[]={{16,4,1,0}},wide[]={{14,3,1,0}},one[]={{1,1,1,0}},still[]={{1,4,0,0}},far[]={{65,2,1,0}},dir[]={{1,4,1,2}},wrap[]={{1,255,1,0}},wrap2[]={{2,254,1,0}};
 static const RetroPaletteCycle water[]={{1,3,2,0}};
 static const uint16_t bars[64]={0,0x00E,0x0E0,0xE00,0x0EE,0,0,0,0,0,0,0,0,0,0,0, 0x222,0xEEE,0x888,0,0,0,0,0,0,0,0,0,0,0,0,0x246};
 RetroPaletteFade out={3,4,1},in={1,4,0},instant={2,0,1},none={0,4,1};
 memset(&p,0,sizeof(p));
 /* Contract. */
 assert(!retroPaletteInit(0,base,cycles,5)&&!retroPaletteInit(&p,0,cycles,5)&&!retroPaletteInit(&p,base,0,1)&&!retroPaletteInit(&p,base,cycles,9));
 assert(!retroPaletteInit(&p,base,zero,1)&&!retroPaletteInit(&p,base,wide,1)&&!retroPaletteInit(&p,base,one,1)&&!retroPaletteInit(&p,base,still,1)&&!retroPaletteInit(&p,base,far,1)&&!retroPaletteInit(&p,base,dir,1)&&!p.ready);
 assert(!retroPaletteInit(&p,base,wrap,1)&&!retroPaletteInit(&p,base,wrap2,1)); /* count must not wrap an 8-bit sum */
 assert(!retroPaletteTick(&p)&&!retroPaletteFading(&p));retroPaletteCycleEnable(&p,0,1);retroPaletteFadeStart(&p,&out);retroPaletteSet(&p,0,bars);retroPaletteBrightness(&p,15,0);retroPaletteSent(0);
 assert(retroPaletteInit(&p,bars,water,1)&&p.ready&&p.dirtyFirst==0&&p.dirtyLast==63);
 /* First tick: everything must be sent once, nothing has moved yet. */
 assert(retroPaletteTick(&p)&&p.colors[1]==0x00E&&p.colors[31]==0x246);retroPaletteSent(&p);
 assert(!retroPaletteTick(&p));
 /* A cycle rotates only its range, at its own pace, and leaves color 0 alone. */
 retroPaletteCycleEnable(&p,0,1);
 assert(!retroPaletteTick(&p));
 assert(retroPaletteTick(&p)&&p.dirtyFirst==1&&p.dirtyLast==3&&p.colors[1]==0xE00&&p.colors[2]==0x00E&&p.colors[3]==0x0E0&&p.colors[0]==0&&p.colors[4]==0x0EE);
 retroPaletteSent(&p);retroPaletteTick(&p);retroPaletteTick(&p);retroPaletteSent(&p);retroPaletteTick(&p);retroPaletteTick(&p);
 assert(p.colors[1]==0x00E&&p.colors[2]==0x0E0&&p.colors[3]==0xE00);              /* three steps: back to the start */
 retroPaletteCycleEnable(&p,0,0);retroPaletteSent(&p);
 for(i=0;i<10;i++)assert(!retroPaletteTick(&p));
 retroPaletteCycleEnable(&p,7,1);assert(!p.active);                                  /* unknown cycle ignored */
 /* Fade out of palettes 0 and 1 in 4 frames: monotonic, ends in black, palette 2/3 untouched. */
 retroPaletteFadeStart(&p,&none);assert(!retroPaletteFading(&p));
 retroPaletteFadeStart(&p,&out);assert(retroPaletteFading(&p));
 {uint16_t previous=7;for(i=0;i<4;i++){uint16_t red;assert(retroPaletteFading(&p));retroPaletteTick(&p);red=(uint16_t)((p.colors[1]>>1)&7);assert(red<=previous);previous=red;}}
 assert(!retroPaletteFading(&p)&&p.colors[1]==0&&p.colors[17]==0&&p.colors[31]==0&&p.bright[0]==0&&p.bright[2]==256);
 retroPaletteSent(&p);assert(!retroPaletteTick(&p));
 /* While black, new colors are accepted but stay black until the fade in. */
 for(i=0;i<16;i++)set[i]=0x0EEE;
 retroPaletteSet(&p,0,set);assert(p.colors[5]==0&&p.logical[5]==0x0EEE);
 retroPaletteFadeStart(&p,&in);
 retroPaletteTick(&p);assert(p.colors[5]==0x0444);retroPaletteTick(&p);assert(p.colors[5]==0x0888); /* 7*64/256 and 7*128/256, rounded */retroPaletteTick(&p);retroPaletteTick(&p);
 assert(p.colors[5]==0x0EEE&&!retroPaletteFading(&p)&&p.colors[17]==0);         /* palette 1 was not in this fade */
 retroPaletteFadeStart(&p,&instant);assert(!retroPaletteFading(&p)&&p.bright[1]==0);
 retroPaletteBrightness(&p,2,999);assert(p.bright[1]==256&&p.colors[17]==0x0EEE);
 retroPaletteSet(&p,4,set);retroPaletteSet(&p,0,0);
 /* A fade starts from the brightness each palette has: interrupting one continues smoothly,
  * palettes left out keep what they had reached, and fading out from black stays black. */
 {RetroPaletteFade both={3,8,1},back={1,8,0},again={1,8,1};uint16_t middle;
  retroPaletteBrightness(&p,3,256);retroPaletteFadeStart(&p,&both);for(i=0;i<4;i++){retroPaletteTick(&p);}
  middle=p.bright[0];assert(middle==128&&p.bright[1]==128);
  retroPaletteFadeStart(&p,&back);retroPaletteTick(&p);assert(p.bright[0]>=middle&&p.bright[0]<=middle+16);   /* no jump down */
  for(i=0;i<7;i++){retroPaletteTick(&p);}
  assert(p.bright[0]==256&&p.bright[1]==128&&!retroPaletteFading(&p));
  retroPaletteBrightness(&p,1,0);retroPaletteSent(&p);retroPaletteFadeStart(&p,&again);
  for(i=0;i<8;i++){retroPaletteTick(&p);assert(p.bright[0]==0&&p.colors[5]==0);}
  assert(p.dirtyFirst>p.dirtyLast);retroPaletteBrightness(&p,3,256);}
 /* A long fade writes only when a visible level changes. */
 {RetroPaletteFade slow={1,200,1};unsigned writes=0;retroPaletteSent(&p);retroPaletteFadeStart(&p,&slow);for(i=0;i<200;i++){if(retroPaletteTick(&p))writes++;retroPaletteSent(&p);}assert(writes==7&&p.colors[5]==0);printf("slow fade writes %u\\n",writes);}
 /* Parity trace with the JS preview. */
 assert(retroPaletteInit(&p,base,cycles,5));
 for(i=0;i<sizeof(trace)/sizeof(trace[0]);i++){
  const int *t=trace[i];int changed=-1;
  if(t[0]==0)changed=retroPaletteTick(&p);
  else if(t[0]==1)retroPaletteCycleEnable(&p,(uint8_t)t[1],(uint8_t)t[2]);
  else if(t[0]==2){RetroPaletteFade f;f.mask=(uint8_t)t[1];f.frames=(uint8_t)t[2];f.out=(uint8_t)t[3];retroPaletteFadeStart(&p,&f);}
  else if(t[0]==3)retroPaletteBrightness(&p,(uint8_t)t[1],(uint16_t)t[2]);
  else if(t[0]==4){for(k=0;k<16;k++)set[k]=(uint16_t)((t[2]*(k+1))&0xFFFF);retroPaletteSet(&p,(uint8_t)t[1],set);}
  else retroPaletteSent(&p);
  printf("%d %lu %u %u %u\\n",changed,(unsigned long)sum(&p),p.dirtyFirst,p.dirtyLast,retroPaletteFading(&p));
 }
 return 0;
}
`)
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-pedantic','-fsanitize=address,undefined','-fno-sanitize-recover=all','-I'+path.join(library,'core'),'-I'+path.join(library,'palette')]
 const built=spawnSync('cc',[...flags,fixture,path.join(library,'palette/retro_palette.c'),'-o',binary],{encoding:'utf8'});assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(ran.status,0,String(ran.signal)+' '+ran.stdout.slice(-200)+ran.stderr.slice(0,1500))
 const lines=ran.stdout.trim().split('\n');assert.equal(lines.shift(),'slow fade writes 7')
 // JS: mesma sequência, mesmo estado depois de cada operação.
 assert.equal(createPaletteRuntime(base,[{first:16,count:4,frames:1,backward:0}]),null);assert.equal(createPaletteRuntime(base.slice(1),[]),null);assert.equal(createPaletteRuntime(base,[{first:14,count:3,frames:1,backward:0}]),null)
 const runtime=createPaletteRuntime(base,cycles),sum=()=>runtime.state.colors.reduce((s,c)=>(Math.imul(s,31)+c)>>>0,0)
 trace.forEach((t,i)=>{
  let changed=-1
  if(t[0]===0)changed=runtime.tick()?1:0
  else if(t[0]===1)runtime.cycle(t[1],t[2])
  else if(t[0]===2)runtime.fade({mask:t[1],frames:t[2],out:t[3]})
  else if(t[0]===3)runtime.brightness(t[1],t[2])
  else if(t[0]===4)runtime.set(t[1],Array.from({length:16},(_,k)=>(t[2]*(k+1))&0xFFFF))
  else runtime.sent()
  assert.equal([changed,sum(),runtime.state.dirtyFirst,runtime.state.dirtyLast,runtime.fading()?1:0].join(' '),lines[i],'passo '+i+' ('+t+')')
 })
 const cross=process.argv.indexOf('--m68k-cc')
 if(cross>=0){
  const object=path.join(temporary,'palette.o')
  const compiled=spawnSync(process.argv[cross+1],['-m68000','-std=c99','-Wall','-Wextra','-Werror','-O2','-I'+path.join(library,'core'),'-c',path.join(library,'palette/retro_palette.c'),'-o',object],{encoding:'utf8'})
  assert.equal(compiled.status,0,compiled.stderr);console.log('PASS palette module compiled for 68000 ('+fs.statSync(object).size+' bytes object)')
  // O custo mostrado no editor usa o tamanho real do estado no 68000.
  const probe=path.join(temporary,'probe.c');fs.writeFileSync(probe,'#include "retro_palette.h"\nchar probe[sizeof(RetroPalette)];\n')
  const probed=spawnSync(process.argv[cross+1],['-m68000','-std=c99','-I'+path.join(library,'core'),'-I'+path.join(library,'palette'),'-c',probe,'-o',path.join(temporary,'probe.o')],{encoding:'utf8'});assert.equal(probed.status,0,probed.stderr)
  const nm=spawnSync(process.argv[cross+1].replace(/gcc$/,'nm'),['-S',path.join(temporary,'probe.o')],{encoding:'utf8'})
  assert.equal(parseInt(nm.stdout.match(/([0-9a-f]+) [A-Za-z] probe/)[1],16),PALETTE_STATE_BYTES,'PALETTE_STATE_BYTES desatualizado')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime palette: contract, cycles (range, pace, direction), fades (monotonic, per palette, instant, sparse writes), palette swap and 6000-step C/JS parity passed.')
