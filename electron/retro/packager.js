/**
 * Empacotamento de ROM + emulador para Steam (Linux).
 * Gera AppDir com executável único (AppRun) ou AppImage.
 */
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import fsPromises from 'fs/promises'
import { spawn } from 'child_process'
import { findRomOutput } from './emulatorUtils.js'
import { resolveEmulatorPath } from './emulatorUtils.js'
import { loadConfigFile, TOOLS_DIR, getAppPathSafe } from './utils.js'
import { copyDirectoryRecursive } from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LINUX_ONLY = process.platform === 'linux'

function getDefaultIconPath() {
  const candidates = [
    path.join(__dirname, 'default-game-icon.png'),
    path.join(__dirname, '..', '..', 'assets', 'default-game-icon.png'),
    getAppPathSafe() && path.join(getAppPathSafe(), 'assets', 'default-game-icon.png'),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'retro', 'default-game-icon.png')
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}
const APPIMAGETOOL_URL = 'https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage'

function getEmulatorDir(emulatorPath) {
  if (!emulatorPath) return null
  const dir = path.dirname(emulatorPath)
  return fs.existsSync(dir) ? dir : null
}

async function ensureAppImageTool(onProgress) {
  const report = (msg) => { if (typeof onProgress === 'function') onProgress(msg) }
  const toolPath = path.join(TOOLS_DIR, 'appimagetool-x86_64.AppImage')

  const candidates = [
    toolPath,
    path.join(process.env.HOME || '', '.local', 'bin', 'appimagetool'),
    path.join(process.env.HOME || '', '.local', 'bin', 'appimagetool-x86_64.AppImage'),
    '/usr/bin/appimagetool'
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }

  try {
    const { execSync } = await import('child_process')
    execSync('which appimagetool', { stdio: 'ignore' })
    return 'appimagetool'
  } catch {}

  report('Baixando appimagetool...')
  if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true })

  const res = await fetch(APPIMAGETOOL_URL, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Falha ao baixar appimagetool: HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  await fsPromises.writeFile(toolPath, new Uint8Array(buf))
  fs.chmodSync(toolPath, 0o755)
  report('appimagetool instalado.')
  return toolPath
}

function copyEmulatorWithDeps(emulatorPath, destDir) {
  const emuDir = getEmulatorDir(emulatorPath)
  if (!emuDir) return null
  const emuName = path.basename(emulatorPath)
  const destEmuDir = path.join(destDir, 'emulator')
  fs.mkdirSync(destEmuDir, { recursive: true })
  copyDirectoryRecursive(emuDir, destEmuDir)
  return path.join(destEmuDir, emuName)
}

export async function packageForSteamLinux(options) {
  const { projectPath, outputPath, gameName, emulatorId, onProgress } = options
  const report = (msg) => {
    if (typeof onProgress === 'function') onProgress(msg)
  }

  if (!LINUX_ONLY) {
    throw new Error('Empacotamento Steam Linux só é suportado em Linux.')
  }

  if (!projectPath || !fs.existsSync(projectPath)) {
    throw new Error('Projeto inválido.')
  }

  const romPath = findRomOutput(projectPath)
  if (!romPath || !fs.existsSync(romPath)) {
    throw new Error('ROM não encontrada. Execute o build antes de empacotar.')
  }

  const emuId = emulatorId || loadConfigFile('emulator-config.json', {}).selectedEmulator || 'gen_sdl2'
  const emulatorPath = resolveEmulatorPath(emuId)
  if (!emulatorPath || !fs.existsSync(emulatorPath)) {
    throw new Error(`Emulador "${emuId}" não encontrado. Instale via Configurações > Emuladores.`)
  }

  const name = gameName || path.basename(projectPath) || 'game'
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  const appDirPath = path.join(outputPath, `${safeName}.AppDir`)
  const usrBin = path.join(appDirPath, 'usr', 'bin')
  const romDest = path.join(appDirPath, 'rom.bin')

  report('Criando estrutura AppDir...')
  fs.mkdirSync(usrBin, { recursive: true })

  report('Copiando ROM...')
  fs.copyFileSync(romPath, romDest)

  report('Copiando emulador...')
  const bundledEmuPath = copyEmulatorWithDeps(emulatorPath, appDirPath)
  if (!bundledEmuPath || !fs.existsSync(bundledEmuPath)) {
    throw new Error('Falha ao copiar emulador.')
  }

  const appRunContent = `#!/bin/bash
APPDIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="${'$'}APPDIR/emulator:${'$'}LD_LIBRARY_PATH"
exec "${'$'}APPDIR/emulator/${path.basename(bundledEmuPath)}" "${'$'}APPDIR/rom.bin"
`

  report('Gerando AppRun...')
  const appRunPath = path.join(appDirPath, 'AppRun')
  fs.writeFileSync(appRunPath, appRunContent, { mode: 0o755 })

  const projectIconPath = path.join(projectPath, 'icon.png')
  const defaultIconPath = getDefaultIconPath()
  const iconSource = fs.existsSync(projectIconPath) ? projectIconPath : defaultIconPath
  const hasIcon = !!iconSource
  if (hasIcon) {
    fs.copyFileSync(iconSource, path.join(appDirPath, `${safeName}.png`))
  }

  const desktopContent = `[Desktop Entry]
Name=${safeName}
Exec=AppRun
Type=Application
Categories=Game;
${hasIcon ? `Icon=${safeName}\n` : ''}`

  report('Gerando .desktop...')
  fs.writeFileSync(path.join(appDirPath, `${safeName}.desktop`), desktopContent)

  report('AppDir pronto.')
  const appImagePath = path.join(outputPath, `${safeName}.AppImage`)

  try {
    const appImageTool = await ensureAppImageTool(report)
    report('Gerando AppImage...')

    const isAppImage = typeof appImageTool === 'string' && appImageTool.endsWith('.AppImage')
    const env = { ...process.env }
    if (isAppImage) env.ARCH = 'x86_64'

    await new Promise((resolve, reject) => {
      const proc = spawn(appImageTool, [appDirPath, appImagePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      })
      let err = ''
      proc.stderr.on('data', (d) => { err += d })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`appimagetool falhou: ${err || code}`))
      })
    })
    report('AppImage gerado.')
    return { appDirPath, appImagePath, success: true }
  } catch (e) {
    report(`Erro ao gerar AppImage: ${e.message}. AppDir em: ${appDirPath}`)
    return { appDirPath, appImagePath: null, success: true }
  }
}
