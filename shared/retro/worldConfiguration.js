// #55: deterministic room graph; authored IDs never depend on array positions.
const identifier=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const integer=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw Error('Invalid world '+label+'.');return value}
const array=(value,max,label)=>{if(!Array.isArray(value)||value.length>max)throw Error('Invalid world '+label+'.');return value}
const id=(value,label)=>{if(typeof value!=='string'||!identifier.test(value))throw Error('Invalid world '+label+' ID.');return value}
export function worldNumericId(value){
 id(value,'stable');let hash=2166136261
 for(const ch of value)hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0
 return hash%65535
}
function unique(items,label){
 const names=new Set(),numbers=new Set()
 for(const item of items){id(item.id,label);const number=worldNumericId(item.id);if(names.has(item.id)||numbers.has(number))throw Error('Duplicate or colliding '+label+' ID: '+item.id);names.add(item.id);numbers.add(number)}
}
function spawn(value,room,label){
 id(value.id,label);integer(value.x,0,room.width-1,label+' X');integer(value.y,0,room.height,label+' Y')
 if(typeof value.facing!=='boolean')throw Error('Invalid world '+label+' facing.')
}
function area(value,room,label){
 if(!value||typeof value!=='object')throw Error('Missing world '+label+' area.')
 integer(value.x,0,room.width-1,label+' X');integer(value.y,0,room.height-1,label+' Y')
 integer(value.width,1,32767,label+' width');integer(value.height,1,32767,label+' height')
 if(value.x+value.width>room.width||value.y+value.height>room.height)throw Error('World '+label+' area exceeds room bounds.')
}
export function createWorldConfiguration(){return {format:'retro-studio.world',version:1,initial:null,conditions:[],rooms:[]}}
export function validateWorldConfiguration(config,{allowEmpty=false}={}){
 if(!config||config.format!=='retro-studio.world'||config.version!==1)throw Error('Unsupported world configuration.')
 const rooms=array(config.rooms,64,'rooms'),conditions=array(config.conditions,64,'conditions')
 unique(rooms,'room');unique(conditions,'condition')
 for(const condition of conditions)if(typeof condition.name!=='string'||!condition.name.trim()||condition.name.length>128)throw Error('Invalid world condition name.')
 if(!rooms.length){if(allowEmpty&&config.initial===null)return config;throw Error('World requires an initial room.')}
 const byId=new Map(rooms.map(room=>[room.id,room])),conditionIds=new Set(conditions.map(c=>c.id))
 for(const room of rooms){
  if(typeof room.name!=='string'||!room.name.trim()||room.name.length>128)throw Error('Invalid world room name.')
  if(typeof room.map!=='string'||room.map.length>1024||!room.map.endsWith('.tmx')||/[\\\x00-\x1f]/.test(room.map)||room.map.startsWith('/')||/^[A-Za-z]:/.test(room.map)||room.map.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid world map path.')
  integer(room.width,1,32767,'room width');integer(room.height,1,32767,'room height')
  array(room.entries,128,'entries');array(room.checkpoints,128,'checkpoints');array(room.exits,128,'exits')
  if(!room.entries.length)throw Error('Room '+room.id+' requires an entry.')
  unique(room.entries,'entry');unique(room.checkpoints,'checkpoint');unique(room.exits,'exit')
  for(const entry of room.entries)spawn(entry,room,'entry')
  for(const checkpoint of room.checkpoints){spawn(checkpoint,room,'checkpoint');area(checkpoint.area,room,'checkpoint')}
  for(const exit of room.exits){
   area(exit.area,room,'exit');id(exit.targetRoom,'destination room');id(exit.targetEntry,'destination entry')
   const target=byId.get(exit.targetRoom)
   if(!target||!target.entries?.some(entry=>entry.id===exit.targetEntry))throw Error('Broken world exit '+room.id+'/'+exit.id+'.')
   array(exit.requires,16,'requirements')
   if(new Set(exit.requires).size!==exit.requires.length||exit.requires.some(condition=>!conditionIds.has(condition)))throw Error('Unknown or duplicate condition on exit '+exit.id+'.')
  }
 }
 if(!config.initial||!byId.has(config.initial.room)||!byId.get(config.initial.room).entries.some(entry=>entry.id===config.initial.entry))throw Error('Invalid world initial room/entry.')
 return config
}
export function compileWorldHeader(config){
 validateWorldConfiguration(config)
 const lines=['#ifndef RETRO_PROJECT_WORLD_H','#define RETRO_PROJECT_WORLD_H','#include "../retro_runtime/retro_world.h"',
  'typedef struct {uint16_t room,id;RetroRect area;} RetroWorldTrigger;',
  'typedef struct {uint16_t room;const char *map;} RetroWorldMapSource;']
 const numeric=worldNumericId,rect=r=>'{'+[r.x,r.y,r.width,r.height].join(',')+'}',spawn=s=>'{'+[numeric(s.id),s.x,s.y,Number(s.facing)].join(',')+'}'
 const sorted=items=>[...items].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
 const rooms=sorted(config.rooms),triggers=[],checkpoints=[],rows=[],sources=[]
 for(const room of rooms){
  const prefix='retroWorldRoom_'+numeric(room.id),entries=sorted(room.entries),points=sorted(room.checkpoints),exits=sorted(room.exits)
  lines.push('static const RetroWorldSpawn '+prefix+'_entries[]={'+entries.map(spawn).join(',')+'};')
  if(points.length)lines.push('static const RetroWorldSpawn '+prefix+'_checkpoints[]={'+points.map(spawn).join(',')+'};')
  const exitRows=[]
  for(const exit of exits){
   const needs=[...exit.requires].sort(),symbol=prefix+'_requires_'+numeric(exit.id)
   if(needs.length)lines.push('static const uint16_t '+symbol+'[]={'+needs.map(numeric).join(',')+'};')
   exitRows.push('{'+[numeric(exit.id),numeric(exit.targetRoom),numeric(exit.targetEntry),needs.length?symbol:'0',needs.length].join(',')+'}')
   triggers.push('{'+numeric(room.id)+','+numeric(exit.id)+','+rect(exit.area)+'}')
  }
  for(const checkpoint of points)checkpoints.push('{'+numeric(room.id)+','+numeric(checkpoint.id)+','+rect(checkpoint.area)+'}')
  if(exits.length)lines.push('static const RetroWorldExit '+prefix+'_exits[]={'+exitRows.join(',')+'};')
  rows.push('{'+[numeric(room.id),room.width,room.height,prefix+'_entries',entries.length,points.length?prefix+'_checkpoints':'0',points.length,exits.length?prefix+'_exits':'0',exits.length].join(',')+'}')
  sources.push('{'+numeric(room.id)+','+JSON.stringify(room.map).replace(/\?/g,'\\?')+'}')
 }
 lines.push('static const RetroWorldRoom retroProjectWorldRooms[]={'+rows.join(',')+'};',
  'static const RetroWorldDefinition retroProjectWorld={retroProjectWorldRooms,'+rooms.length+','+numeric(config.initial.room)+','+numeric(config.initial.entry)+'};',
  'static const RetroWorldMapSource retroProjectWorldMaps[]={'+sources.join(',')+'};',
  'static const RetroWorldTrigger retroProjectWorldExitAreas[]={'+(triggers.join(',')||'{0,0,{0,0,0,0}}')+'};',
  'static const RetroWorldTrigger retroProjectWorldCheckpointAreas[]={'+(checkpoints.join(',')||'{0,0,{0,0,0,0}}')+'};',
  '#define RETRO_PROJECT_WORLD_ROOM_COUNT '+rooms.length,
  '#define RETRO_PROJECT_WORLD_EXIT_COUNT '+triggers.length,
  '#define RETRO_PROJECT_WORLD_CHECKPOINT_COUNT '+checkpoints.length,'#endif','')
 return lines.join('\n')
}
