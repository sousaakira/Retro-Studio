import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import extract from 'extract-zip'
import { CONFIG_DIR } from './utils.js'
const PACKAGES_BASE_URL = 'https://api.retrostudio.dev/packages'

export function getPlatformKey() {
  return process.platform === 'win32' ? 'win32' : process.platform
}

const BUILTIN_MANIFEST = {
  packages: [
    {
      id: 'marsdev',
      name: 'MarsDev',
      description: 'Toolchain de compilação para Mega Drive',
      category: 'toolkit',
      platforms: {
        linux: { url: `${PACKAGES_BASE_URL}/marsdev-linux-x64.zip`, extractTo: ['toolkit', 'marsdev', 'mars'] },
        win32: { url: `${PACKAGES_BASE_URL}/marsdev-win32-x64.zip`, extractTo: ['toolkit', 'marsdev', 'mars'] }
      }
    },
    {
      id: 'sgdk',
      name: 'SGDK',
      description: 'Sega Genesis Development Kit',
      category: 'toolkit',
      platforms: {
        linux: { url: `${PACKAGES_BASE_URL}/sgdk-linux-x64.zip`, extractTo: ['toolkit', 'sgdk'] },
        win32: { url: `${PACKAGES_BASE_URL}/sgdk-win32-x64.zip`, extractTo: ['toolkit', 'sgdk'] }
      }
    },
    {
      id: 'gen_sdl2',
      name: 'Genesis Plus GX (SDL2)',
      description: 'Emulador Mega Drive',
      category: 'emulator',
      platforms: {
        linux: { url: `${PACKAGES_BASE_URL}/gen_sdl2-linux-x64.zip`, extractTo: ['emulators', 'md'] },
        win32: { url: `${PACKAGES_BASE_URL}/gen_sdl2-win32-x64.zip`, extractTo: ['emulators', 'md'] }
      }
    },
    {
      id: 'blastem',
      name: 'BlastEm',
      description: 'Emulador Mega Drive',
      category: 'emulator',
      platforms: {
        linux: { url: `${PACKAGES_BASE_URL}/blastem-linux-x64.zip`, extractTo: ['emulators', 'blastem'] },
        win32: { url: `${PACKAGES_BASE_URL}/blastem-win32-x64.zip`, extractTo: ['emulators', 'blastem'] }
      }
    },
    {
      id: 'picodrive',
      name: 'PicoDrive',
      description: 'Emulador Mega Drive',
      category: 'emulator',
      platforms: {
        linux: { url: `${PACKAGES_BASE_URL}/picodrive-linux-x64.zip`, extractTo: ['emulators', 'picodrive'] },
        win32: { url: `${PACKAGES_BASE_URL}/picodrive-win32-x64.zip`, extractTo: ['emulators', 'picodrive'] }
      }
    }
  ]
}

export async function getPackageManifest() {
  const manifestUrl = `${PACKAGES_BASE_URL}/manifest.json`
  try {
    console.log('[Retro] getPackageManifest: fetch', manifestUrl)
    const res = await fetch(manifestUrl)
    console.log('[Retro] getPackageManifest: status', res.status, res.statusText, 'url=', res.url)
    if (res.ok) {
      const data = await res.json()
      if (data.packages && Array.isArray(data.packages)) {
        console.log('[Retro] getPackageManifest: ok, packages=', data.packages.length)
        return data
      }
    }
  } catch (err) {
    console.warn('[Retro] Manifest remoto falhou, usando embutido:', err.message)
  }
  console.log('[Retro] getPackageManifest: usando BUILTIN_MANIFEST')
  return BUILTIN_MANIFEST
}

export function getInstallDir(extractToSegments) {
  if (!extractToSegments?.length) return null
  return path.join(CONFIG_DIR, ...extractToSegments)
}

export function isPackageInstalled(extractToSegments) {
  const dir = getInstallDir(extractToSegments)
  if (!dir || !fs.existsSync(dir)) return false
  try {
    return fs.readdirSync(dir).length > 0
  } catch {
    return false
  }
}

export async function downloadPackage(pkg, platformKey, sendProgress) {
  const platformConfig = pkg.platforms?.[platformKey]
  if (!platformConfig?.url) {
    throw new Error(`Pacote ${pkg.id} não disponível para ${platformKey}.`)
  }

  const extractToSegments = platformConfig.extractTo
  const destDir = getInstallDir(extractToSegments)
  if (!destDir) throw new Error('Destino de extração inválido.')

  const tmpDir = path.join(CONFIG_DIR, 'tmp')
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

  const filename = path.basename(new URL(platformConfig.url).pathname) || `${pkg.id}.zip`
  const zipPath = path.join(tmpDir, `${pkg.id}-${platformKey}-${Date.now()}-${filename}`)

  const downloadUrl = platformConfig.url
  console.log('[Retro] downloadPackage: pkg=', pkg.id, 'platform=', platformKey, 'url=', downloadUrl, 'destDir=', destDir)

  try {
    sendProgress?.({ phase: 'download', percent: 0 })
    const response = await fetch(downloadUrl, { redirect: 'follow' })
    console.log('[Retro] downloadPackage: response status=', response.status, response.statusText, 'finalUrl=', response.url, 'redirected=', response.redirected)

    if (!response.ok) {
      let bodyPreview = ''
      try {
        const text = await response.text()
        bodyPreview = text.slice(0, 200)
      } catch {}
      console.error('[Retro] downloadPackage: HTTP error', { status: response.status, url: response.url, bodyPreview })
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    sendProgress?.({ phase: 'download', percent: 100 })
    await fsPromises.writeFile(zipPath, new Uint8Array(buffer))

    sendProgress?.({ phase: 'extract', percent: 99 })
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    await extract(zipPath, { dir: destDir })
    sendProgress?.({ phase: 'extract', percent: 100 })
    console.log('[Retro] downloadPackage: extraído em', destDir)
  } catch (e) {
    console.error('[Retro] downloadPackage: erro', e.message, 'pkg=', pkg.id, 'url=', downloadUrl)
    throw e
  } finally {
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
    } catch (e) {
      console.warn('[Retro] Falha ao remover zip:', zipPath, e)
    }
  }

  return { success: true, installPath: destDir }
}
