// #63: map triggers and flag links for the reference cutscene host (derived data, no authored source).
import {worldNumericId} from './worldConfiguration.js'
export const CUTSCENE_PLAYED_FIELD='cutscenes_played'
export const cutsceneMacro=id=>String(id).toUpperCase().replace(/[^A-Z0-9]+/g,'_') // same rule as cutscene_ids.h
const entities={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}
const text=value=>value.replace(/&(?:amp|lt|gt|quot|apos);/g,match=>entities[match])
const attributes=tag=>Object.fromEntries([...tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)].map(match=>[match[1],text(match[2])]))
/** Objects of type cutscene_trigger in TMX text, in document order. */
export function parseCutsceneTriggers(tmx){
 const found=[],source=String(tmx).replace(/<!--[\s\S]*?-->/g,'')
 for(const match of source.matchAll(/<object\b([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g)){
  const object=attributes(match[1])
  if((object.type??object.class)!=='cutscene_trigger')continue
  // A property value may be an attribute or, for multiline text, the element body.
  const properties=Object.fromEntries([...(match[3]||'').matchAll(/<property\b([^>]*?)(?:\/>|>([\s\S]*?)<\/property>)/g)].map(item=>{const a=attributes(item[1]);return [a.name,a.value??text((item[2]||'').trim())]}))
  found.push({object:object.id||'?',x:Math.round(Number(object.x)||0),y:Math.round(Number(object.y)||0),width:Math.round(Number(object.width)||0),height:Math.round(Number(object.height)||0),
   cutscene:properties.cutscene||'',start:properties.start||'touch',once:properties.once===undefined?true:properties.once!=='false',
   requiresFlag:properties.requires_flag||'',unlessFlag:properties.unless_flag||''})
 }
 return found
}
/** Triggers the textual reader could not turn into objects (single quotes, unusual
 * markup): reported as an error instead of being dropped in silence. */
export function unparsedCutsceneTriggers(tmx){
 const source=String(tmx).replace(/<!--[\s\S]*?-->/g,'')
 const mentions=(source.match(/(?:type|class)\s*=\s*(["'])cutscene_trigger\1/g)||[]).length
 return Math.max(0,mentions-parseCutsceneTriggers(tmx).length)
}
const START={touch:'CUTSCENE_START_TOUCH',interact:'CUTSCENE_START_INTERACT',enter:'CUTSCENE_START_ENTER'}
/** rooms: [{id,numericId,triggers}]; scenes/flags: IDs of the cutscene project;
 * progress: exported progress configuration or null. Returns {issues,links,played,rooms}. */
export function inspectCutsceneAdapter({rooms,scenes,flags,progress}){
 const issues=[],issue=(severity,code,message)=>issues.push({severity,code,message})
 const sceneIds=new Set(scenes),flagIds=new Set(flags)
 // One namespace, as in cutscene_ids.h: CUTSCENE_<SCENE> and CUTSCENE_FLAG_<FLAG> share it with the runner's own names.
 const macros=new Map(),reserved=/^(?:FLAG|OP|MOVE|FACE|CAMERA|SIDE|INPUT|START|EVENT|ACTOR|ANIM|PORTRAIT|SOUND|MUSIC|ABILITY|MAX)_|^(?:NONE|COUNT|FIXED_ONE|RUNTIME_VERSION)$/
 for(const [kind,prefix,list] of [['Cena','',scenes],['Flag','FLAG_',flags]])for(const id of list){
  const key=prefix+cutsceneMacro(id)
  if(macros.has(key)&&macros.get(key)!==kind+id)issue('error','macro-collision',kind+' “'+id+'” e “'+macros.get(key).replace(/^(Cena|Flag)/,'')+'” viram a mesma macro em cutscene_ids.h.')
  else if(kind==='Cena'&&reserved.test(key))issue('error','macro-collision','Cena “'+id+'” vira a macro CUTSCENE_'+key+', reservada pelo runtime de cutscenes. Use outro ID.')
  macros.set(key,kind+id)
 }
 for(const room of rooms){
  const where='Sala “'+room.id+'”'
  if(room.missing)issue('error','missing-map',where+': o mapa '+room.map+' não foi encontrado; os gatilhos dele não podem ser exportados.')
  if(room.unparsed)issue('error','unparsed-trigger',where+': '+room.unparsed+' gatilho(s) em '+room.map+' não puderam ser lidos (aspas simples ou marcação incomum). Salve o mapa pelo editor de mapas.')
  if(room.triggers.length>32)issue('error','too-many-triggers',where+': '+room.triggers.length+' gatilhos; o runtime acompanha até 32 por sala.')
  for(const trigger of room.triggers){
   const label=where+', objeto '+trigger.object
   if(!trigger.cutscene)issue('error','missing-cutscene',label+': a propriedade cutscene está vazia.')
   else if(!sceneIds.has(trigger.cutscene))issue('error','unknown-cutscene',label+': a cena “'+trigger.cutscene+'” não existe em cutscenes/.')
   if(!Object.hasOwn(START,trigger.start))issue('error','invalid-start',label+': start “'+trigger.start+'” não é touch, interact nem enter.')
   for(const [name,flag] of [['requires_flag',trigger.requiresFlag],['unless_flag',trigger.unlessFlag]])
    if(flag&&!flagIds.has(flag))issue('error','unknown-flag',label+': '+name+' “'+flag+'” não está em cutscene-config.json.')
   if(trigger.start!=='enter'&&(trigger.width<1||trigger.height<1))issue('error','empty-area',label+': a área do gatilho é vazia.')
   if([trigger.x,trigger.y,trigger.width,trigger.height].some(value=>value<-32768||value>32767))issue('error','area-range',label+': posição ou tamanho fora do limite de 16 bits.')
  }
 }
 // Flags are saved only when the progress layout has a flag with the same ID.
 const links=[],saved=new Map((progress?.flags||[]).map(flag=>[flag.id,flag.bit]))
 flags.forEach(id=>{
  if(saved.has(id))links.push({id,bit:saved.get(id)})
  else if(progress)issue('warning','flag-not-saved','Flag de cena “'+id+'” não tem flag de progresso com o mesmo ID; ela se perde ao desligar.')
 })
 const field=(progress?.fields||[]).find(item=>item.id===CUTSCENE_PLAYED_FIELD)||null
 if(progress&&!field&&scenes.length)issue('warning','played-not-saved','O progresso não tem o campo “'+CUTSCENE_PLAYED_FIELD+'”; gatilhos de execução única voltam a disparar depois de continuar.')
 if(field&&scenes.length>field.bytes*8)issue('warning','played-truncated','O campo “'+CUTSCENE_PLAYED_FIELD+'” guarda '+field.bytes*8+' cenas e o projeto tem '+scenes.length+'.')
 if(!progress&&flags.length)issue('info','no-progress','Sem progresso exportado: flags de cena e histórico valem só enquanto o console está ligado.')
 return {issues,errors:issues.filter(item=>item.severity==='error').length,links,played:field?{offset:field.offset,bytes:field.bytes}:null,
  rooms:rooms.map(room=>({id:room.id,numericId:room.numericId,triggers:room.triggers.length})),scenes:scenes.length,flags:flags.length}
}
/** idsInclude: path of cutscene_ids.h relative to src/generated/. */
export function compileCutsceneAdapterHeader(input,idsInclude='../cutscene_ids.h'){
 const report=inspectCutsceneAdapter(input)
 if(report.errors)throw Error(report.issues.find(item=>item.severity==='error').message)
 const flag=id=>id?'CUTSCENE_FLAG_'+cutsceneMacro(id):'-1'
 const lines=['/* Generated: map triggers and scene-flag links for the reference cutscene host. */',
  '#ifndef RETRO_PROJECT_CUTSCENE_ADAPTER_H','#define RETRO_PROJECT_CUTSCENE_ADAPTER_H','#include "../retro_runtime/retro_cutscene_host.h"','#include "'+idsInclude+'"']
 const rows=[],rooms=[...input.rooms].filter(room=>room.triggers.length).sort((a,b)=>a.numericId-b.numericId)
 for(const room of rooms){
  const symbol='retroProjectCutsceneTriggers_'+room.numericId
  lines.push('static const CutsceneTrigger '+symbol+'[]={'+room.triggers.map(t=>'{'+[t.x,t.y,t.width,t.height,'CUTSCENE_'+cutsceneMacro(t.cutscene),START[t.start],t.once?1:0,flag(t.requiresFlag),flag(t.unlessFlag)].join(',')+'}').join(',')+'};')
  rows.push('{'+[room.numericId,symbol,room.triggers.length].join(',')+'}')
 }
 lines.push('static const RetroCutsceneRoomTriggers retroProjectCutsceneRooms[]={'+(rows.join(',')||'{RETRO_ID_NONE,0,0}')+'};','#define RETRO_PROJECT_CUTSCENE_ROOM_COUNT '+rows.length,
  'static const RetroCutsceneFlagLink retroProjectCutsceneFlags[]={'+(report.links.map(link=>'{'+flag(link.id)+','+link.bit+'}').join(',')||'{0,0}')+'};','#define RETRO_PROJECT_CUTSCENE_FLAG_COUNT '+report.links.length,
  '#define RETRO_PROJECT_CUTSCENE_PLAYED_OFFSET '+(report.played?report.played.offset:0),'#define RETRO_PROJECT_CUTSCENE_PLAYED_BYTES '+(report.played?report.played.bytes:0),'#endif','')
 return lines.join('\n')
}
export const cutsceneRoomNumber=id=>id===null?0xFFFF:worldNumericId(id)
