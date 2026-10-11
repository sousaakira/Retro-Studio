// #46: one read-only view of every managed export of a project. Nothing is exported or repaired here.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readProjectOutput} from './exportTransaction.js'
import {validateWorldForBuild} from './worldConfiguration.js'
import {validateCameraForBuild} from './cameraConfiguration.js'
import {validateProgressForBuild} from './progressConfiguration.js'
import {validateAudioForBuild} from './audioConfiguration.js'
import {validateCutsceneAdapterForBuild} from './cutsceneAdapter.js'
import {validateDebugForBuild} from './debugConfiguration.js'
import {validatePaletteForBuild} from './paletteConfiguration.js'
import {validateHudForBuild} from './hudConfiguration.js'
import {validateGameForBuild} from './gameHost.js'
import {GAME_HOST_FILES} from '../../shared/retro/gameHost.js'
import {validateInputConfiguration,compileInputHeader} from '../../shared/retro/inputMapping.js'
import {validateMovementConfiguration,compileMovementHeader} from '../../shared/retro/movementConfiguration.js'
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
/** States: absent (not used), current, stale (sources changed since the export),
 * unexported (saved but never exported), conflict (generated file changed outside
 * the IDE; it is preserved), failed (could not be read or validated). */
const row=(id,title,editor,state,message='',files=[])=>({id,title,editor,state,message,files})
// Build gates already say exactly why a build would be refused; their wording decides the state.
function gate(id,title,editor,files,validate,root){
 try{
  const result=validate(root)
  return row(id,title,editor,result.configured?'current':'absent','',files)
 }catch(error){
  const text=error.message
  const state=/personalizad|customized|unmanaged/i.test(text)?'conflict':/ainda não foi exportad|sumiu|not exported/i.test(text)?'unexported':/mudou|mudaram|changed|stale/i.test(text)?'stale':'failed'
  return row(id,title,editor,state,text,files)
 }
}
// Source + header + ownership record, for the exports that have no build gate of their own.
function header(id,title,editor,source,target,record,validate,compile,root){
 const files=[source,target]
 try{
  const sourceBytes=readProjectOutput(root,source),headerBytes=readProjectOutput(root,target),recordBytes=readProjectOutput(root,record)
  if(sourceBytes===null)return row(id,title,editor,headerBytes===null?'absent':'conflict',headerBytes===null?'':'Existe '+target+' sem a fonte '+source+'; o arquivo é preservado.',files)
  const config=JSON.parse(sourceBytes.toString('utf8'));validate(config)
  if(headerBytes===null||recordBytes===null)return row(id,title,editor,'unexported','A fonte foi salva, mas o header ainda não foi exportado.',files)
  const owned=JSON.parse(recordBytes.toString('utf8'))
  if(owned?.hash!==hash(headerBytes))return row(id,title,editor,'conflict','O header foi alterado fora da IDE e será preservado.',files)
  return Buffer.from(compile(config)).equals(headerBytes)?row(id,title,editor,'current','',files):row(id,title,editor,'stale','A fonte mudou depois da última exportação.',files)
 }catch(error){return row(id,title,editor,'failed',error.message,files)}
}
// Scenes compiled by the distributed cutscene compiler: its record lists every source and output with hashes.
function cutscenes(root){
 const id='cutscenes',title='Cenas (cutscenes)',editor='Editor de cenas',config='cutscenes/cutscene-config.json',record='.retrostudio/cutscene-export.json'
 try{
  const scenes=[]
  const walk=(relative,depth)=>{
   const directory=path.join(root,relative)
   if(depth>16||!fs.existsSync(directory)||fs.lstatSync(directory).isSymbolicLink())return
   for(const item of fs.readdirSync(directory,{withFileTypes:true})){
    if(item.name.startsWith('.')||item.isSymbolicLink())continue
    if(item.isDirectory())walk(relative+'/'+item.name,depth+1)
    else if(item.isFile()&&item.name.endsWith('.cutscene.json'))scenes.push(relative+'/'+item.name)
   }
  }
  walk('cutscenes',0)
  const recordBytes=readProjectOutput(root,record)
  if(recordBytes===null)return row(id,title,editor,scenes.length?'unexported':'absent',scenes.length?'Há cenas salvas que ainda não foram compiladas.':'',[config])
  const owned=JSON.parse(recordBytes.toString('utf8'))
  if(!owned||!Array.isArray(owned.files)||!Array.isArray(owned.sources))return row(id,title,editor,'failed','O registro de exportação das cenas não pôde ser lido.',[config])
  const files=owned.files.map(file=>file.path)
  for(const file of owned.files)if(hash(readProjectOutput(root,file.path))!==file.hash)return row(id,title,editor,'conflict',file.path+' foi alterado fora da IDE e será preservado.',files)
  const known=new Map(owned.sources.map(source=>[source.path,source.hash]))
  const current=[config,...scenes.sort()]
  if(current.length!==known.size||current.some(name=>hash(readProjectOutput(root,name))!==known.get(name)))return row(id,title,editor,'stale','Cenas ou vocabulário mudaram depois da última compilação.',files)
  return row(id,title,editor,'current','',files)
 }catch(error){return row(id,title,editor,'failed',error.message,[config])}
}
// Jogo gerado: um arquivo que o programador alterou fica com ele (avisa, não impede o build).
function game(root){
 const files=['game/game.json',...GAME_HOST_FILES],title='Jogador e início (jogo gerado)',editor='Jogador e início'
 const first=gate('game',title,editor,files,validateGameForBuild,root)
 if(first.state!=='current')return first
 const changed=validateGameForBuild(root).conflicts||[]
 return changed.length?row('game',title,editor,'conflict','Alterado fora da IDE e preservado: '+changed.join(', ')+'. A IDE não atualiza mais esses arquivos até você usar “Gerar por cima”.',files):first
}
export function exportOverview(projectPath){
 const root=fs.realpathSync(projectPath)
 const rows=[
  gate('world','Salas e mapas do mundo','Salas e conexões',['world/world.json','src/generated/world_config.h','src/generated/world_maps.h'],validateWorldForBuild,root),
  header('input','Controles','Configurar controles','controls/input-map.json','src/generated/input_map.h','.retrostudio/input-export.json',validateInputConfiguration,compileInputHeader,root),
  header('movement','Física do personagem','Física e sala de testes','physics/movement.json','src/generated/movement_config.h','.retrostudio/movement-export.json',validateMovementConfiguration,compileMovementHeader,root),
  gate('camera','Câmera','Câmera',['camera/camera.json','src/generated/camera_config.h'],validateCameraForBuild,root),
  gate('audio','Áudio','Áudio: músicas e efeitos',['audio/audio.json','res/audio_resources.res','src/generated/audio_config.h','src/generated/audio_sgdk.h'],validateAudioForBuild,root),
  gate('progress','Progresso e save','Progresso e save',['progress/progress.json','src/generated/progress_config.h'],validateProgressForBuild,root),
  cutscenes(root),
  gate('cutscene-adapter','Gatilhos e flags de cutscene','Cutscenes: gatilhos e flags',['src/generated/cutscene_adapter.h'],validateCutsceneAdapterForBuild,root),
  gate('debug','Diagnóstico em jogo','Diagnóstico em jogo',['debug/debug.json','src/generated/debug_config.h'],validateDebugForBuild,root),
  gate('palettes','Paletas, ciclos e fades','Paletas e composição',['palettes/palettes.json','src/generated/palette_config.h'],validatePaletteForBuild,root),
  gate('hud','HUD, fonte, menus e diálogo','HUD e textos',['hud/hud.json','src/generated/hud_config.h'],validateHudForBuild,root),
  game(root)
 ]
 const count=state=>rows.filter(item=>item.state===state).length
 // Gates block the build; input, movement and scenes have none, so their problems only warn.
 const gated=new Set(['world','camera','audio','progress','cutscene-adapter','debug','palettes','hud'])
 // 'game' impede o build quando falta exportar; arquivo gerado assumido pelo programador (conflict) não impede.
 const blocked=item=>gated.has(item.id)?!['current','absent'].includes(item.state):item.id==='game'&&!['current','absent','conflict'].includes(item.state)
 return {rows,summary:{current:count('current'),absent:count('absent'),attention:rows.length-count('current')-count('absent')},
  blocksBuild:rows.filter(blocked).map(item=>item.id)}
}
