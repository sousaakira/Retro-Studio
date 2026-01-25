import { ipcMain, app } from 'electron'
import path from 'path'
import fs from 'fs'

export function setupTutorialHandlers() {
  ipcMain.on('load-markdown-file', (event, args) => {
    try {
      const { filePath } = args || {}
      if (!filePath) {
        event.reply('load-markdown-file-result', { success: false, error: 'Caminho do arquivo não fornecido' })
        return
      }
      let resolvedPath = filePath.startsWith('./') ? filePath.substring(2) : filePath
      const candidates = [
        path.join(process.cwd(), 'docs', 'content', 'SGDK.wiki', resolvedPath),
        path.join(process.cwd(), 'docs', 'tutorials', resolvedPath),
        path.join(__dirname, '..', 'docs', 'content', 'SGDK.wiki', resolvedPath),
        path.join(__dirname, '..', 'docs', 'tutorials', resolvedPath),
        path.join(process.cwd(), resolvedPath),
        filePath
      ]
      let resolvedFile = null
      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          resolvedFile = candidate
          break
        }
      }
      if (!resolvedFile) {
        event.reply('load-markdown-file-result', { success: false, error: `Arquivo não encontrado: ${filePath}` })
        return
      }
      const content = fs.readFileSync(resolvedFile, 'utf-8')
      const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/
      const match = content.match(frontmatterRegex)
      let title = path.basename(resolvedFile, '.md')
      let markdownContent = content
      if (match) {
        const fm = match[1]
        const titleMatch = fm.match(/title:\s*(.+)/i)
        if (titleMatch) title = titleMatch[1].trim()
        markdownContent = content.replace(frontmatterRegex, '')
      }
      event.reply('load-markdown-file-result', { success: true, content: markdownContent, title: title })
    } catch (error) {
      console.error('[Help] Erro ao carregar arquivo Markdown:', error)
      event.reply('load-markdown-file-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('load-content-topics', async (event, args) => {
    try {
      const { dirPath } = args || {}
      let contentDir = dirPath
      if (!contentDir) {
        const candidates = [
          path.join(app.getAppPath(), 'docs', 'content'),
          path.join(__dirname, '..', '..', 'docs', 'content'),
          path.join(__dirname, '..', 'docs', 'content'),
          path.join(process.cwd(), 'docs', 'content')
        ]
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            contentDir = candidate
            break
          }
        }
      }
      if (!contentDir || !fs.existsSync(contentDir)) {
        event.reply('load-content-topics-result', { success: true, topics: [] })
        return
      }
      const buildTree = (basePath, relativePath = '') => {
        const fullPath = path.join(basePath, relativePath)
        const items = fs.readdirSync(fullPath)
        const nodes = []
        for (const item of items) {
          const itemRelativePath = path.join(relativePath, item)
          const itemFullPath = path.join(basePath, itemRelativePath)
          const stats = fs.statSync(itemFullPath)
          if (stats.isDirectory()) {
            const children = buildTree(basePath, itemRelativePath)
            if (children.length > 0) {
              let content = '', title = item.replace(/^\d+-/, '').replace(/-/g, ' '), icon = 'fas fa-folder'
              const indexPath = path.join(itemFullPath, 'index.md')
              if (fs.existsSync(indexPath)) {
                const indexContent = fs.readFileSync(indexPath, 'utf-8')
                const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/
                const match = indexContent.match(frontmatterRegex)
                if (match) {
                  const fm = match[1]
                  const titleMatch = fm.match(/title:\s*(.+)/i)
                  if (titleMatch) title = titleMatch[1].trim()
                  const iconMatch = fm.match(/icon:\s*(.+)/i)
                  if (iconMatch) icon = iconMatch[1].trim()
                  content = indexContent.replace(frontmatterRegex, '')
                } else content = indexContent
              }
              nodes.push({ id: `dir_${itemRelativePath.replace(/[\/\\]/g, '_')}`, title, icon, content, children: children.sort((a, b) => a.id.localeCompare(b.id)) })
            }
          } else if (item.endsWith('.md') && item !== 'index.md') {
            const content = fs.readFileSync(itemFullPath, 'utf-8')
            const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/
            const match = content.match(frontmatterRegex)
            let metadata = { title: item.replace('.md', '').replace(/^\d+-/, '').replace(/-/g, ' '), icon: 'far fa-file-alt' }
            let markdownContent = content
            if (match) {
              const fm = match[1]
              const titleMatch = fm.match(/title:\s*(.+)/i), iconMatch = fm.match(/icon:\s*(.+)/i)
              if (titleMatch) metadata.title = titleMatch[1].trim()
              if (iconMatch) metadata.icon = iconMatch[1].trim()
              markdownContent = content.replace(frontmatterRegex, '')
            }
            nodes.push({ id: `topic_${itemRelativePath.replace(/[\/\\]/g, '_')}`, title: metadata.title, icon: metadata.icon, content: markdownContent, children: [] })
          }
        }
        return nodes.sort((a, b) => a.id.localeCompare(b.id))
      }
      event.reply('load-content-topics-result', { success: true, topics: buildTree(contentDir) })
    } catch (error) {
      console.error('[Content] Erro ao carregar:', error)
      event.reply('load-content-topics-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('load-tutorials', async (event, args) => {
    try {
      const { dirPath } = args || {}
      let tutorialsDir = dirPath
      if (!tutorialsDir) {
        const candidates = [
          path.join(app.getAppPath(), 'docs', 'tutorials'),
          path.join(__dirname, '..', '..', 'docs', 'tutorials'),
          path.join(__dirname, '..', 'docs', 'tutorials'),
          path.join(process.cwd(), 'docs', 'tutorials')
        ]
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            tutorialsDir = candidate
            break
          }
        }
      }
      if (!tutorialsDir || !fs.existsSync(tutorialsDir)) {
        event.reply('load-tutorials-result', { success: true, tutorials: [] })
        return
      }
      const files = fs.readdirSync(tutorialsDir).filter(f => f.endsWith('.md'))
      const tutorials = []
      for (const file of files) {
        const content = fs.readFileSync(path.join(tutorialsDir, file), 'utf-8')
        const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/
        const match = content.match(frontmatterRegex)
        let metadata = { title: file.replace('.md', ''), description: '', tags: [] }
        let markdownContent = content
        if (match) {
          const fm = match[1]
          const titleMatch = fm.match(/title:\s*(.+)/i), descMatch = fm.match(/description:\s*(.+)/i), tagsMatch = fm.match(/tags:\s*\[([^\]]+)\]/i)
          if (titleMatch) metadata.title = titleMatch[1].trim()
          if (descMatch) metadata.description = descMatch[1].trim()
          if (tagsMatch) metadata.tags = tagsMatch[1].split(',').map(t => t.trim().replace(/["']/g, '')).filter(t => t)
          markdownContent = content.replace(frontmatterRegex, '')
        }
        tutorials.push({ id: `tutorial_${file.replace('.md', '')}`, title: metadata.title, description: metadata.description, tags: metadata.tags, content: markdownContent })
      }
      event.reply('load-tutorials-result', { success: true, tutorials })
    } catch (error) {
      console.error('[Tutorials] Erro ao carregar:', error)
      event.reply('load-tutorials-result', { success: false, error: error.message })
    }
  })
}
