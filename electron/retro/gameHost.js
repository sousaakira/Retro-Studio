// #70: jogo gerado. game/game.json (o que o autor escolheu) -> src/game/*.{c,h} (código de
// propriedade da IDE) e, só quando o main.c ainda é o do modelo, um main.c curto que o usa.
// Projetos sem game/game.json não mudam em nada.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {validateWorldForBuild,worldConfigurationStatus,saveWorldConfigurationWithMaps} from './worldConfiguration.js'
import {mapSpawnPoint} from '../../shared/retro/mapSpawn.js'
import {worldNumericId} from '../../shared/retro/worldConfiguration.js'
import {GAME_FORMAT,GAME_ROLES,GAME_RUNTIME_FILES,GAME_HOST_FILES,GAME_MAIN,GAME_MAIN_SNIPPET,createGameConfiguration,validateGameConfiguration,resolveGamePlayer,compileGameHost} from '../../shared/retro/gameHost.js'
const SOURCE='game/game.json',RECORD='.retrostudio/game-host-export.json',MAIN='src/main.c',WORLD='world/world.json',LIMIT=256*1024
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
// Comparação de main.c sem depender de fim de linha (Windows) nem de espaços no fim.
const normal=bytes=>bytes===null?null:hash(Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n').replace(/[ \t]+$/gm,'').trimEnd()+'\n'))
const bounded4=(root,file)=>{const bytes=readProjectOutput(root,file);if(bytes&&bytes.length>4*1024*1024)throw Error(file+' passa de 4 MiB.');return bytes}
const bounded=(root,file)=>{const bytes=readProjectOutput(root,file);if(bytes&&bytes.length>LIMIT)throw Error(file+' passa de 256 KiB.');return bytes}
// "game" é um nome de pasta comum: um game.json que não é nosso significa que o recurso não está em uso.
function source(root){
 let bytes
 try{bytes=bounded(root,SOURCE)}catch{return {bytes:null,foreign:true}}
 if(bytes===null)return {bytes:null,foreign:false}
 try{if(JSON.parse(bytes.toString('utf8'))?.format!==GAME_FORMAT)return {bytes:null,foreign:true}}catch{return {bytes:null,foreign:true}}
 return {bytes,foreign:false}
}
function characters(root){
 const directory=path.join(root,'charsets'),list=[]
 let names=[]
 try{names=fs.readdirSync(directory).filter(name=>name.endsWith('.charset.json')).sort().slice(0,200)}catch{return list}
 for(const name of names){
  try{
   const bytes=bounded(root,'charsets/'+name);if(bytes===null)continue
   const data=JSON.parse(bytes.toString('utf8'));if(!Array.isArray(data?.animations))continue
   list.push({path:'charsets/'+name,name:String(data.characterName||name.replace(/\.charset\.json$/,'')),exported:!!(data.exportedFileName&&data.exportedHeaderName&&data.exportedResourceName),
    animations:data.animations.map(animation=>String(animation.name||'')).filter(Boolean).slice(0,128),data})
  }catch{/* projeto ilegível: não aparece na lista */}
 }
 return list
}
/** Sala e entrada iniciais (de Salas e conexões) e o que impede usá-las. */
function start(root){
 const info={room:'',roomName:'',entry:'',map:'',x:0,y:0,mapSpawn:null,problems:[],warnings:[]}
 let world=null
 try{const bytes=bounded(root,WORLD);if(bytes!==null)world=JSON.parse(bytes.toString('utf8'))}catch{world=null}
 if(!world||!Array.isArray(world.rooms)||!world.rooms.length){info.problems.push('Ainda não há sala inicial. Em “Salas e conexões”, adicione a sala com o seu mapa e exporte.');return info}
 const room=world.rooms.find(item=>item.id===world.initial?.room)
 if(!room){info.problems.push('A sala inicial não foi escolhida em “Salas e conexões”.');return info}
 const entry=(room.entries||[]).find(item=>item.id===world.initial?.entry)
 Object.assign(info,{room:String(room.id),roomName:String(room.name||room.id),map:String(room.map||''),entry:String(world.initial?.entry||'')})
 if(!entry){info.problems.push('A sala inicial não tem o ponto de entrada “'+info.entry+'”. Ajuste em “Salas e conexões”.');return info}
 info.x=Number(entry.x)||0;info.y=Number(entry.y)||0
 // O "Spawn" desenhado no mapa não muda a entrada sozinho: quem define é Salas e conexões. Avisa quando os dois divergem.
 try{
  const tmx=/^[^\\]+\.tmx$/.test(info.map)&&!info.map.split('/').includes('..')?bounded4(root,info.map):null,point=tmx?mapSpawnPoint(tmx.toString('utf8')):null
  if(point&&point.x<Number(room.width)&&point.y<=Number(room.height)){
   info.mapSpawn=point
   if(point.x!==info.x||point.y!==info.y)info.warnings.push('O mapa tem um ponto Spawn em (x '+point.x+', y '+point.y+'), mas a entrada inicial está em (x '+info.x+', y '+info.y+'). O jogo começa na entrada; use “Usar o Spawn do mapa” para começar onde você desenhou.')
  }
 }catch{/* mapa ilegível: sem sugestão */}
 try{if(!validateWorldForBuild(root).configured)info.problems.push('As salas ainda não foram exportadas. Use “Salvar e exportar” em “Salas e conexões”.')}
 catch(error){info.problems.push('Salas e conexões: '+error.message)}
 // Chão embaixo da entrada: sem ele o jogador começa caindo. Só os retângulos exportados são conferidos.
 try{
  const header=bounded(root,'src/generated/world_room_'+worldNumericId(room.id)+'.h')
  if(header!==null){
   const text=header.toString('utf8'),block=text.match(/Colliders\[\]\s*=\s*\{([\s\S]*?)\};/),slopes=text.match(/Slopes\[\]\s*=\s*\{([\s\S]*?)\};/)
   const rects=[...(block?.[1]||'').matchAll(/\{\{(-?\d+),(-?\d+),(-?\d+),(-?\d+)\}/g)].map(match=>match.slice(1).map(Number)).filter(rect=>rect[2]>0&&rect[3]>0)
   const hasSlopes=[...(slopes?.[1]||'').matchAll(/\{\{(-?\d+),(-?\d+),(-?\d+),(-?\d+)\}/g)].some(match=>Number(match[3])>0)
   if(!hasSlopes&&!rects.some(([x,y,width,height])=>info.x>=x&&info.x<x+width&&y+height>=info.y))
    info.warnings.push('Não há chão embaixo do ponto de entrada (x '+info.x+', y '+info.y+') da sala inicial: o jogador vai começar caindo. Pinte a colisão no mapa ou mova a entrada em “Salas e conexões”.')
  }
 }catch{/* sem o header da sala não há o que conferir */}
 return info
}
function read(root){
 const found=source(root),record=bounded(root,RECORD)
 const config=found.bytes===null?createGameConfiguration():JSON.parse(found.bytes.toString('utf8'))
 validateGameConfiguration(config)
 let ownership=null
 if(record!==null){
  try{ownership=JSON.parse(record.toString('utf8'))}catch{ownership=null}
  if(!ownership||ownership.version!==1||!Array.isArray(ownership.files)||ownership.files.some(file=>!GAME_HOST_FILES.includes(file?.path)||!/^[a-f0-9]{64}$/.test(file?.hash||'')))throw Error('Registro de exportação do jogo em formato desconhecido.')
 }
 const files=Object.fromEntries(GAME_HOST_FILES.map(file=>[file,bounded(root,file)]))
 const main=bounded(root,MAIN)
 return {config,source:found.bytes,foreign:found.foreign,record,ownership,files,main,
  revision:hash(Buffer.from(JSON.stringify([hash(found.bytes),hash(record),hash(main),...GAME_HOST_FILES.map(file=>hash(files[file]))])))}
}
/** Tudo o que decide se dá para gerar, e o que seria gerado. */
function plan(root,data,config=data.config){
 const list=characters(root),chosen=list.find(item=>item.path===config.player.character)
 const resolved=resolveGamePlayer(config,chosen?.data||null),problems=[...resolved.problems],begin=start(root)
 problems.push(...begin.problems)
 if(resolved.player){
  const header=bounded(root,'src/'+resolved.player.header)
  if(header===null)problems.push('Falta src/'+resolved.player.header+'. Exporte o personagem de novo no modo Personagens.')
  else if(!header.toString('utf8').includes(resolved.player.definition))problems.push('O personagem foi exportado por uma versão antiga da IDE. Exporte-o de novo no modo Personagens.')
 }
 const missing=GAME_RUNTIME_FILES.filter(file=>!fs.existsSync(path.join(root,'src/retro_runtime',file)))
 if(missing.length)problems.push('Faltam módulos de apoio no projeto ('+missing.join(', ')+'). Instale em “Módulos de apoio”, no fim do modo Jogo.')
 return {list,problems,warnings:begin.warnings,begin,player:resolved.player,outputs:resolved.player&&!problems.length?compileGameHost(resolved.player):null}
}
/** Arquivos gerados que alguém alterou fora da IDE: são preservados até o autor mandar gerar por cima. */
const conflicts=data=>GAME_HOST_FILES.filter(file=>{
 const owned=data.ownership?.files.find(item=>item.path===file)?.hash||null
 return data.files[file]!==null&&hash(data.files[file])!==owned
})
function mainState(data,templateMain){
 if(data.main===null)return 'missing'
 const current=normal(data.main)
 if(current===normal(Buffer.from(GAME_MAIN))||(data.ownership?.main&&hash(data.main)===data.ownership.main))return 'host'
 if(templateMain&&current===normal(templateMain))return 'template'
 // main.c que já chama o jogo gerado é do programador e está certo: nada a sugerir.
 return /\bgameInit\s*\(/.test(data.main.toString('utf8'))?'custom-host':'custom'
}
/** config (opcional): rascunho ainda não salvo, para o editor mostrar o que falta antes de exportar. */
export function gameHostStatus(root,{templateMain=null,config=null}={}){
 const data=read(root)
 if(config)validateGameConfiguration(config)
 const planned=plan(root,data,config||data.config),changed=conflicts(data)
 const exported=data.source!==null&&(!config||JSON.stringify(config)===JSON.stringify(data.config))&&!!planned.outputs&&!!data.ownership&&GAME_HOST_FILES.every(file=>changed.includes(file)||(data.files[file]!==null&&Buffer.from(planned.outputs[file]).equals(data.files[file])))
 return {config:config||data.config,revision:data.revision,configured:data.source!==null,foreign:data.foreign,exported,conflicts:changed,
  characters:planned.list.map(({data:_data,...item})=>item),roles:GAME_ROLES,start:{room:planned.begin.room,roomName:planned.begin.roomName,entry:planned.begin.entry,map:planned.begin.map,x:planned.begin.x,y:planned.begin.y,mapSpawn:planned.begin.mapSpawn},
  problems:planned.problems,warnings:planned.warnings,main:mainState(data,templateMain),snippet:GAME_MAIN_SNIPPET,files:GAME_HOST_FILES}
}
export function saveGameHost(root,{config,revision,overwrite=false,templateMain=null}={}){
 validateGameConfiguration(config)
 const data=read(root)
 if(data.foreign)throw Error('game/game.json pertence a outra ferramenta; o arquivo foi preservado e o jogo não pode ser gerado aqui.')
 if(typeof revision!=='string'||revision!==data.revision)throw Error('Os arquivos do jogo mudaram no disco. Recarregue antes de exportar.')
 const planned=plan(root,data,config)
 if(!planned.outputs)throw Error(planned.problems[0]||'Não foi possível gerar o jogo.')
 const changed=conflicts(data)
 if(changed.length&&overwrite!==true)throw Error('Arquivos gerados foram alterados fora da IDE e foram preservados: '+changed.join(', ')+'. Para voltar a gerá-los, use “Gerar por cima”.')
 const outputs=[{path:SOURCE,bytes:Buffer.from(JSON.stringify(config,null,2)+'\n'),expectedHash:hash(data.source)}]
 for(const file of GAME_HOST_FILES)outputs.push({path:file,bytes:Buffer.from(planned.outputs[file]),expectedHash:hash(data.files[file])})
 // main.c: só o do modelo (ou o que a própria IDE escreveu) é trocado. Código do autor nunca.
 const state=mainState(data,templateMain),main=Buffer.from(GAME_MAIN)
 let mainHash=data.ownership?.main||null
 if(state==='template'||state==='missing'||(state==='host'&&!main.equals(data.main))){outputs.push({path:MAIN,bytes:main,expectedHash:hash(data.main)});mainHash=hash(main)}
 else if(state==='host')mainHash=hash(data.main)
 const record={version:1,files:GAME_HOST_FILES.map(file=>({path:file,hash:hash(Buffer.from(planned.outputs[file]))})),main:mainHash}
 outputs.push({path:RECORD,bytes:Buffer.from(JSON.stringify(record,null,2)+'\n'),expectedHash:hash(data.record)})
 const receipt=publishProjectOutputs(root,outputs,{producer:'game-host'})
 return {...receipt,mainWritten:outputs.some(output=>output.path===MAIN),...gameHostStatus(root,{templateMain})}
}
/** Põe a entrada inicial no ponto "Spawn" desenhado no mapa e exporta as salas de novo. */
export async function useMapSpawnAsStart(root){
 const begin=start(root)
 if(!begin.mapSpawn)throw Error('O mapa da sala inicial não tem um ponto Spawn. Desenhe um no editor de mapas (ferramenta de objetos → Spawn) e salve.')
 const world=worldConfigurationStatus(root),config=JSON.parse(JSON.stringify(world.config))
 const entry=config.rooms.find(room=>room.id===config.initial?.room)?.entries.find(item=>item.id===config.initial?.entry)
 if(!entry)throw Error('A sala inicial não tem o ponto de entrada escolhido. Ajuste em “Salas e conexões”.')
 entry.x=begin.mapSpawn.x;entry.y=begin.mapSpawn.y
 await saveWorldConfigurationWithMaps(root,{config,revision:world.revision})
 return {success:true,x:entry.x,y:entry.y}
}
/** Trava do build, só para quem optou (game/game.json nosso). Arquivo gerado alterado pelo programador não trava: ele assumiu aquele arquivo. */
export function validateGameForBuild(root){
 if(source(root).bytes===null)return {configured:false}
 const data=read(root),planned=plan(root,data)
 if(planned.problems.length)throw Error(planned.problems[0])
 if(!data.ownership)throw Error('O jogo ainda não foi exportado. Use “Exportar” em “Jogador e início”, no modo Jogo.')
 const changed=conflicts(data)
 for(const file of GAME_HOST_FILES){
  if(changed.includes(file))continue
  if(data.files[file]===null)throw Error(file+' sumiu. Use “Exportar” em “Jogador e início” antes do build.')
  if(!Buffer.from(planned.outputs[file]).equals(data.files[file]))throw Error('O jogador ou o personagem mudou depois da última exportação. Use “Exportar” em “Jogador e início” antes do build.')
 }
 return {configured:true,revision:data.revision,conflicts:changed}
}
