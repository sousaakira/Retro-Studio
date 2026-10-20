// #89: música do compositor (music/<id>.song.json). Faixas = instrumento + notas; o driver distribui
// as notas pelos canais do chip ao tocar e ao exportar. Tempo em ticks (48 por semínima); o som anda
// em quadros de 60 Hz, como os drivers do Mega Drive e o XGM. instruments: instrumentos próprios da
// música (importados ou copiados do banco e editados); as faixas citam pelo ID.
import {validateInstrument,PRESET_INSTRUMENTS} from './chipInstruments.js'
export const SONG_FORMAT='retro-studio.song'
export const SONG_PPQ=48
export const SONG_FPS=60
export const SONG_LIMITS=Object.freeze({instruments:64,tracks:32,notesPerTrack:20000,bars:512,tempoMin:30,tempoMax:300,beatsMin:1,beatsMax:12})
// Grades em ticks: 1/4, 1/8, 1/16, 1/32 e as tercinas de 1/8 e 1/16.
export const SONG_GRIDS=Object.freeze([[48,'1/4'],[24,'1/8'],[16,'1/8 tercina'],[12,'1/16'],[8,'1/16 tercina'],[6,'1/32']])
const songId=/^[a-z][a-z0-9_]{0,31}$/,trackId=/^[a-z0-9][a-z0-9-]{0,31}$/,instrumentId=/^[a-z0-9][a-z0-9-]{0,47}$/

export function createSong({id='musica_1',name='Nova música',tempo=120,instrument='piano-eletrico'}={}){
 return {format:SONG_FORMAT,version:1,id,name,tempo,beatsPerBar:4,bars:16,loop:{start:0,end:16*4*SONG_PPQ},fmChannels:6,
  instruments:[],tracks:[{id:'faixa-1',name:'Faixa 1',instrument,mute:false,solo:false,notes:[]}]}
}
export const songLength=song=>song.bars*song.beatsPerBar*SONG_PPQ
/** Tick → quadro de 60 Hz (arredondado: o XGM toca em quadros). */
export const tickFrame=(song,tick)=>Math.round(tick*SONG_FPS*60/(song.tempo*SONG_PPQ))
export const tickSeconds=(song,tick)=>tick*60/(song.tempo*SONG_PPQ)
export const secondsTick=(song,seconds)=>seconds*song.tempo*SONG_PPQ/60

const int=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw Error('Invalid song '+label+'.')}
export function validateSong(value){
 if(!value||typeof value!=='object'||value.format!==SONG_FORMAT||value.version!==1)throw Error('Unsupported song file.')
 if(typeof value.id!=='string'||!songId.test(value.id))throw Error('Invalid song ID (lowercase letters, digits and _; starts with a letter).')
 if(value.id==='count')throw Error('Song ID "count" is reserved by the generated header.')
 if(typeof value.name!=='string'||!value.name.trim()||value.name.length>128)throw Error('Invalid song name.')
 int(value.tempo,SONG_LIMITS.tempoMin,SONG_LIMITS.tempoMax,'tempo')
 int(value.beatsPerBar,SONG_LIMITS.beatsMin,SONG_LIMITS.beatsMax,'beats per bar')
 int(value.bars,1,SONG_LIMITS.bars,'length')
 if(value.fmChannels!==6&&value.fmChannels!==5)throw Error('Invalid song FM channel count.')
 const length=songLength(value)
 if(value.loop!==null){
  if(!value.loop||typeof value.loop!=='object')throw Error('Invalid song loop.')
  int(value.loop.start,0,length-1,'loop start');int(value.loop.end,value.loop.start+1,length,'loop end')
 }
 if(value.instruments!==undefined){
  if(!Array.isArray(value.instruments)||value.instruments.length>SONG_LIMITS.instruments)throw Error('Invalid song instrument list.')
  const seen=new Set(PRESET_INSTRUMENTS.map(item=>item.id))
  for(const instrument of value.instruments){
   validateInstrument(instrument)
   if(seen.has(instrument.id))throw Error('Duplicate instrument ID (or same as a preset): '+instrument.id)
   seen.add(instrument.id)
  }
 }
 if(!Array.isArray(value.tracks)||!value.tracks.length||value.tracks.length>SONG_LIMITS.tracks)throw Error('Invalid song track list.')
 const ids=new Set()
 for(const track of value.tracks){
  if(!track||typeof track.id!=='string'||!trackId.test(track.id)||ids.has(track.id))throw Error('Invalid or duplicate track ID.')
  ids.add(track.id)
  if(typeof track.name!=='string'||!track.name.trim()||track.name.length>64)throw Error('Invalid track name: '+track.id)
  if(typeof track.instrument!=='string'||!instrumentId.test(track.instrument))throw Error('Invalid track instrument: '+track.id)
  if(typeof track.mute!=='boolean'||typeof track.solo!=='boolean')throw Error('Invalid track mute/solo: '+track.id)
  if(!Array.isArray(track.notes)||track.notes.length>SONG_LIMITS.notesPerTrack)throw Error('Too many notes in track: '+track.id)
  for(const note of track.notes){
   if(!note||typeof note!=='object')throw Error('Invalid note in track: '+track.id)
   int(note.t,0,length-1,'note start');int(note.d,1,length,'note length');int(note.n,0,127,'note pitch');int(note.v,1,127,'note velocity')
  }
 }
 return value
}
/** Cópia ordenada e sem notas fora da música (depois de encurtar). */
export function normalizeSong(song){
 const length=songLength(song)
 return {...song,loop:song.loop?{start:Math.min(song.loop.start,length-1),end:Math.min(Math.max(song.loop.end,song.loop.start+1),length)}:null,
  tracks:song.tracks.map(track=>({...track,notes:track.notes.filter(note=>note.t<length).map(note=>({...note,d:Math.min(note.d,length-note.t)})).sort((a,b)=>a.t-b.t||a.n-b.n)}))}
}
/** Ajusta à grade (ticks): início arredonda, duração no mínimo uma divisão. */
export const snapTick=(tick,grid)=>Math.max(0,Math.round(tick/grid)*grid)
export const snapLength=(length,grid)=>Math.max(grid,Math.round(length/grid)*grid)
