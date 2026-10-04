import { ref } from 'vue'
import { parseAssetPack, brushCells, normalizeAssetPath } from '../utils/retro/tilemapAssetPack.js'

export function useMapPackAuthoring(state, t) {
    const authoring = ref(false)
    const exporting = ref(false)
    const error = ref('')
    const savedPath = ref('')
    const brushDraft = ref({ name: '', category: '', layer: 'bg', collision: 'none' })
    const editingBrushId = ref(null)
    const clone = value => JSON.parse(JSON.stringify(value))
    const nextId = (items, prefix) => {
        let n = 1
        while (items.some(item => item.id === `${prefix}-${n}`)) n++
        return `${prefix}-${n}`
    }
    function openAuthoring() {
        if (!state.assetPack.value) {
            state.assetPack.value = { version: 1, tileSize: 8, name: t('tilemap.pack.newName'), tilesets: [], brushes: [], objects: clone(state.objectTemplates.value) }
            state.assetPackTilesets.value = {}
        }
        authoring.value = !authoring.value
    }
    function editBrush(brush) {
        editingBrushId.value = brush.id
        brushDraft.value = { name: brush.name || '', category: brush.category || '', layer: brush.layer, collision: brush.collision }
        authoring.value = true
    }
    function resetDraft() {
        editingBrushId.value = null
        brushDraft.value = { name: '', category: '', layer: 'bg', collision: 'none' }
        error.value = ''
    }
    function saveBrush() {
        error.value = ''
        try {
            if (!brushDraft.value.name.trim()) throw new Error(t('tilemap.pack.nameRequired'))
            const pack = clone(state.assetPack.value)
            let brush = pack.brushes.find(b => b.id === editingBrushId.value)
            if (!brush) {
                const ts = state.selectedTileset.value
                const region = state.selectedTileRegion.value
                if (!ts || !region) throw new Error(t('tilemap.pack.selectRegion'))
                const fullPath = normalizeAssetPath(ts.path)
                let entry = pack.tilesets.find(item => state.assetPackTilesets.value[item.id] === fullPath)
                if (!entry) {
                    entry = { id: nextId(pack.tilesets, 'tileset'), file: `tileset-${pack.tilesets.length + 1}.png` }
                    pack.tilesets.push(entry)
                }
                brush = { id: nextId(pack.brushes, 'brush'), tileset: entry.id, x: region.idx % ts.columns, y: Math.floor(region.idx / ts.columns), w: region.w, h: region.h, palette: 0 }
                brushCells(brush, ts)
                pack.brushes.push(brush)
                // Commit image mapping only after validating the complete catalog.
                Object.assign(brush, brushDraft.value, { name: brushDraft.value.name.trim() })
                parseAssetPack(JSON.stringify(pack))
                state.assetPackTilesets.value = { ...state.assetPackTilesets.value, [entry.id]: fullPath }
            } else {
                Object.assign(brush, brushDraft.value, { name: brushDraft.value.name.trim() })
                parseAssetPack(JSON.stringify(pack))
            }
            state.assetPack.value = pack
            if (state.selectedPackBrush.value?.id === brush.id) state.selectedPackBrush.value = brush
            resetDraft()
        } catch (e) { error.value = e.message }
    }
    function removeBrush(id) {
        state.assetPack.value = { ...state.assetPack.value, brushes: state.assetPack.value.brushes.filter(b => b.id !== id) }
        if (state.selectedPackBrush.value?.id === id) state.selectedPackBrush.value = null
        resetDraft()
    }
    function addObjectTemplate() {
        try {
            const obj = state.selectedObject.value
            if (!obj) throw new Error(t('tilemap.pack.selectObject'))
            const pack = clone(state.assetPack.value)
            pack.objects.push({ name: obj.name, type: obj.type, width: obj.width || 1, height: obj.height || 1, properties: clone(obj.properties || {}) })
            parseAssetPack(JSON.stringify(pack))
            state.assetPack.value = pack
            error.value = ''
        } catch (e) { error.value = e.message }
    }
    function removeObjectTemplate(index) {
        state.assetPack.value = { ...state.assetPack.value, objects: state.assetPack.value.objects.filter((_, i) => i !== index) }
        state.objectTemplateIndex.value = 0
    }
    async function exportPack() {
        error.value = ''; savedPath.value = ''
        const bridge = window.retroStudio
        exporting.value = true
        try {
            const pack = clone(state.assetPack.value)
            if (!pack?.name?.trim()) throw new Error(t('tilemap.pack.nameRequired'))
            if (!pack.brushes.length && !pack.objects.length) throw new Error(t('tilemap.pack.emptyKit'))
            // Unused atlases are omitted, keeping kits small after deleting brushes.
            pack.tilesets = pack.tilesets.filter(ts => pack.brushes.some(b => b.tileset === ts.id))
            parseAssetPack(JSON.stringify(pack))
            if (!bridge?.copyFileFromExternal || !bridge?.writeTextFile) throw new Error(t('tilemap.pack.bridgeUnavailable'))
            const paths = { ...state.assetPackTilesets.value }
            for (const ts of pack.tilesets) {
                if (!paths[ts.id] || !/\.png$/i.test(paths[ts.id])) throw new Error(t('tilemap.pack.pngRequired'))
            }
            const result = await bridge.retro.selectSaveFile({ context: 'map-pack-save', title: t('tilemap.pack.saveKit'), defaultPath: state.projectPath, filters: [{ name: 'Map kit', extensions: ['json'] }] })
            if (!result?.success || !result.path) return
            const out = /\.json$/i.test(result.path) ? result.path : `${result.path}.json`
            const base = out.replace(/[/\\][^/\\]+$/, '')
            // Fresh directories avoid overwriting source images and basename collisions.
            const folder = `kit-assets-${crypto.randomUUID()}`
            for (let i = 0; i < pack.tilesets.length; i++) {
                const ts = pack.tilesets[i]
                const source = paths[ts.id]
                const file = normalizeAssetPath(source).split('/').pop()
                ts.file = `${folder}/${i}/${file}`
            }
            parseAssetPack(JSON.stringify(pack))
            for (let i = 0; i < pack.tilesets.length; i++) {
                const ts = pack.tilesets[i]
                await bridge.copyFileFromExternal(paths[ts.id], `${base}/${folder}/${i}`)
            }
            // Publish the catalog last so failed copies never create an incomplete kit.
            await bridge.writeTextFile(out, JSON.stringify(pack, null, 2) + '\n')
            savedPath.value = out
            window.retroStudioToast?.success?.(t('tilemap.pack.savedKit'))
        } catch (e) { error.value = e.message }
        finally { exporting.value = false }
    }
    return { authoring, exporting, error, savedPath, brushDraft, editingBrushId, openAuthoring, editBrush, resetDraft, saveBrush, removeBrush, addObjectTemplate, removeObjectTemplate, exportPack }
}
