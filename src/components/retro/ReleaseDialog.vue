<script setup>
// Botão Construir (barra de título, Ctrl+Shift+B): gera uma versão para teste (#100). O Jogar
// continua sendo o build de teste; "Só compilar" mantém o build simples, sem registrar versão.
import {ref,watch,nextTick,onBeforeUnmount} from 'vue'
import {useI18n} from 'vue-i18n'
import RomReleases from './RomReleases.vue'
const {t}=useI18n()
const props=defineProps({open:Boolean,projectPath:{type:String,default:''},busy:Boolean})
const emit=defineEmits(['close','build-only','building'])
const creating=ref(false),panel=ref(null)
function close(){if(!creating.value)emit('close')}
function buildOnly(){if(creating.value||props.busy)return;emit('close');emit('build-only')}
function onBuilding(value){creating.value=value;emit('building',value)}
function onKey(e){if(e.key==='Escape'&&props.open){e.stopPropagation();close()}}
watch(()=>props.open,async open=>{
 if(open){window.addEventListener('keydown',onKey,true);await nextTick();panel.value?.querySelector('textarea, input')?.focus()}
 else window.removeEventListener('keydown',onKey,true)
},{immediate:true})
onBeforeUnmount(()=>window.removeEventListener('keydown',onKey,true))
</script>
<template>
 <div v-if="open" class="dialog-overlay" @click.self="close">
  <div ref="panel" class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="release-dialog-title">
   <div class="dialog-head">
    <h2 id="release-dialog-title">{{ t('romReleases.dialogTitle') }}</h2>
    <button type="button" class="icon" :disabled="creating" :aria-label="t('romReleases.close')" :title="t('romReleases.close')" @click="close">×</button>
   </div>
   <RomReleases :project-path="projectPath" :active="open" :busy="busy" compact @building="onBuilding" />
   <div class="dialog-actions">
    <span class="help">{{ t('romReleases.buildOnlyHelp') }}</span>
    <button type="button" :disabled="creating||busy" @click="buildOnly">{{ t('romReleases.buildOnly') }}</button>
   </div>
  </div>
 </div>
</template>
<style scoped>
.dialog-overlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55)}
.dialog-panel{box-sizing:border-box;width:min(640px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:14px 16px;color:var(--text,#ddd);background:var(--panel,#1f252b);border:1px solid var(--border,#41464d);border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.45);font-size:13px}
.dialog-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
h2{margin:0;font-size:15px;font-weight:600}
.dialog-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border,#41464d)}
.dialog-actions .help{flex:1;min-width:200px;color:var(--muted,#a7b2b9)}
button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:5px 10px;cursor:pointer}
button:disabled{opacity:.55;cursor:default}
.icon{width:28px;height:28px;padding:0;font-size:18px;line-height:1;background:transparent;border-color:transparent}
.icon:hover:not(:disabled){border-color:var(--border,#41464d)}
</style>
