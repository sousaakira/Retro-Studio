import { ipcMain, dialog } from 'electron'
import { importProjectAsset, registerResourceEntry } from './assetImport.js'
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
import { installCutsceneRuntime } from './cutsceneRuntime.js'
import { installRuntimeModules } from './runtimeInstaller.js'
import { installNewProjectRuntime, recordNewProjectToolchain, validateModuleSelection } from './newProject.js'
import { copyProjectTemplate, prepareNewProject, inspectProjectTemplate } from './starterProject.js'
import { writeProjectAsset } from './projectAssets.js'
import { clangdManager } from './clangdLsp.js'

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
    let created = null
    try {
      const { name, path: basePath, template, modules } = projectData
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
      validateModuleSelection(modules)
      const descriptor = inspectProjectTemplate(absolutePath)
      fs.mkdirSync(projectPath, { recursive: true })
      created = projectPath
      copyProjectTemplate(absolutePath, projectPath, copyDirectoryRecursive)
      installNewProjectRuntime(projectPath, modules, descriptor?.requires)
      // Every new game ships the generic cutscene runtime; failure must not block creation.
      try { installCutsceneRuntime(projectPath) } catch (error) { console.warn('[Retro] Runtime de cutscenes não instalado:', error.message) }
      const scenesDir = path.join(projectPath, 'scenes')
      if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true })
      const mapsDir = path.join(projectPath, 'maps')
      if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true })
      const charsetsDir = path.join(projectPath, 'charsets')
      if (!fs.existsSync(charsetsDir)) fs.mkdirSync(charsetsDir, { recursive: true })
      const metadata = {
        name,
        template: key,
        createdAt: new Date().toISOString(),
        resourcePath: 'res',
        assets: []
      }
      const templateConfigPath = path.join(absolutePath, 'retro-studio.json')
      if (fs.existsSync(templateConfigPath)) {
        const templateConfig = JSON.parse(fs.readFileSync(templateConfigPath, 'utf-8'))
        if (templateConfig.mapExport) metadata.mapExport = templateConfig.mapExport
        if (templateConfig.retroStudio) metadata.retroStudio = structuredClone(templateConfig.retroStudio)
      }
      fs.writeFileSync(path.join(projectPath, 'retro-studio.json'), JSON.stringify(metadata, null, 2))
      // Templates such as the playable starter export their generated files now.
      const prepared = await prepareNewProject(projectPath)
      const toolchain = recordNewProjectToolchain(projectPath, loadConfigFile('ui-settings.json', {}).toolkitPath)
      return { success: true, path: projectPath, toolchain, prepared }
    } catch (error) {
      console.error('[Retro] Error creating project:', error)
      // A project that failed halfway is removed: only the folder this call created.
      if (created) { try { fs.rmSync(created, { recursive: true, force: true }) } catch { /* reported below */ } }
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
      const existingIndex = config.assets.findIndex((item) => item.id === asset.id || (asset.path && item.path === asset.path))
      if (existingIndex >= 0) {
        config.assets[existingIndex] = { ...config.assets[existingIndex], ...asset, id: config.assets[existingIndex].id || asset.id }
      } else {
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
      const projectDirectory = path.resolve(projectPath)
      const projectRoot = fs.realpathSync(projectDirectory)
      const requestedPath = path.resolve(projectDirectory, assetPath)
      const requestedRelative = path.relative(projectDirectory, requestedPath)
      if (requestedRelative === '..' || requestedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(requestedRelative)) {
        return { success: false, error: 'O arquivo precisa estar dentro do projeto' }
      }
      if (!fs.existsSync(requestedPath)) return { success: false, error: 'Arquivo não encontrado' }
      const fullPath = fs.realpathSync(requestedPath)
      const relative = path.relative(projectRoot, fullPath)
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return { success: false, error: 'O arquivo precisa estar dentro do projeto' }
      }
      const ext = path.extname(fullPath).toLowerCase()
      if (['.ogg', '.wav', '.mp3'].includes(ext)) {
        const size = fs.statSync(fullPath).size
        if (size > 16 * 1024 * 1024) return { success: false, error: 'A prévia de áudio excede 16 MB' }
        const mime = { '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }[ext]
        return { success: true, assetPath, preview: `data:${mime};base64,${fs.readFileSync(fullPath).toString('base64')}` }
      }
      if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) {
        const buffer = fs.readFileSync(fullPath)
        const base64 = buffer.toString('base64')
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp' }[ext]
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
      const config = getProjectConfig(projectPath)
      const result = writeProjectAsset(projectPath, config.resourcePath || 'res', filename, buffer)
      return { success: true, ...result }
    } catch (error) {
      console.error('[Retro] copy-asset error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('retro:update-tilemap-resource-entry', async (_event, { projectPath, tmxRelPath, mapName, includeFg = true }) => {
    try {
      const resDir = getResourcePath(projectPath)
      const resourcesPath = path.join(resDir, 'resources.res')
      const bgEntry = `MAP ${mapName} "${tmxRelPath}" "Tile Layer 1" NONE NONE`
      const fgName = mapName.replace(/_MAP$/i, '') + '_FG_MAP'
      const fgEntry = `MAP ${fgName} "${tmxRelPath}" "Tile Layer 2" NONE NONE`
      const entries = includeFg ? [bgEntry, fgEntry] : [bgEntry]

      if (!fs.existsSync(resourcesPath)) {
        if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true })
        fs.writeFileSync(resourcesPath, entries.join('\n') + '\n')
        return { success: true }
      }
      let content = fs.readFileSync(resourcesPath, 'utf-8')
      const lines = content.split('\n')
      const names = new Set(entries.map((e) => e.split(/\s+/)[1]))
      const kept = lines.filter((line) => {
        const trimmed = line.trim()
        if (!trimmed) return true
        const parts = trimmed.split(/\s+/)
        if (parts.length >= 2 && parts[0] === 'MAP' && names.has(parts[1])) return false
        return true
      })
      while (kept.length && kept[kept.length - 1].trim() === '') kept.pop()
      const next = kept.join('\n').trimEnd() + '\n' + entries.join('\n') + '\n'
      fs.writeFileSync(resourcesPath, next)
      return { success: true }
    } catch (e) {
      console.error('[Retro] update-tilemap-resource error:', e)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('retro:register-asset-resource', async (_event, { projectPath, resourceEntry, assetName } = {}) => {
    // #42: one line per file; a symbol that already names ANOTHER file is never rewritten.
    try { return { success: true, ...registerResourceEntry(projectPath, resourceEntry), message: `Asset "${assetName}" registrado` } }
    catch (error) {
      console.error('[Retro] register-asset error:', error.message)
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
        } catch (e) { }
        return null
      }
      return searchInDir(srcPath)
    } catch (error) {
      console.error('[Retro] find-definition error:', error)
      return null
    }
  })

  ipcMain.handle('retro:lsp-status', async (_event, options = {}) => {
    return clangdManager.status(options.clangdPath || undefined)
  })

  ipcMain.handle('retro:lsp-ensure-flags', async (_event, { projectPath }) => {
    try {
      return { success: true, ...(await clangdManager.ensureFlags(projectPath)) }
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('retro:lsp-sync', async (_event, payload) => {
    try {
      return await clangdManager.sync(payload)
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('retro:lsp-definition', async (_event, payload) => {
    try {
      return await clangdManager.definition(payload)
    } catch (e) {
      console.warn('[Retro] lsp-definition:', e?.message || e)
      return null
    }
  })

  ipcMain.handle('retro:lsp-stop', async (_event, { projectPath } = {}) => {
    await clangdManager.stop(projectPath)
    return { ok: true }
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
      clangdPath: '',
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

  ipcMain.handle('retro:read-image-file', async (_event, filePath) => {
    try {
      if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Caminho de imagem inválido')
      const fullPath = fs.realpathSync(filePath)
      const ext = path.extname(fullPath).toLowerCase()
      const mime = { '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp' }[ext]
      if (!mime) throw new Error('Formato de imagem não suportado')
      const stats = fs.statSync(fullPath)
      if (!stats.isFile()) throw new Error('O caminho selecionado não é um arquivo')
      if (stats.size > 64 * 1024 * 1024) throw new Error('A imagem excede o limite de 64 MB')
      return { success: true, name: path.basename(fullPath), size: stats.size, mime, base64: fs.readFileSync(fullPath).toString('base64') }
    } catch (error) {
      return { success: false, error: error.message }
    }
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

  ipcMain.handle('retro:import-asset-from-path', async (_event, { projectPath, assetPath, asset } = {}) => {
    // #42: never overwrites other content, reuses identical files and records the origin.
    try { return importProjectAsset(projectPath, assetPath, { type: typeof asset?.type === 'string' ? asset.type : '' }) }
    catch (e) {
      console.error('[Retro] import-asset-from-path error:', e.message)
      return { success: false, error: e.message }
    }
  })
}
