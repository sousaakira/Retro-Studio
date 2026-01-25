import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { 
  getProjectConfig, 
  lerDiretorio, 
  getTemplatePath
} from '../projectUtils.js'
import { 
  scanResourcesFolder, 
  getResourcePath 
} from '../assetUtils.js'
import { copyDirectoryRecursive } from '../utils.js'

export function setupProjectHandlers() {
  ipcMain.on('req-projec', (event, result) => { 
    const estrutura = lerDiretorio(result.path); 
    const config = getProjectConfig(result.path);
    event.reply('read-files', { estrutura, config });
  })

  ipcMain.on('get-project-config', (event, projectPath) => {
    const config = getProjectConfig(projectPath);
    event.reply('project-config', config);
  })

  ipcMain.on('add-asset-to-config', (event, { projectPath, asset }) => {
    try {
      const config = getProjectConfig(projectPath)
      if (!config.assets) config.assets = []
      const assetExists = config.assets.some(a => a.id === asset.id)
      if (!assetExists) {
        config.assets.push(asset)
      }
      const configPath = path.join(projectPath, 'retro-studio.json')
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      event.reply('add-asset-result', { success: true, config })
    } catch (error) {
      console.error('[IPC] Erro ao adicionar asset:', error)
      event.reply('add-asset-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('save-project-config', (event, { projectPath, config }) => {
    try {
      const configPath = path.join(projectPath, 'retro-studio.json')
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      event.reply('save-project-config-result', { success: true })
    } catch (error) {
      console.error('[IPC] Erro ao salvar retro-studio.json:', error)
      event.reply('save-project-config-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('remove-asset-from-config', (event, { projectPath, assetId }) => {
    try {
      const config = getProjectConfig(projectPath)
      if (!config.assets) config.assets = []
      config.assets = config.assets.filter(a => a.id !== assetId)
      const configPath = path.join(projectPath, 'retro-studio.json')
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      event.reply('remove-asset-result', { success: true })
    } catch (error) {
      console.error('[IPC] Erro ao remover asset:', error)
      event.reply('remove-asset-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('create-project', (event, projectData) => {
    try {
      const { name, path: basePath, template } = projectData
      if (!name || !basePath) {
        event.returnValue = { success: false, error: 'Name and path are required' }
        return
      }
      const projectPath = path.join(basePath, name)
      if (fs.existsSync(projectPath)) {
        event.returnValue = { success: false, error: 'Directory already exists' }
        return
      }
      const { absolutePath, key } = getTemplatePath(template)
      if (!fs.existsSync(absolutePath)) {
        event.returnValue = { success: false, error: `Template "${key}" not found` }
        return
      }
      fs.mkdirSync(projectPath, { recursive: true })
      copyDirectoryRecursive(absolutePath, projectPath)
      const scenesDir = path.join(projectPath, 'scenes')
      if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true })
      const metadata = {
        name,
        template: key,
        createdAt: new Date().toISOString(),
        resourcePath: 'res',
        assets: []
      }
      fs.writeFileSync(path.join(projectPath, 'retro-studio.json'), JSON.stringify(metadata, null, 2))
      event.returnValue = { success: true, path: projectPath }
    } catch (error) {
      console.error('Error creating project:', error)
      event.returnValue = { success: false, error: error.message }
    }
  })

  ipcMain.on('scan-resources', (event, projectPath) => {
    try {
      const result = scanResourcesFolder(projectPath)
      event.reply('scan-resources-result', result)
    } catch (error) {
      console.error('[IPC] Erro no handler scan-resources:', error)
      event.reply('scan-resources-result', { success: false, error: error.message, newAssets: [], unidentifiedAssets: [] })
    }
  })

  ipcMain.on('add-detected-assets', (event, { projectPath, assets }) => {
    try {
      const config = getProjectConfig(projectPath)
      if (!config.assets) config.assets = []
      for (const asset of assets) {
        const exists = config.assets.some(a => a.name === asset.name)
        if (!exists) config.assets.push(asset)
      }
      const configPath = path.join(projectPath, 'retro-studio.json')
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      event.reply('add-detected-assets-result', { success: true, config })
    } catch (error) {
      console.error('[IPC] Erro ao adicionar assets detectados:', error)
      event.reply('add-detected-assets-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('copy-asset-to-project', (event, data) => {
    try {
      const { projectPath, filename, buffer } = data
      const resDir = getResourcePath(projectPath)
      if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true })
      const assetPath = path.join(resDir, filename)
      fs.writeFileSync(assetPath, Buffer.from(buffer))
      const relativePath = path.relative(projectPath, assetPath)
      event.reply('copy-asset-result', { success: true, assetPath: relativePath })
    } catch (error) {
      console.error('[IPC] Erro ao copiar asset:', error)
      event.reply('copy-asset-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('register-asset-resource', (event, data) => {
    try {
      const { projectPath, resourceEntry, assetName } = data
      const resDir = getResourcePath(projectPath)
      const resourcesPath = path.join(resDir, 'resources.res')
      if (!fs.existsSync(resourcesPath)) {
        if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true })
        fs.writeFileSync(resourcesPath, '')
      }
      let content = fs.readFileSync(resourcesPath, 'utf-8')
      const lines = content.split('\n')
      const newParts = resourceEntry.split(/\s+/)
      const newResName = newParts[1]
      let entryUpdated = false
      const newLines = lines.map(line => {
        const trimmed = line.trim()
        if (!trimmed) return line
        const parts = trimmed.split(/\s+/)
        if (parts.length >= 2 && parts[1] === newResName) {
          entryUpdated = true
          return resourceEntry
        }
        return line
      })
      if (entryUpdated) {
        fs.writeFileSync(resourcesPath, newLines.join('\n'))
      } else {
        if (content && !content.endsWith('\n')) content += '\n'
        content += resourceEntry + '\n'
        fs.writeFileSync(resourcesPath, content)
      }
      event.reply('register-asset-result', { success: true, message: `Asset "${assetName}" registrado com sucesso` })
    } catch (error) {
      console.error('[IPC] Erro ao registrar asset:', error)
      event.reply('register-asset-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('get-res-files', (event, projectPath) => {
    try {
      const resDir = getResourcePath(projectPath)
      if (!fs.existsSync(resDir)) {
        event.reply('get-res-files-result', { success: true, files: [] })
        return
      }
      const getAllFiles = (dir) => {
        let files = []
        if (!fs.existsSync(dir)) return []
        const entries = fs.readdirSync(dir)
        for (const entry of entries) {
          const fullPath = path.join(dir, entry)
          const stats = fs.statSync(fullPath)
          if (stats.isFile()) {
            files.push(path.relative(projectPath, fullPath))
          } else if (stats.isDirectory()) {
            files.push(...getAllFiles(fullPath))
          }
        }
        return files
      }
      const files = getAllFiles(resDir)
      event.reply('get-res-files-result', { success: true, files: files })
    } catch (error) {
      console.error('[IPC] Erro ao obter arquivos recursivos:', error)
      event.reply('get-res-files-result', { success: false, error: error.message })
    }
  })

  ipcMain.on('get-palette-colors', (event, data) => {
    try {
      const { projectPath, assetPath } = data
      const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath)
      if (!fs.existsSync(fullPath)) throw new Error('Arquivo de paleta não encontrado')
      const ext = path.extname(fullPath).toLowerCase()
      let colors = []
      if (ext === '.pal') {
        const content = fs.readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')
        if (lines.length > 0 && lines[0] && lines[0].trim().startsWith('JASC-PAL')) {
          const count = parseInt(lines[2])
          for (let i = 0; i < count && 3 + i < lines.length; i++) {
            const parts = lines[3 + i].trim().split(/\s+/)
            if (parts.length >= 3) {
              const r = parseInt(parts[0]), g = parseInt(parts[1]), b = parseInt(parts[2])
              const hex = `#${[r,g,b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`
              colors.push({ r, g, b, hex })
            }
          }
        }
      } else if (ext === '.act') {
        const buffer = fs.readFileSync(fullPath)
        if (buffer.length >= 768) {
          for (let i = 0; i < 256; i++) {
            const r = buffer[i * 3], g = buffer[i * 3 + 1], b = buffer[i * 3 + 2]
            const hex = `#${[r,g,b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`
            colors.push({ r, g, b, hex })
          }
        }
      }
      event.reply('get-palette-colors-result', { success: true, colors: colors, assetPath: assetPath })
    } catch (error) {
      console.error('[IPC] Erro ao extrair cores:', error)
      event.reply('get-palette-colors-result', { success: false, error: error.message })
    }
  })

  ipcMain.handle('get-asset-preview', async (event, data) => {
    try {
      const { projectPath, assetPath } = data
      const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath)
      if (!fs.existsSync(fullPath)) return { success: false, error: 'Arquivo não encontrado' }
      const ext = path.extname(fullPath).toLowerCase()
      if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) {
        const buffer = fs.readFileSync(fullPath)
        const base64 = buffer.toString('base64')
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
        return { success: true, assetPath: assetPath, preview: `data:${mime};base64,${base64}` }
      }
      return { success: false, error: 'Tipo não suportado' }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-palette-colors', async (event, data) => {
    try {
      const { projectPath, assetPath } = data
      const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath)
      if (!fs.existsSync(fullPath)) return { success: false, error: 'Não encontrado' }
      const ext = path.extname(fullPath).toLowerCase()
      let colors = []
      if (ext === '.pal') {
        const content = fs.readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')
        if (lines.length > 0 && lines[0] && lines[0].trim().startsWith('JASC-PAL')) {
          const count = parseInt(lines[2])
          for (let i = 0; i < count && 3 + i < lines.length; i++) {
            const parts = lines[3 + i].trim().split(/\s+/)
            if (parts.length >= 3) {
              colors.push({ r: parseInt(parts[0]), g: parseInt(parts[1]), b: parseInt(parts[2]), hex: `#${parts.slice(0,3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase() })
            }
          }
        }
      }
      return { success: true, colors, assetPath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.on('get-asset-preview', (event, data) => {
    try {
      const { projectPath, assetPath } = data
      const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath)
      if (!fs.existsSync(fullPath)) throw new Error('Arquivo não encontrado')
      const ext = path.extname(fullPath).toLowerCase()
      if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) {
        const buffer = fs.readFileSync(fullPath)
        const base64 = buffer.toString('base64')
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
        event.reply('get-asset-preview-result', { success: true, assetPath: assetPath, preview: `data:${mime};base64,${base64}` })
      } else {
        event.reply('get-asset-preview-result', { success: false, assetPath: assetPath, error: 'Tipo de arquivo não suportado' })
      }
    } catch (error) {
      console.error('[IPC] Erro ao obter preview:', error)
      event.reply('get-asset-preview-result', { success: false, assetPath: data.assetPath, error: error.message })
    }
  })

  ipcMain.on('rename-asset-file', (event, data) => {
    try {
      const { projectPath, oldFileName, newName, oldPath } = data
      const resDir = getResourcePath(projectPath)
      let realOldFilePath = oldPath ? path.join(projectPath, oldPath) : path.join(resDir, oldFileName)
      if (!fs.existsSync(realOldFilePath)) {
        const getAllFiles = (dir) => {
          const files = []
          const entries = fs.readdirSync(dir)
          for (const entry of entries) {
            const fullPath = path.join(dir, entry)
            if (fs.statSync(fullPath).isFile()) {
              if (path.basename(fullPath) === oldFileName) files.push(fullPath)
            } else {
              files.push(...getAllFiles(fullPath))
            }
          }
          return files
        }
        const foundFiles = getAllFiles(resDir)
        if (foundFiles.length > 0) realOldFilePath = foundFiles[0]
      }
      if (!realOldFilePath || !fs.existsSync(realOldFilePath)) {
        event.reply('rename-asset-result', { success: false, error: `Arquivo "${oldFileName}" não encontrado.` })
        return
      }
      const extension = path.extname(realOldFilePath)
      const newFileName = newName.includes('.') ? newName : (newName + extension)
      const newFilePath = path.join(path.dirname(realOldFilePath), newFileName)
      if (fs.existsSync(newFilePath)) {
        event.reply('rename-asset-result', { success: false, error: 'Já existe um arquivo com este nome' })
        return
      }
      fs.renameSync(realOldFilePath, newFilePath)
      // Update .res files
      const getAllResFiles = (dir) => {
        let results = []
        const list = fs.readdirSync(dir)
        list.forEach(file => {
          file = path.join(dir, file)
          if (fs.statSync(file).isDirectory()) results = results.concat(getAllResFiles(file))
          else if (file.endsWith('.res')) results.push(file)
        })
        return results
      }
      const resFiles = getAllResFiles(resDir)
      resFiles.forEach(resFile => {
        let content = fs.readFileSync(resFile, 'utf-8')
        if (content.includes(oldFileName)) {
          content = content.split(oldFileName).join(newFileName)
          fs.writeFileSync(resFile, content)
        }
      })
      event.reply('rename-asset-result', { success: true, oldFileName, newFileName, newPath: path.relative(projectPath, newFilePath) })
    } catch (error) {
      console.error('[IPC] Erro ao renomear arquivo:', error)
      event.reply('rename-asset-result', { success: false, error: error.message })
    }
  })

  ipcMain.handle('find-definition-in-project', async (event, { projectPath, symbolName }) => {
    try {
      if (!projectPath || !fs.existsSync(projectPath)) return null
      
      const srcPath = path.join(projectPath, 'src')
      if (!fs.existsSync(srcPath)) return null
      
      const searchInDir = (dir) => {
        const files = fs.readdirSync(dir)
        for (const file of files) {
          const fullPath = path.join(dir, file)
          const stats = fs.statSync(fullPath)
          
          if (stats.isDirectory()) {
            const result = searchInDir(fullPath)
            if (result) return result
          } else if (file.endsWith('.c') || file.endsWith('.h')) {
            const content = fs.readFileSync(fullPath, 'utf-8')
            const funcRegex = new RegExp(`(?:^|\\n)\\s*(?:(?:static|inline|extern|volatile)\\s+)*(?:[\\w*]+\\s+)+${symbolName}\\s*\\([^)]*\\)\\s*\\{`, 'm')
            const funcMatch = funcRegex.exec(content)
            
            if (funcMatch) {
              const linesBefore = content.substring(0, funcMatch.index).split('\n')
              return { path: fullPath, line: linesBefore.length, column: linesBefore[linesBefore.length - 1].length + 1 }
            }

            const defineRegex = new RegExp(`^\\s*#define\\s+${symbolName}\\b`, 'm')
            const defineMatch = defineRegex.exec(content)
            if (defineMatch) {
              const linesBefore = content.substring(0, defineMatch.index).split('\n')
              return { path: fullPath, line: linesBefore.length, column: linesBefore[linesBefore.length - 1].indexOf(symbolName) + 1 }
            }

            const varRegex = new RegExp(`(?:^|\\n)\\s*(?:(?:static|extern|volatile|const)\\s+)*(?:[a-zA-Z_]\\w*\\*?\\s+)+${symbolName}\\s*(?:[=;|,])`, 'm')
            const varMatch = varRegex.exec(content)
            if (varMatch) {
              const linesBefore = content.substring(0, varMatch.index).split('\n')
              return { path: fullPath, line: linesBefore.length, column: linesBefore[linesBefore.length - 1].indexOf(symbolName) + 1 }
            }
          }
        }
        return null
      }
      
      return searchInDir(srcPath)
    } catch (error) {
      console.error('Error in find-definition-in-project:', error)
      return null
    }
  })
}
