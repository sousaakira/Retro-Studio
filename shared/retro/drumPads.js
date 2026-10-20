// #89: os 8 pads do teclado MIDI (o M-Vave SMK-25 manda notas no canal 10, de 36 a 43). Modo Bateria:
// cada pad toca uma peça (instrumento + nota) e grava na faixa daquela peça. Modo Controles: cada pad
// é um atalho do compositor. Puro: as configurações salvas passam por normalizePadSettings.
export const PAD_COUNT=8
export const DRUM_CHANNEL=9   // canal 10 do MIDI, contado do zero
// Pads numerados como no teclado (1 2 3 4 em cima, 5 6 7 8 embaixo); no SMK-25 a fileira de cima manda
// 40-43 e a de baixo 36-39, como nos controladores estilo MPC.
export const DEFAULT_PAD_NOTES=Object.freeze([40,41,42,43,36,37,38,39])
const LEGACY_PAD_NOTES=[36,37,38,39,40,41,42,43]
export const PAD_ACTIONS=Object.freeze([
 ['play','Tocar / parar'],['record','Gravar'],['metronome','Metrônomo'],['loop','Loop'],
 ['undo','Desfazer'],['redo','Refazer'],['track-prev','Faixa anterior'],['track-next','Próxima faixa']
])
const instrumentId=/^[a-z0-9][a-z0-9-]{0,47}$/
export function defaultPadKit(){
 return [
  {instrument:'bumbo',note:36},{instrument:'caixa',note:60},{instrument:'chimbal',note:60},{instrument:'chimbal-aberto',note:60},
  {instrument:'tom',note:50},{instrument:'tom',note:43},{instrument:'prato',note:60},{instrument:'palmas',note:60}
 ]
}
export function defaultPadSettings(){return {version:2,mode:'drums',notes:[...DEFAULT_PAD_NOTES],kit:defaultPadKit()}}
const note=value=>Number.isInteger(value)&&value>=0&&value<=127
/** Configuração salva (localStorage) → configuração válida; o que estiver estragado volta ao padrão. */
export function normalizePadSettings(value){
 const base=defaultPadSettings()
 if(!value||typeof value!=='object')return base
 const mode=value.mode==='controls'?'controls':'drums'
 let notes=Array.isArray(value.notes)&&value.notes.length===PAD_COUNT&&value.notes.every(note)&&new Set(value.notes).size===PAD_COUNT?[...value.notes]:base.notes
 // Configuração da versão 1 com a ordem antiga (36..43 em sequência, fileiras trocadas): vira a nova.
 if(value.version!==2&&notes.every((item,index)=>item===LEGACY_PAD_NOTES[index]))notes=base.notes
 const kit=base.kit.map((fallback,index)=>{
  const pad=Array.isArray(value.kit)?value.kit[index]:null
  return pad&&typeof pad.instrument==='string'&&instrumentId.test(pad.instrument)&&note(pad.note)?{instrument:pad.instrument,note:pad.note}:fallback
 })
 return {version:2,mode,notes,kit}
}
/** Índice do pad (0..7) de uma mensagem MIDI, ou -1 se não for nota de pad. */
export function padIndex(event,notes=DEFAULT_PAD_NOTES){
 if(event?.channel!==DRUM_CHANNEL||(event.type!=='note-on'&&event.type!=='note-off'))return -1
 return notes.indexOf(event.note)
}
