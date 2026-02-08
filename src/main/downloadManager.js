import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { Transform } from 'stream'
import { pipeline } from 'stream'
import { promisify } from 'util'
import extract from 'extract-zip'
import { CONFIG_DIR } from './utils.js'

const pipelineAsync = promisify(pipeline)

const PACKAGES_BASE_URL = 'https://api.retrostudio.dev/packages'

/**
 * Mapeia process.platform para chave do manifest.
 * linux -> linux, win32 -> win32, darwin -> darwin
 */
export function getPlatformKey() {
  return process.platform === 'win32' ? 'win32' : process.platform
}

/**
 * Manifest embutido dos pacotes disponíveis.
 * URLs apontam para retrostudio.dev; todos os pacotes são .zip
 */
const BUILTIN_MANIFEST = {
  packages: [
    {
      id: 'marsdev',
      name: 'MarsDev',
      description: 'Toolchain de compilação para Mega Drive (make, gcc, etc.)',
      category: 'toolkit',
      platforms: {
        linux: {
          url: `${PACKAGES_BASE_URL}/marsdev-linux-x64.zip`,
          extractTo: ['toolkit', 'marsdev', 'mars'],
        },
        win32: {
          url: `${PACKAGES_BASE_URL}/marsdev-win32-x64.zip`,
          extractTo: ['toolkit', 'marsdev', 'mars'],
        },
      },
    },
    {
      id: 'sgdk',
      name: 'SGDK',
      description: 'Sega Genesis Development Kit (bibliotecas e headers)',
      category: 'toolkit',
      platforms: {
        linux: {
          url: `${PACKAGES_BASE_URL}/sgdk-linux-x64.zip`,
          extractTo: ['toolkit', 'sgdk'],
        },
        win32: {
          url: `${PACKAGES_BASE_URL}/sgdk-win32-x64.zip`,
          extractTo: ['toolkit', 'sgdk'],
        },
      },
    },
    {
      id: 'gen_sdl2',
      name: 'Genesis Plus GX (SDL2)',
      description: 'Emulador Mega Drive (gen_sdl2)',
      category: 'emulator',
      platforms: {
        linux: {
          url: `${PACKAGES_BASE_URL}/gen_sdl2-linux-x64.zip`,
          extractTo: ['emulators', 'md'],
        },
        win32: {
          url: `${PACKAGES_BASE_URL}/gen_sdl2-win32-x64.zip`,
          extractTo: ['emulators', 'md'],
        },
      },
    },
    {
      id: 'blastem',
      name: 'Blastem',
      description: 'Emulador Mega Drive (Blastem)',
      category: 'emulator',
      platforms: {
        linux: {
          url: `${PACKAGES_BASE_URL}/blastem-linux-x64.zip`,
          extractTo: ['emulators', 'blastem'],
        },
        win32: {
          url: `${PACKAGES_BASE_URL}/blastem-win32-x64.zip`,
          extractTo: ['emulators', 'blastem'],
        },
      },
    },
    {
      id: 'picodrive',
      name: 'PicoDrive',
      description: 'Emulador Mega Drive (PicoDrive)',
      category: 'emulator',
      platforms: {
        linux: {
          url: `${PACKAGES_BASE_URL}/picodrive-linux-x64.zip`,
          extractTo: ['emulators', 'picodrive'],
        },
        win32: {
          url: `${PACKAGES_BASE_URL}/picodrive-win32-x64.zip`,
          extractTo: ['emulators', 'picodrive'],
        },
      },
    },
    {
      id: 'genesis_plus_gx',
      name: 'Genesis Plus GX',
      description: 'Emulador Mega Drive (Genesis Plus GX)',
      category: 'emulator',
      platforms: {
        linux: {
          url: `${PACKAGES_BASE_URL}/genesis_plus_gx-linux-x64.zip`,
          extractTo: ['emulators', 'genesis'],
        },
        win32: {
          url: `${PACKAGES_BASE_URL}/genesis_plus_gx-win32-x64.zip`,
          extractTo: ['emulators', 'genesis'],
        },
      },
    },
  ],
}

/**
 * Obtém o manifest de pacotes. Tenta buscar de retrostudio.dev, fallback para embutido.
 */
export async function getPackageManifest() {
  try {
    const res = await fetch(`${PACKAGES_BASE_URL}/manifest.json`)
    if (res.ok) {
      const data = await res.json()
      if (data.packages && Array.isArray(data.packages)) return data
    }
  } catch (err) {
    console.warn('[DownloadManager] Manifest remoto falhou, usando embutido:', err.message)
  }
  return BUILTIN_MANIFEST
}

/**
 * Diretório absoluto onde o pacote deve ser extraído.
 * extractTo é array de segmentos relativos a CONFIG_DIR (ex: ['toolkit','marsdev','mars']).
 */
export function getInstallDir(extractToSegments) {
  if (!extractToSegments || !extractToSegments.length) return null
  return path.join(CONFIG_DIR, ...extractToSegments)
}

/**
 * Verifica se um pacote está instalado (pasta de destino existe e não está vazia).
 */
export function isPackageInstalled(extractToSegments) {
  const dir = getInstallDir(extractToSegments)
  if (!dir || !fs.existsSync(dir)) return false
  try {
    const entries = fs.readdirSync(dir)
    return entries.length > 0
  } catch {
    return false
  }
}

/**
 * Baixa um arquivo com report de progresso (percent 0-100).
 * sendProgress({ phase: 'download'|'extract', percent, bytesWritten?, totalBytes? })
 */
export async function downloadPackage(pkg, platformKey, sendProgress) {
  const platformConfig = pkg.platforms?.[platformKey]
  if (!platformConfig?.url) {
    throw new Error(`Pacote ${pkg.id} não disponível para esta plataforma (${platformKey}).`)
  }

  const extractToSegments = platformConfig.extractTo
  const destDir = getInstallDir(extractToSegments)
  if (!destDir) throw new Error('Destino de extração inválido.')

  const tmpDir = path.join(CONFIG_DIR, 'tmp')
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

  const filename = path.basename(new URL(platformConfig.url).pathname) || `${pkg.id}.zip`
  const zipPath = path.join(tmpDir, `${pkg.id}-${platformKey}-${Date.now()}-${filename}`)

  try {
    sendProgress?.({ phase: 'download', percent: 0 })
    const response = await fetch(platformConfig.url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)

    const totalBytes = response.headers.get('content-length')
    const total = totalBytes ? parseInt(totalBytes, 10) : null
    const source = Readable.fromWeb(response.body)
    const writer = fs.createWriteStream(zipPath)
    let bytesWritten = 0
    const progressTransform = new Transform({
      transform(chunk, enc, cb) {
        bytesWritten += chunk.length
        if (total && total > 0) {
          const percent = Math.min(99, Math.round((bytesWritten / total) * 100))
          sendProgress?.({ phase: 'download', percent, bytesWritten, totalBytes: total })
        }
        cb(null, chunk)
      },
    })
    await pipelineAsync(source, progressTransform, writer)

    sendProgress?.({ phase: 'extract', percent: 99 })
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    await extract(zipPath, { dir: destDir })
    sendProgress?.({ phase: 'extract', percent: 100 })
  } finally {
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
    } catch (e) {
      console.warn('[DownloadManager] Falha ao remover zip temporário:', zipPath, e)
    }
  }

  return { success: true, installPath: destDir }
}
