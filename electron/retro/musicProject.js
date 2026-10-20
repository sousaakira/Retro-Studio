// #89: músicas do compositor no projeto. A fonte é music/<id>.song.json; "Exportar para o jogo" grava
// res/music/<id>.vgm (gerado aqui, no processo principal, a partir da fonte validada) e registra a
// faixa no catálogo de áudio pelo mesmo serviço do editor de áudio, para o build aceitar o VGM novo.
// VGM que não foi gerado pelo compositor (hash fora do registro) nunca é sobrescrito.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {audioConfigurationStatus,saveAudioConfiguration} from './audioConfiguration.js'
import {validateSong,normalizeSong} from '../../shared/retro/song.js'
import {songTimeline} from '../../shared/retro/songTimeline.js'
import {writeVgm} from '../../shared/retro/vgm.js'

const FOLDER='music',RECORD='.retrostudio/music-export.json',LIMIT=4*1024*1024
const ID=/^[a-z][a-z0-9_]{0,31}$/
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
const sourcePath=id=>FOLDER+'/'+id+'.song.json'
export const songVgmPath=id=>'res/music/'+id+'.vgm'

function readRecord(root){
 const bytes=readProjectOutput(root,RECORD)
 if(bytes===null)return {bytes,files:{}}
 try{const value=JSON.parse(bytes.toString('utf8'));if(value?.version===1&&value.files&&typeof value.files==='object')return {bytes,files:value.files}}catch{}
 throw Error('Registro de exportação de músicas inválido: '+RECORD)
}
function readSong(root,id){
 if(typeof id!=='string'||!ID.test(id))throw Error('ID de música inválido.')
 const bytes=readProjectOutput(root,sourcePath(id))
 if(bytes===null)return null
 if(bytes.length>LIMIT)throw Error('Música maior que 4 MiB: '+sourcePath(id))
 return {bytes,song:validateSong(JSON.parse(bytes.toString('utf8')))}
}

export function listSongs(root){
 let entries=[]
 try{entries=fs.readdirSync(path.join(root,FOLDER),{withFileTypes:true})}catch{return []}
 const record=(()=>{try{return readRecord(root).files}catch{return {}}})()
 return entries.filter(entry=>entry.isFile()&&entry.name.endsWith('.song.json')).map(entry=>entry.name.slice(0,-10)).filter(id=>ID.test(id)).sort().map(id=>{
  try{
   const {song}=readSong(root,id)
   const vgm=readProjectOutput(root,songVgmPath(id))
   return {id,name:song.name,exported:vgm!==null&&record[songVgmPath(id)]===hash(vgm)}
  }catch(error){return {id,name:id,error:error.message}}
 })
}

export function loadSong(root,id){
 const found=readSong(root,id)
 if(!found)throw Error('Música não encontrada: '+sourcePath(id))
 return {song:found.song,revision:hash(found.bytes)}
}

/**
 * revision: hash da fonte quando foi aberta (null para música nova). exportToGame: também grava o VGM
 * e atualiza o catálogo de áudio. Devolve o que foi gravado e, se o catálogo recusar, o motivo.
 */
export function saveSong(root,{song,revision=null,exportToGame=false}={},options={}){
 const clean=validateSong(normalizeSong(validateSong(song)))
 const current=readProjectOutput(root,sourcePath(clean.id))
 if(hash(current)!==revision)throw Error(current===null?'A música foi apagada fora do editor.':revision===null?'Já existe uma música com o ID “'+clean.id+'”. Escolha outro ID.':'A música mudou no disco depois de aberta. Recarregue antes de salvar.')
 const source=Buffer.from(JSON.stringify(clean,null,1)+'\n')
 if(source.length>LIMIT)throw Error('Música maior que 4 MiB.')
 const outputs=[{path:sourcePath(clean.id),bytes:source,expectedHash:hash(current)}]
 let vgm=null,timeline=null
 if(exportToGame){
  timeline=songTimeline(clean)
  if(timeline.missing.length)throw Error('Instrumento não encontrado: '+timeline.missing.join(', '))
  vgm=Buffer.from(writeVgm(timeline,{title:clean.name}))
  const record=readRecord(root),target=songVgmPath(clean.id),existing=readProjectOutput(root,target)
  if(existing!==null&&record.files[target]!==hash(existing))throw Error(target+' já existe e não foi gerado pelo compositor; nada foi sobrescrito.')
  const files={...record.files,[target]:hash(vgm)}
  outputs.push({path:target,bytes:vgm,expectedHash:hash(existing)},
   {path:RECORD,bytes:Buffer.from(JSON.stringify({version:1,files},null,2)+'\n'),expectedHash:hash(record.bytes)})
 }
 publishProjectOutputs(root,outputs,{producer:'music-composer'})
 const result={song:clean,revision:hash(source),vgm:vgm?{path:songVgmPath(clean.id),bytes:vgm.length,seconds:timeline.end/60,loop:timeline.loopFrame!==null}:null,catalog:null}
 if(exportToGame){
  try{result.catalog=registerInCatalog(root,clean,options)}
  catch(error){result.catalog={registered:false,error:error.message}}
 }
 return result
}

/** Cadastra (ou atualiza) a música no catálogo de áudio e reexporta os recursos de áudio. */
function registerInCatalog(root,song,options){
 const status=audioConfigurationStatus(root,options)
 const config=JSON.parse(JSON.stringify(status.config)),source=songVgmPath(song.id)
 const entry=config.music.find(item=>item.id===song.id)
 if(entry&&entry.source!==source)throw Error('O catálogo de áudio já tem a música “'+song.id+'” apontando para '+entry.source+'. Mude o ID da música ou o do catálogo.')
 if(entry)entry.name=song.name.slice(0,128)
 else config.music.push({id:song.id,name:song.name.slice(0,128),source,preview:'',timing:'ntsc'})
 saveAudioConfiguration(root,{config,revision:status.revision},options)
 return {registered:true,added:!entry}
}
