<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
import {validateDebugConfiguration} from '../../../shared/retro/debugConfiguration.js'
import {useDocumentUndo} from '../../composables/useDocumentUndo.js'
const props=defineProps({projectPath:{type:String,required:true},embedded:Boolean,active:{type:Boolean,default:true}}),emit=defineEmits(['close'])
const dialogElement=ref(null),config=ref(null),baseline=ref(''),status=ref(null),loading=ref(false),saving=ref(false),error=ref(''),saved=ref(false)
let request=0,disposed=false
const clone=value=>JSON.parse(JSON.stringify(value))
const blocked=computed(()=>loading.value||saving.value)
// serial and seed are stamped by the service on every export: they are not edits.
const history=useDocumentUndo(config,{blocked:()=>blocked.value,key:value=>JSON.stringify({...value,serial:undefined,seed:undefined})})
const dirty=computed(()=>!!config.value&&JSON.stringify(config.value)!==baseline.value)
const validation=computed(()=>{try{if(config.value)validateDebugConfiguration(config.value);return ''}catch(e){return e.message}})
// What the service could PROVE about the ROM on disk. Everything else is said to be unknown.
const reasons={'rom-unreadable':'a ROM do último build não está mais no disco','rom-changed':'a ROM em disco não é a do último build registrado pela IDE (por exemplo, um build feito pelo terminal)',
 'no-header':'o último build da IDE não usou o header de diagnóstico','other-configuration':'o último build da IDE usou outra configuração de diagnóstico, ou a atual ainda não foi exportada',
 'inputs-changed':'arquivos do projeto mudaram durante o último build','identifier-not-in-rom':'o último build usou este header, mas a identificação não está na ROM (o jogo não usa o diagnóstico, ou não foi recompilado: faça um build limpo)'}
const association=computed(()=>{
 const s=status.value,last=s?.lastBuild
 if(!s)return ''
 if(s.foreign)return 'Existe um debug/debug.json de outra ferramenta neste projeto. Ele foi preservado e o diagnóstico da IDE não está em uso.'
 if(!last)return 'Sem registro de build da IDE para este projeto: não se sabe com que configuração a ROM atual foi feita.'
 const rom='ROM '+last.rom.path+' ('+last.rom.hash.slice(0,12)+'…)'
 if(last.state==='diagnostic')return rom+': é o diagnóstico #'+last.build+', confirmado pela identificação gravada na própria ROM.'
 if(last.state==='production-header')return rom+': o último build da IDE usou o header de produção. A IDE não confere se todos os arquivos foram recompilados; na dúvida, faça um build limpo.'
 return 'Não é possível afirmar com que configuração a ROM atual foi feita: '+(reasons[last.reason]||'estado desconhecido')+'.'
})
function apply(result){status.value=result;config.value=clone(result.config);baseline.value=JSON.stringify(result.config)}
async function load(){
 if(saving.value)return
 const projectPath=props.projectPath,id=++request
 loading.value=true;error.value='';status.value=null;config.value=null;saved.value=false
 try{
  const result=await window.retroStudio?.retro?.debugConfiguration?.({projectPath})
  if(disposed||id!==request)return
  if(!result?.config)throw Error(result?.error||'Diagnóstico indisponível.')
  apply(result)
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed&&id===request)loading.value=false}
}
async function save(){
 if(blocked.value||!config.value||validation.value||status.value?.headerConflict||status.value?.foreign)return
 const projectPath=props.projectPath,id=request
 saving.value=true;error.value=''
 try{
  const result=await window.retroStudio?.retro?.saveDebugConfiguration?.({projectPath,config:clone(config.value),revision:status.value.revision})
  if(!result?.success)throw Error(result?.error||'Não foi possível exportar o diagnóstico.')
  if(disposed||id!==request||projectPath!==props.projectPath)return
  apply(result);saved.value=true
 }catch(e){if(!disposed&&id===request)error.value=e.message}
 finally{if(!disposed){saving.value=false;if(id!==request)void load()}}
}
function close(discard=false){
 if(saving.value)return
 if(dirty.value&&!discard){error.value='Exporte o diagnóstico ou use “Descartar e fechar”.';return}
 emit('close')
}
function canClose(){return !dirty.value&&!saving.value}
// #45: hosted in the bottom dock. Hidden: nothing keeps playing. Shown again while clean: the
// file may have been changed by the same editor opened elsewhere, so it is read again.
watch(()=>props.active,active=>{if(!props.embedded)return;if(active&&!dirty.value&&!loading.value&&!saving.value&&config.value)void load()})
defineExpose({canClose})
watch(()=>props.projectPath,()=>{saving.value=false;void load()},{immediate:true})
onMounted(()=>dialogElement.value?.showModal?.())
onBeforeUnmount(()=>{disposed=true;request++;dialogElement.value?.close?.()})
</script>
<template>
 <Teleport to="body" :disabled="embedded">
  <component :is="embedded ? 'section' : 'dialog'" ref="dialogElement" class="debug-dialog" :class="{embedded}" aria-labelledby="debug-title" @cancel.prevent="close()" @keydown="history.onKeydown">
   <header><div><small>MEGA DRIVE · DIAGNÓSTICO</small><h2 id="debug-title">Diagnóstico em jogo</h2></div><button v-if="!embedded" type="button" :disabled="saving" autofocus @click="close()">Fechar</button></header>
   <div class="debug-body">
    <p class="help">Um build de diagnóstico mostra, dentro do jogo, o que o console está fazendo. O build de produção não leva nada disso: o código de diagnóstico não é compilado. O jogo precisa usar o módulo <code>debug</code> dentro de <code>#if RETRO_PROJECT_DEBUG</code>, como no projeto inicial.</p>
    <p v-if="loading" role="status" class="notice">Carregando diagnóstico…</p>
    <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
    <template v-if="config">
     <fieldset :disabled="blocked"><legend>Modo</legend>
      <label class="check"><input v-model="config.enabled" type="radio" :value="false" />Produção · sem instrumentação</label>
      <label class="check"><input v-model="config.enabled" type="radio" :value="true" />Diagnóstico · instrumentação compilada na ROM</label>
     </fieldset>
     <fieldset :disabled="blocked || !config.enabled"><legend>O que mostrar</legend>
      <label class="check"><input v-model="config.overlay.performance" type="checkbox" />Desempenho: CPU por quadro, FPS, fila de DMA, VRAM e sprites</label>
      <label class="check"><input v-model="config.overlay.subject" type="checkbox" />Personagem: estado, animação, posição, velocidade e contatos</label>
      <label class="check"><input v-model="config.overlay.boxes" type="checkbox" />Caixas de colisão e áreas desenhadas sobre o jogo</label>
      <label class="field"><span>Enviar registros para o emulador</span><select v-model="config.transport"><option value="none">Não enviar</option><option value="kdebug">Console de depuração (KDebug)</option></select></label>
     </fieldset>
     <ul class="notes">
      <li>Só aparecem valores medidos pelo console. O que o SGDK 1.81 não deixa medir (por exemplo, a VRAM livre do motor de sprites) aparece como “--”, nunca como estimativa. A carga de CPU é a que o SGDK informa: uma média de 8 quadros.</li>
      <li>A própria sobreposição gasta CPU: a carga mostrada inclui o diagnóstico, e um jogo no limite pode perder quadros só por ele estar ligado.</li>
      <li>Os registros KDebug só chegam a emuladores que implementam esse console; a IDE ainda não os lê sozinha.</li>
     </ul>
     <p v-if="status?.build && !dirty" class="notice">Identificação desta exportação: <strong>#{{ status.build }}</strong>. Ela aparece na tela do jogo e muda a cada exportação; recompilar sem exportar mantém a mesma.</p>
     <p class="notice">{{ association }}</p>
     <p v-if="validation" role="alert" class="notice problem">{{ validation }}</p>
     <p v-if="status?.headerConflict" role="alert" class="notice problem">O header src/generated/debug_config.h foi alterado fora da IDE e será preservado. O build fica bloqueado até ele ser revisado; para voltar ao gerado, apague o arquivo e exporte de novo.</p>
    </template>
   </div>
   <footer><span class="history-buttons" role="group" aria-label="Histórico de edição"><button type="button" :disabled="blocked || !history.canUndo.value" title="Desfazer (Ctrl+Z)" @click="history.undo()">Desfazer</button><button type="button" :disabled="blocked || !history.canRedo.value" title="Refazer (Ctrl+Shift+Z)" @click="history.redo()">Refazer</button></span><div><small role="status">{{ saving ? 'Exportando…' : dirty ? 'Alterações não exportadas.' : saved ? 'Diagnóstico exportado. Faça um build para aplicar.' : 'debug/debug.json · src/generated/debug_config.h' }}</small></div><button type="button" :disabled="blocked" @click="load">{{ dirty ? 'Descartar e recarregar' : 'Recarregar' }}</button><button v-if="dirty && !embedded" type="button" :disabled="saving" @click="close(true)">Descartar e fechar</button><button type="button" class="primary" :disabled="blocked || !config || !!validation || !!status?.headerConflict || !!status?.foreign" @click="save">Salvar e exportar diagnóstico</button></footer>
  </component>
 </Teleport>
</template>
<style scoped>
.debug-dialog{box-sizing:border-box;width:min(720px,96vw);max-width:96vw;max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.debug-dialog[open],.debug-dialog.embedded{display:flex;flex-direction:column}.debug-dialog.embedded{width:100%;max-width:none;height:100%;max-height:none;border:0;border-radius:0}.debug-dialog::backdrop{background:#0009}
header,footer{display:flex;align-items:center;gap:10px;padding:12px;flex-shrink:0}header{justify-content:space-between;border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d);flex-wrap:wrap}footer>div{flex:1;min-width:180px}
.debug-body{padding:14px;overflow:auto;min-height:0}
h2{margin:3px 0;font-size:19px}small,.help{color:var(--muted,#a7b2b9)}.help{margin:6px 0;line-height:1.5}code{font-size:11px}
button,select{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px}button{cursor:pointer}button:disabled,fieldset:disabled{opacity:.5;cursor:default}.primary{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
:is(button,select,input):focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
fieldset{min-width:0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;margin:10px 0}.check{display:flex;align-items:flex-start;gap:6px;margin:6px 0;line-height:1.4}
.field{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:8px;margin:8px 0 2px}.field select{width:100%}
.notes{margin:8px 0;padding-left:18px;line-height:1.5;color:var(--muted,#a7b2b9)}
.notice{margin:8px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4;overflow-wrap:anywhere}.problem{border-color:#e38269;color:#f0b3a3}
@media(max-width:520px){.field{grid-template-columns:1fr}}
.history-buttons{display:inline-flex;gap:4px}
</style>
