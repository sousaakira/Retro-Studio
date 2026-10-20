// Projeto mínimo para os testes de inimigos: jogador (dono da paleta 1), ninja exportado pelo
// Charset Maker, uma sala do mundo e o TMX com objetos.
import fs from 'node:fs'
import path from 'node:path'
import {encodeIndexedPng} from '../../shared/retro/indexedPng.js'
import {rgbToVdp} from '../../shared/retro/paletteConfiguration.js'

export const HERO_PALETTE=[[0,0,0],[255,0,0],[0,255,0],[0,0,255],[255,255,255]].map(c=>rgbToVdp(...c))

export function enemyProject(root){
 const write=(file,data)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),data)}
 async function png(file,palette,fill){
  const width=96,height=96,indices=Array.from({length:width*height},(_,i)=>fill(i%width,Math.floor(i/width)))
  write(file,Buffer.from(await encodeIndexedPng({width,height,indices,palette:Array.from({length:16},(_,i)=>palette[i]??0)})))
 }
 function character(name,file,animations,extra={}){
  write('charsets/'+name+'.charset.json',JSON.stringify({format:'retro-studio-charset-project',version:7,characterName:name,
   exportedFileName:file,exportedResourceName:'SPR_'+name.toUpperCase(),exportedHeaderName:name+'_animations.h',
   frameWidth:48,frameHeight:48,exportAnchor:{x:24,y:48},bodyBox:{x:-8,y:-32,width:16,height:32},hurtBox:{x:-8,y:-32,width:16,height:32,custom:false},
   animations:animations.map(([anim,frames])=>({name:anim,frameCount:frames,fps:8,loop:true,attack:{enabled:anim==='ataque',x:6,y:-28,width:20,height:14,firstFrame:0,lastFrame:1}})),...extra}))
  write('src/'+name+'_animations.h',animations.map(([anim],i)=>'#define '+name.toUpperCase()+'_ANIM_'+anim.toUpperCase()+' '+i).join('\n')+'\n#define '+name.toUpperCase()+'_ANIM_COUNT '+animations.length+'\n')
  return 'SPRITE SPR_'+name.toUpperCase()+' "'+file+'" 6 6 NONE ['+animations.map(([,frames])=>'['+Array(frames).fill(8).join(',')+']').join('')+'] NONE'
 }
 function tmx(objects){
  write('maps/room.tmx','<?xml version="1.0"?>\n<map width="100" height="30" tilewidth="8" tileheight="8">\n <objectgroup id="5" name="objects">\n'+objects.map(o=>
   '  <object id="'+o.id+'" name="'+(o.name||'')+'" type="'+(o.type||'enemy')+'" x="'+o.x+'" y="'+o.y+'" width="24" height="24"'+(o.props?'>\n   <properties>\n'+Object.entries(o.props).map(([k,v])=>'    <property name="'+k+'" type="string" value="'+v+'"/>').join('\n')+'\n   </properties>\n  </object>':'/>')).join('\n')+'\n </objectgroup>\n</map>\n')
 }
 async function create(){
  await png('res/hero.png',HERO_PALETTE,(x,y)=>(x+y)%5)
  await png('res/ninja.png',HERO_PALETTE,(x,y)=>x%48<4?0:1+(y%3))
  write('res/resources.res',[character('hero','hero.png',[['idle',2]]),character('ninja','ninja.png',[['idle',2],['run',3],['ataque',2],['dano',2],['morte',3]])].join('\n')+'\n')
  write('world/world.json',JSON.stringify({format:'retro-studio.world',version:1,initial:{room:'room_1',entry:'spawn'},conditions:[],
   rooms:[{id:'room_1',name:'Sala',map:'maps/room.tmx',width:800,height:240,entries:[{id:'spawn',x:40,y:200,facing:false}],exits:[],checkpoints:[]}]}))
  write('src/generated/world_maps.h','static const RetroWorldSgdkRoom retroWorldMapBindings[]={\n{14355,&T,&M,0,0,{{&P,0},{0,0},{&P,32},{0,0}},0,0}\n};\n')
  tmx([{id:3,name:'Guarda',x:100,y:176,props:{enemy:'ninja',kind:'ninja',facing:'left',patrolLeft:'40',patrolRight:'40'}},
       {id:4,x:300,y:176,props:{kind:'ninja',respawn:'delay',respawnDelayMs:'2000'}},{id:2,name:'Spawn',type:'player_spawn',x:40,y:160}])
 }
 return {write,png,character,tmx,create}
}
