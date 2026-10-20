// #49: real editor metadata -> TMX -> Python -> collision runtime.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import {spawnSync} from 'node:child_process'
import {toTMX} from '../src/utils/retro/tmxFormat.js'
import {runConfiguredMapExporter} from '../electron/retro/mapExporter.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
const repository=new URL('../',import.meta.url).pathname
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-map-terrain-'))
try{
 const root=path.join(temporary,'game')
 fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),root,{recursive:true})
 installRuntimeModules(root);installCutsceneRuntime(root);fs.mkdirSync(path.join(root,'maps'))
 const source=fs.readFileSync(path.join(repository,'src/composables/useTilemapEditorState.js'),'utf8')
 // Área visível: pixels do mapa 160..480 x 40..200 (centro no tile 40,15); mapa de 64x24 tiles.
 const ref=value=>({value}),context={objects:ref([]),selectedObjectId:ref(null),pushState(){},selectDrawTool(){},
  viewport:ref({x:160,y:40,w:320,h:160}),updateViewport(){},TILE_SIZE_CONST:8,mapWidth:ref(64),mapHeight:ref(24)}
 vm.createContext(context)
 vm.runInContext(source.slice(source.indexOf('    function addCollisionRectangle('),source.indexOf('    function updateSelectedObject(')),context)
 context.addCollisionRectangle('collision_slope');context.addCollisionRectangle('collision_platform')
 assert.equal(context.objects.value[0].width,4);assert.equal(context.objects.value[0].properties.leftHeight,16)
 // Nasce no centro do que está visível, não em 0,0 (fora de vista).
 assert.deepEqual([context.objects.value[0].x,context.objects.value[0].y],[38,14]);assert.deepEqual([context.objects.value[1].x,context.objects.value[1].y],[40,15])
 context.viewport.value={x:1000,y:500,w:320,h:160};context.addCollisionRectangle('collision_solid')
 assert.deepEqual([context.objects.value[2].x,context.objects.value[2].y],[63,23],'fica dentro do mapa')
 context.objects.value=context.objects.value.slice(0,2)
 context.selectedObject=ref(context.objects.value[0]);context.mapWidth=ref(32);context.mapHeight=ref(24)
 vm.runInContext(source.slice(source.indexOf('    function updateSelectedObject('),source.indexOf('    function moveSelectedObjectTo(')),context)
 context.updateSelectedObject('height',1)
 assert.equal(context.objects.value[0].properties.leftHeight,8,'resize updates slope endpoints in the same undo operation')
 const collision=Array(32*24).fill(0);collision[4*32+8]=20;collision[4*32+12]=21
 for(let x=0;x<32;x++)collision[22*32+x]=31
 const objects=[
  {id:1,type:'collision_solid',x:10/8,y:16/8,width:20/8,height:16/8,properties:{collisionGroup:2}},
  {id:2,type:'collision_clear',x:14/8,y:16/8,width:4/8,height:16/8,properties:{}},
  {id:3,type:'collision_platform',x:64/8,y:64/8,width:48/8,height:4/8,properties:{collisionGroup:4}},
  {id:4,type:'collision_slope',x:128/8,y:96/8,width:32/8,height:16/8,properties:{collisionGroup:8,leftHeight:16,rightHeight:0}},
  {id:6,type:'collision_platform',x:0,y:12,width:2,height:1,properties:{collisionGroup:16}},
  {id:7,type:'collision_platform',x:0,y:13,width:1,height:1,properties:{collisionGroup:16}}
 ]
 const map=path.join(root,'maps/map.tmx')
 const save=list=>fs.writeFileSync(map,toTMX({width:32,height:24,tiles:[],collision,objects:list}))
 save(objects)
 assert.match(fs.readFileSync(map,'utf8'),/type="collision_slope" x="128" y="96" width="32" height="16"/)
 const result=await runConfiguredMapExporter({projectPath:root,mapPath:map});assert.equal(result.success,true,result.error)
 const headerPath=path.join(root,'src/generated/map_data.h'),header=fs.readFileSync(headerPath,'utf8')
 assert.match(header,/#define GAME_MAP_SLOPE_COUNT 1/)
 assert.match(header,/\{\{128,96,32,16\},8,16,0\}/)
 fs.writeFileSync(path.join(temporary,'genesis.h'),'#include <stdint.h>\ntypedef uint8_t u8;typedef int16_t s16;\n')
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include "retro_slopes.h"
#include "map_data.h"
#define Q(n) ((RetroFixed)(n)*256)
int main(void){
 RetroBody b={0,Q(20),{0,0,4,4},2};RetroMoveResult r;
 assert(GAME_MAP_COLLIDER_COUNT>0&&GAME_MAP_SLOPE_COUNT==1);
 assert(gameMapCollisionAt(12,20)==31&&gameMapCollisionAt(15,20)==0&&gameMapCollisionAt(70,64)==17);
 r=retroMoveBodySlopes(&b,Q(100),0,gameMapColliders,GAME_MAP_COLLIDER_COUNT,gameMapSlopes,GAME_MAP_SLOPE_COUNT,2,0,0);
 assert(!r.invalid&&b.x==Q(6)&&r.contacts==RETRO_CONTACT_RIGHT);
 b.x=Q(14);b.y=0;b.box.width=2;
 r=retroMoveBody(&b,0,Q(100),gameMapColliders,GAME_MAP_COLLIDER_COUNT,0);assert(b.y==Q(100)&&!r.contacts);
 b.x=Q(70);b.y=0;b.box.width=4;b.mask=4;
 r=retroMoveBody(&b,0,Q(100),gameMapColliders,GAME_MAP_COLLIDER_COUNT,0);assert(b.y==Q(60)&&r.contacts==RETRO_CONTACT_FLOOR);
 b.y=0;r=retroMoveBody(&b,0,Q(100),gameMapColliders,GAME_MAP_COLLIDER_COUNT,1);assert(b.y==Q(100)&&!r.contacts);
 b.x=Q(50);b.y=Q(33);b.mask=1;
 r=retroMoveBody(&b,Q(100),0,gameMapColliders,GAME_MAP_COLLIDER_COUNT,0);assert(b.x==Q(60)&&r.contacts==RETRO_CONTACT_RIGHT);
 b.x=Q(80);r=retroMoveBody(&b,-Q(100),0,gameMapColliders,GAME_MAP_COLLIDER_COUNT,0);assert(b.x==-Q(20)&&!r.contacts);
 b.x=Q(98);b.y=0;b.box.width=2;
 r=retroMoveBody(&b,0,Q(100),gameMapColliders,GAME_MAP_COLLIDER_COUNT,1);
 assert(b.y==Q(28)&&r.contacts==RETRO_CONTACT_FLOOR); /* exposed TOP fragment of TOP|LEFT is not drop-through */
 b.x=Q(144);b.y=0;b.box=(RetroRect){-4,-8,8,8};b.mask=8;
 r=retroMoveBodySlopes(&b,0,Q(150),gameMapColliders,GAME_MAP_COLLIDER_COUNT,gameMapSlopes,GAME_MAP_SLOPE_COUNT,2,0,0);
 assert(b.y==Q(104)&&r.contacts==RETRO_CONTACT_FLOOR);
 b.x=Q(2);b.y=Q(99);b.box=(RetroRect){0,0,4,4};b.mask=16;
 r=retroMoveBody(&b,0,Q(10),gameMapColliders,GAME_MAP_COLLIDER_COUNT,0);
 assert(b.y==Q(109)&&!r.contacts); /* no ghost floor at connected platform's internal edge y104 */
 b.y=0;r=retroMoveBody(&b,0,Q(150),gameMapColliders,GAME_MAP_COLLIDER_COUNT,0);
 assert(b.y==Q(92)&&r.contacts==RETRO_CONTACT_FLOOR);
 return 0;
}
`)
 const library=path.join(repository,'assets/toolkit/lib/runtime')
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-I'+temporary,'-I'+path.dirname(headerPath),'-I'+path.join(library,'core'),'-I'+path.join(library,'collision')]
 const built=spawnSync('cc',[...flags,fixture,path.join(library,'collision/retro_collision.c'),path.join(library,'collision/retro_slopes.c'),'-o',binary],{encoding:'utf8'});assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8'});assert.equal(ran.status,0,ran.stderr)
 const bad=structuredClone(objects);bad[3].properties.leftHeight=17;save(bad)
 const failed=await runConfiguredMapExporter({projectPath:root,mapPath:map});assert.equal(failed.success,false);assert.match(failed.error,/leftHeight/)
 assert.equal(fs.readFileSync(headerPath,'utf8'),header,'failed validation preserves published geometry')
 const overlappingClear=[...objects,{id:5,type:'collision_clear',x:17,y:12,width:1,height:1,properties:{}}]
 save(overlappingClear)
 const overlap=await runConfiguredMapExporter({projectPath:root,mapPath:map});assert.equal(overlap.success,false)
 assert.match(overlap.error,/sobreposto a uma rampa/);assert.equal(fs.readFileSync(headerPath,'utf8'),header)
 save(Array.from({length:4097},(_,i)=>({...objects[3],id:i+1})))
 const excess=await runConfiguredMapExporter({projectPath:root,mapPath:map});assert.equal(excess.success,false)
 assert.match(excess.error,/4096 rampas/);assert.equal(fs.readFileSync(headerPath,'utf8'),header)
 save(objects)
 const index=process.argv.indexOf('--sgdk')
 if(index>=0){
  const sdk=process.argv[index+1]
  fs.writeFileSync(path.join(root,'src/main.c'),`#include <genesis.h>
#include "retro_runtime/retro_slopes.h"
#include "generated/map_data.h"
int main(void){
 RetroBody b={144*RETRO_FIXED_ONE,0,{-4,-8,8,8},8};RetroMoveResult r;
 r=retroMoveBodySlopes(&b,0,150*RETRO_FIXED_ONE,gameMapColliders,GAME_MAP_COLLIDER_COUNT,gameMapSlopes,GAME_MAP_SLOPE_COUNT,2,0,0);
 VDP_drawText(!r.invalid&&b.y==104*RETRO_FIXED_ONE ? "Terrain runtime OK" : "Terrain runtime failed",1,1);
 while(1)SYS_doVBlankProcess();return 0;
}
`)
  const romBuild=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],{cwd:root,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  assert.equal(romBuild.status,0,romBuild.stdout.slice(-4000)+romBuild.stderr.slice(-4000))
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  console.log('PASS TMX terrain -> Python -> runtime geometry -> SGDK ROM ('+rom.length+' bytes)')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Map terrain: authoring defaults, pixel TMX, effective clear masks, groups, directional faces, platform/drop, ramp landing and rollback passed.')
