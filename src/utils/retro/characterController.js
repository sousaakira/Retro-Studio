// #54: authored references use animation IDs, never current row indexes.
export const CHARACTER_CONDITIONS = [
 { name:'GROUND', label:'No chão', bit:1 }, { name:'MOVING', label:'Movendo', bit:2 },
 { name:'JUMP', label:'Pulo acionado', bit:4 }, { name:'ATTACK', label:'Ataque acionado', bit:8 },
 { name:'WALL', label:'Na parede', bit:16 }, { name:'ALTERNATE', label:'Forma alternativa', bit:32 },
 { name:'HURT', label:'Ferido', bit:64 }
]
export const CHARACTER_EVENT_TYPES = [
 {id:1,label:'Som'}, {id:2,label:'Ataque'}, {id:3,label:'Projétil'},
 {id:4,label:'Transformação'}, {id:5,label:'Evento do jogo'}
]
const integer=(value,min,max,label)=>{
 if(!Number.isInteger(value)||value<min||value>max)throw Error(`${label}: valor inválido (${min}..${max}).`)
 return value
}
export function normalizeCharacterController(value) {
 if(value==null)return {interruptible:true,transitions:[],events:[]}
 if(typeof value!=='object'||Array.isArray(value)||typeof value.interruptible!=='boolean'||
  !Array.isArray(value.transitions)||!Array.isArray(value.events)||value.transitions.length>512||value.events.length>2048)
  throw Error('Configuração de comportamento inválida.')
 return {interruptible:value.interruptible,
  transitions:value.transitions.map(t=>{
   if(!t||typeof t.target!=='string'||!t.target||typeof t.finished!=='boolean')throw Error('Destino ou término de transição inválido.')
   const all=integer(t.requireAll,0,0xffffffff,'Condições necessárias'),none=integer(t.requireNone,0,0xffffffff,'Condições ausentes')
   if((all&none)!==0)throw Error('Uma condição não pode ser necessária e ausente.')
   return {target:t.target,requireAll:all,requireNone:none,finished:t.finished,
    minimumTicks:integer(t.minimumTicks,0,65535,'Espera'),priority:integer(t.priority,-32768,32767,'Prioridade'),
    predicate:integer(t.predicate ?? 65535,0,65535,'Predicado')}
  }),events:value.events.map(e=>({frame:integer(e?.frame,0,254,'Quadro do evento'),
   type:integer(e?.type,1,65535,'Tipo do evento'),argument:integer(e?.argument,0,65535,'Argumento do evento')}))}
}
export function validateCharacterControllers(animations) {
 const configs=animations.map(a=>normalizeCharacterController(a.controller))
 if(!configs.some(c=>!c.interruptible||c.transitions.length||c.events.length))return configs
 if(animations.length>128)throw Error('O controlador aceita até 128 movimentos.')
 const ids=new Set(animations.map(a=>a.id))
 if(ids.size!==animations.length||animations.some(a=>typeof a.id!=='string'||!a.id))throw Error('IDs de movimentos inválidos ou duplicados.')
 let transitions=0,events=0
 configs.forEach((c,i)=>{
  transitions+=c.transitions.length;events+=c.events.length
  if(transitions>512||events>2048)throw Error('Limite de transições ou eventos excedido.')
  c.transitions.forEach(t=>{if(!ids.has(t.target)||t.target===animations[i].id)throw Error(`Transição sem destino válido: ${animations[i].name}.`)})
  c.events.forEach(e=>{if(e.frame>=animations[i].frameCount)throw Error(`Evento fora da animação: ${animations[i].name}.`)})
 })
 return configs
}
/* Keep events attached to the same pose through timeline edits. */
export function remapCharacterEvents(animation, mapFrame) {
 if(!animation.controller)return
 animation.controller.events=animation.controller.events.flatMap(e=>{
  const frame=mapFrame(e.frame)
  return frame==null?[]:[{...e,frame}]
 })
}
export function setTransitionCondition(transition,bit,value) {
 transition.requireAll=(transition.requireAll&~bit)>>>0
 transition.requireNone=(transition.requireNone&~bit)>>>0
 if(value==='all')transition.requireAll=(transition.requireAll|bit)>>>0
 if(value==='none')transition.requireNone=(transition.requireNone|bit)>>>0
}
