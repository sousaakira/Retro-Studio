import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { loadConfigFile, saveConfigFile, TOOLKIT_DIR } from './utils.js'

const LAST_DIR_KEY = 'file-dialog-paths'

function getLastDir(context) {
  if (!context) return null
  const data = loadConfigFile(LAST_DIR_KEY, {})
  const dir = data[context]
  return dir && fs.existsSync(dir) ? dir : null
}

function saveLastDir(context, filePath) {
  if (!context || !filePath) return
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) return
  const data = loadConfigFile(LAST_DIR_KEY, {})
  data[context] = dir
  saveConfigFile(LAST_DIR_KEY, data)
}
import {
  getProjectConfig,
  lerDiretorio,
  getTemplatePath
} from './projectUtils.js'
import {
  scanResourcesFolder,
  getResourcePath
} from './assetUtils.js'
import { copyDirectoryRecursive } from './utils.js'

export function setupProjectHandlers() {
  ipcMain.handle('retro:req-project', async (_event, result) => {
    const estrutura = lerDiretorio(result.path)
    const config = getProjectConfig(result.path)
    return { estrutura, config }
  })

  ipcMain.handle('retro:get-project-config', async (_event, projectPath) => {
    return getProjectConfig(projectPath)
  })

  ipcMain.handle('retro:is-retro-project', async (_event, projectPath) => {
    if (!projectPath) return false
    const configPath = path.join(projectPath, 'retro-studio.json')
    const makefilePath = path.join(projectPath, 'Makefile')
    return fs.existsSync(configPath) || fs.existsSync(makefilePath)
  })

  ipcMain.handle('retro:create-project', async (_event, projectData) => {
    try {
      const { name, path: basePath, template } = projectData
      if (!name || !basePath) {
        return { success: false, error: 'Name and path are required' }
      }
      const projectPath = path.join(basePath, name)
      if (fs.existsSync(projectPath)) {
        return { success: false, error: 'Directory already exists' }
      }
      const { absolutePath, key } = getTemplatePath(template)
      if (!absolutePath || !fs.existsSync(absolutePath)) {
        return { success: false, error: `Template "${key}" not found` }
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
      return { success: true, path: projectPath }
    } catch (error) {
      console.error('[Retro] Error creating project:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:scan-resources', async (_event, projectPath) => {
    try {
      return scanResourcesFolder(projectPath)
    } catch (error) {
      console.error('[Retro] scan-resources error:', error)
      return { success: false, error: error.message, newAssets: [], unidentifiedAssets: [] }
    }
  })

  ipcMain.handle('retro:add-asset-to-config', async (_event, { projectPath, asset }) => {
    try {
      const config = getProjectConfig(projectPath)
      if (!config.assets) config.assets = []
      if (!config.assets.some((a) => a.id === asset.id)) {
        config.assets.push(asset)
      }
      const configPath = path.join(projectPath, 'retro-studio.json')
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      return { success: true, config }
    } catch (error) {
      console.error('[Retro] add-asset error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:save-project-config', async (_event, { projectPath, config }) => {
    try {
      const configPath = path.join(projectPath, 'retro-studio.json')
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      return { success: true }
    } catch (error) {
      console.error('[Retro] save-project-config error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:get-asset-preview', async (_event, { projectPath, assetPath }) => {
    try {
      const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath)
      if (!fs.existsSync(fullPath)) return { success: false, error: 'Arquivo não encontrado' }
      const ext = path.extname(fullPath).toLowerCase()
      if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) {
        const buffer = fs.readFileSync(fullPath)
        const base64 = buffer.toString('base64')
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
        return { success: true, assetPath, preview: `data:${mime};base64,${base64}` }
      }
      return { success: false, error: 'Tipo não suportado' }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:get-palette-colors', async (_event, { projectPath, assetPath }) => {
    try {
      const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath)
      if (!fs.existsSync(fullPath)) return { success: false, error: 'Não encontrado' }
      const ext = path.extname(fullPath).toLowerCase()
      const colors = []
      if (ext === '.pal') {
        const content = fs.readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')
        if (lines[0]?.trim().startsWith('JASC-PAL')) {
          const count = parseInt(lines[2])
          for (let i = 0; i < count && 3 + i < lines.length; i++) {
            const parts = lines[3 + i].trim().split(/\s+/)
            if (parts.length >= 3) {
              colors.push({
                r: parseInt(parts[0]),
                g: parseInt(parts[1]),
                b: parseInt(parts[2]),
                hex: `#${parts.slice(0, 3).map((x) => parseInt(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
              })
            }
          }
        }
      }
      return { success: true, colors, assetPath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:copy-asset-to-project', async (_event, { projectPath, filename, buffer }) => {
    try {
      const resDir = getResourcePath(projectPath)
      if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true })
      const assetPath = path.join(resDir, filename)
      fs.writeFileSync(assetPath, Buffer.from(buffer))
      return { success: true, assetPath: path.relative(projectPath, assetPath) }
    } catch (error) {
      console.error('[Retro] copy-asset error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:register-asset-resource', async (_event, { projectPath, resourceEntry, assetName }) => {
    try {
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
      const newLines = lines.map((line) => {
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
      return { success: true, message: `Asset "${assetName}" registrado` }
    } catch (error) {
      console.error('[Retro] register-asset error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:remove-asset-from-config', async (_event, { projectPath, assetId }) => {
    try {
      const config = getProjectConfig(projectPath)
      if (!config.assets) config.assets = []
      config.assets = config.assets.filter((a) => a.id !== assetId)
      fs.writeFileSync(path.join(projectPath, 'retro-studio.json'), JSON.stringify(config, null, 2))
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:rename-asset-file', async (_event, { projectPath, oldFileName, newName, oldPath }) => {
    try {
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
        return { success: false, error: `Arquivo "${oldFileName}" não encontrado.` }
      }
      const extension = path.extname(realOldFilePath)
      const newFileName = newName.includes('.') ? newName : newName + extension
      const newFilePath = path.join(path.dirname(realOldFilePath), newFileName)
      if (fs.existsSync(newFilePath)) {
        return { success: false, error: 'Já existe um arquivo com este nome' }
      }
      fs.renameSync(realOldFilePath, newFilePath)
      const getAllResFiles = (dir) => {
        let results = []
        const list = fs.readdirSync(dir)
        list.forEach((file) => {
          file = path.join(dir, file)
          if (fs.statSync(file).isDirectory()) results = results.concat(getAllResFiles(file))
          else if (file.endsWith('.res')) results.push(file)
        })
        return results
      }
      const resFiles = getAllResFiles(resDir)
      resFiles.forEach((resFile) => {
        let content = fs.readFileSync(resFile, 'utf-8')
        if (content.includes(oldFileName)) {
          content = content.split(oldFileName).join(newFileName)
          fs.writeFileSync(resFile, content)
        }
      })
      return { success: true, oldFileName, newFileName, newPath: path.relative(projectPath, newFilePath) }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:find-definition', async (_event, { projectPath, symbolName }) => {
    try {
      if (!projectPath || !fs.existsSync(projectPath)) return null
      const srcPath = path.join(projectPath, 'src')
      if (!fs.existsSync(srcPath)) return null

      const searchInDir = (dir) => {
        try {
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
                const contentBefore = content.substring(0, funcMatch.index + funcMatch[0].indexOf(symbolName))
                const lines = contentBefore.split('\n')
                return { path: fullPath, line: lines.length, column: lines[lines.length - 1].length + 1 }
              }
              const defineRegex = new RegExp(`^\\s*#define\\s+${symbolName}\\b`, 'm')
              const defineMatch = defineRegex.exec(content)
              if (defineMatch) {
                const contentBefore = content.substring(0, defineMatch.index + defineMatch[0].indexOf(symbolName))
                const lines = contentBefore.split('\n')
                return { path: fullPath, line: lines.length, column: lines[lines.length - 1].length + 1 }
              }
            }
          }
        } catch (e) {}
        return null
      }
      return searchInDir(srcPath)
    } catch (error) {
      console.error('[Retro] find-definition error:', error)
      return null
    }
  })

  ipcMain.handle('retro:select-folder', async (_event, options = {}) => {
    const context = options.context || 'folder'
    const defaultPath = options.defaultPath || getLastDir(context)
    const result = await dialog.showOpenDialog({
      title: options.title || 'Selecionar pasta',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory']
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const selected = result.filePaths[0]
      saveLastDir(context, selected)
      return { path: selected }
    }
    return null
  })

  ipcMain.handle('retro:get-ui-settings', async () => {
    const defaults = {
      toolkitPath: '',
      imageEditorPath: '',
      mapEditorPath: '',
      enableVisualMode: false,
      cartridgeVendorId: '0x2e8a',
      cartridgeBaudRate: '115200',
      cartridgeChunkSize: 1024,
      cartridgeSwapEndianness: true
    }
    const settings = { ...defaults, ...loadConfigFile('ui-settings.json', {}) }
    if (!settings.toolkitPath) {
      const defaultToolkitPath = path.join(TOOLKIT_DIR, 'marsdev', 'mars')
      if (fs.existsSync(defaultToolkitPath)) {
        settings.toolkitPath = defaultToolkitPath
      }
    }
    return settings
  })

  ipcMain.handle('retro:save-ui-settings', async (_event, settings) => {
    const current = loadConfigFile('ui-settings.json', {})
    const merged = { ...current, ...settings }
    saveConfigFile('ui-settings.json', merged)
    return { success: true }
  })

  ipcMain.handle('retro:open-external-editor', async (_event, { editorPath, filePath }) => {
    if (!editorPath || !filePath) return { success: false }
    try {
      const { spawn } = await import('child_process')
      spawn(editorPath, [filePath], { detached: true, stdio: 'ignore' }).unref()
      return { success: true }
    } catch (e) {
      console.error('[Retro] open-external-editor error:', e)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('retro:select-file', async (_event, options = {}) => {
    const context = options.context || 'file'
    const defaultPath = options.defaultPath || getLastDir(context)
    const result = await dialog.showOpenDialog({
      title: options.title || 'Selecionar arquivo',
      defaultPath: defaultPath || undefined,
      properties: options.multiSelections ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options.filters || [
        { name: 'Executáveis', extensions: ['exe', 'bin', 'app'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const selected = result.filePaths[0]
      saveLastDir(context, selected)
      return {
        path: result.filePaths.length === 1 ? selected : undefined,
        paths: result.filePaths,
        success: true
      }
    }
    return { success: false }
  })

  ipcMain.handle('retro:select-save-file', async (_event, options = {}) => {
    const context = options.context || 'save'
    const defaultPath = options.defaultPath || getLastDir(context)
    const result = await dialog.showSaveDialog({
      title: options.title || 'Salvar como',
      defaultPath: defaultPath || undefined,
      filters: options.filters || [
        { name: 'TMX', extensions: ['tmx'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    })
    if (!result.canceled && result.filePath) {
      let outPath = result.filePath
      if (options.filters?.[0]?.extensions?.includes('tmx') && !outPath.toLowerCase().endsWith('.tmx')) {
        outPath += '.tmx'
      }
      saveLastDir(context, outPath)
      return { path: outPath, success: true }
    }
    return { success: false }
  })

  ipcMain.handle('retro:select-multiple-files', async (_event, options = {}) => {
    const context = options.context || 'asset-import'
    const defaultPath = options.defaultPath || getLastDir(context)
    const result = await dialog.showOpenDialog({
      title: options.title || 'Selecionar arquivos',
      defaultPath: defaultPath || undefined,
      properties: ['openFile', 'multiSelections'],
      filters: options.filters || [
        { name: 'Imagens e recursos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tmx', 'pal', 'wav', 'vgm'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      saveLastDir(context, result.filePaths[0])
      return { paths: result.filePaths, success: true }
    }
    return { success: false, paths: [] }
  })

  ipcMain.handle('retro:import-asset-from-path', async (_event, { projectPath, assetPath, asset }) => {
    try {
      const buffer = fs.readFileSync(assetPath)
      const filename = path.basename(assetPath)
      const resDir = getResourcePath(projectPath)
      if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true })
      const destPath = path.join(resDir, filename)
      fs.writeFileSync(destPath, buffer)
      const assetPathInProject = path.relative(projectPath, destPath).replace(/\\/g, '/')
      const typeMap = { sprite: 'IMAGE', tile: 'IMAGE', tilemap: 'TILEMAP', palette: 'PALETTE', sound: 'SOUND', background: 'IMAGE', scene: 'TILEMAP' }
      const type = typeMap[asset?.type] || 'IMAGE'
      const baseName = filename.replace(/\.\w+$/, '')
      const resourceName = baseName.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
      const resourceEntry = `${type} ${resourceName} "${filename}" 0`
      const resourcesPath = path.join(resDir, 'resources.res')
      if (!fs.existsSync(resourcesPath)) fs.writeFileSync(resourcesPath, '')
      let content = fs.readFileSync(resourcesPath, 'utf-8')
      const entryExists = content.split('\n').some((l) => l.trim().split(/\s+/)[1] === resourceName)
      if (!entryExists) {
        content = content.trim() ? content + '\n' + resourceEntry + '\n' : resourceEntry + '\n'
        fs.writeFileSync(resourcesPath, content)
      }
      return { success: true, assetPath: assetPathInProject }
    } catch (e) {
      console.error('[Retro] import-asset-from-path error:', e)
      return { success: false, error: e.message }
    }
  })
}
