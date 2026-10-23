// #50: audio catalog -> managed rescomp file and headers; games without audio/audio.json stay untouched.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {AUDIO_DRIVERS,AUDIO_PREVIEW_FORMATS,AUDIO_RESOURCE_FILE,createAudioConfiguration,validateAudioConfiguration,compileAudioHeader,
 compileAudioSgdkHeader,compileAudioResources,audioMusicRows,audioEffectRows} from '../../shared/retro/audioConfiguration.js'
import {validateWorldConfiguration} from '../../shared/retro/worldConfiguration.js'
const SOURCE='audio/audio.json',HEADER='src/generated/audio_config.h',SGDK='src/generated/audio_sgdk.h',RECORD='.retrostudio/audio-export.json'
const WORLD='world/world.json',CUTSCENES='cutscenes/cutscene-config.json',OUTPUTS=[HEADER,SGDK,AUDIO_RESOURCE_FILE]
const LIMIT=256*1024,MEDIA_LIMIT=16*1024*1024
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
function worldRooms(root){
 const bytes=readProjectOutput(root,WORLD)
 if(bytes===null)return {rooms:[],hash:null}
 if(bytes.length>1024*1024)throw Error('World configuration exceeds 1 MiB.')
 const world=validateWorldConfiguration(JSON.parse(bytes.toString('utf8')),{allowEmpty:true})
 return {hash:hash(bytes),rooms:world.rooms.map(room=>({id:room.id,name:room.name}))}
}
function read(root){
 const source=readProjectOutput(root,SOURCE),record=readProjectOutput(root,RECORD),outputs=OUTPUTS.map(file=>readProjectOutput(root,file))
 if([source,record,...outputs].some(bytes=>bytes&&bytes.length>LIMIT))throw Error('Audio configuration exceeds 256 KiB.')
 const config=source===null?createAudioConfiguration():JSON.parse(source.toString('utf8'))
 validateAudioConfiguration(config)
 let ownership=null
 if(record!==null){
  try{ownership=JSON.parse(record.toString('utf8'))}catch{ownership=null}
  if(!ownership||typeof ownership!=='object'||ownership.version!==1||!ownership.files||typeof ownership.files!=='object'||
   OUTPUTS.some(file=>!/^[a-f0-9]{64}$/.test(ownership.files[file])))throw Error('Unsupported audio export record.')
 }
 // An output is ours only when its bytes match the hash recorded at export time.
 const conflicts=OUTPUTS.filter((file,index)=>outputs[index]!==null&&hash(outputs[index])!==ownership?.files[file])
 return {config,source,record,outputs,ownership,conflicts,revision:hash(Buffer.from(JSON.stringify([source,record,...outputs].map(hash))))}
}
// Digest of the original files: part of the .res so that replacing a WAV/VGM is a visible, rebuildable change.
function mediaDigest(root,config){
 const digest=createHash('sha256')
 for(const row of [...audioMusicRows(config),...audioEffectRows(config)]){
  const file=media(root,row.source),bytes=file.exists?file.read():null
  digest.update(row.symbol+'\0'+(bytes?hash(bytes):file.exists?'large:'+file.bytes:'missing')+'\0')
 }
 return digest.digest('hex').slice(0,32)
}
const compile=(root,config,options)=>[compileAudioHeader(config,options),compileAudioSgdkHeader(config,options),compileAudioResources(config,options,mediaDigest(root,config))].map(text=>Buffer.from(text))
// RIFF/WAVE facts needed for the report; rescomp does the real conversion.
function wave(bytes){
 if(bytes.length<12||bytes.toString('latin1',0,4)!=='RIFF'||bytes.toString('latin1',8,12)!=='WAVE')return null
 let format=null,data=null
 for(let at=12;at+8<=bytes.length;){
  const id=bytes.toString('latin1',at,at+4),size=bytes.readUInt32LE(at+4)
  if(id==='fmt '&&size>=16&&at+24<=bytes.length)format={tag:bytes.readUInt16LE(at+8),channels:bytes.readUInt16LE(at+10),rate:bytes.readUInt32LE(at+12),bits:bytes.readUInt16LE(at+22)}
  if(id==='data')data=Math.min(size,bytes.length-at-8)
  at+=8+size+(size&1)
 }
 if(!format||data===null||!format.channels||!format.rate||!format.bits)return null
 return {...format,seconds:data/(format.channels*format.rate*Math.ceil(format.bits/8))}
}
function media(root,file){
 try{
  const full=path.join(root,file),real=fs.realpathSync(full),base=fs.realpathSync(root)
  if(real!==base&&!real.startsWith(base+path.sep))return {exists:false,outside:true}
  const stat=fs.statSync(real)
  if(!stat.isFile())return {exists:false}
  return {exists:true,bytes:stat.size,read:()=>stat.size>MEDIA_LIMIT?null:fs.readFileSync(real)}
 }catch{return {exists:false}}
}
function candidates(root){
 const found=[],skip=new Set(['node_modules','out','.git','.retrostudio','generated'])
 const walk=(relative,depth)=>{
  let entries=[];try{entries=fs.readdirSync(path.join(root,relative),{withFileTypes:true})}catch{return}
  for(const entry of entries.sort((a,b)=>a.name<b.name?-1:1)){
   if(found.length>=400)return
   const next=relative?relative+'/'+entry.name:entry.name
   if(entry.isDirectory()){if(depth<4&&!skip.has(entry.name))walk(next,depth+1)}
   else if(entry.isFile()&&/\.(vgm|xgm|wav|ogg|mp3)$/i.test(entry.name))found.push(next)
  }
 }
 walk('audio',0);walk('res',0)
 return found
}
const toolkitDrivers=toolkit=>{
 if(typeof toolkit!=='string'||!toolkit)return null
 const has=name=>[toolkit,path.join(toolkit,'m68k-elf')].some(base=>fs.existsSync(path.join(base,'inc',name))||fs.existsSync(path.join(base,'inc','snd',name)))
 return {xgm:has('xgm.h'),xgm2:has('xgm2.h')}
}
/** Formats, sizes and conflicts of the catalog against the project and the driver. */
export function audioReport(root,config,{toolkit}={}){
 const driver=AUDIO_DRIVERS[config.driver],issues=[],entries=[]
 const issue=(severity,code,message,id)=>issues.push({severity,code,message,...(id?{id}:{})})
 const sources=new Map();let romBytes=0
 const inspect=(kind,row,item)=>{
  const file=media(root,row.source),ext=path.extname(row.source).toLowerCase(),entry={kind,id:row.id,index:row.index,symbol:row.symbol,source:row.source,format:ext.slice(1),exists:file.exists,bytes:file.bytes||0,romBytes:0,preview:item.preview||'',previewExists:false}
  if(!file.exists)issue('error','missing-source',(kind==='music'?'Música':'Efeito')+' “'+row.id+'”: arquivo original não encontrado ('+row.source+').',row.id)
  else if(kind==='effect'){
   const bytes=file.read(),info=bytes&&wave(bytes)
   if(!info)issue('error','invalid-wav','Efeito “'+row.id+'”: o arquivo não é um WAV legível'+(bytes?'':' (maior que 16 MB)')+'.',row.id)
   else{
    Object.assign(entry,{rate:info.rate,channels:info.channels,bits:info.bits,seconds:info.seconds})
    if(info.tag===0xFFFE)issue('warning','wav-extensible','Efeito “'+row.id+'”: WAV no formato estendido; se o build recusar, exporte como PCM simples.',row.id)
    else if(info.tag!==1)issue('error','wav-not-pcm','Efeito “'+row.id+'”: o WAV precisa ser PCM sem compressão.',row.id)
    // The driver plays 8-bit mono at a fixed rate; rescomp resamples and pads to 256 bytes.
    entry.romBytes=Math.ceil(info.seconds*driver.sampleRate/256)*256
    if(info.seconds>4)issue('warning','long-effect','Efeito “'+row.id+'”: '+info.seconds.toFixed(1)+' s ocupam cerca de '+Math.round(entry.romBytes/1024)+' KiB de ROM.',row.id)
    if(info.rate!==driver.sampleRate||info.channels!==1||info.bits!==8)issue('info','wav-converted','Efeito “'+row.id+'”: '+info.rate+' Hz, '+info.channels+' canal(is), '+info.bits+' bits será convertido para '+driver.sampleRate+' Hz mono 8 bits.',row.id)
   }
  }else{
   // VGM/XGM size is an upper bound: xgmtool usually shrinks FM data but keeps samples.
   entry.romBytes=file.bytes
   if(ext==='.vgm'&&(file.read()?.toString('latin1',0,4)??'Vgm ')!=='Vgm ')issue('error','invalid-vgm','Música “'+row.id+'”: o arquivo não tem a assinatura VGM (arquivos .vgz precisam ser descompactados).',row.id)
  }
  if(item.preview){
   entry.previewExists=media(root,item.preview).exists
   if(!entry.previewExists)issue('warning','missing-preview',(kind==='music'?'Música':'Efeito')+' “'+row.id+'”: prévia não encontrada ('+item.preview+').',row.id)
  }else if(kind==='music')issue('info','no-preview','Música “'+row.id+'”: sem prévia. A IDE não sintetiza VGM; indique um .ogg, .wav ou .mp3 renderizado para ouvir no editor.',row.id)
  if(sources.has(row.source))issue('warning','shared-source','“'+row.id+'” e “'+sources.get(row.source)+'” usam o mesmo arquivo; ele entra duas vezes na ROM.',row.id)
  sources.set(row.source,row.id);romBytes+=entry.romBytes;entries.push(entry)
 }
 for(const row of audioMusicRows(config))inspect('music',row,config.music.find(item=>item.id===row.id))
 for(const row of audioEffectRows(config))inspect('effect',row,config.effects.find(item=>item.id===row.id))
 // Other .res files: symbol clashes and resource types rescomp does not have.
 const symbols=new Set(entries.map(entry=>entry.symbol))
 let files=[];try{files=fs.readdirSync(path.join(root,'res')).filter(name=>name.endsWith('.res')).sort()}catch{files=[]}
 for(const name of files){
  if('res/'+name===AUDIO_RESOURCE_FILE)continue
  const bytes=readProjectOutput(root,'res/'+name);if(bytes===null||bytes.length>1024*1024)continue
  bytes.toString('utf8').split(/\r?\n/).forEach((line,index)=>{
   const match=line.match(/^\s*([A-Za-z0-9_]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:"([^"]*)"|(\S+))/);if(!match)return
   const target=path.posix.normalize('res/'+(match[3]??match[4]))
   if(sources.has(target))issue('warning','duplicate-resource','res/'+name+':'+(index+1)+': '+target+' também está no catálogo de áudio (“'+sources.get(target)+'”); o arquivo entra duas vezes na ROM.')
   if(match[1]==='SOUND')issue('error','invalid-resource-type','res/'+name+':'+(index+1)+': o rescomp não tem o tipo SOUND; use XGM para música e WAV para efeitos, ou cadastre o arquivo neste catálogo.')
   if(symbols.has(match[2]))issue('error','symbol-conflict','res/'+name+':'+(index+1)+': o símbolo '+match[2]+' também é gerado pelo catálogo de áudio.')
   if(['XGM2'].includes(match[1])&&config.driver==='xgm')issue('warning','driver-mix','res/'+name+':'+(index+1)+': recurso XGM2 em um projeto configurado para o driver XGM.')
  })
 }
 // Cutscene vocabulary is a separate file the IDE never rewrites: report what does not match.
 try{
  const bytes=readProjectOutput(root,CUTSCENES),vocabulary=bytes&&bytes.length<=LIMIT?JSON.parse(bytes.toString('utf8')):null
  const check=(list,prefix,rows,label)=>{
   for(const item of Array.isArray(list)?list:[]){
    const value=String(item?.value??''),known=rows.some(row=>value===prefix+row.id.toUpperCase()||value===String(row.index))
    if(!known)issue('warning','cutscene-vocabulary','Cutscenes: '+label+' “'+(item?.id??'?')+'” usa o valor '+(value||'(vazio)')+', que não é um número nem uma macro deste catálogo.')
   }
  }
  if(vocabulary){check(vocabulary.sounds,'RETRO_PROJECT_AUDIO_SFX_',audioEffectRows(config),'som');check(vocabulary.music,'RETRO_PROJECT_AUDIO_MUSIC_',audioMusicRows(config),'música')}
 }catch{issue('warning','cutscene-vocabulary','Cutscenes: cutscene-config.json não pôde ser lido para conferir sons e músicas.')}
 const drivers=toolkitDrivers(toolkit)
 if(drivers&&!drivers[config.driver])issue('error','driver-unavailable','O toolkit configurado não tem o driver '+driver.name+'.')
 return {driver:{id:config.driver,name:driver.name,musicFormats:driver.music,effectFormats:driver.effects,previewFormats:AUDIO_PREVIEW_FORMATS,
  pcmChannels:driver.pcmChannels,effectChannels:config.effectChannels,sampleRate:driver.sampleRate,maxEffects:driver.maxEffects,toolkit:drivers},
  entries,romBytes,issues,errors:issues.filter(item=>item.severity==='error').length}
}
/** options.draft: unsaved catalog to report on (never written). */
export function audioConfigurationStatus(root,options={}){
 const data=read(root);let rooms=[],worldError='',worldUnreadable=false
 try{rooms=worldRooms(root).rooms}catch(error){worldError=error.message;worldUnreadable=true}
 if(!worldUnreadable)try{validateAudioConfiguration(data.config,{rooms:rooms.map(room=>room.id)})}catch(error){worldError=error.message}
 if(options.draft!==undefined&&options.draft!==null){validateAudioConfiguration(options.draft);return {revision:data.revision,candidates:candidates(root),report:audioReport(root,options.draft,options)}}
 return {config:data.config,revision:data.revision,exported:data.source!==null,rooms,worldError,worldUnreadable,outputConflicts:data.conflicts,
  candidates:candidates(root),report:audioReport(root,data.config,options)}
}
export function saveAudioConfiguration(root,{config,revision}={},options={}){
 validateAudioConfiguration(config)
 const data=read(root)
 if(typeof revision!=='string'||revision!==data.revision)throw Error('Audio configuration changed; reload before saving.')
 if(data.conflicts.length)throw Error('Generated audio file is customized or unmanaged; existing file preserved: '+data.conflicts.join(', '))
 const world=worldRooms(root),settings={rooms:world.rooms.map(room=>room.id)}
 const plan=prepareAudioConfiguration(root,config,settings)
 const receipt=publishProjectOutputs(root,plan.outputs,{producer:'audio-configuration',beforePublish:()=>{
  if(worldRooms(root).hash!==world.hash)throw Error('World configuration changed during audio export.')
 }})
 return {...receipt,...audioConfigurationStatus(root,options)}
}
/** Prepare audio outputs for the world transaction without publishing a partial catalog. */
function prepareAudioConfiguration(root,config,settings){
 const data=read(root)
 if(data.conflicts.length)throw Error('Generated audio file is customized or unmanaged; existing file preserved: '+data.conflicts.join(', '))
 const compiled=compile(root,config,settings)
 const source=Buffer.from(JSON.stringify(config,null,2)+'\n')
 if([source,...compiled].some(bytes=>bytes.length>LIMIT))throw Error('Audio configuration exceeds 256 KiB.')
 const record=Buffer.from(JSON.stringify({version:1,files:Object.fromEntries(OUTPUTS.map((file,index)=>[file,hash(compiled[index])]))},null,2)+'\n')
 return {outputs:[
  {path:SOURCE,bytes:source,expectedHash:hash(data.source)},
  ...OUTPUTS.map((file,index)=>({path:file,bytes:compiled[index],expectedHash:hash(data.outputs[index])})),
  {path:RECORD,bytes:record,expectedHash:hash(data.record)}
 ]}
}
/** Empty map selections retain the audio editor's room default. */
export function prepareMapMusicExport(root,selections,rooms){
 if(!selections.length)return {outputs:[]}
 const data=read(root)
 if(data.source===null)throw Error('A música do mapa exige um catálogo em Áudio. Salve e exporte o áudio antes do mundo.')
 const config=structuredClone(data.config)
 for(const selection of selections){
  if(!config.music.some(track=>track.id===selection.music))throw Error('Audio room points to unknown music: '+selection.music)
  const existing=config.rooms.find(row=>row.room===selection.room)
  if(existing)existing.music=selection.music
  else config.rooms.push(selection)
 }
 return prepareAudioConfiguration(root,config,{rooms})
}
/** Opt-in preflight: no audio source means legacy/custom projects are untouched.
 * Never exports or executes project code. */
export function validateAudioForBuild(root){
 if(readProjectOutput(root,SOURCE)===null)return {configured:false}
 const data=read(root),settings={rooms:worldRooms(root).rooms.map(room=>room.id)},compiled=compile(root,data.config,settings)
 if(data.ownership===null||data.outputs.some(bytes=>bytes===null))throw Error('O áudio ainda não foi exportado. Use Salvar e exportar áudio.')
 if(data.conflicts.length)throw Error('Um arquivo gerado de áudio foi personalizado ('+data.conflicts.join(', ')+'); revise-o antes do build. O arquivo foi preservado.')
 const report=audioReport(root,data.config),first=report.issues.find(item=>item.severity==='error')
 if(first)throw Error(first.message)
 if(compiled.some((bytes,index)=>!bytes.equals(data.outputs[index]))){
  // Same catalog, different bytes in the originals: say which kind of change it was.
  const sameCatalog=Buffer.from(compileAudioHeader(data.config,settings)).equals(data.outputs[0])&&Buffer.from(compileAudioSgdkHeader(data.config,settings)).equals(data.outputs[1])&&
   data.outputs[2].toString('utf8').replace(/^# media .*\n/m,'')===compileAudioResources(data.config,settings)
  throw Error(sameCatalog?'Um arquivo de música ou efeito mudou. Use Salvar e exportar áudio para que ele entre na ROM.':'O catálogo de áudio mudou. Use Salvar e exportar áudio antes do build.')
 }
 return {configured:true,revision:data.revision,music:data.config.music.length,effects:data.config.effects.length,romBytes:report.romBytes}
}
