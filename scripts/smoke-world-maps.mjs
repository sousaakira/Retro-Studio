// #55: real TMX -> room-scoped compiler -> geometry/SGDK resources, staged only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {toTMX} from '../src/utils/retro/tmxFormat.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-world-maps-'))
try{
 const root=path.join(temporary,'game');fs.mkdirSync(root);fs.mkdirSync(path.join(root,'tools'));fs.mkdirSync(path.join(root,'maps'));fs.mkdirSync(path.join(root,'world'));fs.mkdirSync(path.join(root,'res'))
 for(const name of ['export-map.py','export-world-maps.py'])fs.copyFileSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton/tools',name),path.join(root,'tools',name))
 installRuntimeModules(root)
 fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({mapExport:{sourceMaps:['maps/legacy.tmx'],runtimeGeometry:false}}))
 fs.writeFileSync(path.join(root,'res/resources.res'),'// Preserve manual/legacy declarations\nIMAGE CUSTOM "custom.png" NONE\n')
 fs.mkdirSync(path.join(root,'src/generated'),{recursive:true});fs.writeFileSync(path.join(root,'src/generated/map_data.h'),'// legacy header\n')
 const room=(id)=>({id,map:'maps/'+id+'.tmx',width:64,height:32})
 const world={format:'retro-studio.world',version:1,rooms:[room('hall'),room('cave')]}
 fs.writeFileSync(path.join(root,'world/world.json'),JSON.stringify(world))
 const save=(id)=>fs.writeFileSync(path.join(root,'maps',id+'.tmx'),toTMX({width:8,height:4,collision:Array(32).fill(id==='hall'?31:0),objects:[{id:2,type:'player_spawn',x:0,y:0,width:1,height:1,properties:{hitboxW:id==='hall'?4:2}},...(id==='cave'?[{id:1,type:'collision_slope',x:1,y:1,width:2,height:2,properties:{leftHeight:16,rightHeight:0,collisionGroup:2}}]:[])]}))
 save('hall');save('cave')
 const baseline=new Map()
 function snapshot(base){for(const item of fs.readdirSync(base,{withFileTypes:true})){const file=path.join(base,item.name);if(item.isDirectory())snapshot(file);else baseline.set(file,fs.readFileSync(file))}}
 snapshot(root)
 const run=stage=>spawnSync('python3',[path.join(root,'tools/export-world-maps.py'),'--stage',stage],{encoding:'utf8'})
 const stage=path.join(temporary,'stage'),result=run(stage);assert.equal(result.status,0,result.stdout+result.stderr)
 for(const [file,bytes] of baseline)assert.deepEqual(fs.readFileSync(file),bytes,'Compiler leaves source/legacy unchanged')
 const hall=worldNumericId('hall'),cave=worldNumericId('cave')
 const header=fs.readFileSync(path.join(stage,'src/generated/world_maps.h'),'utf8')
 assert.match(header,new RegExp('\\{'+hall+',&RETRO_WORLD_ROOM_'+hall+'_TILES'))
 assert.match(header,new RegExp('\\{'+cave+',&RETRO_WORLD_ROOM_'+cave+'_TILES'))
 assert.match(header,/#define RETRO_WORLD_SCENE_COUNT 0/);assert.equal(header.includes('RetroSceneObjectDefinition'),false,'No scene dependency for an empty world')
 assert.match(header,/_PALETTE,32/);assert.match(header,/_PALETTE,48/)
 const resources=fs.readFileSync(path.join(stage,'res/generated/world-resources.res'),'utf8')
 assert.equal(resources.includes('CUSTOM'),false);assert.match(resources,new RegExp('world-'+hall+'-bg.png'))
 for(const id of [hall,cave])assert.ok(resources.indexOf('TILESET RETRO_WORLD_ROOM_'+id+'_TILES ')<resources.indexOf('MAP RETRO_WORLD_ROOM_'+id+' '),'Tilesets precede dependent MAP declarations')
 const manifest=JSON.parse(fs.readFileSync(path.join(stage,'res/generated/world-map-manifest.json')))
 assert.equal(manifest.rooms.length,2);assert.equal(new Set(manifest.outputs.map(r=>r.path)).size,manifest.outputs.length)
 const genesis=path.join(temporary,'genesis.h');fs.writeFileSync(genesis,'#include <stdint.h>\ntypedef uint8_t u8;typedef int16_t s16;\n')
 const fixture=path.join(temporary,'geometry.c'),binary=path.join(temporary,'geometry')
 fs.writeFileSync(fixture,`#include <assert.h>
#include "retro_slopes.h"
#include "world_room_${hall}.h"
#include "world_room_${cave}.h"
int main(void){assert(retroWorldRoom${hall}CollisionAt(8,8)==31);assert(retroWorldRoom${cave}CollisionAt(0,0)==0);assert(RETRO_WORLD_ROOM_${hall}_COLLIDER_COUNT==1);assert(RETRO_WORLD_ROOM_${cave}_SLOPE_COUNT==1);assert(retroWorldRoom${cave}Slopes[0].group==2);assert(RETRO_WORLD_ROOM_${hall}_PLAYER_HITBOX_W==4);assert(RETRO_WORLD_ROOM_${cave}_PLAYER_HITBOX_W==2);return 0;}
`)
 const compiled=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-I',temporary,'-I',path.join(stage,'src/generated'),'-I',path.join(root,'src/retro_runtime'),fixture,'-o',binary],{encoding:'utf8'})
 assert.equal(compiled.status,0,compiled.stderr);assert.equal(spawnSync(binary).status,0)
 assert.notEqual(run(stage).status,0,'Existing stage cannot be overwritten')
 fs.writeFileSync(path.join(root,'world/world.json'),JSON.stringify({...world,rooms:[room('hall'),room('hall')]}));assert.notEqual(run(path.join(temporary,'duplicate')).status,0)
 fs.writeFileSync(path.join(root,'world/world.json'),JSON.stringify(world));fs.writeFileSync(path.join(root,'maps/cave.tmx'),'<map orientation="orthogonal" width="9" height="4" tilewidth="8" tileheight="8"></map>')
 assert.notEqual(run(path.join(temporary,'invalid')).status,0);assert.equal(fs.existsSync(path.join(temporary,'invalid')),false,'Compile failure publishes no stage')
 save('cave');fs.unlinkSync(path.join(root,'maps/cave.tmx'));fs.symlinkSync(path.join(root,'maps/hall.tmx'),path.join(root,'maps/cave.tmx'))
 assert.notEqual(run(path.join(temporary,'linked')).status,0)
 fs.unlinkSync(path.join(root,'maps/cave.tmx'));save('cave')
 for(const [index,name] of ['world/world.json','retro-studio.json','res/resources.res','res/generated/map-manifest.json'].entries()){
  const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true})
  const bytes=fs.existsSync(file)?fs.readFileSync(file):null
  if(bytes!==null)fs.unlinkSync(file)
  fs.symlinkSync(path.join(root,'maps/hall.tmx'),file)
  assert.notEqual(run(path.join(temporary,'linked-input-'+index)).status,0,'Linked metadata/resource input refused')
  fs.unlinkSync(file);if(bytes!==null)fs.writeFileSync(file,bytes)
 }
 console.log('World maps: real TMX, isolated room symbols/assets, palette bindings, native collision/slopes, unchanged legacy, invalid inputs and staged publication passed.')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
