/**
 * Verificação de updates e changelog via GitHub Releases API.
 * Sem dependência nova (fetch nativo / https).
 */
import https from 'node:https'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const DEFAULT_REPO = { owner: 'sousaakira', repo: 'Retro-Studio' }

function readAppVersion() {
  try {
    const pkg = require(path.join(__dirname, '..', 'package.json'))
    return String(pkg.version || '0.0.0')
  } catch {
    return '0.0.0'
  }
}

function githubGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Retro-Studio',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      timeout: 15000
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Timeout ao consultar GitHub Releases'))
    })
    req.end()
  })
}

/** Compara semver simples a.b.c — retorna >0 se a>b, <0 se a<b, 0 se igual. */
export function compareSemver(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x - y
  }
  return 0
}

function mapRelease(r) {
  if (!r || typeof r !== 'object') return null
  return {
    tag: r.tag_name || '',
    name: r.name || r.tag_name || '',
    body: r.body || '',
    url: r.html_url || '',
    publishedAt: r.published_at || null,
    prerelease: !!r.prerelease,
    draft: !!r.draft,
    assets: Array.isArray(r.assets)
      ? r.assets.map((a) => ({
        name: a.name,
        url: a.browser_download_url,
        size: a.size
      }))
      : []
  }
}

export async function getAppInfo() {
  return {
    version: readAppVersion(),
    repo: { ...DEFAULT_REPO },
    releasesUrl: `https://github.com/${DEFAULT_REPO.owner}/${DEFAULT_REPO.repo}/releases`
  }
}

export async function fetchChangelog({ limit = 10 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 10, 1), 30)
  const raw = await githubGet(`/repos/${DEFAULT_REPO.owner}/${DEFAULT_REPO.repo}/releases?per_page=${n}`)
  const list = Array.isArray(raw) ? raw : []
  return list
    .filter((r) => r && !r.draft)
    .map(mapRelease)
    .filter(Boolean)
}

export async function checkForUpdates() {
  const current = readAppVersion()
  const latestRaw = await githubGet(`/repos/${DEFAULT_REPO.owner}/${DEFAULT_REPO.repo}/releases/latest`)
  const latest = mapRelease(latestRaw)
  const latestTag = latest?.tag || ''
  const latestVersion = latestTag.replace(/^v/i, '')
  const cmp = compareSemver(latestVersion, current)
  return {
    currentVersion: current,
    latestVersion,
    latestTag,
    updateAvailable: cmp > 0,
    latest,
    releasesUrl: `https://github.com/${DEFAULT_REPO.owner}/${DEFAULT_REPO.repo}/releases`
  }
}
