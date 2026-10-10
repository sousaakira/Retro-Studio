// #58: same lab C/room/config on SGDK and in the browser; isolated fixtures.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {roomHeader} from './movement-lab-sources.mjs'
import {movementConfigurationStatus,saveMovementConfiguration} from '../electron/retro/movementConfiguration.js'
import {validateMovementConfiguration} from '../shared/retro/movementConfiguration.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
const repository=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-movement-diagnostic-'))
const argument=name=>{const i=process.argv.indexOf(name);if(i<0)return null;assert.ok(process.argv[i+1]&&!process.argv[i+1].startsWith('--'),'Missing '+name+' value');return process.argv[i+1]}
try{
 const root=path.join(temporary,'game'),stub=path.join(temporary,'stub')
 fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),root,{recursive:true})
 installRuntimeModules(root);installCutsceneRuntime(root)
 fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/runtime-movement-sgdk.c'),path.join(root,'src/main.c'))
 const configuration=movementConfigurationStatus(root)
 configuration.config.profiles.pal.walkSpeed=2
 configuration.config.profiles.pal.jumpSpeed=6
 saveMovementConfiguration(root,{config:configuration.config,revision:configuration.revision})
 const runtimeDirectory=path.join(root,'src/retro_runtime')
 fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/movement-lab.c'),path.join(runtimeDirectory,'movement-lab.inc'))
 fs.writeFileSync(path.join(runtimeDirectory,'movement-room-data.h'),roomHeader())
 fs.mkdirSync(stub)
 fs.writeFileSync(path.join(stub,'genesis.h'),`#ifndef TEST_GENESIS_H
#define TEST_GENESIS_H
#include <stdint.h>
typedef uint8_t u8;typedef uint16_t u16;typedef uint32_t u32;
typedef int16_t s16;typedef int32_t s32;typedef uint8_t bool;
typedef enum {CPU,DMA_QUEUE} TransferMethod;
typedef enum {BG_A,BG_B} VDPPlane;
#define TRUE 1
#define FALSE 0
#define PAL0 0
#define JOY_1 0
extern u8 testPal;
#define IS_PAL_SYSTEM testPal
#define BUTTON_UP 1
#define BUTTON_DOWN 2
#define BUTTON_LEFT 4
#define BUTTON_RIGHT 8
#define BUTTON_B 16
#define BUTTON_C 32
#define BUTTON_A 64
#define BUTTON_START 128
#define TILE_USER_INDEX 16
#define TILE_FONT_INDEX 1400
#define TILE_ATTR_FULL(p,pri,v,h,t) (t)
void VDP_setScreenWidth320(void);void VDP_setScreenHeight224(void);void JOY_init(void);void VDP_setEnable(bool enabled);
void PAL_setPalette(u16 number,const u16 *data,TransferMethod method);
void VDP_loadTileData(const u32 *data,u16 index,u16 num,TransferMethod method);
void VDP_fillTileMapRectInc(VDPPlane plane,u16 tile,u16 x,u16 y,u16 w,u16 h);
void VDP_drawTextBG(VDPPlane plane,const char *text,u16 x,u16 y);
void VDP_drawText(const char *text,u16 x,u16 y);
bool SYS_doVBlankProcess(void);u16 JOY_readJoypad(u16 joy);
#endif
`)
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <string.h>
#define main diagnosticMain
#include "main.c"
#undef main
u8 testPal;static u16 queued,loads,blanks;static u32 checksum[64];static const u32 *pointers[64];
void VDP_setScreenWidth320(void){}void VDP_setScreenHeight224(void){}void JOY_init(void){}void VDP_setEnable(bool enabled){(void)enabled;}
void PAL_setPalette(u16 number,const u16 *data,TransferMethod method){(void)number;(void)data;(void)method;}
void VDP_fillTileMapRectInc(VDPPlane plane,u16 tile,u16 x,u16 y,u16 w,u16 h){(void)plane;(void)tile;(void)x;(void)y;(void)w;(void)h;}
void VDP_drawTextBG(VDPPlane plane,const char *text,u16 x,u16 y){(void)plane;(void)text;assert(x+strlen(text)<=40&&y<5);}
void VDP_drawText(const char *text,u16 x,u16 y){VDP_drawTextBG(BG_B,text,x,y);}
u16 JOY_readJoypad(u16 joy){(void)joy;return 0;}
static u32 sum(const u32 *data){u16 i;u32 result=0;for(i=0;i<8;i++)result^=data[i];return result;}
void VDP_loadTileData(const u32 *data,u16 index,u16 num,TransferMethod method){
 assert(method==DMA_QUEUE&&num==1&&queued<64&&index>=TILE_USER_INDEX&&index<TILE_USER_INDEX+CANVAS_TILES);
 assert(data==&canvas[(index-TILE_USER_INDEX)*8]);pointers[queued]=data;checksum[queued++]=sum(data);loads++;
}
bool SYS_doVBlankProcess(void){u16 i;for(i=0;i<queued;i++)assert(sum(pointers[i])==checksum[i]);queued=0;blanks++;return TRUE;}
static void reset(void){resetDiagnostic();memset(&input,0,sizeof(input));}
static u8 pixel(s32 x,s32 y){u16 tile=(u16)((y/8-5)*40+x/8);return (u8)((canvas[tile*8+y%8]>>(28-x%8*4))&15);}
int main(void){
 u16 i;char value[11];s32 height,distance,duration;
 testPal=0;reset();assert(labConfig.walkSpeed==384&&labConfig.jumpSpeed==1280);
 stepDiagnostic(BUTTON_B);assert(labPlayer.body.y==155*256&&movementLabRead(9));
 for(i=0;i<80&&!labPlayer.grounded;i++)stepDiagnostic(BUTTON_B);
 assert(movementLabRead(12)==52*256+128&&movementLabRead(14)==41&&movementLabRead(13)==0);
 height=movementLabRead(12);distance=movementLabRead(13);duration=movementLabRead(14);
 for(i=0;i<5;i++)stepDiagnostic(BUTTON_RIGHT);
 assert(labPlayer.body.x>48*256&&movementLabRead(12)==height&&movementLabRead(13)==distance&&movementLabRead(14)==duration);
 stepDiagnostic(BUTTON_START);assert(labPlayer.body.x==48*256&&movementLabRead(11)==0&&trailCount==0);
 stepDiagnostic(BUTTON_START);assert(movementLabRead(11)==1); /* reset uses an edge */
 testPal=1;reset();assert(labConfig.walkSpeed==512&&labConfig.jumpSpeed==1536);
 stepDiagnostic(BUTTON_B);assert(labPlayer.body.y==154*256);
 testPal=0;reset();labPlayer.body.x=28*256;labPlayer.body.y=80*256;labPlayer.velocityY=256;
 stepDiagnostic(BUTTON_LEFT);assert(labPlayer.sliding&&labPlayer.facing==0&&labPlayer.wall==-1);
 stepDiagnostic(BUTTON_B|BUTTON_LEFT);assert(labResult.jumped&&labPlayer.velocityX>0&&!labPlayer.sliding);
 reset();labPlayer.body.x=288*256;labPlayer.body.y=80*256;labPlayer.velocityY=256;
 stepDiagnostic(BUTTON_RIGHT);assert(labPlayer.sliding&&labPlayer.facing==1&&labPlayer.wall==1);
 reset();stepDiagnostic(BUTTON_C|BUTTON_RIGHT);assert(labResult.dashStarted&&labPlayer.velocityX==1024);
 stepDiagnostic(BUTTON_C|BUTTON_LEFT);assert(labPlayer.velocityX==1024&&!labResult.dashStarted);
 reset();labPlayer.body.x=80*256;labPlayer.body.y=100*256;labPlayer.velocityY=7*256;
 for(i=0;i<8&&!labPlayer.grounded;i++)stepDiagnostic(0);
 assert(labPlayer.grounded&&labPlayer.body.y==120*256);
 stepDiagnostic(BUTTON_DOWN);assert(!labPlayer.grounded&&labPlayer.body.y>120*256);
 reset();labPlayer.body.x=124*256;stepDiagnostic(BUTTON_C|BUTTON_RIGHT);
 assert(labPlayer.grounded&&labPlayer.body.x==128*256&&labPlayer.body.y==160*256);
 stepDiagnostic(BUTTON_RIGHT);assert(labPlayer.grounded&&labPlayer.body.y<160*256);
 reset();renderDiagnostic();assert(pixel(40,128)==2&&pixel(16,80)==1&&pixel(64,120)==8&&pixel(159,144)==7);
 for(i=0;i<520;i++){stepDiagnostic(BUTTON_RIGHT);renderDiagnostic();}
 assert(trailCount==TRAIL_LENGTH&&trailNext<TRAIL_LENGTH);
 drawHud();number(-1280,1,value);assert(!strcmp(value,"-00005.000"));number(52*256+128,1,value);assert(!strcmp(value,"+00052.500"));
 number(65535,0,value);assert(!strcmp(value,"+65535"));
 movementLabReset();ticks=65535;stepDiagnostic(0);assert(labFailed);stepDiagnostic(BUTTON_START);assert(!labFailed&&ticks==0);
 memset(dirty,255,sizeof(dirty));flushDirty();assert(loads==CANVAS_TILES&&blanks==14&&queued==24);
 SYS_doVBlankProcess();assert(!queued&&blanks==15);
 for(i=0;i<sizeof(dirty);i++)assert(!dirty[i]);
 reset();renderDiagnostic();flushDirty();SYS_doVBlankProcess();
 /* Normal movement fits one bounded queue; reset may drain over extra VBlanks. */
 for(i=0;i<90;i++){u16 before=blanks;stepDiagnostic(i<40?BUTTON_B|BUTTON_RIGHT:BUTTON_LEFT);renderDiagnostic();drawHud();flushDirty();assert(blanks==before);SYS_doVBlankProcess();}
 return 0;
}
`)
 const runtime=path.join(root,'src/retro_runtime')
 const sources=['retro_core.c','retro_collision.c','retro_slopes.c','retro_movement.c'].map(name=>path.join(runtime,name))
 const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-I'+stub,'-I'+path.join(root,'src'),'-I'+runtime,fixture,...sources,'-o',binary],{encoding:'utf8'})
 assert.equal(compile.status,0,compile.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 const sdk=argument('--sgdk'),artifacts=argument('--artifacts')
 const configurationPath=argument('--configuration')
 assert.ok(!artifacts||sdk,'--artifacts requires --sgdk')
 assert.ok(!configurationPath||sdk,'--configuration requires --sgdk')
 if(sdk){
  if(configurationPath){
   const bytes=fs.readFileSync(configurationPath)
   assert.ok(bytes.length<=65536,'Movement configuration exceeds 64 KiB')
   const requested=JSON.parse(bytes.toString('utf8'));validateMovementConfiguration(requested)
   const current=movementConfigurationStatus(root)
   saveMovementConfiguration(root,{config:requested,revision:current.revision})
   assert.deepEqual(movementConfigurationStatus(root).config,requested)
  }
  const checked=spawnSync(path.join(sdk,'bin/m68k-elf-gcc'),['-m68000','-std=c99','-Os','-fno-builtin','-Wall','-Wextra','-Werror','-I'+path.join(sdk,'inc'),'-I'+path.join(sdk,'res'),'-I'+path.join(root,'src'),'-c',path.join(root,'src/main.c'),'-o',path.join(temporary,'diagnostic-m68k.o')],{encoding:'utf8'})
  assert.equal(checked.status,0,checked.stderr||checked.error?.message)
  const build=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],{cwd:root,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  assert.equal(build.status,0,build.stdout.slice(-4000)+build.stderr.slice(-4000))
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  if(artifacts){
   fs.mkdirSync(artifacts) // Refuse existing destination; don't overwrite unrelated files.
   fs.copyFileSync(path.join(root,'out/rom.bin'),path.join(artifacts,'movement-diagnostic.bin'))
   fs.copyFileSync(path.join(root,'src/main.c'),path.join(artifacts,'movement-diagnostic.c'))
   fs.copyFileSync(path.join(runtime,'movement-room-data.h'),path.join(artifacts,'movement-room-data.h'))
   fs.copyFileSync(path.join(runtime,'movement-lab.inc'),path.join(artifacts,'movement-lab.inc'))
   fs.copyFileSync(path.join(root,'physics/movement.json'),path.join(artifacts,'movement.json'))
   fs.copyFileSync(path.join(root,'src/generated/movement_config.h'),path.join(artifacts,'movement_config.h'))
  }
  console.log('PASS shared movement room diagnostic -> SGDK 68000 -> ROM ('+rom.length+' bytes)')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Movement diagnostic: canonical room/config, shared C metrics, PAL/NTSC, both walls, dash/drop/slopes, reset, pixels, bounded trajectory and stable DMA passed.')
