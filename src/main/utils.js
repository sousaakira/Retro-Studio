import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export const CONFIG_DIR = path.join(app.getPath('home'), '.retrostudio');
export const EMULATORS_DIR = path.join(CONFIG_DIR, 'emulators');
export const TOOLKIT_DIR = path.join(CONFIG_DIR, 'toolkit');

export function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(EMULATORS_DIR)) {
    fs.mkdirSync(EMULATORS_DIR, { recursive: true });
  }
  if (!fs.existsSync(TOOLKIT_DIR)) {
    fs.mkdirSync(TOOLKIT_DIR, { recursive: true });
  }
}

export function saveConfigFile(filename, data) {
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

export function loadConfigFile(filename, defaultValue = {}) {
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

export function getAppPathSafe() {
  try {
    if (app && typeof app.getAppPath === 'function') {
      return app.getAppPath()
    }
  } catch (error) {
    console.warn('Não foi possível obter appPath:', error)
  }
  return null
}

export function copyDirectoryRecursive(source, destination) {
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

export function resolveProjectRoot(projectPath) {
  if (!projectPath) {
    throw new Error('Caminho do projeto não informado.')
  }
  const resolved = path.resolve(projectPath)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Projeto inválido ou inacessível.')
  }
  return resolved
}

export function ensurePathInsideProject(projectRoot, candidatePath) {
  const resolvedRoot = path.resolve(projectRoot)
  const resolvedCandidate = path.resolve(candidatePath)
  if (!resolvedCandidate.startsWith(resolvedRoot)) {
    throw new Error('Operação fora do diretório do projeto.')
  }
  return resolvedCandidate
}

export function sanitizeEntryName(name) {
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

export function ensureEntryExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error('Entrada não encontrada.')
  }
}

export function buildUniqueName(baseName, existingNames) {
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
