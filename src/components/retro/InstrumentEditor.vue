<script setup>
// #89: editor de um instrumento da música (FM de 4 operadores, PSG ou ruído). Edita o objeto em
// song.instruments diretamente: o teclado toca com os valores novos na próxima nota e o desfazer
// da música cobre as mudanças. Exporta FM para TFI, DMP, FUI e OPNI.
import {computed} from 'vue'
import {FM_CARRIERS,FM_OPERATOR_LIMITS,PSG_ENVELOPE_LIMITS} from '../../../shared/retro/chipInstruments.js'
import {exportInstrument,INSTRUMENT_EXPORT_FORMATS} from '../../../shared/retro/instrumentFormats.js'
const props=defineProps({instrument:{type:Object,required:true},used:{type:Number,default:0}})
const emit=defineEmits(['close','preview','remove'])
// Roteamento de cada algoritmo (→ modula, + soma); os operadores que soam ficam destacados.
const ROUTING=['S1→S2→S3→S4','(S1+S2)→S3→S4','(S1+(S2→S3))→S4','((S1→S2)+S3)→S4','(S1→S2)+(S3→S4)','S1→(S2+S3+S4)','(S1→S2)+S3+S4','S1+S2+S3+S4']
// Detune no registrador: 0..3 positivos, 4..7 negativos (4 = −0).
const DETUNE=[[7,'−3'],[6,'−2'],[5,'−1'],[0,'0'],[1,'+1'],[2,'+2'],[3,'+3']]
const FIELDS=[
 ['tl','Volume (TL)','Atenuação: 0 = mais alto; nos moduladores, menos TL = timbre mais brilhante.',true],
 ['ar','Ataque (AR)','Velocidade de subida: 31 = instantâneo.'],
 ['d1r','Decaimento (D1R)','Velocidade até o nível de sustentação.'],
 ['sl','Sustentação (SL)','Nível onde o decaimento muda de velocidade: 0 = topo, 15 = silêncio.'],
 ['d2r','Decaimento 2 (D2R)','Queda enquanto a tecla está apertada: 0 = sustenta.'],
 ['rr','Soltura (RR)','Velocidade ao soltar a tecla: 15 = corta.'],
 ['mul','Multiplicador','Harmônico do operador: 0 = meia frequência, 1 = fundamental, 2 = oitava…'],
 ['ks','Key scale (KS)','Envelopes mais rápidos nas notas agudas.']
]
const carriers=computed(()=>props.instrument.kind==='fm'?FM_CARRIERS[props.instrument.alg]:[])
const kindLabel={fm:'FM · YM2612',psg:'PSG · onda quadrada',noise:'PSG · ruído'}
const set=(op,key,value,max)=>{op[key]=Math.max(0,Math.min(max,Math.round(+value)||0))}
// Desenho do envelope: ataque, decaimento até SL, D2R por um tempo, soltura. Escala aproximada.
function envelope(op){
 const time=rate=>rate?Math.min(60,90/(rate+1)):60,level=op.sl/15
 const attack=op.ar>=31?0:time(op.ar*2),decay=op.d1r?time(op.d1r*2):0,hold=40,sustainEnd=Math.min(1,level+(op.d2r?hold/time(op.d2r*2)*.6:0)),release=time(op.rr*4+2)
 const total=attack+(op.d1r?decay:0)+hold+release||1,x=value=>(value/total*100).toFixed(1),y=value=>(4+value*28).toFixed(1)
 let t=0;const points=[[0,1]]
 t+=attack;points.push([t,0])
 if(op.d1r){t+=decay;points.push([t,level])}else points.push([t,0])
 t+=hold;points.push([t,op.d1r?sustainEnd:0])
 t+=release;points.push([t,1])
 return points.map(([px,py])=>x(px)+','+y(py)).join(' ')
}
function download(format){
 const bytes=exportInstrument(props.instrument,format)
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}))
 const link=document.createElement('a')
 link.href=url;link.download=(props.instrument.name.replace(/[\\/:*?"<>|]+/g,'_')||'instrumento')+'.'+format
 document.body.append(link);link.click();link.remove()
 setTimeout(()=>URL.revokeObjectURL(url),1000)
}
</script>
<template>
 <section class="instrument-editor" aria-labelledby="instrument-editor-title">
  <div class="head">
   <h3 id="instrument-editor-title">Editar instrumento</h3>
   <button type="button" class="primary" @click="emit('close')">Concluir</button>
  </div>
  <label class="name">Nome <input v-model="instrument.name" maxlength="64" /></label>
  <p class="help">{{ kindLabel[instrument.kind] }} · <code>{{ instrument.id }}</code> · {{ used ? 'usado em '+used+' faixa(s)' : 'nenhuma faixa usa' }}</p>
  <p v-if="instrument.source" class="help">Origem: {{ instrument.source }}</p>
  <div class="actions">
   <button type="button" @click="emit('preview')">▶ Ouvir</button>
   <details v-if="instrument.kind==='fm'" class="export"><summary>Exportar</summary><div><button v-for="(label,format) in INSTRUMENT_EXPORT_FORMATS" :key="format" type="button" @click="download(format)">{{ label }}</button></div></details>
   <button type="button" class="danger" :disabled="used>0" :title="used ? 'Troque o instrumento das faixas que o usam antes de apagar.' : 'Apagar da música'" @click="emit('remove')">Apagar</button>
  </div>
  <template v-if="instrument.kind==='fm'">
   <fieldset class="channel"><legend>Canal</legend>
    <label>Algoritmo <select v-model.number="instrument.alg"><option v-for="(route,index) in ROUTING" :key="index" :value="index">{{ index }} · {{ route }}</option></select></label>
    <label>Feedback do S1 <input v-model.number="instrument.fb" type="range" min="0" max="7" /><output>{{ instrument.fb }}</output></label>
    <label title="Quanto o LFO mexe no volume dos operadores com AM ligado">LFO volume (AMS) <select v-model.number="instrument.ams"><option v-for="(label,index) in ['desligado','1,4 dB','5,9 dB','11,8 dB']" :key="index" :value="index">{{ label }}</option></select></label>
    <label title="Quanto o LFO mexe na afinação (vibrato); a roda de modulação também liga o LFO">LFO afinação (PMS) <select v-model.number="instrument.pms"><option v-for="(label,index) in ['desligado','3,4 cents','6,7','10','14','20','40','80 cents']" :key="index" :value="index">{{ label }}</option></select></label>
    <p class="routing" aria-label="Roteamento">{{ ROUTING[instrument.alg] }} <small>· soam: {{ carriers.map(index=>'S'+(index+1)).join(', ') }}</small></p>
   </fieldset>
   <div class="operators">
    <fieldset v-for="(op,index) in instrument.ops" :key="index" class="operator" :class="{carrier:carriers.includes(index)}">
     <legend>S{{ index+1 }} <small>{{ carriers.includes(index) ? 'soa' : 'modula' }}</small></legend>
     <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><polyline :points="envelope(op)" /></svg>
     <label v-for="[key,label,hint,inverted] in FIELDS" :key="key" :title="hint"><span>{{ label }}</span>
      <input type="range" min="0" :max="FM_OPERATOR_LIMITS[key]" :value="inverted ? FM_OPERATOR_LIMITS[key]-op[key] : op[key]" :aria-label="'S'+(index+1)+' '+label" @input="set(op,key,inverted ? FM_OPERATOR_LIMITS[key]-$event.target.value : $event.target.value,FM_OPERATOR_LIMITS[key])" />
      <input type="number" min="0" :max="FM_OPERATOR_LIMITS[key]" :value="op[key]" :aria-label="'S'+(index+1)+' '+label+' (valor)'" @change="set(op,key,$event.target.value,FM_OPERATOR_LIMITS[key])" /></label>
     <label><span>Detune</span><select v-model.number="op.dt" :aria-label="'S'+(index+1)+' detune'"><option v-for="[value,label] in DETUNE" :key="value" :value="value">{{ label }}</option><option v-if="op.dt===4" :value="4">−0</option></select></label>
     <label class="check"><input type="checkbox" :checked="!!op.am" @change="op.am=$event.target.checked?1:0" /> AM (LFO no volume)</label>
    </fieldset>
   </div>
  </template>
  <fieldset v-else class="psg"><legend>Envelope (quadros de 1/60 s)</legend>
   <label v-for="[key,label,hint] in [['volume','Volume','0 = mais alto, 15 = mudo'],['attack','Ataque','Quadros até o volume máximo'],['decay','Decaimento','Quadros até a sustentação'],['sustain','Sustentação','Quanto cai abaixo do volume (0 = nada, 15 = some)'],['release','Soltura','Quadros até sumir depois de soltar']]" :key="key" :title="hint"><span>{{ label }}</span>
    <input type="range" min="0" :max="key==='volume'||key==='sustain' ? 15 : 120" :value="instrument.envelope[key]" @input="set(instrument.envelope,key,$event.target.value,PSG_ENVELOPE_LIMITS[key])" />
    <input type="number" min="0" :max="PSG_ENVELOPE_LIMITS[key]" :value="instrument.envelope[key]" @change="set(instrument.envelope,key,$event.target.value,PSG_ENVELOPE_LIMITS[key])" /></label>
   <template v-if="instrument.kind==='noise'">
    <label><span>Tipo</span><select v-model="instrument.mode"><option value="white">Branco (chiado)</option><option value="periodic">Periódico (zumbido)</option></select></label>
    <label><span>Altura</span><select v-model.number="instrument.rate"><option :value="0">Agudo</option><option :value="1">Médio</option><option :value="2">Grave</option><option :value="3">Segue a nota (usa o PSG 3)</option></select></label>
   </template>
  </fieldset>
 </section>
</template>
<style scoped>
.instrument-editor{display:flex;flex-direction:column;gap:8px}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px}h3{margin:0;font-size:13px}
small,.help{color:var(--muted,#a7b2b9)}.help{margin:0;line-height:1.4}code{font-size:11px}
.name{display:flex;align-items:center;gap:6px}.name input{flex:1}
.actions{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start}.export{position:relative}.export summary{cursor:pointer;padding:4px 8px;border:1px solid var(--border,#41464d);border-radius:3px;list-style:none}
.export>div{position:absolute;z-index:3;top:calc(100% + 4px);left:0;display:flex;flex-direction:column;gap:4px;padding:6px;min-width:190px;background:var(--panel,#20252a);border:1px solid var(--border,#41464d);border-radius:3px;box-shadow:0 6px 18px #0007}
.danger{margin-left:auto}.danger:not(:disabled):hover{border-color:#e38269;color:#f0b3a3}
fieldset{min-width:0;margin:0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px}legend{padding:0 4px;font-weight:500}
.channel{display:grid;gap:6px}.channel label{display:grid;grid-template-columns:110px minmax(0,1fr) auto;align-items:center;gap:6px}.channel select{grid-column:2/4}
.routing{margin:0;font-family:monospace;color:var(--accent,#5bbda5)}
.operators{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.operator{display:flex;flex-direction:column;gap:3px}.operator.carrier{border-color:var(--accent,#5bbda5)}.operator.carrier legend{color:var(--accent,#5bbda5)}
.operator svg{width:100%;height:36px;background:var(--bg,#171c21);border-radius:2px}.operator polyline{fill:none;stroke:var(--accent,#5bbda5);stroke-width:1.5;vector-effect:non-scaling-stroke}
.operator label,.psg label{display:grid;grid-template-columns:minmax(0,1fr) 46px;align-items:center;gap:2px 4px;font-size:11px}
.operator label span,.psg label span{grid-column:1/-1;color:var(--muted,#a7b2b9)}
.operator label input[type=range],.psg label input[type=range]{width:100%;accent-color:var(--accent,#5bbda5);padding:0}
.operator label select,.psg label select{grid-column:1/-1}
.operator .check{display:flex;gap:4px;align-items:center}
.psg{display:grid;gap:6px}
button,input,select{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:3px 6px;min-width:0}
button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.primary{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
:is(button,input,select,summary):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
</style>
