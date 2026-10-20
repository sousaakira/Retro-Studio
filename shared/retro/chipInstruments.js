// #89: instrumentos do compositor. FM = patch de 4 operadores do YM2612 (S1..S4, valores dos
// registradores); PSG = onda quadrada ou ruído com envelope por quadro (60 Hz), como num driver.
// Os mesmos números viram escritas de registrador no editor e no VGM exportado.
export const FM_OPERATOR_LIMITS=Object.freeze({ar:31,d1r:31,d2r:31,rr:15,sl:15,tl:127,ks:3,mul:15,dt:7,am:1,ssg:15})
export const FM_CHANNEL_LIMITS=Object.freeze({alg:7,fb:7,ams:3,pms:7})
export const PSG_ENVELOPE_LIMITS=Object.freeze({volume:15,attack:255,decay:255,sustain:15,release:255})
// Deslocamento de cada operador (S1..S4) nos registradores 0x30..0x9F.
const OPERATOR_OFFSET=[0,8,4,12]
// Operadores que soam (os outros modulam) em cada algoritmo.
export const FM_CARRIERS=Object.freeze([[3],[3],[3],[3],[1,3],[1,2,3],[1,2,3],[0,1,2,3]])
const identifier=/^[a-z0-9][a-z0-9-]{0,47}$/

const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw Error('Invalid instrument '+label+'.')}
export function validateInstrument(value){
 if(!value||typeof value!=='object')throw Error('Invalid instrument.')
 if(typeof value.id!=='string'||!identifier.test(value.id))throw Error('Invalid instrument ID.')
 if(typeof value.name!=='string'||!value.name.trim()||value.name.length>64)throw Error('Invalid instrument name: '+value.id)
 if(value.kind==='fm'){
  for(const [key,max] of Object.entries(FM_CHANNEL_LIMITS))integer(value[key],max,key+' ('+value.id+')')
  if(!Array.isArray(value.ops)||value.ops.length!==4)throw Error('An FM instrument has 4 operators: '+value.id)
  value.ops.forEach((op,index)=>{for(const [key,max] of Object.entries(FM_OPERATOR_LIMITS))integer(op?.[key],max,'S'+(index+1)+' '+key+' ('+value.id+')')})
  if(value.sweep!==undefined){
   if(!Number.isInteger(value.sweep?.semitones)||Math.abs(value.sweep.semitones)>48)throw Error('Invalid instrument sweep: '+value.id)
   integer(value.sweep.frames,120,'sweep frames ('+value.id+')')
  }
  return value
 }
 if(value.kind!=='psg'&&value.kind!=='noise')throw Error('Unsupported instrument kind: '+value.kind)
 for(const [key,max] of Object.entries(PSG_ENVELOPE_LIMITS))integer(value.envelope?.[key],max,'envelope '+key+' ('+value.id+')')
 if(value.kind==='noise'){
  if(value.mode!=='white'&&value.mode!=='periodic')throw Error('Invalid noise mode: '+value.id)
  integer(value.rate,3,'noise rate ('+value.id+')')
 }
 return value
}

/** Escritas [porta, endereço, dado] que carregam o patch no canal FM 0..5. */
export function fmPatchWrites(channel,instrument){
 const port=channel>=3?1:0,slot=channel%3,writes=[]
 instrument.ops.forEach((op,index)=>{
  const base=OPERATOR_OFFSET[index]+slot
  writes.push([port,0x30+base,(op.dt<<4)|op.mul],[port,0x40+base,op.tl],[port,0x50+base,(op.ks<<6)|op.ar],
   [port,0x60+base,(op.am<<7)|op.d1r],[port,0x70+base,op.d2r],[port,0x80+base,(op.sl<<4)|op.rr],[port,0x90+base,op.ssg])
 })
 writes.push([port,0xb0+slot,(instrument.fb<<3)|instrument.alg],[port,0xb4+slot,0xc0|(instrument.ams<<4)|instrument.pms])
 return writes
}
/** TL dos operadores que soam, com a atenuação extra (passos de 0,75 dB) da velocity. */
export function fmLevelWrites(channel,instrument,extra){
 const port=channel>=3?1:0,slot=channel%3
 return FM_CARRIERS[instrument.alg].map(index=>[port,0x40+OPERATOR_OFFSET[index]+slot,Math.min(127,instrument.ops[index].tl+extra)])
}
/** Velocity MIDI → passos de TL (0,75 dB), com curva suave: 64 ≈ −4,5 dB. */
export const velocityAttenuation=velocity=>velocity>=127?0:Math.min(48,Math.round(-20*Math.log10(Math.max(1,velocity)/127)))

// ---- Banco de instrumentos prontos ----
const op=(ar,d1r,d2r,rr,sl,tl,mul,dt=0,ks=0,am=0)=>({ar,d1r,d2r,rr,sl,tl,ks,mul,dt,am,ssg:0})
// Operadores que soam se somam e o canal satura em ±1, como no chip: com 2, 3 ou 4 deles o banco
// já desce o TL (6, 9 e 12 dB) para os presets terem o mesmo volume percebido.
const CARRIER_TRIM=[0,0,8,12,16]
const fm=(id,name,category,alg,fb,ops,extra={})=>{
 const audible=FM_CARRIERS[alg].filter(index=>ops[index].tl<127),trim=CARRIER_TRIM[audible.length]
 return {id,name,category,kind:'fm',alg,fb,ams:0,pms:0,ops:ops.map((item,index)=>audible.includes(index)?{...item,tl:Math.min(127,item.tl+trim)}:item),...extra}
}
const psg=(id,name,category,envelope,extra={})=>({id,name,category,kind:'psg',envelope,...extra})
const noise=(id,name,category,mode,rate,envelope)=>({id,name,category,kind:'noise',mode,rate,envelope})
export const INSTRUMENT_CATEGORIES=Object.freeze(['Teclas','Baixos','Leads','Cordas e pads','Metais e sopros','Percussão','PSG'])
export const PRESET_INSTRUMENTS=Object.freeze([
 fm('piano-eletrico','Piano elétrico','Teclas',4,3,[op(31,18,0,6,15,45,14,3,1),op(31,8,2,6,4,8,1,0,1),op(31,6,0,6,3,30,1,7,1),op(31,5,2,6,3,4,1,3,1)]),
 fm('piano-brilhante','Piano brilhante','Teclas',2,4,[op(31,14,3,7,8,36,3,3,2),op(31,12,2,7,6,30,1,0,1),op(31,10,2,7,5,26,1,7,1),op(31,6,3,7,4,2,1,0,1)]),
 fm('orgao','Órgão','Teclas',7,0,[op(31,0,0,9,0,0,1),op(31,0,0,9,0,4,2),op(31,0,0,9,0,10,4),op(31,0,0,9,0,4,0)]),
 fm('sino','Sino','Teclas',4,0,[op(31,6,3,5,6,30,7),op(31,4,2,4,4,6,2),op(31,8,4,5,8,36,13),op(31,3,2,4,3,10,1)]),
 fm('marimba','Marimba','Teclas',4,0,[op(31,20,0,10,15,34,4),op(31,12,6,9,15,6,1),op(31,24,0,10,15,40,10),op(31,11,6,9,15,10,1)]),
 fm('baixo-sintetico','Baixo sintético','Baixos',0,5,[op(31,14,4,10,6,30,1,3),op(31,12,4,10,5,36,0),op(31,10,2,10,4,28,1,7),op(31,4,2,10,2,2,1)]),
 fm('baixo-slap','Baixo slap','Baixos',4,6,[op(31,20,0,12,15,24,2),op(31,10,3,10,3,6,1),op(31,16,0,12,8,34,1,3),op(31,8,3,10,2,4,1)]),
 fm('baixo-redondo','Baixo redondo','Baixos',4,2,[op(31,12,2,9,6,34,0),op(31,6,2,9,2,4,0),op(31,10,2,9,5,40,1),op(31,6,2,9,2,8,0,3)]),
 fm('lead-quadrado','Lead quadrado','Leads',4,0,[op(31,0,0,8,0,28,2),op(31,0,0,8,0,4,1),op(31,0,0,8,0,34,2,3),op(31,0,0,8,0,8,1,7)]),
 fm('lead-serra','Lead serra','Leads',7,6,[op(31,0,0,8,0,0,1),op(31,0,0,8,0,127,1),op(31,0,0,8,0,12,0),op(31,0,0,8,0,127,1)]),
 fm('lead-agudo','Lead agudo','Leads',3,5,[op(31,4,0,8,2,26,2),op(31,4,0,8,2,30,1,3),op(31,4,0,8,2,36,3),op(31,2,0,8,1,4,1)]),
 fm('guitarra-distorcida','Guitarra distorcida','Leads',0,7,[op(31,2,0,8,1,22,3),op(31,4,0,8,2,18,1),op(31,4,0,8,2,14,1,3),op(31,3,2,8,2,4,1)]),
 fm('cordas','Cordas','Cordas e pads',4,4,[op(12,2,0,5,1,38,1,3),op(13,1,0,5,1,4,1,3),op(12,2,0,5,1,40,2,7),op(13,1,0,5,1,6,1,7)]),
 fm('pad-sintetico','Pad sintético','Cordas e pads',5,3,[op(10,2,0,4,2,30,1),op(9,1,0,4,1,2,1,3),op(9,1,0,4,1,8,2,7),op(9,1,0,4,1,4,1)]),
 fm('metais','Metais','Metais e sopros',4,5,[op(18,4,0,7,2,26,1),op(22,3,0,7,2,6,1),op(18,4,0,7,2,30,1,2),op(22,3,0,7,2,8,1,6)]),
 fm('flauta','Flauta','Metais e sopros',4,0,[op(20,2,0,7,1,50,1),op(22,2,0,7,1,0,1),op(20,2,0,7,1,60,2),op(22,2,0,7,1,16,2,3)]),
 fm('bumbo','Bumbo FM','Percussão',4,0,[op(31,24,0,15,15,22,0),op(31,14,10,15,15,0,0),op(31,26,0,15,15,40,1),op(31,16,12,15,15,10,0)],{sweep:{semitones:24,frames:6}}),
 fm('tom','Tom FM','Percussão',4,2,[op(31,20,0,15,15,26,1),op(31,12,8,13,15,4,1),op(31,22,0,15,15,36,2),op(31,14,8,13,15,10,1)],{sweep:{semitones:12,frames:10}}),
 noise('caixa','Caixa (ruído)','Percussão','white',1,{volume:0,attack:0,decay:10,sustain:15,release:2}),
 noise('chimbal','Chimbal (ruído)','Percussão','white',0,{volume:2,attack:0,decay:3,sustain:15,release:1}),
 noise('chimbal-aberto','Chimbal aberto (ruído)','Percussão','white',0,{volume:3,attack:0,decay:18,sustain:15,release:6}),
 noise('prato','Prato (ruído)','Percussão','white',0,{volume:1,attack:0,decay:60,sustain:15,release:20}),
 noise('palmas','Palmas (ruído)','Percussão','white',1,{volume:1,attack:1,decay:7,sustain:15,release:2}),
 psg('psg-quadrada','Quadrada PSG','PSG',{volume:2,attack:0,decay:0,sustain:0,release:4}),
 psg('psg-pluck','Pluck PSG','PSG',{volume:0,attack:0,decay:16,sustain:12,release:6}),
 psg('psg-suave','Quadrada suave','PSG',{volume:4,attack:6,decay:20,sustain:3,release:14}),
 noise('psg-ruido-tonal','Ruído tonal','PSG','periodic',3,{volume:2,attack:0,decay:0,sustain:0,release:4})
].map(validateInstrument))
