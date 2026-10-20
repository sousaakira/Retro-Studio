<script setup>
// #89: instrumentos da internet. Navega a biblioteca do Furnace (pastas do Mega Drive), ouve antes
// (▶ baixa, importa e toca sem pôr na música), marca os que quiser e importa; ou baixa de um link https.
// O download é do processo principal (electron/retro/instrumentLibrary.js); a leitura é do importador puro.
import {ref,reactive,computed,onMounted} from 'vue'
import {importInstrumentFile} from '../../../shared/retro/instrumentFormats.js'
import {useChipSynth} from '../../composables/useChipSynth.js'
const emit=defineEmits(['import','close'])
const {previewPatch}=useChipSynth()
const LIBRARY='furnace',PAGE=150
const listing=ref(null),loading=ref(false),error=ref(''),folder=ref('OPN'),category=ref(''),query=ref(''),limit=ref(PAGE)
const selected=ref(new Set()),busy=ref(''),notice=ref(''),link=ref('')
const parsed=reactive({})   // caminho → {instruments, warnings} ou {error}
const api=()=>window.retroStudio?.retro
const normalize=text=>String(text||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
const entries=computed(()=>listing.value?.entries||[])
const categories=computed(()=>[...new Set(entries.value.filter(entry=>entry.folder===folder.value).map(entry=>entry.category))].filter(Boolean).sort())
const filtered=computed(()=>{
 const words=normalize(query.value).split(/\s+/).filter(Boolean)
 return entries.value.filter(entry=>entry.folder===folder.value&&(!category.value||entry.category===category.value||entry.category.startsWith(category.value+'/'))&&
  words.every(word=>normalize(entry.name+' '+entry.category).includes(word)))
})
const shown=computed(()=>filtered.value.slice(0,limit.value))
async function load(refresh=false){
 loading.value=true;error.value=''
 try{listing.value=await api().listInstrumentLibrary({library:LIBRARY,refresh})}
 catch(problem){error.value=problem.message}
 finally{loading.value=false}
}
async function parse(entry){
 if(parsed[entry.path])return parsed[entry.path]
 try{
  const file=await api().fetchLibraryInstrument({library:LIBRARY,path:entry.path})
  const result=importInstrumentFile(file.name,file.bytes)
  const source='Furnace: '+entry.path
  parsed[entry.path]={instruments:result.instruments.map(item=>({...item,source})),warnings:result.warnings}
 }catch(problem){parsed[entry.path]={error:problem.message}}
 return parsed[entry.path]
}
// Altura da prévia pela categoria (baixo grave, bateria no meio).
const previewNote=entry=>/bass|baixo/i.test(entry.category+entry.name)?45:/drum|perc|kick|snare|hat/i.test(entry.category+entry.name)?50:60
async function listen(entry){
 busy.value=entry.path
 const result=await parse(entry)
 busy.value=''
 if(result.instruments?.[0])previewPatch(result.instruments[0],previewNote(entry))
}
function toggle(entry){const next=new Set(selected.value);next.has(entry.path)?next.delete(entry.path):next.add(entry.path);selected.value=next}
async function importSelected(){
 const chosen=entries.value.filter(entry=>selected.value.has(entry.path)),found=[],failed=[]
 for(const [index,entry] of chosen.entries()){
  busy.value='Baixando '+(index+1)+' de '+chosen.length+'…'
  const result=await parse(entry)
  if(result.error)failed.push(entry.name+': '+result.error);else found.push(...result.instruments)
 }
 busy.value=''
 if(found.length)emit('import',{instruments:found,choose:false})
 notice.value=(found.length?found.length+' instrumento(s) importado(s) para a música.':'')+(failed.length?' Não importados: '+failed.join('; '):'')
 selected.value=new Set()
}
async function importLink(){
 if(!link.value.trim())return
 busy.value='Baixando o link…';notice.value=''
 try{
  const file=await api().fetchInstrumentUrl({url:link.value.trim()})
  const result=importInstrumentFile(file.name,file.bytes)
  emit('import',{instruments:result.instruments.map(item=>({...item,source:file.url.slice(0,200)})),choose:result.instruments.length>1,warnings:result.warnings})
  notice.value=result.instruments.length>1?'O arquivo tem '+result.instruments.length+' instrumentos: escolha quais entram.':'Instrumento importado para a música.'
  link.value=''
 }catch(problem){notice.value='Não foi possível importar o link: '+problem.message}
 finally{busy.value=''}
}
const openSource=()=>listing.value&&window.retroStudio?.openExternal?.(listing.value.library.url)
onMounted(()=>load())
</script>
<template>
 <section class="instrument-browser" aria-labelledby="browser-title">
  <div class="head"><h3 id="browser-title">Instrumentos da internet</h3><button type="button" class="primary" @click="emit('close')">Concluir</button></div>
  <p v-if="listing" class="help credit">{{ listing.library.credit }} <button type="button" class="link" @click="openSource">Ver no GitHub</button><span v-if="listing.stale"> · sem conexão: mostrando a lista guardada</span></p>
  <p v-if="error" role="alert" class="problem">{{ error }} <button type="button" @click="load()">Tentar de novo</button></p>
  <p v-if="loading" role="status" class="help">Carregando a biblioteca…</p>
  <template v-if="listing">
   <div class="folders" role="tablist" aria-label="Chip">
    <button v-for="(label,id) in listing.library.folders" :key="id" type="button" role="tab" :aria-selected="folder===id" @click="folder=id;category='';limit=PAGE">{{ label }}</button>
   </div>
   <div class="filters">
    <input v-model="query" type="search" placeholder="Buscar (ex.: bass, piano, snare)" aria-label="Buscar instrumento" @input="limit=PAGE" />
    <select v-model="category" aria-label="Categoria" @change="limit=PAGE"><option value="">Todas as categorias</option><option v-for="item in categories" :key="item" :value="item">{{ item }}</option></select>
   </div>
   <p class="help">{{ filtered.length }} instrumento(s). ▶ ouve antes de importar; marque os que quiser.</p>
   <ul class="results" aria-label="Instrumentos encontrados">
    <li v-for="entry in shown" :key="entry.path" :class="{chosen:selected.has(entry.path)}">
     <label><input type="checkbox" :checked="selected.has(entry.path)" @change="toggle(entry)" /><span class="name">{{ entry.name }}</span></label>
     <small>{{ entry.category || '—' }} · {{ entry.format.toUpperCase() }}</small>
     <button type="button" class="play" :aria-label="'Ouvir '+entry.name" :disabled="busy===entry.path" @click="listen(entry)">{{ busy===entry.path ? '…' : '▶' }}</button>
     <small v-if="parsed[entry.path]?.error" class="problem row-error">{{ parsed[entry.path].error }}</small>
    </li>
   </ul>
   <button v-if="filtered.length>shown.length" type="button" @click="limit+=PAGE">Mostrar mais ({{ filtered.length-shown.length }})</button>
   <div class="actions">
    <button type="button" class="primary" :disabled="!selected.size || !!busy" @click="importSelected">Importar {{ selected.size || '' }} selecionado(s)</button>
    <button type="button" :disabled="!selected.size" @click="selected=new Set()">Limpar seleção</button>
    <button type="button" :disabled="loading" title="Buscar a lista de novo no GitHub" @click="load(true)">Atualizar lista</button>
   </div>
  </template>
  <fieldset class="url"><legend>De um link</legend>
   <p class="help">Link https direto para um arquivo .tfi, .dmp, .fui, .opni ou .wopn (até 2 MiB).</p>
   <div class="row"><input v-model="link" type="url" placeholder="https://…" aria-label="Link do instrumento" @keydown.enter="importLink" /><button type="button" :disabled="!link.trim() || !!busy" @click="importLink">Importar</button></div>
  </fieldset>
  <p v-if="busy && !busy.includes('/')" role="status" class="help">{{ busy }}</p>
  <p v-if="notice" role="status" class="notice">{{ notice }}</p>
 </section>
</template>
<style scoped>
.instrument-browser{display:flex;flex-direction:column;gap:8px;min-height:0}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px}h3{margin:0;font-size:13px}
small,.help{color:var(--muted,#a7b2b9)}.help{margin:0;line-height:1.45}.credit{font-size:11px}
.problem{color:#f0b3a3}.notice{margin:0;padding:6px 8px;border:1px solid var(--accent,#5bbda5);border-radius:3px;line-height:1.4}
.link{border:0;background:none;padding:0;color:var(--accent,#5bbda5);text-decoration:underline;cursor:pointer}
.folders{display:flex;gap:4px;flex-wrap:wrap}.folders [aria-selected=true]{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
.filters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px}
.results{list-style:none;margin:0;padding:0;max-height:min(52vh,520px);overflow:auto;border:1px solid var(--border,#41464d);border-radius:3px}
.results li{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'name play' 'meta play' 'error error';gap:0 6px;padding:5px 7px;border-bottom:1px solid var(--border,#41464d)}
.results li.chosen{background:color-mix(in srgb,var(--accent,#5bbda5) 12%,transparent)}
.results label{grid-area:name;display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer}.results .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.results small{grid-area:meta;padding-left:22px}.results .play{grid-area:play;align-self:center;min-width:32px}.results .row-error{grid-area:error;padding-left:22px}
.actions,.row{display:flex;gap:6px;flex-wrap:wrap}.row input{flex:1}
fieldset{min-width:0;margin:0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;display:flex;flex-direction:column;gap:6px}legend{padding:0 4px;font-weight:500}
button,input,select{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:4px 7px;min-width:0}
button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.primary{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
input[type=checkbox]{padding:0;accent-color:var(--accent,#5bbda5)}
:is(button,input,select):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
</style>
