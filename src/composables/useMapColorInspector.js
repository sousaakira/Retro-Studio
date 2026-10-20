import { ref, shallowRef, watch, onScopeDispose } from 'vue'
import { analyzeMapColors, locateMapColor, colorKey, colorHex, MAX_COLOR_PIXELS } from '../utils/retro/mapColors.js'

export function useMapColorInspector() {
  const enabled = ref(false), picking = ref(false), highlight = ref(true)
  const scope = ref('composition'), spriteId = ref('all'), bank = ref('all')
  const selectedHex = ref(''), colors = shallowRef([]), total = ref(0)
  const matchCount = ref(0), locations = shallowRef([]), busy = ref(false), error = ref('')
  const revision = ref(0)
  let artwork = null, maskCanvas = null, locationIndex = -1

  function invalidate(clear = false) {
    artwork = null; maskCanvas = null; picking.value = false
    busy.value = enabled.value; error.value = ''
    matchCount.value = 0; locations.value = []; locationIndex = -1
    if (clear) { colors.value = []; total.value = 0; selectedHex.value = '' }
    revision.value++
  }
  function updateMask() {
    maskCanvas = null; matchCount.value = 0; locations.value = []; locationIndex = -1
    const key = colorKey(selectedHex.value)
    if (artwork && key !== null) {
      const result = locateMapColor(artwork, key, 8, scope.value !== 'composition')
      matchCount.value = result.count; locations.value = result.locations
      if (result.count) {
        maskCanvas = document.createElement('canvas')
        maskCanvas.width = artwork.width; maskCanvas.height = artwork.height
        maskCanvas.getContext('2d').putImageData(new ImageData(result.mask, artwork.width, artwork.height), 0, 0)
      }
    }
    revision.value++
  }
  function capture(width, height, paint) {
    if (!enabled.value) return
    try {
      if (width * height > MAX_COLOR_PIXELS || width > 16384 || height > 16384) throw new Error('tooLarge')
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.imageSmoothingEnabled = false
      paint(ctx, canvas)
      artwork = ctx.getImageData(0, 0, width, height)
      const analysis = analyzeMapColors(artwork)
      colors.value = analysis.colors; total.value = analysis.total
      busy.value = false; error.value = ''
      updateMask()
    } catch (cause) {
      artwork = null; maskCanvas = null; colors.value = []; total.value = 0
      matchCount.value = 0; locations.value = []; busy.value = false
      error.value = ['tooLarge', 'tooManyColors'].includes(cause.message) ? cause.message : 'readError'
      revision.value++
    }
  }
  function pick(x, y) {
    if (!artwork || busy.value) return false
    x = Math.floor(x); y = Math.floor(y)
    if (x < 0 || y < 0 || x >= artwork.width || y >= artwork.height) return false
    const i = (y * artwork.width + x) * 4
    if (!artwork.data[i + 3]) return false
    selectedHex.value = colorHex((artwork.data[i] << 16) | (artwork.data[i + 1] << 8) | artwork.data[i + 2])
    picking.value = false
    return true
  }
  function drawHighlight(ctx, width, height) {
    if (!enabled.value || !highlight.value || !maskCanvas || busy.value) return
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 1
    ctx.drawImage(maskCanvas, 0, 0, width, height)
    ctx.restore()
  }
  function nextLocation() {
    if (!locations.value.length) return null
    locationIndex = (locationIndex + 1) % locations.value.length
    return locations.value[locationIndex]
  }
  watch(selectedHex, updateMask)
  watch(scope, () => { bank.value = 'all'; selectedHex.value = '' }, { flush: 'sync' })
  watch(enabled, value => { if (!value) { invalidate(); busy.value = false } })
  onScopeDispose(() => { artwork = null; maskCanvas = null })
  return { enabled, picking, highlight, scope, spriteId, bank, selectedHex, colors, total, matchCount, locations, busy, error, revision,
    capture, invalidate, pick, drawHighlight, nextLocation }
}
