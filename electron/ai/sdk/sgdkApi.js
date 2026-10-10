/**
 * Local SDK context. Prototypes come from the configured SDK headers rather
 * than a hand-maintained list which can mix incompatible SGDK versions.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getToolkitPathFromSettings, resolveGdkIncDir } from '../../retro/compileFlags.js'
import { assessRuntimeSupport } from '../../../shared/retro/projectContract.js'

function readSmallFile(file, maxBytes = 256 * 1024, allowedRoot = null) {
  try {
    const real = fs.realpathSync(file)
    if (allowedRoot) {
      const root = fs.realpathSync(allowedRoot)
      const relative = path.relative(root, real)
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return ''
    }
    const stat = fs.statSync(real)
    if (!stat.isFile() || stat.size > maxBytes) return ''
    return fs.readFileSync(real, 'utf8')
  } catch { return '' }
}
export function isSgdkProject(workspacePath) {
  if (!workspacePath || typeof workspacePath !== 'string') return false
  try {
    const text = readSmallFile(path.join(workspacePath, 'retro-studio.json'), 128 * 1024, workspacePath)
    if (text) {
      const config = JSON.parse(text)
      if (config.retroStudio?.target?.sdk) return config.retroStudio.target.sdk === 'sgdk'
      if (['sgdk-skeleton', 'hello-world-sgdk', 'sgdk-stage9-sample'].includes(config.template)) return true
    }
    return fs.existsSync(path.join(workspacePath, 'makefile.gen')) || fs.existsSync(path.join(workspacePath, 'res'))
  } catch { return false }
}
// SGDK 2.x keeps the sound drivers in inc/snd/.
const HEADERS = ['sys.h', 'vdp.h', 'vdp_bg.h', 'vdp_tile.h', 'sprite_eng.h', 'pal.h', 'joy.h', 'map.h', 'dma.h', 'xgm.h', 'xgm2.h', 'snd/xgm.h', 'snd/xgm2.h']
const SYMBOLS = [
  'SYS_doVBlankProcess', 'VDP_setPlaneSize', 'VDP_loadTileSet',
  'VDP_setTileMapXY', 'VDP_setHorizontalScroll', 'VDP_setVerticalScroll',
  'SPR_initEx', 'SPR_addSprite', 'SPR_setPosition', 'SPR_setAnim',
  'SPR_setFrameChangeCallback', 'SPR_update', 'SPR_getNumActiveSprite',
  'PAL_setColor', 'PAL_setPalette', 'JOY_readJoypad', 'MAP_create',
  'MAP_scrollTo', 'DMA_getQueueTransferSize', 'XGM_startPlay', 'XGM2_play'
]
function declarations(includeDirectory) {
  if (!includeDirectory || !fs.existsSync(path.join(includeDirectory, 'genesis.h'))) return []
  const source = HEADERS.map(header => readSmallFile(path.join(includeDirectory, header), 256 * 1024, includeDirectory))
    .join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const result = []
  for (const symbol of SYMBOLS) {
    // Only complete ordinary declarations, never function bodies or comments.
    const expression = new RegExp('(?:^|\\n)\\s*([\\w *]+\\b' + symbol + '\\s*\\([^;{}]*\\)\\s*;)', 'm')
    const match = source.match(expression)
    if (match) result.push(match[1].replace(/\s+/g, ' ').trim())
  }
  return result
}
const MODULE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
/** Installed runtime modules: only id/version leave the record.
 * null = no record; { unreadable } = a record exists but cannot be trusted. */
function runtimeModules(root) {
  const file = path.join(root, '.retrostudio', 'runtime-installation.json')
  try { fs.lstatSync(file) } catch (error) { return error.code === 'ENOENT' ? null : { unreadable: true } }
  try {
    const record = JSON.parse(readSmallFile(file, 1024 * 1024, root))
    if (!Array.isArray(record.modules)) return { unreadable: true }
    const valid = record.modules.filter(module => MODULE_ID.test(module?.id) && Number.isInteger(module.version) && module.version > 0 && module.version < 100000)
    return { names: valid.slice(0, 32).map(module => module.id + ' v' + module.version), ignored: record.modules.length - Math.min(valid.length, 32) }
  } catch { return { unreadable: true } }
}
const insideRoot = (root, file) => {
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
/** Build receipt written by the IDE: date, ROM size and a cheap date/size hint, never contents.
 * Nothing is claimed that the files on disk do not confirm. */
function buildReceipt(root) {
  try {
    const receipt = JSON.parse(readSmallFile(path.join(root, '.retro-studio', 'builds', 'latest.json'), 1024 * 1024, root))
    const finished = Date.parse(receipt.finishedAt)
    // A date in the future would make every input look older than the build.
    if (receipt.version !== 1 || receipt.producer !== 'retro-studio-build' || !Number.isFinite(finished) || finished > Date.now() + 5 * 60000 ||
        !Array.isArray(receipt.inputs) || receipt.inputs.length > 4096 || !Array.isArray(receipt.outputs) || receipt.outputs.length > 4) return null
    const stat = relative => {
      if (typeof relative !== 'string' || relative.length > 2048) throw new Error('invalid')
      const file = path.resolve(root, relative)
      if (!insideRoot(root, file)) throw new Error('invalid')
      return fs.lstatSync(file) // links are never followed out of the project
    }
    let changed = 0
    for (const item of receipt.inputs) {
      let info
      try { info = stat(item?.path) } catch (error) { if (error.message === 'invalid') return null; changed++; continue }
      if (!info.isFile() || info.size !== item.size || info.mtimeMs > finished) changed++
    }
    // The ROM size is reported only while the recorded ROM is still the file on disk.
    let romBytes = null
    const rom = receipt.outputs.find(item => typeof item?.path === 'string' && /\.bin$/.test(item.path) && Number.isSafeInteger(item.size) && item.size > 0)
    if (rom) try { const info = stat(rom.path); if (info.isFile() && info.size === rom.size && info.mtimeMs <= finished + 5 * 60000) romBytes = rom.size } catch (error) { if (error.message === 'invalid') return null }
    return { at: new Date(finished).toISOString(), romBytes, changed, inputs: receipt.inputs.length, unstable: receipt.inputStability !== 'unchanged-between-observations' }
  } catch { return null }
}
export function getSdkApiBlock({ workspacePath = '', toolkitPath = undefined } = {}) {
  const root = workspacePath || null
  const includeDirectory = resolveGdkIncDir(toolkitPath === undefined ? getToolkitPathFromSettings() : toolkitPath)
  const genesis = includeDirectory ? readSmallFile(path.join(includeDirectory, 'genesis.h'), 256 * 1024, includeDirectory) : ''
  const version = genesis.match(/^\s*#define\s+SGDK_VERSION\s+([\d.]+)/m)?.[1] || 'não identificada'
  const lines = [
    'SDK configurado: SGDK ' + version + '. Headers do toolkit configurado; confira o Makefile se ele seleciona outro SDK.',
    'Confira assinaturas nos headers locais; não invente APIs nem use XGM2 se ausente neste SDK.',
    'Prévia de editor, recursos exportados e execução na ROM são etapas distintas.',
    'Natureza dos números: dimensões de imagem e orçamentos são ESTIMATIVA; tamanhos lidos do ELF/ROM são DADO COMPILADO; quadros por segundo, sprites por linha, fila de DMA e VRAM em uso só valem como MEDIÇÃO feita na ROM em execução. Diga qual dos três está citando.'
  ]
  if (root) {
    const text = readSmallFile(path.join(root, 'retro-studio.json'), 128 * 1024, root)
    try {
      const config = text ? JSON.parse(text) : {}
      const report = assessRuntimeSupport(config)
      if (!report.valid) lines.push('Contrato do projeto inválido; capacidades não verificadas.')
      else if (!report.declared) lines.push('Projeto legado: capacidades de execução não declaradas; preserve seu adaptador.')
      else {
        const target = config.retroStudio.target
        lines.push(`Alvo declarado: ${target.platform}/${target.sdk}, ${target.videoMode}, ${target.region}.`)
        lines.push('Adaptador: ' + report.adapter + '; capacidades: ' + config.retroStudio.adapter.capabilities.join(', ') + '.')
      }
      lines.push('Recursos cadastrados: ' + (Array.isArray(config.assets) ? config.assets.length : 0) + '; catálogo não mede consumo simultâneo de VRAM.')
    } catch { lines.push('Configuração de projeto ilegível; não inferir capacidades.') }
    const modules = runtimeModules(root)
    lines.push(modules === null
      ? 'Sem registro de instalação de módulos de runtime do Retro Studio: não presuma funções retro*; confira src/retro_runtime antes de usá-las.'
      : modules.unreadable ? 'Registro de módulos de runtime ilegível: confira src/retro_runtime antes de afirmar o que está instalado.'
      : !modules.names.length && !modules.ignored ? 'Registro de runtime sem módulos instalados: não use funções retro*.'
      : 'Módulos de runtime instalados (src/retro_runtime): ' + (modules.names.join(', ') || 'nenhum legível') +
        (modules.ignored ? '; ' + modules.ignored + ' entrada(s) do registro não listada(s): confira src/retro_runtime.' : '. Só eles constam no registro; não use nem prometa funções retro* de módulos ausentes.'))
    const receipt = buildReceipt(root)
    lines.push(receipt
      ? 'Último build registrado pela IDE: ' + receipt.at + (receipt.romBytes === null ? '' : ', ROM de ' + receipt.romBytes + ' bytes (dado compilado)') + '. ' +
        (receipt.romBytes === null ? 'A ROM registrada não está mais no disco com o mesmo tamanho. ' : '') +
        (!receipt.inputs ? 'O recibo não lista entradas: não há como dizer se as fontes mudaram.'
          : receipt.changed ? receipt.changed + ' arquivo(s) de entrada com data ou tamanho diferentes desde então: a ROM pode estar desatualizada.'
          : receipt.unstable ? 'Entradas mudaram durante aquele build: a ROM pode não corresponder às fontes.'
          : 'Nenhuma entrada padrão com data ou tamanho diferentes desde então (indício, não prova de dependências).')
      : 'Sem registro de build da IDE: não afirme que o projeto compila sem executar o build.')
    // Whitelist scalar build fields; never put logs/settings/env in a prompt.
    const buildText = readSmallFile(path.join(root, '.retrostudio', 'last-acp-build.json'), 128 * 1024, root)
    try {
      const result = JSON.parse(buildText)
      if (typeof result.success === 'boolean' && ['build', 'play'].includes(result.action)) {
        const at = Number.isSafeInteger(result.at) && result.at > 0 && result.at < 8640000000000000
          ? new Date(result.at).toISOString() : 'data desconhecida'
        lines.push(`Último registro ACP (${result.action}, ${at}): ${result.success ? 'sucesso' : 'falha'}. Não comprova que as fontes atuais foram recompiladas.`)
      }
    } catch {}
  }
  const prototypes = declarations(includeDirectory)
  lines.push(prototypes.length ? 'Declarações verificadas nos headers locais:' : 'Headers locais indisponíveis: leia a documentação da versão do projeto antes de sugerir chamadas.')
  let body = lines.join('\n')
  for (const [index, prototype] of prototypes.entries()) {
    if (body.length + prototype.length + 1 > 3500) { body += '\n(' + (prototypes.length - index) + ' declarações omitidas por limite de tamanho: consulte os headers.)'; break }
    body += '\n' + prototype
  }
  return '\n\n--- SDK e integração do projeto ---\n' + body + '\n--- FIM SDK ---'
}
