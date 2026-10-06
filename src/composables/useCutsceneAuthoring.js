import { ref, computed, watch } from 'vue'
import {
    compileCutscene, compileProject, defaultCutsceneConfig, newCutscene, newStep, parseJson,
    stepBranches, validateConfig, STEP_TYPES
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
    const config = ref(defaultCutsceneConfig())
    const configExists = ref(false)
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
        configExists.value = text != null
        if (text == null) { config.value = defaultCutsceneConfig(); configErrors.value = []; return }
        const parsed = parseJson(text, CONFIG_PATH)
        if (parsed.error) { configErrors.value = [parsed.error]; return }
        config.value = { ...defaultCutsceneConfig(), ...parsed.value }
        configErrors.value = validateConfig(config.value)
        loadPortraitPreviews()
    }

    async function saveConfig(next) {
        const errors = validateConfig(next)
        configErrors.value = errors
        if (errors.length) { toast()?.error?.(errors[0]); return false }
        await window.retroStudio.writeTextFile(abs(CONFIG_PATH), `${JSON.stringify(next, null, 2)}\n`)
        config.value = next
        configExists.value = true
        loadPortraitPreviews()
        await compileAll()
        return true
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
        open.value = true
        await Promise.all([refreshStatus(), loadConfig()])
        await loadList()
        if (!scene.value && files.value.length) {
            const forMap = files.value.find(path => sceneSummaries.value[path]?.map === mapRelativePath.value)
            await openScene(forMap || files.value[0])
        }
    }

    function confirmDiscard() {
        return !dirty.value || window.confirm('Descartar alterações não salvas desta cena?')
    }

    async function openScene(path) {
        if (path === scenePath.value) return
        if (!confirmDiscard()) return
        const text = await window.retroStudio.readTextFile(abs(path))
        const parsed = parseJson(text, path)
        if (parsed.error) { toast()?.error?.(parsed.error); return }
        const value = parsed.value
        value.steps = Array.isArray(value.steps) ? value.steps : []
        scene.value = value
        scenePath.value = path
        savedSnapshot.value = JSON.stringify(value)
        selectedPath.value = value.steps.length ? 'steps.0' : ''
    }

    async function createScene(id, title) {
        id = String(id || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
        if (!/^[a-z][a-z0-9_]*$/.test(id)) { toast()?.error?.('Use um id com letras minúsculas, números e _ (começando com letra).'); return false }
        const path = `cutscenes/${id}.cutscene.json`
        if (files.value.includes(path) || Object.values(sceneSummaries.value).some(item => item.id === id)) { toast()?.error?.(`Já existe uma cena com id "${id}".`); return false }
        if (!confirmDiscard()) return false
        const value = newCutscene(id)
        value.title = title || id
        value.map = mapRelativePath.value
        await window.retroStudio.writeTextFile(abs(path), `${JSON.stringify(value, null, 2)}\n`)
        await loadList()
        scenePath.value = ''
        savedSnapshot.value = ''
        scene.value = null
        await openScene(path)
        await compileAll()
        return true
    }

    async function saveScene() {
        if (!scene.value || !scenePath.value) return
        busy.value = true
        try {
            await window.retroStudio.writeTextFile(abs(scenePath.value), `${JSON.stringify(scene.value, null, 2)}\n`)
            savedSnapshot.value = JSON.stringify(scene.value)
            await loadList()
            const ok = await compileAll()
            if (ok) toast()?.success?.('Cena salva e cabeçalhos C atualizados.')
            else toast()?.warning?.('Cena salva, mas há erros; os cabeçalhos C não foram atualizados.')
        } catch (error) {
            toast()?.error?.(`Falha ao salvar a cena: ${error.message}`)
        } finally { busy.value = false }
    }

    /** Compiles every cutscene and writes the C headers when there are no errors. */
    async function compileAll() {
        const inputs = []
        const errors = [...configErrors.value]
        for (const path of files.value) {
            const text = path === scenePath.value && scene.value ? JSON.stringify(scene.value) : await window.retroStudio.readTextFileOptional(abs(path))
            if (text == null) continue
            const parsed = parseJson(text, path)
            if (parsed.error) errors.push(parsed.error)
            else inputs.push({ path, scene: parsed.value })
        }
        const result = compileProject(inputs, config.value)
        errors.push(...result.errors)
        projectErrors.value = errors
        if (errors.length || !configExists.value) return false
        const output = config.value.output || {}
        await window.retroStudio.writeTextFile(abs(output.ids || 'src/cutscene_ids.h'), result.idsHeader)
        await window.retroStudio.writeTextFile(abs(output.data || 'src/cutscene_data.h'), result.dataHeader)
        return true
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
            if ((step.type === 'move' || step.type === 'place') && positions[step.actor]) {
                const from = positions[step.actor]
                const relative = step.type === 'move' && step.relative
                const hasY = step.y !== undefined && step.y !== null && step.y !== ''
                positions[step.actor] = {
                    ...from,
                    x: relative ? from.x + Number(step.x || 0) : Number(step.x || 0),
                    y: hasY ? (relative ? from.y + Number(step.y || 0) : Number(step.y)) : from.y
                }
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
        if (!open.value && !showOverlay.value) return []
        if (!scene.value || !showOverlay.value || previewing.value) return []
        const colors = Object.fromEntries(actors.value.map(actor => [actor.id, actor.color || '#7dd3fc']))
        const marks = []
        const initial = initialActorPositions()
        for (const actor of actors.value) marks.push({ kind: 'actor', x: initial[actor.id].x, y: initial[actor.id].y, color: colors[actor.id], label: actor.name || actor.id, dim: !initial[actor.id].found })
        let number = 0
        walkSteps((step, path, before, after) => {
            number++
            const selected = path === selectedPath.value
            if ((step.type === 'move' || step.type === 'place') && before[step.actor]) {
                marks.push({ kind: step.type === 'move' ? 'path' : 'jump', from: before[step.actor], to: after[step.actor], color: colors[step.actor], label: String(number), selected })
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

    function startPick(path) {
        if (!getAt(scene.value, path)) return
        picking.value = { path }
    }
    function cancelPick() { picking.value = null }
    function completePick(point) {
        const pick = picking.value
        picking.value = null
        const step = pick && getAt(scene.value, pick.path)
        if (!step) return
        const x = Math.round(point.x)
        const y = Math.round(point.y)
        if (step.type === 'camera') {
            const screen = config.value.screen || { width: 320 }
            step.mode = 'x'
            step.x = Math.max(0, x - Math.round(screen.width / 2))
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
        scene.value = null; scenePath.value = ''; files.value = []; status.value = null
        // The sidebar and the trigger inspector list scenes before the editor is opened.
        if (path) { try { await loadConfig(); await loadList({ quiet: true }) } catch { /* editor shows errors when opened */ } }
    }, { immediate: true })

    return {
        open, status, busy, config, configExists, configErrors, files, sceneSummaries, scene, scenePath, dirty,
        selectedPath, selectedStep, compiled, projectErrors, picking, showOverlay, previewing, overlay, portraitPreviews,
        actors, triggersForScene, mapRelativePath,
        openEditor, close: () => { open.value = false; picking.value = null; previewing.value = false },
        refreshStatus, installRuntime, loadConfig, saveConfig, loadList, openScene, createScene, saveScene, compileAll,
        insertStep, addAfterSelected, removeStep, moveStep, duplicateStep, updateStep, listAt,
        startPick, cancelPick, completePick, positionsBefore
    }
}
