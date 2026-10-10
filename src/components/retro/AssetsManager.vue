<template>
  <div class="assets-manager">
    <div class="assets-toolbar">
      <button class="toolbar-btn charset-maker-btn" type="button" :disabled="!props.projectPath" @click="openCharacterEditor" title="Criar personagem a partir de uma folha de sprites">
        <span class="icon-image" aria-hidden="true"></span> Charset Maker
      </button>
      <button class="toolbar-btn" @click="showImport = true" title="Importar">
        <span class="icon-plus"></span> Importar
      </button>
      <button class="toolbar-btn" @click="refreshAssets" title="Atualizar">
        <span class="icon-arrows-rotate"></span>
      </button>
      <button class="toolbar-btn" type="button" :disabled="reportLoading || !props.projectPath" @click="inspectAssets" title="Ver origem, uso e duplicatas">Uso dos recursos</button>
      <button class="toolbar-btn" type="button" :disabled="!props.projectPath" @click="showRuntime = !showRuntime">Runtime</button>
      <button class="toolbar-btn" type="button" :disabled="!props.projectPath" @click="showHardwareReport = true">{{ t('hardwareReport.title') }}</button>
      <input v-model="searchQuery" type="text" placeholder="Buscar..." class="search-input" />
    </div>
    <RuntimeManager v-if="showRuntime && props.projectPath" :project-path="props.projectPath" @close="showRuntime = false" @installed="emit('refresh')" />
    <section v-if="assetReport || reportError" class="asset-usage-panel" aria-label="Uso dos recursos">
      <header><strong>Uso dos recursos</strong><button type="button" aria-label="Fechar relatório" @click="assetReport = null; reportError = ''">×</button></header>
      <p v-if="reportError" role="alert">{{ reportError }}</p>
      <template v-if="assetReport">
        <p>Referências encontradas em mapas, kits, personagens, recursos e código. Sem referência conhecida não significa que o arquivo pode ser apagado.</p>
        <p v-if="assetReport.dynamicSources.length || assetReport.skipped.length">Há scripts ou arquivos não analisados completamente. A limpeza automática está desabilitada.</p>
        <p v-if="assetReport.quarantineError" role="alert">Quarentena: {{ assetReport.quarantineError }}</p>
        <div class="asset-quarantine-controls">
          <button type="button" :disabled="!selectedDerivatives.length || assetActionBusy || reportLoading || assetReport.exportRecovery?.pending" @click="quarantineSelected">Mover {{ selectedDerivatives.length }} para quarentena…</button>
          <small>Selecione apenas derivados criados pela IDE. Até 20 arquivos por vez. A quarentena permite restaurá-los.</small>
        </div>
        <details v-if="assetReport.quarantines?.length">
          <summary>Quarentenas · {{ assetReport.quarantines.length }}</summary>
          <div v-for="record in assetReport.quarantines" :key="record.id">
            <small>{{ record.createdAt }} · {{ record.paths.length }} arquivos · {{ record.status === 'restored' ? 'Restaurada' : 'Disponível' }}</small>
            <button v-if="record.status === 'quarantined'" type="button" :disabled="assetActionBusy || reportLoading" @click="restoreQuarantine(record.id)">Restaurar…</button>
          </div>
        </details>
        <p v-if="assetReport.ledgerError"  role="alert">Registro de derivados: {{ assetReport.ledgerError }}</p>
        <p v-if="assetReport.originsError" role="alert">Registro de origens: {{ assetReport.originsError }}</p>
        <details v-if="assetReport.portability?.length" class="asset-portability">
          <summary>Caminhos que não funcionam em outra máquina · {{ assetReport.portability.length }}</summary>
          <p>Estes arquivos guardam um caminho absoluto. Dentro do projeto, basta abrir e salvar de novo; fora do projeto, traga o arquivo para dentro dele.</p>
          <ul><li v-for="(entry, index) in assetReport.portability" :key="index"><strong>{{ entry.file }}</strong> → {{ entry.value }} <small>{{ portabilityReason(entry.reason) }}</small></li></ul>
        </details>
        <p v-if="assetReport.exportRecoveryError" role="alert">Recuperação: {{ assetReport.exportRecoveryError }}</p>
        <div v-if="assetReport.exportRecovery?.pending">
          <p>Exportação pendente: {{ assetReport.exportRecovery.state }} · {{ assetReport.exportRecovery.outputs.length }} arquivos.</p>
          <button type="button" :disabled="reportLoading || recoveringExport || assetReport.exportRecovery.active" @click="recoverPendingExport">Restaurar exportação anterior…</button>
          <p v-if="assetReport.exportRecovery.active">O processo de exportação ainda está ativo.</p>
        </div>
        <p v-if="assetReport.missingOwnedAssets?.length">Derivados registrados não encontrados: {{ assetReport.missingOwnedAssets.join(', ') }}</p>
        <input v-model="reportFilter"  type="search" placeholder="Filtrar caminhos…" aria-label="Filtrar recursos do relatório" />
        <article v-for="item in reportAssets" :key="item.path">
          <label v-if="item.quarantineCandidate"><input v-model="selectedDerivatives" type="checkbox" :value="item.path" :disabled="assetActionBusy" /> Selecionar para quarentena</label>
          <strong>{{ item.path }}</strong>
          <small>{{ roleLabel(item) }} · {{ item.references.length === 1 ? '1 referência' : item.references.length ? item.references.length + ' referências' : 'Uso não verificado' }}</small>
          <small v-if="originLabel(item)">Origem: {{ originLabel(item) }}</small>
          <small>Limpeza: {{ disposalLabel(item) }}</small>
          <small v-if="item.ownership === 'verified'">Derivado criado pela IDE · conteúdo conferido</small>
          <small v-else-if="item.ownership === 'modified-or-unverified'">Derivado registrado com conteúdo alterado ou não conferido</small>
          <ul v-if="item.references.length"><li v-for="reference in item.references" :key="reference">{{ reference }}</li></ul>
          <p v-if="item.duplicates.length">Conteúdo igual: {{ item.duplicates.join(', ') }}<span v-if="item.duplicateCount > item.duplicates.length"> · mais {{ item.duplicateCount - item.duplicates.length }} arquivos</span></p>
        </article>
      </template>
    </section>
    <div class="assets-grid" @contextmenu.prevent="onBgContextMenu">
      <div v-if="isLoading" class="empty-state">Carregando...</div>
      <div v-else-if="!filteredAssets.length" class="empty-state">Nenhum asset</div>
      <div
        v-else
        v-for="asset in filteredAssets"
        :key="asset.id"
        class="asset-card"
        :class="{ selected: selectedAsset?.id === asset.id }"
        @click="selectedAsset = asset"
        @dblclick="asset.type === 'tilemap' ? emit('edit-tilemap', asset) : emit('edit', asset)"
        @contextmenu.stop="onAssetContextMenu(asset, $event)"
      >
        <div class="asset-preview">
          <img v-if="asset.preview" :src="asset.preview" :alt="asset.name" class="preview-img" />
          <div v-else class="preview-placeholder">
            <span class="icon-image"></span>
          </div>
        </div>
        <div class="asset-info">
          <div class="asset-name" :title="asset.name">{{ asset.name }}</div>
          <div class="asset-meta">{{ getTypeName(asset.type) }} · {{ formatFileSize(asset.size) }}</div>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <div v-if="showImport" class="modal-overlay" @click="showImport = false">
        <div class="modal-content" @click.stop>
          <div class="modal-header">
            <h2>Importar Assets</h2>
            <button class="close-btn" @click="showImport = false">×</button>
          </div>
          <div class="modal-body">
            <label>Tipo:</label>
            <select v-model="importType" class="form-select">
              <option v-for="t in ASSET_TYPES" :key="t" :value="t">{{ getTypeName(t) }}</option>
            </select>
            <div class="drop-zone" @dragover.prevent @drop.prevent="onDrop">
              Arraste arquivos ou
              <input v-if="!canUseNativeDialog" ref="fileInput" type="file" multiple style="display:none" @change="onFileSelect" />
              <button @click="onSelectFiles">Selecionar</button>
            </div>
          </div>
          <div class="modal-footer">
            <button @click="showImport = false">Cancelar</button>
            <button @click="doImport" :disabled="!filesToImport.length">Importar {{ filesToImport.length }}</button>
          </div>
        </div>
      </div>
    </Teleport>
    <ContextMenu
      v-if="ctx.visible"
      :show="ctx.visible"
      :x="ctx.x"
      :y="ctx.y"
      :items="ctxItems"
      @action="onCtxAction"
      @close="ctx.visible = false"
    />
    <CharsetMaker v-if="showCharsetMaker" :project-path="props.projectPath" @close="closeCharsetMaker" @exported="onCharsetExported" />
    <HardwareReport v-if="showHardwareReport && props.projectPath" :project-path="props.projectPath" @close="showHardwareReport = false" />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import ContextMenu from '../ContextMenu.vue'
import CharsetMaker from './CharsetMaker.vue'
import RuntimeManager from './RuntimeManager.vue'
import HardwareReport from './HardwareReport.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  projectPath: { type: String, default: '' },
  assets: { type: Array, default: () => [] },
  selectedAsset: { type: Object, default: null },
  isLoading: { type: Boolean, default: false },
  ASSET_TYPES: { type: Array, default: () => [] },
  getTypeName: { type: Function, default: (t) => t },
  formatFileSize: { type: Function, default: (b) => b + ' B' },
  imageEditorPath: { type: String, default: '' },
  mapEditorPath: { type: String, default: '' }
})

const emit = defineEmits(['update:selectedAsset', 'refresh', 'import', 'importPaths', 'remove', 'edit', 'edit-tilemap', 'editExternal'])

const searchQuery = ref('')
const showRuntime = ref(false)
const showHardwareReport = ref(false)
const assetReport = ref(null)
const reportError = ref('')
const reportLoading = ref(false)
const recoveringExport = ref(false)
const selectedDerivatives = ref([])
const assetActionBusy = ref(false)
const reportFilter = ref('')
let reportRequest = 0
const reportAssets = computed(() => (assetReport.value?.assets || []).filter(item => item.path.toLocaleLowerCase().includes(reportFilter.value.toLocaleLowerCase())))
async function inspectAssets() {
  const request = ++reportRequest
  reportLoading.value = true
  reportError.value = ''
  try {
    const report = await window.retroStudio?.retro?.inspectAssets?.()
    if (request !== reportRequest) return
    if (!report?.success) throw new Error(report?.error || 'Relatório de recursos indisponível.')
    const normalized = path => String(path || '').replaceAll('\\', '/').replace(/\/$/, '')
    if (normalized(report.projectPath) !== normalized(props.projectPath)) throw new Error('O relatório pertence a outro projeto. Atualize o workspace.')
    assetReport.value = report
    selectedDerivatives.value = []
  } catch (error) {
    if (request === reportRequest) reportError.value = error.message
  } finally { if (request === reportRequest) reportLoading.value = false }
}
async function performAssetAction(action) {
  if (assetActionBusy.value) return
  const projectPath = props.projectPath
  assetActionBusy.value = true
  reportError.value = ''
  try {
    const result = await action(projectPath)
    if (props.projectPath !== projectPath || result?.cancelled) return
    if (!result?.success) throw new Error(result?.error || 'Operação de recursos indisponível.')
    emit('refresh')
    await inspectAssets()
  } catch (error) { if (props.projectPath === projectPath) reportError.value = error.message }
  finally { assetActionBusy.value = false }
}
// #42: papel, origem e destino de cada arquivo na limpeza, em palavras do usuário.
const PRODUCERS = { 'raster-import': 'importação de mapa em imagem', 'character-export': 'exportação de personagem', 'world-map-export': 'exportação dos mapas do mundo', 'map-export': 'exportação de mapa' }
function roleLabel(item) {
  return { original: 'Original', 'charset-source': 'Folha de personagem (original)', 'charset-output': 'Saída de personagem',
    derived: 'Derivado · dono: ' + (PRODUCERS[item.owner] || item.owner), 'generated-unknown': 'Em pasta de derivados, sem dono registrado' }[item.role] || 'Arquivo'
}
function originLabel(item) {
  const origin = item.origin
  if (!origin) return ''
  if (origin.kind === 'import') return 'importado de “' + origin.sourceName + '” em ' + String(origin.importedAt).slice(0, 10) + (origin.verified ? '' : ' (alterado depois da importação)') + (origin.project ? ' · folha usada por ' + origin.project : '')
  if (origin.kind === 'charset-sheet') return 'folha usada por ' + origin.project
  if (origin.kind === 'charset') return 'gerado por ' + origin.project
  return 'gerado pela ' + (PRODUCERS[origin.producer] || origin.producer)
}
function disposalLabel(item) {
  return { never: 'nunca oferecido (original ou personagem)', 'in-use': 'em uso', 'unknown-owner': item.owner ? 'refeito pela exportação que o criou; não entra na quarentena' : 'sem dono conferido; não pode ser classificado',
    'manual-review': 'sem uso conhecido, mas há scripts ou arquivos não analisados: só com revisão manual', candidate: 'sem uso conhecido; pode ir para a quarentena' }[item.disposal] || 'não classificado'
}
function portabilityReason(reason) {
  return { 'absolute-inside-project': 'dentro do projeto: salve de novo', 'outside-project': 'fora do projeto', 'absolute-path': 'caminho absoluto' }[reason] || ''
}
function quarantineSelected() {
  const paths = [...selectedDerivatives.value]
  return performAssetAction(projectPath => window.retroStudio?.retro?.quarantineAssets?.({ projectPath, paths }))
}
function restoreQuarantine(quarantineId) {
  return performAssetAction(projectPath => window.retroStudio?.retro?.restoreAssets?.({ projectPath, quarantineId }))
}
async function recoverPendingExport() {
  const project = props.projectPath
  const transactionId = assetReport.value?.exportRecovery?.transactionId
  if (!transactionId || recoveringExport.value) return
  recoveringExport.value = true
  reportError.value = ''
  try {
    const result = await window.retroStudio?.retro?.recoverExport?.(transactionId)
    if (props.projectPath !== project || result?.cancelled) return
    if (!result?.success) throw new Error(result?.error || 'Recuperação indisponível.')
    emit('refresh')
    await inspectAssets()
  } catch (error) { if (props.projectPath === project) reportError.value = error.message }
  finally { recoveringExport.value = false }
}
watch(() => props.projectPath, () => { reportRequest++; assetReport.value = null; selectedDerivatives.value = []; reportError.value = ''; reportLoading.value = false })

const showCharsetMaker = ref(false)
function openCharacterEditor() {
  const request = new CustomEvent('retroStudio:open-characters', { cancelable: true, detail: { projectPath: props.projectPath } })
  if (window.dispatchEvent(request)) showCharsetMaker.value = true
}
const charsetExportPendingRefresh = ref(false)

function onCharsetExported() {
  charsetExportPendingRefresh.value = true
}

function closeCharsetMaker() {
  showCharsetMaker.value = false
  if (charsetExportPendingRefresh.value) {
    charsetExportPendingRefresh.value = false
    emit('refresh')
  }
}
const showImport = ref(false)
const importType = ref('sprite')
const filesToImport = ref([])
const fileInput = ref(null)
const ctx = ref({ visible: false, x: 0, y: 0, asset: null })

const filteredAssets = computed(() => {
  const q = searchQuery.value?.toLowerCase() || ''
  if (!q) return props.assets
  return props.assets.filter((a) => a.name?.toLowerCase().includes(q) || a.type?.toLowerCase().includes(q))
})

function getEditorName(path) {
  if (!path) return ''
  const name = path.split(/[/\\]/).pop() || ''
  return name.replace(/\.[^.]+$/, '') || name
}

const ctxItems = computed(() => {
  const a = ctx.value.asset
  if (a) {
    const items = [
      { id: 'edit', action: 'edit', label: 'Editar', icon: 'icon-pen-to-square' }
    ]
    const isImage = ['sprite', 'tile', 'background'].includes(a.type)
    const isMap = a.type === 'tilemap'
    if (isMap) {
      items.push({ id: 'edit-tilemap', action: 'edit-tilemap', label: 'Editar no Editor de Mapas', icon: 'icon-grid-2' })
    }
    if (isImage && props.imageEditorPath) {
      items.push({ id: 'edit-external-image', action: 'edit-external-image', label: `Editar com ${getEditorName(props.imageEditorPath)}`, icon: 'icon-image' })
    } else if (isImage) {
      items.push({ id: 'config-image', action: 'config-image', label: 'Configurar Editor de Imagens...', icon: 'icon-gear', disabled: true })
    }
    if (isMap && props.mapEditorPath) {
      items.push({ id: 'edit-external-map', action: 'edit-external-map', label: `Editar com ${getEditorName(props.mapEditorPath)}`, icon: 'icon-grid-2' })
    } else if (isMap) {
      items.push({ id: 'config-map', action: 'config-map', label: 'Configurar Editor de Mapas...', icon: 'icon-gear', disabled: true })
    }
    items.push({ id: 'remove', action: 'remove', label: 'Remover', icon: 'icon-trash', danger: true })
    return items
  }
  return [
    { id: 'import', action: 'import', label: 'Importar', icon: 'icon-plus' },
    { id: 'refresh', action: 'refresh', label: 'Atualizar', icon: 'icon-arrows-rotate' }
  ]
})

const selectedAsset = computed({
  get: () => props.selectedAsset,
  set: (v) => emit('update:selectedAsset', v)
})

function onBgContextMenu(e) {
  ctx.value = { visible: true, x: e.clientX, y: e.clientY, asset: null }
}
function onAssetContextMenu(asset, e) {
  ctx.value = { visible: true, x: e.clientX, y: e.clientY, asset }
}
async function onCtxAction(action) {
  const a = ctx.value.asset
  ctx.value.visible = false
  if (action === 'import') showImport.value = true
  else if (action === 'refresh') emit('refresh')
  else if (action === 'remove' && a) emit('remove', a.id)
  else if (action === 'edit' && a) emit('edit', a)
  else if (action === 'edit-tilemap' && a) emit('edit-tilemap', a)
  else if ((action === 'edit-external-image' || action === 'edit-external-map') && a?.path && props.projectPath) {
    const fullPath = `${props.projectPath}/${a.path}`.replace(/\/+/g, '/')
    const editorPath = action === 'edit-external-image' ? props.imageEditorPath : props.mapEditorPath
    if (editorPath) await window.retroStudio?.retro?.openExternalEditor?.(editorPath, fullPath)
  }
}

const canUseNativeDialog = !!window.retroStudio?.retro?.selectMultipleFiles

function refreshAssets() {
  emit('refresh')
}
function onDrop(e) {
  filesToImport.value = [...(e.dataTransfer?.files || [])]
}
function onFileSelect(e) {
  filesToImport.value = [...(e.target?.files || [])]
}
async function onSelectFiles() {
  if (canUseNativeDialog) {
    const extByType = {
      sprite: ['png', 'jpg', 'jpeg', 'gif', 'bmp'],
      tile: ['png', 'jpg', 'jpeg', 'gif', 'bmp'],
      tilemap: ['tmx'],
      palette: ['pal', 'act'],
      sound: ['wav', 'mp3', 'ogg', 'vgm', 'vgz'],
      background: ['png', 'jpg', 'jpeg', 'gif', 'bmp']
    }
    const exts = extByType[importType.value] || ['*']
    const result = await window.retroStudio.retro.selectMultipleFiles({
      context: 'asset-import',
      title: 'Selecionar arquivos para importar',
      filters: exts[0] === '*' ? [{ name: 'Todos', extensions: ['*'] }] : [{ name: importType.value, extensions: exts }, { name: 'Todos', extensions: ['*'] }]
    })
    if (result?.success && result.paths?.length) {
      emit('importPaths', result.paths, importType.value)
      showImport.value = false
    }
  } else {
    fileInput.value?.click()
  }
}
async function doImport() {
  if (!filesToImport.value.length) return
  emit('import', filesToImport.value, importType.value)
  filesToImport.value = []
  showImport.value = false
}
</script>

<style scoped>
.asset-usage-panel { flex-shrink:0; max-height:45%; overflow:auto; margin:8px; padding:10px; color:var(--text); background:var(--panel); border:1px solid var(--border); border-radius:4px; font-size:11px; }
.asset-usage-panel header { display:flex; align-items:center; justify-content:space-between; }
.asset-usage-panel header button { background:transparent; color:inherit; border:0; cursor:pointer; }
.asset-usage-panel input { width:100%; box-sizing:border-box; color:var(--text); background:var(--bg); border:1px solid var(--border); padding:6px; }
.asset-usage-panel article { padding:8px 0; border-bottom:1px solid var(--border); overflow-wrap:anywhere; }
.asset-usage-panel input[type="checkbox"] { width:auto; margin:0; padding:0; }
.asset-usage-panel article label { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
.asset-usage-panel article > strong { display:block; }
.asset-usage-panel .asset-portability { margin:8px 0; }
.asset-usage-panel article small { display:block; color:var(--muted); margin:4px 0; }
.asset-usage-panel ul { padding-left:18px; }
.assets-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--panel);
}
.assets-toolbar {
  display: flex;
  min-width: 0;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
  align-items: center;
  overflow-x: auto;
}
.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  flex: 0 0 auto;
}
.toolbar-btn:disabled { opacity:.45; cursor:not-allowed; }
.charset-maker-btn { white-space:nowrap; }
.toolbar-btn:hover {
  opacity: 0.9;
}
.toolbar-btn-accent {
  background: var(--accent);
  font-weight: 600;
}
.search-input {
  flex: 1;
  min-width: 64px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
}
.assets-grid {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  align-content: start;
}
.asset-card {
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s;
}
.asset-card:hover,
.asset-card.selected {
  border-color: var(--accent);
}
.asset-preview {
  aspect-ratio: 1;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.preview-placeholder {
  color: var(--muted);
  font-size: 24px;
}
.asset-info {
  padding: 4px 6px;
  font-size: 11px;
}
.asset-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-meta {
  color: var(--muted);
  font-size: 10px;
}
.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 24px;
  color: var(--muted);
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: var(--panel);
  border-radius: 8px;
  min-width: 320px;
  max-width: 90vw;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.close-btn {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 18px;
}
.modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.drop-zone {
  border: 2px dashed var(--border);
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  color: var(--muted);
}
.drop-zone button {
  margin-left: 8px;
  padding: 4px 12px;
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.modal-footer button {
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
}
.modal-footer button:last-child {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.form-select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
}
</style>
