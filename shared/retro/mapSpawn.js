// Ponto "Spawn" desenhado no editor de mapas (objeto do tipo player_spawn), como os pés do
// personagem: centro da base do retângulo. É a mesma leitura que o exportador de mapas faz.
export function mapSpawnPoint(tmx) {
  const text = String(tmx || '')
  for (const match of text.matchAll(/<object\b([^>]*)>/g)) {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w:.-]+)="([^"]*)"/g)].map(pair => [pair[1], pair[2]]))
    if (attributes.type !== 'player_spawn') continue
    const number = name => Number.isFinite(Number(attributes[name])) ? Number(attributes[name]) : 0
    return { x: Math.max(0, Math.round(number('x') + number('width') / 2)), y: Math.max(0, Math.round(number('y') + number('height'))) }
  }
  return null
}
