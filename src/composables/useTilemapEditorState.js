import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { toTMX, fromTMX, fromJSON, toCArray, toCFullExport, TILE_SIZE } from '@/utils/retro/tmxFormat.js'
import {
  COL_DIRS, COL_TYPE, packCollision, normalizeCollisionCell, toggleCollisionCell, hasCollision
} from '@/utils/retro/tmxCollision.js'

export function useTilemapEditorState(props, emit) {
    const { t } = useI18n()
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
    const selectedTilesetId = ref('')
    const saving = ref(false)
    const isDrawing = ref(false)
    const isMaximized = ref(false)
    const fgOpacity = ref(1)
    const objects = ref([])

    // Draw Tools (titles from i18n)
    const DRAW_TOOL_DEFS = [
        { id: 'pencil', icon: '✎', i18nKey: 'tilemap.toolPencil' },
        { id: 'eraser', icon: '⌫', i18nKey: 'tilemap.toolEraser' },
        { id: 'fill', icon: '▤', i18nKey: 'tilemap.toolFill' },
        { id: 'rect', icon: '▭', i18nKey: 'tilemap.toolRect' },
        { id: 'line', icon: '∕', i18nKey: 'tilemap.toolLine' },
        { id: 'select', icon: '▢', i18nKey: 'tilemap.toolSelect' },
        { id: 'object', icon: '❖', i18nKey: 'tilemap.toolObject' }
    ]
    const drawTools = computed(() =>
        DRAW_TOOL_DEFS.map((d) => ({
            id: d.id,
            icon: d.icon,
            title: t(d.i18nKey)
        }))
    )
    const drawTool = ref('pencil')

    // Debug & Overlays
    const showGrid = ref(true)
    const showTileIndices = ref(false)
    const showPaletteIndices = ref(false)
    const showCoords = ref(false)
    const showCollision = ref(true)
    const showPriority = ref(false)
    const showMinimap = ref(false)
    const viewportGuide = ref('H40') // 'off' | 'H40' | 'H32'

    // Viewport tracking for minimap
    const viewport = ref({ x: 0, y: 0, w: 0, h: 0 })

    function setViewportPosition(x, y) {
        if (!mapWrapRef.value) return
        const wrap = mapWrapRef.value

        // Convert map-canvas scaled coordinates back to wrapper scroll coordinates
        // The minimap deals with unscaled pixels based on mapWidth * TILE_SIZE.
        const scale = zoom.value

        const maxScrollX = wrap.scrollWidth - wrap.clientWidth
        const maxScrollY = wrap.scrollHeight - wrap.clientHeight

        let scrollX = x * scale
        let scrollY = y * scale

        scrollX = Math.max(0, Math.min(scrollX, maxScrollX))
        scrollY = Math.max(0, Math.min(scrollY, maxScrollY))

        wrap.scrollLeft = scrollX
        wrap.scrollTop = scrollY

        updateViewport()
    }

    function updateViewport() {
        if (!mapWrapRef.value) return
        const wrap = mapWrapRef.value
        const scale = zoom.value || 1
        viewport.value = {
            x: wrap.scrollLeft / scale,
            y: wrap.scrollTop / scale,
            w: wrap.clientWidth / scale,
            h: wrap.clientHeight / scale
        }
    }

    watch([zoom, mapWidthInternal, mapHeightInternal, showMinimap], () => {
        nextTick(() => { updateViewport() })
    })

    const hoverCoord = ref(null)

    // Attributes
    const collisionMap = ref([])
    const priorityMap = ref([])
    const flipHMap = ref([])
    const flipVMap = ref([])
    const paletteMap = ref([])
    const flipHMap2 = ref([])
    const flipVMap2 = ref([])
    const paletteMap2 = ref([])
    const editCollision = ref(false)
    const editPriority = ref(false)
    const editFlipH = ref(false)
    const editFlipV = ref(false)
    const editPalette = ref(false)
    const showFlips = ref(true)
    const showPaletteOverlay = ref(false)
    const paintFlipH = ref(false)
    const paintFlipV = ref(false)
    const paintPalette = ref(0)
    const paintCollisionDirs = ref(COL_DIRS)
    const paintCollisionType = ref(COL_TYPE.SOLID)
    const stamps = ref([])
    const stampNameDraft = ref('')

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

        const resiteArr = (arr, fill = 0) => {
            const newArr = Array(newW * newH).fill(fill)
            for (let y = 0; y < Math.min(oldH, newH); y++) {
                for (let x = 0; x < Math.min(oldW, newW); x++) {
                    newArr[y * newW + x] = arr[y * oldW + x]
                }
            }
            return newArr
        }

        tiles.value = resiteArr(tiles.value, 0)
        tiles2.value = resiteArr(tiles2.value, 0)
        collisionMap.value = resiteArr(collisionMap.value, 0).map(normalizeCollisionCell)
        priorityMap.value = resiteArr(priorityMap.value, false)
        flipHMap.value = resiteArr(flipHMap.value, false)
        flipVMap.value = resiteArr(flipVMap.value, false)
        paletteMap.value = resiteArr(paletteMap.value, 0)
        flipHMap2.value = resiteArr(flipHMap2.value, false)
        flipVMap2.value = resiteArr(flipVMap2.value, false)
        paletteMap2.value = resiteArr(paletteMap2.value, 0)

        mapWidthInternal.value = newW
        mapHeightInternal.value = newH
    }

    function ensureTiles() {
        const len = mapWidthInternal.value * mapHeightInternal.value
        if (tiles.value.length !== len) tiles.value = Array.from({ length: len }, (_, i) => tiles.value[i] ?? 0)
        if (tiles2.value.length !== len) tiles2.value = Array.from({ length: len }, (_, i) => tiles2.value[i] ?? 0)
        if (collisionMap.value.length !== len) {
            collisionMap.value = Array.from({ length: len }, (_, i) => normalizeCollisionCell(collisionMap.value[i] ?? 0))
        } else {
            collisionMap.value = collisionMap.value.map(normalizeCollisionCell)
        }
        if (priorityMap.value.length !== len) priorityMap.value = Array.from({ length: len }, (_, i) => priorityMap.value[i] ?? false)
        if (flipHMap.value.length !== len) flipHMap.value = Array.from({ length: len }, (_, i) => flipHMap.value[i] ?? false)
        if (flipVMap.value.length !== len) flipVMap.value = Array.from({ length: len }, (_, i) => flipVMap.value[i] ?? false)
        if (paletteMap.value.length !== len) paletteMap.value = Array.from({ length: len }, (_, i) => paletteMap.value[i] ?? 0)
        if (flipHMap2.value.length !== len) flipHMap2.value = Array.from({ length: len }, (_, i) => flipHMap2.value[i] ?? false)
        if (flipVMap2.value.length !== len) flipVMap2.value = Array.from({ length: len }, (_, i) => flipVMap2.value[i] ?? false)
        if (paletteMap2.value.length !== len) paletteMap2.value = Array.from({ length: len }, (_, i) => paletteMap2.value[i] ?? 0)
    }

    function getActiveAttrMaps() {
        if (activeLayer.value === 'fg') {
            return { flipH: flipHMap2, flipV: flipVMap2, palette: paletteMap2 }
        }
        return { flipH: flipHMap, flipV: flipVMap, palette: paletteMap }
    }

    function applyPaintAttrs(indices) {
        const attrs = getActiveAttrMaps()
        let changed = false
        for (const i of indices) {
            if (i < 0 || i >= attrs.flipH.value.length) continue
            if (attrs.flipH.value[i] !== paintFlipH.value) { attrs.flipH.value[i] = paintFlipH.value; changed = true }
            if (attrs.flipV.value[i] !== paintFlipV.value) { attrs.flipV.value[i] = paintFlipV.value; changed = true }
            if (attrs.palette.value[i] !== paintPalette.value) { attrs.palette.value[i] = paintPalette.value; changed = true }
        }
        if (changed) {
            attrs.flipH.value = [...attrs.flipH.value]
            attrs.flipV.value = [...attrs.flipV.value]
            attrs.palette.value = [...attrs.palette.value]
        }
    }

    function clearAttrsAt(indices) {
        const attrs = getActiveAttrMaps()
        for (const i of indices) {
            if (i < 0 || i >= attrs.flipH.value.length) continue
            attrs.flipH.value[i] = false
            attrs.flipV.value[i] = false
            attrs.palette.value[i] = 0
        }
        attrs.flipH.value = [...attrs.flipH.value]
        attrs.flipV.value = [...attrs.flipV.value]
        attrs.palette.value = [...attrs.palette.value]
    }

    // History system
    function pushState() {
        ensureTiles()
        const state = {
            tiles: [...tiles.value],
            tiles2: [...tiles2.value],
            collision: collisionMap.value.map(normalizeCollisionCell),
            priority: [...priorityMap.value],
            flipH: [...flipHMap.value],
            flipV: [...flipVMap.value],
            palette: [...paletteMap.value],
            flipH2: [...flipHMap2.value],
            flipV2: [...flipVMap2.value],
            palette2: [...paletteMap2.value],
            objects: (objects.value || []).map(o => ({ ...o }))
        }
        const idx = historyIndex.value
        history.value = history.value.slice(0, idx + 1)
        history.value.push(state)
        if (history.value.length > HISTORY_MAX) history.value.shift()
        historyIndex.value = history.value.length - 1
    }

    function restoreHistoryState(s) {
        const len = mapWidth.value * mapHeight.value
        tiles.value = [...s.tiles]
        tiles2.value = s.tiles2 ? [...s.tiles2] : Array(len).fill(0)
        collisionMap.value = (s.collision || []).map(normalizeCollisionCell)
        if (collisionMap.value.length < len) {
            collisionMap.value = Array.from({ length: len }, (_, i) => collisionMap.value[i] ?? 0)
        }
        priorityMap.value = [...s.priority]
        flipHMap.value = s.flipH ? [...s.flipH] : Array(len).fill(false)
        flipVMap.value = s.flipV ? [...s.flipV] : Array(len).fill(false)
        paletteMap.value = s.palette ? [...s.palette] : Array(len).fill(0)
        flipHMap2.value = s.flipH2 ? [...s.flipH2] : Array(len).fill(false)
        flipVMap2.value = s.flipV2 ? [...s.flipV2] : Array(len).fill(false)
        paletteMap2.value = s.palette2 ? [...s.palette2] : Array(len).fill(0)
        objects.value = s.objects ? s.objects.map(o => ({ ...o })) : []
    }

    function undo() {
        if (historyIndex.value <= 0) return
        historyIndex.value--
        restoreHistoryState(history.value[historyIndex.value])
    }

    function redo() {
        if (historyIndex.value >= history.value.length - 1) return
        historyIndex.value++
        restoreHistoryState(history.value[historyIndex.value])
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
        const img = new Image()
        img.src = preview
        img.onload = () => {
            const cols = Math.floor(img.width / TILE_SIZE_CONST) || 16
            const rows = Math.ceil(img.height / TILE_SIZE_CONST) || 16
            const count = cols * Math.ceil(img.height / TILE_SIZE_CONST)

            let nextGid = 1
            if (userTilesets.value.length > 0) {
                const maxTs = userTilesets.value.reduce((prev, current) => (prev.firstgid > current.firstgid) ? prev : current)
                const maxCols = maxTs.columns || 16
                // Defaulting to 256 tiles height max if not recorded
                nextGid = maxTs.firstgid + (maxTs.tilecount || (maxCols * Math.ceil(256 / maxCols)))
            }

            const ts = {
                id: `ts_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                name,
                path: fullPath,
                preview,
                firstgid: nextGid,
                columns: cols,
                tilecount: count
            }
            userTilesets.value.push(ts)
            selectedTilesetId.value = ts.id
        }
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
    const selectedTileRegion = ref({ idx: 0, w: 1, h: 1 })

    // Kept for backward compatibility in components until they are fully migrated
    const selectedTileIndex = computed({
        get: () => selectedTileRegion.value.idx,
        set: (val) => { selectedTileRegion.value = { idx: val, w: 1, h: 1 } }
    })

    function getPaintValue(offsetX = 0, offsetY = 0) {
        if (drawTool.value === 'eraser') return 0
        const sel = selectedTileRegion.value
        // Calculate the value from the palette matrix
        const cols = selectedTileset.value ? Math.floor((tilesetCanvas.value?.width || 256) / (TILE_SIZE_CONST * PALETTE_ZOOM)) : 32
        const startX = sel.idx % cols
        const startY = Math.floor(sel.idx / cols)
        const cellX = startX + (offsetX % sel.w)
        const cellY = startY + (offsetY % sel.h)
        const firstgid = selectedTileset.value?.firstgid || 1
        return (cellY * cols + cellX) + firstgid
    }

    function getActiveTiles() {
        return activeLayer.value === 'fg' ? tiles2 : tiles
    }

    function paintTileMatrix(anchorIdx) {
        if (anchorIdx < 0) return
        ensureTiles()
        const arr = getActiveTiles().value
        const sel = selectedTileRegion.value
        const mw = mapWidth.value
        const mh = mapHeight.value
        const ax = anchorIdx % mw
        const ay = Math.floor(anchorIdx / mw)

        let changed = false
        const touched = []
        for (let dy = 0; dy < sel.h; dy++) {
            for (let dx = 0; dx < sel.w; dx++) {
                const tx = ax + dx
                const ty = ay + dy
                if (tx >= 0 && tx < mw && ty >= 0 && ty < mh) {
                    const i = ty * mw + tx
                    const newVal = getPaintValue(dx, dy)
                    if (arr[i] !== newVal) {
                        arr[i] = newVal
                        changed = true
                    }
                    touched.push(i)
                }
            }
        }
        if (changed) getActiveTiles().value = [...arr]
        if (touched.length) {
            if (drawTool.value === 'eraser') clearAttrsAt(touched)
            else applyPaintAttrs(touched)
        }
    }

    function paintTile(idx) {
        paintTileMatrix(idx)
    }

    function placeObject(idx) {
        if (idx < 0) return
        const mw = mapWidth.value
        const ox = idx % mw
        const oy = Math.floor(idx / mw)

        const existingIdx = objects.value.findIndex(o => o.x === ox && o.y === oy)
        pushState()
        if (existingIdx !== -1) {
            // Remove if clicked again
            objects.value.splice(existingIdx, 1)
        } else {
            // Add new object
            objects.value.push({
                id: Date.now(),
                name: `Object_${objects.value.length + 1}`,
                type: 'Entity',
                x: ox,
                y: oy,
                properties: {}
            })
        }
        objects.value = [...objects.value]
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
        const touched = []
        let count = 0
        const maxFill = mapWidth.value * mapHeight.value
        while (stack.length > 0 && count < maxFill) {
            const i = stack.pop()
            if (arr[i] !== targetVal) continue
            arr[i] = newVal
            touched.push(i)
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
        if (drawTool.value === 'eraser' || newVal === 0) clearAttrsAt(touched)
        else applyPaintAttrs(touched)
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
        const touched = []
        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                const i = y * mapWidth.value + x
                arr[i] = newVal
                touched.push(i)
            }
        }
        getActiveTiles().value = [...arr]
        if (drawTool.value === 'eraser' || newVal === 0) clearAttrsAt(touched)
        else applyPaintAttrs(touched)
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
        const touched = []
        while (steps++ < maxSteps) {
            const i = y * mapWidth.value + x
            arr[i] = newVal
            touched.push(i)
            if (x === x2 && y === y2) break
            const e2 = 2 * err
            if (e2 > -dy) { err -= dy; x += sx }
            if (e2 < dx) { err += dx; y += sy }
        }
        getActiveTiles().value = [...arr]
        if (drawTool.value === 'eraser') clearAttrsAt(touched)
        else applyPaintAttrs(touched)
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
        const emptyB = Array(clip.w * clip.h).fill(false)
        const emptyN = Array(clip.w * clip.h).fill(0)
        for (let dy = 0; dy < clip.h; dy++) {
            for (let dx = 0; dx < clip.w; dx++) {
                const ty = y + dy
                const tx = x + dx
                if (tx >= 0 && tx < mapWidth.value && ty >= 0 && ty < mapHeight.value) {
                    const srcIdx = dy * clip.w + dx
                    const dstIdx = ty * mapWidth.value + tx
                    tiles.value[dstIdx] = clip.tiles[srcIdx] ?? 0
                    tiles2.value[dstIdx] = t2[srcIdx] ?? 0
                    collisionMap.value[dstIdx] = normalizeCollisionCell(clip.collision[srcIdx])
                    priorityMap.value[dstIdx] = !!clip.priority[srcIdx]
                    flipHMap.value[dstIdx] = !!(clip.flipH || emptyB)[srcIdx]
                    flipVMap.value[dstIdx] = !!(clip.flipV || emptyB)[srcIdx]
                    paletteMap.value[dstIdx] = (clip.palette || emptyN)[srcIdx] ?? 0
                    flipHMap2.value[dstIdx] = !!(clip.flipH2 || emptyB)[srcIdx]
                    flipVMap2.value[dstIdx] = !!(clip.flipV2 || emptyB)[srcIdx]
                    paletteMap2.value[dstIdx] = (clip.palette2 || emptyN)[srcIdx] ?? 0
                }
            }
        }
        tiles.value = [...tiles.value]
        tiles2.value = [...tiles2.value]
        collisionMap.value = [...collisionMap.value]
        priorityMap.value = [...priorityMap.value]
        flipHMap.value = [...flipHMap.value]
        flipVMap.value = [...flipVMap.value]
        paletteMap.value = [...paletteMap.value]
        flipHMap2.value = [...flipHMap2.value]
        flipVMap2.value = [...flipVMap2.value]
        paletteMap2.value = [...paletteMap2.value]
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
        const clip = {
            w: sel.w, h: sel.h, tiles: [], tiles2: [], collision: [], priority: [],
            flipH: [], flipV: [], palette: [], flipH2: [], flipV2: [], palette2: []
        }
        for (let y = sel.y1; y <= sel.y2; y++) {
            for (let x = sel.x1; x <= sel.x2; x++) {
                const i = y * mapWidth.value + x
                clip.tiles.push(tiles.value[i] ?? 0)
                clip.tiles2.push(tiles2.value[i] ?? 0)
                clip.collision.push(normalizeCollisionCell(collisionMap.value[i]))
                clip.priority.push(!!priorityMap.value[i])
                clip.flipH.push(!!flipHMap.value[i])
                clip.flipV.push(!!flipVMap.value[i])
                clip.palette.push(paletteMap.value[i] ?? 0)
                clip.flipH2.push(!!flipHMap2.value[i])
                clip.flipV2.push(!!flipVMap2.value[i])
                clip.palette2.push(paletteMap2.value[i] ?? 0)
            }
        }
        for (let y = sel.y1; y <= sel.y2; y++) {
            for (let x = sel.x1; x <= sel.x2; x++) {
                const i = y * mapWidth.value + x
                tiles.value[i] = 0
                tiles2.value[i] = 0
                collisionMap.value[i] = 0
                priorityMap.value[i] = false
                flipHMap.value[i] = false
                flipVMap.value[i] = false
                paletteMap.value[i] = 0
                flipHMap2.value[i] = false
                flipVMap2.value[i] = false
                paletteMap2.value[i] = 0
            }
        }
        clipboard.value = clip
        pasteAt(newX1, newY1)
        tiles.value = [...tiles.value]
        tiles2.value = [...tiles2.value]
        collisionMap.value = [...collisionMap.value]
        priorityMap.value = [...priorityMap.value]
        flipHMap.value = [...flipHMap.value]
        flipVMap.value = [...flipVMap.value]
        paletteMap.value = [...paletteMap.value]
        flipHMap2.value = [...flipHMap2.value]
        flipVMap2.value = [...flipVMap2.value]
        paletteMap2.value = [...paletteMap2.value]
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
        const data = {
            w: sel.w, h: sel.h, tiles: [], tiles2: [], collision: [], priority: [],
            flipH: [], flipV: [], palette: [], flipH2: [], flipV2: [], palette2: []
        }
        for (let y = sel.y1; y <= sel.y2; y++) {
            for (let x = sel.x1; x <= sel.x2; x++) {
                const i = y * mapWidth.value + x
                data.tiles.push(tiles.value[i] ?? 0)
                data.tiles2.push(tiles2.value[i] ?? 0)
                data.collision.push(normalizeCollisionCell(collisionMap.value[i]))
                data.priority.push(!!priorityMap.value[i])
                data.flipH.push(!!flipHMap.value[i])
                data.flipV.push(!!flipVMap.value[i])
                data.palette.push(paletteMap.value[i] ?? 0)
                data.flipH2.push(!!flipHMap2.value[i])
                data.flipV2.push(!!flipVMap2.value[i])
                data.palette2.push(paletteMap2.value[i] ?? 0)
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
                collisionMap.value = (data.collision?.length ? data.collision : []).map(normalizeCollisionCell)
                priorityMap.value = data.priority?.length ? [...data.priority] : []
                flipHMap.value = data.flipH?.length ? [...data.flipH] : []
                flipVMap.value = data.flipV?.length ? [...data.flipV] : []
                paletteMap.value = data.palette?.length ? [...data.palette] : []
                flipHMap2.value = data.flipH2?.length ? [...data.flipH2] : []
                flipVMap2.value = data.flipV2?.length ? [...data.flipV2] : []
                paletteMap2.value = data.palette2?.length ? [...data.palette2] : []
                objects.value = data.objects?.length ? [...data.objects] : []
                ensureTiles()
                history.value = []
                pushState()
                historyIndex.value = 0
                if (data.tilesets && data.tilesets.length > 0) {
                    const loadedTilesets = []
                    const fileDir = fullPath.replace(/[/\\][^/\\]+$/, '')
                    const projPath = props.projectPath || fileDir.replace(/[/\\](?:maps|res)$/, '')

                    for (const tsData of data.tilesets) {
                        const imgName = tsData.path.split(/[/\\]/).pop() || ''
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
                                id: `ts_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                name: imgName.replace(/\.[^.]+$/, ''),
                                path: finalPath,
                                preview: foundPreview,
                                firstgid: tsData.firstgid || 1
                            }
                            loadedTilesets.push(ts)
                        }
                    }
                    if (loadedTilesets.length > 0) {
                        userTilesets.value = loadedTilesets
                        selectedTilesetId.value = loadedTilesets[0].id
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
        const varName = (result.path.split(/[/\\]/).pop()?.replace(/\.(c|h)$/i, '') || 'map').replace(/[^a-zA-Z0-9_]/g, '_')
        const cCode = toCFullExport({
            width: mapWidth.value,
            height: mapHeight.value,
            tiles: tiles.value,
            tiles2: tiles2.value,
            flipH: flipHMap.value,
            flipV: flipVMap.value,
            palette: paletteMap.value,
            flipH2: flipHMap2.value,
            flipV2: flipVMap2.value,
            palette2: paletteMap2.value,
            priority: priorityMap.value,
            collision: collisionMap.value
        }, varName)
        await window.retroStudio.writeTextFile(result.path, cCode)
        window.retroStudioToast?.success?.('Exportado para C (BG+FG+collision)')
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
        if (!userTilesets.value || userTilesets.value.length === 0) return
        saving.value = true
        try {
            const parentDir = outPath.replace(/[/\\][^/\\]+$/, '')
            if (parentDir && window.retroStudio?.ensureDirectory) {
                await window.retroStudio.ensureDirectory(parentDir)
            }
            const exportTilesets = userTilesets.value.map(ts => {
                const rPath = getRelativeTilesetPath(ts.path)
                return {
                    name: ts.name,
                    path: rPath.split(/[/\\]/).pop() || 'tileset.png',
                    columns: 16
                }
            })

            ensureTiles()
            const tmx = toTMX({
                width: mapWidth.value,
                height: mapHeight.value,
                tiles: tiles.value,
                tiles2: tiles2.value,
                tilesets: exportTilesets,
                collision: collisionMap.value,
                priority: priorityMap.value,
                flipH: flipHMap.value,
                flipV: flipVMap.value,
                palette: paletteMap.value,
                flipH2: flipHMap2.value,
                flipV2: flipVMap2.value,
                palette2: paletteMap2.value,
                objects: objects.value
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
        if (attr === 'collision') {
            const paint = packCollision(paintCollisionDirs.value, paintCollisionType.value)
            collisionMap.value[idx] = toggleCollisionCell(collisionMap.value[idx], paint)
            collisionMap.value = [...collisionMap.value]
            return
        }
        if (attr === 'priority') {
            priorityMap.value[idx] = !priorityMap.value[idx]
            priorityMap.value = [...priorityMap.value]
            return
        }
        const attrs = getActiveAttrMaps()
        if (attr === 'flipH') {
            attrs.flipH.value[idx] = !attrs.flipH.value[idx]
            attrs.flipH.value = [...attrs.flipH.value]
            return
        }
        if (attr === 'flipV') {
            attrs.flipV.value[idx] = !attrs.flipV.value[idx]
            attrs.flipV.value = [...attrs.flipV.value]
            return
        }
        if (attr === 'palette') {
            attrs.palette.value[idx] = ((attrs.palette.value[idx] || 0) + 1) % 4
            attrs.palette.value = [...attrs.palette.value]
        }
    }

    function setBrushSize(w, h) {
        const sel = selectedTileRegion.value || { idx: 0, w: 1, h: 1 }
        selectedTileRegion.value = { idx: sel.idx || 0, w: Math.max(1, w | 0), h: Math.max(1, h | 0) }
    }

    function cycleViewportGuide() {
        const order = ['off', 'H40', 'H32']
        const i = order.indexOf(viewportGuide.value)
        viewportGuide.value = order[(i + 1) % order.length]
    }

    function togglePaintCollisionDir(bit) {
        paintCollisionDirs.value ^= bit
        if (!(paintCollisionDirs.value & COL_DIRS)) paintCollisionDirs.value = COL_DIRS
    }

    function cyclePaintCollisionType() {
        paintCollisionType.value = (paintCollisionType.value + 1) % 6
        if (paintCollisionType.value === COL_TYPE.NONE) paintCollisionType.value = COL_TYPE.SOLID
    }

    function stampsStorageKey() {
        const base = (props.projectPath || 'global').replace(/[/\\]/g, '_')
        return `retro-studio-map-stamps:${base}`
    }

    function loadStamps() {
        try {
            const raw = localStorage.getItem(stampsStorageKey())
            stamps.value = raw ? JSON.parse(raw) : []
            if (!Array.isArray(stamps.value)) stamps.value = []
        } catch {
            stamps.value = []
        }
    }

    function persistStamps() {
        try {
            localStorage.setItem(stampsStorageKey(), JSON.stringify(stamps.value))
        } catch { /* ignore */ }
    }

    function saveStampFromSelection() {
        const sel = selection.value
        if (!sel || !sel.w || !sel.h) {
            window.retroStudioToast?.warning?.('Selecione uma região no mapa primeiro')
            return
        }
        const name = (stampNameDraft.value || `stamp_${stamps.value.length + 1}`).trim()
        ensureTiles()
        const data = {
            id: `st_${Date.now()}`,
            name,
            w: sel.w,
            h: sel.h,
            tiles: [],
            tiles2: [],
            collision: [],
            priority: [],
            flipH: [],
            flipV: [],
            palette: [],
            flipH2: [],
            flipV2: [],
            palette2: []
        }
        for (let y = sel.y1; y <= sel.y2; y++) {
            for (let x = sel.x1; x <= sel.x2; x++) {
                const i = y * mapWidth.value + x
                data.tiles.push(tiles.value[i] ?? 0)
                data.tiles2.push(tiles2.value[i] ?? 0)
                data.collision.push(normalizeCollisionCell(collisionMap.value[i]))
                data.priority.push(!!priorityMap.value[i])
                data.flipH.push(!!flipHMap.value[i])
                data.flipV.push(!!flipVMap.value[i])
                data.palette.push(paletteMap.value[i] ?? 0)
                data.flipH2.push(!!flipHMap2.value[i])
                data.flipV2.push(!!flipVMap2.value[i])
                data.palette2.push(paletteMap2.value[i] ?? 0)
            }
        }
        stamps.value = [...stamps.value.filter((s) => s.name !== name), data]
        persistStamps()
        stampNameDraft.value = ''
        window.retroStudioToast?.success?.(`Stamp salvo: ${name}`)
    }

    function placeStampAt(stamp, idx) {
        if (!stamp || idx < 0) return
        ensureTiles()
        pushState()
        clipboard.value = { ...stamp }
        const x = idx % mapWidth.value
        const y = Math.floor(idx / mapWidth.value)
        pasteAt(x, y)
        selection.value = { x1: x, y1: y, x2: x + stamp.w - 1, y2: y + stamp.h - 1, w: stamp.w, h: stamp.h }
    }

    function deleteStamp(id) {
        stamps.value = stamps.value.filter((s) => s.id !== id)
        persistStamps()
    }

    loadStamps()

    return {
        // Constants
        TILE_SIZE_CONST,
        PALETTE_ZOOM,

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
        fgOpacity,
        objects, // Added objects to export list
        drawTools,
        drawTool,

        showGrid,
        showTileIndices,
        showPaletteIndices,
        showCoords,
        showCollision,
        showPriority,
        showFlips,
        showPaletteOverlay,
        showMinimap,
        viewportGuide,
        viewport,
        hoverCoord,

        collisionMap,
        priorityMap,
        flipHMap,
        flipVMap,
        paletteMap,
        flipHMap2,
        flipVMap2,
        paletteMap2,
        editCollision,
        editPriority,
        editFlipH,
        editFlipV,
        editPalette,
        paintFlipH,
        paintFlipV,
        paintPalette,
        paintCollisionDirs,
        paintCollisionType,
        stamps,
        stampNameDraft,

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
        selectedTileRegion,

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
        placeObject,
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
        toggleTileAttribute,
        setBrushSize,
        cycleViewportGuide,
        togglePaintCollisionDir,
        cyclePaintCollisionType,
        saveStampFromSelection,
        placeStampAt,
        deleteStamp,
        COL_TOP: 0x01,
        COL_BOTTOM: 0x02,
        COL_LEFT: 0x04,
        COL_RIGHT: 0x08,
        COL_DIRS,
        COL_TYPE,
        hasCollision,
        fgOpacity,
        setViewportPosition,
        updateViewport
    }
}
