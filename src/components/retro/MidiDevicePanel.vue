<script setup>
// #89: conexão do teclado MIDI (SMK-25 por Bluetooth, ou USB/Web MIDI), monitor ao vivo e MIDI learn.
// O teclado desenhado fica em MidiKeyboard.vue, no topo do modo Música.
import {onMounted} from 'vue'
import {useMidiInput} from '../../composables/useMidiInput.js'
import {midiNoteName} from '../../../shared/retro/midi.js'
const {midi,connectBluetooth,chooseBluetooth,enableWebMidi,disconnectSource,showHiddenPorts,learnBinding,clearBinding,clearMonitor}=useMidiInput()
const ACTIONS=[['pitch','Pitch (roda)'],['modulation','Modulação (roda)'],['volume','Volume'],['param-1','Parâmetro 1'],['param-2','Parâmetro 2'],['param-3','Parâmetro 3'],['param-4','Parâmetro 4']]
const statusLabel={connected:'conectado',connecting:'conectando…',lost:'sem sinal, tentando reconectar'}
const describe=event=>{
 switch(event.type){
  case 'note-on':return 'Nota '+midiNoteName(event.note)+' ('+event.note+') · velocity '+event.velocity
  case 'note-off':return 'Soltou '+midiNoteName(event.note)+' ('+event.note+')'
  case 'control-change':return 'Controle CC '+event.controller+' = '+event.value
  case 'pitch-bend':return 'Pitch '+event.value
  case 'program-change':return 'Programa '+event.program
  case 'channel-pressure':return 'Pressão '+event.value
  case 'poly-pressure':return 'Pressão '+midiNoteName(event.note)+' = '+event.value
  default:return event.type
 }
}
const bindingLabel=binding=>binding?(binding.type==='pitch-bend'?'roda de pitch':'CC '+binding.controller)+' · canal '+(binding.channel+1):'não ligado'
const actionNames=event=>event.actions?.map(id=>ACTIONS.find(item=>item[0]===id)?.[1]||id).join(', ')
const hex=raw=>raw.map(byte=>byte.toString(16).padStart(2,'0')).join(' ')
onMounted(()=>{enableWebMidi()})
</script>
<template>
 <section class="midi-panel" aria-labelledby="midi-title">
  <div class="title"><div><h3 id="midi-title">Teclado MIDI</h3><p class="help">Toque no teclado para tocar e gravar no compositor. Pelo cabo USB o SMK-25 (e outros teclados) aparece sozinho; sem cabo, use “Conectar por Bluetooth”.</p></div>
   <div class="actions"><button type="button" class="primary" :disabled="midi.choosing" @click="connectBluetooth">{{ midi.choosing ? 'Procurando…' : 'Conectar por Bluetooth' }}</button></div></div>
  <div v-if="midi.choosing" class="chooser" role="dialog" aria-label="Escolher teclado Bluetooth">
   <p class="help">Ligue o teclado. Aparecem aqui os aparelhos com MIDI por Bluetooth.</p>
   <ul v-if="midi.choices.length"><li v-for="device in midi.choices" :key="device.deviceId"><button type="button" @click="chooseBluetooth(device.deviceId)">{{ device.deviceName || device.deviceId }}</button></li></ul>
   <p v-else role="status" class="help">Procurando…</p>
   <button type="button" @click="chooseBluetooth('')">Cancelar</button>
  </div>
  <p v-if="midi.error" role="alert" class="notice problem">{{ midi.error }}</p>
  <p v-if="midi.webMidi==='unavailable' || midi.webMidi==='denied'" class="notice">Entradas MIDI do sistema indisponíveis{{ midi.webMidi==='denied' ? ' (permissão negada)' : '' }}. O Bluetooth continua funcionando.</p>
  <ul class="sources" aria-label="Teclados conectados">
   <li v-for="source in midi.sources" :key="source.id" :class="source.status"><span><b>{{ source.name }}</b> <small>{{ source.kind==='bluetooth' ? 'Bluetooth' : 'MIDI' }} · {{ statusLabel[source.status] }}</small></span><button type="button" @click="disconnectSource(source.id)">{{ source.kind==='bluetooth' ? 'Desconectar' : 'Ocultar' }}</button></li>
   <li v-if="!midi.sources.length" class="help">Nenhum teclado conectado. Ligue o cabo USB ou conecte por Bluetooth.</li>
  </ul>
  <p v-if="midi.hiddenPorts" class="help">{{ midi.hiddenPorts }} porta(s) USB oculta(s). <button type="button" @click="showHiddenPorts">Mostrar de novo</button></p>
  <fieldset><legend>Controles (MIDI learn)</legend>
   <p class="help">Clique em “Aprender” e mexa no knob ou na roda do teclado.</p>
   <div v-for="[id,label] in ACTIONS" :key="id" class="binding"><span>{{ label }} <small>{{ midi.learning===id ? 'mexa no controle…' : bindingLabel(midi.bindings[id]) }}</small></span>
    <span class="actions"><button type="button" :aria-pressed="midi.learning===id" @click="learnBinding(midi.learning===id ? '' : id)">{{ midi.learning===id ? 'Cancelar' : 'Aprender' }}</button><button v-if="midi.bindings[id]" type="button" @click="clearBinding(id)">Limpar</button></span></div>
  </fieldset>
  <div class="title"><h3>Monitor</h3><button type="button" :disabled="!midi.monitor.length" @click="clearMonitor">Limpar</button></div>
  <ol class="monitor" aria-live="polite" aria-label="Últimos eventos MIDI">
   <li v-for="event in midi.monitor" :key="event.id"><span>{{ describe(event) }}<small v-if="event.actions?.length"> → {{ actionNames(event) }}</small></span><small>canal {{ event.channel===undefined ? '—' : event.channel+1 }} · {{ event.sourceName }} · <code>{{ hex(event.raw) }}</code></small></li>
   <li v-if="!midi.monitor.length" class="help">Toque uma tecla para ver os eventos aqui.</li>
  </ol>
 </section>
</template>
<style scoped>
.midi-panel{display:flex;flex-direction:column;gap:8px}
h3{margin:0 0 4px;font-size:13px}small,.help{color:var(--muted,#a7b2b9)}.help{margin:4px 0;line-height:1.5}code{font-size:11px}
button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px;cursor:pointer}
button:disabled{opacity:.5;cursor:default}.primary,button[aria-pressed=true]{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}button:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
.title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.actions{display:flex;flex-wrap:wrap;gap:6px}
.notice{margin:0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4}.problem{border-color:#e38269;color:#f0b3a3}
.chooser{padding:10px;border:1px solid var(--accent,#5bbda5);border-radius:3px}.chooser ul{list-style:none;margin:6px 0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.sources{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}.sources li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid var(--border,#41464d);border-radius:3px}
.sources li.connected{border-color:var(--accent,#5bbda5)}.sources li.lost{border-color:#f2d16b}
fieldset{min-width:0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;margin:0}
.binding{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 0}
.monitor{list-style:none;margin:0;padding:0;max-height:260px;overflow:auto;border:1px solid var(--border,#41464d);border-radius:3px}
.monitor li{display:flex;justify-content:space-between;gap:8px;padding:4px 8px;border-bottom:1px solid var(--border,#41464d)}.monitor li:first-child{color:var(--text,#ddd);background:color-mix(in srgb,var(--accent,#5bbda5) 10%,transparent)}
@media(max-width:620px){.title{flex-direction:column}.monitor li{flex-direction:column}}
</style>
