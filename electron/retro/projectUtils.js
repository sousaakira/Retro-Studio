import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { TOOLKIT_DIR, getAppPathSafe, copyDirectoryRecursive } from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const TEMPLATE_DIRECTORIES = {
  'md-skeleton': 'md-skeleton',
  '32x-skeleton': '32x-skeleton',
  'sgdk-skeleton': 'sgdk-skeleton',
  'sgdk-stage9-sample': 'sgdk-stage9-sample',
  'hello-world-sgdk': 'hello-world-sgdk'
}

export function resolveTemplateAbsolutePath(templateDir) {
  const candidates = []
  const appPath = getAppPathSafe()
  const projectRoot = path.resolve(__dirname, '..')
  const resourcesPath = process.resourcesPath

  candidates.push(path.join(TOOLKIT_DIR, 'examples', templateDir))

  if (appPath) {
    candidates.push(path.join(appPath, 'assets', 'toolkit', 'examples', templateDir))
    candidates.push(path.join(appPath, 'toolkit', 'examples', templateDir))
    candidates.push(path.join(appPath, 'src', 'toolkit', 'examples', templateDir))
    candidates.push(path.join(appPath, '..', 'assets', 'toolkit', 'examples', templateDir))
  }

  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'assets', 'toolkit', 'examples', templateDir))
    candidates.push(path.join(resourcesPath, 'toolkit', 'examples', templateDir))
    candidates.push(path.join(resourcesPath, 'app.asar.unpacked', 'assets', 'toolkit', 'examples', templateDir))
  }

  candidates.push(path.join(projectRoot, '..', 'assets', 'toolkit', 'examples', templateDir))
  candidates.push(path.join(projectRoot, 'assets', 'toolkit', 'examples', templateDir))
  candidates.push(path.join(process.cwd(), 'assets', 'toolkit', 'examples', templateDir))

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  console.warn(`[Retro] Template "${templateDir}" não encontrado. Candidatos:`, candidates)
  return null
}

export function getTemplatePath(templateKey) {
  const key = TEMPLATE_DIRECTORIES[templateKey] ? templateKey : 'md-skeleton'
  return {
    key,
    absolutePath: resolveTemplateAbsolutePath(TEMPLATE_DIRECTORIES[key])
  }
}

/**
 * Cria projeto a partir de template (para tools da IA)
 * @param {string} name - Nome do projeto
 * @param {string} basePath - Diretório onde criar (ex: workspace ou parent)
 * @param {string} template - Chave do template (hello-world-sgdk, sgdk-skeleton, etc.)
 * @returns {{ success: boolean, projectPath?: string, error?: string }}
 */
export function createProjectFromTemplate(name, basePath, template) {
  if (!name || !basePath) return { success: false, error: 'name e basePath são obrigatórios' }
  const projectPath = path.join(basePath, name)
  if (fs.existsSync(projectPath)) return { success: false, error: 'Diretório já existe' }
  const { absolutePath, key } = getTemplatePath(template || 'hello-world-sgdk')
  if (!absolutePath || !fs.existsSync(absolutePath)) return { success: false, error: `Template "${key}" não encontrado` }
  try {
    fs.mkdirSync(projectPath, { recursive: true })
    copyDirectoryRecursive(absolutePath, projectPath)
    const scenesDir = path.join(projectPath, 'scenes')
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true })
    const metadata = { name, template: key, createdAt: new Date().toISOString(), resourcePath: 'res', assets: [] }
    fs.writeFileSync(path.join(projectPath, 'retro-studio.json'), JSON.stringify(metadata, null, 2))
    return { success: true, projectPath }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export function lerDiretorio(caminho) {
  const stats = fs.statSync(caminho)
  if (stats.isDirectory() && (path.basename(caminho) === 'out' || path.basename(caminho).startsWith('.'))) {
    return null
  }

  const item = {
    id: '' + Math.random(),
    label: path.basename(caminho),
    tipo: stats.isDirectory() ? 'diretorio' : 'arquivo',
    path: caminho,
    expanded: false
  }

  if (stats.isDirectory()) {
    const conteudo = fs.readdirSync(caminho)
      .map((subItem) => {
        const subCaminho = path.join(caminho, subItem)
        if (path.basename(subCaminho) !== 'out') {
          return lerDiretorio(subCaminho)
        }
        return null
      })
      .filter(Boolean)
      .sort((a, b) => (a.tipo === 'diretorio' && b.tipo === 'arquivo' ? -1 : a.tipo === 'arquivo' && b.tipo === 'diretorio' ? 1 : 0))
    item.children = conteudo
  }

  return item
}

export function getProjectConfig(projectPath) {
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
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    }
  } catch (error) {
    console.error('[Retro] Erro ao ler/criar retro-studio.json:', error)
  }

  return config
}
