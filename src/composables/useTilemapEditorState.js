import { ref, computed } from 'vue'
import { toTMX, fromTMX, fromJSON, toCArray, TILE_SIZE } from '@/utils/retro/tmxFormat.js'

export function useTilemapEditorState(props, emit) {
    const TILE_SIZE_CONST = TILE_SIZE
    const PALETTE_ZOOM = 3

    // Core References
    const mapCanvas = ref(null)
    const tilesetCanvas = ref(null)
    const mapWrapRef = ref(null)

    // State
    // Internal mapping values since template v-model is eager
    const mapWidthInternal = ref(40)
    const mapHeightInternal = ref(30)

    // Controlled computed properties to manage resizing of map tiles while keeping their relative positions
    const mapWidth = computed({
        get: () => mapWidthInternal.value,
        set: (val) => resizeMap(val, mapHeightInternal.value)
    })
    const mapHeight = computed({
        get: () => mapHeightInternal.value,
        set: (val) => resizeMap(mapWidthInternal.value, val)
    })

    const tiles = ref([])
    const tiles2 = ref([])
    const activeLayer = ref('bg')
    const zoom = ref(2)
    const selectedTileIndex = ref(0)
    const selectedTilesetId = ref('')
    const saving = ref(false)
    const isDrawing = ref(false)
    const isMaximized = ref(false)

    // Draw Tools
    const DRAW_TOOLS = {
        pencil: { id: 'pencil', icon: '✎', title: 'Lápis (P)' },
        eraser: { id: 'eraser', icon: '⌫', title: 'Apagar (E)' },
        fill: { id: 'fill', icon: '▤', title: 'Preencher (F)' },
        rect: { id: 'rect', icon: '▭', title: 'Retângulo (R)' },
        line: { id: 'line', icon: '∕', title: 'Linha (L)' },
        select: {
            id: 'select',
            icon: '▢',
            title: 'Selecionar (S)'
        }
    }
    const drawTools = Object.values(DRAW_TOOLS)
    const drawTool = ref('pencil')

    // Debug & Overlays
    const showGrid = ref(true)
    const showTileIndices = ref(false)
    const showPaletteIndices = ref(false)
    const showCoords = ref(false)
    const showCollision = ref(false)
    const showPriority = ref(false)
    const hoverCoord = ref(null)

    // Attributes
    const collisionMap = ref([])
    const priorityMap = ref([])
    const editCollision = ref(false)
    const editPriority = ref(false)

    // Interaction State
    const dragStart = ref(null)
    const HISTORY_MAX = 50
    const history = ref([])
    const historyIndex = ref(-1)
    const isPanning = ref(false)
    const panStart = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })

    // Selection & Clipboard
    const selection = ref(null)
    const selectionDragEnd = ref(null)
    const clipboard = ref(null)
    const isMovingSelection = ref(false)
    const moveStartInSelection = ref(null)
    const movePreview = ref(null)

    // Map and Tilesets Status
    const currentMapPath = ref(null)
    const userTilesets = ref([])

    // Computed Properties
    const selectedTileset = computed(() => userTilesets.value.find((t) => t.id === selectedTilesetId.value))
    const tilesetPreview = computed(() => selectedTileset.value?.preview ?? null)
    const canSave = computed(() => selectedTileset.value && userTilesets.value.length > 0)
    const currentMapName = computed(() => {
        if (currentMapPath.value) {
            return currentMapPath.value.split(/[/\\]/).pop()?.replace(/\.tmx$/i, '') || 'Mapa'
        }
        return props.asset?.name || 'Mapa sem título'
    })

    const savePathHint = computed(() => {
        const base = (props.projectPath || '').replace(/\/+$/, '')
        if (!base) return 'Salvar TMX no projeto'
        const relPath = getCurrentMapRelativePath()
        return `Salvar em: ${base}/${relPath}`
    })

    // Basic Helpers
    function getCurrentMapRelativePath() {
        if (currentMapPath.value && props.projectPath) {
            const base = props.projectPath.replace(/[/\\]+$/, '')
            if (currentMapPath.value.startsWith(base)) {
                return currentMapPath.value.slice(base.length).replace(/^[/\\]/, '')
            }
        }
        return props.asset?.path || 'maps/map.tmx'
    }

    function minimize() {
        window.retroStudio?.windowMinimize?.()
    }

    async function toggleMaximize() {
        window.retroStudio?.windowToggleMaximize?.()
        try {
            isMaximized.value = await window.retroStudio?.windowIsMaximized?.() ?? false
        } catch (_) { }
    }

    function resizeMap(newW, newH) {
        if (newW < 8) newW = 8; if (newW > 256) newW = 256
        if (newH < 8) newH = 8; if (newH > 256) newH = 256
        const oldW = mapWidthInternal.value
        const oldH = mapHeightInternal.value
        if (oldW === newW && oldH === newH) return

        pushState()

        const resiteArr = (arr, isBool = false) => {
            const newArr = Array(newW * newH).fill(isBool ? false : 0)
            for (let y = 0; y < Math.min(oldH, newH); y++) {
                for (let x = 0; x < Math.min(oldW, newW); x++) {
                    newArr[y * newW + x] = arr[y * oldW + x]
                }
            }
            return newArr
        }

        tiles.value = resiteArr(tiles.value)
        tiles2.value = resiteArr(tiles2.value)
        collisionMap.value = resiteArr(collisionMap.value, true)
        priorityMap.value = resiteArr(priorityMap.value, true)

        mapWidthInternal.value = newW
        mapHeightInternal.value = newH
    }

    function ensureTiles() {
        const len = mapWidthInternal.value * mapHeightInternal.value
        if (tiles.value.length !== len) tiles.value = Array.from({ length: len }, (_, i) => tiles.value[i] ?? 0)
        if (tiles2.value.length !== len) tiles2.value = Array.from({ length: len }, (_, i) => tiles2.value[i] ?? 0)
        if (collisionMap.value.length !== len) collisionMap.value = Array.from({ length: len }, (_, i) => collisionMap.value[i] ?? false)
        if (priorityMap.value.length !== len) priorityMap.value = Array.from({ length: len }, (_, i) => priorityMap.value[i] ?? false)
    }

    // History system
    function pushState() {
        ensureTiles()
        const state = {
            tiles: [...tiles.value],
            tiles2: [...tiles2.value],
            collision: [...collisionMap.value],
            priority: [...priorityMap.value]
        }
        const idx = historyIndex.value
        history.value = history.value.slice(0, idx + 1)
        history.value.push(state)
        if (history.value.length > HISTORY_MAX) history.value.shift()
        historyIndex.value = history.value.length - 1
    }

    function undo() {
        if (historyIndex.value <= 0) return
        historyIndex.value--
        const s = history.value[historyIndex.value]
        tiles.value = [...s.tiles]
        tiles2.value = s.tiles2 ? [...s.tiles2] : Array(mapWidth.value * mapHeight.value).fill(0)
        collisionMap.value = [...s.collision]
        priorityMap.value = [...s.priority]
    }

    function redo() {
        if (historyIndex.value >= history.value.length - 1) return
        historyIndex.value++
        const s = history.value[historyIndex.value]
        tiles.value = [...s.tiles]
        tiles2.value = s.tiles2 ? [...s.tiles2] : Array(mapWidth.value * mapHeight.value).fill(0)
        collisionMap.value = [...s.collision]
        priorityMap.value = [...s.priority]
    }

    const canUndo = computed(() => historyIndex.value > 0)
    const canRedo = computed(() => historyIndex.value < history.value.length - 1 && history.value.length > 0)

    // Tileset Operations
    async function addTileset() {
        const baseDir = (props.projectPath || '').replace(/\/+$/, '')
        const resDir = baseDir ? `${baseDir}/res`.replace(/\/+/g, '/') : ''
        const result = await window.retroStudio?.retro?.selectFile?.({
            context: 'tileset',
            title: 'Selecionar imagem do tileset',
            defaultPath: resDir || baseDir || undefined,
            filters: [
                { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] },
                { name: 'Todos', extensions: ['*'] }
            ]
        })
        if (!result?.success || !result.path) return
        const fullPath = result.path
        const name = fullPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'tileset'
        let preview = null
        try {
            const r = await window.retroStudio?.retro?.getAssetPreview?.(props.projectPath, fullPath)
            preview = r?.success ? r.preview : null
        } catch (_) { }
        if (!preview) {
            window.retroStudioToast?.error?.('Não foi possível carregar a imagem')
            return
        }
        const ts = {
            id: `ts_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            name,
            path: fullPath,
            preview
        }
        userTilesets.value.push(ts)
        selectedTilesetId.value = ts.id
    }

    function removeTileset(ts) {
        userTilesets.value = userTilesets.value.filter((t) => t.id !== ts.id)
        if (selectedTilesetId.value === ts.id) {
            selectedTilesetId.value = userTilesets.value[0]?.id || ''
        }
    }

    function selectTileset(ts) {
        selectedTilesetId.value = ts.id
    }

    // Paint / Draw Action Logic Shared State
    function getPaintValue() {
        return drawTool.value === 'eraser' ? 0 : selectedTileIndex.value + 1
    }

    function getActiveTiles() {
        return activeLayer.value === 'fg' ? tiles2 : tiles
    }

    function paintTile(idx) {
        if (idx < 0) return
        ensureTiles()
        const arr = getActiveTiles().value
        const newVal = getPaintValue()
        if (arr[idx] !== newVal) {
            arr[idx] = newVal
            getActiveTiles().value = [...arr]
        }
    }

    function fillTile(idx) {
        if (idx < 0 || !selectedTileset.value) return
        ensureTiles()
        const arr = getActiveTiles().value
        const targetVal = arr[idx]
        const newVal = getPaintValue()
        if (targetVal === newVal) return
        pushState()
        const stack = [idx]
        const visited = new Set([idx])
        let count = 0
        const maxFill = mapWidth.value * mapHeight.value
        while (stack.length > 0 && count < maxFill) {
            const i = stack.pop()
            if (arr[i] !== targetVal) continue
            arr[i] = newVal
            count++
            const x = i % mapWidth.value
            const y = Math.floor(i / mapWidth.value)
            for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                const nx = x + dx
                const ny = y + dy
                if (nx >= 0 && nx < mapWidth.value && ny >= 0 && ny < mapHeight.value) {
                    const ni = ny * mapWidth.value + nx
                    if (!visited.has(ni)) {
                        visited.add(ni)
                        stack.push(ni)
                    }
                }
            }
        }
        getActiveTiles().value = [...arr]
    }

    function paintRect(idx1, idx2) {
        if (idx1 < 0 || idx2 < 0) return
        ensureTiles()
        const arr = getActiveTiles().value
        const x1 = Math.min(idx1 % mapWidth.value, idx2 % mapWidth.value)
        const x2 = Math.max(idx1 % mapWidth.value, idx2 % mapWidth.value)
        const y1 = Math.min(Math.floor(idx1 / mapWidth.value), Math.floor(idx2 / mapWidth.value))
        const y2 = Math.max(Math.floor(idx1 / mapWidth.value), Math.floor(idx2 / mapWidth.value))
        const newVal = getPaintValue()
        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                const i = y * mapWidth.value + x
                arr[i] = newVal
            }
        }
        getActiveTiles().value = [...arr]
    }

    function paintLine(idx1, idx2) {
        if (idx1 < 0 || idx2 < 0) return
        ensureTiles()
        const arr = getActiveTiles().value
        const x1 = idx1 % mapWidth.value
        const y1 = Math.floor(idx1 / mapWidth.value)
        const x2 = idx2 % mapWidth.value
        const y2 = Math.floor(idx2 / mapWidth.value)
        const dx = Math.abs(x2 - x1)
        const dy = Math.abs(y2 - y1)
        const sx = x1 < x2 ? 1 : -1
        const sy = y1 < y2 ? 1 : -1
        let err = dx - dy
        let x = x1
        let y = y1
        const newVal = getPaintValue()
        const maxSteps = mapWidth.value * mapHeight.value
        let steps = 0
        while (steps++ < maxSteps) {
            const i = y * mapWidth.value + x
            arr[i] = newVal
            if (x === x2 && y === y2) break
            const e2 = 2 * err
            if (e2 > -dy) { err -= dy; x += sx }
            if (e2 < dx) { err += dx; y += sy }
        }
        getActiveTiles().value = [...arr]
    }

    // Selection Actions Refactored
    function isTileInSelection(idx) {
        const sel = selection.value
        if (!sel) return false
        const x = idx % mapWidth.value
        const y = Math.floor(idx / mapWidth.value)
        return x >= sel.x1 && x <= sel.x2 && y >= sel.y1 && y <= sel.y2
    }

    function pasteAt(x, y) {
        const clip = clipboard.value
        if (!clip || !clip.tiles?.length) return
        const t2 = clip.tiles2?.length ? clip.tiles2 : Array(clip.w * clip.h).fill(0)
        for (let dy = 0; dy < clip.h; dy++) {
            for (let dx = 0; dx < clip.w; dx++) {
                const ty = y + dy
                const tx = x + dx
                if (tx >= 0 && tx < mapWidth.value && ty >= 0 && ty < mapHeight.value) {
                    const srcIdx = dy * clip.w + dx
                    const dstIdx = ty * mapWidth.value + tx
                    tiles.value[dstIdx] = clip.tiles[srcIdx] ?? 0
                    tiles2.value[dstIdx] = t2[srcIdx] ?? 0
                    collisionMap.value[dstIdx] = !!clip.collision[srcIdx]
                    priorityMap.value[dstIdx] = !!clip.priority[srcIdx]
                }
            }
        }
        tiles.value = [...tiles.value]
        tiles2.value = [...tiles2.value]
        collisionMap.value = [...collisionMap.value]
        priorityMap.value = [...priorityMap.value]
    }

    function duplicateSelection() {
        const sel = selection.value
        if (!sel || !sel.w || !sel.h) return
        copySelection()
        const pasteX = sel.x2 + 1
        const pasteY = sel.y1
        if (pasteX + sel.w > mapWidth.value) {
            const pasteX2 = sel.x1
            const pasteY2 = sel.y2 + 1
            if (pasteY2 + sel.h > mapHeight.value) return
            pushState()
            pasteAt(pasteX2, pasteY2)
            selection.value = { x1: pasteX2, y1: pasteY2, x2: pasteX2 + sel.w - 1, y2: pasteY2 + sel.h - 1, w: sel.w, h: sel.h }
            return
        }
        pushState()
        pasteAt(pasteX, pasteY)
        selection.value = { x1: pasteX, y1: pasteY, x2: pasteX + sel.w - 1, y2: pasteY + sel.h - 1, w: sel.w, h: sel.h }
    }

    function moveSelectionTo(newX1, newY1) {
        const sel = selection.value
        if (!sel || !sel.w || !sel.h) return
        const clip = { w: sel.w, h: sel.h, tiles: [], tiles2: [], collision: [], priority: [] }
        for (let y = sel.y1; y <= sel.y2; y++) {
            for (let x = sel.x1; x <= sel.x2; x++) {
                const i = y * mapWidth.value + x
                clip.tiles.push(tiles.value[i] ?? 0)
                clip.tiles2.push(tiles2.value[i] ?? 0)
                clip.collision.push(!!collisionMap.value[i])
                clip.priority.push(!!priorityMap.value[i])
            }
        }
        for (let y = sel.y1; y <= sel.y2; y++) {
            for (let x = sel.x1; x <= sel.x2; x++) {
                const i = y * mapWidth.value + x
                tiles.value[i] = 0
                tiles2.value[i] = 0
                collisionMap.value[i] = false
                priorityMap.value[i] = false
            }
        }
        clipboard.value = clip
        pasteAt(newX1, newY1)
        tiles.value = [...tiles.value]
        tiles2.value = [...tiles2.value]
        collisionMap.value = [...collisionMap.value]
        priorityMap.value = [...priorityMap.value]
        selection.value = {
            x1: newX1, y1: newY1,
            x2: newX1 + sel.w - 1, y2: newY1 + sel.h - 1,
            w: sel.w, h: sel.h
        }
    }

    function copySelection() {
        const sel = selection.value
        if (!sel || !sel.w || !sel.h) return
        ensureTiles()
        const data = { w: sel.w, h: sel.h, tiles: [], tiles2: [], collision: [], priority: [] }
        for (let y = sel.y1; y <= sel.y2; y++) {
            for (let x = sel.x1; x <= sel.x2; x++) {
                const i = y * mapWidth.value + x
                data.tiles.push(tiles.value[i] ?? 0)
                data.tiles2.push(tiles2.value[i] ?? 0)
                data.collision.push(!!collisionMap.value[i])
                data.priority.push(!!priorityMap.value[i])
            }
        }
        clipboard.value = data
    }

    function pasteSelection() {
        const clip = clipboard.value
        if (!clip || !clip.tiles?.length) return
        const sel = selection.value
        const pasteX = sel ? sel.x1 : 0
        const pasteY = sel ? sel.y1 : 0
        pushState()
        ensureTiles()
        pasteAt(pasteX, pasteY)
        selection.value = { x1: pasteX, y1: pasteY, x2: pasteX + clip.w - 1, y2: pasteY + clip.h - 1, w: clip.w, h: clip.h }
    }

    // Load and Export Logic
    function getRelativeTilesetPath(fullPath) {
        if (!props.projectPath) return fullPath.split(/[/\\]/).pop() || 'tileset.png'
        const base = props.projectPath.replace(/[/\\]+$/, '')
        if (fullPath.startsWith(base)) {
            return fullPath.slice(base.length).replace(/^[/\\]/, '')
        }
        return fullPath.split(/[/\\]/).pop() || 'tileset.png'
    }

    async function loadExisting() {
        const fullPath = currentMapPath.value || (props.asset?.path && props.projectPath ? `${props.projectPath}/${props.asset.path}`.replace(/\/+/g, '/') : null)
        if (!fullPath || !window.retroStudio?.readTextFile) return
        try {
            const content = await window.retroStudio.readTextFile(fullPath)
            const ext = (fullPath || '').toLowerCase()
            let data = null
            if (ext.endsWith('.tmx')) data = fromTMX(content)
            else if (ext.endsWith('.json')) data = fromJSON(content)
            if (data) {
                mapWidthInternal.value = data.width
                mapHeightInternal.value = data.height
                tiles.value = data.tiles || []
                tiles2.value = data.tiles2?.length ? [...data.tiles2] : []
                collisionMap.value = data.collision?.length ? [...data.collision] : []
                priorityMap.value = data.priority?.length ? [...data.priority] : []
                history.value = []
                pushState()
                historyIndex.value = 0
                if (data.tilesetImagePath) {
                    const imgName = data.tilesetImagePath.split(/[/\\]/).pop() || ''
                    const fileDir = fullPath.replace(/[/\\][^/\\]+$/, '')
                    const projPath = props.projectPath || fileDir.replace(/[/\\](?:maps|res)$/, '')
                    const candidates = [
                        `${fileDir}/${imgName}`.replace(/\/+/g, '/'),
                        `${projPath}/src/${imgName}`.replace(/\/+/g, '/'),
                        `${projPath}/res/${imgName}`.replace(/\/+/g, '/')
                    ]

                    let foundPreview = null
                    let finalPath = ''
                    for (const candidate of candidates) {
                        try {
                            const r = await window.retroStudio.retro.getAssetPreview(projPath, candidate)
                            if (r?.success && r.preview) {
                                foundPreview = r.preview
                                finalPath = candidate
                                break
                            }
                        } catch (_) { }
                    }

                    if (foundPreview) {
                        const ts = {
                            id: `ts_${Date.now()}`,
                            name: imgName.replace(/\.[^.]+$/, ''),
                            path: finalPath,
                            preview: foundPreview
                        }
                        userTilesets.value = [ts]
                        selectedTilesetId.value = ts.id
                    }
                }
            }
        } catch (e) {
            console.error('loadExisting:', e)
        }
    }

    async function openMap() {
        const baseDir = (props.projectPath || '').replace(/\/+$/, '')
        const mapsDir = baseDir ? `${baseDir}/maps`.replace(/\/+/g, '/') : undefined
        const result = await window.retroStudio?.retro?.selectFile?.({
            context: 'map-open',
            title: 'Abrir mapa TMX',
            defaultPath: mapsDir || baseDir,
            filters: [{ name: 'TMX', extensions: ['tmx'] }, { name: 'Todos', extensions: ['*'] }]
        })
        if (!result?.success || !result.path) return
        currentMapPath.value = result.path
        await loadExisting()
    }

    async function exportToC() {
        if (!canSave.value || !window.retroStudio?.writeTextFile) return
        const baseDir = (props.projectPath || '').replace(/\/+$/, '')
        const resDir = baseDir ? `${baseDir}/res`.replace(/\/+/g, '/') : undefined
        const result = await window.retroStudio?.retro?.selectSaveFile?.({
            context: 'map-save',
            title: 'Exportar para C',
            defaultPath: resDir || baseDir,
            filters: [{ name: 'C', extensions: ['c', 'h'] }, { name: 'Todos', extensions: ['*'] }]
        })
        if (!result?.success || !result.path) return
        ensureTiles()
        const varName = (result.path.split(/[/\\]/).pop()?.replace(/\.(c|h)$/i, '') || 'map_tiles').replace(/[^a-zA-Z0-9_]/g, '_')
        const cCode = toCArray({ width: mapWidth.value, height: mapHeight.value, tiles: tiles.value }, varName)
        await window.retroStudio.writeTextFile(result.path, cCode)
        window.retroStudioToast?.success?.('Exportado para C')
    }

    async function saveMapAs() {
        if (!canSave.value || !window.retroStudio?.writeTextFile) return
        const baseDir = (props.projectPath || '').replace(/\/+$/, '')
        const mapsDir = baseDir ? `${baseDir}/maps`.replace(/\/+/g, '/') : undefined
        const result = await window.retroStudio?.retro?.selectSaveFile?.({
            context: 'map-save',
            title: 'Salvar mapa como',
            defaultPath: mapsDir ? `${mapsDir}/map.tmx` : baseDir,
            filters: [{ name: 'TMX', extensions: ['tmx'] }, { name: 'Todos', extensions: ['*'] }]
        })
        if (!result?.success || !result.path) return
        currentMapPath.value = result.path
        await doSave(result.path)
    }

    async function saveMap() {
        if (!canSave.value || !window.retroStudio?.writeTextFile) return
        const outPath = currentMapPath.value
        if (!outPath) {
            await saveMapAs()
            return
        }
        await doSave(outPath)
    }

    async function doSave(outPath) {
        const ts = selectedTileset.value
        if (!ts) return
        const relPath = getRelativeTilesetPath(ts.path)
        const imgName = relPath.split(/[/\\]/).pop() || 'tileset.png'
        saving.value = true
        try {
            const parentDir = outPath.replace(/[/\\][^/\\]+$/, '')
            if (parentDir && window.retroStudio?.ensureDirectory) {
                await window.retroStudio.ensureDirectory(parentDir)
            }
            ensureTiles()
            const tmx = toTMX({
                width: mapWidth.value,
                height: mapHeight.value,
                tiles: tiles.value,
                tiles2: tiles2.value,
                tilesetImagePath: imgName,
                tilesetColumns: 16,
                collision: collisionMap.value,
                priority: priorityMap.value
            })
            await window.retroStudio.writeTextFile(outPath, tmx)
            if (props.projectPath && window.retroStudio?.retro?.updateTilemapResourceEntry) {
                const base = props.projectPath.replace(/[/\\]+$/, '')
                const tmxRel = outPath.startsWith(base) ? outPath.slice(base.length).replace(/^[/\\]/, '').replace(/\\/g, '/') : outPath.split(/[/\\]/).pop()
                const mapName = (outPath.split(/[/\\]/).pop()?.replace(/\.tmx$/i, '') || 'map').toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_MAP'
                try {
                    await window.retroStudio.retro.updateTilemapResourceEntry({ projectPath: props.projectPath, tmxRelPath: tmxRel, mapName })
                } catch (_) { }
            }
            emit('saved')
            window.retroStudioToast?.success?.('Tilemap salvo')
        } catch (e) {
            window.retroStudioToast?.error?.(e?.message || 'Erro ao salvar')
        } finally {
            saving.value = false
        }
    }

    function toggleTileAttribute(idx, attr) {
        if (idx < 0) return
        ensureTiles()
        pushState()
        const arr = attr === 'collision' ? collisionMap.value : priorityMap.value
        arr[idx] = !arr[idx]
        if (attr === 'collision') collisionMap.value = [...arr]
        else priorityMap.value = [...arr]
    }

    return {
        // Constants
        TILE_SIZE_CONST,
        PALETTE_ZOOM,
        DRAW_TOOLS,

        // Refs to connect with template elements
        mapCanvas,
        tilesetCanvas,
        mapWrapRef,

        // State
        mapWidth,
        mapHeight,
        tiles,
        tiles2,
        activeLayer,
        zoom,
        selectedTileIndex,
        selectedTilesetId,
        saving,
        isDrawing,
        isMaximized,
        drawTools,
        drawTool,

        showGrid,
        showTileIndices,
        showPaletteIndices,
        showCoords,
        showCollision,
        showPriority,
        hoverCoord,

        collisionMap,
        priorityMap,
        editCollision,
        editPriority,

        dragStart,
        history,
        historyIndex,
        isPanning,
        panStart,

        selection,
        selectionDragEnd,
        clipboard,
        isMovingSelection,
        moveStartInSelection,
        movePreview,

        currentMapPath,
        userTilesets,

        // Computed Properties
        selectedTileset,
        tilesetPreview,
        canSave,
        currentMapName,
        savePathHint,
        canUndo,
        canRedo,

        // Methods
        minimize,
        toggleMaximize,
        ensureTiles,
        pushState,
        undo,
        redo,
        addTileset,
        removeTileset,
        selectTileset,
        getPaintValue,
        getActiveTiles,
        paintTile,
        fillTile,
        paintRect,
        paintLine,
        isTileInSelection,
        pasteAt,
        duplicateSelection,
        moveSelectionTo,
        copySelection,
        pasteSelection,
        loadExisting,
        openMap,
        exportToC,
        saveMapAs,
        saveMap,
        toggleTileAttribute
    }
}
