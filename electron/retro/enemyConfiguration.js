// Inimigos (modo Jogo → Inimigos): enemies/enemies.json é a fonte; o C, o .res e os PNGs
// remapeados são gerados e publicados numa transação (docs/EXPORT_TRANSACTIONS.md).
// Arquivos gerados só são sobrescritos se ainda tiverem o hash registrado na última exportação.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {decodePng} from './pngDecode.js'
import zlib from 'node:zlib'
import {rgbToVdp,vdpToRgb} from '../../shared/retro/paletteConfiguration.js'
import {validateWorldConfiguration,worldNumericId} from '../../shared/retro/worldConfiguration.js'
import {ENEMY_SOURCE,ENEMY_HEADER,ENEMY_RESOURCE_FILE,ENEMY_ROLES,createEnemyConfiguration,validateEnemyConfiguration,
 parseTmxObjects,resolveEnemies,compileEnemyHeader} from '../../shared/retro/enemies.js'

const RECORD='.retrostudio/enemy-export.json',WORLD='world/world.json',WORLD_MAPS='src/generated/world_maps.h'
const LIMIT=1024*1024,IMAGE_LIMIT=8*1024*1024
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
const macro=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9_]/g,'_')
const portable=value=>typeof value==='string'&&!value.includes('\\')&&!value.startsWith('/')&&!/^[A-Za-z]:/.test(value)&&
 value.split('/').every(part=>part&&part!=='.'&&part!=='..')
function bounded(root,relative,limit=LIMIT){
 if(!portable(relative))throw Error('Caminho inválido: '+relative)
 const bytes=readProjectOutput(root,relative)
 if(bytes!==null&&bytes.length>limit)throw Error(relative+' é grande demais.')
 return bytes
}
function json(root,relative){
 const bytes=bounded(root,relative)
 return bytes===null?null:JSON.parse(bytes.toString('utf8'))
}

/** Lista dos personagens do Charset Maker (para o editor) e os dados exportados que o C usa. */
function listCharacters(root){
 let names=[]
 try{names=fs.readdirSync(path.join(root,'charsets')).filter(name=>name.endsWith('.charset.json')).sort().slice(0,200)}catch{return []}
 const list=[]
 for(const name of names){
  try{
   const data=json(root,'charsets/'+name)
   if(!Array.isArray(data?.animations))continue
   list.push({path:'charsets/'+name,name:String(data.characterName||name),data,
    exported:!!(data.exportedFileName&&data.exportedHeaderName&&data.exportedResourceName),
    animations:data.animations.map(animation=>String(animation.name||'')).filter(Boolean).slice(0,128)})
  }catch{/* projeto ilegível: fica fora da lista */}
 }
 return list
}
function spriteLine(root,resource){
 let files=[]
 try{files=fs.readdirSync(path.join(root,'res')).filter(name=>name.endsWith('.res')&&name!=='enemies.res')}catch{return null}
 for(const file of files){
  const text=(bounded(root,'res/'+file)||Buffer.alloc(0)).toString('utf8')
  for(const line of text.split(/\r?\n/)){
   const match=line.match(/^\s*SPRITE\s+(\w+)\s+"([^"]+)"\s+(\d+)\s+(\d+)\s*(.*)$/)
   if(match&&match[1]===resource)return {file:'res/'+file,image:match[2],width:Number(match[3]),height:Number(match[4]),rest:match[5]}
  }
 }
 return null
}
function resolveCharacter(root,entry){
 const data=entry.data,where=entry.name
 if(!entry.exported)return {problem:'o personagem '+where+' ainda não foi exportado. Abra-o no modo Personagens e clique em Exportar.'}
 const header=bounded(root,'src/'+data.exportedHeaderName)
 if(header===null)return {problem:'falta src/'+data.exportedHeaderName+'. Exporte '+where+' de novo no modo Personagens.'}
 const prefix=macro(data.characterName)+'_ANIM_',indices=new Map()
 for(const match of header.toString('utf8').matchAll(/#define\s+(\w+)\s+(\d+)/g))if(match[1].startsWith(prefix))indices.set(match[1].slice(prefix.length),Number(match[2]))
 const sprite=spriteLine(root,data.exportedResourceName)
 if(!sprite)return {problem:'o sprite '+data.exportedResourceName+' de '+where+' não está em res/*.res. Exporte o personagem de novo.'}
 if(indices.get('COUNT')!==data.animations.length)return {problem:where+' mudou depois da última exportação (animações diferentes). Exporte-o de novo no modo Personagens.'}
 // Tempos por quadro: os do .res (os mesmos da ROM); sem eles, os do projeto.
 const times=[...String(sprite.rest).matchAll(/\[([\d,\s]*)\]/g)].map(match=>match[1].split(',').map(Number).filter(Number.isFinite))
 const animations=new Map()
 data.animations.forEach((animation,position)=>{
  const name=String(animation.name||''),index=indices.get(macro(name))
  if(index===undefined)return
  const count=Array.isArray(animation.frames)?animation.frames.length:Number(animation.frameCount)||1
  const fallback=Math.max(1,Math.round(60/(Number(animation.fps)||8)))
  const ticks=(times[position]&&times[position].length?times[position]:Array.from({length:count},(_,frame)=>Number(animation.frames?.[frame]?.durationTicks)||fallback))
   .map(value=>Math.max(1,Math.min(255,Math.round(value)||1)))
  const box=animation.attack
  animations.set(name,{index,ticks,loop:animation.loop!==false,
   attack:box&&box.enabled&&box.width>0&&box.height>0?{x:box.x,y:box.y,width:box.width,height:box.height}:null})
 })
 const anchor=data.exportAnchor||{x:data.anchorX,y:data.anchorY}
 const box=value=>value&&[value.x,value.y,value.width,value.height].every(Number.isInteger)&&value.width>0&&value.height>0?{x:value.x,y:value.y,width:value.width,height:value.height}:null
 const body=box(data.bodyBox)
 return {name:macro(data.characterName).toLowerCase(),resource:data.exportedResourceName,image:'res/'+sprite.image.replace(/^\.\//,''),
  frameWidth:sprite.width*8,frameHeight:sprite.height*8,anchorX:Number(anchor.x)||0,anchorY:Number(anchor.y)||0,
  body,hurt:data.hurtBox&&data.hurtBox.custom?box(data.hurtBox)||body:body,animations,spriteTime:sprite.rest}
}
function readRooms(root){
 const bytes=bounded(root,WORLD)
 if(bytes===null)return {rooms:[],hash:null,problem:'O projeto ainda não tem salas (Jogo → Salas e conexões). Os inimigos são colocados nos mapas das salas.'}
 const world=validateWorldConfiguration(JSON.parse(bytes.toString('utf8')),{allowEmpty:true})
 const hashes=[hash(bytes)]
 const rooms=world.rooms.map(room=>{
  const base={id:room.id,numericId:worldNumericId(room.id),name:room.name||room.id,map:room.map}
  try{
   const tmx=bounded(root,room.map,16*1024*1024)
   if(tmx===null)return {...base,problem:'o mapa '+room.map+' não existe.'}
   hashes.push(hash(tmx))
   return {...base,objects:parseTmxObjects(tmx.toString('utf8'))}
  }catch(error){return {...base,problem:error.message}}
 })
 return {rooms,hash:hash(Buffer.from(JSON.stringify(hashes)))}
}
/** Linhas de paleta que as salas carregam (world_maps.h gerado): não estão livres. */
function roomPaletteSlots(root){
 const text=(bounded(root,WORLD_MAPS)||Buffer.alloc(0)).toString('utf8'),used=new Set()
 // Cada sala: {{&PALETA,deslocamento},{0,0},...} — uma entrada por linha PAL0..PAL3.
 for(const match of text.matchAll(/\{\{(.*?)\}\}/g))
  match[1].split(/\}\s*,\s*\{/).slice(0,4).forEach((entry,slot)=>{if(entry.trim().startsWith('&'))used.add(slot)})
 return used
}

const quantize=([r,g,b])=>rgbToVdp(r,g,b)
// PNG indexado de 4 bits (16 cores, índice 0 transparente), como shared/retro/indexedPng.js,
// mas síncrono: o painel de exportação e a checagem de build comparam os bytes sem esperar.
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})()
function pngChunk(type,data){
 const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);out.write(type,4,'latin1');Buffer.from(data).copy(out,8)
 let c=0xFFFFFFFF;for(const byte of out.subarray(4,8+data.length))c=CRC[(c^byte)&255]^(c>>>8)
 out.writeUInt32BE((c^0xFFFFFFFF)>>>0,8+data.length);return out
}
function encodeIndexed4({width,height,indices,palette}){
 const stride=Math.ceil(width/2)+1,lines=Buffer.alloc(height*stride)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)lines[y*stride+1+(x>>1)]|=indices[y*width+x]<<(x&1?0:4)
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=4;header[9]=3
 const colors=Buffer.alloc(48);palette.forEach((word,index)=>Buffer.from(vdpToRgb(word)).copy(colors,index*3))
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('PLTE',colors),
  pngChunk('tRNS',Buffer.from([0])),pngChunk('IDAT',zlib.deflateSync(lines,{level:9})),pngChunk('IEND',Buffer.alloc(0))])
}
const channels=word=>[(word>>1)&7,(word>>5)&7,(word>>9)&7]
const distance=(a,b)=>{const x=channels(a),y=channels(b);return (x[0]-y[0])**2+(x[1]-y[1])**2+(x[2]-y[2])**2}
function imageOf(root,character){
 const bytes=bounded(root,character.image,IMAGE_LIMIT)
 if(bytes===null)throw Error('falta '+character.image+'. Exporte o personagem de novo.')
 const image=decodePng(bytes)
 if(!image.indices)throw Error(character.image+' não é indexado (exporte o personagem de novo).')
 return image
}
/** Cores (palavras do VDP) de uma imagem indexada; o índice 0 é sempre transparente no SGDK. */
const paletteWords=image=>image.palette.slice(0,16).map(quantize)
/** Encaixa a imagem na paleta alvo. exact: nenhuma cor mudou; identity: os índices já batem. */
function fitToPalette(image,target){
 const source=paletteWords(image),used=new Set(image.indices),map=new Map()
 let changed=0,worst=0
 for(const index of used){
  if(index===0||image.transparent.has(index)){map.set(index,0);continue}
  if(index>=16)throw Error('a imagem usa mais de 16 cores.')
  let best=1,score=Infinity
  for(let candidate=1;candidate<target.length;candidate++){const d=distance(source[index],target[candidate]);if(d<score){score=d;best=candidate}}
  map.set(index,best)
  if(score){changed++;worst=Math.max(worst,score)}
 }
 const identity=[...map].every(([from,to])=>from===to)&&!changed
 return {map,exact:!changed,identity,changed,worst}
}

function readState(root){
 const source=bounded(root,ENEMY_SOURCE),record=bounded(root,RECORD)
 const config=source===null?createEnemyConfiguration():JSON.parse(source.toString('utf8'))
 let ownership=null
 if(record!==null){
  ownership=JSON.parse(record.toString('utf8'))
  if(!ownership||ownership.version!==1||!ownership.files||typeof ownership.files!=='object')throw Error('Registro de exportação de inimigos não suportado.')
  for(const [file,value] of Object.entries(ownership.files))if(!portable(file)||!/^[a-f0-9]{64}$/.test(value))throw Error('Registro de exportação de inimigos corrompido.')
 }
 const header=bounded(root,ENEMY_HEADER)
 return {config,source,record,ownership,header,
  revision:hash(Buffer.from(JSON.stringify([hash(source),hash(record),hash(header)])))}
}

/** Compila tudo o que a exportação publicaria, sem escrever. */
function plan(root,config){
 validateEnemyConfiguration(config)
 const problems=[],warnings=[],list=listCharacters(root),byPath=new Map(list.map(entry=>[entry.path,entry]))
 const used=new Set(config.definitions.map(d=>d.character).filter(Boolean))
 const palette=config.settings.palette
 if(palette.mode==='shared'&&palette.from)used.add(palette.from)
 const characters=new Map()
 for(const file of used){
  const entry=byPath.get(file)
  characters.set(file,entry?resolveCharacter(root,entry):{problem:'o personagem '+file+' não foi encontrado.'})
 }
 const world=readRooms(root)
 if(world.problem&&config.definitions.length)warnings.push(world.problem)
 const resolved=resolveEnemies(config,characters,world.rooms)
 problems.push(...resolved.problems);warnings.push(...resolved.warnings)
 // Paleta: nunca supõe linha livre. Própria = linha que nenhuma sala carrega e que o projeto
 // não reservou; compartilhada = cores já carregadas pelo personagem escolhido.
 const roomSlots=roomPaletteSlots(root),reserved=new Set(palette.reserved||[])
 const report={mode:palette.mode,slot:palette.slot,roomSlots:[...roomSlots],reserved:[...reserved],characters:[]}
 let target=null,targetName=''
 // Sem tipos de inimigo ainda não há o que encaixar: a paleta só é exigida com a primeira definição.
 const needsPalette=config.definitions.length>0
 if(needsPalette&&palette.mode==='own'){
  if(roomSlots.has(palette.slot))problems.push('Paleta própria: a linha '+palette.slot+' é carregada pelas salas (linhas usadas: '+[...roomSlots].join(', ')+'). Escolha outra linha ou use a paleta compartilhada.')
  if(reserved.has(palette.slot))problems.push('Paleta própria: a linha '+palette.slot+' está reservada pelo jogo.')
  const first=config.definitions.map(d=>characters.get(d.character)).find(c=>c&&!c.problem)
  if(first){try{target=paletteWords(imageOf(root,first));targetName=first.resource}catch(error){problems.push('Paleta própria: '+error.message)}}
 }else if(needsPalette){
  if(!palette.from)problems.push('Paleta compartilhada: escolha de qual personagem é a paleta carregada na linha '+palette.slot+' (normalmente o jogador).')
  else{
   const owner=characters.get(palette.from)
   if(!owner||owner.problem)problems.push('Paleta compartilhada: '+(owner?.problem||'personagem não encontrado.'))
   else try{target=paletteWords(imageOf(root,owner));targetName=owner.resource}catch(error){problems.push('Paleta compartilhada: '+error.message)}
  }
 }
 const resources=new Map(),generated=[],resLines=[]
 if(target&&!problems.length){
  for(const file of new Set(config.definitions.map(d=>d.character))){
   const character=characters.get(file);if(!character||character.problem)continue
   let image;try{image=imageOf(root,character)}catch(error){problems.push(character.name+': '+error.message);continue}
   let fit;try{fit=fitToPalette(image,target)}catch(error){problems.push(character.name+': '+error.message);continue}
   const entry={character:character.name,resource:character.resource,exact:fit.exact,changed:fit.changed,worst:fit.worst,generated:false}
   if(fit.identity){resources.set(file,character.resource);report.characters.push(entry);continue}
   // Cópia remapeada para a paleta da linha escolhida; o sprite original fica intacto.
   const symbol='RETRO_ENEMY_SPR_'+macro(character.name),png='res/generated/enemy-'+character.name+'.png'
   const indices=Uint8Array.from(image.indices,index=>fit.map.get(index)??0)
   const words=Array.from({length:16},(_,i)=>target[i]??0)
   generated.push({path:png,bytes:encodeIndexed4({width:image.width,height:image.height,indices,palette:words})})
   resLines.push('SPRITE '+symbol+' "generated/enemy-'+character.name+'.png" '+character.frameWidth/8+' '+character.frameHeight/8+' NONE 0 NONE')
   resources.set(file,symbol)
   Object.assign(entry,{generated:true,symbol,image:png})
   report.characters.push(entry)
   if(!fit.exact)warnings.push(character.name+': '+fit.changed+' cor(es) aproximada(s) para caber na paleta '+palette.slot+' de '+targetName+'.')
  }
 }
 let header=null
 const resBytes=resLines.length?Buffer.from('# Gerado pelo Retro Studio (Jogo → Inimigos). Não edite.\n# Sprites dos inimigos encaixados na paleta da linha '+palette.slot+'.\n'+resLines.join('\n')+'\n'):null
 if(!problems.length){
  try{header=Buffer.from(compileEnemyHeader(config,resolved,{slot:palette.slot,resources,header:resBytes?'enemies.h':null,ownPalette:targetName}))}
  catch(error){problems.push(error.message)}
 }
 const outputs=header?[{path:ENEMY_HEADER,bytes:header},...(resBytes?[{path:ENEMY_RESOURCE_FILE,bytes:resBytes}]:[]),...generated]:[]
 return {problems,warnings,resolved,outputs,report,list,worldHash:world.hash,
  summary:{definitions:config.definitions.length,instances:resolved.instanceCount,
   rooms:resolved.rooms.map(room=>({id:room.id,name:room.name,count:room.spawns.length,
    spawns:room.spawns.map(s=>({objectId:s.objectId,name:s.name,enemy:config.definitions[s.definition].id,x:s.x,y:s.y,respawn:s.respawn}))}))}}
}

function conflicts(root,ownership,paths){
 const list=[]
 for(const file of paths){
  const current=bounded(root,file,IMAGE_LIMIT)
  if(current!==null&&hash(current)!==ownership?.files?.[file])list.push(file)
 }
 return list
}

/** Estado para o editor. draft: configuração ainda não salva, para conferir problemas ao vivo. */
export function enemyConfigurationStatus(root,{draft}={}){
 const state=readState(root)
 let config=draft&&typeof draft==='object'?draft:state.config,configError=''
 try{validateEnemyConfiguration(config)}catch(error){configError=error.message}
 const base={config,revision:state.revision,configured:state.source!==null,configError,
  characters:listCharacters(root).map(({path,name,exported,animations})=>({path,name,exported,animations}))}
 if(configError)return {...base,problems:[configError],warnings:[]}
 const result=plan(root,config)
 const owned=Object.keys(state.ownership?.files||{})
 const custom=conflicts(root,state.ownership,[...new Set([...result.outputs.map(o=>o.path),...owned,ENEMY_HEADER])])
 const upToDate=!result.problems.length&&result.outputs.every(o=>{const current=bounded(root,o.path,IMAGE_LIMIT);return current!==null&&current.equals(o.bytes)})
 return {...base,problems:result.problems,warnings:result.warnings,summary:result.summary,palette:result.report,
  fallbacks:Object.fromEntries(result.resolved.definitions.map(d=>[d.id,d.fallbacks])),
  generatedConflicts:custom,upToDate,hasExport:state.ownership!==null}
}

/** Salva a fonte e, se tudo resolver, publica C, .res e PNGs juntos. Com problemas, salva só a fonte
 * (para não perder a edição) e devolve os problemas; o build fica bloqueado até corrigir. */
export function saveEnemyConfiguration(root,{config,revision}={}){
 validateEnemyConfiguration(config)
 const state=readState(root)
 if(typeof revision!=='string'||revision!==state.revision)throw Error('Os inimigos mudaram em outro lugar; recarregue antes de salvar.')
 const source=Buffer.from(JSON.stringify(config,null,2)+'\n')
 if(source.length>LIMIT)throw Error('enemies.json passou de 1 MiB.')
 const result=plan(root,config)
 const outputs=[{path:ENEMY_SOURCE,bytes:source,expectedHash:hash(state.source)}]
 if(!result.problems.length){
  const owned=Object.keys(state.ownership?.files||{}),next=new Set(result.outputs.map(o=>o.path))
  const custom=conflicts(root,state.ownership,[...new Set([...next,...owned])])
  if(custom.length)throw Error('Arquivo gerado personalizado fora da IDE foi preservado: '+custom.join(', ')+'. Mova suas mudanças para outro arquivo ou apague-o para a IDE gerar de novo.')
  const files={}
  for(const output of result.outputs){
   const current=bounded(root,output.path,IMAGE_LIMIT)
   outputs.push({...output,expectedHash:hash(current)})
   files[output.path]=hash(output.bytes)
  }
  // Gerados que deixaram de existir (ex.: cores agora compatíveis): remove só se ainda forem nossos.
  for(const file of owned)if(!next.has(file)&&bounded(root,file,IMAGE_LIMIT)!==null)outputs.push({path:file,remove:true,expectedHash:state.ownership.files[file]})
  outputs.push({path:RECORD,bytes:Buffer.from(JSON.stringify({version:1,files},null,2)+'\n'),expectedHash:hash(state.record)})
 }
 const receipt=publishProjectOutputs(root,outputs,{producer:'enemy-export',beforePublish:()=>{
  if(readRooms(root).hash!==result.worldHash)throw Error('Um mapa ou o mundo mudou durante a exportação dos inimigos; tente de novo.')
 }})
 return {...receipt,...enemyConfigurationStatus(root),exported:!result.problems.length}
}

/** Reexporta sem mudar a fonte (depois de salvar um mapa ou exportar um personagem). */
export function exportEnemies(root){
 const state=readState(root)
 if(state.source===null)return {configured:false}
 return saveEnemyConfiguration(root,{config:state.config,revision:state.revision})
}

/** Antes do build: sem enemies.json nada muda; com ele, o C precisa estar exportado e atual. */
export function validateEnemiesForBuild(root){
 if(bounded(root,ENEMY_SOURCE)===null)return {configured:false}
 const status=enemyConfigurationStatus(root)
 if(status.problems.length)throw Error('Inimigos: '+status.problems[0])
 if(status.generatedConflicts.length)throw Error('Inimigos: arquivo gerado personalizado fora da IDE ('+status.generatedConflicts[0]+'); foi preservado, revise antes do build.')
 if(!status.hasExport)throw Error('O C dos inimigos ainda não foi exportado. Use Jogo → Inimigos → Salvar e exportar.')
 if(!status.upToDate)throw Error('Inimigos: os mapas ou personagens mudaram desde a última exportação. Use Jogo → Inimigos → Salvar e exportar.')
 return {configured:true,definitions:status.summary.definitions,instances:status.summary.instances}
}
export {ENEMY_ROLES}
