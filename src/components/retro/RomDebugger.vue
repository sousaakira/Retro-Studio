<script setup>
// #64: depuração da ROM por um backend de emulador. Só o que o backend escolhido comprovadamente
// faz fica habilitado; o resto aparece como "não disponível", com o motivo.
import {ref,computed,watch,onBeforeUnmount} from 'vue'
import {useI18n} from 'vue-i18n'
const {t}=useI18n()
const props=defineProps({projectPath:{type:String,default:''},active:Boolean,busy:Boolean})
const emit=defineEmits(['open-source','built','building'])
const CAPABILITIES=['step','continue','frames','breakpoints','registers','memory','vdp','kdebug','pause','inputRecording']
const REGISTERS=['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3','a4','a5','a6','a7','sr','pc']
const api=()=>window.retroStudio?.retro
const backends=ref([]),backendId=ref('blastem-native'),game=ref(null),session=ref(null),stop=ref(null),reason=ref('')
const error=ref(''),notice=ref(''),closed=ref(''),working=ref(''),buildErrors=ref([]),confirmRun=ref(false)
const breakpointText=ref(''),memoryText=ref('0xFF0000'),memoryLength=ref(64),memory=ref(null),frameCount=ref(1),vdp=ref(null),logs=ref([])
let request=0,disposed=false
const backend=computed(()=>backends.value.find(item=>item.id===backendId.value)||null)
const can=name=>!!backend.value?.capabilities?.[name]
const open=computed(()=>!!session.value),running=computed(()=>session.value?.state==='running'),stopped=computed(()=>session.value?.state==='stopped')
const locked=computed(()=>!!working.value||props.busy)
const hex=(value,digits)=>(value>>>0).toString(16).toUpperCase().padStart(digits,'0')
const place=computed(()=>{
 const where=stop.value;if(!where)return ''
 return where.function?where.function.name+(where.function.offset?'+0x'+where.function.offset.toString(16).toUpperCase():''):t('romDebug.noFunction')
})
const rows=computed(()=>{
 const data=memory.value;if(!data)return []
 const list=[]
 for(let offset=0;offset<data.bytes.length;offset+=16){
  const slice=data.bytes.slice(offset,offset+16)
  list.push({address:hex(data.address+offset,6),bytes:slice.map(value=>hex(value,2)).join(' '),text:slice.map(value=>value>=32&&value<127?String.fromCharCode(value):'·').join('')})
 }
 return list
})
async function load(){
 if(!props.projectPath){backends.value=[];game.value=null;session.value=null;return}
 const id=++request,answer=await api()?.debugStatus?.({projectPath:props.projectPath})
 if(disposed||id!==request)return
 if(!answer?.success){error.value=answer?.error||t('romDebug.unavailable');return}
 backends.value=answer.backends;game.value=answer.game;session.value=answer.session
 if(!answer.session){stop.value=null;memory.value=null;vdp.value=null}
 else{
  // Sessão que já existia (tela remontada): o backend é o dela, e a última parada volta junto.
  backendId.value=answer.session.backend
  if(answer.session.last&&answer.session.state==='stopped'&&!stop.value){stop.value=answer.session.last.stop;reason.value=answer.session.last.reason}
 }
 if(!backends.value.some(item=>item.id===backendId.value))backendId.value=backends.value[0]?.id||''
}
/** Chamada ao serviço: erro vira mensagem na tela, nunca exceção solta. */
async function call(label,action){
 if(working.value)return null
 working.value=label;error.value='';notice.value=''
 try{
  const answer=await action()
  if(disposed)return null
  // O fechamento da sessão já foi anunciado pelo evento: não repete a mesma frase como erro.
  if(!answer?.success){if(answer?.error!==closed.value)error.value=answer?.error||t('romDebug.unavailable');return null}
  return answer
 }catch(e){if(!disposed)error.value=e.message;return null}
 finally{if(!disposed)working.value=''}
}
const command=(label,payload)=>call(label,()=>api().debugCommand({projectPath:props.projectPath,...payload}))
async function start(){
 closed.value='';memory.value=null;vdp.value=null;logs.value=[]
 const answer=await call('start',()=>api().debugStart({projectPath:props.projectPath,backend:backendId.value}))
 if(answer)session.value=answer.session
}
async function end(){await command('stop',{command:'stop'})}
async function step(){await command('step',{command:'step'})}
async function advanceFrames(){await command('frames',{command:'frames',count:Math.max(1,Math.min(600,Math.round(Number(frameCount.value))||1))})}
async function readVdp(){const answer=await command('vdp',{command:'vdp'});if(answer)vdp.value=answer.vdp}
async function resume(){
 // Sem breakpoints o controle não volta (não há pausa): avisa antes e só roda no segundo pedido.
 if(!session.value?.breakpoints.length&&!confirmRun.value){confirmRun.value=true;return}
 confirmRun.value=false
 const answer=await command('continue',{command:'continue'});if(answer?.warning)notice.value=answer.warning
}
async function addBreakpoint(){
 const location=breakpointText.value.trim();if(!location)return
 const answer=await command('breakpoint',{command:'breakpoint',location,enabled:true})
 if(answer){session.value=answer.session;breakpointText.value=''}
}
async function removeBreakpoint(address){const answer=await command('breakpoint',{command:'breakpoint',address,enabled:false});if(answer)session.value=answer.session}
async function readMemory(){
 const location=memoryText.value.trim();if(!location)return
 const length=Math.max(1,Math.min(backend.value?.memoryLimit||4096,Math.round(Number(memoryLength.value))||64))
 const answer=await command('memory',{command:'memory',location,...(/^(?:0x|\$)/i.test(location)?{length}:{})})
 if(answer)memory.value=answer
}
async function buildForDebug(){
 if(working.value)return
 working.value='build';error.value='';notice.value='';buildErrors.value=[];emit('building',true)
 try{
  const answer=await api().debugBuild({projectPath:props.projectPath})
  if(disposed)return
  if(answer?.success)notice.value=t('romDebug.built')
  else if(answer?.cancelled)notice.value=t('romDebug.buildCancelled')
  else{error.value=answer?.error||t('romDebug.unavailable');buildErrors.value=(answer?.errors||[]).filter(item=>item.type!=='warning'&&item.type!=='note').slice(0,20)}
 }catch(e){if(!disposed)error.value=e.message}
 finally{emit('building',false);if(!disposed)working.value=''}
 // Com sucesso ou falha, out/ mudou: o resumo do modo Executar precisa acompanhar.
 emit('built');await load()
}
async function cancelBuild(){try{await api().debugBuild({projectPath:props.projectPath,cancel:true})}catch{/* o build já terminou */}}
const off=api()?.onDebugEvent?.(event=>{
 if(disposed||event.projectPath!==props.projectPath)return
 if(event.type==='log'){logs.value=[...logs.value,...event.lines].slice(-200);return}
 if(event.type==='closed'){session.value=null;stop.value=null;memory.value=null;vdp.value=null;closed.value=event.reason;if(error.value===event.reason)error.value='';return}
 session.value=event.session;reason.value=event.reason;confirmRun.value=false
 if(event.stop){stop.value=event.stop;memory.value=null;vdp.value=null}
})
defineExpose({load})
watch(()=>[props.projectPath,props.active],()=>{if(props.active)void load();else request++},{immediate:true})
// Um build comum pela IDE troca a ROM: o resumo do jogo precisa acompanhar.
watch(()=>props.busy,(now,before)=>{if(before&&!now&&props.active)void load()})
onBeforeUnmount(()=>{disposed=true;request++;off?.()})
</script>
<template>
 <section class="debugger" aria-labelledby="rom-debug-title">
  <h3 id="rom-debug-title">{{ t('romDebug.title') }}</h3>
  <p class="help">{{ t('romDebug.intro') }}</p>
  <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
  <p v-if="closed" role="alert" class="notice problem">{{ closed }}</p>
  <p v-if="notice" role="status" class="notice">{{ notice }}</p>
  <div class="field">
   <label for="rom-debug-backend">{{ t('romDebug.backend') }}</label>
   <select id="rom-debug-backend" v-model="backendId" :disabled="open||locked">
    <option v-for="item in backends" :key="item.id" :value="item.id">{{ item.label }}{{ item.installed ? '' : ' — '+t('romDebug.notInstalled') }}</option>
   </select>
  </div>
  <template v-if="backend">
   <ul class="capabilities" :aria-label="t('romDebug.capabilities')">
    <li v-for="name in CAPABILITIES" :key="name" :class="{off:!can(name)}"><span aria-hidden="true">{{ can(name) ? '✓' : '—' }}</span> {{ t('romDebug.cap.'+name) }}: <strong>{{ can(name) ? t('romDebug.available') : t('romDebug.notAvailable') }}</strong></li>
   </ul>
   <ul class="notes"><li v-for="note in backend.notes" :key="note">{{ note }}</li></ul>
  </template>
  <div v-if="game" class="game">
   <p v-if="!game.rom" class="notice">{{ t('romDebug.noRom') }}</p>
   <template v-else>
    <p class="notice" :class="{ok:game.hasLines}">{{ game.hasLines ? t('romDebug.withLines',{rom:game.rom.path,functions:game.functions}) : t('romDebug.withoutLines',{rom:game.rom.path,functions:game.functions}) }}</p>
    <p v-if="game.flavor==='debug'" class="help">{{ t('romDebug.debugRom') }}</p>
    <p v-if="game.association!=='proven'" class="notice problem">{{ t('romDebug.unproven') }}</p>
    <p v-else-if="game.sourcesChanged" class="notice problem">{{ t('romDebug.sourcesChanged') }}</p>
   </template>
  </div>
  <div class="actions">
   <button type="button" :disabled="open||locked" @click="buildForDebug">{{ working==='build' ? t('romDebug.building') : t('romDebug.buildForDebug') }}</button>
   <button v-if="working==='build'" type="button" @click="cancelBuild">{{ t('romDebug.cancelBuild') }}</button>
   <button v-if="!open" type="button" class="primary" :disabled="locked||!game?.rom||!can('registers')||!backend?.installed" @click="start">{{ working==='start' ? t('romDebug.starting') : t('romDebug.start') }}</button>
   <button v-else type="button" class="primary" :disabled="working==='stop'" @click="end">{{ t('romDebug.end') }}</button>
   <button type="button" :disabled="!stopped||locked||!can('step')" @click="step">{{ t('romDebug.step') }}</button>
   <button type="button" :disabled="!stopped||locked||!can('continue')" @click="resume">{{ confirmRun ? t('romDebug.continueAnyway') : t('romDebug.continue') }}</button>
   <button type="button" disabled :title="t('romDebug.pauseWhy')">{{ t('romDebug.pause') }}</button>
  </div>
  <form v-if="can('frames')" class="field" @submit.prevent="advanceFrames">
   <label for="rom-debug-frames">{{ t('romDebug.frames') }}</label>
   <input id="rom-debug-frames" v-model.number="frameCount" type="number" min="1" max="600" :disabled="!stopped||locked">
   <button type="submit" :disabled="!stopped||locked">{{ t('romDebug.advance') }}</button>
  </form>
  <p v-if="confirmRun" role="alert" class="notice problem">{{ t('romDebug.confirmRun') }}</p>
  <ul v-if="buildErrors.length" class="rows"><li v-for="(item,index) in buildErrors" :key="index"><button type="button" class="link" @click="emit('open-source',item)">{{ item.file }}:{{ item.line }}</button> — {{ item.message }}</li></ul>
  <template v-if="open">
   <p role="status" class="notice" :class="{ok:stopped}">
    <template v-if="running">{{ t('romDebug.running') }}</template>
    <template v-else-if="stop">{{ t('romDebug.stoppedAt',{reason:t('romDebug.reason.'+(['start','step','breakpoint','frames'].includes(reason)?reason:'other')),place,pc:stop.pcText}) }}
     <template v-if="stop.source"> · <button type="button" class="link" @click="emit('open-source',{file:stop.source.file,line:stop.source.line,column:1})">{{ stop.source.file }}:{{ stop.source.line }}</button></template>
    </template>
   </p>
   <p v-if="stopped&&stop&&!stop.source&&stop.sourceNote" class="help">{{ stop.sourceNote }}</p>
   <template v-if="stop&&stopped">
    <h4>{{ t('romDebug.registers') }}</h4>
    <dl class="registers"><div v-for="name in REGISTERS" :key="name"><dt>{{ name.toUpperCase() }}</dt><dd>{{ hex(stop.registers[name],name==='sr'?4:8) }}</dd></div></dl>
   </template>
   <h4>{{ t('romDebug.breakpoints') }}</h4>
   <form class="field" @submit.prevent="addBreakpoint">
    <label for="rom-debug-breakpoint">{{ t('romDebug.breakpointAt') }}</label>
    <input id="rom-debug-breakpoint" v-model="breakpointText" :disabled="!stopped||locked" maxlength="200" spellcheck="false" :placeholder="game?.hasLines ? 'main · src/main.c:42 · 0x000200' : 'main · 0x000200'">
    <button type="submit" :disabled="!stopped||locked||!breakpointText.trim()">{{ t('romDebug.add') }}</button>
   </form>
   <p v-if="!session.breakpoints.length" class="help">{{ t('romDebug.noBreakpoints') }}</p>
   <ul v-else class="rows"><li v-for="item in session.breakpoints" :key="item.address"><code>{{ item.addressText }}</code> {{ item.label===item.addressText ? '' : item.label }} <button type="button" :disabled="!stopped||locked" :aria-label="t('romDebug.removeLabel',{label:item.label})" @click="removeBreakpoint(item.address)">{{ t('romDebug.remove') }}</button></li></ul>
   <h4>{{ t('romDebug.memory') }}</h4>
   <form class="field" @submit.prevent="readMemory">
    <label for="rom-debug-memory">{{ t('romDebug.memoryAt') }}</label>
    <input id="rom-debug-memory" v-model="memoryText" :disabled="!stopped||locked" maxlength="200" spellcheck="false">
    <label for="rom-debug-length">{{ t('romDebug.bytes') }}</label>
    <input id="rom-debug-length" v-model.number="memoryLength" type="number" min="1" :max="backend?.memoryLimit||4096" :disabled="!stopped||locked">
    <button type="submit" :disabled="!stopped||locked||!memoryText.trim()">{{ t('romDebug.read') }}</button>
   </form>
   <template v-if="memory">
    <p class="help">{{ t('romDebug.memoryRead',{label:memory.label===memory.addressText?memory.addressText:memory.label+' ('+memory.addressText+')',count:memory.bytes.length,region:memory.region}) }}</p>
    <pre class="dump" tabindex="0" :aria-label="t('romDebug.memory')"><template v-for="row in rows" :key="row.address">{{ row.address }}  {{ row.bytes.padEnd(47) }}  {{ row.text }}
</template></pre>
   </template>
   <template v-if="can('vdp')">
    <h4>{{ t('romDebug.vdp') }}</h4>
    <div class="actions"><button type="button" :disabled="!stopped||locked" @click="readVdp">{{ t('romDebug.readVdp') }}</button></div>
    <template v-if="vdp">
     <p class="help">{{ t('romDebug.vdpHelp') }}</p>
     <table v-for="group in vdp.groups" :key="group.title" class="vdp">
      <caption>{{ group.title }}</caption>
      <thead><tr><th scope="col">{{ t('romDebug.vdpRegister') }}</th><th scope="col">{{ t('romDebug.vdpValue') }}</th><th scope="col">{{ t('romDebug.vdpMeaning') }}</th></tr></thead>
      <tbody><tr v-for="row in group.rows" :key="row.register"><th scope="row">${{ hex(row.register,2) }}</th><td>${{ hex(row.value,2) }}</td><td>{{ row.description }}</td></tr></tbody>
     </table>
     <dl class="registers"><div v-for="item in vdp.internal" :key="item.name"><dt>{{ item.name }}</dt><dd>{{ item.value }}</dd></div></dl>
     <p class="help">{{ t('romDebug.sprites',{count:vdp.sprites.length}) }}</p>
     <table v-if="vdp.sprites.length" class="vdp">
      <thead><tr><th scope="col">#</th><th scope="col">X</th><th scope="col">Y</th><th scope="col">{{ t('romDebug.spriteSize') }}</th><th scope="col">{{ t('romDebug.spritePalette') }}</th><th scope="col">{{ t('romDebug.spritePriority') }}</th><th scope="col">{{ t('romDebug.spritePattern') }}</th><th scope="col">{{ t('romDebug.spriteLink') }}</th></tr></thead>
      <tbody><tr v-for="sprite in vdp.sprites.slice(0,80)" :key="sprite.index"><th scope="row">{{ sprite.index }}</th><td>{{ sprite.x }}</td><td>{{ sprite.y }}</td><td>{{ sprite.width }}×{{ sprite.height }}</td><td>{{ sprite.palette }}</td><td>{{ sprite.priority }}</td><td>${{ hex(sprite.pattern,4) }}</td><td>{{ sprite.link }}</td></tr></tbody>
     </table>
    </template>
   </template>
   <template v-if="can('kdebug')">
    <h4>{{ t('romDebug.kdebug') }}</h4>
    <p v-if="!logs.length" class="help">{{ t('romDebug.noKdebug') }}</p>
    <pre v-else class="dump" tabindex="0" :aria-label="t('romDebug.kdebug')">{{ logs.join('\n') }}</pre>
   </template>
  </template>
 </section>
</template>
<style scoped>
.debugger{font-size:12px}h3{margin:16px 0 6px;font-size:13px}h4{margin:12px 0 4px;font-size:12px}.help,.notes{color:var(--muted,#a7b2b9);line-height:1.45}.help{margin:4px 0}
.field{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0}.actions{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
button,select,input{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:5px 9px}button{cursor:pointer}
button:disabled,select:disabled,input:disabled{opacity:.55;cursor:default}.primary{border-color:var(--accent,#5bbda5)}:is(button,select,input,pre):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
input{min-width:0;flex:1 1 180px}input[type=number]{flex:0 0 90px}.link{border:0;padding:0;background:transparent;text-decoration:underline;overflow-wrap:anywhere}
.capabilities,.notes,.rows{margin:6px 0;padding:0;list-style:none}.capabilities{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:2px 12px}.capabilities .off{color:var(--muted,#a7b2b9)}
.notes{padding-left:16px;list-style:disc}.rows{display:grid;gap:4px}.rows li{padding:5px 8px;border:1px solid var(--border,#41464d);border-radius:3px;overflow-wrap:anywhere}.rows button:not(.link){margin-left:8px;padding:2px 8px}
.notice{margin:8px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4;overflow-wrap:anywhere}.problem{border-color:#e38269;color:#f0b3a3}.ok{border-color:var(--accent,#5bbda5)}
.registers{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:2px 12px;margin:4px 0;font-family:ui-monospace,monospace}.registers div{display:flex;gap:6px}.registers dt{color:var(--muted,#a7b2b9)}.registers dd{margin:0}
.vdp{border-collapse:collapse;margin:6px 0;width:100%}.vdp caption{text-align:left;color:var(--muted,#a7b2b9);padding:2px 0}.vdp :is(th,td){border:1px solid var(--border,#41464d);padding:2px 6px;text-align:left;font-weight:normal;overflow-wrap:anywhere}.vdp thead th{color:var(--muted,#a7b2b9)}
.dump{margin:6px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;overflow:auto;max-height:260px;font-family:ui-monospace,monospace;font-size:11px;line-height:1.4}
</style>
