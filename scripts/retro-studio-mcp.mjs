#!/usr/bin/env node
/**
 * MCP stdio mínimo para o agente OpenCode ACP (sem dependência do Electron).
 * Tools: build_rom, run_emulator
 *
 * Env:
 *   RETRO_WORKSPACE   — projeto (obrigatório)
 *   RETRO_TOOLKIT     — SGDK/MarsDev root (recomendado)
 *   RETRO_EMULATOR    — path do emulador (opcional)
 *   RETRO_RESULT_FILE — JSON do último resultado para a IDE
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const workspace = path.resolve(process.env.RETRO_WORKSPACE || process.cwd())
const toolkitEnv = process.env.RETRO_TOOLKIT || ''
const emulatorEnv = process.env.RETRO_EMULATOR || ''
const resultFile = process.env.RETRO_RESULT_FILE || ''

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function respond(id, result) {
  write({ jsonrpc: '2.0', id, result })
}

function respondError(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

function saveResult(payload) {
  if (!resultFile) return
  try {
    fs.mkdirSync(path.dirname(resultFile), { recursive: true })
    fs.writeFileSync(resultFile, JSON.stringify({ ...payload, at: Date.now() }, null, 2))
  } catch {
    /* ignore */
  }
}

function resolveToolkit() {
  if (toolkitEnv && fs.existsSync(toolkitEnv)) return toolkitEnv
  try {
    const uiPath = path.join(os.homedir(), '.retrostudio', 'ui-settings.json')
    if (fs.existsSync(uiPath)) {
      const ui = JSON.parse(fs.readFileSync(uiPath, 'utf8'))
      if (ui.toolkitPath && fs.existsSync(ui.toolkitPath)) return ui.toolkitPath
    }
  } catch {
    /* ignore */
  }
  return null
}

function findRom(projectPath) {
  const candidates = [
    path.join(projectPath, 'out', 'rom.bin'),
    path.join(projectPath, 'out', 'rom.gen'),
    path.join(projectPath, 'rom.bin'),
    path.join(projectPath, 'build', 'rom.bin')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  // fallback: first .bin under out/
  const outDir = path.join(projectPath, 'out')
  if (fs.existsSync(outDir)) {
    try {
      const hit = fs.readdirSync(outDir).find((f) => /\.(bin|gen|md)$/i.test(f))
      if (hit) return path.join(outDir, hit)
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Parser leve de erros gcc/make (espelha errorParser.js). */
function parseErrors(output) {
  const errors = []
  const re = /^(.+?):(\d+)(?::(\d+))?:\s*(?:fatal )?error:\s*(.+)$/gim
  let m
  while ((m = re.exec(String(output || ''))) && errors.length < 50) {
    errors.push({
      file: m[1],
      line: Number(m[2]),
      column: m[3] ? Number(m[3]) : 1,
      message: m[4].trim(),
      type: 'error'
    })
  }
  return errors
}

function runBuild({ clean = false } = {}) {
  const tkPath = resolveToolkit()
  if (!tkPath) {
    return Promise.resolve({ success: false, error: 'Toolkit path inválido ou não configurado (RETRO_TOOLKIT).' })
  }
  if (!fs.existsSync(workspace)) {
    return Promise.resolve({ success: false, error: 'Projeto inválido.' })
  }

  const isWin = process.platform === 'win32'
  const isSgdk = tkPath.toLowerCase().includes('sgdk') ||
    fs.existsSync(path.join(tkPath, 'makefile.gen')) ||
    fs.existsSync(path.join(tkPath, 'm68k-elf', 'makefile.gen'))

  let spawnCmd = ''
  let spawnArgs = []
  const spawnEnv = { ...process.env }

  if (isSgdk) {
    if (isWin) {
      const makePath = fs.existsSync(path.join(tkPath, 'bin', 'make.exe'))
        ? path.join(tkPath, 'bin', 'make.exe')
        : path.join(tkPath, 'bin', 'make')
      const makefileGen = path.join(tkPath, 'makefile.gen')
      const makeCmd = `"${makePath}" -f "${makefileGen}"`
      const buildCommand = clean ? `${makeCmd} clean && ${makeCmd}` : makeCmd
      spawnCmd = 'cmd.exe'
      spawnArgs = ['/c', `cd /d "${workspace}" && ${buildCommand}`]
      spawnEnv.GDK = tkPath
      spawnEnv.PATH = `${path.join(tkPath, 'bin')};${spawnEnv.PATH}`
    } else {
      const gdkPath = path.join(tkPath, 'm68k-elf')
      const makefileGen = path.join(gdkPath, 'makefile.gen')
      const makeCmd = `make -f "${makefileGen}"`
      const body = clean ? `${makeCmd} clean && ${makeCmd}` : makeCmd
      spawnCmd = 'sh'
      spawnArgs = ['-c', `cd "${workspace}" && GDK="${gdkPath}" ${body}`]
    }
  } else {
    const gdkPath = path.join(tkPath, 'm68k-elf')
    const buildCmd = clean ? 'make clean && make' : 'make'
    if (isWin) {
      spawnCmd = 'cmd.exe'
      spawnArgs = ['/c', `cd /d "${workspace}" && set MARSDEV=${tkPath}&& set GDK=${gdkPath}&& ${buildCmd}`]
    } else {
      spawnCmd = 'sh'
      spawnArgs = ['-c', `cd "${workspace}" && MARSDEV="${tkPath}" GDK="${gdkPath}" ${buildCmd}`]
    }
  }

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const proc = spawn(spawnCmd, spawnArgs, { cwd: workspace, env: spawnEnv })
    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      const output = stdout + stderr
      const errors = parseErrors(output)
      if (code !== 0) {
        resolve({ success: false, exitCode: code, stdout, stderr: output, errors })
        return
      }
      resolve({
        success: true,
        romPath: findRom(workspace),
        exitCode: 0,
        stdout,
        stderr: output,
        errors
      })
    })
    proc.on('error', (err) => resolve({ success: false, error: err.message }))
  })
}

function runEmulator(romPath) {
  let rom = romPath || findRom(workspace)
  if (!rom || !fs.existsSync(rom)) {
    return Promise.resolve({ success: false, message: 'ROM não encontrada. Execute build_rom primeiro.' })
  }
  let emu = emulatorEnv
  if (!emu) {
    try {
      const cfgPath = path.join(os.homedir(), '.retrostudio', 'emulator-config.json')
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
        emu = cfg.emulatorPath || cfg.path || ''
      }
    } catch {
      /* ignore */
    }
  }
  if (!emu || !fs.existsSync(emu)) {
    return Promise.resolve({ success: false, message: 'Emulador não encontrado (RETRO_EMULATOR).' })
  }
  return new Promise((resolve) => {
    try {
      const proc = spawn(emu, [rom], { cwd: path.dirname(rom), stdio: 'ignore' })
      proc.on('error', (err) => resolve({ success: false, message: err.message }))
      proc.unref()
      resolve({ success: true, message: `Emulador iniciado com ${path.basename(rom)}`, romPath: rom })
    } catch (e) {
      resolve({ success: false, message: e.message })
    }
  })
}

const TOOLS = [
  {
    name: 'build_rom',
    description: 'Build the current Retro Studio / SGDK project via toolkit make. Returns ROM path or compilation errors.',
    inputSchema: {
      type: 'object',
      properties: {
        clean: { type: 'boolean', description: 'Run make clean before build' }
      }
    }
  },
  {
    name: 'run_emulator',
    description: 'Run the built ROM in the configured emulator. Builds first if ROM is missing.',
    inputSchema: {
      type: 'object',
      properties: {
        romPath: { type: 'string', description: 'Optional absolute ROM path' }
      }
    }
  }
]

async function callTool(name, args = {}) {
  if (name === 'build_rom') {
    const result = await runBuild({ clean: !!args.clean })
    saveResult({ action: 'build', ...result })
    if (result.success) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: true, romPath: result.romPath || null, exitCode: result.exitCode }, null, 2)
        }]
      }
    }
    return {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: false,
          error: result.error || 'Build failed',
          exitCode: result.exitCode,
          errors: (result.errors || []).slice(0, 40),
          stderrTail: String(result.stderr || '').slice(-4000)
        }, null, 2)
      }]
    }
  }

  if (name === 'run_emulator') {
    let rom = args.romPath || null
    if (!rom) {
      const built = await runBuild({ clean: false })
      saveResult({ action: 'build', ...built })
      if (!built.success) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: 'Build before play failed',
              errors: built.errors || [],
              detail: built.error || built.stderr
            }, null, 2)
          }]
        }
      }
      rom = built.romPath
    }
    const result = await runEmulator(rom)
    saveResult({ action: 'play', ...result, romPath: rom })
    return {
      isError: !result.success,
      content: [{ type: 'text', text: JSON.stringify({ ok: !!result.success, ...result }, null, 2) }]
    }
  }

  throw new Error(`Unknown tool: ${name}`)
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return
  const { id, method, params } = msg

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'retro-studio', version: '0.8.0' }
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'initialized') return
  if (method === 'tools/list') {
    respond(id, { tools: TOOLS })
    return
  }
  if (method === 'tools/call') {
    try {
      respond(id, await callTool(params?.name, params?.arguments || {}))
    } catch (e) {
      respondError(id, -32000, e?.message || String(e))
    }
    return
  }
  if (method === 'ping') {
    respond(id, {})
    return
  }
  if (id != null) respondError(id, -32601, `Method not found: ${method}`)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    try {
      const msg = JSON.parse(line)
      handleMessage(msg).catch((e) => {
        if (msg?.id != null) respondError(msg.id, -32000, e?.message || String(e))
      })
    } catch {
      /* ignore */
    }
  }
})
process.stdin.on('end', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
