// #89: driver de notas → registradores (YM2612 + PSG). Distribui vozes (6 FM, 3 tons, 1 ruído),
// carrega patches, aplica velocity, pitch bend, vibrato e os envelopes do PSG a cada quadro (60 Hz).
// As escritas saem como [0, porta, endereço, dado] (FM) e [1, byte] (PSG): o editor manda ao
// AudioWorklet e o exportador VGM grava as mesmas.
import {YM2612_CLOCK_NTSC} from './ym2612.js'
import {PSG_CLOCK_NTSC} from './sn76489.js'
import {fmPatchWrites,fmLevelWrites,velocityAttenuation} from './chipInstruments.js'

const frequency=note=>440*2**((note-69)/12)
/** F-number e bloco com o F-number entre ~650 e 1300 (faixa usada pelos drivers do Mega Drive). */
export function fmPitch(note,clock=YM2612_CLOCK_NTSC){
 const value=frequency(note)*2**21/(clock/144)
 for(let block=0;block<8;block++){const fnum=Math.round(value/2**block);if(fnum<1300)return {block,fnum}}
 return {block:7,fnum:Math.min(2047,Math.round(value/128))}
}
/** Período do tom do PSG (10 bits); abaixo de ~109 Hz o PSG não chega, sobe uma oitava. */
export function psgPeriod(note,clock=PSG_CLOCK_NTSC){
 let period=Math.round(clock/(32*frequency(note)))
 while(period>1023)period=Math.round(period/2)
 return Math.max(1,period)
}

/** fmChannels: 5 deixa o FM 6 livre (o XGM usa o DAC dele para os efeitos PCM). */
export function createChipDriver({fmClock=YM2612_CLOCK_NTSC,psgClock=PSG_CLOCK_NTSC,fmChannels=6}={}){
 let writes=[],clock=0,bend=0,vibrato=0
 const fm=Array.from({length:fmChannels===5?5:6},(_,channel)=>({channel,loaded:null,note:null,instrument:null,held:false,since:0,sweep:0}))
 const tones=Array.from({length:3},(_,channel)=>({channel,note:null,instrument:null,held:false,since:0,env:null}))
 const noiseVoice={note:null,instrument:null,held:false,since:0,env:null}
 const fmWrite=(port,address,data)=>writes.push([0,port,address,data])
 const psgWrite=byte=>writes.push([1,byte])
 const keyCode=channel=>(channel%3)|(channel>=3?4:0)
 // Estado inicial explícito (o VGM começa de um chip recém-ligado): LFO e DAC desligados, canal 3
 // normal, todos os canais em silêncio. O vibrato da roda de modulação liga o LFO depois.
 fmWrite(0,0x22,0);fmWrite(0,0x27,0);fmWrite(0,0x2b,0)
 for(let channel=0;channel<6;channel++)fmWrite(0,0x28,keyCode(channel))
 for(let channel=0;channel<4;channel++)psgWrite(0x90|(channel<<5)|15)

 function setFmPitch(voice){
  const {block,fnum}=fmPitch(voice.note+bend+voice.sweep,fmClock),port=voice.channel>=3?1:0,slot=voice.channel%3
  fmWrite(port,0xa4+slot,(block<<3)|(fnum>>8));fmWrite(port,0xa0+slot,fnum&0xff)
 }
 function pick(voices,instrument){
  const free=voices.filter(voice=>!voice.held)
  const pool=free.length?free:voices
  // Livre com o mesmo patch evita recarregar; senão a que soltou (ou começou) há mais tempo.
  return pool.find(voice=>voice.loaded===instrument.id)||pool.reduce((best,voice)=>voice.since<best.since?voice:best,pool[0])
 }
 function fmNoteOn(instrument,note,velocity,owner){
  const voice=pick(fm,instrument),port=voice.channel>=3?1:0
  fmWrite(0,0x28,keyCode(voice.channel))
  if(voice.loaded!==instrument.id){for(const write of fmPatchWrites(voice.channel,instrument))fmWrite(...write);voice.loaded=instrument.id}
  for(const write of fmLevelWrites(voice.channel,instrument,velocityAttenuation(velocity)))fmWrite(...write)
  fmWrite(port,0xb4+voice.channel%3,0xc0|(instrument.ams<<4)|(vibrato?vibratoDepth():instrument.pms))
  Object.assign(voice,{note,owner,instrument,held:true,since:++clock,sweep:instrument.sweep?.semitones||0,sweepLeft:instrument.sweep?.frames||0})
  setFmPitch(voice)
  fmWrite(0,0x28,0xf0|keyCode(voice.channel))
 }
 const vibratoDepth=()=>Math.min(7,Math.round(vibrato*7))
 function startEnvelope(voice,instrument,velocity){
  voice.env={stage:instrument.envelope.attack?'attack':'decay',frame:0,level:instrument.envelope.attack?15:instrument.envelope.volume,
   extra:Math.round((127-velocity)/127*4)}
 }
 function psgNoteOn(instrument,note,velocity,owner){
  // Ruído tonal usa o período do canal 3: o canal fica reservado (mudo) enquanto soa.
  const tonal=instrument.kind==='noise'&&instrument.rate===3
  if(instrument.kind==='noise'){
   Object.assign(noiseVoice,{note,owner,instrument,held:true,since:++clock})
   startEnvelope(noiseVoice,instrument,velocity)
   if(tonal){const third=tones[2];Object.assign(third,{note,owner,instrument:null,held:true,since:clock,env:null});psgWrite(0xdf);setTone(2,note)}
   psgWrite(0xe0|(instrument.mode==='white'?4:0)|instrument.rate)
   applyEnvelope(noiseVoice,3)
   return
  }
  const voice=pick(tones.filter(voice=>!(voice.channel===2&&noiseVoice.held&&noiseVoice.instrument?.rate===3)),{id:''})
  Object.assign(voice,{note,owner,instrument,held:true,since:++clock})
  startEnvelope(voice,instrument,velocity)
  setTone(voice.channel,note)
  applyEnvelope(voice,voice.channel)
 }
 function setTone(channel,note){
  const period=psgPeriod(note+bend,psgClock)
  psgWrite(0x80|(channel<<5)|(period&15));psgWrite((period>>4)&0x3f)
 }
 function applyEnvelope(voice,channel){
  const level=voice.env?Math.min(15,Math.round(voice.env.level)+(voice.env.level<15?voice.env.extra:0)):15
  psgWrite(0x90|(channel<<5)|level)
 }
 function stepEnvelope(voice){
  const env=voice.env,shape=voice.instrument?.envelope
  if(!env||!shape)return
  const target=Math.min(15,shape.volume+shape.sustain)
  env.frame++
  if(env.stage==='attack'){env.level=15-(15-shape.volume)*Math.min(1,env.frame/shape.attack);if(env.frame>=shape.attack){env.stage='decay';env.frame=0}}
  else if(env.stage==='decay'){env.level=shape.decay?shape.volume+(target-shape.volume)*Math.min(1,env.frame/shape.decay):target;if(env.frame>=shape.decay)env.stage='sustain'}
  else if(env.stage==='release'){env.level=shape.release?env.from+(15-env.from)*Math.min(1,env.frame/shape.release):15;if(env.level>=15){env.level=15;voice.env=null}}
 }
 function release(voice){
  if(voice.env){voice.env.stage='release';voice.env.frame=0;voice.env.from=voice.env.level}
 }
 return {
  /** owner: quem tocou (a faixa); noteOff só solta a voz do mesmo dono. */
  noteOn(instrument,note,velocity=100,owner){
   if(!instrument)return
   if(instrument.kind==='fm')fmNoteOn(instrument,note,velocity,owner)
   else psgNoteOn(instrument,note,velocity,owner)
  },
  noteOff(note,owner){
   const mine=voice=>voice.held&&voice.note===note&&voice.owner===owner
   for(const voice of fm)if(mine(voice)){voice.held=false;voice.since=++clock;fmWrite(0,0x28,keyCode(voice.channel))}
   for(const voice of tones)if(mine(voice)){voice.held=false;voice.since=++clock;release(voice)}
   if(mine(noiseVoice)){
    noiseVoice.held=false;noiseVoice.since=++clock;release(noiseVoice)
    if(tones[2].held&&!tones[2].instrument&&tones[2].note===note&&tones[2].owner===owner)tones[2].held=false
   }
  },
  /** Semitons (fracionários) aplicados a todas as vozes, como a roda de pitch. */
  pitchBend(semitones){
   bend=semitones
   for(const voice of fm)if(voice.note!==null)setFmPitch(voice)
   for(const voice of tones)if(voice.note!==null&&(voice.instrument||voice.held))setTone(voice.channel,voice.note)
  },
  /** 0..1 da roda de modulação → vibrato pelo LFO do YM2612. */
  modulation(amount){
   const before=vibrato?1:0
   vibrato=Math.max(0,Math.min(1,amount))
   if((vibrato?1:0)!==before)fmWrite(0,0x22,vibrato?0x08|4:0)
   for(const voice of fm)if(voice.instrument)fmWrite(voice.channel>=3?1:0,0xb4+voice.channel%3,0xc0|(voice.instrument.ams<<4)|(vibrato?vibratoDepth():voice.instrument.pms))
  },
  /** Um quadro (1/60 s): envelopes do PSG e varredura de altura dos instrumentos de percussão FM. */
  tick(){
   for(const voice of fm)if(voice.sweepLeft>0){voice.sweepLeft--;voice.sweep=voice.sweepLeft?voice.sweep*voice.sweepLeft/(voice.sweepLeft+1):0;setFmPitch(voice)}
   for(const voice of tones)if(voice.env){stepEnvelope(voice);applyEnvelope(voice,voice.channel)}
   if(noiseVoice.env){stepEnvelope(noiseVoice);applyEnvelope(noiseVoice,3)}
  },
  allNotesOff(){
   for(const voice of fm){voice.held=false;voice.note=null;fmWrite(0,0x28,keyCode(voice.channel))}
   for(const voice of [...tones,noiseVoice]){voice.held=false;voice.note=null;voice.env=null}
   for(let channel=0;channel<4;channel++)psgWrite(0x90|(channel<<5)|15)
  },
  /** Recarrega o patch na próxima nota (depois de editar o instrumento). */
  invalidate(id){for(const voice of fm)if(!id||voice.loaded===id)voice.loaded=null},
  /** Escritas acumuladas desde a última chamada. */
  take(){const out=writes;writes=[];return out},
  voices(){
   return {fm:fm.map(voice=>({held:voice.held,note:voice.note,instrument:voice.instrument?.id||null})),
    psg:tones.map(voice=>({held:voice.held||!!voice.env,note:voice.note,instrument:voice.instrument?.id||null})),
    noise:{held:noiseVoice.held||!!noiseVoice.env,note:noiseVoice.note,instrument:noiseVoice.instrument?.id||null}}
  }
 }
}
