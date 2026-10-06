import { useMapPackAuthoring } from './useMapPackAuthoring.js'
import { useCutsceneAuthoring } from './useCutsceneAuthoring.js'
import { ref, computed, watch, nextTick, markRaw, onScopeDispose } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseAssetPack, brushCells, relativeImagePath, normalizeAssetPath, inferObjectCategory } from '@/utils/retro/tilemapAssetPack.js'
import { readRecentTilemaps, rememberRecentTilemap, forgetRecentTilemap, clearRecentTilemaps } from '@/utils/retro/recentTilemaps.js'
import { readRecentTilemapKits, rememberRecentTilemapKit, forgetRecentTilemapKit, clearRecentTilemapKits } from '@/utils/retro/recentTilemapKits.js'
import { estimateMapVram } from '@/utils/retro/mapVramEstimate.js'
import { toTMX, fromTMX, fromJSON, toCFullExport, TILE_SIZE } from '@/utils/retro/tmxFormat.js'
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
    const musicTrack = ref('')
    const musicTracks = ref([])
    const musicPreviewUrl = ref('')
    const musicPreviewLoading = ref(false)
    const musicPreviewError = ref('')
    let musicPreviewRequest = 0
    const exportFailure = ref(null)
    const isDrawing = ref(false)
    const isMaximized = ref(false)
    const fgOpacity = ref(1)
    const objects = ref([])
    const previewAnimations = ref(true)
    const previewClock = ref(0)
    const assetPack = ref(null)
    const assetPackPath = ref('')
    const assetPackMaps = ref([])
    const assetPackTilesets = ref({})
    const selectedPackBrush = ref(null)
    const packLoading = ref(false)
    const selectedObjectId = ref(null)
    const objectTemplateIndex = ref(0)
    const selectedObject = computed(() => objects.value.find(o => o.id === selectedObjectId.value) || null)
    const objectTemplates = computed(() => assetPack.value?.objects?.map(object => ({ ...object, category: object.category || inferObjectCategory(object) })) || [
        { name: 'Spawn', type: 'player_spawn', category: 'marker', width: 2, height: 5, properties: {} },
        { name: 'Cat', type: 'ability_cat', category: 'interaction', width: 3, height: 5, properties: { ability: 'double_jump' } },
        { name: 'Enemy', type: 'enemy', category: 'enemy', width: 3, height: 3, properties: { kind: 'slime' } },
        { name: 'Exit', type: 'room_exit', category: 'interaction', width: 3, height: 6, properties: { target: '', requires: 'double_jump' } }
    ])

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
    const pendingStamp = ref(null)

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
    const recentMaps = ref(readRecentTilemaps())
    const recentKits = ref(readRecentTilemapKits())
    const backgroundImage = ref(null)
    const parallaxLayers = ref([])
    const vramEstimate = computed(() => estimateMapVram({ tilesets: userTilesets.value, background: backgroundImage.value, parallaxLayers: parallaxLayers.value }))
    const userTilesets = ref([])

    // Computed Properties
    const selectedTileset = computed(() => userTilesets.value.find((t) => t.id === selectedTilesetId.value))
    const tilesetPreview = computed(() => selectedTileset.value?.preview ?? null)
    const canSave = computed(() => selectedTileset.value && userTilesets.value.length > 0)
    const currentMapName = computed(() => {
        if (currentMapPath.value) {
            return currentMapPath.value.split(/[/\\]/).pop()?.replace(/\.tmx$/i, '') || 'Mapa'
        }
        return props.asset?.name || t('tilemap.untitledMap')
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

    function resolveMapAssetPath(mapPath, assetPath) {
        const normalized = normalizeAssetPath(assetPath || '')
        if (normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) return normalized
        const directory = String(mapPath || '').replace(/[/\\][^/\\]*$/, '')
        return normalizeAssetPath(`${directory}/${normalized}`)
    }

    function readPreviewDimensions(preview) {
        if (!preview || typeof Image === 'undefined') return Promise.resolve({ width: 0, height: 0 })
        return new Promise(resolve => {
            const image = new Image()
            image.onload = () => resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 })
            image.onerror = () => resolve({ width: 0, height: 0 })
            image.src = preview
        })
    }

    async function setBackgroundImage(background, mapPath = currentMapPath.value) {
        if (!background?.path) {
            backgroundImage.value = null
            return
        }
        const fullPath = resolveMapAssetPath(mapPath, background.path)
        let preview = ''
        try {
            const result = await window.retroStudio?.retro?.getAssetPreview?.(props.projectPath, fullPath)
            if (result?.success) preview = result.preview
        } catch (error) {
            console.warn('Could not load map background:', error)
        }
        const dimensions = await readPreviewDimensions(preview)
        backgroundImage.value = {
            path: fullPath,
            preview,
            ...dimensions,
            fit: ['cover', 'contain', 'stretch', 'repeat', 'repeat-x', 'repeat-y'].includes(background.fit) ? background.fit : 'cover',
            opacity: Math.max(0, Math.min(1, Number(background.opacity ?? 1)))
        }
    }

    async function chooseBackgroundImage() {
        const result = await window.retroStudio?.retro?.selectFile?.({
            context: 'map-background',
            title: t('tilemap.background.choose'),
            defaultPath: normalizeAssetPath(props.projectPath || '') || undefined,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
        })
        if (!result?.success || !result.path) return
        await setBackgroundImage({ path: result.path, fit: backgroundImage.value?.fit || 'cover', opacity: backgroundImage.value?.opacity ?? 1 }, result.path)
    }

    function clearBackgroundImage() {
        backgroundImage.value = null
    }

    function updateBackgroundOption(key, value) {
        if (!backgroundImage.value || !['fit', 'opacity'].includes(key)) return
        backgroundImage.value = {
            ...backgroundImage.value,
            [key]: key === 'opacity' ? Math.max(0, Math.min(1, Number(value) || 0)) : value
        }
    }

    async function addParallaxLayer() {
        const result = await window.retroStudio?.retro?.selectFile?.({
            context: 'map-background', title: t('tilemap.parallax.choose'),
            defaultPath: normalizeAssetPath(props.projectPath || '') || undefined,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
        })
        if (!result?.success || !result.path) return
        const layer = { id: `parallax-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, path: result.path, factorX: 0.5, factorY: 1, fit: 'cover', opacity: 1 }
        await loadParallaxLayer(layer, result.path)
        parallaxLayers.value = [...parallaxLayers.value, layer]
    }

    async function loadParallaxLayer(layer, mapPath = currentMapPath.value) {
        if (!layer?.path) return null
        const fullPath = resolveMapAssetPath(mapPath, layer.path)
        let preview = ''
        try {
            const result = await window.retroStudio?.retro?.getAssetPreview?.(props.projectPath, fullPath)
            if (result?.success) preview = result.preview
        } catch (error) { console.warn('Could not load parallax layer:', error) }
        const dimensions = await readPreviewDimensions(preview)
        return { ...layer, ...dimensions, id: layer.id || `parallax-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, path: fullPath, preview,
            factorX: Math.max(0, Math.min(2, Number(layer.factorX ?? 0.5))),
            factorY: Math.max(0, Math.min(2, Number(layer.factorY ?? 1))),
            fit: ['cover', 'contain', 'stretch', 'repeat', 'repeat-x', 'repeat-y'].includes(layer.fit) ? layer.fit : 'cover',
            opacity: Math.max(0, Math.min(1, Number(layer.opacity ?? 1))) }
    }

    function updateParallaxLayer(id, key, value) {
        parallaxLayers.value = parallaxLayers.value.map(layer => layer.id !== id ? layer : ({ ...layer,
            [key]: key === 'factorX' || key === 'factorY' || key === 'opacity' ? Math.max(0, Math.min(key === 'opacity' ? 1 : 2, Number(value) || 0)) : value }))
    }

    function removeParallaxLayer(id) { parallaxLayers.value = parallaxLayers.value.filter(layer => layer.id !== id) }
    function moveParallaxLayer(id, delta) {
        const layers = [...parallaxLayers.value]
        const index = layers.findIndex(layer => layer.id === id)
        const next = index + delta
        if (index < 0 || next < 0 || next >= layers.length) return
        ;[layers[index], layers[next]] = [layers[next], layers[index]]
        parallaxLayers.value = layers
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
        newW = Math.round(Number(newW)) || mapWidthInternal.value
        newH = Math.round(Number(newH)) || mapHeightInternal.value
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
        } else if (collisionMap.value.some(v => normalizeCollisionCell(v) !== v)) {
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
    function snapshot() {
        return {
            width: mapWidthInternal.value, height: mapHeightInternal.value,
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
            objects: (objects.value || []).map(o => ({ ...o, properties: { ...o.properties } })),
            musicTrack: musicTrack.value
        }
    }

    function sameSnapshot(a, b) { return JSON.stringify(a) === JSON.stringify(b) }
    function pushState() {
        ensureTiles()
        const state = snapshot()
        const idx = historyIndex.value
        history.value = history.value.slice(0, idx + 1)
        if (sameSnapshot(state, history.value[idx])) return
        history.value.push(state)
        if (history.value.length > HISTORY_MAX) history.value.shift()
        historyIndex.value = history.value.length - 1
    }

    function restoreHistoryState(s) {
        mapWidthInternal.value = s.width || mapWidthInternal.value
        mapHeightInternal.value = s.height || mapHeightInternal.value
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
        objects.value = s.objects ? s.objects.map(o => ({ ...o, properties: { ...o.properties } })) : []
        musicTrack.value = s.musicTrack || ''
    }

    function undo() {
        if (!sameSnapshot(snapshot(), history.value[historyIndex.value])) pushState()
        if (historyIndex.value <= 0) return
        historyIndex.value--
        restoreHistoryState(history.value[historyIndex.value])
    }

    function redo() {
        if (historyIndex.value >= history.value.length - 1) return
        historyIndex.value++
        restoreHistoryState(history.value[historyIndex.value])
    }

    const canUndo = computed(() => historyIndex.value > 0 || !sameSnapshot(snapshot(), history.value[historyIndex.value]))
    const canRedo = computed(() => historyIndex.value < history.value.length - 1 && history.value.length > 0)

    // Tileset Operations
    function isImageAssetPath(filePath) {
        return /\.(png|jpe?g|gif|bmp)$/i.test(filePath || '')
    }

    async function addTilesetFromPath(fullPath, { select = true } = {}) {
        if (!fullPath) return null
        fullPath = normalizeAssetPath(fullPath)
        const name = fullPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'tileset'
        let preview = null
        try {
            const r = await window.retroStudio?.retro?.getAssetPreview?.(props.projectPath, fullPath)
            preview = r?.success ? r.preview : null
        } catch (_) { }
        if (!preview) {
            window.retroStudioToast?.error?.(t('tilemap.tilesetLoadError'))
            return null
        }

        return await new Promise((resolve) => {
            const img = new Image()
            img.onload = () => {
                const cols = Math.floor(img.width / TILE_SIZE_CONST) || 16
                const count = cols * Math.ceil(img.height / TILE_SIZE_CONST)

                let nextGid = 1
                if (userTilesets.value.length > 0) {
                    const maxTs = userTilesets.value.reduce((prev, current) => (prev.firstgid > current.firstgid) ? prev : current)
                    const maxCols = maxTs.columns || 16
                    nextGid = maxTs.firstgid + (maxTs.tilecount || (maxCols * Math.ceil(256 / maxCols)))
                }

                const ts = {
                    id: `ts_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    name,
                    path: fullPath,
                    preview,
                    firstgid: nextGid,
                    columns: cols,
                    tilecount: count,
                    _img: markRaw(img)
                }
                userTilesets.value = [...userTilesets.value, ts]
                if (select) {
                    selectedTilesetId.value = ts.id
                    selectedTileRegion.value = { idx: 0, w: 1, h: 1 }
                    drawTool.value = 'pencil'
                    clearAttrEdits()
                }
                resolve(ts)
            }
            img.onerror = () => {
                window.retroStudioToast?.error?.(t('tilemap.tilesetLoadError'))
                resolve(null)
            }
            img.src = preview
        })
    }

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
        await addTilesetFromPath(result.path)
    }

    function clearAttrEdits() {
        editCollision.value = false
        editPriority.value = false
        editFlipH.value = false
        editFlipV.value = false
        editPalette.value = false
    }

    function selectDrawTool(toolId) {
        selectedPackBrush.value = null
        drawTool.value = toolId
        clearAttrEdits()
        if (toolId !== 'select') {
            selection.value = null
            selectionDragEnd.value = null
            isMovingSelection.value = false
            movePreview.value = null
        }
        if (toolId !== 'pencil' && toolId !== 'fill' && toolId !== 'rect' && toolId !== 'line') {
            pendingStamp.value = null
        }
    }

    function removeTileset(ts) {
        userTilesets.value = userTilesets.value.filter((t) => t.id !== ts.id)
        if (selectedTilesetId.value === ts.id) {
            selectedTilesetId.value = userTilesets.value[0]?.id || ''
        }
    }

    function selectTileset(ts) {
        selectedPackBrush.value = null
        selectedTilesetId.value = ts.id
        selectedTileRegion.value = { idx: 0, w: 1, h: 1 }
        drawTool.value = 'pencil'
        clearAttrEdits()
    }

    // Paint / Draw Action Logic Shared State
    const selectedTileRegion = ref({ idx: 0, w: 1, h: 1 })

    // Kept for backward compatibility in components until they are fully migrated
    const selectedTileIndex = computed({
        get: () => selectedTileRegion.value.idx,
        set: (val) => { selectedTileRegion.value = { idx: val, w: 1, h: 1 } }
    })

    function getTilesetColumns(ts = selectedTileset.value) {
        // Sempre preferir a largura real da imagem — ts.columns pode vir errado do TMX (ex.: 16)
        const natW = ts?._img?.naturalWidth || 0
        if (natW > 0) {
            const cols = Math.floor(natW / TILE_SIZE_CONST) || 1
            if (ts && ts.columns !== cols) ts.columns = cols
            return cols
        }
        if (ts?.columns > 0) return ts.columns
        const el = tilesetCanvas.value
        const elW = el?.naturalWidth || 0
        if (elW > 0) return Math.floor(elW / TILE_SIZE_CONST) || 16
        return 16
    }

    function getPaintValue(offsetX = 0, offsetY = 0) {
        if (drawTool.value === 'eraser') return 0
        const sel = selectedTileRegion.value
        const cols = getTilesetColumns()
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
        if (selectedPackBrush.value) { paintAssetBrush(anchorIdx); return }
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
        if (changed || touched.length) getActiveTiles().value = [...arr]
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
        const x = idx % mapWidth.value, y = Math.floor(idx / mapWidth.value)
        const existing = [...objects.value].reverse().find(o => x >= o.x && y >= o.y && x < o.x + (o.width || 1) && y < o.y + (o.height || 1))
        if (existing) { selectedObjectId.value = existing.id; return }
        const template = objectTemplates.value[objectTemplateIndex.value] || objectTemplates.value[0]
        if (!template) return
        pushState()
        const id = Math.max(0, ...objects.value.map(o => Number(o.id) || 0)) + 1
        const visual = template.visual ? { ...template.visual } : null
        if (visual?.tileset) {
            const sourcePath = assetPackTilesets.value[visual.tileset]
            const ts = userTilesets.value.find(item => item.path === sourcePath)
            if (ts) {
                visual.gid = (ts.firstgid || 1) + visual.y * (ts.columns || 16) + visual.x
                visual.width = visual.w
                visual.height = visual.h
                delete visual.tileset
                delete visual.tilesetId
                delete visual.x
                delete visual.y
                delete visual.w
                delete visual.h
            }
        }
        objects.value = [...objects.value, { ...template, ...(visual ? { visual } : {}), id, x, y, animationStart: previewClock.value, properties: { ...template.properties } }]
        selectedObjectId.value = id
    }

    function updateSelectedObject(field, value) {
        const obj = selectedObject.value
        const offsetField = field
        if (!obj || !['name', 'type', 'x', 'y', 'width', 'height', 'properties', 'spriteOffsetX', 'spriteOffsetY'].includes(field)) return
        if (['x', 'y', 'width', 'height'].includes(field)) {
            value = Math.round(Number(value))
            if (!Number.isFinite(value)) return
            value = Math.max(field === 'width' || field === 'height' ? 1 : 0, value)
        }
        if (field === 'spriteOffsetX' || field === 'spriteOffsetY') {
            value = Math.round(Number(value))
            if (!Number.isFinite(value)) return
            value = Math.max(-32, Math.min(32, value))
            field = 'properties'
            value = { ...(obj.properties || {}), [offsetField]: value }
        }
        if (field === 'properties') {
            try {
                if (typeof value === 'string') value = JSON.parse(value)
                if (!value || Array.isArray(value) || typeof value !== 'object' || Object.values(value).some(v => !['string','number','boolean'].includes(typeof v))) throw Error()
            } catch { window.retroStudioToast?.error?.(t('tilemap.pack.invalidProperties')); return }
        }
        pushState()
        objects.value = objects.value.map(o => o.id === obj.id ? { ...o, [field]: value } : o)
    }

    function moveSelectedObjectTo(x, y) {
        const obj = selectedObject.value
        if (!obj) return
        x = Math.max(0, Math.min(mapWidth.value - (obj.width || 1), Math.round(x)))
        y = Math.max(0, Math.min(mapHeight.value - (obj.height || 1), Math.round(y)))
        if (obj.x === x && obj.y === y) return
        pushState()
        objects.value = objects.value.map(o => o.id === obj.id ? { ...o, x, y } : o)
    }

    function deleteSelectedObject() {
        if (!selectedObject.value) return
        pushState()
        objects.value = objects.value.filter(o => o.id !== selectedObjectId.value)
        selectedObjectId.value = null
    }

    function selectPackBrush(brush) {
        selectDrawTool('pencil')
        pendingStamp.value = null
        selectedPackBrush.value = brush
        activeLayer.value = brush.layer
    }

    function paintAssetBrush(idx) {
        if (idx < 0) return
        const b = selectedPackBrush.value
        const path = assetPackTilesets.value[b.tileset]
        const ts = userTilesets.value.find(ts => ts.path === path)
        if (!ts) return
        const cells = brushCells(b, ts)
        const ax = Math.floor((idx % mapWidth.value) / b.w) * b.w
        const ay = Math.floor(Math.floor(idx / mapWidth.value) / b.h) * b.h
        const target = b.layer === 'fg' ? tiles2 : tiles
        const attrs = b.layer === 'fg' ? { flipH: flipHMap2, flipV: flipVMap2, palette: paletteMap2 } : { flipH: flipHMap, flipV: flipVMap, palette: paletteMap }
        for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
            if (ax+x >= mapWidth.value || ay+y >= mapHeight.value) continue
            const i = (ay+y)*mapWidth.value+ax+x
            target.value[i] = cells[y*b.w+x]
            attrs.flipH.value[i] = false; attrs.flipV.value[i] = false; attrs.palette.value[i] = b.palette || 0
            if (b.collision === 'solid') collisionMap.value[i] = packCollision(COL_DIRS, COL_TYPE.SOLID)
            else if (b.collision === 'top') collisionMap.value[i] = y === 0 ? packCollision(1, COL_TYPE.SOLID) : 0
            else if (b.collision === 'damage') collisionMap.value[i] = packCollision(COL_DIRS, COL_TYPE.DAMAGE)
            else if (b.layer === 'bg') collisionMap.value[i] = 0
        }
        target.value = [...target.value]
        collisionMap.value = [...collisionMap.value]
    }

    async function loadAssetPackFile(packPath) {
        if (!packPath || !window.retroStudio?.readTextFile) return false
        packLoading.value = true
        assetPackMaps.value = []
        const originalTilesets = [...userTilesets.value]
        const previousPackPaths = new Set(Object.values(assetPackTilesets.value))
        try {
            userTilesets.value = originalTilesets.filter(ts => !previousPackPaths.has(ts.path))
            const pack = parseAssetPack(await window.retroStudio.readTextFile(packPath))
            pack.objects = pack.objects.map(object => ({ ...object, category: object.category || inferObjectCategory(object) }))
            const base = packPath.replace(/[/\\][^/\\]+$/, '')
            try { await window.retroStudio.ensureDirectory?.(normalizeAssetPath(`${base}/maps`)) } catch (error) {
                console.warn('Could not create the kit maps folder:', error)
            }
            const paths = {}
            for (const item of pack.tilesets) {
                const fullPath = normalizeAssetPath(`${base}/${item.file}`)
                const ts = userTilesets.value.find(ts => ts.path === fullPath) || await addTilesetFromPath(fullPath, { select: false })
                if (!ts) throw new Error(t('tilemap.tilesetLoadError'))
                for (const brush of pack.brushes.filter(b => b.tileset === item.id)) brushCells(brush, ts)
                paths[item.id] = fullPath
            }
            const maps = await window.retroStudio?.retro?.listTilemapPackMaps?.(base, packPath) || []
            assetPack.value = pack
            assetPackPath.value = packPath
            assetPackMaps.value = maps
            recentKits.value = rememberRecentTilemapKit(packPath, pack.name)
            packAuthor.resetDraft()
            packAuthor.savedPath.value = ''
            packAuthor.authoring.value = false
            assetPackTilesets.value = paths
            selectedTilesetId.value = userTilesets.value[0]?.id || ''
            selectedPackBrush.value = null
            objectTemplateIndex.value = 0
            window.retroStudioToast?.success?.(t('tilemap.pack.loaded', { name: pack.name }))
            return true
        } catch (e) {
            userTilesets.value = originalTilesets
            window.retroStudioToast?.error?.(`${t('tilemap.pack.loadError')}: ${e.message}`)
            return false
        } finally { packLoading.value = false }
    }

    async function importAssetPack() {
        const result = await window.retroStudio?.retro?.selectFile?.({
            context: 'map-kit-import', title: t('tilemap.pack.import'),
            defaultPath: normalizeAssetPath(props.projectPath || '') || undefined,
            filters: [{ name: 'Retro Studio map pack', extensions: ['json'] }]
        })
        if (!result?.success || !result.path) return
        await loadAssetPackFile(result.path)
    }

    async function openRecentKit(kit) {
        if (!kit?.path) return false
        const loaded = await loadAssetPackFile(kit.path)
        if (!loaded) recentKits.value = forgetRecentTilemapKit(kit.path)
        return loaded
    }

    function removeRecentKit(kit) {
        if (kit?.path) recentKits.value = forgetRecentTilemapKit(kit.path)
    }

    function clearRecentKits() { recentKits.value = clearRecentTilemapKits() }

    async function rememberSavedKit(filePath, name) {
        recentKits.value = rememberRecentTilemapKit(filePath, name)
        const base = filePath.replace(/[/\\][^/\\]+$/, '')
        assetPackMaps.value = await window.retroStudio?.retro?.listTilemapPackMaps?.(base, filePath) || []
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

    async function loadMusicCatalog() {
        const root = String(props.projectPath || '').replace(/\/+$/, '')
        const read = window.retroStudio?.readTextFile
        if (!root || !read) return
        for (const path of [`${root}/audio/soundtrack/catalog.json`, `${root}/tools/soundtrack-catalog.json`]) {
            try {
                const parsed = JSON.parse(await read(path))
                if (Array.isArray(parsed)) {
                    musicTracks.value = parsed.filter(track => typeof track?.id === 'string' && typeof track?.name === 'string')
                    if (musicTracks.value.length) return
                }
            } catch { /* Try SGDK declarations if there is no JSON catalog. */ }
        }
        try {
            const resources = await read(`${root}/res/resources.res`)
            musicTracks.value = resources.split('\n').filter(line => line.trim().startsWith('XGM ')).map(line => {
                const parts = line.trim().split(' ').filter(Boolean)
                const id = parts[1]?.startsWith('bgm_') ? parts[1].slice(4) : parts[1]
                const file = (parts[2] || '').replace(/["']/g, '')
                return { id: id.replace(/_/g, '-'), name: file.split('/').pop().replace('.vgm', '').replace(/[-_]/g, ' ') }
            })
        } catch { musicTracks.value = [] }
    }

    function setMusicTrack(trackId) {
        if (trackId === musicTrack.value) return
        pushState()
        musicTrack.value = trackId
        return loadMusicPreview(trackId)
    }

    function stopMusicPreview() {
        musicPreviewRequest++
        musicPreviewLoading.value = false
        musicPreviewUrl.value = ''
    }

    async function loadMusicPreview(id = musicTrack.value) {
        stopMusicPreview()
        musicPreviewError.value = ''
        if (!id) {
            return
        }
        const track = musicTracks.value.find(item => item.id === id)
        if (!track) {
            musicPreviewError.value = 'A faixa selecionada não está no catálogo do projeto.'
            return
        }
        const request = musicPreviewRequest
        musicPreviewLoading.value = true
        const candidates = [track.preview, `audio/soundtrack/${id}-preview.ogg`, `audio/furnace/${id}-preview.ogg`].filter(Boolean)
        let preview = null
        for (const assetPath of candidates) {
            try {
                const result = await window.retroStudio?.retro?.getAssetPreview?.(props.projectPath, assetPath)
                if (request !== musicPreviewRequest) return
                if (result?.success && result.preview?.startsWith('data:audio/')) {
                    preview = result.preview
                    break
                }
            } catch { /* Continue with the next conventional preview path. */ }
        }
        if (request !== musicPreviewRequest) return
        if (!preview) {
            musicPreviewLoading.value = false
            musicPreviewError.value = 'Não encontrei uma prévia OGG, WAV ou MP3 para esta faixa.'
            return
        }
        musicPreviewUrl.value = preview
        musicPreviewLoading.value = false
    }
    onScopeDispose(() => { musicPreviewRequest++ })

    async function loadExisting() {
        await loadMusicCatalog()
        const fullPath = currentMapPath.value || (props.asset?.path && props.projectPath ? `${props.projectPath}/${props.asset.path}`.replace(/\/+/g, '/') : null)
        if (!fullPath) return false

        try {
            const knownKitMap = assetPackMaps.value.some(map => normalizeAssetPath(map.path) === normalizeAssetPath(fullPath))
            const packPath = knownKitMap ? assetPackPath.value
                : await window.retroStudio?.retro?.findTilemapPackForMap?.(fullPath)
            if (packPath && packPath !== assetPackPath.value) {
                const loadedPack = await loadAssetPackFile(packPath)
                if (!loadedPack) console.warn('The kit associated with this map could not be loaded:', packPath)
            } else if (!packPath) {
                console.info('No map kit was found beside this map:', fullPath)
            }
        } catch (error) {
            console.warn('Could not locate the map kit:', error)
        }

        // Imagem (PNG etc.) não é mapa TMX — vira tileset de um mapa novo em branco
        if (isImageAssetPath(fullPath)) {
            currentMapPath.value = null
            ensureTiles()
            history.value = []
            pushState()
            historyIndex.value = 0
            await addTilesetFromPath(fullPath)
            window.retroStudioToast?.success?.(t('tilemap.tilesetFromImage'))
            return false
        }

        if (!window.retroStudio?.readTextFile) return false
        try {
            const content = await window.retroStudio.readTextFile(fullPath)
            const ext = (fullPath || '').toLowerCase()
            let data = null
            if (ext.endsWith('.tmx')) data = fromTMX(content)
            else if (ext.endsWith('.json')) data = fromJSON(content)
            if (data) {
                recentMaps.value = rememberRecentTilemap(fullPath)
                await setBackgroundImage(data.background, fullPath)
                parallaxLayers.value = await Promise.all((data.parallaxLayers || []).slice(0, 8).map(layer => loadParallaxLayer(layer, fullPath)))
                selectedPackBrush.value = null
                musicTrack.value = typeof data.musicTrack === 'string' ? data.musicTrack : ''
                await loadMusicPreview(musicTrack.value)
                selectedObjectId.value = null
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
                objects.value = data.objects?.length ? data.objects.map(object => ({ ...object, animationStart: previewClock.value })) : []
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
                            `${fileDir}/${tsData.path}`.replace(/\\/g, '/'),
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
                                    finalPath = normalizeAssetPath(candidate)
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
                                firstgid: tsData.firstgid || 1,
                                columns: tsData.columns || 16,
                                tilecount: tsData.tilecount || 0
                            }
                            loadedTilesets.push(ts)
                        }
                    }
                    if (loadedTilesets.length > 0) {
                        const kitPaths = new Set(Object.values(assetPackTilesets.value))
                        const kitTilesets = userTilesets.value.filter(ts => kitPaths.has(ts.path))
                        userTilesets.value = [...loadedTilesets, ...kitTilesets.filter(kitTs => !loadedTilesets.some(mapTs => mapTs.path === kitTs.path))]
                        selectedTilesetId.value = loadedTilesets[0].id
                    }
                }
                return true
            }
        } catch (e) {
            console.error('loadExisting:', e)
        }
        return false
    }

    async function openMap() {
        const baseDir = normalizeAssetPath(props.projectPath || '') || undefined
        const result = await window.retroStudio?.retro?.selectFile?.({
            context: 'map-open',
            title: 'Abrir mapa TMX',
            defaultPath: baseDir,
            filters: [{ name: 'TMX', extensions: ['tmx'] }, { name: 'Todos', extensions: ['*'] }]
        })
        if (!result?.success || !result.path) return
        currentMapPath.value = result.path
        await loadExisting()
    }

    async function openRecentMap(map) {
        if (!map?.path) return false
        const previousPath = currentMapPath.value
        currentMapPath.value = map.path
        const loaded = await loadExisting()
        if (loaded) return true
        currentMapPath.value = previousPath
        recentMaps.value = forgetRecentTilemap(map.path)
        window.retroStudioToast?.error?.(t('tilemap.recentMapUnavailable', { name: map.name }))
        return false
    }

    async function createMap() {
        if (!assetPackPath.value) {
            window.retroStudioToast?.error?.(t('tilemap.createMapNeedsKit'))
            return false
        }
        if (canUndo.value && !window.confirm(t('tilemap.createMapDiscardChanges'))) return false
        const kitDirectory = assetPackPath.value.replace(/[/\\][^/\\]+$/, '')
        const mapsDir = normalizeAssetPath(`${kitDirectory}/maps`)
        const result = await window.retroStudio?.retro?.selectSaveFile?.({
            context: 'map-save', title: t('tilemap.createMap'),
            defaultPath: `${mapsDir}/new-map.tmx`,
            filters: [{ name: 'TMX', extensions: ['tmx'] }]
        })
        if (!result?.success || !result.path) return false
        const outputPath = normalizeAssetPath(result.path)
        const relativePath = outputPath.slice(mapsDir.length).replace(/^\/+/, '')
        if (!outputPath.startsWith(`${mapsDir}/`) || !relativePath || relativePath.startsWith('..') || !/\.tmx$/i.test(outputPath)) {
            window.retroStudioToast?.error?.(t('tilemap.createMapInsideKit'))
            return false
        }
        const kitTilesetPaths = new Set(Object.values(assetPackTilesets.value).map(normalizeAssetPath))
        const kitTilesets = userTilesets.value.filter(tileset => kitTilesetPaths.has(normalizeAssetPath(tileset.path)))
        if (!kitTilesets.length) {
            window.retroStudioToast?.error?.(t('tilemap.createMapNeedsTilesets'))
            return false
        }
        userTilesets.value = kitTilesets
        selectedTilesetId.value = userTilesets.value[0]?.id || ''
        currentMapPath.value = outputPath
        mapWidthInternal.value = 40
        mapHeightInternal.value = 28
        const length = 40 * 28
        tiles.value = Array(length).fill(0)
        tiles2.value = Array(length).fill(0)
        collisionMap.value = Array(length).fill(0)
        priorityMap.value = Array(length).fill(false)
        flipHMap.value = Array(length).fill(false)
        flipVMap.value = Array(length).fill(false)
        paletteMap.value = Array(length).fill(0)
        flipHMap2.value = Array(length).fill(false)
        flipVMap2.value = Array(length).fill(false)
        paletteMap2.value = Array(length).fill(0)
        objects.value = []
        selectedObjectId.value = null
        backgroundImage.value = null
        parallaxLayers.value = []
        musicTrack.value = ''
        await setBackgroundImage(null, outputPath)
        history.value = []
        pushState()
        historyIndex.value = 0
        await doSave(outputPath)
        return true
    }

    async function deleteKitMap(map) {
        if (!map?.path || !assetPackPath.value) return false
        if (!window.confirm(t('tilemap.confirmDeleteMap', { name: map.name }))) return false
        try {
            const kitDirectory = assetPackPath.value.replace(/[/\\][^/\\]+$/, '')
            try {
                await window.retroStudio?.retro?.deleteTilemapPackMap?.(kitDirectory, map.path, assetPackPath.value)
            } catch (error) {
                // A dev Electron main process may predate this IPC channel while the renderer/preload hot-reload.
                if (!/No handler registered for ['"]tilemap:delete-kit-map['"]/.test(error?.message || '')) throw error
                const root = normalizeAssetPath(kitDirectory).replace(/\/+$/, '')
                const target = normalizeAssetPath(map.path)
                const packDefinition = normalizeAssetPath(assetPackPath.value)
                if (!target.startsWith(`${root}/`) || target === packDefinition || !/\.(tmx|json)$/i.test(target)) {
                    throw new Error(t('tilemap.deleteMapOutsideKit'))
                }
                if (!window.retroStudio?.deletePath) throw error
                await window.retroStudio.deletePath(map.path)
            }
            assetPackMaps.value = await window.retroStudio?.retro?.listTilemapPackMaps?.(kitDirectory, assetPackPath.value) || []
            if (normalizeAssetPath(currentMapPath.value || '') === normalizeAssetPath(map.path)) currentMapPath.value = null
            recentMaps.value = forgetRecentTilemap(map.path)
            window.retroStudioToast?.success?.(t('tilemap.mapDeleted', { name: map.name }))
            return true
        } catch (error) {
            window.retroStudioToast?.error?.(error?.message || t('tilemap.deleteMapError'))
            return false
        }
    }

    function removeRecentMap(map) {
        if (map?.path) recentMaps.value = forgetRecentTilemap(map.path)
    }

    function clearRecentMaps() {
        recentMaps.value = clearRecentTilemaps()
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
        const kitDirectory = assetPackPath.value ? assetPackPath.value.replace(/[/\\][^/\\]+$/, '') : ''
        const mapsDir = kitDirectory ? normalizeAssetPath(`${kitDirectory}/maps`)
            : baseDir ? `${baseDir}/maps`.replace(/\/+/g, '/') : undefined
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
            const exportTilesets = userTilesets.value.map(ts => ({
                name: ts.name, path: relativeImagePath(outPath, ts.path),
                firstgid: ts.firstgid, columns: ts.columns, tilecount: ts.tilecount
            }))

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
                objects: objects.value,
                musicTrack: musicTrack.value,
                background: backgroundImage.value?.path ? {
                    path: relativeImagePath(outPath, backgroundImage.value.path),
                    fit: backgroundImage.value.fit,
                    opacity: backgroundImage.value.opacity
                } : null
                , parallaxLayers: parallaxLayers.value.map(layer => ({
                    ...layer,
                    path: relativeImagePath(outPath, layer.path),
                    preview: undefined
                }))
            })
            await window.retroStudio.writeTextFile(outPath, tmx)
            recentMaps.value = rememberRecentTilemap(outPath)
            if (assetPackPath.value) {
                const kitDirectory = assetPackPath.value.replace(/[/\\][^/\\]+$/, '')
                assetPackMaps.value = await window.retroStudio?.retro?.listTilemapPackMaps?.(kitDirectory, assetPackPath.value) || []
            }
            emit('saved')
            let exportResult = null
            try {
                exportResult = await window.retroStudio.retro?.exportMapAfterSave?.(outPath)
            } catch (error) {
                exportResult = { configured: true, exported: false, error: error?.message || String(error) }
            }
            if (exportResult?.configured && !exportResult.exported && !exportResult.skipped) {
                exportFailure.value = {
                    mapPath: outPath,
                    message: exportResult.error || 'Erro desconhecido',
                    details: [exportResult.stderr, exportResult.stdout].filter(Boolean).join('\n\n')
                }
                window.retroStudioToast?.error?.(t('tilemap.savedExportFailed', { error: exportFailure.value.message }))
            } else if (exportResult?.exported) {
                exportFailure.value = null
                window.retroStudioToast?.success?.(t('tilemap.savedAndExported'))
            } else {
                window.retroStudioToast?.success?.(t('tilemap.saved'))
            }
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
        if (sel?.w && sel?.h) {
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
            window.retroStudioToast?.success?.(t('tilemap.stampSaved', { name }))
            return
        }

        // Sem seleção no mapa: salva a região da paleta como stamp de brush
        const region = selectedTileRegion.value
        const ts = selectedTileset.value
        if (!region || !ts || !region.w || !region.h) {
            window.retroStudioToast?.warning?.(t('tilemap.stampNeedSelection'))
            return
        }
        const cols = getTilesetColumns(ts)
        const firstgid = ts.firstgid || 1
        const startX = region.idx % cols
        const startY = Math.floor(region.idx / cols)
        const name = (stampNameDraft.value || `stamp_${stamps.value.length + 1}`).trim()
        const empty = () => Array(region.w * region.h).fill(0)
        const data = {
            id: `st_${Date.now()}`,
            name,
            w: region.w,
            h: region.h,
            tiles: [],
            tiles2: empty(),
            collision: empty(),
            priority: empty().map(() => false),
            flipH: empty().map(() => false),
            flipV: empty().map(() => false),
            palette: empty(),
            flipH2: empty().map(() => false),
            flipV2: empty().map(() => false),
            palette2: empty()
        }
        for (let dy = 0; dy < region.h; dy++) {
            for (let dx = 0; dx < region.w; dx++) {
                data.tiles.push(((startY + dy) * cols + (startX + dx)) + firstgid)
            }
        }
        stamps.value = [...stamps.value.filter((s) => s.name !== name), data]
        persistStamps()
        stampNameDraft.value = ''
        window.retroStudioToast?.success?.(t('tilemap.stampSaved', { name }))
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

    const packAuthor = useMapPackAuthoring({ assetPack, assetPackPath, assetPackTilesets, selectedPackBrush,
        objectTemplates, objectTemplateIndex, selectedObject, selectedTileset, selectedTileRegion, userTilesets,
        rememberSavedKit,
        get projectPath() { return props.projectPath } }, t)

    const cutscenes = useCutsceneAuthoring({ objects, currentMapPath, mapHeight, tileSize: TILE_SIZE_CONST,
        get projectPath() { return props.projectPath } })

    /** Places a cutscene trigger area around the player's spawn (or the map's left edge). */
    function addCutsceneTrigger(cutsceneId, start = 'touch') {
        const spawn = objects.value.find(o => o.type === 'player_spawn')
        const width = start === 'enter' ? 2 : 4
        const height = 6
        const x = Math.max(0, Math.min(mapWidth.value - width, spawn ? spawn.x + (spawn.width || 1) + 2 : 2))
        const y = Math.max(0, Math.min(mapHeight.value - height, spawn ? spawn.y + (spawn.height || 1) - height : mapHeight.value - height - 1))
        pushState()
        const id = Math.max(0, ...objects.value.map(o => Number(o.id) || 0)) + 1
        objects.value = [...objects.value, {
            id, name: `Cena ${cutsceneId}`, type: 'cutscene_trigger', x, y, width, height,
            animationStart: previewClock.value,
            properties: { cutscene: cutsceneId, start, once: true }
        }]
        selectedObjectId.value = id
        return id
    }

    return {
        packAuthor,
        cutscenes,
        cutsceneOverlay: cutscenes.overlay,
        cutscenePicking: cutscenes.picking,
        cutscenePreviewing: cutscenes.previewing,
        addCutsceneTrigger,
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
        exportFailure,
        musicTrack, musicTracks, setMusicTrack,
        musicPreviewUrl, musicPreviewLoading, musicPreviewError, loadMusicPreview, stopMusicPreview,
        isDrawing,
        isMaximized,
        fgOpacity,
        objects,
        assetPack, assetPackPath, assetPackMaps, assetPackTilesets, selectedPackBrush, packLoading,
        objectTemplates, objectTemplateIndex, selectedObjectId, selectedObject,
        importAssetPack, selectPackBrush, updateSelectedObject, moveSelectedObjectTo, deleteSelectedObject,
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
        pendingStamp,

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
        recentMaps,
        recentKits,
        backgroundImage,
        parallaxLayers,
        vramEstimate,
        userTilesets,
        previewAnimations,
        previewClock,

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
        addParallaxLayer, updateParallaxLayer, removeParallaxLayer, moveParallaxLayer,
        toggleMaximize,
        ensureTiles,
        pushState,
        undo,
        redo,
        addTileset,
        addTilesetFromPath,
        removeTileset,
        selectTileset,
        selectDrawTool,
        clearAttrEdits,
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
        openRecentMap,
        createMap,
        deleteKitMap,
        removeRecentMap,
        clearRecentMaps,
        openRecentKit,
        removeRecentKit,
        clearRecentKits,
        rememberSavedKit,
        chooseBackgroundImage,
        clearBackgroundImage,
        updateBackgroundOption,
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
