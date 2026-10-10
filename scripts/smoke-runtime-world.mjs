// #55: actual C lifecycle/conditions/checkpoint state, no game sources.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-world-runtime-'))
try{
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <string.h>
#include "retro_world.h"
static const RetroWorldSpawn entryA[]={{11,24,160,0},{12,72,160,1}},entryB[]={{21,280,160,1}};
static const RetroWorldSpawn checkpoints[]={{31,100,160,1}};
static const uint16_t requirements[]={41};
static const RetroWorldExit exitA[]={{51,2,21,requirements,1}},exitB[]={{52,1,12,0,0}};
static const RetroWorldRoom rooms[]={
 {1,320,224,entryA,2,checkpoints,1,exitA,1},
 {2,320,224,entryB,1,0,0,exitB,1}};
static const RetroWorldDefinition definition={rooms,2,1,11};
static RetroWorld world;
static int handles[8],prepares,activates,releases,fail,allowed,reenter,reuse;static unsigned int sequence;
static uint8_t prepare(void *context,const RetroWorldRoom *room,void **handle){
 assert(context==&world);assert(room);sequence=sequence*10+1;
 if(reenter){assert(retroWorldFree(&world)==RETRO_WORLD_BUSY);assert(retroWorldEnter(&world,1,11)==RETRO_WORLD_BUSY);assert(retroWorldInit(&world,&definition,&world.hooks)==RETRO_WORLD_BUSY);}
 if(reuse){*handle=world.handle;return 1;}
 *handle=&handles[prepares++];return (uint8_t)!fail;
}
static void activate(void *context,const RetroWorldRoom *room,void *handle){
 assert(context==&world&&world.room==room&&world.handle==handle&&world.busy);activates++;sequence=sequence*10+2;
 assert(retroWorldCheckpoint(&world,31)==RETRO_WORLD_BUSY);
}
static void release(void *context,const RetroWorldRoom *room,void *handle){
 assert(context==&world&&room&&handle&&world.busy);releases++;sequence=sequence*10+3;
 assert(retroWorldRespawn(&world)==RETRO_WORLD_BUSY);
}
static uint8_t allow(void *context,uint16_t condition){
 assert(context==&world&&condition==41);assert(retroWorldExitThrough(&world,51)==RETRO_WORLD_BUSY);return (uint8_t)allowed;
}
int main(void){
 RetroWorld previous;RetroWorldSave save={0},untouched={77,88,99};
 RetroWorldHooks hooks={prepare,activate,release,allow,&world};
 RetroWorldRoom badRooms[2];RetroWorldDefinition bad=definition;
 assert(retroWorldValidate(&definition));memcpy(badRooms,rooms,sizeof(rooms));bad.rooms=badRooms;
 badRooms[1].id=1;assert(!retroWorldValidate(&bad));badRooms[1]=rooms[1];badRooms[0].entryCount=0;assert(!retroWorldValidate(&bad));
 previous=world;fail=1;assert(retroWorldInit(&world,&definition,&hooks)==RETRO_WORLD_LOAD_FAILED);assert(!memcmp(&world,&previous,sizeof(world)));assert(releases==1&&!activates);
 fail=0;reenter=1;sequence=0;assert(retroWorldInit(&world,&definition,&hooks)==RETRO_WORLD_OK);assert(sequence==12&&world.room->id==1&&world.x==24&&!world.facing);
 previous=world;reuse=1;assert(retroWorldEnter(&world,2,21)==RETRO_WORLD_LOAD_FAILED&&!memcmp(&world,&previous,sizeof(world))&&releases==1);reuse=0;
 assert(retroWorldSnapshot(&world,&untouched)==RETRO_WORLD_NOT_FOUND&&untouched.version==77);
 previous=world;assert(retroWorldExitThrough(&world,51)==RETRO_WORLD_DENIED);assert(!memcmp(&world,&previous,sizeof(world)));
 allowed=1;fail=1;sequence=0;assert(retroWorldExitThrough(&world,51)==RETRO_WORLD_LOAD_FAILED);assert(sequence==13&&!memcmp(&world,&previous,sizeof(world)));
 fail=0;sequence=0;assert(retroWorldExitThrough(&world,51)==RETRO_WORLD_OK);assert(sequence==123&&world.room->id==2&&world.x==280&&world.facing);
 assert(retroWorldCheckpoint(&world,31)==RETRO_WORLD_NOT_FOUND);sequence=0;assert(retroWorldExitThrough(&world,52)==RETRO_WORLD_OK);assert(sequence==123&&world.room->id==1&&world.x==72&&world.facing);
 assert(retroWorldCheckpoint(&world,31)==RETRO_WORLD_OK);assert(retroWorldSnapshot(&world,&save)==RETRO_WORLD_OK&&save.version==1&&save.room==1&&save.checkpoint==31);
 sequence=0;assert(retroWorldRespawn(&world)==RETRO_WORLD_OK&&world.x==100&&world.facing);assert(sequence==2);
 assert(retroWorldEnter(&world,2,21)==RETRO_WORLD_OK);fail=1;previous=world;assert(retroWorldRespawn(&world)==RETRO_WORLD_LOAD_FAILED&&!memcmp(&world,&previous,sizeof(world)));
 fail=0;assert(retroWorldRestore(&world,&save)==RETRO_WORLD_OK&&world.room->id==1&&world.x==100);
 save.version=99;previous=world;assert(retroWorldRestore(&world,&save)==RETRO_WORLD_INVALID&&!memcmp(&world,&previous,sizeof(world)));
 assert(retroWorldEnter(&world,999,11)==RETRO_WORLD_NOT_FOUND);assert(retroWorldEnter(&world,1,999)==RETRO_WORLD_NOT_FOUND);
 assert(retroWorldFree(&world)==RETRO_WORLD_OK&&!world.initialized&&!world.handle);assert(retroWorldFree(&world)==RETRO_WORLD_INVALID);
 return 0;
}
`)
 const directory=path.join(repository,'assets/toolkit/lib/runtime'),source=path.join(directory,'world/retro_world.c')
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-I'+path.join(directory,'core'),'-I'+path.join(directory,'world')]
 const compile=spawnSync('cc',[...flags,fixture,source,'-o',binary],{encoding:'utf8'});assert.equal(compile.status,0,compile.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 const index=process.argv.indexOf('--m68k-cc')
 if(index>=0){const cross=spawnSync(process.argv[index+1],[...flags,'-m68000','-Os','-c',source,'-o',path.join(temporary,'world.o')],{encoding:'utf8'});assert.equal(cross.status,0,cross.stderr)}
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('World runtime: stable room/entry/checkpoint IDs, conditions, two-stage load, failed allocation cleanup, prior-state preservation, reentry guards, same-room respawn, restore and ownership passed.')
