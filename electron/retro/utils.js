import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export const CONFIG_DIR = path.join(app.getPath('home'), '.retrostudio')
export const EMULATORS_DIR = path.join(CONFIG_DIR, 'emulators')
export const TOOLKIT_DIR = path.join(CONFIG_DIR, 'toolkit')

export function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
  if (!fs.existsSync(EMULATORS_DIR)) {
    fs.mkdirSync(EMULATORS_DIR, { recursive: true })
  }
  if (!fs.existsSync(TOOLKIT_DIR)) {
    fs.mkdirSync(TOOLKIT_DIR, { recursive: true })
  }
}

export function saveConfigFile(filename, data) {
  try {
    ensureConfigDir()
    const filePath = path.join(CONFIG_DIR, filename)
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error(`[Retro] Erro ao salvar ${filename}:`, error)
    return false
  }
}

export function loadConfigFile(filename, defaultValue = {}) {
  try {
    const filePath = path.join(CONFIG_DIR, filename)
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch (error) {
    console.error(`[Retro] Erro ao carregar ${filename}:`, error)
  }
  return defaultValue
}

export function getAppPathSafe() {
  try {
    if (app && typeof app.getAppPath === 'function') {
      return app.getAppPath()
    }
  } catch (error) {
    console.warn('[Retro] Não foi possível obter appPath:', error)
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
    entries.forEach((entry) => {
      const srcPath = path.join(source, entry)
      const destPath = path.join(destination, entry)
      copyDirectoryRecursive(srcPath, destPath)
    })
    return
  }
  fs.copyFileSync(source, destination)
}
