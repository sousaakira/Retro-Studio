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
import GameStartEditor from './GameStartEditor.vue'
const props = defineProps({ projectPath: { type: String, default: '' }, active: Boolean, retro: Boolean })
const emit = defineEmits(['installed', 'open-characters'])
const EDITORS = { start: GameStartEditor, world: WorldGraphEditor, camera: CameraEditor, inputs: InputActionsEditor, movement: MovementLab, hud: HudEditor, palettes: PaletteEditor, audio: AudioEditor, cutscenes: CutsceneAdapterPanel, progress: ProgressEditor, debug: DebugPanel, toolchain: ToolchainPanel, overview: ExportOverviewPanel }
// row: linha correspondente em "Estado das exportações" (quando o sistema gera arquivos para o build).
const GROUPS = [
  { title: 'Comece por aqui', text: 'O mínimo para o jogo rodar: quem joga e onde começa.', systems: [
    { id: 'start', row: 'game', title: 'Jogador e início', text: 'Quem é o jogador e onde o jogo começa. A IDE gera o código para você jogar sem programar.', icon: 'M12 4a2.400 2.400 0 1 1 0 4.800A2.400 2.400 0 0 1 12 4zM12 9v6M8 12l4-2 4 2M12 15l-3 5M12 15l3 5M4 20h16' },
    { id: 'world', row: 'world', title: 'Salas e conexões', text: 'As salas do jogo, as passagens entre elas e onde o jogador começa.', icon: 'M4 5h7v6H4zM13 13h7v6h-7zM11 8h3v5M7.5 11v5H13' }
  ] },
  { title: 'Jogador', text: 'Como o personagem responde ao controle e como a tela o acompanha.', systems: [
    { id: 'inputs', title: 'Controles', text: 'Quais botões do controle fazem cada ação do jogo.', icon: 'M7 8h10a4 4 0 0 1 4 4v1.500a3.500 3.500 0 0 1-6.300 2.100L14 15h-4l-.700.600A3.500 3.500 0 0 1 3 13.500V12a4 4 0 0 1 4-4zM7.500 10.800v3M6 12.300h3M16.500 12.300h.010' },
    { id: 'movement', title: 'Física e sala de testes', text: 'Velocidade, pulo e gravidade do personagem, com uma sala para experimentar.', icon: 'M4 19h16M6 19c1-9 5-13 12-13M15 6h3v3' },
    { id: 'camera', row: 'camera', title: 'Câmera', text: 'Como a câmera acompanha o jogador: velocidade, zona de tolerância e limites por sala.', icon: 'M4 8h11v9H4zM15 11l5-3v9l-5-3M7 8l1.500-2.500h4L14 8' }
  ] },
  { title: 'Imagem e som', text: 'O que aparece e toca além do mapa e dos personagens.', systems: [
    { id: 'hud', row: 'hud', title: 'HUD e textos', text: 'Vida, pontos, menus e caixas de diálogo que o jogador vê na tela.', icon: 'M3.500 5h17v14h-17zM6 8h6M6 11h3M14 15.500h4M6 15.500h4' },
    { id: 'palettes', row: 'palettes', title: 'Paletas e composição', text: 'As quatro paletas de cores, ciclos de cor e fades.', icon: 'M12 4a8 8 0 1 0 0 16c1.500 0 2-1 1.500-2.200-.500-1.300.300-2.300 1.700-2.300H17a3 3 0 0 0 3-3c0-4.700-3.600-8.500-8-8.500zM8 11h.010M11 8h.010M15 9h.010' },
    { id: 'audio', row: 'audio', title: 'Áudio: músicas e efeitos', text: 'As músicas e os efeitos sonoros do jogo e onde cada um toca.', icon: 'M9 17V6l10-2v11M9 17a2.500 2.500 0 1 1-2.500-2.500M19 15a2.500 2.500 0 1 1-2.500-2.500' }
  ] },
  { title: 'História e progresso', text: 'Cenas programadas e o que o jogo lembra.', systems: [
    { id: 'cutscenes', row: 'cutscene-adapter', title: 'Cutscenes: gatilhos e flags', text: 'O que dispara cada cena e quais marcas de progresso ela usa.', icon: 'M4 6h16v12H4zM4 9.500h16M8 6l-1.500 3.500M12.500 6 11 9.500M17 6l-1.500 3.500M10.500 12.500v3l2.800-1.500z' },
    { id: 'progress', row: 'progress', title: 'Progresso e save', text: 'O que o jogo guarda: itens, portas abertas, fase atual e o save.', icon: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6' }
  ] },
  { title: 'Projeto', text: 'Ferramentas de teste e a base técnica.', systems: [
    { id: 'debug', row: 'debug', title: 'Diagnóstico em jogo', text: 'Informações de teste mostradas na tela durante o jogo (colisões, FPS, memória).', icon: 'M9 9h6v7a3 3 0 0 1-6 0zM10 9a2 2 0 0 1 4 0M5 12h4M15 12h4M6 18l3-2M18 18l-3-2M6.500 7 9 9.500M17.500 7 15 9.500' },
    { id: 'toolchain', title: 'Base técnica e ferramentas', text: 'Versão do SGDK, compilador e ferramentas que o projeto exige.', icon: 'M14.500 6a4 4 0 0 0-5 5L4 16.500 7.500 20l5.500-5.500a4 4 0 0 0 5-5L15.500 12 12 8.500z' }
  ] }
]
const STATES = { current: 'Exportado', stale: 'Desatualizado', unexported: 'Não exportado', conflict: 'Alterado fora da IDE', failed: 'Com erro', absent: 'Não usado' }
const FILE_LABELS = { new: 'Novo', current: 'Atual', update: 'Atualização', modified: 'Personalizado', unmanaged: 'Não gerenciado' }
const overview = ref(null), status = ref(null), loading = ref(false), busy = ref(false), error = ref(''), moduleError = ref(''), opened = ref(''), heading = ref(null)
let request = 0, disposed = false
const rows = computed(() => Object.fromEntries((overview.value?.rows || []).map(row => [row.id, row])))
const blocking = computed(() => new Set(overview.value?.blocksBuild || []))
const attention = computed(() => (overview.value?.rows || []).filter(row => !['current', 'absent'].includes(row.state)).length)
const SYSTEMS = GROUPS.flatMap(group => group.systems)
// O que pede atenção, com o cartão que resolve (linhas sem cartão, como as cenas, abrem o painel de exportações).
const pending = computed(() => (overview.value?.rows || []).filter(row => !['current', 'absent'].includes(row.state)).map(row => ({ ...row, system: SYSTEMS.find(system => system.row === row.id)?.id || 'overview', blocks: blocking.value.has(row.id) })))
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
// Só o editor "Jogador e início" pede para abrir outros lugares.
const startListeners = { 'open-world': () => { opened.value = 'world' }, 'open-characters': () => { opened.value = ''; emit('open-characters') } }
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
      <div v-if="retro" class="layout">
        <div class="systems">
          <section v-for="group in GROUPS" :key="group.title" :aria-label="group.title">
            <h3>{{ group.title }}<small>{{ group.text }}</small></h3>
            <ul class="rows">
              <li v-for="system in group.systems" :key="system.id">
                <button type="button" class="card" :class="rows[system.row] ? 'state-' + rows[system.row].state : ''" :data-system="system.id" @click="opened = system.id">
                  <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path :d="system.icon" /></svg>
                  <span class="card-text"><strong>{{ system.title }}</strong><span>{{ system.text }}</span></span>
                  <span v-if="rows[system.row]" class="badge">{{ STATES[rows[system.row].state] || rows[system.row].state }}</span>
                  <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                </button>
              </li>
            </ul>
          </section>
        </div>
        <aside class="side">
          <section class="panel" aria-labelledby="game-pending">
            <h3 id="game-pending">O que pede atenção</h3>
            <p v-if="loading && !overview" role="status" class="quiet">Conferindo o projeto…</p>
            <p v-else-if="!pending.length" class="quiet ok-text">Nada pendente: tudo o que o jogo usa está exportado.</p>
            <ul v-else class="pending">
              <li v-for="row in pending" :key="row.id" :class="{ blocks: row.blocks }">
                <strong>{{ row.title }}</strong>
                <span class="tag">{{ STATES[row.state] || row.state }}{{ row.blocks ? ' · impede o build' : '' }}</span>
                <p v-if="row.message">{{ row.message }}</p>
                <button type="button" @click="opened = row.system">Abrir</button>
              </li>
            </ul>
          </section>
          <section class="panel" aria-labelledby="game-modules">
            <h3 id="game-modules">Módulos de apoio</h3>
            <p class="quiet">Código pronto que a IDE instala no projeto (colisão, câmera, HUD, áudio…) para o jogo usar. Instalar ou atualizar preserva o código do jogo e guarda cópia do que for alterado.</p>
            <p v-if="moduleError" role="alert" class="notice problem">{{ moduleError }}</p>
            <p v-else-if="loading && !status" role="status" class="quiet">Verificando módulos…</p>
            <template v-else-if="status">
              <p class="notice" :class="{ ok: status.upToDate }">{{ status.upToDate ? status.modules.length + ' módulos instalados, na versão atual.' : status.installed ? 'Há atualização de módulos: revise os arquivos antes de aplicar.' : 'Os módulos de apoio ainda não foram instalados neste projeto.' }}</p>
              <p v-if="status.conflicts.length" class="quiet">Há {{ status.conflicts.length }} arquivo(s) personalizado(s). A atualização pede confirmação e mantém backups.</p>
              <p v-if="status.retainedFiles.length" class="quiet">Arquivos de versões anteriores preservados: {{ status.retainedFiles.join(', ') }}</p>
              <button v-if="!status.upToDate" type="button" class="primary" :disabled="busy" @click="install">{{ busy ? 'Instalando…' : status.installed ? 'Revisar atualização…' : 'Revisar instalação…' }}</button>
              <details><summary>Módulos ({{ status.modules.length }})</summary>
                <ul class="chips"><li v-for="module in status.modules" :key="module.id" :title="module.dependencies.length ? 'Depende de ' + module.dependencies.join(', ') : ''">{{ module.id }} <small>v{{ module.version }}</small></li></ul>
              </details>
              <details v-if="status.files.length"><summary>Arquivos dos módulos ({{ status.files.length }})</summary>
                <ul class="files"><li v-for="file in status.files" :key="file.path"><code>{{ file.path }}</code> <span>{{ FILE_LABELS[file.status] || file.status }}</span></li></ul>
              </details>
            </template>
          </section>
        </aside>
      </div>
    </div>
    <component :is="EDITORS[opened]" v-if="opened && projectPath" :key="opened" :project-path="projectPath" @close="close" v-on="opened === 'start' ? startListeners : {}" />
  </section>
</template>
<style scoped>
.game{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 24px;border-bottom:1px solid var(--border,#41464d);flex-shrink:0}
h2{margin:3px 0;font-size:19px}h2:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:3px}
small,.quiet{color:var(--muted,#a7b2b9)}
.headline{margin:0 0 0 auto;padding:4px 10px;border:1px solid var(--accent,#5bbda5);border-radius:3px}.headline.warns{border-color:#e5c07b;color:#e5c07b}.headline.blocks{border-color:#e38269;color:#f0b3a3}
.actions{display:flex;flex-wrap:wrap;gap:6px}
.game-body{flex:1;min-height:0;overflow:auto;padding:0 24px 28px}
/* Sistemas à esquerda (uma lista por assunto), pendências e módulos à direita. */
.layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:28px;align-items:start;max-width:1240px}
.systems h3{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin:24px 0 8px;font-size:13px;font-weight:600}
.systems h3 small{font-size:12px;font-weight:400}
.rows{list-style:none;margin:0;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;overflow:hidden;background:var(--bg,#171c21)}
.rows li+li{border-top:1px solid var(--border,#41464d)}
button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px 10px;cursor:pointer}
button:disabled{opacity:.55;cursor:default}button:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:-2px}.primary{border-color:var(--accent,#5bbda5)}
.card{display:grid;grid-template-columns:36px minmax(0,1fr) auto 16px;align-items:center;gap:14px;width:100%;min-height:60px;padding:10px 14px;border:0;border-radius:0;background:transparent;text-align:left;transition:background-color .12s ease}
.card:hover{background:rgba(255,255,255,.05)}
.glyph{width:22px;height:22px;padding:7px;border-radius:6px;background:rgba(255,255,255,.06);fill:none;stroke:var(--accent,#5bbda5);stroke-width:1.600;stroke-linecap:round;stroke-linejoin:round;box-sizing:content-box}
.badge{grid-column:3}.chevron{grid-column:4;width:16px;height:16px;fill:none;stroke:var(--muted,#a7b2b9);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.card-text{display:grid;gap:2px;min-width:0}.card-text strong{font-size:13px;font-weight:600}.card-text span{color:var(--muted,#a7b2b9);line-height:1.4}
.badge,.tag{padding:1px 8px;border:1px solid var(--border,#41464d);border-radius:10px;font-size:11px;color:var(--muted,#a7b2b9);white-space:nowrap}
.state-absent .badge{border-color:transparent;padding-inline:0}
.state-current .badge{border-color:var(--accent,#5bbda5);color:var(--accent,#5bbda5)}
.state-stale .badge,.state-unexported .badge{border-color:#e5c07b;color:#e5c07b}
.state-conflict .badge,.state-failed .badge{border-color:#e38269;color:#f0b3a3}
.side{display:grid;gap:16px;position:sticky;top:0;padding-top:24px}
.panel{padding:14px;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--bg,#171c21)}
.panel h3{margin:0 0 8px;font-size:13px;font-weight:600}.panel p{margin:0 0 8px;line-height:1.45}.panel>:last-child{margin-bottom:0}
.ok-text{color:var(--accent,#5bbda5)}
.pending{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.pending li{display:grid;gap:6px;justify-items:start;padding:10px;border:1px solid #e5c07b;border-radius:4px}
.pending li.blocks{border-color:#e38269}.pending .tag{border-color:currentColor;color:#e5c07b}.pending .blocks .tag{color:#f0b3a3}
.pending p{margin:0;color:var(--muted,#a7b2b9);overflow-wrap:anywhere}.pending button{padding:4px 12px}
.notice{margin:8px 0;padding:8px 10px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4;overflow-wrap:anywhere}.problem{border-color:#e38269;color:#f0b3a3}.ok{border-color:var(--accent,#5bbda5)}
details{margin-top:8px}summary{cursor:pointer;color:var(--muted,#a7b2b9)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;padding:0;list-style:none}.chips li{padding:2px 9px;border:1px solid var(--border,#41464d);border-radius:10px}
.files{margin:8px 0 0;padding-left:18px}.files li{margin-block:4px;overflow-wrap:anywhere}.files span{color:var(--muted,#a7b2b9)}code{font-size:11px}
@media (max-width:1100px){.layout{grid-template-columns:minmax(0,1fr)}.side{position:static;padding-top:0}}
@media (prefers-reduced-motion: reduce){.card{transition:none}}
</style>
