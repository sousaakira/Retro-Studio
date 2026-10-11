import { registerGitHandlers } from './gitService.js'
import { app, BrowserWindow, dialog, ipcMain, screen, Menu, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import os from 'node:os'
import extract from 'extract-zip'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import pty from 'node-pty'
import { AIAgent, toolExecutor, toolDefinitions, CHAT_MODES } from './ai/index.js'
import { indexWorkspace } from './ai/rag/indexer.js'
import { acpSessionManager } from './ai/acp/manager.js'
import { setupRetroHandlers } from './retro/index.js'
import { inspectProjectAssets } from './retro/assetReport.js'
import { inspectCompiledResources, saveHardwareBudget } from './retro/compiledResources.js'
import { inputConfigurationStatus, saveInputConfiguration } from './retro/inputConfiguration.js'
import { createMovementDiagnosticService } from './retro/movementDiagnostic.js'
import { loadConfigFile } from './retro/utils.js'
import { runEmulatorAsync, runBuildAsync } from './retro/buildForTools.js'
import { resolveEmulatorPath } from './retro/emulatorUtils.js'
import { movementConfigurationStatus, saveMovementConfiguration } from './retro/movementConfiguration.js'
import { worldConfigurationStatus, saveWorldConfigurationWithMaps as saveWorldConfiguration } from './retro/worldConfiguration.js'
import { cameraConfigurationStatus, saveCameraConfiguration } from './retro/cameraConfiguration.js'
import { progressConfigurationStatus, saveProgressConfiguration } from './retro/progressConfiguration.js'
import { audioConfigurationStatus, saveAudioConfiguration } from './retro/audioConfiguration.js'
import { cutsceneAdapterStatus, saveCutsceneAdapter } from './retro/cutsceneAdapter.js'
import { toolchainStatus, recordToolchain } from './retro/toolchain.js'
import { debugConfigurationStatus, saveDebugConfiguration } from './retro/debugConfiguration.js'
import { createDebugService } from './retro/debugService.js'
import { isBuildRunning } from './retro/game.js'
import { paletteConfigurationStatus, savePaletteConfiguration, readPaletteImage } from './retro/paletteConfiguration.js'
import { hudConfigurationStatus, saveHudConfiguration } from './retro/hudConfiguration.js'
import { gameHostStatus, saveGameHost, useMapSpawnAsStart } from './retro/gameHost.js'
import { getTemplatePath as gameTemplatePath } from './retro/projectUtils.js'
import { mergeUnpackedAssets } from './retro/assetMerge.js'
import { readEditorDraft, writeEditorDraft, clearEditorDraft } from './retro/editorDrafts.js'
import { writeTextFileAtomically } from './retro/atomicText.js'
import { exportOverview } from './retro/exportOverview.js'
import { runtimeInstallationStatus, installRuntimeModules } from './retro/runtimeInstaller.js'
import { planAssetQuarantine, quarantineProjectAssets, restoreAssetQuarantine, listAssetQuarantines } from './retro/assetQuarantine.js'
import { exportCharacterToProject } from './retro/characterExport.js'
import { inspectPendingProjectExport, recoverProjectExport } from './retro/exportTransaction.js'
import { runConfiguredMapExporter } from './retro/mapExporter.js'
import { listMapFilesInKit, findMapKitForMap } from './retro/mapKitMaps.js'
import { prepareCutsceneExport, publishCutsceneExport } from './retro/cutsceneExport.js'
import { cutsceneRuntimeStatus, installCutsceneRuntime, listCutsceneFiles } from './retro/cutsceneRuntime.js'
import { pluginManager } from './plugins/pluginManager.js'
import { getAppInfo, fetchChangelog, checkForUpdates } from './updates.js'

const execAsync = promisify(exec)

const isDev = !app.isPackaged
const TILEMAP_WINDOW_STATE_FILE = 'tilemap-editor-window.json'

function readTilemapWindowState() {
  try {
    return JSON.parse(readFileSync(path.join(app.getPath('userData'), TILEMAP_WINDOW_STATE_FILE), 'utf8'))
  } catch {
    return null
  }
}

function clampTilemapWindowBounds(bounds, workArea) {
  const width = Math.max(Math.min(700, workArea.width), Math.min(Math.round(bounds.width || 900), workArea.width))
  const height = Math.max(Math.min(500, workArea.height), Math.min(Math.round(bounds.height || 700), workArea.height))
  const x = Math.max(workArea.x, Math.min(Math.round(bounds.x ?? workArea.x), workArea.x + workArea.width - width))
  const y = Math.max(workArea.y, Math.min(Math.round(bounds.y ?? workArea.y), workArea.y + workArea.height - height))
  return { x, y, width, height }
}

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
    aiTerminal: { open: false, width: 450 },
    terminal: { open: false, height: 250 },
    sidebar: { width: 280 }
  },
  aiProviders: {
    vllm: {
      name: 'vLLM / Local',
      endpoint: 'http://localhost:8000/v1/chat/completions',
      modelsUrl: 'http://localhost:8000/v1/models',
      needsApiKey: false,
      defaultModel: 'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ',
      apiType: 'openai'
    },
    ollama: {
      name: 'Ollama (local ou remoto)',
      endpoint: 'https://ia.retrostudio.dev/api/generate',
      modelsUrl: null,
      needsApiKey: true,
      defaultModel: 'qwen2.5-coder:14b',
      apiType: 'ollama',
      description: 'Use a URL padrão (ia.retrostudio.dev) ou personalize para Ollama local: http://localhost:11434/api/generate'
    },
    dashscope: {
      name: 'DashScope (Qwen) Internacional',
      endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      modelsUrl: null,
      needsApiKey: true,
      defaultModel: 'qwen-plus',
      models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-coder', 'qwen3-8b', 'qwen3-32b'],
      apiType: 'openai'
    },
    'dashscope-cn': {
      name: 'DashScope (Qwen) China',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      modelsUrl: null,
      needsApiKey: true,
      defaultModel: 'qwen-plus',
      models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-coder', 'qwen3-8b', 'qwen3-32b'],
      apiType: 'openai'
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
  aiTerminal: {
    opencode: {
      commandPath: '', // vazio = resolver no PATH / ~/.opencode/bin/opencode
      extraArgs: []
    },
    codexAcp: {
      commandPath: ''
    },
    claudeAcp: {
      commandPath: ''
    },
    acp: {
      onboardingSeen: false,
      provider: 'opencode',
      sessionsByWorkspace: {}
    }
  },
  recentWorkspaces: [], // Lista de workspaces recentes (máx 10)
  store: {
    apiUrl: 'https://api.retrostudio.dev',
    token: ''
  }
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
        aiTerminal: { ...defaultSettings.panels.aiTerminal, ...parsed.panels?.aiTerminal },
        terminal: { ...defaultSettings.panels.terminal, ...parsed.panels?.terminal },
        sidebar: { ...defaultSettings.panels.sidebar, ...parsed.panels?.sidebar }
      },
      ai: { ...defaultSettings.ai, ...parsed.ai },
      aiTerminal: {
        ...(defaultSettings.aiTerminal || {}),
        ...(parsed.aiTerminal || {}),
        opencode: {
          ...(defaultSettings.aiTerminal?.opencode || {}),
          ...(parsed.aiTerminal?.opencode || {})
        },
        claudeAcp: {
          ...(defaultSettings.aiTerminal?.claudeAcp || {}),
          ...(parsed.aiTerminal?.claudeAcp || {})
        },
        codexAcp: {
          ...(defaultSettings.aiTerminal?.codexAcp || {}),
          ...(parsed.aiTerminal?.codexAcp || {})
        },
        acp: {
          ...(defaultSettings.aiTerminal?.acp || {}),
          ...(parsed.aiTerminal?.acp || {}),
          sessionsByWorkspace: {
            ...(defaultSettings.aiTerminal?.acp?.sessionsByWorkspace || {}),
            ...(parsed.aiTerminal?.acp?.sessionsByWorkspace || {})
          }
        }
      },
      store: { ...defaultSettings.store, ...parsed.store },
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
  // #52: closing by the OS (Alt+F4, taskbar, logout) goes through the same checks as the title
  // bar button: the renderer saves or refuses, then asks to close for real.
  let closeAllowed = false, closeRequest = 0, closeAnswered = 0
  win.on('close', (event) => {
    if (closeAllowed || win.webContents.isDestroyed() || win.webContents.isCrashed()) return
    event.preventDefault()
    const request = ++closeRequest
    win.webContents.send('window:close-requested')
    // A renderer that cannot answer (frozen, still loading) must not make the window unclosable.
    // One that answered "no" keeps the window open.
    setTimeout(() => { if (!win.isDestroyed() && closeAnswered < request) { closeAllowed = true; win.close() } }, 8000)
  })
  const onCloseAnswer = (evt, accepted) => {
    if (win.isDestroyed() || evt.sender !== win.webContents) return
    closeAnswered = closeRequest
    if (accepted) { closeAllowed = true; win.close() }
  }
  ipcMain.on('window:close-answer', onCloseAnswer)
  win.once('closed', () => ipcMain.removeListener('window:close-answer', onCloseAnswer))
  win.once('ready-to-show', () => {
    log('info', 'electron:createWindow', '🎨 Mostrando janela')
    win.show()
  })

  return win
}

function createTilemapWindow(data) {
  const savedState = readTilemapWindowState()
  const cursorPoint = screen.getCursorScreenPoint()
  const initialDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const savedBounds = savedState?.bounds
  const hasSavedBounds = savedBounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(savedBounds[key]))
  const display = hasSavedBounds
    ? screen.getDisplayMatching(savedBounds)
    : initialDisplay
  const area = display.workArea
  const defaults = {
    x: area.x + Math.round((area.width - Math.min(900, area.width)) / 2),
    y: area.y + Math.round((area.height - Math.min(700, area.height)) / 2),
    width: Math.min(900, area.width),
    height: Math.min(700, area.height)
  }
  const bounds = clampTilemapWindowBounds(hasSavedBounds ? savedBounds : defaults, area)

  const iconPath = path.join(app.getAppPath(), 'assets', 'icons', 'icon.png')
  const iconSvgPath = path.join(app.getAppPath(), 'assets', 'icons', 'icon.svg')

  const tilemapWin = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(700, area.width),
    minHeight: Math.min(500, area.height),
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

  let windowStateTimer = null
  const writeWindowState = () => {
    try {
      const normalBounds = tilemapWin.getNormalBounds()
      const currentDisplay = screen.getDisplayMatching(normalBounds)
      const safeBounds = clampTilemapWindowBounds(normalBounds, currentDisplay.workArea)
      const userDataPath = app.getPath('userData')
      mkdirSync(userDataPath, { recursive: true })
      writeFileSync(path.join(userDataPath, TILEMAP_WINDOW_STATE_FILE), JSON.stringify({ bounds: safeBounds, maximized: tilemapWin.isMaximized() }))
    } catch (error) {
      log('warn', 'tilemap:window-state', 'Não foi possível salvar o tamanho da janela', { error: error.message })
    }
  }
  const persistWindowState = () => {
    if (windowStateTimer) clearTimeout(windowStateTimer)
    windowStateTimer = setTimeout(writeWindowState, 250)
  }
  tilemapWin.on('resize', persistWindowState)
  tilemapWin.on('move', persistWindowState)
  tilemapWin.on('maximize', persistWindowState)
  tilemapWin.on('unmaximize', persistWindowState)

  tilemapWin.on('closed', () => {
    if (windowStateTimer) clearTimeout(windowStateTimer)
    tilemapWindowData.delete(wcId)
  })
  tilemapWin.on('close', () => {
    if (windowStateTimer) clearTimeout(windowStateTimer)
    writeWindowState()
  })

  if (isDev) {
    tilemapWin.loadURL('http://localhost:5175/tilemap-editor.html')
  } else {
    const tilemapPath = path.join(app.getAppPath(), 'dist', 'tilemap-editor.html')
    tilemapWin.loadFile(tilemapPath)
  }

  tilemapWin.once('ready-to-show', () => {
    tilemapWin.show()
    if (savedState?.maximized) tilemapWin.maximize()
  })

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
  // Inicializa gerenciador de plugins
  pluginManager.init()

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
    win.close() // goes through the 'close' check above
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
      log('info', 'ipc:workspace:select', 'Workspace selecionado', { path: selected })
      // Selection has no activation side effect. The renderer flushes authoring
      // before workspace:openRecent updates the main/AI workspace and recents.
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

      await addRecentWorkspace(workspacePath)
      currentWorkspacePath = workspacePath

      // Configura o agente de IA
      if (aiAgent) {
        aiAgent.setWorkspace(workspacePath)
      }

      indexWorkspace(workspacePath).catch((e) => log('error', 'rag:index', 'Indexação RAG falhou', { error: e.message }))

      return workspacePath
    } catch (e) {
      console.error('workspace:openRecent failed', e)
      throw e
    }
  })

  ipcMain.handle('rag:reindex', async () => {
    if (!currentWorkspacePath) return { success: false, error: 'No workspace' }
    try {
      const r = await indexWorkspace(currentWorkspacePath)
      return { success: true, chunks: r.chunks }
    } catch (e) {
      log('error', 'rag:reindex', e.message)
      return { success: false, error: e.message }
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
      if (e?.code !== 'ENOENT') {
        console.error('fs:readTextFile failed', { filePath, currentWorkspacePath }, e)
      }
      throw e
    }
  })

  /** Lê arquivo; retorna null se não existir (sem throw — evita spam do Electron no poll ACP). */
  ipcMain.handle('fs:readTextFileOptional', async (_evt, filePath) => {
    try {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new Error('Invalid filePath')
      }
      const resolved = assertPathInsideWorkspace(filePath)
      return await fs.readFile(resolved, 'utf8')
    } catch (e) {
      if (e?.code === 'ENOENT') return null
      console.error('fs:readTextFileOptional failed', { filePath, currentWorkspacePath }, e)
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
      const dir = path.dirname(resolved)
      await fs.mkdir(dir, { recursive: true })
      await writeTextFileAtomically(resolved, contents)
      if (currentWorkspacePath) {
        clearTimeout(global._ragReindexTimer)
        global._ragReindexTimer = setTimeout(() => {
          indexWorkspace(currentWorkspacePath).then((r) => log('verbose', 'rag:reindex', 'RAG reindexado após save', r)).catch((e) => log('error', 'rag:reindex', e.message))
        }, 2000)
      }
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

  ipcMain.handle('fs:ensureDirectory', async (_evt, dirPath) => {
    try {
      if (typeof dirPath !== 'string' || dirPath.length === 0) return
      const resolved = assertPathInsideWorkspace(dirPath)
      await fs.mkdir(resolved, { recursive: true })
    } catch (e) {
      console.error('fs:ensureDirectory failed', { dirPath, currentWorkspacePath }, e)
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

  async function moveToTrash(target) {
    try { await shell.trashItem(target); return true }
    catch (error) { log('verbose', 'fs:trash', 'Lixeira indisponível; exclusão definitiva', { message: error.message }); return false }
  }
  ipcMain.handle('fs:deletePath', async (_evt, targetPath) => {
    try {
      if (typeof targetPath !== 'string' || targetPath.length === 0) {
        throw new Error('Invalid targetPath')
      }
      const resolved = assertPathInsideWorkspace(targetPath)
      if (currentWorkspacePath && path.resolve(resolved) === path.resolve(currentWorkspacePath)) throw new Error('A pasta do projeto não pode ser excluída pela IDE.')
      const stat = await fs.lstat(resolved)
      // #52: deleting from the IDE is recoverable. The item goes to the system trash; only
      // when there is no trash (some servers, sandboxes) it is removed for good, as confirmed.
      if (await moveToTrash(resolved)) return true
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

  // Copiar arquivo do SO para pasta do workspace (drag & drop)
  ipcMain.handle('fs:copyFileFromExternal', async (_evt, sourcePath, destDirPath, options = {}) => {
    try {
      if (typeof sourcePath !== 'string' || sourcePath.length === 0) throw new Error('Invalid sourcePath')
      if (typeof destDirPath !== 'string' || destDirPath.length === 0) throw new Error('Invalid destDirPath')
      const resolvedDestDir = assertPathInsideWorkspace(destDirPath)
      await fs.mkdir(resolvedDestDir, { recursive: true })
      const fileName = path.basename(sourcePath)
      const targetPath = path.join(resolvedDestDir, assertValidName(fileName))
      assertPathInsideWorkspace(targetPath)
      // #42: a dropped file never replaces different content. Only a caller that owns the
      // destination folder (kit export rewriting its own kit-assets folder) may replace.
      if (existsSync(targetPath) && options?.replace !== true) {
        const [incoming, current] = await Promise.all([fs.readFile(sourcePath), fs.readFile(targetPath)])
        if (incoming.equals(current)) return targetPath
        throw new Error(`Já existe ${fileName} nesta pasta com outro conteúdo. O arquivo existente foi preservado; renomeie um dos dois.`)
      }
      await fs.copyFile(sourcePath, targetPath)
      return targetPath
    } catch (e) {
      console.error('fs:copyFileFromExternal failed', { sourcePath, destDirPath, currentWorkspacePath }, e)
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

  // ===== System Handlers =====

  // Obter diretório de trabalho atual
  ipcMain.handle('system:getCwd', async () => {
    return process.cwd()
  })

  // Git operations use argv, literal paths and per-workspace serialization.
  registerGitHandlers(ipcMain, assertWorkspaceSelected, dialog, shell)

  // ===== Terminal PTY Handlers =====

  // Criar novo terminal
  ipcMain.handle('terminal:create', (evt, options = {}) => {
    try {
      log('info', 'ipc:terminal:create', 'Criando novo terminal', { cwd: options?.cwd, command: options?.command })
      const cwd = options.cwd || currentWorkspacePath || os.homedir()
      const cols = options.cols || 80
      const rows = options.rows || 24

      const terminalId = `term_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      log('verbose', 'ipc:terminal:create', 'Terminal ID gerado', { id: terminalId, shell: options.command || process.env.SHELL || '/bin/bash' })

      // Preparar variáveis de ambiente
      const env = {
        ...process.env,
        ...(options.env || {}),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }

      // Determinar shell e argumentos
      const isWindows = process.platform === 'win32'
      let shell, args

      if (Array.isArray(options.args) || options.file) {
        // Spawn direto do binário (melhor para TUIs como OpenCode)
        shell = options.file || options.command
        if (!shell) throw new Error('terminal:create requer file ou command')
        args = Array.isArray(options.args) ? options.args : []
      } else if (options.command) {
        // Usar comando via shell (ex: pipelines)
        if (isWindows) {
          shell = 'cmd.exe'
          args = ['/c', options.command]
        } else {
          shell = '/bin/sh'
          args = ['-c', options.command]
        }
      } else {
        // Shell padrão
        shell = isWindows ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')
        args = []
      }

      log('info', 'ipc:terminal:create', 'Iniciando terminal', { shell, args, hasCustomEnv: !!options.env })

      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env
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

  // Merge parcial de settings (ex.: aiTerminal)
  ipcMain.handle('settings:savePartial', async (_evt, partial) => {
    try {
      const current = await loadSettings()
      const merged = {
        ...current,
        ...partial,
        // aiTerminal: substituição completa (evita providers removidos ficarem no disco)
        aiTerminal: partial.aiTerminal !== undefined
          ? { ...(partial.aiTerminal || {}) }
          : { ...(current.aiTerminal || {}) },
        panels: {
          ...(current.panels || {}),
          ...(partial.panels || {})
        },
        ai: {
          ...(current.ai || {}),
          ...(partial.ai || {})
        }
      }
      await saveSettings(merged)
      return merged
    } catch (e) {
      console.error('settings:savePartial failed', e)
      throw e
    }
  })

  // Resolver caminho de um executável (PATH + candidatos conhecidos)
  ipcMain.handle('system:which', async (_evt, commandName) => {
    const name = String(commandName || '').trim()
    if (!name || name.includes('/') || name.includes('\\')) {
      // Já é path: só verifica existência
      if (name && existsSync(name)) return { found: true, path: name }
      return { found: false, path: null }
    }
    const candidates = []
    if (name === 'opencode') {
      candidates.push(path.join(os.homedir(), '.opencode', 'bin', 'opencode'))
    }
    try {
      const { stdout } = await execAsync(
        process.platform === 'win32' ? `where ${name}` : `command -v ${name}`,
        { env: process.env }
      )
      const first = String(stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean)
      if (first) candidates.unshift(first)
    } catch (_) { /* not in PATH */ }
    for (const p of candidates) {
      if (p && existsSync(p)) return { found: true, path: p }
    }
    return { found: false, path: null, tried: candidates }
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

  // ===== Store (Loja) Handlers =====
  async function storeFetch(apiUrl, path, options = {}) {
    const base = (apiUrl || '').replace(/\/$/, '')
    const url = `${base}${path.startsWith('/') ? path : '/' + path}`
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`)
    return json
  }

  ipcMain.handle('store:login', async (_evt, apiUrl, email, password) => {
    try {
      const json = await storeFetch(apiUrl, '/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      })
      const token = json.token
      const user = json.data
      if (!token || !user) throw new Error('Resposta inválida do servidor')
      const settings = await loadSettings()
      settings.store = settings.store || {}
      settings.store.apiUrl = apiUrl
      settings.store.token = token
      await saveSettings(settings)
      return { success: true, token, user }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('store:logout', async () => {
    try {
      const settings = await loadSettings()
      if (settings.store) settings.store.token = ''
      await saveSettings(settings)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('store:me', async () => {
    try {
      const settings = await loadSettings()
      const { apiUrl, token } = settings.store || {}
      if (!apiUrl || !token) return { success: false, user: null }
      const json = await storeFetch(apiUrl, '/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      })
      return { success: true, user: json.data }
    } catch (e) {
      if (e?.message?.includes('401') || e?.message?.includes('Unauthorized')) {
        const s = await loadSettings()
        if (s.store) s.store.token = ''
        await saveSettings(s)
      }
      return { success: false, user: null }
    }
  })

  ipcMain.handle('store:listAssets', async (_evt, apiUrl, params = {}) => {
    const settings = await loadSettings()
    const base = apiUrl || settings.store?.apiUrl
    if (!base) throw new Error('URL da API não configurada')
    const qs = new URLSearchParams(params).toString()
    const path = `/store/assets${qs ? '?' + qs : ''}`
    return storeFetch(base, path)
  })

  ipcMain.handle('store:getAsset', async (_evt, apiUrl, slug) => {
    const settings = await loadSettings()
    const base = apiUrl || settings.store?.apiUrl
    if (!base) throw new Error('URL da API não configurada')
    return storeFetch(base, `/store/assets/${slug}`)
  })

  ipcMain.handle('store:purchase', async (_evt, assetId) => {
    const settings = await loadSettings()
    const { apiUrl, token } = settings.store || {}
    if (!apiUrl || !token) throw new Error('Faça login para obter este asset')
    return storeFetch(apiUrl, `/store/purchase/${assetId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
  })

  ipcMain.handle('store:myPurchases', async () => {
    const settings = await loadSettings()
    const { apiUrl, token } = settings.store || {}
    if (!apiUrl || !token) return { success: true, data: [] }
    return storeFetch(apiUrl, '/store/purchases', {
      headers: { Authorization: `Bearer ${token}` }
    })
  })

  ipcMain.handle('store:download', async (_evt, purchaseId) => {
    const settings = await loadSettings()
    const { apiUrl, token } = settings.store || {}
    if (!apiUrl || !token) throw new Error('Faça login para baixar')
    const json = await storeFetch(apiUrl, `/store/purchases/${purchaseId}/download`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return json.data
  })

  ipcMain.handle('store:installAsset', async (_evt, projectPath, asset, downloadUrl) => {
    if (!projectPath || !downloadUrl) throw new Error('Parâmetros inválidos')
    const resDir = assertPathInsideWorkspace(path.join(projectPath, 'res'))
    await fs.mkdir(resDir, { recursive: true })
    // #42: the package is unpacked aside and merged file by file; a file of the project with
    // the same name and other content is preserved and reported, never replaced.
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'retro-asset-'))
    const tmpZip = path.join(staging, 'package.zip'), unpacked = path.join(staging, 'files')
    try {
      const res = await fetch(downloadUrl)
      if (!res.ok) throw new Error(`Download falhou: ${res.status}`)
      const buf = await res.arrayBuffer()
      await fs.writeFile(tmpZip, new Uint8Array(buf))
      await fs.mkdir(unpacked)
      await extract(tmpZip, { dir: unpacked })
      return await mergeUnpackedAssets(unpacked, resDir)
    } finally {
      try { await fs.rm(staging, { recursive: true, force: true }) } catch { }
    }
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
      log('info', 'ipc:ai:chat', 'Mensagem recebida', {
        length: message?.length,
        mode: options?.mode,
        hasEditorContext: !!(options?.context?.currentFilePath || options?.context?.currentFileContent),
        currentFile: options?.context?.currentFilePath
          ? path.basename(String(options.context.currentFilePath))
          : null
      })

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
      const result = await aiAgent.chat(message, {
        ...options,
        sendChunk: (chunk) => { try { evt.sender.send('ai:chunk', chunk) } catch (_) {} }
      })
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

  // ===== OpenCode ACP (Agent Client Protocol) =====
  function isAllowedAgentBinary(binPath, provider) {
    if (!binPath || typeof binPath !== 'string') return false
    if (!existsSync(binPath)) return false
    const base = path.basename(binPath).toLowerCase()
    const expected = provider === 'claude' ? ['claude-agent-acp', 'claude-agent-acp.exe', 'claude-agent-acp.cmd'] : provider === 'codex' ? ['codex-acp', 'codex-acp.exe', 'codex-acp.cmd'] : ['opencode', 'opencode.exe']
    if (!expected.includes(base)) return false
    const resolved = path.resolve(binPath)
    // asdf global npm installations expose the same validated CLI basename.
    if (resolved === path.join(os.homedir(), '.asdf', 'shims', base)) return true
    const homeBinDir = path.resolve(path.join(os.homedir(), provider === 'opencode' ? '.opencode' : '.npm-global', 'bin'))
    if (resolved.startsWith(homeBinDir + path.sep) || resolved === path.join(homeBinDir, base)) return true
    // PATH install: basename already checked; allow only if parent looks like a bin dir
    const parent = path.basename(path.dirname(resolved)).toLowerCase()
    return parent === 'bin' || parent === 'sbin' || parent === 'scripts'
  }

  ipcMain.handle('acp:start', async (evt, options = {}) => {
    const wcId = evt.sender.id
    // Sempre o workspace da IDE — nunca CWD do terminal nem $HOME
    const workspacePath = currentWorkspacePath || options.workspacePath || null
    if (!workspacePath) {
      throw new Error('Abra um workspace antes de iniciar o agente ACP')
    }
    if (options.workspacePath && (!currentWorkspacePath || realpathSync(options.workspacePath) !== realpathSync(currentWorkspacePath)))
      throw new Error('O painel ACP pertence a outro workspace.')
    const settings = await loadSettings()
    const providers = ['opencode', 'codex', 'claude']
    if (options.provider && !providers.includes(options.provider)) throw new Error('Provedor ACP inválido.')
    const provider = options.provider || (providers.includes(settings.aiTerminal?.acp?.provider) ? settings.aiTerminal.acp.provider : 'opencode')
    const providerSettingsKey = { opencode: 'opencode', codex: 'codexAcp', claude: 'claudeAcp' }[provider]
    let commandPath = options.commandPath || settings.aiTerminal?.[providerSettingsKey]?.commandPath || ''
    if (commandPath.startsWith('~/')) commandPath = path.join(os.homedir(), commandPath.slice(2))
    const sessionsByWorkspace = settings.aiTerminal?.acp?.sessionsByWorkspace || {}
    const lexicalWorkspacePath = path.resolve(workspacePath)
    let canonicalWorkspacePath = lexicalWorkspacePath
    try { canonicalWorkspacePath = await fs.realpath(workspacePath) } catch { /* preserve resolved input */ }
    const sessionMapKey = `${provider}:${canonicalWorkspacePath}`
    const preferredSessionId = options.sessionId
      || sessionsByWorkspace[sessionMapKey]
      || sessionsByWorkspace[`${provider}:${lexicalWorkspacePath}`]
      || (provider === 'opencode' ? sessionsByWorkspace[lexicalWorkspacePath] : null)
      || null
    const mode = options.mode || 'auto'

    let resolved = isAllowedAgentBinary(commandPath, provider) ? commandPath : ''
    if (!resolved || !existsSync(resolved)) {
      const which = await (async () => {
        const executable = { opencode: 'opencode', codex: 'codex-acp', claude: 'claude-agent-acp' }[provider]
        const homeBin = path.join(os.homedir(), provider === 'opencode' ? '.opencode' : '.npm-global', 'bin', executable)
        if (existsSync(homeBin)) return homeBin
        try {
          const { stdout } = await execAsync(process.platform === 'win32' ? `where ${executable}` : `command -v ${executable}`)
          const found = String(stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || null
          return isAllowedAgentBinary(found, provider) ? found : null
        } catch {
          return null
        }
      })()
      resolved = which
    }

    const send = (channel, payload) => {
      if (!evt.sender.isDestroyed()) evt.sender.send(channel, payload)
    }

    // Settings/binary discovery awaited above: reject a workspace switch before launch.
    if (!currentWorkspacePath || realpathSync(currentWorkspacePath) !== realpathSync(workspacePath)) throw new Error('O workspace mudou antes de iniciar o agente ACP.')
    const info = await acpSessionManager.start(wcId, {
      workspacePath,
      commandPath: resolved,
      provider,
      send,
      mode,
      sessionId: preferredSessionId
    })

    // Hooks: escrita no disco; UI notificada via evento fileWritten do client
    acpSessionManager.setFileHooks(wcId, {
      writeFileOverride: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, content, 'utf8')
        return true
      }
    })

    // Persistir última sessão deste workspace/game
    if (info?.sessionId && info?.workspacePath) {
      try {
        const current = await loadSettings()
        const prev = current.aiTerminal || {}
        const map = { ...(prev.acp?.sessionsByWorkspace || {}) }
        map[`${provider}:${path.resolve(info.workspacePath)}`] = info.sessionId
        await saveSettings({
          ...current,
          aiTerminal: {
            ...prev,
            acp: { ...(prev.acp || {}), sessionsByWorkspace: map }
          }
        })
      } catch (e) {
        console.warn('acp: persist session map failed', e?.message || e)
      }
    }

    return info
  })

  ipcMain.handle('acp:listSessions', async (evt) => {
    return acpSessionManager.listSessions(evt.sender.id)
  })

  ipcMain.handle('acp:openSession', async (evt, options = {}) => {
    const wcId = evt.sender.id
    const send = (channel, payload) => {
      if (!evt.sender.isDestroyed()) evt.sender.send(channel, payload)
    }
    const info = await acpSessionManager.openSession(wcId, {
      mode: options.mode || 'new',
      sessionId: options.sessionId || null,
      send
    })

    acpSessionManager.setFileHooks(wcId, {
      writeFileOverride: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, content, 'utf8')
        return true
      }
    })

    if (info?.sessionId && info?.workspacePath) {
      try {
        const current = await loadSettings()
        const prev = current.aiTerminal || {}
        const map = { ...(prev.acp?.sessionsByWorkspace || {}) }
        map[`${info.provider || 'opencode'}:${path.resolve(info.workspacePath)}`] = info.sessionId
        await saveSettings({
          ...current,
          aiTerminal: {
            ...prev,
            acp: { ...(prev.acp || {}), sessionsByWorkspace: map }
          }
        })
      } catch (e) {
        console.warn('acp: persist session map failed', e?.message || e)
      }
    }

    return info
  })

  ipcMain.handle('acp:prompt', async (evt, payload = {}) => {
    const wcId = evt.sender.id
    const info = acpSessionManager.getSessionInfo(wcId)
    if (!currentWorkspacePath || !info?.workspacePath ||
        realpathSync(currentWorkspacePath) !== realpathSync(info.workspacePath) ||
        (payload.workspacePath && realpathSync(payload.workspacePath) !== realpathSync(currentWorkspacePath)))
      throw new Error('A sessão ACP pertence a outro workspace. Reinicie o agente neste projeto.')
    return acpSessionManager.prompt(wcId, payload.text, {
      currentFilePath: payload.currentFilePath,
      currentFileContent: payload.currentFileContent,
      contextNotes: payload.contextNotes || []
    })
  })

  ipcMain.handle('acp:setConfigOption', async (evt, payload = {}) => {
    return acpSessionManager.setConfigOption(evt.sender.id, payload.configId, payload.value)
  })

  ipcMain.handle('acp:getConfigOptions', async (evt) => {
    return { configOptions: acpSessionManager.getConfigOptions(evt.sender.id) }
  })

  ipcMain.handle('acp:cancel', async (evt) => {
    acpSessionManager.cancel(evt.sender.id)
    return { success: true }
  })

  ipcMain.handle('acp:stop', async (evt, options = {}) => {
    await acpSessionManager.stop(evt.sender.id, { workspacePath: options.workspacePath })
    return { success: true }
  })

  ipcMain.handle('acp:resolvePermission', async (evt, payload = {}) => {
    const ok = acpSessionManager.resolvePermission(evt.sender.id, payload.requestId, payload.result)
    return { success: ok }
  })

  ipcMain.handle('acp:authStatus', async (_evt, options = {}) => {
    return acpSessionManager.checkAuthStatus(options.commandPath || null, ['codex', 'claude'].includes(options.provider) ? options.provider : 'opencode')
  })

  ipcMain.handle('acp:authenticate', async (evt, options = {}) => {
    return acpSessionManager.authenticate(evt.sender.id, options.methodId)
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

  // Listar modelos disponíveis (OpenAI /v1/models ou Ollama /api/tags)
  ipcMain.handle('ai:fetchModels', async (_evt, baseUrl, provider) => {
    try {
      const settings = await loadSettings()
      const prov = provider || settings.ai?.provider
      const providerConfig = defaultSettings.aiProviders?.[prov]
      if (providerConfig?.models) {
        return providerConfig.models
      }
      const endpoint = baseUrl && typeof baseUrl === 'string'
        ? baseUrl
        : (settings.ai?.endpoint ?? settings.ai?.apiUrl ?? 'http://localhost:8000')
      const isOllama = endpoint.includes('/api/generate') || providerConfig?.apiType === 'ollama'
      const base = endpoint.replace(/\/v1\/.*$/, '').replace(/\/api\/generate\/?$/, '').replace(/\/$/, '') || 'http://localhost:8000'

      if (isOllama) {
        const tagsUrl = `${base}/api/tags`
        const apiKey = (settings.ai?.apiKey || '').trim()
        const headers = {}
        if (apiKey) headers['X-API-KEY'] = apiKey
        const res = await fetch(tagsUrl, { headers })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        const json = await res.json()
        const list = json?.models ?? []
        return list.map((m) => (typeof m === 'string' ? m : m?.name ?? m?.model)).filter(Boolean)
      }
      const modelsUrl = `${base}/v1/models`
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
      if (window && ['write_file', 'patch_file', 'insert_at_line', 'edit_file'].includes(toolName)) {
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
  setupRetroHandlers(win, assertWorkspaceSelected)

  // Tilemap Editor: janela separada
  ipcMain.handle('retro:asset-report', () => {
    const projectPath = assertWorkspaceSelected()
    const report = inspectProjectAssets(projectPath)
    try { report.quarantines = listAssetQuarantines(projectPath) }
    catch (error) { report.quarantines = []; report.quarantineError = error.message }
    return report
  })
  async function assetActionWorkspace(payload) {
    const projectPath = assertWorkspaceSelected()
    if (typeof payload?.projectPath !== 'string' ||
        await fs.realpath(payload.projectPath) !== await fs.realpath(projectPath) ||
        assertWorkspaceSelected() !== projectPath) throw new Error('O workspace mudou. Atualize o relatório.')
    return projectPath
  }
  ipcMain.handle('retro:compiled-resource-report', async (_evt, payload = {}) => {
    const projectPath = await assetActionWorkspace(payload)
    const report = inspectCompiledResources(projectPath, { abi: payload.abi })
    return { success: true, projectPath, ...report }
  })
  ipcMain.handle('retro:save-hardware-budget', async (_evt, payload = {}) => {
    const projectPath = await assetActionWorkspace(payload)
    return { ...saveHardwareBudget(projectPath, payload), projectPath }
  })
  ipcMain.handle('retro:input-configuration', async (_evt, payload = {}) => {
    return inputConfigurationStatus(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:save-input-configuration', async (_evt, payload = {}) => {
    return saveInputConfiguration(await assetActionWorkspace(payload), { config: payload.config, revision: payload.revision })
  })
  const movementDiagnostics = createMovementDiagnosticService({toolkit: () => loadConfigFile('ui-settings.json', {}).toolkitPath, launch: romPath => runEmulatorAsync(romPath)})
  app.once('will-quit', () => movementDiagnostics.dispose())
  ipcMain.handle('retro:build-movement-diagnostic', async (_evt, payload = {}) => {
    const projectPath = await assetActionWorkspace(payload)
    const result = await movementDiagnostics.build(projectPath, {revision: payload.revision})
    await assetActionWorkspace(payload)
    return result
  })
  ipcMain.handle('retro:open-movement-diagnostic', async (_evt, payload = {}) => {
    return movementDiagnostics.open(await assetActionWorkspace(payload), {token: payload.token, revision: payload.revision})
  })
  ipcMain.handle('retro:movement-configuration', async (_evt, payload = {}) => {
    return movementConfigurationStatus(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:world-configuration', async (_evt, payload = {}) => {
    return worldConfigurationStatus(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:save-world-configuration', async (_evt, payload = {}) => {
    return saveWorldConfiguration(await assetActionWorkspace(payload), {config:payload.config,revision:payload.revision})
  })
  ipcMain.handle('retro:camera-configuration', async (_evt, payload = {}) => {
    return cameraConfigurationStatus(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:save-camera-configuration', async (_evt, payload = {}) => {
    return saveCameraConfiguration(await assetActionWorkspace(payload), { config: payload.config, revision: payload.revision })
  })
  ipcMain.handle('retro:progress-configuration', async (_evt, payload = {}) => {
    return progressConfigurationStatus(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:save-progress-configuration', async (_evt, payload = {}) => {
    return saveProgressConfiguration(await assetActionWorkspace(payload), { config: payload.config, revision: payload.revision, allowDroppedSchemas: payload.allowDroppedSchemas === true, allowMovedSlots: payload.allowMovedSlots === true })
  })
  ipcMain.handle('retro:audio-configuration', async (_evt, payload = {}) => {
    return audioConfigurationStatus(await assetActionWorkspace(payload), { toolkit: loadConfigFile('ui-settings.json', {}).toolkitPath, draft: payload.draft })
  })
  ipcMain.handle('retro:save-audio-configuration', async (_evt, payload = {}) => {
    return saveAudioConfiguration(await assetActionWorkspace(payload), { config: payload.config, revision: payload.revision }, { toolkit: loadConfigFile('ui-settings.json', {}).toolkitPath })
  })
  ipcMain.handle('retro:cutscene-adapter', async (_evt, payload = {}) => {
    return cutsceneAdapterStatus(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:save-cutscene-adapter', async (_evt, payload = {}) => {
    return saveCutsceneAdapter(await assetActionWorkspace(payload), { revision: payload.revision })
  })
  ipcMain.handle('retro:toolchain-status', async (_evt, payload = {}) => {
    return toolchainStatus(await assetActionWorkspace(payload), { toolkit: loadConfigFile('ui-settings.json', {}).toolkitPath })
  })
  ipcMain.handle('retro:record-toolchain', async (_evt, payload = {}) => {
    return recordToolchain(await assetActionWorkspace(payload), { toolkit: loadConfigFile('ui-settings.json', {}).toolkitPath, revision: payload.revision })
  })
  // #52: drafts of unsaved editor work (crash and project-switch recovery).
  ipcMain.handle('retro:editor-draft', async (_evt, payload = {}) => {
    const projectPath = await assetActionWorkspace(payload)
    if (payload.action === 'read') return { draft: readEditorDraft(projectPath, payload.editor) }
    if (payload.action === 'write') return writeEditorDraft(projectPath, payload.editor, { baseRevision: payload.baseRevision ?? null, state: payload.state })
    if (payload.action === 'clear') return clearEditorDraft(projectPath, payload.editor)
    throw new Error('Invalid draft action.')
  })
  ipcMain.handle('retro:hud-configuration', async (_evt, payload = {}) => {
    return hudConfigurationStatus(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:save-hud-configuration', async (_evt, payload = {}) => {
    try { return await saveHudConfiguration(await assetActionWorkspace(payload), { config: payload.config, revision: payload.revision }) }
    catch (error) { return { success: false, error: error.message } }
  })
  // #70: jogo gerado. O main.c do modelo serve só para reconhecer um main.c ainda intocado.
  const skeletonMain = () => { try { return readFileSync(path.join(gameTemplatePath('sgdk-skeleton').absolutePath, 'src/main.c')) } catch { return null } }
  ipcMain.handle('retro:game-host', async (_evt, payload = {}) => {
    return gameHostStatus(await assetActionWorkspace(payload), { templateMain: skeletonMain(), config: payload.config || null })
  })
  ipcMain.handle('retro:game-host-use-map-spawn', async (_evt, payload = {}) => {
    try { return await useMapSpawnAsStart(await assetActionWorkspace(payload)) }
    catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('retro:save-game-host', async (_evt, payload = {}) => {
    try { return await saveGameHost(await assetActionWorkspace(payload), { config: payload.config, revision: payload.revision, overwrite: payload.overwrite === true, templateMain: skeletonMain() }) }
    catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('retro:palette-configuration', async (_evt, payload = {}) => {
    return paletteConfigurationStatus(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:save-palette-configuration', async (_evt, payload = {}) => {
    // Refusals are answers, not crashes: the editor shows the reason in its own words.
    try { return savePaletteConfiguration(await assetActionWorkspace(payload), { config: payload.config, revision: payload.revision }) }
    catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('retro:palette-image', async (_evt, payload = {}) => {
    return readPaletteImage(await assetActionWorkspace(payload), payload.path)
  })
  // #64: depuração da ROM por um backend de emulador. Uma sessão por vez; os eventos vão para a janela.
  const debugService = createDebugService({
    toolkit: () => loadConfigFile('ui-settings.json', {}).toolkitPath,
    emulatorPath: id => resolveEmulatorPath(id),
    selectedEmulator: () => loadConfigFile('emulator-config.json', {}).selectedEmulator || 'gen_sdl2',
    build: (projectPath, toolkit, options) => runBuildAsync(projectPath, toolkit, options),
    buildBusy: () => isBuildRunning(),
    // O depurador nativo do BlastEm só conversa por um terminal.
    launchTerminal: (file, args, cwd) => pty.spawn(file, args, { name: 'dumb', cols: 250, rows: 50, cwd, env: process.env }),
    send: event => { for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('retro:debug-event', event) }
  })
  app.on('before-quit', () => debugService.dispose())
  const debugAnswer = action => async (_evt, payload = {}) => {
    try { return await action(await assetActionWorkspace(payload), payload) }
    catch (error) { return { success: false, error: error.message } }
  }
  ipcMain.handle('retro:debug-status', debugAnswer(projectPath => debugService.status(projectPath)))
  ipcMain.handle('retro:debug-build', debugAnswer((projectPath, payload) => payload.cancel === true ? debugService.cancelBuild() : debugService.build(projectPath)))
  ipcMain.handle('retro:debug-start', debugAnswer((projectPath, payload) => debugService.start(projectPath, { backend: payload.backend })))
  ipcMain.handle('retro:debug-command', debugAnswer((projectPath, payload) => debugService.command(projectPath, payload)))
  ipcMain.handle('retro:debug-configuration', async (_evt, payload = {}) => {
    return debugConfigurationStatus(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:save-debug-configuration', async (_evt, payload = {}) => {
    return saveDebugConfiguration(await assetActionWorkspace(payload), { config: payload.config, revision: payload.revision })
  })
  ipcMain.handle('retro:export-overview', async (_evt, payload = {}) => {
    return exportOverview(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:save-movement-configuration', async (_evt, payload = {}) => {
    return saveMovementConfiguration(await assetActionWorkspace(payload), { config: payload.config, revision: payload.revision })
  })
  ipcMain.handle('retro:runtime-status', async (_evt, payload = {}) => {
    return runtimeInstallationStatus(await assetActionWorkspace(payload))
  })
  ipcMain.handle('retro:install-runtime', async (evt, payload = {}) => {
    const projectPath = await assetActionWorkspace(payload)
    const plan = runtimeInstallationStatus(projectPath)
    const choice = await dialog.showMessageBox(BrowserWindow.fromWebContents(evt.sender) || win, {
      type: plan.conflicts.length ? 'warning' : 'question', title: 'Módulos do runtime',
      buttons: ['Instalar / atualizar', 'Cancelar'], defaultId: 1, cancelId: 1,
      message: 'Instalar estas versões do runtime no projeto?',
      detail: plan.modules.map(module => module.id + ' v' + module.version).join('\n') + '\n\n' +
        plan.files.map(file => file.path + ' · ' + file.status).join('\n') +
        '\n\nCódigo do jogo e adaptação SGDK permanecem preservados.' +
        (plan.conflicts.length ? '\nArquivos personalizados listados serão substituídos, mantendo backups recuperáveis.' : '')
    })
    if (choice.response !== 0) return { cancelled: true }
    if (assertWorkspaceSelected() !== projectPath) throw new Error('O workspace mudou. Instalação cancelada.')
    return installRuntimeModules(projectPath, { expectedPlanId: plan.planId, allowConflicts: plan.conflicts.length > 0 })
  })
  ipcMain.handle('retro:quarantine-assets', async (evt, payload = {}) => {
    const projectPath = await assetActionWorkspace(payload)
    const plan = planAssetQuarantine(projectPath, payload.paths)
    const unknown = plan.warnings.dynamicSources.length || plan.warnings.skipped.length
    const choice = await dialog.showMessageBox(BrowserWindow.fromWebContents(evt.sender) || win, {
      type: 'warning', title: 'Quarentena de derivados', buttons: ['Mover para quarentena', 'Cancelar'], defaultId: 1, cancelId: 1,
      message: 'Mover estes derivados para a quarentena?',
      detail: plan.assets.map(item => item.path + ' (' + Math.ceil(item.size / 1024) + ' KiB)').join('\n') +
        '\n\nTotal: ' + plan.assets.length + ' arquivo(s), ' + Math.ceil(plan.totalBytes / 1024) + ' KiB.' +
        '\n\nOs arquivos serão preservados para restauração. Originais e arquivos com referências conhecidas são recusados.' +
        (unknown ? '\nScripts ou arquivos omitidos podem esconder usos. Confirme apenas se estes derivados podem sair do game.' : '')
    })
    if (choice.response !== 0) return { cancelled: true }
    if (assertWorkspaceSelected() !== projectPath) throw new Error('O workspace mudou. Limpeza cancelada.')
    return quarantineProjectAssets(projectPath, payload.paths, plan.planId)
  })
  ipcMain.handle('retro:restore-assets', async (evt, payload = {}) => {
    const projectPath = await assetActionWorkspace(payload)
    const record = listAssetQuarantines(projectPath).find(item => item.id === payload.quarantineId && item.status === 'quarantined')
    if (!record) throw new Error('Quarentena não disponível. Atualize o relatório.')
    const choice = await dialog.showMessageBox(BrowserWindow.fromWebContents(evt.sender) || win, {
      type: 'question', title: 'Restaurar derivados', buttons: ['Restaurar', 'Cancelar'], defaultId: 1, cancelId: 1,
      message: 'Restaurar os arquivos desta quarentena?',
      detail: record.paths.join('\n') + '\n\nArquivos existentes e alterações atuais do projeto serão preservados.'
    })
    if (choice.response !== 0) return { cancelled: true }
    if (assertWorkspaceSelected() !== projectPath) throw new Error('O workspace mudou. Restauração cancelada.')
    return restoreAssetQuarantine(projectPath, payload.quarantineId)
  })
  ipcMain.handle('retro:export-character', async (_evt, payload = {}) => {
    const projectPath = assertWorkspaceSelected()
    if (typeof payload.projectPath !== 'string' ||
        await fs.realpath(payload.projectPath) !== await fs.realpath(projectPath))
      throw new Error('O personagem não pertence ao workspace aberto.')
    if (assertWorkspaceSelected() !== projectPath) throw new Error('O workspace mudou. Exporte novamente.')
    return exportCharacterToProject(projectPath, payload)
  })
  ipcMain.handle('retro:recover-export', async (evt, transactionId) => {
    const projectPath = assertWorkspaceSelected()
    const pending = inspectPendingProjectExport(projectPath)
    if (!pending.pending || pending.transactionId !== transactionId || pending.active)
      throw new Error('A exportação mudou ou ainda está ativa. Atualize o relatório.')
    const choice = await dialog.showMessageBox(BrowserWindow.fromWebContents(evt.sender) || win, {
      type: 'warning', title: 'Recuperar exportação', buttons: ['Restaurar', 'Cancelar'],
      defaultId: 1, cancelId: 1,
      message: 'Restaurar as saídas anteriores desta exportação?',
      detail: pending.outputs.join('\n') + '\n\nArquivos com alterações externas serão preservados e impedirão a recuperação. Os snapshots serão mantidos.'
    })
    if (choice.response !== 0) return { cancelled: true }
    if (assertWorkspaceSelected() !== projectPath) throw new Error('O workspace mudou. Recuperação cancelada.')
    return recoverProjectExport(projectPath, transactionId)
  })
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
  ipcMain.handle('tilemap:export-after-save', async (evt, payload = {}) => {
    // Editor em janela própria: o projeto vem da janela. Editor embutido (modo Mapas): é o workspace aberto.
    const data = tilemapWindowData.get(evt.sender.id)
    const projectPath = path.resolve(data?.projectPath || assertWorkspaceSelected())
    if (!currentWorkspacePath || projectPath !== path.resolve(currentWorkspacePath)) {
      throw new Error('O projeto do editor de mapas não corresponde ao workspace aberto.')
    }
    return runConfiguredMapExporter({ projectPath, mapPath: payload.mapPath })
  })
  ipcMain.handle('tilemap:list-kit-maps', async (_evt, payload = {}) => {
    const directory = assertPathInsideWorkspace(payload.directory)
    const stat = await fs.stat(directory)
    if (!stat.isDirectory()) throw new Error('Map kit path is not a directory')
    const excludedFile = payload.excludedFile ? assertPathInsideWorkspace(payload.excludedFile) : ''
    return listMapFilesInKit(directory, excludedFile)
  })
  ipcMain.handle('tilemap:delete-kit-map', async (_evt, payload = {}) => {
    const workspace = await fs.realpath(assertWorkspaceSelected())
    const directory = await fs.realpath(assertPathInsideWorkspace(payload.directory))
    const kitRelative = path.relative(workspace, directory)
    if (!kitRelative || kitRelative.startsWith('..') || path.isAbsolute(kitRelative)) throw new Error('Map kit is outside the workspace.')
    const excludedFile = payload.excludedFile ? await fs.realpath(assertPathInsideWorkspace(payload.excludedFile)) : ''
    const mapPath = await fs.realpath(assertPathInsideWorkspace(payload.mapPath))
    const relative = path.relative(directory, mapPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/\.(tmx|json)$/i.test(mapPath)) {
      throw new Error('Map must be inside this kit folder.')
    }
    if (excludedFile && mapPath === excludedFile) throw new Error('The map kit definition cannot be deleted as a map.')
    const stat = await fs.stat(mapPath)
    if (!stat.isFile()) throw new Error('Selected map is not a file.')
    const trashed = await moveToTrash(mapPath)
    if (!trashed) await fs.unlink(mapPath)
    return { success: true, path: mapPath, trashed }
  })
  ipcMain.handle('tilemap:find-kit-for-map', async (evt, payload = {}) => {
    const editorProject = tilemapWindowData.get(evt.sender.id)?.projectPath
    const workspacePath = await fs.realpath(editorProject || assertWorkspaceSelected())
    const mapPath = await fs.realpath(payload.mapPath || '')
    const relative = path.relative(workspacePath, mapPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Map path is outside the tilemap editor project')
    }
    return findMapKitForMap(mapPath, workspacePath)
  })
  // Cutscenes: o projeto vem da janela do editor e precisa ser o workspace aberto.
  const cutsceneProjectPath = (evt) => {
    const data = tilemapWindowData.get(evt.sender.id)
    const projectPath = path.resolve(data?.projectPath || assertWorkspaceSelected())
    if (!currentWorkspacePath || projectPath !== path.resolve(currentWorkspacePath)) {
      throw new Error('O projeto do editor não corresponde ao workspace aberto.')
    }
    return projectPath
  }
  ipcMain.handle('tilemap:cutscene-runtime-status', (evt) => cutsceneRuntimeStatus(cutsceneProjectPath(evt)))
  ipcMain.handle('tilemap:install-cutscene-runtime', (evt) => installCutsceneRuntime(cutsceneProjectPath(evt)))
  ipcMain.handle('tilemap:list-cutscenes', (evt) => {
    const projectPath = cutsceneProjectPath(evt)
    return { projectPath, files: listCutsceneFiles(projectPath) }
  })
  ipcMain.handle('tilemap:export-cutscenes', (evt, payload) => {
    const projectPath = cutsceneProjectPath(evt)
    if (!payload || typeof payload.projectPath !== 'string' || path.resolve(payload.projectPath) !== projectPath || !['prepare', 'publish'].includes(payload.phase)) throw new Error('Invalid cutscene export request or workspace.')
    return payload.phase === 'prepare' ? prepareCutsceneExport(projectPath) : publishCutsceneExport(projectPath)
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

  ipcMain.handle('app:getInfo', async () => getAppInfo())
  ipcMain.handle('app:checkUpdates', async () => checkForUpdates())
  ipcMain.handle('app:getChangelog', async (_evt, options = {}) => fetchChangelog(options))
  ipcMain.handle('app:openExternal', async (_evt, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url)
      return { ok: true }
    }
    return { ok: false }
  })

  // Verifica se o app foi iniciado com um caminho via CLI
  win.webContents.once('did-finish-load', async () => {
    const pathFromArgv = await getPathFromArgv(process.argv)
    if (pathFromArgv) {
      log('info', 'app:startup', 'Abrindo workspace inicial via CLI', { path: pathFromArgv })
      win.webContents.send('workspace:open-from-cli', pathFromArgv)
    }
    // Checagem silenciosa de updates (não bloqueia)
    try {
      const update = await checkForUpdates()
      if (update?.updateAvailable) {
        win.webContents.send('app:update-available', update)
      }
    } catch (e) {
      console.warn('[updates] check failed', e?.message || e)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Agentes ACP (Codex/OpenCode) rodam em grupo de processos próprio: sem isto,
// sobreviveriam ao app e manteriam o lock das sessões do Codex.
app.on('will-quit', () => {
  acpSessionManager.killAll()
})
