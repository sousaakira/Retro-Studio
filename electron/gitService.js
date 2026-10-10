import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'

const exec = promisify(execFile)
const conflictCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
const labels = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'added', T: 'modified', '?': 'untracked', U: 'conflict' }

export function parseStatus(output) {
  const records = output.split('\0'), files = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const code = record.slice(0, 2), name = record.slice(3)
    const oldPath = /[RC]/.test(code) ? records[++i] : undefined
    const conflict = conflictCodes.has(code)
    files.push({ path: name, ...(oldPath ? { oldPath } : {}),
      status: conflict ? 'conflict' : (labels[code[0]] || labels[code[1]] || 'modified'),
      indexStatus: labels[code[0]] || '', worktreeStatus: labels[code[1]] || '',
      staged: code[0] !== ' ' && code[0] !== '?' && !conflict,
      unstaged: code[1] !== ' ' || conflict, conflict })
  }
  return files
}

function inside(base, target) {
  const relative = path.relative(base, target)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

export function createGitService(directory, { confirmDiscard, trashItem } = {}) {
  const run = async (args, options = {}) => {
    try {
      return await exec('git', ['--no-pager', '--literal-pathspecs', ...args], {
        cwd: directory, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
        timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }, ...options
      })
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Git não encontrado. Instale o Git e reinicie a IDE.')
      const detail = String(error.stderr || error.stdout || error.message).trim()
        .replace(/(https?:\/\/)[^\s/@]+@/g, '$1[credenciais]@')
      const failure = new Error(error.killed ? 'Git excedeu o tempo limite. Confira a conexão e a autenticação.' : detail)
      failure.code = error.code
      throw failure
    }
  }
  const hasHead = async () => {
    try { await run(['rev-parse', '--verify', 'HEAD']); return true } catch { return false }
  }
  const resolveFile = async (file, allowAll = false) => {
    if (typeof file !== 'string' || !file || file.includes('\0') || (!allowAll && file === '.')) throw new Error('Caminho Git inválido.')
    if (allowAll && file === '.') return file
    const absolute = path.resolve(directory, file)
    if (!inside(directory, absolute) || /(^|[\\/])\.git([\\/]|$)/.test(file)) throw new Error('Arquivo fora do projeto.')
    // Resolve the parent, not the final symlink: Git tracks the link itself.
    let parent = path.dirname(absolute)
    while (parent !== directory) {
      try {
        if (!inside(await fs.realpath(directory), await fs.realpath(parent))) throw new Error('Arquivo fora do projeto.')
        break
      } catch (error) { if (error.code !== 'ENOENT') throw error; parent = path.dirname(parent) }
    }
    return file
  }
  const status = async () => {
    const { stdout: root } = await run(['rev-parse', '--show-toplevel'])
    const cwd = await fs.realpath(directory)
    const { stdout } = await run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])
    return parseStatus(stdout).map(file => ({
      ...file, path: path.relative(cwd, path.join(root.trim(), file.path)).split(path.sep).join('/'),
      ...(file.oldPath ? { oldPath: path.relative(cwd, path.join(root.trim(), file.oldPath)).split(path.sep).join('/') } : {})
    }))
  }
  const branchName = name => {
    if (typeof name !== 'string' || !name || name.startsWith('-') || name.includes('\0')) throw new Error('Nome de branch inválido.')
    return name
  }
  const configKey = key => {
    if (!['user.name', 'user.email'].includes(key)) throw new Error('Configuração Git não permitida.')
    return key
  }
  return {
    async serviceVersion() { return 2 },
    async isRepository() {
      try { return (await run(['rev-parse', '--is-inside-work-tree'])).stdout.trim() === 'true' }
      catch (error) { if (/not a git repository/i.test(error.message)) return false; throw error }
    },
    status,
    async currentBranch() {
      const name = (await run(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ({ stdout: '' }))).stdout.trim()
      return name || ('HEAD · ' + (await run(['rev-parse', '--short', 'HEAD'])).stdout.trim())
    },
    async stage(file) {
      await resolveFile(file, true)
      const item = file === '.' ? null : (await status()).find(entry => entry.path === file)
      const paths = [file]
      if (item?.oldPath) { await resolveFile(item.oldPath); paths.push(item.oldPath) }
      await run(['add', '-A', '--', ...paths]); return true
    },
    async unstage(file) {
      await resolveFile(file, true)
      const item = file === '.' ? null : (await status()).find(entry => entry.path === file)
      const paths = [file]
      if (item?.oldPath) { await resolveFile(item.oldPath); paths.push(item.oldPath) }
      await run(await hasHead() ? ['reset', '-q', 'HEAD', '--', ...paths] : ['rm', '--cached', '-r', '--force', '--ignore-unmatch', '--', ...paths])
      return true
    },
    async discard(file) {
      await resolveFile(file)
      const item = (await status()).find(entry => entry.path === file)
      if (!item || item.conflict) throw new Error('Resolva os conflitos antes de descartar este arquivo.')
      if (!confirmDiscard || !await confirmDiscard(file, item.status === 'untracked')) return false
      if (item.status === 'untracked') {
        if (!trashItem) throw new Error('Lixeira indisponível.')
        await trashItem(path.resolve(directory, file))
      } else await run(['restore', '--worktree', '--', file])
      return true
    },
    async commit(message) {
      if (typeof message !== 'string' || !message.trim() || message.includes('\0')) throw new Error('Digite uma mensagem de commit.')
      for (const key of ['user.name', 'user.email']) {
        const value = (await run(['config', '--get', key]).catch(() => ({ stdout: '' }))).stdout.trim()
        if (!value) throw new Error('Configure user.name e user.email neste repositório antes do commit.')
      }
      const files = await status()
      if (files.some(file => file.conflict)) throw new Error('Resolva e prepare os arquivos em conflito antes do commit.')
      if (!files.some(file => file.staged)) throw new Error('Prepare pelo menos um arquivo usando + antes do commit.')
      // git commit includes the entire repository index, even from a subfolder.
      const { stdout: root } = await run(['rev-parse', '--show-toplevel'])
      const all = parseStatus((await run(['status', '--porcelain=v1', '-z'], { cwd: root.trim() })).stdout)
      const cwd = await fs.realpath(directory)
      if (all.some(file => file.staged && (!inside(cwd, path.join(root.trim(), file.path)) ||
          (file.oldPath && !inside(cwd, path.join(root.trim(), file.oldPath)))))) {
        throw new Error('Há arquivos preparados fora desta pasta. Abra a raiz do repositório para revisar e comitar.')
      }
      await run(['commit', '-m', message])
      return true
    },
    async config(key, value) {
      configKey(key)
      if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) throw new Error('Nome ou email inválido.')
      await run(['config', '--local', key, value.trim()]); return true
    },
    async getConfig(key) {
      configKey(key)
      try { return (await run(['config', '--get', key])).stdout.trim() } catch (error) { if (error.code === 1) return ''; throw error }
    },
    async init() { await run(['init']); return true },
    async pull() { const result = await run(['pull', '--ff-only']); return { success: true, message: result.stdout || result.stderr } },
    async push() {
      let args = ['push']
      const upstream = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => null)
      if (!upstream) {
        const remotes = (await run(['remote'])).stdout.split('\n').filter(Boolean)
        if (remotes.length !== 1) throw new Error('Configure um remoto único para publicar esta branch, ou configure seu upstream pelo terminal.')
        const branch = (await run(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim()
        args = ['push', '--set-upstream', remotes[0], branch]
      }
      const result = await run(args)
      return { success: true, message: result.stdout || result.stderr }
    },
    async getRemote() {
      const remotes = (await run(['remote'])).stdout.split('\n').filter(Boolean)
      if (!remotes.includes('origin')) return ''
      const value = (await run(['remote', 'get-url', 'origin'])).stdout.trim()
      // Never send embedded passwords/tokens to the renderer.
      if (/^https?:\/\//i.test(value)) {
        const parsed = new URL(value)
        if (parsed.username || parsed.password) return ''
      }
      return value
    },
    async setRemote(url) {
      if (typeof url !== 'string' || /[\s\0]/.test(url) ||
          !(/^(https:\/\/|ssh:\/\/)/i.test(url) || /^[\w.-]+@[\w.-]+:.+/.test(url))) {
        throw new Error('Use uma URL HTTPS ou SSH válida para o remoto origin.')
      }
      if (/^https:\/\//i.test(url)) {
        const parsed = new URL(url)
        if (!parsed.hostname || parsed.username || parsed.password) throw new Error('Use uma URL sem credenciais. Configure a autenticação pelo Git/SSH.')
      }
      const remotes = (await run(['remote'])).stdout.split('\n').filter(Boolean)
      await run(remotes.includes('origin') ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url])
      return true
    },
    async fetch() { const result = await run(['fetch']); return { success: true, message: result.stdout || result.stderr } },
    async branches() {
      const { stdout } = await run(['for-each-ref', '--format=%(HEAD)%00%(refname)%00%(symref)', 'refs/heads', 'refs/remotes'])
      return stdout.split('\n').filter(Boolean).map(line => {
        const [head, ref, symbolic] = line.split('\0')
        return { name: ref.replace(/^refs\/(heads|remotes)\//, ''), current: head === '*', remote: ref.startsWith('refs/remotes/'), symbolic }
      }).filter(branch => !branch.symbolic)
    },
    async createBranch(name) { branchName(name); await run(['check-ref-format', '--branch', name]); await run(['switch', '-c', name]); return true },
    async checkout(name) {
      branchName(name)
      const branches = await this.branches()
      const branch = branches.find(branch => branch.name === name && !branch.remote) || branches.find(branch => branch.name === name)
      if (!branch) throw new Error('Branch não encontrada. Atualize a lista.')
      await run(branch.remote ? ['switch', '--track', name] : ['switch', name]); return true
    },
    async deleteBranch(name) { branchName(name); await run(['branch', '-d', '--', name]); return true },
    async log(options = {}) {
      if (!await hasHead()) return []
      const limit = Math.min(100, Math.max(1, Math.trunc(Number(options.limit) || 20)))
      const skip = Math.max(0, Math.trunc(Number(options.skip) || 0))
      const { stdout } = await run(['log', '-z', '--format=%H%x00%an%x00%ae%x00%aI%x00%s', '--max-count=' + limit, '--skip=' + skip])
      const fields = stdout.split('\0'), commits = []
      for (let i = 0; i + 4 < fields.length; i += 5) {
        const [hash, author, email, date, subject] = fields.slice(i, i + 5)
        if (hash) commits.push({ hash, shortHash: hash.slice(0, 7), author, email, date, subject })
      }
      return commits
    },
    async diff(file, staged = false) {
      await resolveFile(file)
      const item = (await status()).find(entry => entry.path === file)
      if (!staged && item?.status === 'untracked') {
        const absolute = path.resolve(directory, file), info = await fs.lstat(absolute)
        if (info.isSymbolicLink()) return '+ ' + await fs.readlink(absolute)
        if (info.size > 1024 * 1024) return 'Arquivo novo maior que 1 MB. Abra o arquivo para revisar.'
        const buffer = await fs.readFile(absolute)
        if (buffer.includes(0)) return 'Arquivo binário novo: ' + file
        return '--- /dev/null\n+++ ' + file + '\n' + buffer.toString('utf8').split('\n').map(line => '+' + line).join('\n')
      }
      const paths = [file]
      if (item?.oldPath) { await resolveFile(item.oldPath); paths.push(item.oldPath) }
      return (await run(['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(staged ? ['--cached'] : []), '--', ...paths])).stdout
    }
  }
}

export function registerGitHandlers(ipcMain, assertWorkspaceSelected, dialog, shell) {
  const operations = ['serviceVersion', 'isRepository', 'status', 'currentBranch', 'stage', 'unstage', 'discard', 'commit', 'config',
    'getConfig', 'getRemote', 'setRemote', 'init', 'pull', 'push', 'fetch', 'branches', 'createBranch', 'checkout', 'deleteBranch', 'log', 'diff']
  const activeWrites = new Set()
  const writes = new Set(['stage', 'unstage', 'discard', 'commit', 'config', 'setRemote', 'init', 'pull', 'push', 'fetch', 'createBranch', 'checkout', 'deleteBranch'])
  for (const operation of operations) ipcMain.handle('git:' + operation, async (_event, ...args) => {
    const workspace = await fs.realpath(assertWorkspaceSelected())
    if (writes.has(operation) && activeWrites.has(workspace)) throw new Error('Aguarde a operação Git em andamento.')
    if (writes.has(operation)) activeWrites.add(workspace)
    try {
      const service = createGitService(workspace, {
        trashItem: file => shell.trashItem(file),
        confirmDiscard: async (file, untracked) => (await dialog.showMessageBox({
          type: 'warning', buttons: ['Cancelar', untracked ? 'Mover para a lixeira' : 'Descartar alterações'],
          defaultId: 0, cancelId: 0, message: file,
          detail: untracked ? 'O arquivo novo será movido para a lixeira.' : 'As alterações não preparadas serão perdidas. A versão no stage será preservada.'
        })).response === 1
      })
      return await service[operation](...args)
    } finally { if (writes.has(operation)) activeWrites.delete(workspace) }
  })
}
