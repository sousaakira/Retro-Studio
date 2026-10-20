// Arquivos de autoria que têm editor próprio: clicar neles no explorador abre o editor, como o
// .tmx abre no editor de mapas. O caminho é relativo à raiz do projeto, com barras normais.
const DIALOGS = {
  'world/world.json': 'world',
  'camera/camera.json': 'camera',
  'audio/audio.json': 'audio',
  'progress/progress.json': 'progress',
  'debug/debug.json': 'debug',
  'palettes/palettes.json': 'palettes',
  'hud/hud.json': 'hud',
  'game/game.json': 'start',
  'enemies/enemies.json': 'enemies',
  'controls/input-map.json': 'inputs',
  'physics/movement.json': 'movement',
  'retro-studio.toolchain.json': 'toolchain'
}

export function relativeProjectPath(root, filePath) {
  const base = String(root || '').replace(/\\/g, '/').replace(/\/+$/, ''), file = String(filePath || '').replace(/\\/g, '/')
  return base && file.startsWith(base + '/') ? file.slice(base.length + 1) : ''
}

// Kit de mapas não tem nome fixo (map-kit.json, meu-kit.json…): reconhecido pelo conteúdo.
export function looksLikeMapKit(text) {
  try {
    const kit = JSON.parse(text)
    return kit?.version === 1 && kit.tileSize === 8 && !kit.format && Array.isArray(kit.tilesets) && Array.isArray(kit.brushes) && Array.isArray(kit.objects)
  } catch { return false }
}

// Imagens que o visualizador abre (as mesmas extensões que o leitor de imagens do projeto aceita).
export const isViewableImage = filePath => /\.(png|gif|jpe?g|bmp)$/i.test(String(filePath || ''))

export function authoringEditorFor(relative) {
  const file = String(relative || '')
  if (/^charsets\/[^/]+\.charset\.json$/i.test(file)) return { kind: 'characters' }
  if (/^cutscenes\/[^/]+\.cutscene\.json$/i.test(file)) return { kind: 'scene' }
  if (file === 'cutscenes/cutscene-config.json') return { kind: 'scenes' }
  return DIALOGS[file] ? { kind: 'dialog', id: DIALOGS[file] } : null
}
