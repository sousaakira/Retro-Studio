// #89: música para IA. Formato de autoria em tempos (beats) e nomes de nota ("C#4"), convertido para o
// formato do compositor (ticks, 48 por semínima), e uma análise do que o Mega Drive vai conseguir tocar:
// polifonia por chip, notas graves demais para o PSG, instrumentos faltando. Puro: roda no Node e na UI.
import {SONG_PPQ,SONG_LIMITS,SONG_FORMAT,createSong,validateSong,normalizeSong,songLength,tickSeconds} from './song.js'
import {resolveInstrument} from './songTimeline.js'

const STEPS={C:0,D:2,E:4,F:5,G:7,A:9,B:11}
const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
/** "C4" = 60 (C4 é o dó central), "F#3", "Bb2"; número MIDI também vale. */
export function parseNote(value){
 if(Number.isInteger(value)&&value>=0&&value<=127)return value
 const match=typeof value==='string'&&value.trim().match(/^([A-Ga-g])([#b♯♭]?)(-?\d)$/)
 if(!match)throw Error('Nota inválida: '+JSON.stringify(value)+' (use "C4", "F#3", "Bb2" ou 0..127).')
 const note=(Number(match[3])+1)*12+STEPS[match[1].toUpperCase()]+(match[2]==='#'||match[2]==='♯'?1:match[2]==='b'||match[2]==='♭'?-1:0)
 if(note<0||note>127)throw Error('Nota fora do MIDI (0..127): '+value)
 return note
}
export const noteName=note=>NAMES[note%12]+(Math.floor(note/12)-1)

/**
 * Autoria → música validada. Aceita notas em tempos {at, len, note, vel} (at a partir de 0, em
 * semínimas; note "C4" ou 0..127; vel 1..127, padrão 100) ou já em ticks {t, d, n, v}.
 * loop: true (música toda), false, ou {start, end} em compassos (1 = primeiro; end inclusivo).
 * bars: se faltar, cobre a última nota. Erros dizem a faixa e a nota.
 */
export function songFromAuthoring(input){
 if(!input||typeof input!=='object')throw Error('A música deve ser um objeto.')
 const base=createSong({id:input.id,name:input.name,tempo:input.tempo??120})
 const beatsPerBar=input.beatsPerBar??4
 const ticks=beats=>Math.round(beats*SONG_PPQ)
 if(!Array.isArray(input.tracks)||!input.tracks.length)throw Error('A música precisa de pelo menos uma faixa em "tracks".')
 let last=0
 const used=new Set()
 const tracks=input.tracks.map((track,index)=>{
  const where='faixa '+(index+1)+(track?.name?' ("'+track.name+'")':'')
  if(!track||typeof track!=='object')throw Error(where+': inválida.')
  let id=typeof track.id==='string'&&track.id?track.id:('faixa-'+(index+1))
  id=id.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+/,'').slice(0,32)||'faixa-'+(index+1)
  while(used.has(id))id=(id.slice(0,28)+'-'+(index+1))
  used.add(id)
  if(!Array.isArray(track.notes))throw Error(where+': "notes" deve ser uma lista.')
  const notes=track.notes.map((note,position)=>{
   const at=where+', nota '+(position+1)
   if(!note||typeof note!=='object')throw Error(at+': inválida.')
   let t,d,n,v
   try{
    if('at' in note||'len' in note||'note' in note){
     if(typeof note.at!=='number'||note.at<0||!Number.isFinite(note.at))throw Error('"at" (em tempos, a partir de 0) é obrigatório.')
     if(typeof note.len!=='number'||note.len<=0||!Number.isFinite(note.len))throw Error('"len" (duração em tempos, > 0) é obrigatório.')
     t=ticks(note.at);d=Math.max(1,ticks(note.len));n=parseNote(note.note);v=note.vel??100
    }else{t=note.t;d=note.d;n=note.n;v=note.v??100}
   }catch(error){throw Error(at+': '+error.message)}
   if(!Number.isInteger(v)||v<1||v>127)throw Error(at+': "vel" deve ser inteiro de 1 a 127.')
   if(!Number.isInteger(t)||!Number.isInteger(d)||!Number.isInteger(n))throw Error(at+': posição, duração e nota precisam ser inteiras.')
   last=Math.max(last,t+d)
   return {t,d,n,v}
  })
  return {id,name:String(track.name||('Faixa '+(index+1))).slice(0,64),instrument:track.instrument,mute:!!track.mute,solo:!!track.solo,notes}
 })
 const barTicks=beatsPerBar*SONG_PPQ
 const bars=input.bars??Math.max(1,Math.ceil(last/barTicks))
 let loop=null
 if(input.loop===true||input.loop===undefined)loop={start:0,end:bars*barTicks}
 else if(input.loop&&typeof input.loop==='object'){
  const start=input.loop.start??1,end=input.loop.end??bars
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>bars)throw Error('Loop inválido: use {start, end} em compassos de 1 a '+bars+'.')
  loop={start:(start-1)*barTicks,end:end*barTicks}
 }
 const song={...base,format:SONG_FORMAT,version:1,beatsPerBar,bars,loop,fmChannels:input.fmChannels??6,
  instruments:Array.isArray(input.instruments)?input.instruments:[],tracks}
 for(const track of tracks)if(!resolveInstrument(song,track.instrument))throw Error('Instrumento desconhecido na faixa "'+track.name+'": '+JSON.stringify(track.instrument)+'. Veja a lista em music_guide.')
 return validateSong(normalizeSong(validateSong(song)))
}

/** Música → autoria em tempos (o que a IA lê para editar). */
export function songToAuthoring(song){
 const beat=tick=>Math.round(tick/SONG_PPQ*1000)/1000
 const barTicks=song.beatsPerBar*SONG_PPQ
 return {id:song.id,name:song.name,tempo:song.tempo,beatsPerBar:song.beatsPerBar,bars:song.bars,
  loop:song.loop?{start:song.loop.start/barTicks+1,end:song.loop.end/barTicks}:false,fmChannels:song.fmChannels,
  instruments:song.instruments||[],
  tracks:song.tracks.map(track=>({id:track.id,name:track.name,instrument:track.instrument,mute:track.mute,solo:track.solo,
   notes:track.notes.map(note=>({at:beat(note.t),len:beat(note.d),note:noteName(note.n),vel:note.v}))}))}
}

/** O que o Mega Drive consegue tocar: picos de vozes por chip, avisos e números da música. */
export function analyzeSong(song){
 const warnings=[],fmLimit=song.fmChannels===5?5:6
 const events=[],missing=new Set()
 let psgLow=0
 for(const track of song.tracks){
  const instrument=resolveInstrument(song,track.instrument)
  if(!instrument){missing.add(track.instrument);continue}
  const resource=instrument.kind==='fm'?'fm':instrument.kind==='psg'?'psg':'noise'
  for(const note of track.notes){
   events.push([note.t,1,resource],[note.t+note.d,-1,resource])
   if(instrument.kind==='noise'&&instrument.rate===3)events.push([note.t,1,'psg'],[note.t+note.d,-1,'psg'])
   if(resource==='psg'&&note.n<45)psgLow++
  }
 }
 events.sort((a,b)=>a[0]-b[0]||a[1]-b[1])
 const now={fm:0,psg:0,noise:0},peak={fm:0,psg:0,noise:0},over={fm:0,psg:0,noise:0}
 const limit={fm:fmLimit,psg:3,noise:1}
 for(const [,delta,resource] of events){now[resource]+=delta;peak[resource]=Math.max(peak[resource],now[resource]);if(delta>0&&now[resource]>limit[resource])over[resource]++}
 if(missing.size)warnings.push('Instrumentos que não existem: '+[...missing].join(', ')+'.')
 if(over.fm)warnings.push(over.fm+' nota(s) FM começam com mais de '+fmLimit+' vozes FM soando: a mais antiga é cortada.')
 if(over.psg)warnings.push(over.psg+' nota(s) de PSG começam com mais de 3 vozes de onda quadrada: a mais antiga é cortada.')
 if(over.noise)warnings.push(over.noise+' toque(s) de ruído se sobrepõem: o PSG tem um canal de ruído só, o novo corta o anterior (normal em bateria).')
 if(psgLow)warnings.push(psgLow+' nota(s) de PSG abaixo de A2 (~110 Hz): o PSG não chega lá e toca uma oitava acima.')
 const length=songLength(song)
 return {
  seconds:Math.round(tickSeconds(song,length)*100)/100,bars:song.bars,tempo:song.tempo,
  loop:song.loop?{startBar:song.loop.start/(song.beatsPerBar*SONG_PPQ)+1,endBar:song.loop.end/(song.beatsPerBar*SONG_PPQ)}:null,
  tracks:song.tracks.map(track=>({id:track.id,name:track.name,instrument:track.instrument,notes:track.notes.length})),
  voices:{fm:{peak:peak.fm,limit:fmLimit},psg:{peak:peak.psg,limit:3},noise:{peak:peak.noise,limit:1}},
  warnings
 }
}
export {SONG_LIMITS}
