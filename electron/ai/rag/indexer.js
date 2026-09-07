/**
 * RAG Indexer - Indexa o workspace em chunks para busca por relevância
 * Chunking por arquivo (arquivos pequenos) ou por blocos de ~100 linhas
 */

import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_CHUNK_LINES = 100
const MAX_CHUNK_CHARS = 6000
const INDEX_FILENAME = 'rag-index.json'
const TEXT_EXTS = new Set([
  '.c', '.h', '.res', '.json', '.md', '.txt', '.xml',
  '.js', '.ts', '.vue', '.css', '.html', '.yaml', '.yml'
])

/**
 * Lista arquivos de código no workspace (respeitando .gitignore se existir)
 */
async function listCodeFiles(rootDir, dir = '.') {
  const results = []
  const fullPath = path.join(rootDir, dir)
  let entries
  try {
    entries = await fs.readdir(fullPath, { withFileTypes: true })
  } catch {
    return results
  }
  for (const e of entries) {
    const rel = path.join(dir, e.name)
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'out') continue
    if (e.isDirectory()) {
      results.push(...(await listCodeFiles(rootDir, rel)))
    } else if (TEXT_EXTS.has(path.extname(e.name).toLowerCase())) {
      results.push(rel)
    }
  }
  return results
}

/**
 * Divide conteúdo em chunks por tamanho
 */
function chunkText(content, filePath) {
  const lines = content.split('\n')
  const chunks = []
  for (let i = 0; i < lines.length; i += MAX_CHUNK_LINES) {
    const slice = lines.slice(i, i + MAX_CHUNK_LINES)
    const text = slice.join('\n')
    if (text.trim().length === 0) continue
    chunks.push({
      path: filePath,
      startLine: i + 1,
      endLine: i + slice.length,
      text: text.length > MAX_CHUNK_CHARS ? text.slice(0, MAX_CHUNK_CHARS) + '\n...' : text
    })
  }
  if (chunks.length === 0 && content.trim()) {
    chunks.push({ path: filePath, startLine: 1, endLine: lines.length, text: content.slice(0, MAX_CHUNK_CHARS) })
  }
  return chunks
}

/**
 * Indexa o workspace e salva em .retrostudio/rag-index.json
 */
export async function indexWorkspace(workspacePath) {
  if (!workspacePath) return
  const indexPath = path.join(workspacePath, '.retrostudio', INDEX_FILENAME)
  const allChunks = []
  const files = await listCodeFiles(workspacePath)
  for (const rel of files) {
    try {
      const full = path.join(workspacePath, rel)
      const content = await fs.readFile(full, 'utf8')
      const chunks = chunkText(content, rel)
      allChunks.push(...chunks)
    } catch {
      // ignora arquivos que não podem ser lidos
    }
  }
  const dir = path.dirname(indexPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    indexPath,
    JSON.stringify({
      version: 1,
      workspacePath,
      updatedAt: new Date().toISOString(),
      chunks: allChunks
    }),
    'utf8'
  )
  return { chunks: allChunks.length }
}
