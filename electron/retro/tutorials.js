import { ipcMain, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function setupTutorialHandlers() {
  ipcMain.handle('retro:load-markdown-file', async (_event, { filePath }) => {
    try {
      if (!filePath) return { success: false, error: 'Caminho não fornecido' }
      const resolved = filePath.startsWith('./') ? filePath.substring(2) : filePath
      const candidates = [
        path.join(app.getAppPath(), 'docs', 'content', 'SGDK.wiki', resolved),
        path.join(app.getAppPath(), 'docs', 'tutorials', resolved),
        path.join(__dirname, '..', '..', 'docs', 'content', 'SGDK.wiki', resolved),
        path.join(__dirname, '..', '..', 'docs', 'tutorials', resolved),
        path.join(process.cwd(), 'docs', resolved),
        filePath
      ]
      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          const content = fs.readFileSync(candidate, 'utf-8')
          const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/
          const match = content.match(frontmatterRegex)
          let title = path.basename(candidate, '.md')
          let markdownContent = content
          if (match) {
            const titleMatch = match[1].match(/title:\s*(.+)/i)
            if (titleMatch) title = titleMatch[1].trim()
            markdownContent = content.replace(frontmatterRegex, '')
          }
          return { success: true, content: markdownContent, title }
        }
      }
      return { success: false, error: `Arquivo não encontrado: ${filePath}` }
    } catch (error) {
      console.error('[Retro] load-markdown error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:load-content-topics', async () => {
    try {
      const candidates = [
        path.join(app.getAppPath(), 'docs', 'content'),
        path.join(__dirname, '..', '..', 'docs', 'content'),
        path.join(process.cwd(), 'docs', 'content')
      ]
      let contentDir = null
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          contentDir = c
          break
        }
      }
      if (!contentDir) return { success: true, topics: [] }

      const buildTree = (basePath, relativePath = '') => {
        const fullPath = path.join(basePath, relativePath)
        if (!fs.existsSync(fullPath)) return []
        const items = fs.readdirSync(fullPath)
        const nodes = []
        for (const item of items) {
          const itemRelativePath = path.join(relativePath, item)
          const itemFullPath = path.join(basePath, itemRelativePath)
          const stats = fs.statSync(itemFullPath)
          if (stats.isDirectory()) {
            const children = buildTree(basePath, itemRelativePath)
            const indexPath = path.join(itemFullPath, 'index.md')
            let content = ''
            let title = item.replace(/^\d+-/, '').replace(/-/g, ' ')
            let icon = 'fas fa-folder'
            if (fs.existsSync(indexPath)) {
              const indexContent = fs.readFileSync(indexPath, 'utf-8')
              const fmMatch = indexContent.match(/^---\n([\s\S]*?)\n---\n/)
              if (fmMatch) {
                const titleMatch = fmMatch[1].match(/title:\s*(.+)/i)
                const iconMatch = fmMatch[1].match(/icon:\s*(.+)/i)
                if (titleMatch) title = titleMatch[1].trim()
                if (iconMatch) icon = iconMatch[1].trim()
                content = indexContent.replace(/^---\n[\s\S]*?\n---\n/, '')
              }
            }
            nodes.push({
              id: `dir_${itemRelativePath.replace(/[/\\]/g, '_')}`,
              title,
              icon,
              content,
              children: children.sort((a, b) => a.id.localeCompare(b.id))
            })
          } else if (item.endsWith('.md') && item !== 'index.md') {
            const content = fs.readFileSync(itemFullPath, 'utf-8')
            const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
            let metadata = { title: item.replace('.md', '').replace(/^\d+-/, '').replace(/-/g, ' '), icon: 'far fa-file-alt' }
            let markdownContent = content
            if (fmMatch) {
              const titleMatch = fmMatch[1].match(/title:\s*(.+)/i)
              const iconMatch = fmMatch[1].match(/icon:\s*(.+)/i)
              if (titleMatch) metadata.title = titleMatch[1].trim()
              if (iconMatch) metadata.icon = iconMatch[1].trim()
              markdownContent = content.replace(/^---\n[\s\S]*?\n---\n/, '')
            }
            nodes.push({
              id: `topic_${itemRelativePath.replace(/[/\\]/g, '_')}`,
              title: metadata.title,
              icon: metadata.icon,
              content: markdownContent,
              children: []
            })
          }
        }
        return nodes.sort((a, b) => a.id.localeCompare(b.id))
      }
      return { success: true, topics: buildTree(contentDir) }
    } catch (error) {
      console.error('[Retro] load-content-topics error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:load-tutorials', async () => {
    try {
      const candidates = [
        path.join(app.getAppPath(), 'docs', 'tutorials'),
        path.join(__dirname, '..', '..', 'docs', 'tutorials'),
        path.join(process.cwd(), 'docs', 'tutorials')
      ]
      let tutorialsDir = null
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          tutorialsDir = c
          break
        }
      }
      if (!tutorialsDir) return { success: true, tutorials: [] }

      const files = fs.readdirSync(tutorialsDir).filter((f) => f.endsWith('.md'))
      const tutorials = []
      for (const file of files) {
        const content = fs.readFileSync(path.join(tutorialsDir, file), 'utf-8')
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
        let metadata = { title: file.replace('.md', ''), description: '', tags: [] }
        let markdownContent = content
        if (fmMatch) {
          const fm = fmMatch[1]
          const titleMatch = fm.match(/title:\s*(.+)/i)
          const descMatch = fm.match(/description:\s*(.+)/i)
          const tagsMatch = fm.match(/tags:\s*\[([^\]]+)\]/i)
          if (titleMatch) metadata.title = titleMatch[1].trim()
          if (descMatch) metadata.description = descMatch[1].trim()
          if (tagsMatch) metadata.tags = tagsMatch[1].split(',').map((t) => t.trim().replace(/["']/g, '')).filter(Boolean)
          markdownContent = content.replace(/^---\n[\s\S]*?\n---\n/, '')
        }
        tutorials.push({
          id: `tutorial_${file.replace('.md', '')}`,
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags,
          content: markdownContent
        })
      }
      return { success: true, tutorials }
    } catch (error) {
      console.error('[Retro] load-tutorials error:', error)
      return { success: false, error: error.message }
    }
  })
}
