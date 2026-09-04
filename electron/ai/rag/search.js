/**
 * RAG Search - Busca chunks relevantes para a query (keyword-based)
 * Retorna trechos de código para injetar no prompt como "Relevant files"
 */

import fs from 'node:fs/promises'
import path from 'node:path'

const INDEX_FILENAME = 'rag-index.json'
const TOP_K = 5

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(/\W+/)
    .filter(Boolean)
}

function scoreChunk(chunk, queryTokens) {
  const chunkTokens = new Set(tokenize(chunk.text))
  const querySet = new Set(queryTokens)
  let score = 0
  for (const q of querySet) {
    if (chunkTokens.has(q)) score += 1
    for (const ct of chunkTokens) {
      if (ct.includes(q) || q.includes(ct)) score += 0.5
    }
  }
  return score
}

/**
 * Carrega índice do workspace (se existir)
 */
async function loadIndex(workspacePath) {
  const indexPath = path.join(workspacePath, '.retrostudio', INDEX_FILENAME)
  try {
    const raw = await fs.readFile(indexPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Busca chunks mais relevantes para a query
 */
export async function searchRelevantChunks(workspacePath, query) {
  const index = await loadIndex(workspacePath)
  if (!index?.chunks?.length) return []
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []
  const scored = index.chunks.map((chunk) => ({
    chunk,
    score: scoreChunk(chunk, queryTokens)
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored
    .filter((s) => s.score > 0)
    .slice(0, TOP_K)
    .map((s) => s.chunk)
}

/**
 * Formata chunks como bloco "Relevant files" para o prompt
 */
export function formatRelevantFilesBlock(chunks) {
  if (!chunks?.length) return ''
  const parts = chunks.map(
    (c) => `File: ${c.path} (lines ${c.startLine}-${c.endLine})\n\`\`\`\n${c.text}\n\`\`\``
  )
  return `\n\n--- ARQUIVOS RELEVANTES ---\n${parts.join('\n\n')}\n--- FIM ARQUIVOS RELEVANTES ---`
}
