// #59: explicit PAL/NTSC framing profiles and per-room regions; video ticks only.
import {worldNumericId} from './worldConfiguration.js'
// [key, minimum, maximum, scale]: scale 256 = Q8 px/tick, 1 = whole pixels/steps.
export const CAMERA_FIELDS=Object.freeze([
 ['maxSpeedX',1/256,32,256],['maxSpeedY',1/256,32,256],['lookAheadSpeed',0,32,256],['scriptReturnSpeed',0,32,256],
 ['deadZoneWidth',0,320,1],['deadZoneHeight',0,240,1],['focusX',-160,160,1],['focusY',-120,120,1],
 ['lookAheadX',0,160,1],['smoothingX',0,6,1],['smoothingY',0,6,1]
])
export const CAMERA_VIEW=Object.freeze({width:320,height:224})
const defaults={maxSpeedX:8,maxSpeedY:8,lookAheadSpeed:1,scriptReturnSpeed:4,deadZoneWidth:48,deadZoneHeight:32,
 focusX:0,focusY:0,lookAheadX:24,smoothingX:2,smoothingY:2,followX:true,followY:true}
const identifier=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const integer=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw Error('Invalid camera '+label+'.');return value}
function rectangle(value,label,size){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Missing camera '+label+'.')
 integer(value.x,0,32766,label+' X');integer(value.y,0,32766,label+' Y')
 integer(value.width,1,32767,label+' width');integer(value.height,1,32767,label+' height')
 if(size&&(value.x+value.width>size.width||value.y+value.height>size.height))throw Error('Camera '+label+' exceeds room bounds.')
}
const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height
export function createCameraConfiguration(){
 return {format:'retro-studio.camera',version:1,timing:'video-ticks',profiles:{ntsc:{...defaults},pal:{...defaults}},rooms:[]}
}
/** rooms: optional {id:{width,height}} from the world graph. When supplied, every
 * camera room must exist there and regions are checked against its pixel size. */
export function validateCameraConfiguration(value,{rooms}={}){
 if(!value||value.format!=='retro-studio.camera'||value.version!==1||value.timing!=='video-ticks'||!value.profiles)
  throw Error('Unsupported camera configuration or timing policy.')
 for(const region of ['ntsc','pal']){
  const p=value.profiles[region]
  if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Missing '+region+' camera profile.')
  for(const [key,min,max,scale] of CAMERA_FIELDS)
   if(typeof p[key]!=='number'||!Number.isFinite(p[key])||p[key]<min||p[key]>max||!Number.isInteger(p[key]*scale))
    throw Error(region+'.'+key+': invalid range or precision.')
  if(typeof p.followX!=='boolean'||typeof p.followY!=='boolean')throw Error(region+': invalid follow axes.')
  if(p.lookAheadX>0&&p.lookAheadSpeed<=0)throw Error(region+': look-ahead needs a speed.')
 }
 if(!Array.isArray(value.rooms)||value.rooms.length>64)throw Error('Invalid camera rooms.')
 const seen=new Set()
 for(const room of value.rooms){
  if(!room||typeof room.id!=='string'||!identifier.test(room.id)||seen.has(room.id))throw Error('Invalid or duplicate camera room ID.')
  seen.add(room.id)
  const size=rooms&&Object.hasOwn(rooms,room.id)?rooms[room.id]:null
  if(rooms&&!size)throw Error('Camera room is not in the world graph: '+room.id)
  if(!Array.isArray(room.regions)||room.regions.length>32)throw Error('Invalid camera regions: '+room.id)
  const names=new Set(),numbers=new Set()
  for(const item of room.regions){
   if(!item||typeof item.id!=='string'||!identifier.test(item.id))throw Error('Invalid camera region ID.')
   const number=worldNumericId(item.id)
   if(names.has(item.id)||numbers.has(number))throw Error('Duplicate or colliding camera region ID: '+item.id)
   names.add(item.id);numbers.add(number)
   if(typeof item.name!=='string'||!item.name.trim()||item.name.length>128)throw Error('Invalid camera region name.')
   rectangle(item.area,'region area',size);rectangle(item.limits,'region limits',size)
   integer(item.priority,0,255,'region priority')
   if(typeof item.lock!=='boolean')throw Error('Invalid camera region lock.')
   if(typeof item.transitionSpeed!=='number'||!Number.isFinite(item.transitionSpeed)||item.transitionSpeed<0||
    item.transitionSpeed>32||!Number.isInteger(item.transitionSpeed*256))throw Error('Invalid camera region transition speed.')
   if(size&&(item.limits.width<Math.min(CAMERA_VIEW.width,size.width)||item.limits.height<Math.min(CAMERA_VIEW.height,size.height)))
    throw Error('Camera region limits are smaller than the screen: '+item.id)
  }
  // Explicit priority: two regions may only share pixels when their priorities differ.
  room.regions.forEach((a,i)=>room.regions.slice(i+1).forEach(b=>{
   if(a.priority===b.priority&&overlap(a.area,b.area))throw Error('Camera regions '+a.id+' and '+b.id+' overlap with the same priority.')
  }))
 }
 return value
}
export const cameraProfileRow=profile=>CAMERA_FIELDS.map(([key,,,scale])=>profile[key]*scale).concat(profile.followX?1:0,profile.followY?1:0)
const sorted=items=>[...items].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
/** Rows in exported order; the preview and the C header share this exact data. */
export function cameraRegionRows(room){
 return sorted(room.regions).map(item=>({id:worldNumericId(item.id),source:item.id,area:{...item.area},limits:{...item.limits},
  transitionSpeed:item.transitionSpeed*256,priority:item.priority,flags:item.lock?1:0}))
}
export function compileCameraHeader(value,options){
 validateCameraConfiguration(value,options)
 const rect=r=>'{'+[r.x,r.y,r.width,r.height].join(',')+'}'
 const lines=['/* Generated: pixels and Q8 px/video tick. PAL/NTSC profiles are explicit; no automatic scaling. */',
  '#ifndef RETRO_PROJECT_CAMERA_CONFIG_H','#define RETRO_PROJECT_CAMERA_CONFIG_H','#include "../retro_runtime/retro_camera.h"',
  'typedef struct {uint16_t room;const RetroCameraRegion *regions;uint16_t count;} RetroProjectCameraRoom;',
  'static const RetroCameraConfig retroProjectCameraNtsc={'+cameraProfileRow(value.profiles.ntsc).join(',')+'};',
  'static const RetroCameraConfig retroProjectCameraPal={'+cameraProfileRow(value.profiles.pal).join(',')+'};']
 const rooms=sorted(value.rooms).filter(room=>room.regions.length),rows=[]
 for(const room of rooms){
  const symbol='retroProjectCameraRoom_'+worldNumericId(room.id)
  lines.push('static const RetroCameraRegion '+symbol+'[]={'+cameraRegionRows(room).map(r=>
   '{'+[r.id,rect(r.area),rect(r.limits),r.transitionSpeed,r.priority,r.flags].join(',')+'}').join(',')+'};')
  rows.push('{'+[worldNumericId(room.id),symbol,room.regions.length].join(',')+'}')
 }
 lines.push('static const RetroProjectCameraRoom retroProjectCameraRooms[]={'+(rows.join(',')||'{RETRO_ID_NONE,0,0}')+'};',
  '#define RETRO_PROJECT_CAMERA_ROOM_COUNT '+rows.length,'#endif','')
 return lines.join('\n')
}
