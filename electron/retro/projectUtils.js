import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { TOOLKIT_DIR, getAppPathSafe, copyDirectoryRecursive, loadConfigFile } from './utils.js'
import { installNewProjectRuntime, recordNewProjectToolchain, validateModuleSelection } from './newProject.js'
import { copyProjectTemplate, prepareNewProject, inspectProjectTemplate } from './starterProject.js'
import { installCutsceneRuntime } from './cutsceneRuntime.js'
import { installRuntimeModules } from './runtimeInstaller.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const TEMPLATE_DIRECTORIES = {
  'md-skeleton': 'md-skeleton',
  '32x-skeleton': '32x-skeleton',
  'sgdk-skeleton': 'sgdk-skeleton',
  'sgdk-starter': 'sgdk-starter',
  'sgdk-stage9-sample': 'sgdk-stage9-sample',
  'hello-world-sgdk': 'hello-world-sgdk'
}

export function resolveTemplateAbsolutePath(templateDir) {
  const candidates = []
  const appPath = getAppPathSafe()
  const projectRoot = path.resolve(__dirname, '..')
  const resourcesPath = process.resourcesPath

  if (templateDir !== 'sgdk-skeleton') candidates.push(path.join(TOOLKIT_DIR, 'examples', templateDir))

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

  // The bundled SGDK skeleton carries the matching map exporter/runtime version.
  if (templateDir === 'sgdk-skeleton') candidates.push(path.join(TOOLKIT_DIR, 'examples', templateDir))

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
export function createProjectFromTemplate(name, basePath, template, modules) {
  if (!name || !basePath) return { success: false, error: 'name e basePath são obrigatórios' }
  const projectPath = path.join(basePath, name)
  if (fs.existsSync(projectPath)) return { success: false, error: 'Diretório já existe' }
  const { absolutePath, key } = getTemplatePath(template || 'hello-world-sgdk')
  if (!absolutePath || !fs.existsSync(absolutePath)) return { success: false, error: `Template "${key}" não encontrado` }
  let created = null
  try {
    validateModuleSelection(modules)
    const descriptor = inspectProjectTemplate(absolutePath)
    fs.mkdirSync(projectPath, { recursive: true })
    created = projectPath
    copyProjectTemplate(absolutePath, projectPath, copyDirectoryRecursive)
    installNewProjectRuntime(projectPath, modules, descriptor?.requires)
    // Every new game ships the generic cutscene runtime; failure must not block creation.
    try { installCutsceneRuntime(projectPath) } catch (error) { console.warn('[Retro] Runtime de cutscenes não instalado:', error.message) }
    const scenesDir = path.join(projectPath, 'scenes')
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true })
    const mapsDir = path.join(projectPath, 'maps')
    if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true })
    const charsetsDir = path.join(projectPath, 'charsets')
    if (!fs.existsSync(charsetsDir)) fs.mkdirSync(charsetsDir, { recursive: true })
    const metadata = { name, template: key, createdAt: new Date().toISOString(), resourcePath: 'res', assets: [] }
    const templateConfigPath = path.join(absolutePath, 'retro-studio.json')
    if (fs.existsSync(templateConfigPath)) {
      const templateConfig = JSON.parse(fs.readFileSync(templateConfigPath, 'utf-8'))
      if (templateConfig.mapExport) metadata.mapExport = templateConfig.mapExport
      if (templateConfig.retroStudio) metadata.retroStudio = structuredClone(templateConfig.retroStudio)
    }
    fs.writeFileSync(path.join(projectPath, 'retro-studio.json'), JSON.stringify(metadata, null, 2))
    const finish = prepared => ({ success: true, projectPath, toolchain: recordNewProjectToolchain(projectPath, loadConfigFile('ui-settings.json', {}).toolkitPath), prepared })
    // Only templates that export generated files answer with a promise; the others stay synchronous.
    if (descriptor?.prepare) return prepareNewProject(projectPath).then(finish, error => ({ success: false, error: error.message }))
    return finish({ steps: [] })
  } catch (e) {
    // A project that failed halfway is removed: only the folder this call created.
    if (created) { try { fs.rmSync(created, { recursive: true, force: true }) } catch { /* reported below */ } }
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
