import { app, BrowserWindow, dialog, ipcMain, screen, Menu, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import pty from 'node-pty'
import { AIAgent, toolExecutor, toolDefinitions, CHAT_MODES } from './ai/index.js'
import { setupRetroHandlers } from './retro/index.js'

const execAsync = promisify(exec)

const isDev = !app.isPackaged

/**
 * Tenta extrair um caminho de diretório dos argumentos da linha de comando
 */
async function getPathFromArgv(argv) {
  // Ignora o primeiro argumento (executável)
  // Se estiver em dev, ignora também o segundo argumento (script do vite/electron)
  const startIndex = isDev ? 2 : 1
  const userArgs = argv.slice(startIndex)
  
  // Procuramos por algo que pareça um caminho absoluto ou relativo existente
  for (const arg of userArgs) {
    if (arg.startsWith('-')) continue // Pula flags como --remote-debugging-port
    
    try {
      // Resolve caminhos relativos ao diretório atual de execução
      const resolvedPath = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg)
      
      if (existsSync(resolvedPath)) {
        const stat = await fs.stat(resolvedPath)
        if (stat.isDirectory()) {
          return resolvedPath
        } else {
          // Se for arquivo, pegamos o diretório pai
          return path.dirname(resolvedPath)
        }
      }
    } catch {
      // Ignora argumentos que não são caminhos válidos
    }
  }
  return null
}

// ===== DEBUG CONFIGURATION =====
const DEBUG = {
  enabled: true,
  level: isDev ? 'verbose' : 'info', // 'error' | 'info' | 'verbose'
  file: true // Log to file
}

const log = (level, context, message, data = null) => {
  const levels = { error: 0, info: 1, verbose: 2 }
  if (levels[level] > levels[DEBUG.level]) return
  
  const timestamp = new Date().toISOString()
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${context}]`
  const output = data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`
  
  if (level === 'error') console.error(output)
  else if (level === 'info') console.log(output)
  else console.log(output)
}

let currentWorkspacePath = null
let mainWindow = null // Referência global para a janela principal
const tilemapWindowData = new Map() // webContentsId -> { asset, projectPath, assets }

// Terminal PTY instances
const terminals = new Map()

// ===== Config Management =====
const CONFIG_DIR_NAME = '.retrostudio'
const SETTINGS_FILE_NAME = 'settings.json'

const defaultSettings = {
  editor: {
    fontSize: 14,
    wordWrap: 'off',
    tabSize: 2,
    minimap: true,
    lineNumbers: 'on'
  },
  appearance: {
    theme: 'dark',
    windowControlsPosition: 'left'
  },
  terminal: {
    fontSize: 13,
    fontFamily: 'monospace',
    cursorBlink: true,
    cursorStyle: 'block'
  },
  panels: {
    aiChat: { open: false, width: 400 },
    terminal: { open: false, height: 250 },
    sidebar: { width: 280 }
  },
  aiProviders: {
    vllm: {
      name: 'vLLM / Local',
      endpoint: 'http://localhost:8000/v1/chat/completions',
      modelsUrl: 'http://localhost:8000/v1/models',
      needsApiKey: false,
      defaultModel: 'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ'
    },
    // DashScope: baseURL + /chat/completions (OpenAI compatible)
    // Doc: https://www.alibabacloud.com/help/en/model-studio/get-api-key
    // Singapore/Virginia: dashscope-intl | Beijing: dashscope (chaves diferentes por região)
    dashscope: {
      name: 'DashScope (Qwen) Internacional',
      endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      modelsUrl: null,
      needsApiKey: true,
      defaultModel: 'qwen-plus',
      models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-coder', 'qwen3-8b', 'qwen3-32b']
    },
    'dashscope-cn': {
      name: 'DashScope (Qwen) China',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      modelsUrl: null,
      needsApiKey: true,
      defaultModel: 'qwen-plus',
      models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-coder', 'qwen3-8b', 'qwen3-32b']
    }
  },
  ai: {
    provider: 'vllm',
    apiKey: '',
    endpoint: 'https://ia.auth.com.br/v1/chat/completions',
    model: 'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ',
    temperature: 0.2,
    maxTokens: 1024
  },
  recentWorkspaces: [] // Lista de workspaces recentes (máx 10)
}

function getConfigDir() {
  return path.join(os.homedir(), CONFIG_DIR_NAME)
}

function getSettingsPath() {
  return path.join(getConfigDir(), SETTINGS_FILE_NAME)
}

async function ensureConfigDir() {
  const configDir = getConfigDir()
  try {
    await fs.access(configDir)
  } catch {
    await fs.mkdir(configDir, { recursive: true })
  }
  return configDir
}

async function loadSettings() {
  try {
    const settingsPath = getSettingsPath()
    await fs.access(settingsPath)
    const content = await fs.readFile(settingsPath, 'utf8')
    const parsed = JSON.parse(content)
    // Merge with defaults to ensure all keys exist
    return {
      editor: { ...defaultSettings.editor, ...parsed.editor },
      appearance: { ...defaultSettings.appearance, ...parsed.appearance },
      terminal: { ...defaultSettings.terminal, ...parsed.terminal },
      panels: {
        aiChat: { ...defaultSettings.panels.aiChat, ...parsed.panels?.aiChat },
        terminal: { ...defaultSettings.panels.terminal, ...parsed.panels?.terminal },
        sidebar: { ...defaultSettings.panels.sidebar, ...parsed.panels?.sidebar }
      },
      ai: { ...defaultSettings.ai, ...parsed.ai },
      recentWorkspaces: parsed.recentWorkspaces || []
    }
  } catch {
    // File doesn't exist or is invalid, create with defaults
    await ensureConfigDir()
    const settingsPath = getSettingsPath()
    const content = JSON.stringify(defaultSettings, null, 2)
    await fs.writeFile(settingsPath, content, 'utf8')
    return { ...defaultSettings }
  }
}

async function saveSettings(settings) {
  await ensureConfigDir()
  const settingsPath = getSettingsPath()
  const content = JSON.stringify(settings, null, 2)
  await fs.writeFile(settingsPath, content, 'utf8')
  return settings
}

/**
 * Adiciona um workspace à lista de recentes
 */
async function addRecentWorkspace(workspacePath) {
  if (!workspacePath) return
  
  const settings = await loadSettings()
  const recents = settings.recentWorkspaces || []
  
  // Remove se já existe (para reordenar)
  const filtered = recents.filter(w => w.path !== workspacePath)
  
  // Adiciona no início
  filtered.unshift({
    path: workspacePath,
    name: path.basename(workspacePath),
    lastOpened: new Date().toISOString()
  })
  
  // Limita a 10 recentes
  settings.recentWorkspaces = filtered.slice(0, 10)
  
  await saveSettings(settings)
  return settings.recentWorkspaces
}

/**
 * Retorna o último workspace aberto
 */
async function getLastWorkspace() {
  const settings = await loadSettings()
  const recents = settings.recentWorkspaces || []
  return recents.length > 0 ? recents[0] : null
}

function assertWorkspaceSelected() {
  if (!currentWorkspacePath) {
    throw new Error('No workspace selected')
  }
  return currentWorkspacePath
}

function assertPathInsideWorkspace(filePath) {
  const workspacePath = assertWorkspaceSelected()
  const resolvedWorkspace = path.resolve(workspacePath)
  const resolvedFile = path.resolve(filePath)

  const wsWithSep = resolvedWorkspace.endsWith(path.sep) ? resolvedWorkspace : resolvedWorkspace + path.sep
  if (resolvedFile !== resolvedWorkspace && !resolvedFile.startsWith(wsWithSep)) {
    throw new Error('Path is outside workspace')
  }

  return resolvedFile
}

function assertValidName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Invalid name')
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new Error('Name must not include path separators')
  }
  return name.trim()
}

function parseGitStatus(status) {
  const X = status[0]
  const Y = status[1]
  
  // Status codes: https://git-scm.com/docs/git-status#_short_format
  if (X === '?' && Y === '?') return 'untracked'
  if (X === 'A') return 'added'
  if (X === 'M' || Y === 'M') return 'modified'
  if (X === 'D' || Y === 'D') return 'deleted'
  if (X === 'R') return 'renamed'
  if (X === 'C') return 'copied'
  if (X === 'U' || Y === 'U') return 'conflict'
  return 'unknown'
}

async function buildTree(rootPath) {
  const stat = await fs.stat(rootPath)
  const name = path.basename(rootPath)

  if (!stat.isDirectory()) {
    return { name, path: rootPath, kind: 'file' }
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true })

  const children = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith('.'))
      .map(async (e) => {
        const p = path.join(rootPath, e.name)
        if (e.isDirectory()) return buildTree(p)
        return { name: e.name, path: p, kind: 'file' }
      })
  )

  children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return { name, path: rootPath, kind: 'dir', children }
}

function createWindow() {
  log('info', 'electron:createWindow', '🪟 Criando nova janela')
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { x: waX, y: waY, width: waW, height: waH } = display.workArea
  log('verbose', 'electron:createWindow', 'Dimensões da tela', { x: waX, y: waY, w: waW, h: waH })

  const desiredWidth = 1530
  const desiredHeight = 760
  const width = Math.min(desiredWidth, waW)
  const height = Math.min(desiredHeight, waH)
  const x = waX + Math.round((waW - width) / 2)
  const y = waY + Math.round((waH - height) / 2)

  // Caminho do ícone (SVG convertido para PNG)
  const iconPath = path.join(app.getAppPath(), 'assets', 'icons', 'icon.png')
  const iconSvgPath = path.join(app.getAppPath(), 'assets', 'icons', 'icon.svg')
  log('verbose', 'electron:createWindow', 'Caminho do ícone', { iconPath, existe: existsSync(iconPath) })

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    backgroundColor: '#0f111a',
    icon: existsSync(iconPath) ? iconPath : (existsSync(iconSvgPath) ? iconSvgPath : undefined),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs')
    }
  })
  log('info', 'electron:createWindow', '✅ BrowserWindow criado')

  mainWindow = win // Salva referência global

  // Log quando o arquivo é carregado
  win.webContents.on('did-start-loading', () => {
    log('info', 'electron:renderer', '📄 Começando a carregar página')
  })

  win.webContents.on('did-finish-load', () => {
    log('info', 'electron:renderer', '✅ Página carregada com sucesso')
  })

  win.webContents.on('did-fail-load', (evt, code, desc) => {
    log('error', 'electron:renderer', '❌ Erro ao carregar página', { code, desc })
  })

  // Capturar erros do console do renderer
  win.webContents.on('console-message', (level, message, line, sourceId) => {
    try {
      const messageStr = String(message || '')
      const levelStr = ['log', 'warning', 'error'][level] || 'unknown'
      
      // Log padrão dos mensagens do console
      log(levelStr === 'error' ? 'error' : 'verbose', 'renderer:console', messageStr, { line, sourceId })
    } catch (e) {
      // Evita erros ao processar console-message
      console.error('[console-message handler error]', e)
    }
  })

  if (isDev) {
    log('info', 'electron:createWindow', '🔗 Modo desenvolvimento: conectando a http://localhost:5175')
    win.loadURL('http://localhost:5175')
    // Abre DevTools automaticamente em dev
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html')
    log('info', 'electron:createWindow', '📂 Modo produção: carregando', { indexPath, existe: existsSync(indexPath) })
    if (!existsSync(indexPath)) {
      log('error', 'electron:createWindow', '❌ index.html NÃO ENCONTRADO!', { indexPath })
    }
    
    win.loadFile(indexPath)
  }

  // Show window after loading
  win.once('ready-to-show', () => {
    log('info', 'electron:createWindow', '🎨 Mostrando janela')
    win.show()
  })

  return win
}

function createTilemapWindow(data) {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { x: waX, y: waY, width: waW, height: waH } = display.workArea
  const width = Math.min(900, waW - 40)
  const height = Math.min(700, waH - 80)
  const x = waX + Math.round((waW - width) / 2)
  const y = waY + Math.round((waH - height) / 2)

  const iconPath = path.join(app.getAppPath(), 'assets', 'icons', 'icon.png')
  const iconSvgPath = path.join(app.getAppPath(), 'assets', 'icons', 'icon.svg')

  const tilemapWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    title: 'Editor de Mapas - Retro Studio',
    backgroundColor: '#0f111a',
    icon: existsSync(iconPath) ? iconPath : (existsSync(iconSvgPath) ? iconSvgPath : undefined),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs')
    }
  })

  const wcId = tilemapWin.webContents.id
  tilemapWindowData.set(wcId, data)

  tilemapWin.on('closed', () => {
    tilemapWindowData.delete(wcId)
  })

  if (isDev) {
    tilemapWin.loadURL('http://localhost:5175/tilemap-editor.html')
  } else {
    const tilemapPath = path.join(app.getAppPath(), 'dist', 'tilemap-editor.html')
    tilemapWin.loadFile(tilemapPath)
  }

  tilemapWin.once('ready-to-show', () => tilemapWin.show())

  // DevTools para debug (dev sempre; prod: F12 ou Ctrl+Shift+I)
  if (isDev) {
    tilemapWin.webContents.openDevTools({ mode: 'detach' })
  }
  tilemapWin.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      tilemapWin.webContents.toggleDevTools()
    }
  })

  tilemapWin.webContents.on('did-fail-load', (_, code, desc, url) => {
    log('error', 'tilemap:window', 'Falha ao carregar', { code, desc, url })
  })
  tilemapWin.webContents.on('console-message', (_, level, message) => {
    log(level === 3 ? 'error' : 'verbose', 'tilemap:console', String(message))
  })

  return tilemapWin
}

app.whenReady().then(async () => {
  // Desabilita o menu apenas em produção. Em desenvolvimento, ele é mantido para facilitar o debug.
  if (!isDev) {
    Menu.setApplicationMenu(null)
  }
  
  ipcMain.handle('window:minimize', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return
    win.minimize()
  })

  ipcMain.handle('window:toggleMaximize', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('window:close', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return
    win.close()
  })

  ipcMain.handle('window:isMaximized', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (!win) return false
    return win.isMaximized()
  })

  ipcMain.handle('workspace:select', async () => {
    try {
      log('info', 'ipc:workspace:select', 'Iniciando seleção de workspace')
      const res = await dialog.showOpenDialog({
        title: 'Select workspace folder',
        properties: ['openDirectory']
      })
      if (res.canceled) {
        log('info', 'ipc:workspace:select', 'Seleção cancelada pelo usuário')
        return null
      }
      const selected = res.filePaths[0] ?? null
      currentWorkspacePath = selected
      log('info', 'ipc:workspace:select', 'Workspace selecionado', { path: selected })
      
      // Salva nos recentes
      if (selected) {
        await addRecentWorkspace(selected)
        log('info', 'ipc:workspace:select', 'Workspace adicionado aos recentes')
        
        // Configura o agente de IA com o workspace
        if (aiAgent) {
          aiAgent.setWorkspace(selected)
          log('info', 'ipc:workspace:select', 'Workspace configurado no agente de IA')
        }
      }
      
      return selected
    } catch (e) {
      log('error', 'ipc:workspace:select', 'Erro ao selecionar workspace', { error: e.message })
      throw e
    }
  })

  ipcMain.handle('workspace:getRecent', async () => {
    try {
      const settings = await loadSettings()
      return settings.recentWorkspaces || []
    } catch (e) {
      console.error('workspace:getRecent failed', e)
      return []
    }
  })

  ipcMain.handle('workspace:openRecent', async (_evt, workspacePath) => {
    try {
      // Verifica se o diretório existe
      await fs.access(workspacePath)
      const stat = await fs.stat(workspacePath)
      if (!stat.isDirectory()) {
        throw new Error('Path is not a directory')
      }
      
      currentWorkspacePath = workspacePath
      await addRecentWorkspace(workspacePath)
      
      // Configura o agente de IA
      if (aiAgent) {
        aiAgent.setWorkspace(workspacePath)
      }
      
      return workspacePath
    } catch (e) {
      console.error('workspace:openRecent failed', e)
      throw e
    }
  })

  ipcMain.handle('workspace:getLast', async () => {
    try {
      const last = await getLastWorkspace()
      return last
    } catch (e) {
      console.error('workspace:getLast failed', e)
      return null
    }
  })

  ipcMain.handle('workspace:removeRecent', async (_evt, workspacePath) => {
    try {
      const settings = await loadSettings()
      settings.recentWorkspaces = (settings.recentWorkspaces || []).filter(
        w => w.path !== workspacePath
      )
      await saveSettings(settings)
      return settings.recentWorkspaces
    } catch (e) {
      console.error('workspace:removeRecent failed', e)
      throw e
    }
  })

  ipcMain.handle('workspace:tree', async () => {
    try {
      const workspacePath = assertWorkspaceSelected()
      return buildTree(workspacePath)
    } catch (e) {
      console.error('workspace:tree failed', { currentWorkspacePath }, e)
      throw e
    }
  })

  ipcMain.handle('fs:readTextFile', async (_evt, filePath) => {
    try {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new Error('Invalid filePath')
      }
      const resolved = assertPathInsideWorkspace(filePath)
      return fs.readFile(resolved, 'utf8')
    } catch (e) {
      console.error('fs:readTextFile failed', { filePath, currentWorkspacePath }, e)
      throw e
    }
  })

  ipcMain.handle('fs:writeTextFile', async (_evt, filePath, contents) => {
    try {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new Error('Invalid filePath')
      }
      if (typeof contents !== 'string') {
        throw new Error('Invalid contents')
      }
      const resolved = assertPathInsideWorkspace(filePath)
      await fs.writeFile(resolved, contents, 'utf8')
    } catch (e) {
      console.error('fs:writeTextFile failed', { filePath, currentWorkspacePath }, e)
      throw e
    }
  })

  ipcMain.handle('fs:createFile', async (_evt, parentDirPath, name) => {
    try {
      if (typeof parentDirPath !== 'string' || parentDirPath.length === 0) {
        throw new Error('Invalid parentDirPath')
      }
      const safeName = assertValidName(name)
      const resolvedParent = assertPathInsideWorkspace(parentDirPath)
      const targetPath = path.join(resolvedParent, safeName)
      assertPathInsideWorkspace(targetPath)
      await fs.writeFile(targetPath, '', { encoding: 'utf8', flag: 'wx' })
      return targetPath
    } catch (e) {
      console.error('fs:createFile failed', { parentDirPath, name, currentWorkspacePath }, e)
      throw e
    }
  })

  ipcMain.handle('fs:createFolder', async (_evt, parentDirPath, name) => {
    try {
      if (typeof parentDirPath !== 'string' || parentDirPath.length === 0) {
        throw new Error('Invalid parentDirPath')
      }
      const safeName = assertValidName(name)
      const resolvedParent = assertPathInsideWorkspace(parentDirPath)
      const targetPath = path.join(resolvedParent, safeName)
      assertPathInsideWorkspace(targetPath)
      await fs.mkdir(targetPath, { recursive: false })
      return targetPath
    } catch (e) {
      console.error('fs:createFolder failed', { parentDirPath, name, currentWorkspacePath }, e)
      throw e
    }
  })

  ipcMain.handle('fs:renamePath', async (_evt, oldPath, newName) => {
    try {
      if (typeof oldPath !== 'string' || oldPath.length === 0) {
        throw new Error('Invalid oldPath')
      }
      const safeName = assertValidName(newName)
      const resolvedOld = assertPathInsideWorkspace(oldPath)
      const parentDir = path.dirname(resolvedOld)
      const newPath = path.join(parentDir, safeName)
      assertPathInsideWorkspace(newPath)
      await fs.rename(resolvedOld, newPath)
      return newPath
    } catch (e) {
      console.error('fs:renamePath failed', { oldPath, newName, currentWorkspacePath }, e)
      throw e
    }
  })

  ipcMain.handle('fs:deletePath', async (_evt, targetPath) => {
    try {
      if (typeof targetPath !== 'string' || targetPath.length === 0) {
        throw new Error('Invalid targetPath')
      }
      const resolved = assertPathInsideWorkspace(targetPath)
      const stat = await fs.lstat(resolved)
      if (stat.isDirectory()) {
        await fs.rm(resolved, { recursive: true, force: true })
      } else {
        await fs.rm(resolved, { force: true })
      }
      return true
    } catch (e) {
      console.error('fs:deletePath failed', { targetPath, currentWorkspacePath }, e)
      throw e
    }
  })

  // Buscar arquivos no workspace
  ipcMain.handle('fs:search', async (_evt, query, options = {}) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      const maxResults = options.maxResults || 100
      const results = []
      
      async function searchInDirectory(dirPath, depth = 0) {
        if (results.length >= maxResults || depth > 10) return
        
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true })
          
          for (const entry of entries) {
            if (results.length >= maxResults) break
            
            // Ignora diretórios ocultos e node_modules
            if (entry.name.startsWith('.') || entry.name === 'node_modules') {
              continue
            }
            
            const fullPath = path.join(dirPath, entry.name)
            const relativePath = path.relative(workspacePath, fullPath)
            
            if (entry.isDirectory()) {
              // Busca no nome do diretório
              if (entry.name.toLowerCase().includes(query.toLowerCase())) {
                results.push({
                  path: relativePath,
                  name: entry.name,
                  type: 'directory',
                  fullPath
                })
              }
              // Busca recursivamente
              await searchInDirectory(fullPath, depth + 1)
            } else if (entry.isFile()) {
              // Busca no nome do arquivo
              if (entry.name.toLowerCase().includes(query.toLowerCase())) {
                results.push({
                  path: relativePath,
                  name: entry.name,
                  type: 'file',
                  fullPath
                })
              }
              
              // Busca no conteúdo de arquivos de texto
              if (options.searchContent && entry.name.match(/\.(js|ts|vue|css|html|json|md|txt)$/i)) {
                try {
                  const content = await fs.readFile(fullPath, 'utf8')
                  const lines = content.split('\n')
                  
                  lines.forEach((line, lineNumber) => {
                    if (results.length >= maxResults) return
                    
                    if (line.toLowerCase().includes(query.toLowerCase())) {
                      results.push({
                        path: relativePath,
                        name: entry.name,
                        type: 'match',
                        line: lineNumber + 1,
                        text: line.trim(),
                        fullPath
                      })
                    }
                  })
                } catch {
                  // Ignora erros de leitura (arquivos binários, etc)
                }
              }
            }
          }
        } catch (err) {
          // Ignora erros de permissão
          console.warn('Error searching directory:', dirPath, err.message)
        }
      }
      
      await searchInDirectory(workspacePath)
      
      return results
    } catch (e) {
      console.error('fs:search failed', e)
      throw e
    }
  })

  // ===== Git Handlers =====
  
  // Verificar se é um repositório Git
  ipcMain.handle('git:isRepository', async () => {
    try {
      const workspacePath = assertWorkspaceSelected()
      await execAsync('git rev-parse --git-dir', { cwd: workspacePath })
      return true
    } catch {
      return false
    }
  })
  
  // Obter status do repositório
  ipcMain.handle('git:status', async () => {
    try {
      const workspacePath = assertWorkspaceSelected()
      const { stdout } = await execAsync('git status --porcelain', { cwd: workspacePath })
      
      const files = []
      const lines = stdout.trim().split('\n').filter(Boolean)
      
      for (const line of lines) {
        const status = line.substring(0, 2)
        const filePath = line.substring(3)
        
        const parsedStatus = parseGitStatus(status)
        const X = status[0] // Index (staging area)
        const Y = status[1] // Working tree
        
        // X mostra status no index (staged)
        // Y mostra status no working tree (unstaged)
        const isStaged = X !== ' ' && X !== '?'
        const isUnstaged = Y !== ' ' || parsedStatus === 'untracked'
        
        files.push({
          path: filePath,
          status: parsedStatus,
          staged: isStaged,
          unstaged: isUnstaged
        })
      }
      
      return files
    } catch (e) {
      console.error('git:status failed', e)
      throw new Error('Failed to get git status')
    }
  })
  
  // Obter branch atual
  ipcMain.handle('git:currentBranch', async () => {
    try {
      const workspacePath = assertWorkspaceSelected()
      const { stdout } = await execAsync('git branch --show-current', { cwd: workspacePath })
      return stdout.trim()
    } catch (e) {
      console.error('git:currentBranch failed', e)
      return 'unknown'
    }
  })
  
  // Stage arquivo (melhorado)
  ipcMain.handle('git:stage', async (_evt, filePath) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      // Usa -A para adicionar tudo (novo no Void)
      await execAsync(`git add -A "${filePath}"`, { cwd: workspacePath })
      return true
    } catch (e) {
      console.error('git:stage failed', e)
      throw new Error(`Failed to stage ${filePath}`)
    }
  })
  
  // Unstage arquivo
  ipcMain.handle('git:unstage', async (_evt, filePath) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      await execAsync(`git reset HEAD "${filePath}"`, { cwd: workspacePath })
      return true
    } catch (e) {
      console.error('git:unstage failed', e)
      throw new Error(`Failed to unstage ${filePath}`)
    }
  })
  
  // Descartar mudanças
  ipcMain.handle('git:discard', async (_evt, filePath) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      await execAsync(`git checkout -- "${filePath}"`, { cwd: workspacePath })
      return true
    } catch (e) {
      console.error('git:discard failed', e)
      throw new Error(`Failed to discard changes in ${filePath}`)
    }
  })
  
  // Commit
  ipcMain.handle('git:commit', async (_evt, message) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      
      // Verifica se o Git está configurado
      try {
        await execAsync('git config user.name', { cwd: workspacePath })
        await execAsync('git config user.email', { cwd: workspacePath })
      } catch (configError) {
        throw new Error('Git não está configurado. Configure seu nome e email primeiro.')
      }
      
      // Verifica se há arquivos staged usando git status
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: workspacePath })
      const lines = statusOutput.trim().split('\n').filter(Boolean)
      const hasStagedFiles = lines.some(line => {
        const X = line[0]
        return X !== ' ' && X !== '?'
      })
      
      if (!hasStagedFiles) {
        throw new Error('Nenhum arquivo no stage. Use o botão + para adicionar arquivos antes de commitar.')
      }
      
      const escapedMessage = message.replace(/"/g, '\\"')
      await execAsync(`git commit -m "${escapedMessage}"`, { cwd: workspacePath })
      return true
    } catch (e) {
      console.error('git:commit failed', e)
      throw new Error(e.message || 'Falha ao fazer commit')
    }
  })
  
  // Configurar usuário Git
  ipcMain.handle('git:config', async (_evt, key, value) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      await execAsync(`git config ${key} "${value}"`, { cwd: workspacePath })
      return true
    } catch (e) {
      console.error('git:config failed', e)
      throw new Error(`Failed to set git config ${key}`)
    }
  })
  
  // Obter configuração Git
  ipcMain.handle('git:getConfig', async (_evt, key) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      const { stdout } = await execAsync(`git config ${key}`, { cwd: workspacePath })
      return stdout.trim()
    } catch (e) {
      return null // Config não existe
    }
  })
  
  // Inicializar repositório
  ipcMain.handle('git:init', async () => {
    try {
      const workspacePath = assertWorkspaceSelected()
      await execAsync('git init', { cwd: workspacePath })
      return true
    } catch (e) {
      console.error('git:init failed', e)
      throw new Error('Failed to initialize git repository')
    }
  })
  
  // ===== Comandos Git Avançados =====
  
  // Pull
  ipcMain.handle('git:pull', async () => {
    try {
      const workspacePath = assertWorkspaceSelected()
      const { stdout, stderr } = await execAsync('git pull', { cwd: workspacePath })
      return { success: true, message: stdout || stderr }
    } catch (e) {
      console.error('git:pull failed', e)
      throw new Error('Failed to pull: ' + e.message)
    }
  })
  
  // Push
  ipcMain.handle('git:push', async () => {
    try {
      const workspacePath = assertWorkspaceSelected()
      const { stdout, stderr } = await execAsync('git push', { cwd: workspacePath })
      return { success: true, message: stdout || stderr }
    } catch (e) {
      console.error('git:push failed', e)
      throw new Error('Failed to push: ' + e.message)
    }
  })
  
  // Fetch
  ipcMain.handle('git:fetch', async () => {
    try {
      const workspacePath = assertWorkspaceSelected()
      const { stdout, stderr } = await execAsync('git fetch', { cwd: workspacePath })
      return { success: true, message: stdout || stderr }
    } catch (e) {
      console.error('git:fetch failed', e)
      throw new Error('Failed to fetch: ' + e.message)
    }
  })
  
  // Listar branches
  ipcMain.handle('git:branches', async () => {
    try {
      const workspacePath = assertWorkspaceSelected()
      const { stdout } = await execAsync('git branch -a', { cwd: workspacePath })
      
      const branches = stdout.trim().split('\n').map(line => {
        const isCurrent = line.startsWith('*')
        const name = line.replace(/^\*?\s+/, '').trim()
        const isRemote = name.startsWith('remotes/')
        
        return {
          name: name.replace('remotes/', ''),
          current: isCurrent,
          remote: isRemote
        }
      }).filter(b => b.name && b.name !== 'HEAD')
      
      return branches
    } catch (e) {
      console.error('git:branches failed', e)
      return []
    }
  })
  
  // Criar branch
  ipcMain.handle('git:createBranch', async (_evt, branchName) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      await execAsync(`git branch "${branchName}"`, { cwd: workspacePath })
      return true
    } catch (e) {
      console.error('git:createBranch failed', e)
      throw new Error(`Failed to create branch ${branchName}`)
    }
  })
  
  // Trocar branch
  ipcMain.handle('git:checkout', async (_evt, branchName) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      await execAsync(`git checkout "${branchName}"`, { cwd: workspacePath })
      return true
    } catch (e) {
      console.error('git:checkout failed', e)
      throw new Error(`Failed to checkout branch ${branchName}`)
    }
  })
  
  // Deletar branch
  ipcMain.handle('git:deleteBranch', async (_evt, branchName) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      await execAsync(`git branch -d "${branchName}"`, { cwd: workspacePath })
      return true
    } catch (e) {
      console.error('git:deleteBranch failed', e)
      throw new Error(`Failed to delete branch ${branchName}`)
    }
  })
  
  // Histórico de commits
  ipcMain.handle('git:log', async (_evt, options = {}) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      const limit = options.limit || 50
      const skip = options.skip || 0
      
      // Format: hash|author|email|date|subject
      const format = '%H|%an|%ae|%ai|%s'
      const cmd = `git log --format="${format}" --max-count=${limit} --skip=${skip}`
      
      const { stdout } = await execAsync(cmd, { cwd: workspacePath })
      
      if (!stdout.trim()) {
        return []
      }
      
      const commits = stdout.trim().split('\n').map(line => {
        const [hash, author, email, date, subject] = line.split('|')
        return {
          hash: hash.trim(),
          shortHash: hash.trim().substring(0, 7),
          author: author.trim(),
          email: email.trim(),
          date: date.trim(),
          subject: subject.trim()
        }
      })
      
      return commits
    } catch (e) {
      console.error('git:log failed', e)
      return []
    }
  })
  
  // Diff de arquivo
  ipcMain.handle('git:diff', async (_evt, filePath, staged = false) => {
    try {
      const workspacePath = assertWorkspaceSelected()
      const flag = staged ? '--cached' : ''
      const cmd = `git diff ${flag} -- "${filePath}"`
      
      const { stdout } = await execAsync(cmd, { cwd: workspacePath })
      
      if (!stdout.trim()) {
        return null
      }
      
      return stdout
    } catch (e) {
      console.error('git:diff failed', e)
      return null
    }
  })

  // ===== Terminal PTY Handlers =====
  
  // Criar novo terminal
  ipcMain.handle('terminal:create', (evt, options = {}) => {
    try {
      log('info', 'ipc:terminal:create', 'Criando novo terminal', { cwd: options?.cwd })
      const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
      const cwd = options.cwd || currentWorkspacePath || os.homedir()
      const cols = options.cols || 80
      const rows = options.rows || 24
      
      const terminalId = `term_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      log('verbose', 'ipc:terminal:create', 'Terminal ID gerado', { id: terminalId, shell })
      
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      })
      
      terminals.set(terminalId, ptyProcess)
      log('info', 'ipc:terminal:create', 'Terminal criado com sucesso', { id: terminalId, pid: ptyProcess.pid })
      
      // Enviar dados do terminal para o renderer
      ptyProcess.onData((data) => {
        const win = BrowserWindow.fromWebContents(evt.sender)
        if (win && !win.isDestroyed()) {
          evt.sender.send('terminal:data', terminalId, data)
        }
      })
      
      // Quando o terminal fechar
      ptyProcess.onExit(({ exitCode }) => {
        log('info', 'ipc:terminal:create', 'Terminal fechado', { id: terminalId, exitCode })
        terminals.delete(terminalId)
        const win = BrowserWindow.fromWebContents(evt.sender)
        if (win && !win.isDestroyed()) {
          evt.sender.send('terminal:exit', terminalId, exitCode)
        }
      })
      
      return terminalId
    } catch (e) {
      log('error', 'ipc:terminal:create', 'Erro ao criar terminal', { error: e.message })
      throw e
    }
  })
  
  // Escrever no terminal
  ipcMain.handle('terminal:write', (_evt, terminalId, data) => {
    const term = terminals.get(terminalId)
    if (term) {
      term.write(data)
    }
  })
  
  // Redimensionar terminal
  ipcMain.handle('terminal:resize', (_evt, terminalId, cols, rows) => {
    const term = terminals.get(terminalId)
    if (term) {
      term.resize(cols, rows)
    }
  })
  
  // Destruir terminal
  ipcMain.handle('terminal:destroy', (_evt, terminalId) => {
    const term = terminals.get(terminalId)
    if (term) {
      term.kill()
      terminals.delete(terminalId)
    }
  })
  
  // Obter caminho do workspace atual
  ipcMain.handle('terminal:getCwd', () => {
    return currentWorkspacePath || os.homedir()
  })

  // ===== Settings Handlers =====
  
  // Carregar configurações
  ipcMain.handle('settings:load', async () => {
    try {
      return await loadSettings()
    } catch (e) {
      console.error('settings:load failed', e)
      return { ...defaultSettings }
    }
  })
  
  // Salvar configurações
  ipcMain.handle('settings:save', async (_evt, settings) => {
    try {
      return await saveSettings(settings)
    } catch (e) {
      console.error('settings:save failed', e)
      throw e
    }
  })
  
  // Obter caminho do diretório de configurações
  ipcMain.handle('settings:getConfigPath', () => {
    return getConfigDir()
  })
  
  // Abrir diretório de configurações no explorador de arquivos
  ipcMain.handle('settings:openConfigDir', async () => {
    const { shell } = await import('electron')
    const configDir = getConfigDir()
    await ensureConfigDir()
    shell.openPath(configDir)
  })

  // ===== AI Agent Handlers =====
  
  // Instância do agente (uma por janela seria ideal, mas singleton por agora)
  let aiAgent = null
  
  // Inicializar agente de IA
  ipcMain.handle('ai:init', async (_evt, settings) => {
    try {
      aiAgent = new AIAgent(settings)
      if (currentWorkspacePath) {
        aiAgent.setWorkspace(currentWorkspacePath)
        toolExecutor.setWorkspace(currentWorkspacePath)
      }
      return { success: true }
    } catch (e) {
      console.error('ai:init failed', e)
      throw e
    }
  })
  
  ipcMain.handle('ai:chat', async (evt, message, options = {}) => {
    try {
      log('info', 'ipc:ai:chat', 'Mensagem recebida', { length: message?.length, mode: options?.mode })
      
      if (!aiAgent) {
        log('verbose', 'ipc:ai:chat', 'Inicializando agente de IA (primeira vez)')
        // Inicializa com configurações padrão se não existir
        const settings = await loadSettings()
        aiAgent = new AIAgent(settings.ai)
        if (currentWorkspacePath) {
          aiAgent.setWorkspace(currentWorkspacePath)
          toolExecutor.setWorkspace(currentWorkspacePath)
        }
      }
      
      // Configura callback para notificar tool calls
      aiAgent.onToolCall = (toolInfo) => {
        log('info', 'ipc:ai:chat', 'Tool call executado', { tool: toolInfo?.name })
        const win = BrowserWindow.fromWebContents(evt.sender)
        if (win && !win.isDestroyed()) {
          evt.sender.send('ai:tool-call', toolInfo)
        }
      }
      
      log('info', 'ipc:ai:chat', 'Enviando mensagem para IA')
      const result = await aiAgent.chat(message, options)
      log('info', 'ipc:ai:chat', 'Resposta da IA recebida', { tokens: result?.usage?.total_tokens })
      return result
    } catch (e) {
      log('error', 'ipc:ai:chat', 'Erro no chat com IA', { error: e.message })
      throw e
    }
  })
  
  // Limpar histórico do agente
  ipcMain.handle('ai:clear', async () => {
    if (aiAgent) {
      aiAgent.clearHistory()
    }
    return { success: true }
  })
  
  // Atualizar configurações do agente e autocomplete
  ipcMain.handle('ai:updateSettings', async (_evt, settings) => {
    if (aiAgent) {
      aiAgent.updateSettings(settings)
    }
    if (autocompleteService) {
      autocompleteService.updateSettings({
        endpoint: settings.endpoint,
        model: settings.model,
        apiKey: settings.apiKey,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens
      })
    }
    return { success: true }
  })
  
  // Obter definições das tools (para exibir no frontend)
  ipcMain.handle('ai:getTools', async () => {
    return toolDefinitions
  })
  
  // Obter modos de chat disponíveis
  ipcMain.handle('ai:getModes', async () => {
    return CHAT_MODES
  })

  // Listar modelos disponíveis (GET /v1/models - OpenAI/vLLM compatible)
  ipcMain.handle('ai:fetchModels', async (_evt, baseUrl, provider) => {
    try {
      const settings = await loadSettings()
      const prov = provider || settings.ai?.provider
      const providerConfig = defaultSettings.aiProviders?.[prov]
      if (providerConfig?.models) {
        return providerConfig.models
      }
      const url = baseUrl && typeof baseUrl === 'string'
        ? baseUrl.replace(/\/v1\/.*$/, '').replace(/\/$/, '')
        : (settings.ai?.endpoint ?? settings.ai?.apiUrl ?? 'http://localhost:8000').replace(/\/v1\/.*$/, '').replace(/\/$/, '')
      const modelsUrl = `${url}/v1/models`
      const res = await fetch(modelsUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      const json = await res.json()
      const list = json?.data ?? json?.models ?? (Array.isArray(json) ? json : [])
      return list.map((m) => (typeof m === 'string' ? m : m?.id ?? m?.name)).filter(Boolean)
    } catch (e) {
      log('error', 'ipc:ai:fetchModels', 'Erro ao listar modelos', { error: e.message })
      throw e
    }
  })

  ipcMain.handle('ai:getProviders', async () => {
    return defaultSettings.aiProviders || {}
  })
  
  // Definir modo de chat
  ipcMain.handle('ai:setMode', async (_evt, mode) => {
    try {
      if (!aiAgent) {
        const settings = await loadSettings()
        aiAgent = new AIAgent(settings.ai)
        if (currentWorkspacePath) {
          aiAgent.setWorkspace(currentWorkspacePath)
          toolExecutor.setWorkspace(currentWorkspacePath)
        }
      }
      return aiAgent.setMode(mode)
    } catch (e) {
      console.error('ai:setMode failed', e)
      throw e
    }
  })
  
  // Obter modo atual
  ipcMain.handle('ai:getMode', async () => {
    if (aiAgent) {
      return aiAgent.getMode()
    }
    return { mode: 'agent', ...CHAT_MODES.agent }
  })
  
  // Executar uma tool diretamente (útil para testes)
  ipcMain.handle('ai:executeTool', async (_evt, toolName, params) => {
    try {
      if (currentWorkspacePath) {
        toolExecutor.setWorkspace(currentWorkspacePath)
      }
      const result = await toolExecutor.execute(toolName, params)
      
      // Notifica o frontend sobre mudanças no filesystem
      const window = BrowserWindow.getAllWindows()[0]
      if (window && ['write_file', 'patch_file', 'insert_at_line'].includes(toolName)) {
        // Aguarda um pouco para garantir que o arquivo foi escrito
        setTimeout(() => {
          window.webContents.send('fs:changed', {
            type: toolName === 'write_file' ? 'created' : 'modified',
            path: params.path
          })
        }, 100)
      }
      
      return result
    } catch (e) {
      console.error('ai:executeTool failed', e)
      throw e
    }
  })

  // ===== Autocomplete AI Service =====
  
  // Instância do serviço de autocomplete
  let autocompleteService = null
  
  // Inicializar autocomplete com configurações
  ipcMain.handle('ai:autocomplete:init', async (_evt, settings) => {
    try {
      const { AutocompleteService } = await import('./ai/autocomplete.js')
      autocompleteService = new AutocompleteService(settings)
      return { success: true }
    } catch (e) {
      console.error('ai:autocomplete:init failed', e)
      throw e
    }
  })
  
  // Fazer uma completion
  ipcMain.handle('ai:autocomplete:complete', async (_evt, params) => {
    try {
      if (!autocompleteService) {
        const { AutocompleteService } = await import('./ai/autocomplete.js')
        const settings = await loadSettings()
        autocompleteService = new AutocompleteService({
          endpoint: settings.ai?.endpoint || 'https://ia.auth.com.br/v1/chat/completions',
          model: settings.ai?.model || 'Qwen/Qwen2.5-Coder-3B-Instruct',
          apiKey: settings.ai?.apiKey,
          temperature: settings.ai?.temperature ?? 0.1,
          maxTokens: 128,
          enabled: settings.ai?.autocomplete?.enabled ?? true
        })
      }
      
      const result = await autocompleteService.complete(params)
      return result
    } catch (e) {
      console.error('ai:autocomplete:complete failed', e)
      throw e
    }
  })
  
  // Atualizar configurações do autocomplete
  ipcMain.handle('ai:autocomplete:updateSettings', async (_evt, settings) => {
    if (autocompleteService) {
      autocompleteService.updateSettings(settings)
    }
    return { success: true }
  })
  
  // Ativar/desativar autocomplete
  ipcMain.handle('ai:autocomplete:setEnabled', async (_evt, enabled) => {
    if (autocompleteService) {
      autocompleteService.updateSettings({ enabled })
    }
    return { success: true }
  })
  
  // Limpar cache do autocomplete
  ipcMain.handle('ai:autocomplete:clearCache', async () => {
    if (autocompleteService) {
      autocompleteService.clearCache()
    }
    return { success: true }
  })
  
  // Abortar requests pendentes
  ipcMain.handle('ai:autocomplete:abort', async () => {
    if (autocompleteService) {
      autocompleteService.abort()
    }
    return { success: true }
  })
  
  // Atualiza workspace no agente quando selecionar nova pasta
  const originalWorkspaceSelect = ipcMain.listeners('workspace:select')[0]
  // Hook para atualizar workspace no agente

  const win = createWindow()

  // Retro Studio: handlers para build/emulador/projetos
  setupRetroHandlers(win)

  // Tilemap Editor: janela separada
  ipcMain.handle('tilemap:open', (_evt, data) => {
    createTilemapWindow(data || { asset: null, projectPath: '', assets: [] })
    return { success: true }
  })
  ipcMain.handle('tilemap:get-data', (evt) => {
    const id = evt.sender.id
    const data = tilemapWindowData.get(id) || { asset: null, projectPath: '', assets: [] }
    log('verbose', 'tilemap:get-data', 'Dados solicitados', { wcId: id, hasData: !!tilemapWindowData.get(id), projectPath: data.projectPath })
    return data
  })
  ipcMain.handle('tilemap:close-window', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    if (win) win.close()
    return { success: true }
  })

  // Help: watcher para hot reload de docs
  const { setupHelpWatcher } = await import('./helpWatcher.js')
  setupHelpWatcher(win)

  // Abrir URL externa no navegador
  ipcMain.on('open-external-url', (_evt, { url }) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url)
    }
  })

  // Verifica se o app foi iniciado com um caminho via CLI
  win.webContents.once('did-finish-load', async () => {
    const pathFromArgv = await getPathFromArgv(process.argv)
    if (pathFromArgv) {
      log('info', 'app:startup', 'Abrindo workspace inicial via CLI', { path: pathFromArgv })
      win.webContents.send('workspace:open-from-cli', pathFromArgv)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
