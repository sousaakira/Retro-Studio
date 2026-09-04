/**
 * Game Graph - grafo de entidades do jogo (Player, Enemy, etc.)
 * Extrai funções de .c/.h e associa com sprites dos .res
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { getSymbolsFromCFile } from './ast/cParser.js'

const ENTITY_PREFIXES = ['update', 'init', 'move', 'draw', 'spawn', 'handle', 'input', 'collision']
const ENTITY_NAMES = ['player', 'enemy', 'bullet', 'enemies', 'boss', 'item', 'camera', 'hud', 'menu']

function extractEntityFromFunctionName(fnName) {
  const lower = fnName.toLowerCase()
  for (const prefix of ENTITY_PREFIXES) {
    if (lower.startsWith(prefix)) {
      const rest = fnName.slice(prefix.length)
      if (rest.length > 0) {
        const entity = rest.charAt(0).toLowerCase() + rest.slice(1)
        if (entity && entity !== 'main' && entity !== 'number') return entity
      }
    }
  }
  return null
}

async function parseResSprites(workspacePath) {
  const sprites = []
  const resDir = path.join(workspacePath, 'res')

  const parseFile = async (filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      for (const line of content.split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const parts = t.split(/\s+/)
        if (parts[0].toUpperCase() === 'SPRITE' && parts[1]) {
          sprites.push(parts[1])
        }
      }
    } catch (_) {}
  }

  const scanDir = async (dir) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isFile() && e.name.endsWith('.res')) await parseFile(full)
        else if (e.isDirectory()) await scanDir(full)
      }
    } catch (_) {}
  }

  try {
    await scanDir(resDir)
  } catch (_) {}
  return sprites
}

function spriteToEntity(spriteName) {
  if (!spriteName.startsWith('SPR_')) return null
  const rest = spriteName.slice(4).replace(/_/g, '')
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase() : null
}

/**
 * Constrói grafo de entidades do jogo
 * @param {string} workspacePath
 * @returns {Promise<{ entities: Array<{ name: string, functions: string[], sprites: string[] }> }>}
 */
export async function buildGameGraph(workspacePath) {
  if (!workspacePath) return { entities: [] }

  const entityMap = new Map()
  const srcDir = path.join(workspacePath, 'src')

  const collectFromFile = async (filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const { functions } = getSymbolsFromCFile(content, filePath)
      for (const f of functions) {
        const entity = extractEntityFromFunctionName(f.name)
        if (entity) {
          if (!entityMap.has(entity)) {
            entityMap.set(entity, { name: entity, functions: [], sprites: [] })
          }
          const ent = entityMap.get(entity)
          if (!ent.functions.includes(f.name)) ent.functions.push(f.name)
        }
      }
    } catch (_) {}
  }

  const scanSrc = async (dir) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isFile() && (e.name.endsWith('.c') || e.name.endsWith('.h'))) {
          await collectFromFile(full)
        } else if (e.isDirectory()) {
          await scanSrc(full)
        }
      }
    } catch (_) {}
  }

  await scanSrc(srcDir)

  const sprites = await parseResSprites(workspacePath)
  for (const spr of sprites) {
    const entity = spriteToEntity(spr)
    if (entity) {
      if (!entityMap.has(entity)) {
        entityMap.set(entity, { name: entity, functions: [], sprites: [] })
      }
      entityMap.get(entity).sprites.push(spr)
    }
  }

  const entities = Array.from(entityMap.values())
  return { entities }
}

/**
 * Formata o grafo como texto para o prompt (~200-300 tokens)
 */
export function formatGameGraphBlock(graph) {
  if (!graph?.entities?.length) return ''
  const lines = graph.entities.map((e) => {
    const fns = e.functions.length ? e.functions.slice(0, 5).join(', ') : ''
    const sprs = e.sprites.length ? e.sprites.join(', ') : ''
    const parts = []
    if (fns) parts.push(fns)
    if (sprs) parts.push(`sprite: ${sprs}`)
    return `${e.name}: ${parts.join('; ')}`
  })
  return `\n\n--- GAME GRAPH ---\n${lines.join('\n')}\n--- FIM GAME GRAPH ---`
}
