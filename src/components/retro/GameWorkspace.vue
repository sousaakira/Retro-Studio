<script setup>
// Modo Jogo: os sistemas do jogo (mundo, câmera, HUD, áudio…) em uma tela só, com o estado da
// exportação de cada um. Substitui o painel "Runtime" que ficava dentro de Recursos.
import { ref, computed, watch, onBeforeUnmount } from 'vue'
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
const props = defineProps({ projectPath: { type: String, default: '' }, active: Boolean, retro: Boolean })
const emit = defineEmits(['installed'])
const EDITORS = { world: WorldGraphEditor, camera: CameraEditor, inputs: InputActionsEditor, movement: MovementLab, hud: HudEditor, palettes: PaletteEditor, audio: AudioEditor, cutscenes: CutsceneAdapterPanel, progress: ProgressEditor, debug: DebugPanel, toolchain: ToolchainPanel, overview: ExportOverviewPanel }
// row: linha correspondente em "Estado das exportações" (quando o sistema gera arquivos para o build).
const GROUPS = [
  { title: 'Mundo e jogador', systems: [
    { id: 'world', row: 'world', title: 'Salas e conexões', text: 'As salas do jogo, as passagens entre elas e onde o jogador começa.', icon: 'M4 5h7v6H4zM13 13h7v6h-7zM11 8h3v5M7.5 11v5H13' },
    { id: 'camera', row: 'camera', title: 'Câmera', text: 'Como a câmera acompanha o jogador: velocidade, zona de tolerância e limites por sala.', icon: 'M4 8h11v9H4zM15 11l5-3v9l-5-3M7 8l1.500-2.500h4L14 8' },
    { id: 'inputs', title: 'Controles', text: 'Quais botões do controle fazem cada ação do jogo.', icon: 'M7 8h10a4 4 0 0 1 4 4v1.500a3.500 3.500 0 0 1-6.300 2.100L14 15h-4l-.700.600A3.500 3.500 0 0 1 3 13.500V12a4 4 0 0 1 4-4zM7.500 10.800v3M6 12.300h3M16.500 12.300h.010' },
    { id: 'movement', title: 'Física e sala de testes', text: 'Velocidade, pulo e gravidade do personagem, com uma sala para experimentar.', icon: 'M4 19h16M6 19c1-9 5-13 12-13M15 6h3v3' }
  ] },
  { title: 'Apresentação', systems: [
    { id: 'hud', row: 'hud', title: 'HUD e textos', text: 'Vida, pontos, menus e caixas de diálogo que o jogador vê na tela.', icon: 'M3.500 5h17v14h-17zM6 8h6M6 11h3M14 15.500h4M6 15.500h4' },
    { id: 'palettes', row: 'palettes', title: 'Paletas e composição', text: 'As quatro paletas de cores, ciclos de cor e fades.', icon: 'M12 4a8 8 0 1 0 0 16c1.500 0 2-1 1.500-2.200-.500-1.300.300-2.300 1.700-2.300H17a3 3 0 0 0 3-3c0-4.700-3.600-8.500-8-8.500zM8 11h.010M11 8h.010M15 9h.010' },
    { id: 'audio', row: 'audio', title: 'Áudio: músicas e efeitos', text: 'As músicas e os efeitos sonoros do jogo e onde cada um toca.', icon: 'M9 17V6l10-2v11M9 17a2.500 2.500 0 1 1-2.500-2.500M19 15a2.500 2.500 0 1 1-2.500-2.500' },
    { id: 'cutscenes', row: 'cutscene-adapter', title: 'Cutscenes: gatilhos e flags', text: 'O que dispara cada cena e quais marcas de progresso ela usa.', icon: 'M4 6h16v12H4zM4 9.500h16M8 6l-1.500 3.500M12.500 6 11 9.500M17 6l-1.500 3.500M10.500 12.500v3l2.800-1.500z' }
  ] },
  { title: 'Projeto', systems: [
    { id: 'progress', row: 'progress', title: 'Progresso e save', text: 'O que o jogo guarda: itens, portas abertas, fase atual e o save.', icon: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6' },
    { id: 'debug', row: 'debug', title: 'Diagnóstico em jogo', text: 'Informações de teste mostradas na tela durante o jogo (colisões, FPS, memória).', icon: 'M9 9h6v7a3 3 0 0 1-6 0zM10 9a2 2 0 0 1 4 0M5 12h4M15 12h4M6 18l3-2M18 18l-3-2M6.500 7 9 9.500M17.500 7 15 9.500' },
    { id: 'toolchain', title: 'Base técnica e ferramentas', text: 'Versão do SGDK, compilador e ferramentas que o projeto exige.', icon: 'M14.500 6a4 4 0 0 0-5 5L4 16.500 7.500 20l5.500-5.500a4 4 0 0 0 5-5L15.500 12 12 8.500z' }
  ] }
]
const STATES = { current: 'Exportado', stale: 'Desatualizado', unexported: 'Não exportado', conflict: 'Alterado fora da IDE', failed: 'Com erro', absent: 'Ainda não usado' }
const FILE_LABELS = { new: 'Novo', current: 'Atual', update: 'Atualização', modified: 'Personalizado', unmanaged: 'Não gerenciado' }
const overview = ref(null), status = ref(null), loading = ref(false), busy = ref(false), error = ref(''), moduleError = ref(''), opened = ref(''), heading = ref(null)
let request = 0, disposed = false
const rows = computed(() => Object.fromEntries((overview.value?.rows || []).map(row => [row.id, row])))
const blocking = computed(() => new Set(overview.value?.blocksBuild || []))
const attention = computed(() => (overview.value?.rows || []).filter(row => !['current', 'absent'].includes(row.state)).length)
const headline = computed(() => {
  if (!overview.value) return ''
  if (blocking.value.size) return `${blocking.value.size} exportação(ões) impede(m) o build pela IDE.`
  return attention.value ? `${attention.value} exportação(ões) pede(m) atenção, sem impedir o build.` : 'Tudo o que o jogo usa está exportado.'
})
async function load() {
  if (!props.projectPath || !props.retro) { overview.value = null; status.value = null; return }
  const projectPath = props.projectPath, id = ++request
  loading.value = true; error.value = ''; moduleError.value = ''
  try {
    const [exports, modules] = await Promise.all([window.retroStudio?.retro?.exportOverview?.({ projectPath }), window.retroStudio?.retro?.runtimeStatus?.({ projectPath })])
    if (disposed || id !== request) return
    if (exports?.rows) overview.value = exports; else { overview.value = null; error.value = exports?.error || 'Não foi possível conferir as exportações.' }
    if (modules?.available) status.value = modules; else { status.value = null; moduleError.value = modules?.error || 'Biblioteca de módulos indisponível.' }
  } catch (problem) { if (!disposed && id === request) error.value = problem.message }
  finally { if (!disposed && id === request) loading.value = false }
}
async function install() {
  if (busy.value) return
  const projectPath = props.projectPath
  busy.value = true; moduleError.value = ''
  try {
    const result = await window.retroStudio?.retro?.installRuntime?.({ projectPath })
    if (props.projectPath !== projectPath || result?.cancelled) return
    if (!result?.success) throw Error(result?.error || 'Não foi possível instalar os módulos.')
    emit('installed'); await load()
  } catch (problem) { if (props.projectPath === projectPath) moduleError.value = problem.message }
  finally { busy.value = false }
}
// Ao fechar um editor, o estado da exportação dele pode ter mudado.
function close() { opened.value = ''; void load() }
function focus() { heading.value?.focus?.() }
defineExpose({ load, focus, open: id => { if (EDITORS[id]) opened.value = id } })
watch(() => [props.projectPath, props.active, props.retro], () => { if (props.active) void load(); else request++ }, { immediate: true })
watch(() => props.projectPath, () => { opened.value = '' })
onBeforeUnmount(() => { disposed = true; request++ })
</script>
<template>
  <section class="game" aria-labelledby="game-title">
    <header>
      <div><small>Sistemas do jogo</small><h2 id="game-title" ref="heading" tabindex="-1">Jogo</h2></div>
      <p v-if="headline" class="headline" role="status" :class="{ blocks: blocking.size, warns: !blocking.size && attention }">{{ headline }}</p>
      <div class="actions">
        <button type="button" :disabled="!retro" @click="opened = 'overview'">Estado das exportações…</button>
        <button type="button" :disabled="loading || !retro" @click="load">{{ loading ? 'Conferindo…' : 'Conferir de novo' }}</button>
      </div>
    </header>
    <div class="game-body">
      <p v-if="!retro" class="notice">Abra um projeto de jogo para configurar os sistemas dele.</p>
      <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
      <template v-if="retro">
        <section v-for="group in GROUPS" :key="group.title" :aria-label="group.title">
          <h3>{{ group.title }}</h3>
          <div class="cards">
            <button v-for="system in group.systems" :key="system.id" type="button" class="card" :class="rows[system.row] ? 'state-' + rows[system.row].state : ''" :data-system="system.id" @click="opened = system.id">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="system.icon" /></svg>
              <span class="card-text"><strong>{{ system.title }}</strong><span>{{ system.text }}</span>
                <em v-if="rows[system.row]?.message" class="card-message">{{ rows[system.row].message }}</em></span>
              <span v-if="rows[system.row]" class="badge">{{ STATES[rows[system.row].state] || rows[system.row].state }}<template v-if="blocking.has(system.row)"> · impede o build</template></span>
            </button>
          </div>
        </section>
        <section aria-labelledby="game-modules" class="modules">
          <h3 id="game-modules">Módulos de apoio</h3>
          <p class="help">Código pronto que a IDE instala no projeto (colisão, câmera, HUD, áudio…) para o jogo usar. Instalar ou atualizar preserva o código do jogo e guarda cópia do que for alterado.</p>
          <p v-if="moduleError" role="alert" class="notice problem">{{ moduleError }}</p>
          <p v-else-if="loading && !status" role="status" class="notice">Verificando módulos…</p>
          <template v-else-if="status">
            <p class="notice" :class="{ ok: status.upToDate }">{{ status.upToDate ? 'Módulos na versão atual.' : status.installed ? 'Há atualização de módulos: revise os arquivos antes de aplicar.' : 'Os módulos de apoio ainda não foram instalados neste projeto.' }}</p>
            <ul class="chips"><li v-for="module in status.modules" :key="module.id" :title="module.dependencies.length ? 'Depende de ' + module.dependencies.join(', ') : ''">{{ module.id }} <small>v{{ module.version }}</small></li></ul>
            <p v-if="status.conflicts.length" class="help">Há {{ status.conflicts.length }} arquivo(s) personalizado(s). A atualização pede confirmação e mantém backups.</p>
            <p v-if="status.retainedFiles.length" class="help">Arquivos de versões anteriores preservados: {{ status.retainedFiles.join(', ') }}</p>
            <div class="actions">
              <button type="button" class="primary" :disabled="busy || status.upToDate" @click="install">{{ busy ? 'Instalando…' : status.installed ? 'Revisar atualização…' : 'Revisar instalação…' }}</button>
            </div>
            <details v-if="status.files.length"><summary>Arquivos dos módulos ({{ status.files.length }})</summary>
              <ul class="files"><li v-for="file in status.files" :key="file.path"><code>{{ file.path }}</code> <span>{{ FILE_LABELS[file.status] || file.status }}</span></li></ul>
            </details>
          </template>
        </section>
      </template>
    </div>
    <component :is="EDITORS[opened]" v-if="opened && projectPath" :key="opened" :project-path="projectPath" @close="close" />
  </section>
</template>
<style scoped>
.game{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--border,#41464d);flex-shrink:0}
h2{margin:3px 0;font-size:19px}h2:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:3px}
h3{margin:22px 0 10px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#a7b2b9)}
small,.help{color:var(--muted,#a7b2b9)}.help{margin:0 0 8px;max-width:760px;line-height:1.5}
.headline{margin:0 0 0 auto;padding:4px 10px;border:1px solid var(--accent,#5bbda5);border-radius:3px}.headline.warns{border-color:#e5c07b;color:#e5c07b}.headline.blocks{border-color:#e38269;color:#f0b3a3}
.actions{display:flex;flex-wrap:wrap;gap:6px}
.game-body{flex:1;min-height:0;overflow:auto;padding:0 20px 24px}
.game-body>section{max-width:1280px}
button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px 10px;cursor:pointer}
button:disabled{opacity:.55;cursor:default}button:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}.primary{border-color:var(--accent,#5bbda5)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
.card{display:grid;grid-template-columns:40px minmax(0,1fr);grid-template-rows:1fr auto;gap:8px 12px;align-items:start;min-height:112px;padding:14px;border-radius:6px;text-align:left;transition:border-color .12s ease,background-color .12s ease}
.card:hover{border-color:var(--accent,#5bbda5);background:rgba(255,255,255,.04)}
.card svg{width:28px;height:28px;padding:6px;border-radius:6px;background:rgba(255,255,255,.06);fill:none;stroke:var(--accent,#5bbda5);stroke-width:1.600;stroke-linecap:round;stroke-linejoin:round;box-sizing:content-box}
.card-text{display:grid;gap:4px;min-width:0}.card-text strong{font-size:13px}.card-text span{color:var(--muted,#a7b2b9);line-height:1.45}
.card-message{font-style:normal;color:#e5c07b;line-height:1.4;overflow-wrap:anywhere}
.badge{grid-column:2;justify-self:start;padding:1px 8px;border:1px solid var(--border,#41464d);border-radius:10px;font-size:11px;color:var(--muted,#a7b2b9)}
.state-current .badge{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
.state-stale .badge,.state-unexported .badge{border-color:#e5c07b;color:#e5c07b}
.state-conflict .badge,.state-failed .badge{border-color:#e38269;color:#f0b3a3}.state-conflict,.state-failed{border-color:#e38269}
.notice{margin:8px 0;padding:8px 10px;max-width:760px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4;overflow-wrap:anywhere}.problem{border-color:#e38269;color:#f0b3a3}.ok{border-color:var(--accent,#5bbda5)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px;padding:0;list-style:none}.chips li{padding:2px 9px;border:1px solid var(--border,#41464d);border-radius:10px}
details{margin-top:12px;max-width:760px}summary{cursor:pointer;color:var(--muted,#a7b2b9)}
.files{margin:8px 0 0;padding-left:18px}.files li{margin-block:4px;overflow-wrap:anywhere}.files span{color:var(--muted,#a7b2b9)}code{font-size:11px}
@media (prefers-reduced-motion: reduce){.card{transition:none}}
</style>
