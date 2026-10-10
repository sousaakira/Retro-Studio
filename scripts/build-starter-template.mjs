// #61 developer tool: writes the authored sources of the playable starter into
// assets/toolkit/examples/sgdk-starter. Every asset is synthesized here (no
// third-party art or audio), so the example is redistributable. Generated
// headers and ownership records are NOT stored: the IDE exports them when a
// project is created from the template. Needs python3 with Pillow.
// node scripts/build-starter-template.mjs [--out <folder>]
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {toTMX} from '../src/utils/retro/tmxFormat.js'
import {buildSgdkAnimationHeader,buildSgdkSpriteResource} from '../src/utils/retro/charsetMaker.js'
import {createCameraConfiguration,validateCameraConfiguration} from '../shared/retro/cameraConfiguration.js'
import {createAudioConfiguration,validateAudioConfiguration} from '../shared/retro/audioConfiguration.js'
import {validateWorldConfiguration} from '../shared/retro/worldConfiguration.js'
import {wavFixture,vgmFixture} from './audio-fixtures.mjs'
const repository=fileURLToPath(new URL('../',import.meta.url))
const flag=process.argv.indexOf('--out'),out=flag>=0?path.resolve(process.argv[flag+1]):path.join(repository,'assets/toolkit/examples/sgdk-starter')
const put=(file,bytes)=>{fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),bytes)}
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true})
// Rooms: indexed PNG backgrounds (16 colours), a foreground layer for the hall and the hero atlas.
const images=spawnSync('python3',['-c',`from PIL import Image, ImageDraw
from pathlib import Path
import sys
out=Path(sys.argv[1]);(out/'res').mkdir(parents=True,exist_ok=True);(out/'starter').mkdir(exist_ok=True)
def palette(colors):
 flat=[c for rgb in colors for c in rgb];return flat+[0]*(768-len(flat))
hall=[(0,0,0),(32,32,72),(48,64,112),(72,104,152),(200,224,232),(104,72,40),(144,104,56),(40,96,56)]
cave=[(0,0,0),(24,16,40),(48,32,72),(88,64,112),(200,184,216),(64,56,72),(104,96,112),(152,48,48)]
for name,width,colors in [('hall',480,hall),('cave',640,cave)]:
 im=Image.new('P',(width,224),1);im.putpalette(palette(colors));d=ImageDraw.Draw(im)
 for y in range(0,176,16):
  for x in range(0,width,16):
   if (x//16+y//16)%2==0:d.rectangle((x,y,x+15,y+15),fill=2)
 for x in range(24,width,96):
  d.rectangle((x,96,x+31,175),fill=3);d.rectangle((x+8,112,x+23,135),fill=1)
 d.rectangle((0,176,width-1,223),fill=5);d.rectangle((0,176,width-1,179),fill=7 if name=='hall' else 6)
 for x in range(0,width,24):d.rectangle((x,188,x+11,195),fill=6)
 im.save(out/'res'/(name+'.png'))
front=Image.new('P',(480,224),0);front.putpalette(palette(hall));front.info['transparency']=0;d=ImageDraw.Draw(front)
for x in range(80,480,128):
 d.rectangle((x,120,x+7,215),fill=6);d.rectangle((x-4,120,x+11,127),fill=5)
front.save(out/'res'/'front.png')
# Hero atlas: 4 animations (idle, walk, jump, fall) x 2 frames of 16x24.
hero=[(0,0,0),(24,24,48),(232,184,136),(208,56,56),(56,88,200),(248,248,248)]
atlas=Image.new('P',(32,96),0);atlas.putpalette(palette(hero));atlas.info['transparency']=0;d=ImageDraw.Draw(atlas)
def body(ox,oy,legs,arms,lift):
 d.rectangle((ox+5,oy+2-lift,ox+10,oy+7-lift),fill=2);d.rectangle((ox+5,oy+1-lift,ox+10,oy+2-lift),fill=1)
 d.point((ox+9,oy+4-lift),fill=1)
 d.rectangle((ox+4,oy+8-lift,ox+11,oy+15-lift),fill=3)
 if arms==0:d.rectangle((ox+3,oy+9-lift,ox+3,oy+13-lift),fill=2);d.rectangle((ox+12,oy+9-lift,ox+12,oy+13-lift),fill=2)
 else:d.rectangle((ox+2,oy+6-lift,ox+3,oy+9-lift),fill=2);d.rectangle((ox+12,oy+6-lift,ox+13,oy+9-lift),fill=2)
 left,right=legs
 d.rectangle((ox+4+left,oy+16-lift,ox+6+left,oy+23),fill=4);d.rectangle((ox+9+right,oy+16-lift,ox+11+right,oy+23),fill=4)
 d.rectangle((ox+4+left,oy+22,ox+7+left,oy+23),fill=5);d.rectangle((ox+9+right,oy+22,ox+12+right,oy+23),fill=5)
body(0,0,(0,0),0,0);body(16,0,(0,0),0,1)
body(0,24,(-1,1),0,0);body(16,24,(1,-1),0,1)
body(0,48,(0,0),1,1);body(16,48,(-1,1),1,2)
body(0,72,(-1,1),1,0);body(16,72,(1,-1),1,0)
atlas.save(out/'starter'/'hero_sprites.png')
`,out],{encoding:'utf8'})
assert.equal(images.status,0,images.stderr)
// Character: the same export inputs the Charset Maker produces for this atlas.
const transitions=[
 {target:'idle',requireAll:1,requireNone:2,predicate:65535,priority:10},{target:'walk',requireAll:3,requireNone:0,predicate:65535,priority:10},
 {target:'jump',requireAll:0,requireNone:1,predicate:1,priority:20},{target:'fall',requireAll:0,requireNone:1,predicate:2,priority:20}].map(t=>({...t,minimumTicks:0,finished:false}))
const animations=['idle','walk','jump','fall'].map((name,index)=>({id:name,name,frameCount:2,fps:8,loop:true,frameWidth:16,frameHeight:24,
 // region: the strip of the sheet this movement was cut from; the Charset Maker refuses a project without it.
 region:{x:0,y:index*24,width:32,height:24},
 frames:[0,1].map(i=>({id:name+'-'+i,x:i*16,y:index*24,width:16,height:24,anchorX:8,anchorY:24,durationTicks:index===0?24:index===1?6:8})),
 // Frame event of the walk cycle: type 1 = sound, argument 0 = footstep (the game maps it to the audio catalog).
 controller:{interruptible:true,transitions:transitions.filter(t=>t.target!==name),events:name==='walk'?[{frame:0,type:1,argument:0}]:[]}}))
fs.copyFileSync(path.join(out,'starter/hero_sprites.png'),path.join(out,'res/hero_source.png'))
put('starter/character.json',JSON.stringify({characterName:'hero',imageName:'hero_sprites.png',projectFile:'charsets/hero.charset.json',
 resources:buildSgdkSpriteResource({resourceName:'HERO',imageName:'hero_sprites.png',frameWidth:16,frameHeight:24,animations}),header:buildSgdkAnimationHeader('hero',animations),
 characterProject:JSON.stringify({format:'retro-studio-charset-project',version:6,source:{path:'res/hero_source.png',name:'hero_source.png'},animations,
  characterName:'hero',spriteName:'hero',frameWidth:16,frameHeight:24,cropWidth:16,cropHeight:24,anchorX:8,anchorY:24,exportAnchor:{x:8,y:24},spacingX:0,spacingY:0,
  captureMode:'free',selectedAnimationId:'idle',selectedFrame:0,exportedFileName:'hero_sprites.png',exportedHeaderName:'hero_animations.h',exportedResourceName:'HERO'})},null,1)+'\n')
// World: two rooms joined by walking through their edges, one checkpoint.
const world={format:'retro-studio.world',version:1,initial:{room:'hall',entry:'spawn'},conditions:[],rooms:[
 {id:'hall',name:'Salão',map:'maps/hall.tmx',width:480,height:224,entries:[{id:'spawn',x:40,y:176,facing:false},{id:'from_cave',x:432,y:176,facing:true}],checkpoints:[],
  exits:[{id:'to_cave',area:{x:464,y:120,width:16,height:60},targetRoom:'cave',targetEntry:'from_hall',requires:[]}]},
 {id:'cave',name:'Caverna',map:'maps/cave.tmx',width:640,height:224,entries:[{id:'from_hall',x:48,y:176,facing:false}],
  checkpoints:[{id:'lamp',x:320,y:176,facing:false,area:{x:304,y:120,width:32,height:60}}],
  exits:[{id:'to_hall',area:{x:0,y:120,width:16,height:60},targetRoom:'hall',targetEntry:'from_cave',requires:[]}]}]}
validateWorldConfiguration(world);put('world/world.json',JSON.stringify(world,null,2)+'\n')
for(const [name,width] of [['hall',60],['cave',80]]){
 const collision=Array(width*28).fill(0);for(let x=0;x<width;x++)collision[22*width+x]=31
 // A raised platform in each room gives the jump something to land on.
 for(let x=name==='hall'?26:34;x<(name==='hall'?34:44);x++)collision[17*width+x]=31
 put('maps/'+name+'.tmx',toTMX({width,height:28,collision,objects:[{id:1,type:'player_spawn',x:5,y:19,width:2,height:3,properties:{hitboxX:4,hitboxW:8}}], // positions and sizes in tiles
  background:{path:'../res/'+name+'.png',fit:'stretch'},tilesets:name==='hall'?[{firstgid:1,columns:60,tilecount:1680,path:'../res/front.png'}]:[],
  tiles2:name==='hall'?Array.from({length:1680},(_,i)=>i+1):[]}))
}
const camera=createCameraConfiguration();validateCameraConfiguration(camera,{rooms:{hall:{width:480,height:224},cave:{width:640,height:224}}});put('camera/camera.json',JSON.stringify(camera,null,2)+'\n')
put('audio/music/hall.vgm',vgmFixture({fnum:0x269}));put('audio/music/cave.vgm',vgmFixture({block:3,fnum:0x2E0}))
put('audio/sfx/step.wav',wavFixture({seconds:.05,hz:330}));put('audio/sfx/jump.wav',wavFixture({seconds:.12,hz:660}));put('audio/sfx/checkpoint.wav',wavFixture({seconds:.35,hz:990}))
const audio=Object.assign(createAudioConfiguration(),{music:[{id:'hall',name:'Salão',source:'audio/music/hall.vgm',preview:'',timing:'auto'},{id:'cave',name:'Caverna',source:'audio/music/cave.vgm',preview:'',timing:'auto'}],
 effects:[{id:'step',name:'Passo',source:'audio/sfx/step.wav',priority:1,channel:0},{id:'jump',name:'Pulo',source:'audio/sfx/jump.wav',priority:2,channel:0},{id:'checkpoint',name:'Checkpoint',source:'audio/sfx/checkpoint.wav',priority:8,channel:0}],
 rooms:[{room:'hall',music:'hall'},{room:'cave',music:'cave'}]})
validateAudioConfiguration(audio,{rooms:['hall','cave']});put('audio/audio.json',JSON.stringify(audio,null,2)+'\n')
// Project configuration: the skeleton's contract plus the player frame the map exporter needs.
const base=JSON.parse(fs.readFileSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton/retro-studio.json'),'utf8'))
base.mapExport={...base.mapExport,runtimeGeometry:true,playerFrame:{width:16,height:24},playerHitbox:{x:4,y:2,w:8,h:22}}
put('retro-studio.json',JSON.stringify(base,null,2)+'\n')
put('template.json',JSON.stringify({format:'retro-studio.template',version:1,base:'sgdk-skeleton',prepare:'starter',requires:['world-sgdk','movement','character-sprite','camera','audio','debug']},null,2)+'\n')
fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/starter-game.c'),path.join(out,'src-main.c'));fs.mkdirSync(path.join(out,'src'),{recursive:true});fs.renameSync(path.join(out,'src-main.c'),path.join(out,'src/main.c'))
fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/starter-README.md'),path.join(out,'README.md'))
console.log('Starter template written: '+out)
