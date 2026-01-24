/* eslint-disable no-unused-vars */
'use strict'

import { app, protocol, BrowserWindow, screen, ipcRenderer, Tray, dialog } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'
const isDevelopment = process.env.NODE_ENV !== 'production'

//Executar comandos
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ipcMain, shell } = require('electron');
import { parseCompilationOutput } from './utils/errorParser.js';

// Pasta de configurações no Home do usuário
const CONFIG_DIR = path.join(app.getPath('home'), '.retrostudio');

/** Garante que a pasta de configuração existe */
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** Salva um objeto como JSON na pasta de configuração */
function saveConfigFile(filename, data) {
  try {
    ensureConfigDir();
    const filePath = path.join(CONFIG_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error(`Erro ao salvar arquivo de config ${filename}:`, error);
    return false;
  }
}

/** Carrega um objeto JSON da pasta de configuração */
function loadConfigFile(filename, defaultValue = {}) {
  try {
    const filePath = path.join(CONFIG_DIR, filename);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (error) {
    console.error(`Erro ao carregar arquivo de config ${filename}:`, error);
  }
  return defaultValue;
}

let mainWindow = null;

const TEMPLATE_DIRECTORIES = {
  'md-skeleton': 'md-skeleton',
  '32x-skeleton': '32x-skeleton',
  'sgdk-skeleton': 'sgdk-skeleton',
  'sgdk-stage9-sample': 'sgdk-stage9-sample'
}

const DEFAULT_EMULATOR_RELATIVE_PATH = ['toolkit', 'emulators', 'md', 'gen_sdl2']
const AVAILABLE_EMULATORS = {
  'gen_sdl2': ['toolkit', 'emulators', 'md', 'gen_sdl2'],
  'blastem': ['toolkit', 'emulators', 'blastem', 'blastem']
}

function getAppPathSafe() {
  try {
    if (app && typeof app.getAppPath === 'function') {
      return app.getAppPath()
    }
  } catch (error) {
    console.warn('Não foi possível obter appPath:', error)
  }
  return null
}

function resolveTemplateAbsolutePath(templateDir) {
  const candidates = []
  const appPath = getAppPathSafe()
  const projectRoot = path.resolve(__dirname, '..')
  const resourcesPath = process.resourcesPath

  if (appPath) {
    candidates.push(path.join(appPath, 'toolkit', 'examples', templateDir))
    candidates.push(path.join(appPath, 'src', 'toolkit', 'examples', templateDir))
    candidates.push(path.join(appPath, '..', 'src', 'toolkit', 'examples', templateDir))
  }

  // Candidatos no diretório de recursos do AppImage
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'toolkit', 'examples', templateDir))
    candidates.push(path.join(resourcesPath, 'app.asar.unpacked', 'toolkit', 'examples', templateDir))
  }

  candidates.push(path.join(__dirname, 'toolkit', 'examples', templateDir))
  candidates.push(path.join(projectRoot, 'src', 'toolkit', 'examples', templateDir))
  candidates.push(path.join(projectRoot, 'toolkit', 'examples', templateDir))
  candidates.push(path.join(process.cwd(), 'toolkit', 'examples', templateDir))
  candidates.push(path.join(process.cwd(), 'src', 'toolkit', 'examples', templateDir))

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  console.warn(`Template "${templateDir}" não encontrado. Caminhos testados:`, candidates)
  return null
}

function getTemplatePath(templateKey) {
  const key = TEMPLATE_DIRECTORIES[templateKey] ? templateKey : 'md-skeleton'
  return {
    key,
    absolutePath: resolveTemplateAbsolutePath(TEMPLATE_DIRECTORIES[key])
  }
}

function resolveEmulatorPath(emulatorName = null) {
  const appPath = getAppPathSafe()
  const projectRoot = path.resolve(__dirname, '..')
  const resourcesPath = process.resourcesPath
  const emulatorKey = emulatorName || 'gen_sdl2'
  const relativePath = AVAILABLE_EMULATORS[emulatorKey] || AVAILABLE_EMULATORS['gen_sdl2']

  const candidateBuilders = [
    () => appPath && path.join(appPath, ...relativePath),
    () => appPath && path.join(appPath, 'src', ...relativePath),
    () => resourcesPath && path.join(resourcesPath, ...relativePath),
    () => resourcesPath && path.join(resourcesPath, 'app.asar.unpacked', ...relativePath),
    () => path.join(__dirname, ...relativePath),
    () => path.join(projectRoot, 'src', ...relativePath),
    () => path.join(projectRoot, ...relativePath),
    () => path.join(process.cwd(), ...relativePath),
    () => path.join(process.cwd(), 'src', ...relativePath)
  ]

  for (const buildCandidate of candidateBuilders) {
    const candidate = buildCandidate()
    if (candidate && fs.existsSync(candidate)) {
      console.log(`[DEBUG] Found ${emulatorKey} at: ${candidate}`)
      return candidate
    }
  }

  console.warn(`Emulador "${emulatorKey}" não encontrado nos caminhos conhecidos.`)
  return null
}

function getAvailableEmulators() {
  const available = {}
  console.log('[DEBUG] Starting emulator detection...')
  console.log('[DEBUG] AVAILABLE_EMULATORS:', AVAILABLE_EMULATORS)
  
  for (const [name, relativePath] of Object.entries(AVAILABLE_EMULATORS)) {
    const resolvedPath = resolveEmulatorPath(name)
    console.log(`[DEBUG] ${name}: resolved to "${resolvedPath}"${resolvedPath && fs.existsSync(resolvedPath) ? ' [FOUND]' : ' [NOT FOUND]'}`)
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      available[name] = resolvedPath
      console.log(`[DEBUG] ${name} added to available emulators`)
    }
  }
  
  console.log('[DEBUG] Final available emulators:', Object.keys(available))
  return available
}

function findRomOutput(projectPath) {
  const preferredCandidates = [
    path.join(projectPath, 'out', 'rom.bin'),
    path.join(projectPath, 'rom.bin'),
    path.join(projectPath, 'out', 'out.bin'),
    path.join(projectPath, 'out.bin'),
  ]

  for (const candidate of preferredCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  const scanDirs = [projectPath, path.join(projectPath, 'out')]
  let latestRom = null
  let latestTime = 0

  scanDirs.forEach(dir => {
    if (!dir || !fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir)
    entries.forEach(entry => {
      if (!/\.(bin|32x)$/i.test(entry)) return
      const entryPath = path.join(dir, entry)
      try {
        const stats = fs.statSync(entryPath)
        if (stats.isFile() && stats.mtimeMs >= latestTime) {
          latestRom = entryPath
          latestTime = stats.mtimeMs
        }
      } catch (err) {
        console.warn('Falha ao inspecionar ROM candidate:', entryPath, err)
      }
    })
  })

  return latestRom
}

function copyDirectoryRecursive(source, destination) {
  const stats = fs.statSync(source)
  if (stats.isDirectory()) {
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true })
    }
    const entries = fs.readdirSync(source)
    entries.forEach(entry => {
      const srcPath = path.join(source, entry)
      const destPath = path.join(destination, entry)
      copyDirectoryRecursive(srcPath, destPath)
    })
    return
  }
  fs.copyFileSync(source, destination)
}

function resolveProjectRoot(projectPath) {
  if (!projectPath) {
    throw new Error('Caminho do projeto não informado.')
  }
  const resolved = path.resolve(projectPath)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Projeto inválido ou inacessível.')
  }
  return resolved
}

function ensurePathInsideProject(projectRoot, candidatePath) {
  const resolvedRoot = path.resolve(projectRoot)
  const resolvedCandidate = path.resolve(candidatePath)
  if (!resolvedCandidate.startsWith(resolvedRoot)) {
    throw new Error('Operação fora do diretório do projeto.')
  }
  return resolvedCandidate
}

function sanitizeEntryName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Nome inválido.')
  }
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Nome inválido.')
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Nome não pode conter separadores de diretórios.')
  }
  return trimmed
}

function copyEntryRecursive(source, destination) {
  const stats = fs.statSync(source)
  if (stats.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true })
    fs.readdirSync(source).forEach(entry => {
      copyEntryRecursive(
        path.join(source, entry),
        path.join(destination, entry)
      )
    })
    return
  }
  fs.copyFileSync(source, destination)
}

function sendFsResult(event, operation, payload = {}, requestId = null) {
  event.reply('fs-operation-result', {
    operation,
    requestId,
    ...payload
  })
}

function ensureEntryExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error('Entrada não encontrada.')
  }
}

function buildUniqueName(baseName, existingNames) {
  if (!existingNames.has(baseName)) {
    return baseName
  }

  const extensionIndex = baseName.lastIndexOf('.')
  const hasExtension = extensionIndex > 0
  const namePart = hasExtension ? baseName.slice(0, extensionIndex) : baseName
  const extensionPart = hasExtension ? baseName.slice(extensionIndex) : ''

  let counter = 1
  let candidate = `${namePart} copy${extensionPart}`
  while (existingNames.has(candidate)) {
    counter += 1
    candidate = `${namePart} copy ${counter}${extensionPart}`
  }
  return candidate
}

ipcMain.on('get-home', (event, result) => {
  const homeDirectory = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
  if (homeDirectory) {
    const caminhoNoHome = path.resolve(homeDirectory);
    console.log(caminhoNoHome);
    const resultDir = navigateDirectory(path.join(caminhoNoHome))
    event.reply('send-directory', resultDir);
  } else {
    console.error('Não foi possível determinar o diretório home.');
  }
})

ipcMain.on('current-path', (event, result) => {
  console.log(result)
  console.log(path.join(__dirname))
  const resultDir = navigateDirectory(path.join(__dirname))
  event.reply('send-directory', resultDir);
})

ipcMain.on('directory-navigate', (event, result) => {
  const resultDir = navigateDirectory(result.path)
  event.reply('send-directory', resultDir);
})

ipcMain.on('back-directory-navigate', (event, result) => {

  console.log('navigate: ', result)

  const diretorioPai = path.resolve(result.path, '..');
  const resultDir = navigateDirectory(diretorioPai)
  event.reply('send-directory', resultDir);
})

function navigateDirectory(caminho) {
  try {
    const stats = fs.statSync(caminho);

    // Se o nome do diretório for "out" ou começar com ".", ignore
    if (stats.isDirectory() && (path.basename(caminho) === 'out' || path.basename(caminho).startsWith('.'))) {
      return null;
    }

    const item = {
      id: '' + Math.random(),
      label: path.basename(caminho),
      tipo: stats.isDirectory() ? 'diretorio' : 'arquivo',
      path: caminho,
      expanded: false,
    };

    if (stats.isDirectory()) {
      const conteudo = fs.readdirSync(caminho).map(subItem => {
        const subCaminho = path.join(caminho, subItem);

        try {
          const subStats = fs.statSync(subCaminho);

          // Adiciona apenas diretórios ao array conteudo
          if (subStats.isDirectory() && !subItem.startsWith('.')) {
            return {
              id: '' + Math.random(),
              label: subItem,
              tipo: 'diretorio',
              path: subCaminho,
              expanded: false,
            };
          }
        } catch (error) {
          // Ignora subdiretórios/arquivos inacessíveis
          return null;
        }
      });

      // Filtra e remove diretórios nulos (ignorados)
      item.children = conteudo.filter(Boolean);
    }

    return item;
  } catch (error) {
    console.log('Erro on navigateDirectory: ', error);
    return null;
  }
}


function lerDiretorio(caminho) {
  const stats = fs.statSync(caminho);

  // Se o nome do diretório for "out", ignore
  if (stats.isDirectory() && (path.basename(caminho) === 'out' || path.basename(caminho).startsWith('.'))) {
    return null;
  }

  const item = {
    id: '' + Math.random(),
    label: path.basename(caminho),
    tipo: stats.isDirectory() ? 'diretorio' : 'arquivo',
    path: caminho,
    expanded: false,
  };

  if (stats.isDirectory()) {
    const conteudo = fs.readdirSync(caminho)
      .map(subItem => {
        const subCaminho = path.join(caminho, subItem);

        // Ignora diretórios com o nome "out"
        if (path.basename(subCaminho) !== 'out') {
          return lerDiretorio(subCaminho);
        }

        return null;
      })
      .filter(Boolean) // Remove diretórios nulos (ignorados)
      .sort((a, b) => {
        // Ordena diretórios antes dos arquivos
        if (a.tipo === 'diretorio' && b.tipo === 'arquivo') {
          return -1;
        } else if (a.tipo === 'arquivo' && b.tipo === 'diretorio') {
          return 1;
        } else {
          // Mantém a ordem original para os casos restantes
          return 0;
        }
      });

    item.children = conteudo;
  }

  return item;
}

function getProjectConfig(projectPath) {
  const configPath = path.join(projectPath, 'retro-studio.json')
  let config = {
    name: path.basename(projectPath),
    template: 'md-skeleton',
    createdAt: new Date().toISOString(),
    resourcePath: 'res',
    assets: []
  }

  try {
    if (fs.existsSync(configPath)) {
      const fileData = fs.readFileSync(configPath, 'utf-8')
      const savedConfig = JSON.parse(fileData)
      config = { ...config, ...savedConfig }
    } else {
      // Criar o arquivo se não existir
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      console.log('[IPC] retro-studio.json criado em:', projectPath)
    }
  } catch (error) {
    console.error('[IPC] Erro ao ler/criar retro-studio.json:', error)
  }

  return config
}

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
    
    // Evitar duplicatas de assets
    if (!config.assets) {
      config.assets = []
    }
    const assetExists = config.assets.some(a => a.id === asset.id)
    if (!assetExists) {
      config.assets.push(asset)
    }
    
    // Salvar configuração atualizada
    const configPath = path.join(projectPath, 'retro-studio.json')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    console.log('[IPC] Asset adicionado à config:', asset.name)
    
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
    console.log('[IPC] Configuração do projeto salva:', configPath)
    event.reply('save-project-config-result', { success: true })
  } catch (error) {
    console.error('[IPC] Erro ao salvar retro-studio.json:', error)
    event.reply('save-project-config-result', { success: false, error: error.message })
  }
})

// Handler extra para remover asset da config se necessário
ipcMain.on('remove-asset-from-config', (event, { projectPath, assetId }) => {
  try {
    const config = getProjectConfig(projectPath)
    
    if (!config.assets) {
      config.assets = []
    }
    
    // Remover asset pelo ID
    config.assets = config.assets.filter(a => a.id !== assetId)
    
    // Salvar configuração atualizada
    const configPath = path.join(projectPath, 'retro-studio.json')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    console.log('[IPC] Asset removido da config:', assetId)
    
    event.reply('remove-asset-result', { success: true })
  } catch (error) {
    console.error('[IPC] Erro ao remover asset:', error)
    event.reply('remove-asset-result', { success: false, error: error.message })
  }
})

ipcMain.on('fs-create-entry', (event, payload) => {
  try {
    const { projectPath, targetDir, entryName, entryType, templatePath } = payload || {}
    const projectRoot = resolveProjectRoot(projectPath)
    const sanitizedName = sanitizeEntryName(entryName)
    const absoluteTargetDir = ensurePathInsideProject(projectRoot, targetDir)

    if (!['file', 'folder'].includes(entryType)) {
      throw new Error('Tipo de entrada inválido.')
    }

    const destinationPath = path.join(absoluteTargetDir, sanitizedName)
    if (fs.existsSync(destinationPath)) {
      throw new Error('Já existe um item com esse nome.')
    }

    if (entryType === 'folder') {
      fs.mkdirSync(destinationPath, { recursive: true })
    } else {
      if (templatePath) {
        const resolvedTemplate = ensurePathInsideProject(projectRoot, templatePath)
        fs.copyFileSync(resolvedTemplate, destinationPath)
      } else {
        fs.writeFileSync(destinationPath, '', 'utf-8')
      }
    }

    sendFsResult(event, 'create', { success: true, path: destinationPath })
  } catch (error) {
    console.error('fs-create-entry error:', error)
    sendFsResult(event, 'create', { success: false, error: error.message })
  }
})

ipcMain.on('fs-rename-entry', (event, payload) => {
  try {
    const { projectPath, targetPath, newName } = payload || {}
    const projectRoot = resolveProjectRoot(projectPath)
    const absoluteTargetPath = ensurePathInsideProject(projectRoot, targetPath)
    ensureEntryExists(absoluteTargetPath)

    const sanitizedName = sanitizeEntryName(newName)
    const destinationPath = path.join(path.dirname(absoluteTargetPath), sanitizedName)
    if (fs.existsSync(destinationPath)) {
      throw new Error('Já existe um item com esse nome.')
    }

    fs.renameSync(absoluteTargetPath, destinationPath)
    sendFsResult(event, 'rename', { success: true, path: destinationPath, previousPath: absoluteTargetPath })
  } catch (error) {
    console.error('fs-rename-entry error:', error)
    sendFsResult(event, 'rename', { success: false, error: error.message })
  }
})

ipcMain.on('fs-delete-entry', (event, payload) => {
  try {
    const { projectPath, targetPath } = payload || {}
    const projectRoot = resolveProjectRoot(projectPath)
    const absoluteTargetPath = ensurePathInsideProject(projectRoot, targetPath)
    ensureEntryExists(absoluteTargetPath)

    const stats = fs.statSync(absoluteTargetPath)
    if (stats.isDirectory()) {
      fs.rmSync(absoluteTargetPath, { recursive: true, force: true })
    } else {
      fs.unlinkSync(absoluteTargetPath)
    }

    sendFsResult(event, 'delete', { success: true, path: absoluteTargetPath })
  } catch (error) {
    console.error('fs-delete-entry error:', error)
    sendFsResult(event, 'delete', { success: false, error: error.message })
  }
})

ipcMain.on('fs-copy-entry', (event, payload) => {
  try {
    const { projectPath, sourcePath, targetDir } = payload || {}
    const projectRoot = resolveProjectRoot(projectPath)
    const absoluteSourcePath = ensurePathInsideProject(projectRoot, sourcePath)
    ensureEntryExists(absoluteSourcePath)

    const absoluteTargetDir = ensurePathInsideProject(projectRoot, targetDir)
    ensureEntryExists(absoluteTargetDir)

    const baseName = path.basename(absoluteSourcePath)
    const existingNames = new Set(fs.readdirSync(absoluteTargetDir))
    const newName = buildUniqueName(baseName, existingNames)
    const destinationPath = path.join(absoluteTargetDir, newName)

    copyEntryRecursive(absoluteSourcePath, destinationPath)
    sendFsResult(event, 'copy', { success: true, path: destinationPath })
  } catch (error) {
    console.error('fs-copy-entry error:', error)
    sendFsResult(event, 'copy', { success: false, error: error.message })
  }
})

ipcMain.on('fs-move-entry', (event, payload) => {
  try {
    console.log('fs-move-entry payload:', payload)
    const { projectPath, sourcePath, targetDir } = payload || {}
    const projectRoot = resolveProjectRoot(projectPath)
    const absoluteSourcePath = ensurePathInsideProject(projectRoot, sourcePath)
    ensureEntryExists(absoluteSourcePath)

    const absoluteTargetDir = ensurePathInsideProject(projectRoot, targetDir)
    ensureEntryExists(absoluteTargetDir)

    const destinationPath = path.join(absoluteTargetDir, path.basename(absoluteSourcePath))
    if (fs.existsSync(destinationPath)) {
      throw new Error('Já existe um item com esse nome no destino.')
    }

    fs.renameSync(absoluteSourcePath, destinationPath)
    sendFsResult(event, 'move', { success: true, path: destinationPath })
  } catch (error) {
    console.error('fs-move-entry error:', error)
    sendFsResult(event, 'move', { success: false, error: error.message })
  }
})

ipcMain.on('fs-open-with', (event, payload) => {
  try {
    const { projectPath, targetPath } = payload || {}
    const projectRoot = resolveProjectRoot(projectPath)
    const absoluteTargetPath = ensurePathInsideProject(projectRoot, targetPath)
    ensureEntryExists(absoluteTargetPath)

    shell.openPath(absoluteTargetPath)
    sendFsResult(event, 'open-with', { success: true, path: absoluteTargetPath })
  } catch (error) {
    console.error('fs-open-with error:', error)
    sendFsResult(event, 'open-with', { success: false, error: error.message })
  }
})

let emulatorProcess = null
let currentBuildProcess = null
let currentEmulatorConfig = { selectedEmulator: 'gen_sdl2' }

ipcMain.on('stop-game', (event) => {
  console.log('[IPC] stop-game request received');
  
  if (currentBuildProcess) {
    console.log('[IPC] Killing build process...');
    try {
      // No Linux, precisamos matar o grupo de processos se quisermos garantir que o 'make' e seus filhos parem
      process.kill(-currentBuildProcess.pid, 'SIGTERM');
    } catch (e) {
      currentBuildProcess.kill();
    }
    currentBuildProcess = null;
  }

  if (emulatorProcess) {
    console.log('[IPC] Killing emulator process...');
    emulatorProcess.kill();
    emulatorProcess = null;
  }

  event.reply('emulator-closed', { code: 0, interrupted: true });
});

ipcMain.on('run-game', (event, result) =>{

  console.log('run game', result)
  const projectPath = result.path
  const toolkitPath = result.toolkitPath
  
  // Garantir que processos anteriores sejam limpos
  if (currentBuildProcess) currentBuildProcess.kill();
  if (emulatorProcess) emulatorProcess.kill();

  // Carregar configuração de emulador salva
  const configData = loadConfigFile('emulator-config.json', { selectedEmulator: 'gen_sdl2' });
  let selectedEmulatorName = configData.selectedEmulator || 'gen_sdl2';
  console.log(`[DEBUG] Loaded emulator config: ${selectedEmulatorName}`)

  if (!toolkitPath || !fs.existsSync(toolkitPath)) {
    console.warn('Toolkit path inválido ou não configurado:', toolkitPath)
    event.reply('run-game-error', { 
      message: 'Toolkit path inválido. Configure o SGDK nas configurações.' 
    })
    return
  }

  if (!projectPath || !fs.existsSync(projectPath)) {
    console.warn('Project path inválido:', projectPath)
    event.reply('run-game-error', { 
      message: 'Projeto inválido. Abra um projeto antes de executar.' 
    })
    return
  }

  const toolkitRunner = path.join(toolkitPath, 'dgen')
  const selectedEmulatorPath = resolveEmulatorPath(selectedEmulatorName)
  const defaultEmulator = selectedEmulatorPath || resolveEmulatorPath('gen_sdl2')

  const envMake = `MARSDEV="${toolkitPath}"`
  const buildCommand = `${envMake} make`

  currentBuildProcess = exec(`cd "${projectPath}" && ${buildCommand}`, {
    detached: true // Para podermos matar o grupo de processos no Linux
  }, (error, stdout, stderr) => {
    currentBuildProcess = null;
    
    // Parse compilation errors/warnings from stderr and stdout
    const compilationOutput = stdout + '\n' + stderr
    const errors = parseCompilationOutput(compilationOutput)
    
    if (errors.length > 0) {
      console.log(`[Compilation] Found ${errors.length} issues`)
      event.reply('compilation-errors', { errors, output: compilationOutput })
    }
    
    if (error) {
      // Se foi interrompido manualmente, não mostrar como erro fatal
      if (error.killed) {
        console.log('Build interrompido pelo usuário.');
        return;
      }
      console.error(`Erro ao executar build: ${stderr || error.message}`)
      event.reply('run-game-error', { message: stderr || error.message })
      return
    }

    const romPath = findRomOutput(projectPath)
    if (!romPath) {
      event.reply('run-game-error', { message: 'ROM não encontrada após o build.' })
      return
    }

    const emulatorToUse = defaultEmulator && fs.existsSync(defaultEmulator)
      ? defaultEmulator
      : toolkitRunner

    // Notificar que o build foi concluído com sucesso
    event.reply('run-game-build-complete', { romPath, emulator: emulatorToUse })

    // Usar spawn para executar o emulador e detectar quando fecha
    console.log(`Executando emulador (${selectedEmulatorName}): ${emulatorToUse}`)
    
    emulatorProcess = spawn(emulatorToUse, [romPath], {
      detached: false,
      stdio: 'ignore'
    })

    emulatorProcess.on('close', (code) => {
      console.log(`Emulador fechado com código: ${code}`)
      event.reply('emulator-closed', { code })
      emulatorProcess = null
    })

    emulatorProcess.on('error', (err) => {
      console.error(`Erro ao executar emulador: ${err.message}`)
      event.reply('run-game-error', { message: err.message })
      emulatorProcess = null
    })
  })
})

// Função para ler o conteúdo de um arquivo
function lerConteudoArquivo(caminhoArquivo) {
  try {
    // Validar caminho
    if (!caminhoArquivo || typeof caminhoArquivo !== 'string') {
      console.error('[lerConteudoArquivo] Caminho invalido')
      return null
    }
    
    const caminho = caminhoArquivo.trim()
    
    // Rejeitar linhas de erro do make
    if (caminho.startsWith('make:') || caminho.includes('***')) {
      console.error('[lerConteudoArquivo] Linha de erro, nao eh arquivo')
      return null
    }
    
    // Verificar se arquivo existe
    if (!fs.existsSync(caminho)) {
      console.error('[lerConteudoArquivo] Arquivo nao encontrado:', caminho)
      return null
    }
    
    console.log('[lerConteudoArquivo] Lendo:', caminho)
    const conteudo = fs.readFileSync(caminho, 'utf-8')
    return conteudo
  } catch (error) {
    console.error('[lerConteudoArquivo] Erro:', error.message)
    return null
  }
}

ipcMain.on('open-file', (event, pathFile) =>{
  const result = lerConteudoArquivo(pathFile)
  event.reply('receive-file', result)
})

/** Save file */
ipcMain.on('save-file', (event,data) => {
  console.log('Salvando aquivo: ')
  const filePath = data.path
  const contentFile = data.cod


  fs.writeFile(filePath,contentFile, 'utf-8', (err) => {
    if(err){
      console.log('Erro on save file: ', err)
      return
    }
    console.log('File saved susscees')
  })
  console.log(data)
})

/** Find definition in project */
ipcMain.handle('find-definition-in-project', async (event, { projectPath, symbolName }) => {
  try {
    if (!projectPath || !fs.existsSync(projectPath)) return null
    
    const srcPath = path.join(projectPath, 'src')
    if (!fs.existsSync(srcPath)) return null
    
    // Função recursiva para buscar em arquivos
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
          // 1. Buscar definição de função: tipo nome(params) {
          const funcRegex = new RegExp(`(?:^|\\n)\\s*(?:(?:static|inline|extern|volatile)\\s+)*(?:[\\w*]+\\s+)+${symbolName}\\s*\\([^)]*\\)\\s*\\{`, 'm')
          const funcMatch = funcRegex.exec(content)
          
          if (funcMatch) {
            const linesBefore = content.substring(0, funcMatch.index).split('\n')
            const lineNumber = linesBefore.length
            const columnNumber = linesBefore[linesBefore.length - 1].length + 1
            
            return { path: fullPath, line: lineNumber, column: columnNumber }
          }

          // 2. Buscar #define
          const defineRegex = new RegExp(`^\\s*#define\\s+${symbolName}\\b`, 'm')
          const defineMatch = defineRegex.exec(content)
          if (defineMatch) {
            const linesBefore = content.substring(0, defineMatch.index).split('\n')
            const lineNumber = linesBefore.length
            const col = linesBefore[linesBefore.length - 1].indexOf(symbolName) + 1
            return { path: fullPath, line: lineNumber, column: col }
          }

          // 3. Buscar variável global
          const varRegex = new RegExp(`(?:^|\\n)\\s*(?:(?:static|extern|volatile|const)\\s+)*(?:[a-zA-Z_]\\w*\\*?\\s+)+${symbolName}\\s*(?:[=;|,])`, 'm')
          const varMatch = varRegex.exec(content)
          if (varMatch) {
            const linesBefore = content.substring(0, varMatch.index).split('\n')
            const lineNumber = linesBefore.length
            const col = linesBefore[linesBefore.length - 1].indexOf(symbolName) + 1
            return { path: fullPath, line: lineNumber, column: col }
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

/** Save scene */
ipcMain.on('save-scene', (event, sceneData) => {
  try {
    // Get scene object and project path
    const sceneObj = sceneData.scene || sceneData
    const projectPath = sceneData.projectPath || sceneObj.projectPath || sceneObj.path || __dirname
    const sceneName = sceneObj.name || 'scene'
    const nodes = sceneData.nodes || sceneObj.nodes || []
    
    if (!projectPath || projectPath === __dirname) {
      console.error('No valid project path available for saving scene')
      event.reply('save-scene-result', { success: false, error: 'Caminho do projeto inválido' })
      return
    }

    const scenePath = path.join(projectPath, 'scenes', `${sceneName}.json`)
    const sceneDir = path.dirname(scenePath)
    
    // Create scenes directory if it doesn't exist
    if (!fs.existsSync(sceneDir)) {
      fs.mkdirSync(sceneDir, { recursive: true })
    }

    // Combine data for saving to the scene JSON file
    const dataToSave = {
      ...sceneObj,
      nodes: nodes,
      updatedAt: new Date().toISOString()
    }

    fs.writeFile(scenePath, JSON.stringify(dataToSave, null, 2), 'utf-8', (err) => {
      if (err) {
        console.error('Error saving scene file:', err)
        event.reply('save-scene-result', { success: false, error: err.message })
        return
      }
      
      // Update retro-studio.json to include this scene if not present
      try {
        const config = getProjectConfig(projectPath)
        if (!config.assets) config.assets = []
        const sceneId = `scene_${sceneName}`
        const exists = config.assets.some(a => a.id === sceneId || a.path === path.relative(projectPath, scenePath))
        
        if (!exists) {
          config.assets.push({
            id: sceneId,
            name: sceneName,
            type: 'scene',
            path: path.relative(projectPath, scenePath),
            createdAt: new Date().toISOString()
          })
        }
        
        // Always rewrite config to ensure it's up to date
        fs.writeFileSync(path.join(projectPath, 'retro-studio.json'), JSON.stringify(config, null, 2))
        console.log('[IPC] retro-studio.json atualizado com a cena:', sceneName)
      } catch (cfgErr) {
        console.error('Error updating retro-studio.json with scene:', cfgErr)
      }

      console.log('Scene saved successfully:', scenePath)
      event.reply('save-scene-result', { success: true, path: scenePath })
    })
  } catch (error) {
    console.error('Error in save-scene handler:', error)
    event.reply('save-scene-result', { success: false, error: error.message })
  }
})

/** Load scene */
ipcMain.on('load-scene', (event, scenePath) => {
  try {
    const sceneData = fs.readFileSync(scenePath, 'utf-8')
    const scene = JSON.parse(sceneData)
    scene.path = scenePath
    event.reply('load-scene-result', { success: true, scene })
  } catch (error) {
    console.error('Error loading scene:', error)
    event.reply('load-scene-result', { success: false, error: error.message })
  }
})

/** Select folder dialog */
ipcMain.on('select-folder', (event) => {
  const { dialog } = require('electron')
  dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Project Location'
  }).then(result => {
    if (!result.canceled && result.filePaths.length > 0) {
      event.reply('folder-selected', { path: result.filePaths[0] })
    } else {
      event.reply('folder-selected', { path: null })
    }
  }).catch(err => {
    console.error('Error selecting folder:', err)
    event.reply('folder-selected', { path: null, error: err.message })
  })
})

/** Create new project */
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
    if (!fs.existsSync(scenesDir)) {
      fs.mkdirSync(scenesDir, { recursive: true })
    }

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

/** Export scene to C code */
ipcMain.on('export-scene', (event, sceneData) => {
  try {
    // Get project path from sceneData
    const projectPath = sceneData.projectPath || sceneData.path || __dirname
    if (!projectPath) {
      event.reply('export-scene-result', { success: false, error: 'No project path' })
      return
    }

    // Use provided code or generate basic code
    let code = sceneData.code || `// Auto-generated scene code from Retro Studio\n`
    if (!sceneData.code) {
      code += `// Scene: ${sceneData.name}\n\n`
      code += `#include <genesis.h>\n\n`
      
      // Generate sprite definitions
      if (sceneData.nodes) {
        sceneData.nodes.filter(n => n.type === 'sprite').forEach((node, index) => {
          code += `// Sprite: ${node.name}\n`
          code += `Sprite sprite_${index};\n`
          code += `sprite_${index}.x = ${node.x};\n`
          code += `sprite_${index}.y = ${node.y};\n`
          code += `sprite_${index}.width = ${node.width || 16};\n`
          code += `sprite_${index}.height = ${node.height || 16};\n\n`
        })
      }
    }

    const exportPath = path.join(projectPath, 'src', `scene_${sceneData.name || 'main'}.c`)
    const exportDir = path.dirname(exportPath)
    
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true })
    }

    fs.writeFile(exportPath, code, 'utf-8', (err) => {
      if (err) {
        console.error('Error exporting scene:', err)
        event.reply('export-scene-result', { success: false, error: err.message })
        return
      }
      console.log('Scene exported successfully:', exportPath)
      event.reply('export-scene-result', { success: true, path: exportPath })
    })
  } catch (error) {
    console.error('Error in export-scene:', error)
    event.reply('export-scene-result', { success: false, error: error.message })
  }
})

/** Get available emulators **/
ipcMain.on('get-available-emulators', (event) => {
  try {
    console.log('[IPC] get-available-emulators request received')
    const available = getAvailableEmulators()
    console.log('[IPC] Replying with available emulators:', Object.keys(available))
    event.reply('available-emulators', { 
      success: true, 
      emulators: Object.keys(available),
      paths: available
    })
  } catch (error) {
    console.error('Error getting available emulators:', error)
    event.reply('available-emulators', { success: false, error: error.message })
  }
})

/** Get/Set emulator configuration **/
ipcMain.on('get-emulator-config', (event) => {
  const config = loadConfigFile('emulator-config.json', { selectedEmulator: 'gen_sdl2' });
  event.reply('emulator-config', { success: true, config });
})

ipcMain.on('set-emulator-config', (event, configData) => {
  const success = saveConfigFile('emulator-config.json', configData);
  event.reply('emulator-config-updated', { success });
})

// Get custom emulator paths
ipcMain.on('get-custom-emulator-paths', (event) => {
  const paths = loadConfigFile('custom-emulator-paths.json', { gen_sdl2: '', blastem: '' });
  event.reply('custom-emulator-paths', { success: true, paths });
})

// Set custom emulator paths
ipcMain.on('set-custom-emulator-paths', (event, paths) => {
  const success = saveConfigFile('custom-emulator-paths.json', paths);
  event.reply('custom-emulator-paths', { success, paths });
})

// UI Settings Persistence
ipcMain.on('save-ui-settings', (event, settings) => {
  saveConfigFile('ui-settings.json', settings);
});

ipcMain.handle('get-ui-settings', async () => {
  return loadConfigFile('ui-settings.json', {});
});

// Browse for emulator path
ipcMain.on('browse-emulator-path', async (event, { emulator }) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Select ${emulator === 'blastem' ? 'BlastEm' : 'Genesis SDL2'} Executable`,
      defaultPath: process.env.HOME,
      properties: ['openFile'],
      filters: [
        { name: 'Executable Files', extensions: ['', 'exe', 'bin'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    
    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]
      event.reply('emulator-path-selected', { 
        emulator, 
        path: selectedPath,
        success: true 
      })
    }
  } catch (error) {
    console.error('Error browsing for emulator path:', error)
    event.reply('emulator-path-selected', { 
      emulator, 
      success: false, 
      error: error.message 
    })
  }
})

function comando(cmd){
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`Erro ao executar o comando: ${error}`);
      return;
    }
    console.log(`Saída do comando: ${stdout}`);
  });
}

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
])

// Variável global para o watcher do Help
let helpWatcher = null;

// Configurar Hot Reload para arquivos de Help/Tutoriais
function setupHelpWatcher(win) {
  if (helpWatcher) {
    try {
      helpWatcher.close();
    } catch (e) {
      console.error('[Help] Erro ao fechar watcher anterior:', e);
    }
  }

  // Tentar encontrar o diretório docs
  const candidates = [
    path.join(app.getAppPath(), 'docs'),
    path.join(__dirname, '..', '..', 'docs'),
    path.join(__dirname, '..', 'docs'),
    path.join(process.cwd(), 'docs')
  ];

  let docsDir = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      docsDir = candidate;
      break;
    }
  }

  if (!docsDir) {
    console.warn('[Help] Diretório docs não encontrado para Hot Reload');
    return;
  }

  console.log('[Help] Configurando Hot Reload em:', docsDir);

  // Usar fs.watch para monitorar mudanças
  let timeout;
  try {
    // Linux não suporta { recursive: true } no fs.watch nativo
    const isLinux = process.platform === 'linux';
    helpWatcher = fs.watch(docsDir, { recursive: !isLinux }, (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        // Debounce para evitar múltiplos disparos rápidos (comum no fs.watch)
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (!win.isDestroyed()) {
            console.log(`[Help] Mudança detectada: ${filename}. Recarregando conteúdo...`);
            win.webContents.send('help-content-updated');
          }
        }, 500);
      }
    });
  } catch (err) {
    console.error('[Help] Falha ao iniciar watcher:', err);
  }
}

async function createWindow() {
  const iconPath = path.join(__static, 'icon.png')
  let appIcon = null
  try {
    appIcon = new Tray(iconPath)
  } catch (e) {
    console.warn('Falha ao carregar ícone da bandeja:', e.message)
  }
  const displays = screen.getAllDisplays();
  const targetDisplay = displays[1];
  const { width, height } = targetDisplay.workAreaSize;

  // Create the browser window.
  mainWindow = new BrowserWindow({
    height: 867,
    width: 1500,
    minHeight: 300,
    minWidth: 300,
    x: width / 2,
    y: height / 2,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      enableRemoteModule: false,
      // eslint-disable-next-line no-undef
      preload: path.resolve(__static, 'preload.js'),
      // Use pluginOptions.nodeIntegration, leave this alone
      // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__static, 'icon.png')
  })

  // Iniciar watcher de Help para Hot Reload
  setupHelpWatcher(mainWindow);

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-control-state', { isMaximized: true })
  })

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-control-state', { isMaximized: false })
  })

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    await mainWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
    if (!process.env.IS_TEST) mainWindow.webContents.openDevTools()
  } else {
    createProtocol('app')
    // Load the index.html when not in development
    mainWindow.loadURL('app://./index.html')
  }
}

// Registrar um esquema de protocolo personalizado para carregar arquivos locais
app.whenReady().then(() => {
  protocol.registerFileProtocol('custom', (request, callback) => {
    const url = request.url.replace('custom://', '');
    // const filePath = path.join(__dirname, 'res', url);

    console.log('>>url  ', url)
    // console.log('>> ', url)
    callback({ path: url });
  });
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  if (isDevelopment && !process.env.IS_TEST) {
    // Install Vue Devtools
    try {
      await installExtension(VUEJS3_DEVTOOLS)
    } catch (e) {
      console.error('Vue Devtools failed to install:', e.toString())
    }
  }

  // Registrar protocolo customizado para carregar assets do sistema de arquivos
  protocol.registerFileProtocol('app', (request, callback) => {
    let url = request.url.replace('app://./', '')
    url = url.replace('app://', '') // Remover protocolo se vier de outra forma
    const decodedUrl = decodeURIComponent(url)
    
    try {
      // Tentar resolver no diretório do bundle (dist_electron/bundled)
      let filePath = path.join(__dirname, decodedUrl)
      if (fs.existsSync(filePath)) {
        return callback({ path: filePath })
      }

      // Tentar resolver na raiz do ASAR (para assets do frontend como fontes)
      filePath = path.join(__dirname, '..', decodedUrl)
      if (fs.existsSync(filePath)) {
        return callback({ path: filePath })
      }

      // Tentar resolver caminhos absolutos (para o CSS/JS que referenciam fontes)
      const baseName = path.basename(decodedUrl)
      filePath = path.join(__dirname, baseName)
      if (fs.existsSync(filePath)) {
        return callback({ path: filePath })
      }

      // NOVO: Resolver fonts que ficam em css/fonts no build do Vue
      if (decodedUrl.includes('fonts/')) {
        const fontPath = path.join(__dirname, 'fonts', baseName)
        if (fs.existsSync(fontPath)) {
          return callback({ path: fontPath })
        }
      }

      // Fallback para diretório de recursos (onde o extraResources joga os arquivos)
      const resourcesPath = process.resourcesPath
      filePath = path.join(resourcesPath, decodedUrl)
      if (fs.existsSync(filePath)) {
        return callback({ path: filePath })
      }

      console.warn('[Protocol] File not found:', decodedUrl)
      callback({ error: -6 }) // net::ERR_FILE_NOT_FOUND
    } catch (error) {
      console.error('Protocol error:', error)
      callback({ error: -2 })
    }
  })

  createWindow()
})

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}

function getResourcePath(projectPath) {
  const config = getProjectConfig(projectPath)
  return path.join(projectPath, config.resourcePath || 'res')
}

/** Detectar tipo de asset pela extensão do arquivo */
function detectAssetType(filename) {
  const ext = path.extname(filename).toLowerCase()
  
  // Paletas
  if (['.pal', '.act'].includes(ext)) return 'palette'
  
  // Sons
  if (['.wav', '.mp3', '.ogg', '.vgm', '.vgz'].includes(ext)) return 'sound'
  
  // Tilemaps (JSON e arquivo .res)
  if (['.json', '.res'].includes(ext)) return 'tilemap'
  
  // Imagens genéricas - retornar null para o usuário escolher
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) return null
  
  // Padrão
  return null
}

/** Escanear pasta de recursos e detectar assets (recursivamente) */
function scanResourcesFolder(projectPath) {
  try {
    const resDir = getResourcePath(projectPath)
    const config = getProjectConfig(projectPath)
    
    if (!fs.existsSync(resDir)) {
      return {
        success: true,
        newAssets: [],
        unidentifiedAssets: []
      }
    }
    
    // Obter lista de arquivos na pasta (recursivamente)
    const getAllFiles = (dir) => {
      const files = []
      const entries = fs.readdirSync(dir)
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry)
        try {
          const stats = fs.statSync(fullPath)
          if (stats.isFile()) {
            files.push(fullPath)
          } else if (stats.isDirectory()) {
            // Escanear subdiretório recursivamente
            files.push(...getAllFiles(fullPath))
          }
        } catch (e) {
          console.warn('[IPC] Erro ao acessar:', fullPath, e.message)
        }
      }
      
      return files
    }
    
    const allFiles = getAllFiles(resDir)
    
    // Filtrar arquivos já indexados (comparar por caminho relativo)
    const existingPaths = (config.assets || []).map(a => a.path)
    const newFiles = allFiles.filter(f => {
      const relPath = path.relative(projectPath, f)
      return !existingPaths.includes(relPath)
    })
    
    // Separar assets identificáveis dos que precisam de escolha
    const newAssets = []
    const unidentifiedAssets = []
    
    for (const fullPath of newFiles) {
      const filename = path.basename(fullPath)
      const stats = fs.statSync(fullPath)
      const detectedType = detectAssetType(filename)
      
      const assetInfo = {
        name: filename,
        size: stats.size,
        path: path.relative(projectPath, fullPath),
        createdAt: (stats.birthtime && stats.birthtime.toISOString()) || new Date().toISOString(),
        updatedAt: (stats.mtime && stats.mtime.toISOString()) || new Date().toISOString()
      }
      
      if (detectedType) {
        // Assets identificados automaticamente
        newAssets.push({
          ...assetInfo,
          type: detectedType,
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          metadata: detectedType === 'palette' ? {} : {}
        })
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(path.extname(filename).toLowerCase())) {
        // Imagens que precisam de identificação
        unidentifiedAssets.push(assetInfo)
      }
    }
    
    console.log(`[IPC] Escaneo de recursos: ${newAssets.length} identificados, ${unidentifiedAssets.length} aguardando classificação`)
    
    return {
      success: true,
      newAssets,
      unidentifiedAssets
    }
  } catch (error) {
    console.error('[IPC] Erro ao escanear recursos:', error)
    return {
      success: false,
      error: error.message,
      newAssets: [],
      unidentifiedAssets: []
    }
  }
}

/** Handler IPC: Escanear recursos e detectar novos assets */
ipcMain.on('scan-resources', (event, projectPath) => {
  try {
    const result = scanResourcesFolder(projectPath)
    event.reply('scan-resources-result', result)
  } catch (error) {
    console.error('[IPC] Erro no handler scan-resources:', error)
    event.reply('scan-resources-result', {
      success: false,
      error: error.message,
      newAssets: [],
      unidentifiedAssets: []
    })
  }
})

/** Handler IPC: Adicionar assets detectados à config */
ipcMain.on('add-detected-assets', (event, { projectPath, assets }) => {
  try {
    const config = getProjectConfig(projectPath)
    
    if (!config.assets) {
      config.assets = []
    }
    
    // Adicionar apenas assets que ainda não existem
    for (const asset of assets) {
      const exists = config.assets.some(a => a.name === asset.name)
      if (!exists) {
        config.assets.push(asset)
      }
    }
    
    // Salvar config atualizada
    const configPath = path.join(projectPath, 'retro-studio.json')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    
    console.log(`[IPC] ${assets.length} asset(s) adicionado(s) à config`)
    event.reply('add-detected-assets-result', { success: true, config })
  } catch (error) {
    console.error('[IPC] Erro ao adicionar assets detectados:', error)
    event.reply('add-detected-assets-result', { success: false, error: error.message })
  }
})

/** Copy asset file to project res/ folder */
ipcMain.on('copy-asset-to-project', (event, data) => {
  try {
    const { projectPath, filename, buffer } = data
    
    // Validar caminho do projeto
    const resDir = getResourcePath(projectPath)
    if (!fs.existsSync(resDir)) {
      fs.mkdirSync(resDir, { recursive: true })
    }
    
    // Salvar arquivo
    const assetPath = path.join(resDir, filename)
    fs.writeFileSync(assetPath, Buffer.from(buffer))
    
    console.log('[IPC] Asset copiado para:', assetPath)
    
    // Retornar o caminho relativo à pasta do projeto
    const relativePath = path.relative(projectPath, assetPath)
    
    event.reply('copy-asset-result', {
      success: true,
      assetPath: relativePath
    })
  } catch (error) {
    console.error('[IPC] Erro ao copiar asset:', error)
    event.reply('copy-asset-result', {
      success: false,
      error: error.message
    })
  }
})

/** Register asset in resources.res */
ipcMain.on('register-asset-resource', (event, data) => {
  try {
    const { projectPath, resourceEntry, assetName } = data
    const resDir = getResourcePath(projectPath)
    const resourcesPath = path.join(resDir, 'resources.res')
    
    // Criar arquivo se não existir
    if (!fs.existsSync(resourcesPath)) {
      if (!fs.existsSync(resDir)) {
        fs.mkdirSync(resDir, { recursive: true })
      }
      fs.writeFileSync(resourcesPath, '')
    }
    
    // Ler conteúdo atual
    let content = fs.readFileSync(resourcesPath, 'utf-8')
    const lines = content.split('\n')
    
    // Extrair o nome do recurso da nova entrada (ex: IMAGE SONIC "sonic.png" 0 -> SONIC)
    const newParts = resourceEntry.split(/\s+/)
    const newResName = newParts[1]
    
    let entryUpdated = false
    const newLines = lines.map(line => {
      const trimmed = line.trim()
      if (!trimmed) return line
      
      const parts = trimmed.split(/\s+/)
      // Se o nome do recurso (segunda coluna) for o mesmo, substituir a linha inteira
      if (parts.length >= 2 && parts[1] === newResName) {
        entryUpdated = true
        return resourceEntry
      }
      return line
    })

    if (entryUpdated) {
      fs.writeFileSync(resourcesPath, newLines.join('\n'))
      console.log('[IPC] Recurso atualizado em resources.res:', newResName)
    } else {
      // Adicionar nova entrada se não existir
      if (content && !content.endsWith('\n')) {
        content += '\n'
      }
      content += resourceEntry + '\n'
      fs.writeFileSync(resourcesPath, content)
      console.log('[IPC] Novo recurso adicionado em resources.res:', newResName)
    }
    
    console.log('[IPC] Asset registrado em resources.res:', assetName)
    event.reply('register-asset-result', {
      success: true,
      message: `Asset "${assetName}" registrado com sucesso`
    })
  } catch (error) {
    console.error('[IPC] Erro ao registrar asset:', error)
    event.reply('register-asset-result', {
      success: false,
      error: error.message
    })
  }
})

/** Get files list from resources folder (recursive) */
ipcMain.on('get-res-files', (event, projectPath) => {
  try {
    const resDir = getResourcePath(projectPath)
    console.log('[IPC] get-res-files (recursive) para:', resDir)
    
    if (!fs.existsSync(resDir)) {
      event.reply('get-res-files-result', {
        success: true,
        files: []
      })
      return
    }
    
    // Listar recursivamente
    const getAllFiles = (dir) => {
      let files = []
      if (!fs.existsSync(dir)) return []
      
      const entries = fs.readdirSync(dir)
      for (const entry of entries) {
        const fullPath = path.join(dir, entry)
        const stats = fs.statSync(fullPath)
        if (stats.isFile()) {
          // Retornar caminho relativo à RAIZ DO PROJETO
          const relPath = path.relative(projectPath, fullPath)
          files.push(relPath)
        } else if (stats.isDirectory()) {
          files.push(...getAllFiles(fullPath))
        }
      }
      return files
    }
    
    const files = getAllFiles(resDir)
    console.log('[IPC] Arquivos encontrados (recursive):', files.length)
    
    event.reply('get-res-files-result', {
      success: true,
      files: files
    })
  } catch (error) {
    console.error('[IPC] Erro ao obter arquivos recursivos:', error)
    event.reply('get-res-files-result', {
      success: false,
      error: error.message
    })
  }
})

/** Get palette colors from file */
ipcMain.on('get-palette-colors', (event, data) => {
  try {
    const { projectPath, assetPath } = data
    const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath)
    
    if (!fs.existsSync(fullPath)) {
      throw new Error('Arquivo de paleta não encontrado')
    }
    
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
    
    event.reply('get-palette-colors-result', {
      success: true,
      colors: colors,
      assetPath: assetPath
    })
  } catch (error) {
    console.error('[IPC] Erro ao extrair cores:', error)
    event.reply('get-palette-colors-result', {
      success: false,
      error: error.message
    })
  }
})

/** Get asset preview (base64) - ASYNC version for invoke */
ipcMain.handle('get-asset-preview', async (event, data) => {
  try {
    const { projectPath, assetPath } = data
    const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath)
    
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: 'Arquivo não encontrado' }
    }
    
    const ext = path.extname(fullPath).toLowerCase()
    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) {
      const buffer = fs.readFileSync(fullPath)
      const base64 = buffer.toString('base64')
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
      return {
        success: true,
        assetPath: assetPath,
        preview: `data:${mime};base64,${base64}`
      }
    }
    return { success: false, error: 'Tipo não suportado' }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

/** Get palette colors - ASYNC version */
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

/** Get asset preview (base64) */
ipcMain.on('get-asset-preview', (event, data) => {
  try {
    const { projectPath, assetPath } = data
    // O assetPath já deve vir relativo à raiz do projeto (ex: "res/arquivos/amy.png")
    const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(projectPath, assetPath)
    
    if (!fs.existsSync(fullPath)) {
      console.error(`[IPC] Preview - Arquivo não encontrado: ${fullPath}`)
      throw new Error('Arquivo não encontrado')
    }
    
    const ext = path.extname(fullPath).toLowerCase()
    
    // Se for imagem
    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) {
      const buffer = fs.readFileSync(fullPath)
      const base64 = buffer.toString('base64')
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
      
      event.reply('get-asset-preview-result', {
        success: true,
        assetPath: assetPath, // Incluir o caminho para identificação
        preview: `data:${mime};base64,${base64}`
      })
    } else {
      event.reply('get-asset-preview-result', {
        success: false,
        assetPath: assetPath,
        error: 'Tipo de arquivo não suportado para preview direto'
      })
    }
  } catch (error) {
    console.error('[IPC] Erro ao obter preview:', error)
    event.reply('get-asset-preview-result', {
      success: false,
      assetPath: data.assetPath,
      error: error.message
    })
  }
})

/** Rename asset file in resources folder */
ipcMain.on('rename-asset-file', (event, data) => {
  try {
    const { projectPath, oldFileName, newName, assetType, oldPath } = data
    console.log('[IPC] ✅ COMANDO RECEBIDO - rename-asset-file:', { oldFileName, newName, oldPath })
    
    // Construir caminhos absolutos
    const resDir = getResourcePath(projectPath)
    
    // Tentar localizar o arquivo original
    let realOldFilePath = null
    
    if (oldPath) {
      realOldFilePath = path.join(projectPath, oldPath)
    } else {
      realOldFilePath = path.join(resDir, oldFileName)
    }
    
    if (!fs.existsSync(realOldFilePath)) {
      // Tentar busca recursiva como fallback
      console.log(`[IPC] ⚠️ Arquivo não encontrado no caminho direto: ${realOldFilePath}. Buscando recursivamente...`)
      
      const getAllFiles = (dir) => {
        const files = []
        const entries = fs.readdirSync(dir)
        for (const entry of entries) {
          const fullPath = path.join(dir, entry)
          const stats = fs.statSync(fullPath)
          if (stats.isFile()) {
            if (path.basename(fullPath) === oldFileName) files.push(fullPath)
          } else if (stats.isDirectory()) {
            files.push(...getAllFiles(fullPath))
          }
        }
        return files
      }
      
      const foundFiles = getAllFiles(resDir)
      if (foundFiles.length > 0) {
        realOldFilePath = foundFiles[0]
        console.log(`[IPC] ✅ Arquivo encontrado recursivamente em: ${realOldFilePath}`)
      }
    }
    
    // Verificar se arquivo antigo existe
    if (!realOldFilePath || !fs.existsSync(realOldFilePath)) {
      console.log('[IPC] ❌ Arquivo não encontrado após todas as tentativas:', oldFileName)
      event.reply('rename-asset-result', {
        success: false,
        error: `Arquivo "${oldFileName}" não encontrado.`
      })
      return
    }
    
    // Extrair extensão do arquivo real
    const realOldFileName = path.basename(realOldFilePath)
    const extension = path.extname(realOldFileName)
    const newFileName = newName.includes('.') ? newName : (newName + extension)
    const newFilePath = path.join(path.dirname(realOldFilePath), newFileName)
    
    // Verificar se novo nome já existe
    if (fs.existsSync(newFilePath)) {
      event.reply('rename-asset-result', {
        success: false,
        error: 'Já existe um arquivo com este nome'
      })
      return
    }
    
    // Renomear arquivo
    fs.renameSync(realOldFilePath, newFilePath)
    
    // --- Atualizar arquivos .res ---
    // Procurar por TODOS os arquivos .res na pasta de recursos
    const getAllResFiles = (dir) => {
      let results = []
      const list = fs.readdirSync(dir)
      list.forEach(file => {
        file = path.join(dir, file)
        const stat = fs.statSync(file)
        if (stat && stat.isDirectory()) {
          results = results.concat(getAllResFiles(file))
        } else if (file.endsWith('.res')) {
          results.push(file)
        }
      })
      return results
    }

    const resFiles = getAllResFiles(resDir)
    console.log(`[IPC] Verificando ${resFiles.length} arquivo(s) .res para atualizar referências...`)

    resFiles.forEach(resPath => {
      try {
        let content = fs.readFileSync(resPath, 'utf-8')
        const resDirOfFile = path.dirname(resPath)
        
        // Calcular caminhos relativos ao arquivo .res para encontrar a entrada exata
        const oldRelToRes = path.relative(resDirOfFile, realOldFilePath)
        const newRelToRes = path.relative(resDirOfFile, newFilePath)
        
        // Identificadores (nomes em maiúsculo no .res)
        const oldBaseName = path.basename(realOldFilePath, path.extname(realOldFilePath))
        const newBaseName = path.basename(newFilePath, path.extname(newFilePath))
        const oldResourceID = oldBaseName.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
        const newResourceID = newBaseName.toUpperCase().replace(/[^A-Z0-9_]/g, '_')

        // 1. Substituir o Identificador (ex: SONICA -> SONICA2)
        // Regex: Tipo (SPRITE, IMAGE, etc) + ID Antigo
        const idRegex = new RegExp(`(\\b[A-Z0-9_]+\\s+)${oldResourceID}(\\b)`, 'g')
        const newContent = content.replace(idRegex, `$1${newResourceID}$2`)
        
        // 2. Substituir o Caminho do Arquivo (ex: "arquivos/sonica.png" -> "arquivos/sonica2.png")
        // Escapar caracteres especiais do caminho para regex
        const escapedOldPath = oldRelToRes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pathRegex = new RegExp(`"${escapedOldPath}"`, 'g')
        
        const finalContent = newContent.replace(pathRegex, `"${newRelToRes}"`)

        if (content !== finalContent) {
          fs.writeFileSync(resPath, finalContent)
          console.log(`[IPC] ✅ Arquivo .res atualizado: ${path.basename(resPath)}`)
        }
      } catch (err) {
        console.error(`[IPC] Erro ao processar arquivo .res ${resPath}:`, err)
      }
    })
    
    console.log('[IPC] ✅ RESPOSTA ENVIADA - Asset renomeado:', oldFileName, '->', newFileName)
    const relativePath = path.relative(projectPath, newFilePath)
    
    event.reply('rename-asset-result', {
      success: true,
      newPath: relativePath,
      message: `Asset renomeado com sucesso`
    })
  } catch (error) {
    console.error('[IPC] ❌ ERRO NA RENOMEAÇÃO:', error.message)
    event.reply('rename-asset-result', {
      success: false,
      error: error.message
    })
  }
})

ipcMain.on('window-control', (_event, action) => {
  if (!mainWindow) return

  switch (action) {
    case 'minimize':
      mainWindow.minimize()
      break
    case 'toggle-maximize':
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
      break
    case 'close':
      mainWindow.close()
      break
    default:
      break
  }
})

// Abrir URLs externas no navegador padrão do SO
ipcMain.on('open-external-url', (event, args) => {
  const { url } = args || {}
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url).catch(err => {
      console.error('[Help] Erro ao abrir URL:', url, err)
    })
  }
})

// Carregar arquivo Markdown individual para visualização no Help
ipcMain.on('load-markdown-file', (event, args) => {
  try {
    const { filePath } = args || {}
    
    if (!filePath) {
      event.reply('load-markdown-file-result', { success: false, error: 'Caminho do arquivo não fornecido' })
      return
    }
    
    // Normalizar o caminho para ser relativo ao diretório de docs
    let resolvedPath = filePath
    
    // Se começa com ./, remover e procurar a partir do docs
    if (filePath.startsWith('./')) {
      resolvedPath = filePath.substring(2)
    }
    
    // Candidatos de caminho para procurar
    const candidates = [
      path.join(process.cwd(), 'docs', 'content', 'SGDK.wiki', resolvedPath),
      path.join(process.cwd(), 'docs', 'tutorials', resolvedPath),
      path.join(__dirname, '..', 'docs', 'content', 'SGDK.wiki', resolvedPath),
      path.join(__dirname, '..', 'docs', 'tutorials', resolvedPath),
      path.join(process.cwd(), resolvedPath),
      filePath // Tentar o caminho como dado
    ]
    
    let resolvedFile = null
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        resolvedFile = candidate
        break
      }
    }
    
    if (!resolvedFile) {
      console.warn('[Help] Arquivo não encontrado nos candidatos:', candidates)
      event.reply('load-markdown-file-result', { 
        success: false, 
        error: `Arquivo não encontrado: ${filePath}` 
      })
      return
    }
    
    // Ler o arquivo
    const content = fs.readFileSync(resolvedFile, 'utf-8')
    
    // Extrair metadados do frontmatter
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
    
    console.log('[Help] Arquivo Markdown carregado:', resolvedFile)
    event.reply('load-markdown-file-result', {
      success: true,
      content: markdownContent,
      title: title
    })
  } catch (error) {
    console.error('[Help] Erro ao carregar arquivo Markdown:', error)
    event.reply('load-markdown-file-result', { success: false, error: error.message })
  }
})

// Carregar conteúdo (tópicos) em Markdown com suporte a subpastas (Menus/Submenus)
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

    // Função recursiva para montar a árvore
    const buildTree = (basePath, relativePath = '') => {
      const fullPath = path.join(basePath, relativePath)
      const items = fs.readdirSync(fullPath)
      const nodes = []

      for (const item of items) {
        const itemRelativePath = path.join(relativePath, item)
        const itemFullPath = path.join(basePath, itemRelativePath)
        const stats = fs.statSync(itemFullPath)

        if (stats.isDirectory()) {
          // É uma pasta -> Criar um nó de menu
          const children = buildTree(basePath, itemRelativePath)
          if (children.length > 0) {
            // Tentar ler um arquivo index.md na pasta para descrição do menu
            let content = ''
            let title = item.replace(/^\d+-/, '').replace(/-/g, ' ')
            let icon = 'fas fa-folder'

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
              } else {
                content = indexContent
              }
            }

            nodes.push({
              id: `dir_${itemRelativePath.replace(/[\/\\]/g, '_')}`,
              title: title,
              icon: icon,
              content: content,
              children: children.sort((a, b) => a.id.localeCompare(b.id))
            })
          }
        } else if (item.endsWith('.md') && item !== 'index.md') {
          // É um arquivo Markdown -> Criar um tópico
          const content = fs.readFileSync(itemFullPath, 'utf-8')
          const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/
          const match = content.match(frontmatterRegex)
          
          let metadata = {
            title: item.replace('.md', '').replace(/^\d+-/, '').replace(/-/g, ' '),
            icon: 'far fa-file-alt'
          }
          
          let markdownContent = content
          if (match) {
            const fm = match[1]
            const titleMatch = fm.match(/title:\s*(.+)/i)
            if (titleMatch) metadata.title = titleMatch[1].trim()
            const iconMatch = fm.match(/icon:\s*(.+)/i)
            if (iconMatch) metadata.icon = iconMatch[1].trim()
            markdownContent = content.replace(frontmatterRegex, '')
          }

          nodes.push({
            id: `topic_${itemRelativePath.replace(/[\/\\]/g, '_')}`,
            title: metadata.title,
            icon: metadata.icon,
            content: markdownContent,
            children: []
          })
        }
      }
      return nodes.sort((a, b) => a.id.localeCompare(b.id))
    }

    const topics = buildTree(contentDir)
    console.log(`[Content] Árvore de tópicos carregada: ${topics.length} menus raiz`)
    
    event.reply('load-content-topics-result', {
      success: true,
      topics
    })
  } catch (error) {
    console.error('[Content] Erro ao carregar:', error)
    event.reply('load-content-topics-result', { success: false, error: error.message })
  }
})

ipcMain.on('load-tutorials', async (event, args) => {
  try {
    const { dirPath } = args || {}
    
    // Se não foi passado path, usar o padrão: docs/tutorials/
    // Tentar vários caminhos possíveis
    let tutorialsDir = dirPath
    
    if (!tutorialsDir) {
      // Tentar caminhos em ordem de probabilidade
      const candidates = [
        path.join(app.getAppPath(), 'docs', 'tutorials'),
        path.join(__dirname, '..', '..', 'docs', 'tutorials'),
        path.join(__dirname, '..', 'docs', 'tutorials'),
        path.join(process.cwd(), 'docs', 'tutorials')
      ]
      
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          tutorialsDir = candidate
          console.log('[Tutorials] Diretório encontrado em:', tutorialsDir)
          break
        }
      }
      
      if (!tutorialsDir) {
        console.log('[Tutorials] Nenhum diretório encontrado. Candidatos testados:')
        candidates.forEach(c => console.log('  -', c))
        event.reply('load-tutorials-result', {
          success: true,
          tutorials: []
        })
        return
      }
    }
    
    if (!fs.existsSync(tutorialsDir)) {
      console.log('[Tutorials] Diretório não encontrado:', tutorialsDir)
      event.reply('load-tutorials-result', {
        success: true,
        tutorials: []
      })
      return
    }
    
    const files = fs.readdirSync(tutorialsDir).filter(f => f.endsWith('.md'))
    console.log(`[Tutorials] Encontrados ${files.length} arquivos .md em ${tutorialsDir}`)
    
    const tutorials = []
    
    for (const file of files) {
      const filePath = path.join(tutorialsDir, file)
      console.log(`[Tutorials] Processando: ${file}`)
      
      const content = fs.readFileSync(filePath, 'utf-8')
      
      // Extrair metadados do frontmatter
      const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/
      const match = content.match(frontmatterRegex)
      
      let metadata = {
        title: file.replace('.md', ''),
        description: '',
        tags: []
      }
      
      let markdownContent = content
      
      if (match) {
        const fm = match[1]
        
        // Extrair title
        const titleMatch = fm.match(/title:\s*(.+)/i)
        if (titleMatch) metadata.title = titleMatch[1].trim()
        
        // Extrair description
        const descMatch = fm.match(/description:\s*(.+)/i)
        if (descMatch) metadata.description = descMatch[1].trim()
        
        // Extrair tags
        const tagsMatch = fm.match(/tags:\s*\[([^\]]+)\]/i)
        if (tagsMatch) {
          metadata.tags = tagsMatch[1]
            .split(',')
            .map(t => t.trim().replace(/["']/g, ''))
            .filter(t => t)
        }
        
        // Remover frontmatter do conteúdo
        markdownContent = content.replace(frontmatterRegex, '')
      }
      
      tutorials.push({
        id: `tutorial_${file.replace('.md', '')}`,
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        content: markdownContent
      })
    }
    
    console.log(`[Tutorials] Total carregados: ${tutorials.length} tutoriais`)
    event.reply('load-tutorials-result', {
      success: true,
      tutorials
    })
  } catch (error) {
    console.error('[Tutorials] Erro ao carregar:', error)
    event.reply('load-tutorials-result', {
      success: false,
      error: error.message
    })
  }
})
