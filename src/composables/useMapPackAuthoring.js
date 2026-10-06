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
            state.assetPack.value = { version: 1, tileSize: 8, name: t('tilemap.pack.newName'), tilesets: [], brushes: [], objects: clone(state.objectTemplates.value), visualAssets: [] }
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
                    entry = { id: nextId(pack.tilesets, 'tileset'), file: `tileset-${pack.tilesets.length + 1}.png`, columns: ts.columns || 16, tilecount: ts.tilecount || 256 }
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
            let visual = obj.visual ? clone(obj.visual) : null
            if (visual?.gid && !visual.tileset) {
                const ts = state.userTilesets.value.find(item => visual.gid >= item.firstgid && visual.gid < item.firstgid + item.tilecount)
                if (ts) {
                    let entry = pack.tilesets.find(item => state.assetPackTilesets.value[item.id] === normalizeAssetPath(ts.path))
                    if (!entry) {
                        entry = { id: nextId(pack.tilesets, 'tileset'), file: `tileset-${pack.tilesets.length + 1}.png`, columns: ts.columns || 16, tilecount: ts.tilecount || 256 }
                        pack.tilesets.push(entry)
                        state.assetPackTilesets.value = { ...state.assetPackTilesets.value, [entry.id]: normalizeAssetPath(ts.path) }
                    }
                    const local = visual.gid - ts.firstgid
                    visual = { tileset: entry.id, x: local % (ts.columns || 16), y: Math.floor(local / (ts.columns || 16)), w: visual.width || 1, h: visual.height || 1, frames: visual.frames || 1, fps: visual.fps || 4, loop: visual.loop !== false, ...(visual.displayWidth ? { displayWidth: visual.displayWidth } : {}), ...(visual.displayHeight ? { displayHeight: visual.displayHeight } : {}), ...(visual.anchor ? { anchor: visual.anchor } : {}) }
                } else visual = null
            }
            pack.objects.push({ name: obj.name, type: obj.type, category: obj.category || 'marker', width: obj.width || 1, height: obj.height || 1, properties: clone(obj.properties || {}), ...(visual ? { visual } : {}) })
            parseAssetPack(JSON.stringify(pack))
            state.assetPack.value = pack
            error.value = ''
        } catch (e) { error.value = e.message }
    }
    function saveObjectTemplate(input, index = -1) {
        try {
            const pack = clone(state.assetPack.value)
            const visual = input.visual ? clone(input.visual) : null
            if (visual) {
                const ts = state.userTilesets.value.find(item => item.id === visual.tilesetId)
                if (!ts) throw new Error(t('tilemap.pack.selectVisual'))
                let entry = pack.tilesets.find(item => state.assetPackTilesets.value[item.id] === normalizeAssetPath(ts.path))
                if (!entry) {
                    entry = { id: nextId(pack.tilesets, 'tileset'), file: `tileset-${pack.tilesets.length + 1}.png`, columns: ts.columns || 16, tilecount: ts.tilecount || 256 }
                    pack.tilesets.push(entry)
                    state.assetPackTilesets.value = { ...state.assetPackTilesets.value, [entry.id]: normalizeAssetPath(ts.path) }
                }
                entry.columns ||= ts.columns || 16
                entry.tilecount ||= ts.tilecount || 256
                visual.tileset = entry.id
                delete visual.tilesetId
            }
            const model = { name: input.name.trim(), type: input.type.trim(), category: input.category, width: Number(input.width), height: Number(input.height), properties: clone(input.properties || {}), ...(visual ? { visual } : {}) }
            if (!model.name || !model.type) throw new Error(t('tilemap.pack.objectNameRequired'))
            if (!Number.isInteger(model.width) || !Number.isInteger(model.height) || model.width < 1 || model.height < 1) throw new Error(t('tilemap.pack.invalidObjectSize'))
            if (index >= 0 && pack.objects[index]) pack.objects.splice(index, 1, model)
            else pack.objects.push(model)
            parseAssetPack(JSON.stringify(pack))
            state.assetPack.value = pack
            error.value = ''
            return true
        } catch (e) { error.value = e.message; return false }
    }
    function removeObjectTemplate(index) {
        state.assetPack.value = { ...state.assetPack.value, objects: state.assetPack.value.objects.filter((_, i) => i !== index) }
        state.objectTemplateIndex.value = 0
    }
    function saveVisualAsset(input) {
        try {
            const pack = clone(state.assetPack.value)
            const visual = clone(input.visual || {})
            const ts = state.userTilesets.value.find(item => item.id === visual.tilesetId)
            if (!ts) throw new Error(t('tilemap.pack.selectVisual'))
            const path = normalizeAssetPath(ts.path)
            let entry = pack.tilesets.find(item => state.assetPackTilesets.value[item.id] === path)
            if (!entry) {
                entry = { id: nextId(pack.tilesets, 'tileset'), file: `tileset-${pack.tilesets.length + 1}.png`, columns: ts.columns || 16, tilecount: ts.tilecount || 256 }
                pack.tilesets.push(entry)
            }
            const asset = {
                id: input.id || nextId(pack.visualAssets || [], 'asset'),
                name: String(input.name || '').trim(),
                category: input.category,
                kind: input.kind || (Number(visual.frames || 1) > 1 ? 'animation' : 'sprite'),
                tileset: entry.id,
                x: Number(visual.x), y: Number(visual.y), w: Number(visual.w), h: Number(visual.h),
                frames: Number(visual.frames || 1), fps: Number(visual.fps || 4), loop: visual.loop !== false,
                ...(visual.displayWidth ? { displayWidth: Number(visual.displayWidth) } : {}),
                ...(visual.displayHeight ? { displayHeight: Number(visual.displayHeight) } : {}),
                ...(visual.anchor ? { anchor: visual.anchor } : {})
            }
            if (!asset.name) throw new Error(t('tilemap.pack.nameRequired'))
            const assets = pack.visualAssets || (pack.visualAssets = [])
            const index = assets.findIndex(item => item.id === asset.id)
            if (index >= 0) assets.splice(index, 1, asset)
            else assets.push(asset)
            parseAssetPack(JSON.stringify(pack))
            state.assetPack.value = pack
            state.assetPackTilesets.value = { ...state.assetPackTilesets.value, [entry.id]: path }
            error.value = ''
            return true
        } catch (e) { error.value = e.message; return false }
    }
    function removeVisualAsset(id) {
        try {
            const pack = clone(state.assetPack.value)
            pack.visualAssets = (pack.visualAssets || []).filter(asset => asset.id !== id)
            parseAssetPack(JSON.stringify(pack))
            state.assetPack.value = pack
            error.value = ''
        } catch (e) { error.value = e.message }
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
            pack.tilesets = pack.tilesets.filter(ts => pack.brushes.some(b => b.tileset === ts.id) || pack.objects.some(o => o.visual?.tileset === ts.id) || (pack.visualAssets || []).some(asset => asset.tileset === ts.id))
            parseAssetPack(JSON.stringify(pack))
            if (!bridge?.copyFileFromExternal || !bridge?.writeTextFile) throw new Error(t('tilemap.pack.bridgeUnavailable'))
            const paths = { ...state.assetPackTilesets.value }
            for (const ts of pack.tilesets) {
                if (!paths[ts.id] || !/\.png$/i.test(paths[ts.id])) throw new Error(t('tilemap.pack.pngRequired'))
            }
            let out = state.assetPackPath.value
            if (!out) {
                const result = await bridge.retro.selectSaveFile({ context: 'map-pack-save', title: t('tilemap.pack.saveKit'), defaultPath: state.projectPath, filters: [{ name: 'Map kit', extensions: ['json'] }] })
                if (!result?.success || !result.path) return
                out = /\.json$/i.test(result.path) ? result.path : `${result.path}.json`
            }
            const base = out.replace(/[/\\][^/\\]+$/, '')
            // Keep a stable asset directory so later saves replace the kit's own copies.
            const existingFolder = pack.tilesets.map(ts => ts.file.split('/')[0]).find(folder => /^kit-assets-[\w-]+$/.test(folder))
            const folder = existingFolder || `kit-assets-${crypto.randomUUID()}`
            for (let i = 0; i < pack.tilesets.length; i++) {
                const ts = pack.tilesets[i]
                const source = paths[ts.id]
                const file = normalizeAssetPath(source).split('/').pop()
                ts.file = `${folder}/${i}/${file}`
            }
            parseAssetPack(JSON.stringify(pack))
            for (let i = 0; i < pack.tilesets.length; i++) {
                const ts = pack.tilesets[i]
                const destinationFolder = `${base}/${folder}/${i}`
                const destination = `${destinationFolder}/${ts.file.split('/').pop()}`
                if (normalizeAssetPath(paths[ts.id]) !== normalizeAssetPath(destination)) {
                    await bridge.copyFileFromExternal(paths[ts.id], destinationFolder)
                }
            }
            // Publish the catalog last so failed copies never create an incomplete kit.
            await bridge.ensureDirectory?.(`${base}/maps`)
            await bridge.writeTextFile(out, JSON.stringify(pack, null, 2) + '\n')
            state.assetPackPath.value = out
            state.assetPackTilesets.value = Object.fromEntries(pack.tilesets.map((ts, index) => [ts.id, `${base}/${ts.file}`]))
            await state.rememberSavedKit?.(out, pack.name)
            savedPath.value = out
            window.retroStudioToast?.success?.(t('tilemap.pack.savedKit'))
        } catch (e) { error.value = e.message }
        finally { exporting.value = false }
    }
    return { authoring, exporting, error, savedPath, brushDraft, editingBrushId, openAuthoring, editBrush, resetDraft, saveBrush, removeBrush, addObjectTemplate, saveObjectTemplate, removeObjectTemplate, saveVisualAsset, removeVisualAsset, exportPack }
}
