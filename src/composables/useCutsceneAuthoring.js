import { ref, computed, watch } from 'vue'
import {
    compileCutscene, defaultCutsceneConfig, newCutscene, newStep, parseJson,
    stepBranches, validateConfig, STEP_TYPES, movePath, MAX_ROUTE_STEPS
} from '../../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs'

const CONFIG_PATH = 'cutscenes/cutscene-config.json'
const clone = value => JSON.parse(JSON.stringify(value))
const toast = () => window.retroStudioToast

/** Splits "steps.2.options.0.steps.1" into the parent list path and index. */
export function splitStepPath(path) {
    const parts = String(path).split('.')
    return { list: parts.slice(0, -1).join('.'), index: Number(parts[parts.length - 1]) }
}

function getAt(root, path) {
    return String(path).split('.').reduce((node, key) => (node == null ? undefined : node[key]), root)
}

/**
 * Cutscene authoring state for the map editor. `host` exposes what the map
 * editor already owns (objects, current map, undo, project path).
 */
export function useCutsceneAuthoring(host) {
    const open = ref(false)
    const status = ref(null)
    const busy = ref(false)
    const exportFailure = ref(false)
    const lastPublication = ref(null)
    const config = ref(defaultCutsceneConfig())
    const configExists = ref(false)
    let configLoaded = false
    const configErrors = ref([])
    const files = ref([])
    const scene = ref(null)
    const scenePath = ref('')
    const savedSnapshot = ref('')
    const selectedPath = ref('')
    const projectErrors = ref([])
    const picking = ref(null)
    const showOverlay = ref(true)
    const previewing = ref(false)
    const portraitPreviews = ref({})
    const sceneSummaries = ref({})

    const projectRoot = () => String(host.projectPath || '').replace(/[/\\]+$/, '')
    const abs = rel => `${projectRoot()}/${rel}`.replace(/\/+/g, '/')
    const relToProject = full => {
        const root = projectRoot().replace(/\\/g, '/')
        const normalized = String(full || '').replace(/\\/g, '/')
        return root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized
    }

    const dirty = computed(() => !!scene.value && JSON.stringify(scene.value) !== savedSnapshot.value)
    const compiled = computed(() => scene.value ? compileCutscene(scene.value, config.value) : { ops: [], errors: [] })
    const selectedStep = computed(() => selectedPath.value && scene.value ? getAt(scene.value, selectedPath.value) || null : null)
    const actors = computed(() => config.value.actors || [])
    const mapRelativePath = computed(() => relToProject(host.currentMapPath?.value || ''))

    async function refreshStatus() {
        try { status.value = await window.retroStudio?.retro?.cutsceneRuntimeStatus?.() || null } catch (error) { status.value = { available: false, error: error.message } }
    }

    async function installRuntime() {
        if (busy.value) return false
        busy.value = true
        try {
            const result = await window.retroStudio.retro.installCutsceneRuntime()
            const changed = result.created.length + result.updated.length
            toast()?.success?.(changed ? `Runtime de cutscenes instalado (${changed} arquivo(s)).` : 'Runtime de cutscenes já está atualizado.')
            if (result.backups.length) toast()?.info?.(`Cópias de segurança: ${result.backups.join(', ')}`)
            await refreshStatus()
            await loadConfig()
        } catch (error) {
            toast()?.error?.(`Falha ao instalar runtime: ${error.message}`)
        } finally { busy.value = false }
    }

    async function loadConfig() {
        const text = await window.retroStudio?.readTextFileOptional?.(abs(CONFIG_PATH))
        configLoaded = true
        configExists.value = text != null
        if (text == null) { config.value = defaultCutsceneConfig(); configErrors.value = []; return }
        const parsed = parseJson(text, CONFIG_PATH)
        if (parsed.error) { configErrors.value = [parsed.error]; return }
        config.value = { ...defaultCutsceneConfig(), ...parsed.value }
        configErrors.value = validateConfig(config.value)
        loadPortraitPreviews()
    }

    async function exportSavedScenes(phase) {
        if (!window.retroStudio?.retro?.exportCutscenes) throw Error('Exportação transacional de cenas indisponível. Reabra o editor na IDE atualizada.')
        const result = await window.retroStudio.retro.exportCutscenes({ projectPath: projectRoot(), phase })
        projectErrors.value = result?.errors || []
        if (phase === 'publish' && result?.success === true) lastPublication.value = result
        return result?.success === true
    }

    async function prepareAuthoringSave() {
        // Ownership adoption is best-effort. Publication conflicts must not
        // prevent saving authored JSON; publish reports the conflict afterwards.
        try { await exportSavedScenes('prepare') } catch { /* publish retains the diagnostic */ }
    }

    async function saveConfig(next) {
        if (busy.value) return false
        const snapshot = clone(next)
        const errors = validateConfig(snapshot)
        configErrors.value = errors
        if (errors.length) { toast()?.error?.(errors[0]); return false }
        busy.value = true
        try {
            await prepareAuthoringSave()
            await window.retroStudio.writeTextFile(abs(CONFIG_PATH), `${JSON.stringify(snapshot, null, 2)}\n`)
            config.value = snapshot
            configExists.value = true
            configLoaded = true
            loadPortraitPreviews()
            const ok = await compileAllContent()
            exportFailure.value = !ok
            return ok
        } catch (error) {
            exportFailure.value = true
            toast()?.error?.(`Falha ao salvar configuração: ${error.message}`)
            return false
        } finally { busy.value = false }
    }

    async function loadPortraitPreviews() {
        const previews = {}
        for (const portrait of config.value.portraits || []) {
            if (!portrait.image) continue
            try {
                const result = await window.retroStudio?.retro?.getAssetPreview?.(projectRoot(), portrait.image)
                if (result?.success && result.preview) previews[portrait.id] = result.preview
            } catch { /* preview is optional */ }
        }
        portraitPreviews.value = previews
    }

    async function loadList({ quiet = false } = {}) {
        try {
            const result = await window.retroStudio?.retro?.listCutscenes?.()
            files.value = result?.files || []
        } catch (error) { files.value = []; if (!quiet) toast()?.error?.(error.message) }
        const summaries = {}
        for (const path of files.value) {
            const text = await window.retroStudio?.readTextFileOptional?.(abs(path))
            const parsed = text == null ? { error: 'ausente' } : parseJson(text, path)
            summaries[path] = parsed.error ? { id: '', title: path, error: parsed.error } : { id: parsed.value.id, title: parsed.value.title || parsed.value.id, map: parsed.value.map || '' }
        }
        sceneSummaries.value = summaries
    }

    async function openEditor() {
        if (busy.value) return false
        open.value = true
        busy.value = true
        try {
            await refreshStatus()
            if (!configLoaded) await loadConfig()
            // Reopening a mounted editor must retain its vocabulary and scene drafts.
            await loadList()
            if (!scene.value && files.value.length) {
                const forMap = files.value.find(path => sceneSummaries.value[path]?.map === mapRelativePath.value)
                await openSceneContent(forMap || files.value[0])
            }
            return true
        } catch (error) {
            toast()?.error?.(`Falha ao abrir cenas: ${error.message}`)
            return false
        } finally { busy.value = false }
    }

    function confirmDiscard() {
        return !dirty.value || window.confirm('Descartar alterações não salvas desta cena?')
    }

    async function runExclusive(operation) {
        if (busy.value) return false
        busy.value = true
        try { return await operation() }
        catch (error) { toast()?.error?.(error.message); return false }
        finally { busy.value = false }
    }
    const openScene = path => runExclusive(() => openSceneContent(path))
    const createScene = (id, title) => runExclusive(() => createSceneContent(id, title))
    async function publishCompiledScenes() {
        try {
            const ok = await compileAllContent()
            exportFailure.value = !ok
            return ok
        } catch (error) { exportFailure.value = true; throw error }
    }
    const compileAll = () => runExclusive(publishCompiledScenes)
    const recompileAll = () => runExclusive(async () => { await loadList(); return await publishCompiledScenes() })

    async function openSceneContent(path) {
        if (path === scenePath.value) return true
        if (!confirmDiscard()) return false
        const text = await window.retroStudio.readTextFile(abs(path))
        const parsed = parseJson(text, path)
        if (parsed.error) { toast()?.error?.(parsed.error); return false }
        const value = parsed.value
        value.steps = Array.isArray(value.steps) ? value.steps : []
        scene.value = value
        scenePath.value = path
        savedSnapshot.value = JSON.stringify(value)
        selectedPath.value = value.steps.length ? 'steps.0' : ''
        return true
    }

    async function createSceneContent(id, title) {
        id = String(id || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
        if (!/^[a-z][a-z0-9_]*$/.test(id)) { toast()?.error?.('Use um id com letras minúsculas, números e _ (começando com letra).'); return false }
        const path = `cutscenes/${id}.cutscene.json`
        if (files.value.includes(path) || Object.values(sceneSummaries.value).some(item => item.id === id)) { toast()?.error?.(`Já existe uma cena com id "${id}".`); return false }
        if (!confirmDiscard()) return false
        const value = newCutscene(id)
        value.title = title || id
        value.map = mapRelativePath.value
        await prepareAuthoringSave()
        await window.retroStudio.writeTextFile(abs(path), `${JSON.stringify(value, null, 2)}\n`)
        await loadList()
        scenePath.value = ''
        savedSnapshot.value = ''
        scene.value = null
        await openSceneContent(path)
        return await publishCompiledScenes()
    }

    async function saveScene() {
        if (busy.value) return false
        if (!scene.value || !scenePath.value) return exportFailure.value ? await compileAll() : true
        const path = scenePath.value
        const snapshot = JSON.stringify(scene.value)
        busy.value = true
        try {
            await prepareAuthoringSave()
            await window.retroStudio.writeTextFile(abs(path), `${JSON.stringify(JSON.parse(snapshot), null, 2)}\n`)
            savedSnapshot.value = snapshot
            await loadList()
            // Programmatic edits during a save also remain pending; do not publish them.
            if (path !== scenePath.value || JSON.stringify(scene.value) !== snapshot) {
                exportFailure.value = true
                return false
            }
            const ok = await compileAllContent()
            exportFailure.value = !ok
            if (ok) toast()?.success?.('Cena salva e cabeçalhos C atualizados.')
            else toast()?.warning?.('Cena salva, mas há erros; os cabeçalhos C não foram atualizados.')
            return ok
        } catch (error) {
            exportFailure.value = true
            toast()?.error?.(`Falha ao salvar a cena: ${error.message}`)
            return false
        } finally { busy.value = false }
    }

    /** Compiles every cutscene and writes the C headers when there are no errors. */
    async function compileAllContent() {
        return await exportSavedScenes('publish')
    }

    // Step list editing. Paths are dotted: steps.N, steps.N.options.M.steps.K, steps.N.then.K
    function listAt(listPath) {
        if (!scene.value) return null
        const list = getAt(scene.value, listPath)
        return Array.isArray(list) ? list : null
    }
    function insertStep(listPath, index, type) {
        const list = listAt(listPath)
        if (!list || !STEP_TYPES[type]) return
        const at = Math.max(0, Math.min(list.length, index))
        list.splice(at, 0, newStep(type, config.value))
        selectedPath.value = `${listPath}.${at}`
    }
    function addAfterSelected(type) {
        if (selectedPath.value) {
            const { list, index } = splitStepPath(selectedPath.value)
            insertStep(list, index + 1, type)
        } else insertStep('steps', scene.value?.steps.length || 0, type)
    }
    function removeStep(path) {
        const { list, index } = splitStepPath(path)
        const items = listAt(list)
        if (!items) return
        items.splice(index, 1)
        selectedPath.value = items.length ? `${list}.${Math.min(index, items.length - 1)}` : (list === 'steps' ? '' : list.replace(/\.(steps|then|else)$/, '').replace(/\.options\.\d+$/, ''))
    }
    function moveStep(path, delta) {
        const { list, index } = splitStepPath(path)
        const items = listAt(list)
        const target = index + delta
        if (!items || target < 0 || target >= items.length) return
        const [step] = items.splice(index, 1)
        items.splice(target, 0, step)
        selectedPath.value = `${list}.${target}`
    }
    function duplicateStep(path) {
        const { list, index } = splitStepPath(path)
        const items = listAt(list)
        if (!items) return
        items.splice(index + 1, 0, clone(items[index]))
        selectedPath.value = `${list}.${index + 1}`
    }
    function updateStep(path, field, value) {
        const step = getAt(scene.value, path)
        if (!step) return
        if (value === undefined || value === '') delete step[field]
        else step[field] = value
    }

    // Stage simulation: initial actor positions come from the map objects named in the config.
    function initialActorPositions() {
        const tile = host.tileSize || 8
        const positions = {}
        for (const actor of actors.value) {
            const object = (host.objects.value || []).find(item => item.type === actor.mapObjectType)
            positions[actor.id] = object
                ? { x: Math.round((object.x + (object.width || 1) / 2) * tile), y: (object.y + (object.height || 1)) * tile, found: true }
                : { x: 32, y: (host.mapHeight?.value || 28) * tile - 16, found: false }
        }
        return positions
    }

    /** Walks every step in document order, tracking where each actor is before and after it. */
    function walkSteps(visit) {
        if (!scene.value) return
        const positions = initialActorPositions()
        const walk = (steps, base) => steps.forEach((step, index) => {
            const path = `${base}.${index}`
            const before = clone(positions)
            if (step.type === 'move' && positions[step.actor]) {
                const from = positions[step.actor]
                const to = movePath(step, from).at(-1)
                positions[step.actor] = { ...from, x: to.x, y: to.y }
            } else if (step.type === 'place' && positions[step.actor]) {
                const from = positions[step.actor]
                const hasY = step.y !== undefined && step.y !== null && step.y !== ''
                positions[step.actor] = { ...from, x: Number(step.x || 0), y: hasY ? Number(step.y) : from.y }
            }
            visit(step, path, before, positions)
            for (const branch of stepBranches(step)) walk(branch.steps, `${path}.${branch.key}`)
        })
        walk(scene.value.steps || [], 'steps')
    }

    function positionsBefore(path) {
        let found = null
        walkSteps((step, stepPath, before) => { if (stepPath === path) found = before })
        return found || initialActorPositions()
    }

    const overlay = computed(() => {
        // Marcar pontos no mapa precisa dos caminhos visíveis, mesmo com a opção desligada.
        const show = showOverlay.value || !!picking.value
        if (!open.value && !show) return []
        if (!scene.value || !show || previewing.value) return []
        const colors = Object.fromEntries(actors.value.map(actor => [actor.id, actor.color || '#7dd3fc']))
        const marks = []
        const initial = initialActorPositions()
        for (const actor of actors.value) marks.push({ kind: 'actor', x: initial[actor.id].x, y: initial[actor.id].y, color: colors[actor.id], label: actor.name || actor.id, dim: !initial[actor.id].found })
        let number = 0
        walkSteps((step, path, before, after) => {
            number++
            const selected = path === selectedPath.value
            if (step.type === 'move' && before[step.actor]) {
                // Uma rota desenha um trecho por passo; só o primeiro leva o número do comando.
                const points = movePath(step, before[step.actor])
                // No comando selecionado, cada ponto leva o número do passo, para casar com a lista da rota.
                const numbered = selected && Array.isArray(step.route) && step.route.length > 0
                for (let i = 1; i < points.length; i++) marks.push({ kind: 'path', from: points[i - 1], to: points[i], arc: points[i].jump ? points[i].height : 0, color: colors[step.actor], label: numbered ? `${number}.${i}` : i === 1 ? String(number) : '', selected })
            } else if (step.type === 'place' && before[step.actor]) {
                marks.push({ kind: 'jump', from: before[step.actor], to: after[step.actor], color: colors[step.actor], label: String(number), selected })
            } else if (step.type === 'camera' && step.mode !== 'follow') {
                const screen = config.value.screen || { width: 320, height: 224 }
                const x = step.mode === 'x' ? Number(step.x || 0) : (after[step.actor]?.x || 0) - screen.width / 2
                marks.push({ kind: 'camera', x, width: screen.width, height: screen.height, label: `${number} câmera`, selected })
            } else if (step.type === 'say' && after[step.actor] && selected) {
                marks.push({ kind: 'speech', x: after[step.actor].x, y: after[step.actor].y, color: colors[step.actor], label: String(number), selected })
            }
        })
        return marks
    })

    /** routeIndex picks the destination of one step of a route instead of the command itself. */
    function startPick(path, routeIndex = -1) {
        if (!getAt(scene.value, path)) return
        picking.value = { path, routeIndex }
    }
    /** Keeps picking: every click on the map adds one point to the route of a `move` step. */
    function startRoutePoints(path) {
        if (getAt(scene.value, path)?.type !== 'move') return
        picking.value = { path, routeIndex: -1, append: true, added: 0 }
    }
    function routeEnd(step, path, count) {
        return movePath({ ...step, repeat: 1, route: (step.route || []).slice(0, count) }, positionsBefore(path)[step.actor] || { x: 0, y: 0 }).at(-1)
    }
    function undoRoutePoint() {
        const pick = picking.value
        const step = pick?.append && getAt(scene.value, pick.path)
        if (!step || !pick.added) return
        step.route.pop()
        if (!step.route.length) delete step.route
        picking.value = { ...pick, added: pick.added - 1 }
    }
    function cancelPick() { picking.value = null }
    function completePick(point) {
        const pick = picking.value
        if (!pick?.append) picking.value = null
        const step = pick && getAt(scene.value, pick.path)
        if (!step) { picking.value = null; return }
        const x = Math.round(point.x)
        const y = Math.round(point.y)
        if (pick.append) {
            if (!Array.isArray(step.route)) step.route = []
            const from = step.route.length ? routeEnd(step, pick.path, step.route.length) : positionsBefore(pick.path)[step.actor] || { x: 0, y: 0 }
            step.route.push({ kind: 'move', x: x - from.x, y: y - from.y })
            picking.value = step.route.length >= MAX_ROUTE_STEPS ? null : { ...pick, added: pick.added + 1 }
            return
        }
        if (step.type === 'camera') {
            const screen = config.value.screen || { width: 320 }
            step.mode = 'x'
            step.x = Math.max(0, x - Math.round(screen.width / 2))
            return
        }
        if (step.type === 'move' && pick.routeIndex >= 0) {
            const item = step.route?.[pick.routeIndex]
            if (!item) return
            if (item.kind === 'to') {
                item.x = x
                if (item.y !== undefined && item.y !== '') item.y = y
                return
            }
            const from = pick.routeIndex ? routeEnd(step, pick.path, pick.routeIndex) : positionsBefore(pick.path)[step.actor] || { x: 0, y: 0 }
            const shiftX = x - from.x - Number(item.x || 0)
            const shiftY = y - from.y - Number(item.y || 0)
            item.x = x - from.x
            item.y = y - from.y
            // O ponto seguinte continua no lugar: o passo relativo depois deste absorve a diferença.
            const next = step.route.slice(pick.routeIndex + 1).find(other => ['move', 'jump', 'to'].includes(other.kind))
            if (next && next.kind !== 'to') { next.x = Number(next.x || 0) - shiftX; next.y = Number(next.y || 0) - shiftY }
            return
        }
        if (step.type === 'move' && step.relative) {
            const from = positionsBefore(pick.path)[step.actor] || { x: 0, y: 0 }
            step.x = x - from.x
            if (step.y !== undefined && step.y !== '') step.y = y - from.y
        } else {
            step.x = x
            if (step.y !== undefined && step.y !== '') step.y = y
        }
    }

    const triggersForScene = computed(() => {
        const id = scene.value?.id
        return (host.objects.value || []).filter(object => object.type === 'cutscene_trigger' && (!id || object.properties?.cutscene === id))
    })

    watch(() => host.projectPath, async path => {
        configLoaded = false
        scene.value = null; scenePath.value = ''; files.value = []; status.value = null
        // The sidebar and the trigger inspector list scenes before the editor is opened.
        if (path) { try { await loadConfig(); await loadList({ quiet: true }) } catch { /* editor shows errors when opened */ } }
    }, { immediate: true })

    return {
        open, status, busy, exportFailure, lastPublication, config, configExists, configErrors, files, sceneSummaries, scene, scenePath, dirty,
        selectedPath, selectedStep, compiled, projectErrors, picking, showOverlay, previewing, overlay, portraitPreviews,
        actors, triggersForScene, mapRelativePath,
        openEditor, close: () => { open.value = false; picking.value = null; previewing.value = false },
        refreshStatus, installRuntime, loadConfig, saveConfig, loadList, openScene, createScene, saveScene, compileAll, recompileAll,
        insertStep, addAfterSelected, removeStep, moveStep, duplicateStep, updateStep, listAt,
        startPick, startRoutePoints, undoRoutePoint, cancelPick, completePick, positionsBefore
    }
}
