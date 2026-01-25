import { ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { 
  resolveProjectRoot, 
  sanitizeEntryName, 
  ensurePathInsideProject, 
  ensureEntryExists, 
  buildUniqueName 
} from '../utils.js'

export function setupFsHandlers() {
  ipcMain.on('get-home', (event) => {
    const homeDirectory = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
    if (homeDirectory) {
      const caminhoNoHome = path.resolve(homeDirectory);
      const resultDir = navigateDirectory(path.join(caminhoNoHome))
      event.reply('send-directory', resultDir);
    } else {
      console.error('Não foi possível determinar o diretório home.');
    }
  })

  ipcMain.on('current-path', (event) => {
    const resultDir = navigateDirectory(path.join(process.cwd()))
    event.reply('send-directory', resultDir);
  })

  ipcMain.on('directory-navigate', (event, result) => {
    const resultDir = navigateDirectory(result.path)
    event.reply('send-directory', resultDir);
  })

  ipcMain.on('back-directory-navigate', (event, result) => {
    const diretorioPai = path.resolve(result.path, '..');
    const resultDir = navigateDirectory(diretorioPai)
    event.reply('send-directory', resultDir);
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

  ipcMain.on('open-file', (event, pathFile) =>{
    const result = lerConteudoArquivo(pathFile)
    event.reply('receive-file', result)
  })

  ipcMain.on('save-file', (event,data) => {
    const filePath = data.path
    const contentFile = data.cod
    fs.writeFile(filePath, contentFile, 'utf-8', (err) => {
      if(err){
        console.error('Erro on save file: ', err)
      }
    })
  })
}

function navigateDirectory(caminho) {
  try {
    const stats = fs.statSync(caminho);
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
          return null;
        }
      });
      item.children = conteudo.filter(Boolean);
    }
    return item;
  } catch (error) {
    console.error('Erro on navigateDirectory: ', error);
    return null;
  }
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

function lerConteudoArquivo(caminhoArquivo) {
  try {
    if (!caminhoArquivo || typeof caminhoArquivo !== 'string') {
      console.error('[lerConteudoArquivo] Caminho invalido')
      return null
    }
    const caminho = caminhoArquivo.trim()
    if (caminho.startsWith('make:') || caminho.includes('***')) {
      console.error('[lerConteudoArquivo] Linha de erro, nao eh arquivo')
      return null
    }
    if (!fs.existsSync(caminho)) {
      console.error('[lerConteudoArquivo] Arquivo nao encontrado:', caminho)
      return null
    }
    console.log('[lerConteudoArquivo] Lendo:', caminho)
    return fs.readFileSync(caminho, 'utf-8')
  } catch (error) {
    console.error('[lerConteudoArquivo] Erro:', error.message)
    return null
  }
}
