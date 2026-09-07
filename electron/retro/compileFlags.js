/**
 * Gera compile_flags.txt / compile_commands.json para clangd em projetos SGDK/MarsDev.
 * Sem dependência do Electron `app` (rodável em smoke Node).
 */
import path from 'path'
import fs from 'fs'
import os from 'os'

const CONFIG_DIR_NAME = '.retrostudio'

function configDir() {
  return path.join(os.homedir(), CONFIG_DIR_NAME)
}

function loadUiSettings() {
  try {
    const filePath = path.join(configDir(), 'ui-settings.json')
    if (!fs.existsSync(filePath)) return {}
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

export function getToolkitPathFromSettings() {
  const ui = loadUiSettings()
  let p = ui.toolkitPath || ''
  if (!p) {
    const defaultToolkitPath = path.join(configDir(), 'toolkit', 'marsdev', 'mars')
    if (fs.existsSync(defaultToolkitPath)) p = defaultToolkitPath
  }
  return p && fs.existsSync(p) ? p : null
}

/**
 * Resolve diretório GDK (headers genesis.h).
 * @param {string} toolkitPath
 */
export function resolveGdkIncDir(toolkitPath) {
  if (!toolkitPath) return null
  const candidates = [
    path.join(toolkitPath, 'm68k-elf', 'inc'),
    path.join(toolkitPath, 'inc'),
    path.join(toolkitPath, 'include')
  ]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'genesis.h'))) return c
    if (fs.existsSync(c)) return c
  }
  return null
}

/**
 * @param {string} projectPath
 * @param {{ toolkitPath?: string|null }} [options]
 */
export function writeCompileFlags(projectPath, options = {}) {
  if (!projectPath || !fs.existsSync(projectPath)) {
    throw new Error('projectPath inválido')
  }
  const toolkitPath = options.toolkitPath || getToolkitPathFromSettings()
  const gdkInc = resolveGdkIncDir(toolkitPath)
  const outDir = path.join(projectPath, '.retrostudio')
  fs.mkdirSync(outDir, { recursive: true })

  const flags = [
    '-xc',
    '-std=c11',
    '-D__SGDK__',
    '-D__MEGA_DRIVE__',
    `-I${path.join(projectPath, 'inc')}`,
    `-I${path.join(projectPath, 'res')}`,
    `-I${path.join(projectPath, 'src')}`,
    `-I${projectPath}`
  ]
  if (gdkInc) {
    flags.push(`-I${gdkInc}`)
    const parent = path.dirname(gdkInc)
    const resInc = path.join(parent, 'res')
    if (fs.existsSync(resInc)) flags.push(`-I${resInc}`)
  }

  const flagsPath = path.join(outDir, 'compile_flags.txt')
  const rootFlagsPath = path.join(projectPath, 'compile_flags.txt')
  const marker = '# generated-by-retro-studio'
  const body = `${marker}\n${flags.join('\n')}\n`
  fs.writeFileSync(flagsPath, body, 'utf8')

  let writeRoot = true
  if (fs.existsSync(rootFlagsPath)) {
    try {
      const existing = fs.readFileSync(rootFlagsPath, 'utf8')
      writeRoot = existing.includes('generated-by-retro-studio')
    } catch {
      writeRoot = false
    }
  }
  if (writeRoot) fs.writeFileSync(rootFlagsPath, body, 'utf8')

  const dbPath = path.join(outDir, 'compile_commands.json')
  const db = []
  const pushFile = (file) => {
    db.push({
      directory: projectPath,
      file,
      arguments: ['clang', ...flags, file]
    })
  }
  const mainC = path.join(projectPath, 'src', 'main.c')
  if (fs.existsSync(mainC)) pushFile(mainC)
  else pushFile(path.join(projectPath, 'src', 'main.c'))

  try {
    const srcDir = path.join(projectPath, 'src')
    if (fs.existsSync(srcDir)) {
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name)
          let st
          try { st = fs.statSync(full) } catch { continue }
          if (st.isDirectory()) walk(full)
          else if (name.endsWith('.c') && full !== mainC) pushFile(full)
        }
      }
      walk(srcDir)
    }
  } catch { /* ignore */ }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8')

  return { flagsPath, flags, gdkInc, toolkitPath, dbPath }
}
