// #62: como as camadas de um mapa cabem nos dois planos do Mega Drive. Mesmas regras do
// exportador (tools/export-map.py: compose_panorama), menos as que dependem dos pixels das
// imagens — sobreposição de faixas e contagem de cores e de tiles só o exportador confere.
export const SCENERY_PLANE = Object.freeze({ width: 512, height: 256 })
const REPEAT = ['repeat', 'repeat-x', 'repeat-y']
const name = (layer, index) => 'Panorama ' + (index + 1) + ' (' + String(layer.path || '').split(/[\\/]/).pop() + ')'
/** Tamanho com que a imagem vai para o plano e de quanto em quanto ela se repete. */
export function panoramaPeriod(layer, viewWidth, viewHeight) {
  const width = Number(layer.width) || 0, height = Number(layer.height) || 0
  if (!width || !height) return null
  let drawnWidth = width, drawnHeight = height
  if (layer.fit === 'stretch') { drawnWidth = viewWidth; drawnHeight = viewHeight }
  else if (!REPEAT.includes(layer.fit)) {
    const scale = (layer.fit === 'contain' ? Math.min : Math.max)(viewWidth / width, viewHeight / height)
    drawnWidth = Math.max(1, Math.round(width * scale)); drawnHeight = Math.max(1, Math.round(height * scale))
  }
  const repeatX = !REPEAT.includes(layer.fit) || layer.fit !== 'repeat-y', repeatY = !REPEAT.includes(layer.fit) || layer.fit !== 'repeat-x'
  return { x: repeatX ? drawnWidth : viewWidth, y: repeatY ? drawnHeight : viewHeight }
}
/** Velocidade em 8.8, como vai para o jogo. */
export const panoramaFactor = value => Math.round(Math.max(0, Math.min(2, Number(value) || 0)) * 256)
/**
 * @returns {{mode:'legacy'|'scenery', planes:{plane:string,use:string}[], problems:string[], notes:string[]}}
 * problems: o exportador vai recusar o mapa por isso. notes: o que muda no console.
 */
export function explainScenery({ parallaxLayers = [], hasForeground = false, hasBackground = false, roomWidth = 0, roomHeight = 0, viewWidth = 320, viewHeight = 224 } = {}) {
  if (!parallaxLayers.length) {
    return { mode: 'legacy', planes: [{ plane: 'BG_B', use: hasBackground ? 'cenário (com o fundo fixo desenhado junto)' : 'cenário' }, { plane: 'BG_A', use: hasForeground ? 'frente' : 'livre' }], problems: [], notes: [] }
  }
  const problems = [], notes = []
  if (parallaxLayers.length > 8) problems.push('O mapa tem mais de oito panoramas.')
  if (hasForeground) problems.push('Esta sala usa cenário e frente (os dois planos do console) e também panoramas. Não sobra plano: mova os tiles da frente para a camada de cenário (a prioridade por tile continua valendo) ou remova os panoramas.')
  if (hasBackground) problems.push('Fundo fixo e panoramas no mesmo mapa: o fundo fixo é desenhado junto do cenário e cobriria os panoramas. Transforme o fundo em um panorama (velocidade 1 acompanha o mapa) ou remova-o.')
  const factors = parallaxLayers.map(layer => ({ x: panoramaFactor(layer.factorX ?? 0.5), y: panoramaFactor(layer.factorY ?? 1) }))
  parallaxLayers.forEach((layer, index) => {
    const label = name(layer, index)
    if (Number(layer.opacity ?? 1) !== 1) problems.push(label + ': o console não mistura camadas; use opacidade 100%.')
    const period = panoramaPeriod(layer, viewWidth, viewHeight)
    if (!period) { notes.push(label + ': o tamanho da imagem ainda não é conhecido; a repetição será conferida na exportação.'); return }
    const travelX = Math.ceil(Math.max(0, roomWidth - viewWidth) * factors[index].x / 256), travelY = Math.ceil(Math.max(0, roomHeight - viewHeight) * factors[index].y / 256)
    if (factors[index].x && SCENERY_PLANE.width % period.x && viewWidth + travelX > SCENERY_PLANE.width) problems.push(`${label}: repete a cada ${period.x} px na horizontal e anda ${travelX} px nesta sala. O plano do console dá a volta a cada ${SCENERY_PLANE.width} px: use uma largura que divida ${SCENERY_PLANE.width} (32, 64, 128, 256 ou 512), velocidade horizontal 0, ou uma velocidade com que o panorama ande até ${SCENERY_PLANE.width - viewWidth} px.`)
    if (factors[index].y && SCENERY_PLANE.height % period.y && viewHeight + travelY > SCENERY_PLANE.height) problems.push(`${label}: repete a cada ${period.y} px na vertical e anda ${travelY} px nesta sala. O plano do console dá a volta a cada ${SCENERY_PLANE.height} px: use uma altura que divida ${SCENERY_PLANE.height} (32, 64, 128 ou 256), velocidade vertical 0, ou uma velocidade com que o panorama ande até ${SCENERY_PLANE.height - viewHeight} px.`)
  })
  const vertical = new Set(factors.map(item => item.y)), horizontal = new Set(factors.map(item => item.x))
  if (vertical.size > 1) problems.push('Os panoramas do mapa têm velocidades verticais diferentes. Eles dividem um único plano do console, que só tem um scroll vertical: use a mesma velocidade vertical em todos.')
  if (horizontal.size > 1) {
    if (vertical.size === 1 && [...vertical][0]) problems.push('Faixas com velocidades horizontais diferentes exigem velocidade vertical 0 em todos os panoramas: as faixas são fixas na tela, de 8 em 8 linhas.')
    notes.push('Velocidades horizontais diferentes viram faixas horizontais da tela (até 8), de 8 em 8 linhas. Onde dois panoramas de velocidades diferentes têm pixels nas mesmas linhas, a exportação recusa o mapa e diz quais.')
  } else if (parallaxLayers.length > 1) notes.push('Panoramas com a mesma velocidade viram uma imagem só no plano.')
  notes.push('No jogo as velocidades valem em passos de 1/256; cores e tiles (panoramas + cenário em até três paletas de 15 cores) são conferidos na exportação.')
  notes.push('Panoramas funcionam nas salas do mundo (Runtime → Mundo), com os módulos de runtime "scenery-sgdk" e "world-sgdk" versão 3.')
  return { mode: 'scenery', planes: [{ plane: 'BG_B', use: horizontal.size > 1 ? 'panoramas, em faixas com velocidades próprias' : 'panoramas' }, { plane: 'BG_A', use: 'cenário, enviado aos poucos conforme a câmera anda (streaming)' }], problems, notes }
}
