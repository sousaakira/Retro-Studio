// Programas abertos pelo menu do sistema (AppImage, .deb, atalho da área de trabalho) não
// herdam o PATH do terminal: o que o asdf, o nvm, o mise ou o npm global acrescentam no
// .zshrc/.bashrc fica de fora, e a IDE não acha codex-acp, claude-agent-acp, claude nem
// node. Ao iniciar, a IDE pergunta o PATH ao shell do usuário e o junta ao seu.
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const MARK = '__RETRO_STUDIO_PATH__'

/** PATH do shell de login interativo do usuário, ou '' se não der para ler. */
export function readShellPath({ shell = process.env.SHELL || '/bin/bash', timeout = 5000 } = {}) {
  if (process.platform === 'win32') return Promise.resolve('')
  const fish = path.basename(shell) === 'fish'
  const script = fish ? `printf '%s' ${MARK}; string join : $PATH; printf '%s' ${MARK}` : `printf '%s%s%s' ${MARK} "$PATH" ${MARK}`
  return new Promise(resolve => {
    execFile(shell, ['-ilc', script], { timeout, maxBuffer: 1024 * 1024, env: { ...process.env, TERM: 'dumb' } }, (_error, stdout) => {
      const parts = String(stdout || '').split(MARK)
      resolve(parts.length >= 3 ? parts[1].trim() : '')
    })
  })
}

/** Pastas onde gerenciadores de Node costumam instalar comandos globais. */
export function knownBinDirs(home = os.homedir()) {
  const dirs = [
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    '/usr/local/bin'
  ]
  // nvm: a versão mais nova instalada.
  try {
    const versions = readdirSync(path.join(home, '.nvm', 'versions', 'node'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    if (versions[0]) dirs.push(path.join(home, '.nvm', 'versions', 'node', versions[0], 'bin'))
  } catch { /* sem nvm */ }
  return dirs
}

/** Junta listas de PATH sem repetir pastas e sem pastas inexistentes. */
export function mergePath(...lists) {
  const seen = new Set()
  return lists.flatMap(list => String(list || '').split(path.delimiter)).map(dir => dir.trim())
    .filter(dir => dir && !seen.has(dir) && seen.add(dir) && existsSync(dir)).join(path.delimiter)
}

/** Atualiza process.env.PATH com o PATH do shell e as pastas conhecidas. Nunca rejeita. */
export async function adoptShellPath(options = {}) {
  if (process.platform === 'win32') return process.env.PATH || ''
  let shellPath = ''
  try { shellPath = await readShellPath(options) } catch { /* fica só com as pastas conhecidas */ }
  process.env.PATH = mergePath(process.env.PATH, shellPath, knownBinDirs(options.home).join(path.delimiter))
  return process.env.PATH
}
