// A IDE aberta pelo menu do sistema recupera o PATH do shell (asdf, nvm, npm global)
// para achar os agentes ACP. Sem depender do shell real da máquina.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readShellPath, knownBinDirs, mergePath, adoptShellPath } from '../electron/shellPath.js'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-shell-path-'))
try {
  const home = path.join(temporary, 'home')
  const shims = path.join(home, '.asdf', 'shims')
  const nvmOld = path.join(home, '.nvm', 'versions', 'node', 'v18.20.0', 'bin')
  const nvmNew = path.join(home, '.nvm', 'versions', 'node', 'v22.3.0', 'bin')
  const fromShell = path.join(temporary, 'shell-bin')
  for (const dir of [shims, nvmOld, nvmNew, fromShell]) fs.mkdirSync(dir, { recursive: true })
  // Shell falso: imprime lixo de inicialização antes do PATH marcado, como um .zshrc barulhento.
  const fakeShell = path.join(temporary, 'fake-shell')
  fs.writeFileSync(fakeShell, `#!/bin/sh\necho "bem-vindo"\nPATH="${fromShell}:/bin" sh -c "$2"\n`, { mode: 0o755 })
  assert.equal(await readShellPath({ shell: fakeShell }), `${fromShell}:/bin`)
  assert.equal(await readShellPath({ shell: path.join(temporary, 'nao-existe') }), '', 'a missing shell is not fatal')

  assert.ok(knownBinDirs(home).includes(shims))
  assert.ok(knownBinDirs(home).includes(nvmNew) && !knownBinDirs(home).includes(nvmOld), 'the newest nvm version wins')
  assert.equal(mergePath(`/bin:${fromShell}`, `${fromShell}:/sem/pasta:/bin`), `/bin:${fromShell}`, 'no duplicates or missing folders')

  const original = process.env.PATH
  try {
    process.env.PATH = '/bin'
    await adoptShellPath({ shell: fakeShell, home })
    const parts = process.env.PATH.split(path.delimiter)
    assert.deepEqual(parts.slice(0, 2), ['/bin', fromShell], 'the inherited PATH keeps priority, the shell PATH follows')
    assert.ok(parts.includes(shims) && parts.includes(nvmNew), 'known install folders are added')
    process.env.PATH = '/bin'
    await adoptShellPath({ shell: path.join(temporary, 'nao-existe'), home })
    assert.ok(process.env.PATH.split(path.delimiter).includes(shims), 'without a usable shell the known folders still help')
  } finally { process.env.PATH = original }
  console.log('Shell PATH: shell login output, noisy startup, missing shell, known install folders and merge order passed.')
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
