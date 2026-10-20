// Host prerequisites, independent from game code and downloaded toolkits.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { adoptShellPath } from '../shellPath.js'
const exec = promisify(execFile)
let pathReady
const preparePath = () => pathReady ||= adoptShellPath()
export const ENVIRONMENT_PACKAGES = Object.freeze({ java:'openjdk-21-jre-headless', make:'make', node:'nodejs', npm:'npm', python3:'python3', pillow:'python3-pil', git:'git', sdl2:'libsdl2-2.0-0' })
const firstLine = text => String(text || '').trim().split(/\r?\n/)[0].slice(0,160)
export async function probeProgram(command, args, env = process.env) {
  try {
    const result = await exec(command, args, { env, timeout:10000, maxBuffer:65536, windowsHide:true })
    if (/^java(?:\.exe)?$/i.test(path.basename(command))) {
      return String(result.stdout+'\n'+result.stderr).split(/\r?\n/).find(line=>javaMajor(line)>0)?.trim().slice(0,160) || ''
    }
    return firstLine(result.stdout) || firstLine(result.stderr) || 'OK'
  } catch { return '' }
}
function toolEnvironment(toolkit) {
  return { ...process.env, PATH:[toolkit && path.join(toolkit,'bin'), toolkit && path.join(toolkit,'m68k-elf','bin'), process.env.PATH].filter(Boolean).join(path.delimiter) }
}
export function javaMajor(version) {
  const match = String(version).match(/(?:version\s+["']?|openjdk\s+)(\d+)(?:\.(\d+))?/i)
  return match ? Number(match[1] === '1' ? match[2] : match[1]) : 0
}
export async function inspectEnvironment({ toolkit, probe = probeProgram, prepare = preparePath, platform = process.platform } = {}) {
  await prepare()
  const env = toolEnvironment(toolkit)
  const checks = [ ['java',['-version']], ['make',['--version']], ['node',['--version']], ['npm',['--version']],
    ['python3',['--version']], ['pillow',['-c','import PIL; print(PIL.__version__)']], ['git',['--version']] ]
  if (platform === 'linux') checks.push(['sdl2',['-c',"import ctypes; ctypes.CDLL('libSDL2-2.0.so.0'); print('SDL2')"]])
  const items = await Promise.all(checks.map(async ([id,args]) => {
    const command = ['pillow','sdl2'].includes(id) ? 'python3' : id === 'make' && platform === 'win32' && toolkit ? path.join(toolkit,'bin','make.exe') : id
    // npm.cmd is not directly executable with execFile on Windows. Query the
    // fixed command through cmd, never interpolate renderer input.
    const version = id === 'npm' && platform === 'win32'
      ? await probe('cmd.exe',['/d','/s','/c','npm --version'],env) : await probe(command,args,env)
    const ok = !!version && (id !== 'java' || javaMajor(version) >= 17) && (id !== 'node' || Number(version.match(/v?(\d+)/)?.[1]) >= 18)
    return { id, ok, version }
  }))
  return { ready:items.every(item=>item.ok), items, platform }
}
/** A fixed package list only. No paths, commands or package names from IPC. */
export function environmentInstallPlan(status, { platform = process.platform, exists = fs.existsSync } = {}) {
  const debian = platform === 'linux' && exists('/etc/debian_version') && exists('/usr/bin/apt-get')
  const supported = debian && exists('/usr/bin/pkexec')
  const packages = [...new Set(status.items.filter(item=>!item.ok).map(item=>ENVIRONMENT_PACKAGES[item.id]).filter(Boolean))]
  return { supported, packages, command: debian && packages.length ? `sudo apt-get install ${packages.join(' ')}` : '' }
}
let installation = null
export async function installEnvironment({ inspect = inspectEnvironment, plan = environmentInstallPlan, execute = exec, toolkit } = {}) {
  if (installation) throw new Error('environmentBusy')
  // Set the lock before the first await, including the initial inspection.
  installation = (async () => {
    const before = await inspect({ toolkit }), install = plan(before)
    if (before.ready) return before
    if (!install.supported) throw new Error('environmentManual')
    // Rebuild from known IDs; even a test/injected plan cannot supply arguments.
    const packages = before.items.filter(item=>!item.ok).map(item=>ENVIRONMENT_PACKAGES[item.id]).filter(Boolean)
    if (!packages.length) return before
    try {
      await execute('/usr/bin/pkexec',['/usr/bin/apt-get','install','-y','--',...new Set(packages)],{ timeout:15*60*1000,maxBuffer:2*1024*1024,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin'} })
    } catch (error) {
      if (error.code === 126 || error.code === 127) throw new Error('environmentCancelled')
      throw new Error('environmentInstallFailed')
    }
    return inspect({ toolkit })
  })()
  try { return await installation } finally { installation = null }
}
/** Check the SGDK tools before make, including generators declared by the project. */
export async function checkBuildEnvironment(toolkit, { projectPath, probe = probeProgram, prepare = preparePath } = {}) {
  const usesJava = [toolkit,path.join(toolkit,'m68k-elf')].some(root=>fs.existsSync(path.join(root,'bin','rescomp.jar')))
  if (!usesJava) return null
  await prepare()
  const required = new Set(['java','make'])
  for (const filename of ['Makefile','makefile']) {
    try {
      const file=path.join(projectPath || '',filename)
      if (!projectPath || fs.statSync(file).size > 256*1024) continue
      const text=fs.readFileSync(file,'utf8')
      if (/\bnode\b|\.mjs\b/.test(text)) required.add('node')
      if (/\bpython3?\b|\.py\b/.test(text)) { required.add('python3');required.add('pillow') }
    } catch { /* toolkit-only projects have no local Makefile */ }
  }
  const status = await inspectEnvironment({ toolkit, probe, prepare:async()=>{} })
  const missing = status.items.filter(item=>required.has(item.id)&&!item.ok).map(item=>item.id)
  if (!missing.length) return null
  const names={java:'Java 17 ou superior',make:'GNU Make',node:'Node.js 18 ou superior',python3:'Python 3',pillow:'Pillow para Python'}
  return { scope:'environment', code:missing.includes('java')?'java-missing':'prerequisites-missing', missing,
    message:'O ambiente precisa de: '+missing.map(id=>names[id]).join(', ')+'. Abra Configurações → Toolkit → Preparar ambiente. Nenhum arquivo do projeto foi alterado.' }
}
