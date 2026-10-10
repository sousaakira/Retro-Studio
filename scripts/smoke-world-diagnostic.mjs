// #55: actual graph -> named resources -> SGDK bridge -> diagnostic ROM.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {worldConfigurationStatus,saveWorldConfiguration,saveWorldConfigurationWithMaps,validateWorldForBuild} from '../electron/retro/worldConfiguration.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
import {toTMX} from '../src/utils/retro/tmxFormat.js'
import {buildSgdkAnimationHeader,buildCharsetControllerHeader,buildSgdkSpriteResource} from '../src/utils/retro/charsetMaker.js'
import {exportCharacterToProject} from '../electron/retro/characterExport.js'
import {createCameraConfiguration} from '../shared/retro/cameraConfiguration.js'
import {cameraConfigurationStatus,saveCameraConfiguration,validateCameraForBuild} from '../electron/retro/cameraConfiguration.js'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-world-diagnostic-'))
const arg=name=>{const i=process.argv.indexOf(name);if(i<0)return null;assert.ok(process.argv[i+1]&&!process.argv[i+1].startsWith('--'),'Missing '+name);return process.argv[i+1]}
try{
 const root=path.join(temporary,'game');fs.mkdirSync(root)
 installRuntimeModules(root,{moduleIds:['world-sgdk','movement','scene','character-sprite','camera']})
 fs.mkdirSync(path.join(root,'res'));fs.mkdirSync(path.join(root,'maps'))
 fs.mkdirSync(path.join(root,'tools'))
 for(const name of ['export-map.py','export-world-maps.py'])fs.copyFileSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton/tools',name),path.join(root,'tools',name))
 fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({mapExport:{runtimeGeometry:true,playerFrame:{width:16,height:24},playerHitbox:{x:4,y:2,w:8,h:22}}}))
 fs.writeFileSync(path.join(root,'res/resources.res'),'')
 fs.writeFileSync(path.join(root,'Makefile'),'include $(GDK)/makefile.gen\nout/src/main.o: out/res/resources.o\n')
 const tmx=(width,height)=>'<map orientation="orthogonal" width="'+width+'" height="'+height+'" tilewidth="8" tileheight="8"></map>'
 fs.writeFileSync(path.join(root,'maps/hall.tmx'),tmx(60,28));fs.writeFileSync(path.join(root,'maps/cave.tmx'),tmx(80,28))
 const config={format:'retro-studio.world',version:1,initial:{room:'hall',entry:'spawn'},conditions:[{id:'key',name:'Chave'}],rooms:[
  {id:'hall',name:'Hall',map:'maps/hall.tmx',width:480,height:224,entries:[{id:'spawn',x:32,y:176,facing:false}],checkpoints:[{id:'saved',x:200,y:176,facing:true,area:{x:188,y:144,width:24,height:36}}],exits:[{id:'next',area:{x:456,y:136,width:24,height:48},targetRoom:'cave',targetEntry:'spawn',requires:['key']}]},
  {id:'cave',name:'Cave',map:'maps/cave.tmx',width:640,height:224,entries:[{id:'spawn',x:600,y:176,facing:true}],checkpoints:[],exits:[{id:'back',area:{x:0,y:136,width:24,height:48},targetRoom:'hall',targetEntry:'spawn',requires:[]}]}
 ]}
 saveWorldConfiguration(root,{config,revision:worldConfigurationStatus(root).revision})
 assert.equal(validateWorldForBuild(root).configured,true)
 // #59: exported camera profile and a locked arena in the cave drive the bridge scroll.
 const framing=createCameraConfiguration()
 framing.rooms=[{id:'cave',regions:[{id:'arena',name:'Arena',area:{x:330,y:0,width:120,height:224},limits:{x:240,y:0,width:320,height:224},priority:1,lock:true,transitionSpeed:4}]}]
 saveCameraConfiguration(root,{config:framing,revision:cameraConfigurationStatus(root).revision})
 assert.equal(validateCameraForBuild(root).configured,true)
 const generated=path.join(root,'src/generated/world_fixture_assets.h')
 fs.writeFileSync(generated,`#ifndef WORLD_FIXTURE_ASSETS_H
#define WORLD_FIXTURE_ASSETS_H
#include "world_maps.h"
#define FIXTURE_HALL ${worldNumericId('hall')}
#define FIXTURE_SPAWN ${worldNumericId('spawn')}
#define FIXTURE_CHECKPOINT ${worldNumericId('saved')}
#define FIXTURE_NEXT ${worldNumericId('next')}
#define FIXTURE_BACK ${worldNumericId('back')}
#define FIXTURE_KEY ${worldNumericId('key')}
#define worldFixtureAssets retroWorldMapBindings
#endif
`)
 fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/runtime-world-sgdk.c'),path.join(root,'src/main.c'))
 const images=spawnSync('python3',['-c',`from PIL import Image, ImageDraw
from pathlib import Path
root=Path(${JSON.stringify(root)})/'res'
colors=[(0,0,0),(34,34,68),(68,102,136),(136,170,204),(204,238,238)]+[(0,0,0)]*251
flat=[c for rgb in colors for c in rgb]
for name,width in [('hall',480),('cave',640)]:
 im=Image.new('P',(width,224),1);im.putpalette(flat);d=ImageDraw.Draw(im)
 for x in range(0,width,32):
  for y in range(0,224,32):
   d.rectangle((x+2,y+2,x+13,y+13),fill=2 if name=='hall' else 3)
 d.rectangle((0,176,width-1,223),fill=4);im.save(root/(name+'.png'))
front=Image.new('P',(480,224),0);front.putpalette(flat);front.info['transparency']=0;d=ImageDraw.Draw(front)
for x in range(80,480,96):d.rectangle((x,144,x+7,215),fill=3)
front.save(root/'front.png')
hero=Image.new('P',(16,24),0);hero.putpalette([0,0,0,34,34,68,204,238,238]+[0]*759);hero.info['transparency']=0;d=ImageDraw.Draw(hero)
d.rectangle((4,2,11,21),fill=2);d.rectangle((11,4,15,8),fill=1);hero.save(root/'hero.png')
`],{encoding:'utf8'})
 assert.equal(images.status,0,images.stderr)
 const transitions=[
  {target:'idle',requireAll:1,requireNone:2,predicate:65535,priority:10},
  {target:'walk',requireAll:3,requireNone:0,predicate:65535,priority:10},
  {target:'jump',requireAll:0,requireNone:1,predicate:1,priority:20},
  {target:'fall',requireAll:0,requireNone:1,predicate:2,priority:20}
 ].map(t=>({...t,minimumTicks:0,finished:false}))
 const animations=['idle','walk','jump','fall'].map((name,index)=>({id:name,name,frameCount:2,fps:8,loop:true,frameWidth:16,frameHeight:24,
  frames:[0,1].map(i=>({id:name+'-'+i,x:i*16,y:index*24,width:16,height:24,anchorX:8,anchorY:24,durationTicks:index===1?6:8})),
  controller:{interruptible:true,transitions:transitions.filter(t=>t.target!==name),events:[]}}))
 const atlasPath=path.join(temporary,'worldhero.png')
 const atlas=spawnSync('python3',['-c',`from PIL import Image, ImageDraw
source=Image.open(${JSON.stringify(path.join(root,'res/hero.png'))})
atlas=Image.new('P',(32,96),0);atlas.putpalette(source.getpalette());atlas.info['transparency']=0
for row in range(4):
 for frame in range(2):
  atlas.paste(source,(frame*16,row*24))
  ImageDraw.Draw(atlas).point((frame*16+4+frame,row*24+3+row),fill=1)
atlas.save(${JSON.stringify(atlasPath)})
`],{encoding:'utf8'})
 assert.equal(atlas.status,0,atlas.stderr)
 fs.copyFileSync(atlasPath,path.join(root,'res/worldhero_source.png'))
 const animationHeader=buildSgdkAnimationHeader('worldhero',animations)
 exportCharacterToProject(root,{characterName:'worldhero',imageName:'worldhero_sprites.png',projectFile:'charsets/worldhero.charset.json',
  png:fs.readFileSync(atlasPath),resources:buildSgdkSpriteResource({resourceName:'WORLD_HERO',imageName:'worldhero_sprites.png',frameWidth:16,frameHeight:24,animations}),header:animationHeader,
  characterProject:JSON.stringify({format:'retro-studio-charset-project',version:6,source:{path:'res/worldhero_source.png',name:'worldhero_source.png'},animations,
   characterName:'worldhero',spriteName:'worldhero',frameWidth:16,frameHeight:24,cropWidth:16,cropHeight:24,
   anchorX:8,anchorY:24,exportAnchor:{x:8,y:24},spacingX:0,spacingY:0,captureMode:'free',selectedAnimationId:'idle',selectedFrame:0,
   exportedFileName:'worldhero_sprites.png',exportedHeaderName:'worldhero_animations.h',exportedResourceName:'WORLD_HERO'}),
  expectedResources:fs.readFileSync(path.join(root,'res/resources.res'),'utf8'),expectedHeader:null,expectedProject:null})
 for(const [name,width] of [['hall',60],['cave',80]]){
  const collision=Array(width*28).fill(0);for(let x=0;x<width;x++)collision[22*width+x]=31
  fs.writeFileSync(path.join(root,'maps',name+'.tmx'),toTMX({width,height:28,collision,
   // toTMX takes object positions and sizes in tiles (8 px): 12,19 -> 96,152 px.
   objects:[{id:1,type:'player_spawn',x:4,y:19,width:2,height:3,properties:{hitboxX:name==='hall'?4:3,hitboxW:name==='hall'?8:10}},...(name==='hall'?[2,3].map(id=>({id,type:'scenery',x:id===2?12:18,y:19,width:2,height:3,visual:{gid:2000,width:2,height:3,frames:1,fps:4,loop:true}})):[])],
   background:{path:'../res/'+name+'.png',fit:'stretch'},
   tilesets:[...(name==='hall'?[{firstgid:1,columns:60,tilecount:1680,path:'../res/front.png'}]:[]),{firstgid:2000,columns:2,tilecount:6,path:'../res/hero.png'}],
   tiles2:name==='hall'?Array.from({length:1680},(_,i)=>i+1):[]}))
 }
 const publication=await saveWorldConfigurationWithMaps(root,{config,revision:worldConfigurationStatus(root).revision})
 assert.equal(publication.mapsExported,2)
 // Execute the authored room geometry with the actual portable physics solver.
 const geometryHeader=fs.readFileSync(path.join(root,'src/generated/world_maps.h'),'utf8')
 assert.match(geometryHeader,/#define RETRO_WORLD_SCENE_COUNT 2/);assert.match(geometryHeader,/retroWorldMapSceneFind/);
 assert.match(geometryHeader,new RegExp('\\{'+worldNumericId('cave')+',0,0,0,0\\}'));
 assert.match(fs.readFileSync(path.join(root,'src/generated/world_room_'+worldNumericId('hall')+'_objects.h'),'utf8'),/_OBJECT_COUNT 2/);
 const sceneManifest=JSON.parse(fs.readFileSync(path.join(root,'res/generated/world-map-manifest.json')));
 assert.equal(sceneManifest.rooms.find(room=>room.id==='hall').objectCount,2);assert.equal(sceneManifest.rooms.find(room=>room.id==='cave').objectCount,0);
 const geometryDeclarations=geometryHeader.slice(geometryHeader.indexOf('typedef struct'),geometryHeader.indexOf('#define RETRO_WORLD_SCENE_COUNT'))
 const sceneDeclarations=geometryHeader.slice(geometryHeader.indexOf('typedef struct {u16 room;const RetroSceneObjectDefinition')).replace(/#endif\s*$/,'')
 const sceneStubs=sceneManifest.rooms.filter(room=>room.objectCount).map(room=>`
#define RETRO_WORLD_ROOM_${room.numericId}_OBJECT_COUNT ${room.objectCount}
static const RetroSceneObjectDefinition retroWorldRoom${room.numericId}ObjectDefinitions[${room.objectCount}]={{2}};
static void retroWorldRoom${room.numericId}ObjectPalette(void){paletteCalls++;}
static u32 retroWorldRoom${room.numericId}ObjectTileBudget(void){return ${room.objectCount}*6;}
`).join('\n')
 fs.writeFileSync(path.join(temporary,'genesis.h'),'#include <stdint.h>\ntypedef uint8_t u8;typedef int16_t s16;typedef uint16_t u16;typedef uint32_t u32;\n')
 const native=path.join(temporary,'world-physics'),nativeSource=path.join(temporary,'world-physics.c')
 fs.writeFileSync(path.join(temporary,'worldhero_controller.h'),animations.map((a,i)=>'#define WORLDHERO_ANIM_'+a.name.toUpperCase()+' '+i).join('\n')+'\n#define WORLDHERO_ANIM_COUNT '+animations.length+'\n'+buildCharsetControllerHeader('worldhero',animations))
 fs.writeFileSync(nativeSource,`#include <assert.h>
#include "retro_movement.h"
#include "retro_character.h"
#include "worldhero_controller.h"
#include "world_room_${worldNumericId('hall')}.h"
#include "world_room_${worldNumericId('cave')}.h"
${geometryDeclarations}
typedef struct {u16 id;} RetroSceneObjectDefinition;
#define RETRO_WORLD_SCENE_COUNT ${sceneManifest.rooms.length}
static unsigned paletteCalls;
${sceneStubs}
${sceneDeclarations}
static uint8_t animationCondition(void *context,uint16_t predicate){
 RetroMovement *movement=context;
 return predicate==1?movement->velocityY<0:predicate==2?movement->velocityY>=0:0;
}
int main(void){
 RetroMovement state={0};RetroMovementConfig config;RetroMovementResult result;
 RetroMovementInput input={0,0};unsigned room,tick;
 RetroCharacter character={0};RetroCharacterHost host={&state,animationCondition,0,0,0};
 retroMovementPreset(&config);
 {
  const RetroWorldMapScene *hall=retroWorldMapSceneFind(${worldNumericId('hall')});
  const RetroWorldMapScene *cave=retroWorldMapSceneFind(${worldNumericId('cave')});
  assert(hall&&hall->count==2&&hall->objects&&hall->palette&&hall->tileBudget);
  assert(cave&&!cave->count&&!cave->objects&&!cave->palette&&!cave->tileBudget);
  assert(!retroWorldMapSceneFind(65535));hall->palette();assert(paletteCalls==1&&hall->tileBudget()==12);
 }
 for(room=0;room<2;room++){
  const RetroWorldMapGeometry *g=&retroWorldMapGeometry[room];
  RetroBody body={32*RETRO_FIXED_ONE,100*RETRO_FIXED_ONE,g->body,0xFFFF};
  assert(g->frameWidth==16&&g->frameHeight==24);
  assert(g->body.y==-22&&g->body.height==22);
  assert(g->body.width==(g->room==${worldNumericId('hall')}?8:10));
  assert(g->body.x==(g->room==${worldNumericId('hall')}?-4:-5));
  assert(retroMovementInit(&state,&body));
  assert(retroCharacterInit(&character,&worldhero_character_definition,WORLDHERO_ANIM_IDLE,&host));
  input.buttons=0;
  for(tick=0;tick<120;tick++){
   result=retroMovementTick(&state,&config,input,g->colliders,g->colliderCount,g->slopes,g->slopeCount);assert(!result.invalid);
   retroCharacterTick(&character,result.conditions);
  }
  assert(state.grounded&&state.body.y==176*RETRO_FIXED_ONE);
  assert(retroCharacterStateId(&character)==WORLDHERO_ANIM_IDLE);
  input.axis=1;result=retroMovementTick(&state,&config,input,g->colliders,g->colliderCount,g->slopes,g->slopeCount);
  retroCharacterTick(&character,result.conditions);assert(retroCharacterStateId(&character)==WORLDHERO_ANIM_WALK);
  assert(character.animation.frame==0&&character.animation.remaining==6);
  for(tick=0;tick<5;tick++){
   result=retroMovementTick(&state,&config,input,g->colliders,g->colliderCount,g->slopes,g->slopeCount);
   assert(!result.invalid);retroCharacterTick(&character,result.conditions);
  }
  assert(character.animation.frame==0&&character.animation.remaining==1);
  result=retroMovementTick(&state,&config,input,g->colliders,g->colliderCount,g->slopes,g->slopeCount);
  retroCharacterTick(&character,result.conditions);assert(character.animation.frame==1&&character.animation.remaining==6);
  input.buttons=RETRO_MOVE_JUMP_HELD|RETRO_MOVE_JUMP_PRESSED;
  result=retroMovementTick(&state,&config,input,g->colliders,g->colliderCount,g->slopes,g->slopeCount);
  assert(!result.invalid&&result.jumped&&state.body.y<176*RETRO_FIXED_ONE);
  retroCharacterTick(&character,result.conditions);assert(retroCharacterStateId(&character)==WORLDHERO_ANIM_JUMP);
  input.axis=0;input.buttons=RETRO_MOVE_JUMP_HELD;
  for(tick=0;state.velocityY<0&&tick<120;tick++){
   result=retroMovementTick(&state,&config,input,g->colliders,g->colliderCount,g->slopes,g->slopeCount);
   assert(!result.invalid);retroCharacterTick(&character,result.conditions);
  }
  assert(retroCharacterStateId(&character)==WORLDHERO_ANIM_FALL);
  input.buttons=0;
  for(tick=0;!state.grounded&&tick<120;tick++){
   result=retroMovementTick(&state,&config,input,g->colliders,g->colliderCount,g->slopes,g->slopeCount);
   assert(!result.invalid);retroCharacterTick(&character,result.conditions);
  }
  assert(state.grounded&&retroCharacterStateId(&character)==WORLDHERO_ANIM_IDLE);
  assert(retroCharacterSetState(&character,WORLDHERO_ANIM_IDLE)&&character.elapsed==0);
 }
 return 0;
}
`)
 const runtime=path.join(root,'src/retro_runtime')
 const compile=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-I',temporary,'-I',runtime,'-I',path.join(root,'src/generated'),nativeSource,...['retro_movement.c','retro_collision.c','retro_slopes.c','retro_character.c','retro_core.c'].map(name=>path.join(runtime,name)),'-o',native],{encoding:'utf8'})
 assert.equal(compile.status,0,compile.stderr);assert.equal(spawnSync(native).status,0,'Authored room floor/body/jump execution')
 console.log('PASS authored room geometry + exported controller: idle/walk/jump/fall/landing, frame durations and reset in native runtime')
 const sdk=arg('--sgdk'),artifacts=arg('--artifacts')
 if(artifacts)assert.ok(sdk,'Artifacts require an actual SGDK build')
 if(sdk){
  const build=spawnSync('make',['-j2','release','GDK='+sdk],{cwd:root,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  fs.writeFileSync(path.join(root,'build.log'),build.stdout+build.stderr)
  assert.equal(build.status,0,(build.stdout+build.stderr).slice(-6000))
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  assert.equal(validateWorldForBuild(root).configured,true)
  console.log('PASS graph/compiled rooms/foreground/host sprite -> SGDK ROM ('+rom.length+' bytes)')
  if(artifacts){
   const destination=path.resolve(artifacts);assert.equal(fs.existsSync(destination),false,'Refuse overwriting existing artifacts')
   fs.mkdirSync(destination,{recursive:true});fs.copyFileSync(path.join(root,'out/rom.bin'),path.join(destination,'world-diagnostic.bin'))
   for(const directory of ['src','res','world','maps','tools','charsets'])fs.cpSync(path.join(root,directory),path.join(destination,directory),{recursive:true})
   fs.copyFileSync(path.join(root,'retro-studio.json'),path.join(destination,'retro-studio.json'))
   fs.copyFileSync(path.join(root,'Makefile'),path.join(destination,'Makefile'));fs.copyFileSync(path.join(root,'build.log'),path.join(destination,'build.log'))
   console.log('Artifacts: '+destination)
  }
  // Also compile the same host when every authored scene is empty.
  const removeObjects=spawnSync('python3',['-c',`from pathlib import Path
import xml.etree.ElementTree as ET
for filename in Path(${JSON.stringify(root)}).joinpath('maps').glob('*.tmx'):
 tree=ET.parse(filename)
 for group in tree.getroot().findall('objectgroup'):
  for obj in list(group):
   if obj.tag=='object' and obj.get('type')!='player_spawn':group.remove(obj)
 tree.write(filename,encoding='unicode')
`],{encoding:'utf8'})
  assert.equal(removeObjects.status,0,removeObjects.stderr)
  await saveWorldConfigurationWithMaps(root,{config,revision:worldConfigurationStatus(root).revision})
  const emptyHeader=fs.readFileSync(path.join(root,'src/generated/world_maps.h'),'utf8')
  assert.match(emptyHeader,/#define RETRO_WORLD_SCENE_COUNT 0/);assert.equal(emptyHeader.includes('RetroSceneObjectDefinition'),false)
  const makeOptions={cwd:root,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024}
  const clean=spawnSync('make',['clean','GDK='+sdk],makeOptions);assert.equal(clean.status,0,clean.stderr)
  const emptyBuild=spawnSync('make',['-j2','release','GDK='+sdk],makeOptions)
  assert.equal(emptyBuild.status,0,(emptyBuild.stdout+emptyBuild.stderr).slice(-6000));assert.equal(validateWorldForBuild(root).configured,true)
  console.log('PASS same host with no authored scene objects -> SGDK ROM')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('World diagnostic source: authored graph, numeric bindings, indexed room/foreground/hero assets and standalone bridge example generated.')
