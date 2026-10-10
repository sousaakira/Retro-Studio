// #54: deterministic preview of retro_character.c; no writes to authored data.
import { validateCharacterControllers } from './characterController.js'
import { charsetFrameTicks } from './charsetMaker.js'
export function createCharacterPreview(animations, initialId) {
 const controllers=validateCharacterControllers(animations)
 if(!animations.length||animations.length>128||new Set(animations.map(a=>a.id)).size!==animations.length||animations.some(a=>typeof a.id!=='string'||!a.id))
  throw Error('A prévia exige 1..128 movimentos com IDs exclusivos.')
 const states=animations.map((a,i)=>{
  if(!Number.isInteger(a.frameCount)||a.frameCount<1||a.frameCount>255)throw Error('Quantidade de quadros inválida.')
  return {id:a.id,name:a.name,loop:!!a.loop,ticks:Array.from({length:a.frameCount},(_,f)=>charsetFrameTicks(a,f)),controller:controllers[i]}
 })
 let state,frame=0,remaining=0,elapsed=0,playing=true,ticks=0,events=[],busy=false
 const enter=id=>{
  state=states.find(s=>s.id===id)
  if(!state)throw Error('Movimento inicial inexistente.')
  frame=0;remaining=state.ticks[0];elapsed=0;playing=true
  emit()
 }
 const emit=()=>{
  for(const e of state.controller.events)if(e.frame===frame)
   events.push({...e,animationId:state.id,animationName:state.name,tick:ticks})
  events=events.slice(-32)
 }
 const snapshot=()=>({animationId:state.id,frame,remaining,elapsed,playing,ticks,events:events.map(e=>({...e}))})
 enter(initialId)
 return {
  snapshot,
  tick(conditions=0,predicate=()=>false){
   if(busy)return snapshot()
   busy=true
   try {
   if(!Number.isInteger(conditions)||conditions<0||conditions>0xffffffff)throw Error('Condições de prévia inválidas.')
   ticks++;elapsed=Math.min(65535,elapsed+1)
   let changed=false
   if(playing){
    if(remaining>1)remaining--
    else if(frame+1>=state.ticks.length){
     if(state.loop){frame=0;remaining=state.ticks[0];changed=true}
     else {playing=false;remaining=0}
    }else {frame++;remaining=state.ticks[frame];changed=true}
   }
   let selected=null
   for(const t of state.controller.transitions){
    if(elapsed<t.minimumTicks||((conditions&t.requireAll)>>>0)!==t.requireAll||
     (conditions&t.requireNone)!==0||(t.finished&&playing)||(!state.controller.interruptible&&playing)||
     (t.predicate!==65535&&!predicate(t.predicate)))continue
    if(!selected||t.priority>selected.priority)selected=t
   }
   if(selected)enter(selected.target)
   else if(changed)emit()
   return snapshot()
   } finally {busy=false}
  }
 }
}
