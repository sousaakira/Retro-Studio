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

  if (appPath) {
    candidates.push(path.join(appPath, 'toolkit', 'examples', templateDir))
    candidates.push(path.join(appPath, 'src', 'toolkit', 'examples', templateDir))
    candidates.push(path.join(appPath, '..', 'src', 'toolkit', 'examples', templateDir))
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
  const emulatorKey = emulatorName || 'gen_sdl2'
  const relativePath = AVAILABLE_EMULATORS[emulatorKey] || AVAILABLE_EMULATORS['gen_sdl2']

  const candidateBuilders = [
    () => appPath && path.join(appPath, ...relativePath),
    () => appPath && path.join(appPath, 'src', ...relativePath),
    () => path.join(__dirname, ...relativePath),
    () => path.join(projectRoot, 'src', ...relativePath),
    () => path.join(projectRoot, ...relativePath),
    () => path.join(process.cwd(), ...relativePath),
    () => path.join(process.cwd(), 'src', ...relativePath),
    // Adicionar caminho absoluto como fallback
    () => emulatorKey === 'blastem' && '/home/akira/Documents/Desenvolvimentos/AkiraProjects/retro-studio/src/toolkit/emulators/blastem/blastem',
    () => emulatorKey === 'gen_sdl2' && '/home/akira/Documents/Desenvolvimentos/AkiraProjects/retro-studio/src/toolkit/emulators/md/gen_sdl2'
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

ipcMain.on('req-projec', (event, result) => { 
  const estrutura = lerDiretorio(result.path); 
  event.reply('read-files', estrutura);
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
let currentEmulatorConfig = { selectedEmulator: 'gen_sdl2' }

ipcMain.on('run-game', (event, result) =>{

  console.log('run game', result)
  const projectPath = result.path
  const toolkitPath = result.toolkitPath
  
  // Carregar configuração de emulador salva
  let selectedEmulatorName = 'gen_sdl2'
  try {
    const configPath = path.join(app.getPath('userData'), 'emulator-config.json')
    if (fs.existsSync(configPath)) {
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      selectedEmulatorName = configData.selectedEmulator || 'gen_sdl2'
      console.log(`[DEBUG] Loaded emulator config: ${selectedEmulatorName}`)
    }
  } catch (error) {
    console.warn('Erro ao carregar configuração de emulador:', error)
  }

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

  exec(`cd "${projectPath}" && ${buildCommand}`, (error, stdout, stderr) => {
    // Parse compilation errors/warnings from stderr and stdout
    const compilationOutput = stdout + '\n' + stderr
    const errors = parseCompilationOutput(compilationOutput)
    
    if (errors.length > 0) {
      console.log(`[Compilation] Found ${errors.length} issues`)
      event.reply('compilation-errors', { errors, output: compilationOutput })
    }
    
    if (error) {
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

/** Save scene */
ipcMain.on('save-scene', (event, sceneData) => {
  try {
    // Get project path from sceneData or use a default
    const projectPath = sceneData.projectPath || sceneData.path || __dirname
    if (!projectPath) {
      console.error('No project path available')
      event.reply('save-scene-result', { success: false, error: 'No project path' })
      return
    }

    const scenePath = path.join(projectPath, 'scenes', `${sceneData.name || 'scene'}.json`)
    const sceneDir = path.dirname(scenePath)
    
    // Create scenes directory if it doesn't exist
    if (!fs.existsSync(sceneDir)) {
      fs.mkdirSync(sceneDir, { recursive: true })
    }

    fs.writeFile(scenePath, JSON.stringify(sceneData, null, 2), 'utf-8', (err) => {
      if (err) {
        console.error('Error saving scene:', err)
        event.reply('save-scene-result', { success: false, error: err.message })
        return
      }
      console.log('Scene saved successfully:', scenePath)
      event.reply('save-scene-result', { success: true, path: scenePath })
    })
  } catch (error) {
    console.error('Error in save-scene:', error)
    event.reply('save-scene-result', { success: false, error: error.message })
  }
})

/** Load scene */
ipcMain.on('load-scene', (event, scenePath) => {
  try {
    const sceneData = fs.readFileSync(scenePath, 'utf-8')
    const scene = JSON.parse(sceneData)
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
      createdAt: new Date().toISOString()
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
  try {
    const configPath = path.join(app.getPath('userData'), 'emulator-config.json')
    let config = { selectedEmulator: 'gen_sdl2' }
    
    if (fs.existsSync(configPath)) {
      const fileData = fs.readFileSync(configPath, 'utf-8')
      config = { ...config, ...JSON.parse(fileData) }
    }
    
    event.reply('emulator-config', { success: true, config })
  } catch (error) {
    console.error('Error getting emulator config:', error)
    event.reply('emulator-config', { success: false, config: { selectedEmulator: 'gen_sdl2' } })
  }
})

ipcMain.on('set-emulator-config', (event, configData) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'emulator-config.json')
    const configDir = path.dirname(configPath)
    
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }
    
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2))
    event.reply('emulator-config-updated', { success: true })
  } catch (error) {
    console.error('Error setting emulator config:', error)
    event.reply('emulator-config-updated', { success: false, error: error.message })
  }
})

// Get custom emulator paths
ipcMain.on('get-custom-emulator-paths', (event) => {
  try {
    const customPathsFile = path.join(app.getPath('userData'), 'custom-emulator-paths.json')
    let paths = { gen_sdl2: '', blastem: '' }
    
    if (fs.existsSync(customPathsFile)) {
      const fileData = fs.readFileSync(customPathsFile, 'utf-8')
      paths = { ...paths, ...JSON.parse(fileData) }
    }
    
    event.reply('custom-emulator-paths', { success: true, paths })
  } catch (error) {
    console.error('Error getting custom emulator paths:', error)
    event.reply('custom-emulator-paths', { success: false, paths: { gen_sdl2: '', blastem: '' } })
  }
})

// Set custom emulator paths
ipcMain.on('set-custom-emulator-paths', (event, paths) => {
  try {
    const customPathsFile = path.join(app.getPath('userData'), 'custom-emulator-paths.json')
    const customPathsDir = path.dirname(customPathsFile)
    
    if (!fs.existsSync(customPathsDir)) {
      fs.mkdirSync(customPathsDir, { recursive: true })
    }
    
    fs.writeFileSync(customPathsFile, JSON.stringify(paths, null, 2))
    event.reply('custom-emulator-paths', { success: true, paths })
  } catch (error) {
    console.error('Error setting custom emulator paths:', error)
    event.reply('custom-emulator-paths', { success: false, error: error.message })
  }
})

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

async function createWindow() {
  console.log('>>>>>>>>>>>> ','/mnt/45e9f903-a60c-4c5f-ae44-1c5f0b951ffb/Document/Desenvolvimentos/AkiraProjects/retro-studio/src/assets/pacman.png')
  const appIcon = new Tray('./src/assets/pacman.png')
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
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
      contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION
    },
    icon: './src/assets/pacman.png'
  })

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

/** Copy asset file to project res/ folder */
ipcMain.on('copy-asset-to-project', (event, data) => {
  try {
    const { projectPath, filename, buffer } = data
    
    // Validar caminho do projeto
    const resDir = path.join(projectPath, 'res')
    if (!fs.existsSync(resDir)) {
      fs.mkdirSync(resDir, { recursive: true })
    }
    
    // Salvar arquivo
    const assetPath = path.join(resDir, filename)
    fs.writeFileSync(assetPath, Buffer.from(buffer))
    
    console.log('[IPC] Asset copiado para:', assetPath)
    event.reply('copy-asset-result', {
      success: true,
      assetPath: path.join('res', filename)
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
    const resourcesPath = path.join(projectPath, 'res', 'resources.res')
    
    // Criar arquivo se não existir
    if (!fs.existsSync(resourcesPath)) {
      fs.writeFileSync(resourcesPath, '')
    }
    
    // Ler conteúdo atual
    let content = fs.readFileSync(resourcesPath, 'utf-8')
    
    // Verificar se asset já está registrado
    if (!content.includes(assetName)) {
      // Adicionar nova entrada
      if (content && !content.endsWith('\n')) {
        content += '\n'
      }
      content += resourceEntry + '\n'
      fs.writeFileSync(resourcesPath, content)
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

/** Get files list from res/ folder */
ipcMain.on('get-res-files', (event, projectPath) => {
  try {
    const resDir = path.join(projectPath, 'res')
    console.log('[IPC] get-res-files para:', resDir)
    
    if (!fs.existsSync(resDir)) {
      event.reply('get-res-files-result', {
        success: true,
        files: []
      })
      return
    }
    
    // Listar todos os itens da pasta res
    const allEntries = fs.readdirSync(resDir)
    
    // Filtrar apenas arquivos (não diretórios)
    const files = allEntries.filter(entry => {
      const fullPath = path.join(resDir, entry)
      try {
        return fs.statSync(fullPath).isFile()
      } catch (e) {
        return false
      }
    })
    
    console.log('[IPC] Arquivos encontrados em res/:', files)
    event.reply('get-res-files-result', {
      success: true,
      files: files
    })
  } catch (error) {
    console.error('[IPC] Erro ao obter arquivos:', error)
    event.reply('get-res-files-result', {
      success: false,
      error: error.message
    })
  }
})

/** Rename asset file in res/ folder */
ipcMain.on('rename-asset-file', (event, data) => {
  try {
    const { projectPath, oldFileName, newName, assetType } = data
    console.log('[IPC] ✅ COMANDO RECEBIDO - rename-asset-file:', { oldFileName, newName })
    
    // Construir caminhos absolutos
    const resDir = path.join(projectPath, 'res')
    
    if (!fs.existsSync(resDir)) {
      throw new Error(`Pasta res não encontrada: ${resDir}`)
    }
    
    // Listar TODOS os arquivos da pasta res
    const allEntries = fs.readdirSync(resDir)
    
    // Filtrar apenas arquivos (não diretórios)
    const files = allEntries.filter(entry => {
      const fullPath = path.join(resDir, entry)
      return fs.statSync(fullPath).isFile()
    })
    
    // Procurar arquivo por nome exato
    let realOldFileName = null
    let realOldFilePath = null
    
    const matchedFile = files.find(f => f === oldFileName)
    
    if (matchedFile) {
      realOldFileName = matchedFile
      realOldFilePath = path.join(resDir, matchedFile)
    } else {
      // Se não encontrou pelo nome exato, procurar por similaridade
      const baseExt = path.extname(oldFileName)
      const baseName = path.basename(oldFileName, baseExt)
      const similarFile = files.find(f => 
        path.basename(f, path.extname(f)) === baseName
      )
      
      if (similarFile) {
        realOldFileName = similarFile
        realOldFilePath = path.join(resDir, similarFile)
      }
    }
    
    // Verificar se arquivo antigo existe
    if (!realOldFileName || !realOldFilePath || !fs.existsSync(realOldFilePath)) {
      console.log('[IPC] ❌ Arquivo não encontrado:', oldFileName)
      event.reply('rename-asset-result', {
        success: false,
        error: `Arquivo "${oldFileName}" não encontrado. Disponíveis: ${files.join(', ')}`
      })
      return
    }
    
    // Extrair extensão do arquivo real
    const extension = path.extname(realOldFileName)
    const newFileName = newName.includes('.') ? newName : (newName + extension)
    const newFilePath = path.join(resDir, newFileName)
    
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
    
    // Verificar se a operação funcionou
    if (!fs.existsSync(newFilePath)) {
      throw new Error('Arquivo não existe após renomeação')
    }
    
    // Atualizar resources.res se necessário
    const resourcesPath = path.join(resDir, 'resources.res')
    if (fs.existsSync(resourcesPath)) {
      let content = fs.readFileSync(resourcesPath, 'utf-8')
      
      // Substituir nome antigo pelo novo nas entradas do resources.res
      const oldNameWithoutExt = realOldFileName.replace(/\.[^.]*$/, '')
      const newNameWithoutExt = newFileName.replace(/\.[^.]*$/, '')
      const oldResourceName = oldNameWithoutExt.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
      const newResourceName = newNameWithoutExt.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
      
      // Substituir entradas que contenham o nome antigo
      const oldRegex = new RegExp(`(IMAGE|TILEMAP|PALETTE|SOUND)\\s+${oldResourceName}\\b`, 'g')
      const oldFileRegex = new RegExp(`"${realOldFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')
      
      content = content.replace(oldRegex, `$1 ${newResourceName}`)
      content = content.replace(oldFileRegex, `"${newFileName}"`)
      
      fs.writeFileSync(resourcesPath, content)
    }
    
    console.log('[IPC] ✅ RESPOSTA ENVIADA - Asset renomeado:', oldFileName, '->', newFileName)
    event.reply('rename-asset-result', {
      success: true,
      newPath: path.join('res', newFileName),
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
