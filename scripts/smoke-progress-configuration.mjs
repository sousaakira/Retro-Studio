// #60: progress layout exported into the real C module, project isolation and build gate.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createProgressConfiguration,compileProgressHeader,validateProgressConfiguration,progressCompatibility,progressMemory} from '../shared/retro/progressConfiguration.js'
import {inspectProgressImage} from '../shared/retro/progressRecord.js'
import {progressConfigurationStatus,saveProgressConfiguration,validateProgressForBuild} from '../electron/retro/progressConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
const repository=fileURLToPath(new URL('../',import.meta.url))
const argument=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1]}
// Developer aid: decode an emulator .srm (SGDK stores bytes on odd addresses).
if(argument('--inspect-srm')){
 const raw=fs.readFileSync(argument('--inspect-srm')),image=new Uint8Array(raw.length>>1)
 for(let i=0;i<image.length;i++)image[i]=raw[i*2+1]
 const flip=argument('--damage-newest')
 const rows=inspectProgressImage(image,{offset:0,slots:Number(argument('--slots')||1)})
 console.log(JSON.stringify(rows.map(copies=>copies.map(copy=>copy.state==='valid'?{...copy,flags:[...copy.flags],data:[...copy.data]}:copy))))
 if(flip){
  const copies=rows[0],newest=copies[1].state==='valid'&&(copies[0].state!=='valid'||copies[1].sequence>copies[0].sequence)?1:0
  raw[(newest*128+20)*2+1]^=0x40;fs.writeFileSync(flip,raw)
 }
 process.exit(0)
}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-progress-config-'))
try{
 const root=path.join(temporary,'game'),other=path.join(temporary,'other')
 fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),root,{recursive:true})
 fs.mkdirSync(other);installRuntimeModules(root)
 for(const name of ['retro_progress.h','retro_progress.c','retro_progress_sgdk.h'])
  assert.ok(fs.statSync(path.join(root,'src/retro_runtime',name)).isFile(),'runtime installer distributes '+name)
 const original=fs.readFileSync(path.join(root,'src/main.c'),'utf8'),otherStatus=progressConfigurationStatus(other)
 assert.deepEqual(validateProgressForBuild(root),{configured:false},'projects without a progress source are never gated')
 let status=progressConfigurationStatus(root)
 assert.deepEqual(status.config,createProgressConfiguration());assert.ok(!status.headerConflict&&!status.exported)
 assert.equal(status.romHeaderDeclaresSram,true,'the skeleton ROM header declares SRAM');assert.equal(otherStatus.romHeaderDeclaresSram,null)
 // Validation of the authored layout.
 const config=structuredClone(status.config)
 config.flags=[{id:'key',name:'Chave',bit:0},{id:'boss',name:'Chefe derrotado',bit:1}]
 config.fields=[{id:'coins',name:'Moedas',offset:0,bytes:2},{id:'lives',name:'Vidas',offset:2,bytes:1}]
 const rejects=(change,pattern)=>{const copy=structuredClone(config);change(copy);assert.throws(()=>validateProgressConfiguration(copy),pattern)}
 rejects(c=>{c.version=2},/Unsupported/);rejects(c=>{c.schema=0},/schema/);rejects(c=>{c.flagCapacity=12},/multiple of 8/)
 rejects(c=>{c.flagCapacity=264},/flag capacity/);rejects(c=>{c.dataSize=65},/data size/)
 rejects(c=>{c.flags[1].bit=0},/used twice/);rejects(c=>{c.flags[1].id='key'},/duplicate/);rejects(c=>{c.flags[0].id='Key'},/Invalid/)
 rejects(c=>{c.flags[0].bit=32},/flag bit/);rejects(c=>{c.flagCapacity=0},/exceed/)
 rejects(c=>{c.fields[1].offset=1},/overlap/);rejects(c=>{c.fields[0].bytes=3},/1, 2 or 4/);rejects(c=>{c.fields[1].offset=16},/exceeds/)
 rejects(c=>{c.sram.slots=9},/slots/);rejects(c=>{c.sram.size=3000},/size/);rejects(c=>{c.sram.enabled=true;c.sram.size=512;c.sram.slots=3},/do not fit/)
 rejects(c=>{c.sram.enabled=true;c.sram.offset=8000},/do not fit/);rejects(c=>{c.history=[{schema:1,flagCapacity:8,dataSize:2}]},/older/)
 rejects(c=>{c.schema=3;c.history=[{schema:1,flagCapacity:8,dataSize:2},{schema:1,flagCapacity:8,dataSize:2}]},/distinct/)
 rejects(c=>{c.sram.enabled='yes'},/SRAM/)
 assert.deepEqual(progressMemory(config),{record:40,ram:100,stack:448,sram:0,firstByte:0,lastByte:255})
 // Without SRAM: exported, slots 0, the same game code works in RAM only.
 let saved=saveProgressConfiguration(root,{config,revision:status.revision})
 assert.ok(saved.exported);assert.equal(saved.success,true,'the editor relies on the receipt');assert.notEqual(saved.revision,status.revision);assert.deepEqual(saved.config,config)
 assert.deepEqual(progressConfigurationStatus(other),otherStatus);assert.equal(fs.readFileSync(path.join(root,'src/main.c'),'utf8'),original)
 const headerPath=path.join(root,'src/generated/progress_config.h')
 assert.match(fs.readFileSync(headerPath,'utf8'),/#define RETRO_PROJECT_PROGRESS_SLOTS 0\n/);assert.match(fs.readFileSync(headerPath,'utf8'),/Persistence disabled/)
 assert.throws(()=>saveProgressConfiguration(root,{config,revision:status.revision}),/changed/)
 assert.deepEqual(validateProgressForBuild(root),{configured:true,revision:saved.revision,schema:1,sram:false})
 // Stored meaning only changes together with the schema number.
 const moved=structuredClone(config);moved.flags[0].bit=5
 assert.throws(()=>saveProgressConfiguration(root,{config:moved,revision:saved.revision}),/flag moved/)
 const resized=structuredClone(config);resized.dataSize=8
 assert.throws(()=>saveProgressConfiguration(root,{config:resized,revision:saved.revision}),/new schema version/)
 const shifted=structuredClone(config);shifted.fields[1].offset=4
 assert.throws(()=>saveProgressConfiguration(root,{config:shifted,revision:saved.revision}),/field moved/)
 const next=structuredClone(config);Object.assign(next,{schema:2,flagCapacity:16,dataSize:4});next.sram={enabled:true,slots:2,offset:0,size:8192}
 assert.throws(()=>saveProgressConfiguration(root,{config:next,revision:saved.revision}),/missing from the history/)
 next.history=[{schema:1,flagCapacity:32,dataSize:16}]
 // Adding flags/fields inside the reserved space keeps the schema.
 const grown=structuredClone(config);grown.flags.push({id:'door',name:'Porta',bit:2});grown.fields.push({id:'score',name:'Pontos',offset:4,bytes:4})
 saved=saveProgressConfiguration(root,{config:grown,revision:saved.revision})
 next.flags=grown.flags;next.fields=grown.fields.slice(0,2)
 saved=saveProgressConfiguration(root,{config:next,revision:saved.revision})
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'progress/progress.json'),'utf8')),next)
 // Slot addresses are part of what is stored: moving or removing them needs an explicit choice.
 const movedSlots=structuredClone(next);movedSlots.sram.offset=128
 assert.throws(()=>saveProgressConfiguration(root,{config:movedSlots,revision:saved.revision}),/offset changed/)
 const fewer=structuredClone(next);fewer.sram.slots=1;assert.throws(()=>saveProgressConfiguration(root,{config:fewer,revision:saved.revision}),/slots were removed/)
 progressCompatibility(next,movedSlots,{allowMovedSlots:true});const more=structuredClone(next);more.sram.slots=3;progressCompatibility(next,more)
 const off=structuredClone(next);off.sram={enabled:false,slots:8,offset:0,size:512};validateProgressConfiguration(off);progressCompatibility(next,off)
 const back=structuredClone(next);back.schema=1;back.history=[];assert.throws(()=>progressCompatibility(next,back),/cannot go back/)
 const dropped=structuredClone(next);dropped.schema=3;dropped.history=[{schema:2,flagCapacity:16,dataSize:4}]
 assert.throws(()=>saveProgressConfiguration(root,{config:dropped,revision:saved.revision}),/lost schema 1/)
 progressCompatibility(next,dropped,{allowDroppedSchemas:true})
 const header=fs.readFileSync(headerPath,'utf8')
 assert.equal(header,compileProgressHeader(next))
 for(const text of ['#define RETRO_PROJECT_PROGRESS_SCHEMA 2','0x200001-0x203FFF','#define RETRO_PROJECT_PROGRESS_SRAM_BYTES 8192','#define RETRO_PROJECT_PROGRESS_SLOTS 2',
  '#define RETRO_PROJECT_PROGRESS_FLAG_KEY 0','#define RETRO_PROJECT_PROGRESS_FLAG_DOOR 2','#define RETRO_PROJECT_PROGRESS_FIELD_COINS_OFFSET 0','#define RETRO_PROJECT_PROGRESS_FIELD_LIVES_BYTES 1',
  'retroProjectProgressHistory[]={{1,32,16}};','retroProjectProgress={{2,16,4},retroProjectProgressHistory,1,2,0};'])assert.ok(header.includes(text),text)
 assert.deepEqual(progressMemory(next),{record:26,ram:100,stack:448,sram:512,firstByte:0,lastByte:511})
 // Exported header -> distributed C module (host storage).
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <string.h>
#include "generated/progress_config.h"
static uint8_t memory[RETRO_PROJECT_PROGRESS_SRAM_BYTES];
static uint8_t readBytes(void *c,uint16_t o,uint8_t *b,uint16_t n){(void)c;memcpy(b,memory+o,n);return 1;}
static uint8_t writeBytes(void *c,uint16_t o,const uint8_t *b,uint16_t n){(void)c;memcpy(memory+o,b,n);return 1;}
int main(void){
 RetroProgressStorage s={readBytes,writeBytes,0,sizeof(memory)};RetroProgress p,q;RetroProgressInfo info;uint32_t v;
 RetroProgressConfig old={{1,32,16},0,0,2,0};
 memset(memory,0xFF,sizeof(memory));
 assert(retroProgressValidate(&retroProjectProgress)&&retroProjectProgress.slots==RETRO_PROJECT_PROGRESS_SLOTS);
 assert(retroProgressNew(&p,&retroProjectProgress)&&retroProgressLoad(&p,&retroProjectProgress,&s,1,0)==RETRO_PROGRESS_EMPTY);
 assert(retroProgressSetFlag(&p,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FLAG_BOSS,1));
 assert(retroProgressWrite(&p,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FIELD_COINS_OFFSET,RETRO_PROJECT_PROGRESS_FIELD_COINS_BYTES,999));
 p.room=5;p.checkpoint=6;
 assert(retroProgressSave(&p,&retroProjectProgress,&s,1)==RETRO_PROGRESS_OK);
 assert(retroProgressLoad(&q,&retroProjectProgress,&s,1,&info)==RETRO_PROGRESS_OK&&!memcmp(&p,&q,sizeof(p))&&info.schema==RETRO_PROJECT_PROGRESS_SCHEMA);
 /* A save of the previous exported schema migrates through the generated history. */
 assert(retroProgressNew(&p,&old)&&retroProgressSetFlag(&p,&old,RETRO_PROJECT_PROGRESS_FLAG_KEY,1)&&retroProgressSetFlag(&p,&old,31,1));
 assert(retroProgressWrite(&p,&old,0,2,321)&&retroProgressWrite(&p,&old,12,4,7)&&retroProgressSave(&p,&old,&s,0)==RETRO_PROGRESS_OK);
 assert(retroProgressLoad(&q,&retroProjectProgress,&s,0,&info)==RETRO_PROGRESS_OK&&info.migrated&&info.schema==1);
 assert(retroProgressFlag(&q,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FLAG_KEY)&&q.flags[3]==0);
 assert(retroProgressRead(&q,&retroProjectProgress,RETRO_PROJECT_PROGRESS_FIELD_COINS_OFFSET,2,&v)&&v==321);
 return 0;
}
`)
 const runtime=path.join(root,'src/retro_runtime')
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I'+path.join(root,'src'),'-I'+runtime]
 const built=spawnSync('cc',[...flags,fixture,path.join(runtime,'retro_progress.c'),'-o',binary],{encoding:'utf8'});assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8'});assert.equal(ran.status,0,ran.stderr)
 const sdk=argument('--sgdk')
 if(sdk){
  const game=path.join(temporary,'rom')
  fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),game,{recursive:true});installRuntimeModules(game);installCutsceneRuntime(game)
  const lab=structuredClone(next);lab.history=[{schema:1,flagCapacity:8,dataSize:2}];lab.fields=next.fields
  saveProgressConfiguration(game,{config:lab,revision:progressConfigurationStatus(game).revision})
  assert.equal(validateProgressForBuild(game).sram,true)
  fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/progress-diagnostic.c'),path.join(game,'src/main.c'))
  const sdkBuild=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],{cwd:game,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  assert.equal(sdkBuild.status,0,sdkBuild.stdout.slice(-4000)+sdkBuild.stderr.slice(-4000))
  const rom=fs.readFileSync(path.join(game,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  assert.equal(rom.subarray(0x1B0,0x1B2).toString(),'RA','ROM header declares SRAM');assert.equal(rom.readUInt32BE(0x1B4),0x200000)
  if(argument('--keep-rom'))fs.copyFileSync(path.join(game,'out/rom.bin'),argument('--keep-rom'))
  console.log('PASS exported progress -> shared progress C + SGDK SRAM adapter -> SGDK ROM ('+rom.length+' bytes)')
 }
 // SRAM enabled but a project ROM header without "RA" is refused before the build.
 const romHead=path.join(root,'src/boot/rom_head.c'),headSource=fs.readFileSync(romHead,'utf8')
 fs.writeFileSync(romHead,headSource.replace('"RA"','"  "')+'\n// "RA" only in a comment\n')
 assert.equal(progressConfigurationStatus(root).romHeaderDeclaresSram,false);assert.throws(()=>validateProgressForBuild(root),/não declara "RA"/)
 // The check is textual but string-aware; unusual sources are unknown, never an error.
 for(const text of ['const char s[]={"http://x", "RA"};','{\'R\',\'A\'}','"R" "A"']){fs.writeFileSync(romHead,text);assert.equal(progressConfigurationStatus(root).romHeaderDeclaresSram,true,text)}
 fs.writeFileSync(romHead,'/* "RA" */ "  "');assert.equal(progressConfigurationStatus(root).romHeaderDeclaresSram,false)
 fs.rmSync(romHead);fs.symlinkSync(path.join(root,'src/main.c'),romHead);assert.equal(progressConfigurationStatus(root).romHeaderDeclaresSram,null);assert.equal(validateProgressForBuild(root).configured,true)
 fs.rmSync(romHead)
 fs.writeFileSync(romHead,headSource);assert.equal(validateProgressForBuild(root).configured,true)
 // Stale source and customized header are both reported; nothing is overwritten.
 const edited=structuredClone(next);edited.flags.push({id:'late',name:'Tardia',bit:9})
 fs.writeFileSync(path.join(root,'progress/progress.json'),JSON.stringify(edited))
 assert.throws(()=>validateProgressForBuild(root),/mudou/)
 fs.writeFileSync(path.join(root,'progress/progress.json'),JSON.stringify(next,null,2)+'\n')
 fs.appendFileSync(headerPath,'/* manual change */')
 assert.ok(progressConfigurationStatus(root).headerConflict);assert.throws(()=>validateProgressForBuild(root),/personalizado/)
 assert.throws(()=>saveProgressConfiguration(root,{config:next,revision:progressConfigurationStatus(root).revision}),/customized/)
 assert.ok(fs.readFileSync(headerPath,'utf8').endsWith('/* manual change */'))
 for(const text of ['null','{not json']){
  fs.writeFileSync(path.join(root,'.retrostudio/progress-export.json'),text)
  assert.throws(()=>progressConfigurationStatus(root),/Unsupported progress export record/)
 }
 fs.writeFileSync(path.join(root,'progress/progress.json'),'{"version":99}')
 assert.throws(()=>progressConfigurationStatus(root),/Unsupported/)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Progress configuration: layout validation, schema discipline, history, no-SRAM export, project isolation, transactional source/header, build gate, ROM header check, conflicts and shared C passed.')
