import { samePortablePath } from './portablePath.js'

/** Version 7 binds grids and individual poses to stable sheet IDs. */
export function charsetSources(data) {
  if (data.version < 7 || !data.version) return [{ ...(typeof data.source === 'object' ? data.source : {}), id: 'sheet-1' }]
  if (typeof data.characterId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.characterId))
    throw new Error('Identidade do personagem inválida.')
  if (!Array.isArray(data.sources) || !data.sources.length || data.sources.length > 64)
    throw new Error('O personagem deve ter entre 1 e 64 folhas.')
  const ids = new Set()
  for (const source of data.sources) {
    if (!source || typeof source.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(source.id) || ids.has(source.id) ||
        typeof source.path !== 'string' || !source.path || typeof source.name !== 'string' || !source.name)
      throw new Error('Lista de folhas inválida ou com IDs repetidos.')
    ids.add(source.id)
  }
  return data.sources.map(({ id, path, name }) => ({ id, path, name }))
}

export function validateCharsetSourceReferences(data) {
  const sources = charsetSources(data), ids = new Set(sources.map(source => source.id))
  const fallback = sources[0].id
  for (const animation of data.animations || []) {
    if (animation.frames) {
      for (const frame of animation.frames)
        if (!ids.has(frame.sourceId || animation.sourceId || fallback)) throw new Error(`Folha ausente no movimento ${animation.name}.`)
    } else if (!ids.has(animation.sourceId || fallback)) throw new Error(`Folha ausente no movimento ${animation.name}.`)
  }
  if (data.activeSourceId && !ids.has(data.activeSourceId)) throw new Error('Folha selecionada inexistente.')
  return sources
}

/** Output ownership follows the character, even after its primary sheet is removed. */
export function sameCharsetOwner(root, saved, data) {
  if (saved?.version >= 7)
    return typeof saved.characterId === 'string' && saved.characterId.length > 0 && saved.characterId === data?.characterId
  return typeof data?.source?.path === 'string' && !!data.source.path && samePortablePath(root, saved?.source?.path, data.source.path)
}
