import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let helpWatcher = null

export function setupHelpWatcher(win) {
  if (helpWatcher) {
    try {
      helpWatcher.close()
    } catch (e) {
      console.error('[Help] Erro ao fechar watcher anterior:', e)
    }
  }

  const candidates = [
    path.join(app.getAppPath(), 'docs'),
    path.join(__dirname, '..', 'docs'),
    path.join(process.cwd(), 'docs')
  ]

  let docsDir = null
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      docsDir = candidate
      break
    }
  }

  if (!docsDir) {
    console.warn('[Help] Diretório docs não encontrado para Hot Reload')
    return
  }

  console.log('[Help] Configurando Hot Reload em:', docsDir)

  let timeout
  try {
    const isLinux = process.platform === 'linux'
    helpWatcher = fs.watch(docsDir, { recursive: !isLinux }, (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        clearTimeout(timeout)
        timeout = setTimeout(() => {
          if (win && !win.isDestroyed()) {
            console.log(`[Help] Mudança detectada: ${filename}. Recarregando conteúdo...`)
            win.webContents.send('help-content-updated')
          }
        }, 500)
      }
    })
  } catch (err) {
    console.error('[Help] Falha ao iniciar watcher:', err)
  }
}
