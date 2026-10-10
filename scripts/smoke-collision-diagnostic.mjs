// #44/#49: test the actual diagnostic fixture; never touch a user's game.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
const repository=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-collision-diagnostic-'))
const argument=name=>{const i=process.argv.indexOf(name);if(i<0)return null;assert.ok(process.argv[i+1]&&!process.argv[i+1].startsWith('--'),'Missing '+name+' value');return process.argv[i+1]}
try{
 const root=path.join(temporary,'game'),stub=path.join(temporary,'stub')
 fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),root,{recursive:true})
 installRuntimeModules(root);installCutsceneRuntime(root)
 fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/runtime-collision-sgdk.c'),path.join(root,'src/main.c'))
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
void VDP_setScreenWidth320(void);void JOY_init(void);void VDP_setEnable(bool enabled);
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
static u16 queued,loads,blanks;static u32 checksum[64];static const u32 *pointers[64];
void VDP_setScreenWidth320(void){}void JOY_init(void){}void VDP_setEnable(bool enabled){(void)enabled;}
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
static void tick(u16 keys){stepDiagnostic(keys);finishDiagnostic();}
static u8 pixel(s32 x,s32 y){u16 tile=(u16)((y/8-5)*40+x/8);return (u8)((canvas[tile*8+y%8]>>(28-x%8*4))&15);}
int main(void){
 u16 i;reset();tick(0);assert(player.y==Q(160)&&grounded&&contacts==RETRO_CONTACT_FLOOR);
 player.x=Q(30);tick(BUTTON_LEFT|BUTTON_C);assert(player.x==Q(28)&&(contacts&RETRO_CONTACT_LEFT));
 tick(BUTTON_LEFT|BUTTON_C);assert(player.x==Q(28));
 reset();player.x=Q(280);tick(BUTTON_RIGHT|BUTTON_C);assert(player.x==Q(288)&&(contacts&RETRO_CONTACT_RIGHT));
 reset();player.x=Q(100);player.y=Q(130);velocityY=-Q(7);grounded=0;tick(0);
 assert(player.y==Q(128)&&velocityY==0&&(contacts&RETRO_CONTACT_CEILING));
 reset();tick(BUTTON_B);assert(player.y==Q(155)&&velocityY==-Q(5)&&!grounded);
 for(i=0;i<80&&!grounded;i++){tick(0);}assert(grounded&&player.y==Q(160));
 reset();player.x=Q(80);player.y=Q(100);grounded=0;velocityY=Q(7);
 for(i=0;i<8&&!grounded;i++){tick(0);}assert(grounded&&player.y==Q(120));
 tick(BUTTON_DOWN);assert(!grounded&&player.y>Q(120));
 for(i=0;i<40&&!grounded;i++){tick(0);}assert(grounded&&player.y==Q(160));
 reset();player.x=Q(124);tick(BUTTON_RIGHT|BUTTON_C);assert(player.x==Q(136)&&player.y==Q(156)&&grounded);
 reset();player.x=Q(212);stepDiagnostic(BUTTON_A);assert(target.health==6&&damageCalls==1&&target.invulnerable==30);
 renderDiagnostic();assert(oldAttack.x==220&&oldAttack.width==24);finishDiagnostic();
 for(i=0;i<6;i++){tick(BUTTON_A);}assert(target.health==6&&damageCalls==1&&!attack.running);
 tick(0);tick(BUTTON_A);assert(target.health==6&&damageCalls==1);
 for(i=0;i<40;i++){tick(0);}tick(BUTTON_A);assert(target.health==3&&damageCalls==2);
 for(i=0;i<40;i++){tick(0);}tick(BUTTON_A);assert(!target.health&&lastDamage==RETRO_DAMAGE_DEFEATED);
 reset();player.x=Q(256);tick(BUTTON_LEFT|BUTTON_A);renderDiagnostic();assert(facing&&oldAttack.x==222);
 stepDiagnostic(BUTTON_START);assert(player.x==Q(48)&&target.health==9&&!attack.running);
 player.x=Q(60);stepDiagnostic(BUTTON_START);assert(player.x==Q(60));
 memset(canvas,0,sizeof(canvas));memset(dirty,0,sizeof(dirty));
 point(-1,40,2);point(320,40,2);point(0,39,2);point(0,224,2);assert(!canvas[0]&&!dirty[0]);
 point(0,40,2);assert(canvas[0]==0x20000000&&dirty[0]==1);dirty[0]=0;point(0,40,2);assert(!dirty[0]);
 point(319,223,3);assert(pixel(319,223)==3);
 reset();memset(&oldBody,0,sizeof(oldBody));memset(&oldHurt,0,sizeof(oldHurt));memset(&oldAttack,0,sizeof(oldAttack));oldContacts=0;
 renderDiagnostic();assert(pixel(40,128)==2&&pixel(42,132)==3);
 tick(BUTTON_RIGHT);renderDiagnostic();assert(pixel(40,128)==0&&pixel(16,80)==1&&pixel(64,120)==8);
 assert(pixel(129,159)==7&&pixel(159,144)==7); /* Same Q8 surface as collision. */
 drawHud();velocityY=-Q(7);drawHud();
 memset(dirty,255,sizeof(dirty));flushDirty();assert(loads==CANVAS_TILES&&blanks==14&&queued==24);
 SYS_doVBlankProcess();assert(!queued&&blanks==15);
 for(i=0;i<sizeof(dirty);i++){assert(!dirty[i]);}flushDirty();assert(loads==CANVAS_TILES);
 return 0;
}
`)
 const runtime=path.join(root,'src/retro_runtime')
 const sources=['retro_core.c','retro_collision.c','retro_slopes.c','retro_combat.c'].map(name=>path.join(runtime,name))
 const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-I'+stub,'-I'+path.join(root,'src'),'-I'+runtime,fixture,...sources,'-o',binary],{encoding:'utf8'})
 assert.equal(compile.status,0,compile.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 const sdk=argument('--sgdk'),artifacts=argument('--artifacts')
 assert.ok(!artifacts||sdk,'--artifacts requires --sgdk')
 if(sdk){
  const checked=spawnSync(path.join(sdk,'bin/m68k-elf-gcc'),['-m68000','-std=c99','-Os','-fno-builtin','-Wall','-Wextra','-Werror','-I'+path.join(sdk,'inc'),'-I'+path.join(sdk,'res'),'-I'+path.join(root,'src'),'-c',path.join(root,'src/main.c'),'-o',path.join(temporary,'diagnostic-m68k.o')],{encoding:'utf8'})
  assert.equal(checked.status,0,checked.stderr||checked.error?.message)
  const build=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],{cwd:root,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  assert.equal(build.status,0,build.stdout.slice(-4000)+build.stderr.slice(-4000))
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  if(artifacts){
   fs.mkdirSync(artifacts) // Refuse existing destination; don't overwrite unrelated files.
   fs.copyFileSync(path.join(root,'out/rom.bin'),path.join(artifacts,'collision-diagnostic.bin'))
   fs.copyFileSync(path.join(root,'src/main.c'),path.join(artifacts,'collision-diagnostic.c'))
  }
  console.log('PASS actual collision diagnostic -> SGDK 68000 -> ROM ('+rom.length+' bytes)')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Collision diagnostic: both walls, fast movement, floor/ceiling, jump, platform/drop, slope, combat, mirrored attack, pixel overlay and bounded DMA passed.')
