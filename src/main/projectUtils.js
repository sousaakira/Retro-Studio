import path from 'path'
import fs from 'fs'
import { TOOLKIT_DIR, getAppPathSafe } from './utils.js'

export const TEMPLATE_DIRECTORIES = {
  'md-skeleton': 'md-skeleton',
  '32x-skeleton': '32x-skeleton',
  'sgdk-skeleton': 'sgdk-skeleton',
  'sgdk-stage9-sample': 'sgdk-stage9-sample'
}

export function resolveTemplateAbsolutePath(templateDir) {
  const candidates = []
  const appPath = getAppPathSafe()
  const projectRoot = path.resolve(__dirname, '..')
  const resourcesPath = process.resourcesPath

  // Prioridade 1: Diretório do usuário (~/.retrostudio/toolkit/examples)
  candidates.push(path.join(TOOLKIT_DIR, 'examples', templateDir))

  if (appPath) {
    candidates.push(path.join(appPath, 'toolkit', 'examples', templateDir))
    candidates.push(path.join(appPath, 'src', 'toolkit', 'examples', templateDir))
    candidates.push(path.join(appPath, '..', 'src', 'toolkit', 'examples', templateDir))
  }

  // Candidatos no diretório de recursos do AppImage
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'toolkit', 'examples', templateDir))
    candidates.push(path.join(resourcesPath, 'app.asar.unpacked', 'toolkit', 'examples', templateDir))
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

export function getTemplatePath(templateKey) {
  const key = TEMPLATE_DIRECTORIES[templateKey] ? templateKey : 'md-skeleton'
  return {
    key,
    absolutePath: resolveTemplateAbsolutePath(TEMPLATE_DIRECTORIES[key])
  }
}

export function lerDiretorio(caminho) {
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
      // Criar o arquivo se não existir
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      console.log('[IPC] retro-studio.json criado em:', projectPath)
    }
  } catch (error) {
    console.error('[IPC] Erro ao ler/criar retro-studio.json:', error)
  }

  return config
}
