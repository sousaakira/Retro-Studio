<template>
  <section class="runtime-manager" aria-label="Módulos do runtime">
    <header><strong>Runtime do jogo</strong><button type="button" aria-label="Fechar runtime" @click="$emit('close')">×</button></header>
    <button type="button" @click="showOverview=true">Estado das exportações…</button>
    <ExportOverviewPanel v-if="showOverview" :project-path="projectPath" @close="showOverview=false" />
    <button type="button" @click="showInputs=true">Configurar controles…</button>
    <InputActionsEditor v-if="showInputs" :project-path="projectPath" @close="showInputs=false" />
    <button type="button" @click="showMovement=true">Física e sala de testes…</button>
    <MovementLab v-if="showMovement" :project-path="projectPath" @close="showMovement=false" />
    <button type="button" @click="showWorld=true">Salas e conexões…</button>
    <WorldGraphEditor v-if="showWorld" :project-path="projectPath" @close="showWorld=false" />
    <button type="button" @click="showCamera=true">Câmera…</button>
    <CameraEditor v-if="showCamera" :project-path="projectPath" @close="showCamera=false" />
    <button type="button" @click="showProgress=true">Progresso e save…</button>
    <ProgressEditor v-if="showProgress" :project-path="projectPath" @close="showProgress=false" />
    <button type="button" @click="showAudio=true">Áudio: músicas e efeitos…</button>
    <AudioEditor v-if="showAudio" :project-path="projectPath" @close="showAudio=false" />
    <button type="button" @click="showCutscenes=true">Cutscenes: gatilhos e flags…</button>
    <CutsceneAdapterPanel v-if="showCutscenes" :project-path="projectPath" @close="showCutscenes=false" />
    <button type="button" @click="showToolchain=true">Base técnica e ferramentas…</button>
    <ToolchainPanel v-if="showToolchain" :project-path="projectPath" @close="showToolchain=false" />
    <button type="button" @click="showDebug=true">Diagnóstico em jogo…</button>
    <DebugPanel v-if="showDebug" :project-path="projectPath" @close="showDebug=false" />
    <button type="button" @click="showPalettes=true">Paletas e composição…</button>
    <PaletteEditor v-if="showPalettes" :project-path="projectPath" @close="showPalettes=false" />
    <button type="button" @click="showHud=true">HUD e textos…</button>
    <HudEditor v-if="showHud" :project-path="projectPath" @close="showHud=false" />
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading">Verificando módulos…</p>
    <template v-else-if="status">
      <p>{{ status.upToDate ? 'Módulos na versão atual.' : status.installed ? 'Revise os arquivos antes de atualizar.' : 'Instale os módulos de apoio ao game.' }}</p>
      <p>Instalar os módulos preserva o código do jogo. O game precisa usar as funções instaladas.</p>
      <div v-for="module in status.modules" :key="module.id" class="runtime-module">
        <strong>{{ module.id }} · v{{ module.version }}</strong>
        <small v-if="module.dependencies.length">Depende de {{ module.dependencies.join(', ') }}</small>
      </div>
      <ul><li v-for="file in status.files" :key="file.path"><code>{{ file.path }}</code> <span>{{ labels[file.status] || file.status }}</span></li></ul>
      <p v-if="status.conflicts.length">Há {{ status.conflicts.length }} arquivos personalizados. A atualização exige confirmação e mantém backups.</p>
      <p v-if="status.retainedFiles.length">Arquivos de versões anteriores preservados: {{ status.retainedFiles.join(', ') }}</p>
      <button type="button" :disabled="busy || status.upToDate" @click="install">{{ busy ? 'Instalando…' : status.installed ? 'Revisar atualização…' : 'Revisar instalação…' }}</button>
      <button type="button" :disabled="busy || loading" @click="load">Atualizar lista</button>
    </template>
  </section>
</template>
<script setup>
import { ref, watch } from 'vue'
import InputActionsEditor from './InputActionsEditor.vue'
import MovementLab from './MovementLab.vue'
import WorldGraphEditor from './WorldGraphEditor.vue'
import CameraEditor from './CameraEditor.vue'
import ProgressEditor from './ProgressEditor.vue'
import AudioEditor from './AudioEditor.vue'
import CutsceneAdapterPanel from './CutsceneAdapterPanel.vue'
import ToolchainPanel from './ToolchainPanel.vue'
import DebugPanel from './DebugPanel.vue'
import PaletteEditor from './PaletteEditor.vue'
import HudEditor from './HudEditor.vue'
import ExportOverviewPanel from './ExportOverviewPanel.vue'
const showWorld=ref(false)
const showCamera=ref(false)
const showProgress=ref(false)
const showAudio=ref(false)
const showCutscenes=ref(false)
const showToolchain=ref(false)
const showDebug=ref(false),showPalettes=ref(false),showHud=ref(false)
const showOverview=ref(false)
const showInputs=ref(false)
const showMovement=ref(false)
const props=defineProps({projectPath:{type:String,required:true}})
const emit=defineEmits(['close','installed'])
const loading=ref(false),busy=ref(false),status=ref(null),error=ref('')
const labels={new:'Novo',current:'Atual',update:'Atualização',modified:'Personalizado',unmanaged:'Não gerenciado'}
let request=0
async function load(){
  const id=++request,projectPath=props.projectPath
  loading.value=true;error.value='';status.value=null
  try{
    const result=await window.retroStudio?.retro?.runtimeStatus?.({projectPath})
    if(id!==request)return
    if(!result?.available)throw Error(result?.error||'Biblioteca do runtime indisponível.')
    status.value=result
  }catch(e){if(id===request)error.value=e.message}
  finally{if(id===request)loading.value=false}
}
async function install(){
  if(busy.value)return
  const projectPath=props.projectPath
  busy.value=true;error.value=''
  try{
    const result=await window.retroStudio?.retro?.installRuntime?.({projectPath})
    if(props.projectPath!==projectPath||result?.cancelled)return
    if(!result?.success)throw Error(result?.error||'Não foi possível instalar os módulos.')
    emit('installed');await load()
  }catch(e){if(props.projectPath===projectPath)error.value=e.message}
  finally{busy.value=false}
}
watch(()=>props.projectPath,()=>{request++;status.value=null;if(props.projectPath)void load()},{immediate:true})
</script>
<style scoped>
.runtime-manager{flex:0 0 auto;max-height:45%;overflow:auto;padding:10px;border-bottom:1px solid var(--border);background:var(--panel);color:var(--text);font-size:12px}
header{display:flex;align-items:center;justify-content:space-between;gap:8px}
button{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:5px 8px;cursor:pointer}
button:disabled{opacity:.55;cursor:default}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.runtime-module{display:flex;flex-direction:column;gap:4px;margin-block:8px}
ul{padding-left:18px}li{margin-block:5px;overflow-wrap:anywhere}li span,small{color:var(--muted)}code{font-size:11px}
</style>
