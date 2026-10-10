// #43: toda sugestão do editor (autocompletar, snippets, ajuda) e todo nome de API citado nos
// prompts da IA precisa existir nos headers do SGDK. O índice versionado guarda, para cada nome
// usado, em quais versões ele existe e quantos parâmetros recebe; ele é gerado dos headers reais:
//   node scripts/smoke-sdk-suggestions.mjs --update --sdk <inc do 1.81> --sdk <inc do 2.00>
// Com --sdk e sem --update, o teste confere o índice contra os headers informados.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as catalog from '../src/utils/retro/sgdkAutocomplete.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const indexFile = path.join(root, 'scripts', 'data', 'sgdk-symbol-index.json')
const args = process.argv.slice(2), sdkDirectories = []
for (let i = 0; i < args.length; i++) if (args[i] === '--sdk') sdkDirectories.push(args[++i])
const update = args.includes('--update')
const PREFIXED = /\b(?:VDP|SPR|JOY|SYS|PAL|XGM2?|SND|MAP|DMA|MEM|PSG|YM2612|Z80|SRAM|BMP|TSK|KDebug|KLog|VRAM)_[A-Za-z0-9_]+\b/g
// Palavras da linguagem C aceitas na lista de palavras-chave; não são símbolos do SGDK.
const LANGUAGE = new Set(['include', 'volatile', 'static', 'extern', 'const', 'typedef', 'struct', 'union', 'enum'])
const TEXT_SOURCES = ['src/utils/retro/sgdkSnippets.js', 'src/utils/retro/sgdkDocsData.js', 'src/utils/retro/sgdkAutocomplete.js', 'src/utils/retro/sgdkHoverProvider.js',
  'electron/ai/agent.js', 'electron/ai/sdk/sgdkApi.js']

// Chamadas NOME(...) em um texto, com a quantidade de argumentos de primeiro nível.
function calls(source, name) {
  // Strings e comentários não contam vírgulas nem parênteses.
  const text = source.replace(/"(?:[^"\\\n]|\\.)*"/g, match => '"' + 'x'.repeat(match.length - 2) + '"').replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length))
  const found = [], pattern = new RegExp('\\b' + name + '\\s*\\(', 'g')
  for (let match; (match = pattern.exec(text));) {
    let depth = 1, commas = 0, empty = true, i = pattern.lastIndex
    for (; i < text.length && depth; i++) {
      const c = text[i]
      if (c === '(' || c === '{' || c === '[') depth++
      else if (c === ')' || c === '}' || c === ']') depth--
      else if (c === ',' && depth === 1) commas++
      if (depth && !/\s/.test(c)) empty = false
    }
    if (!depth) found.push({ count: empty ? 0 : commas + 1, text: source.slice(match.index, i) })
  }
  return found
}
const used = new Map() // nome -> [{ source, count|null, sdk2, returns|null }]
const use = (name, source, count = null, sdk2 = false, returns = null) => { if (!used.has(name)) used.set(name, []); used.get(name).push({ source, count, sdk2, returns }) }
for (const item of catalog.sgdkSystemFunctions) {
  assert.ok(item.snippet.startsWith(item.name + '('), 'snippet de ' + item.name + ' não chama a própria função')
  const call = calls(item.snippet, item.name)[0]
  use(item.name, 'autocompletar', call.count === 1 && /^\w+\(\$\{1:\}\)/.test(item.snippet) ? 0 : call.count, /SGDK 2\.x/.test(item.description), item.returns)
}
for (const key of ['sgdkTypes', 'sgdkStructs', 'sgdkConstants']) for (const item of catalog[key])
  use(item.name, key, calls(String(item.value || ''), item.name)[0]?.count ?? null)
for (const keyword of catalog.sgdkKeywords) if (!LANGUAGE.has(keyword)) use(keyword, 'sgdkKeywords')
const names = list => list.map(item => item.name)
for (const key of ['sgdkSystemFunctions', 'sgdkTypes', 'sgdkStructs', 'sgdkConstants'])
  assert.equal(new Set(names(catalog[key])).size, catalog[key].length, key + ' tem nomes repetidos: ' + names(catalog[key]).filter((n, i, a) => a.indexOf(n) !== i))
const texts = Object.fromEntries(TEXT_SOURCES.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]))
// Exemplos de nomes proibidos escritos de propósito (mensagens que dizem o que não usar).
const DISCOURAGED = { 'electron/ai/sdk/sgdkApi.js': new Set(['XGM2_play']) }
const sdk2Names = new Set(catalog.sgdkSystemFunctions.filter(item => /SGDK 2\.x/.test(item.description)).map(item => item.name))
for (const [file, text] of Object.entries(texts)) {
  for (const name of new Set(text.match(PREFIXED) || [])) {
    if (file === 'src/utils/retro/sgdkAutocomplete.js') continue // já coberto pelo catálogo
    // Na ajuda, NOME() em texto corrido é só uma menção; protótipos e exemplos têm argumentos.
    const found = calls(text, name).filter(call => call.count || file !== 'src/utils/retro/sgdkDocsData.js')
    if (!found.length) use(name, file, null, DISCOURAGED[file]?.has(name) || false)
    for (const call of found) use(name, file, /\b(?:void|u8|u16|u32|s16|s32|bool)\s*$/.test(text.slice(0, text.indexOf(call.text)).slice(-8)) ? null : call.count, DISCOURAGED[file]?.has(name) || false)
  }
}
// Documentação de hover: cada chave é um símbolo e a lista de parâmetros acompanha o header.
const hover = texts['src/utils/retro/sgdkHoverProvider.js'].split('export const sgdkHoverProvider')[0]
const hoverEntries = [...hover.matchAll(/\n  '(\w+)': \{([\s\S]*?)\n  \}/g)]
assert.ok(hoverEntries.length > 10, 'documentação de hover não reconhecida')
for (const [, name, body] of hoverEntries) {
  use(name, 'hover', /params: \[/.test(body) ? (body.split('params: [')[1].match(/\{ name:/g) || []).length : null, false, body.match(/returns: '([^']*)'/)?.[1] ?? null)
  for (const call of calls(body.match(/example: '([^\n]*)',?\n/)?.[1] || '', name)) use(name, 'hover (exemplo)', call.count)
}
// Snippets: toda função chamada existe no SDK ou é definida no próprio snippet (ou é do jogo, na lista abaixo).
const C_WORDS = new Set(['if', 'while', 'for', 'switch', 'return', 'sizeof', 'main', 'defined'])
// Funções que o snippet deixa para o jogo escrever; nomes de exemplo, não APIs.
const GAME_FUNCTIONS = new Set(['updateGame', 'handleCollision', 'updateMenu', 'updateGameplay', 'updatePause', 'updateGameover', 'resetLevel'])
const snippetBodies = [...texts['src/utils/retro/sgdkSnippets.js'].matchAll(/insertText: `([\s\S]*?)`,\n/g)].map(match => match[1])
assert.ok(snippetBodies.length > 20, 'snippets não reconhecidos')
for (const body of snippetBodies) {
  const code = body.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/\/\/[^\n]*/g, '')
  const defined = new Set([...code.matchAll(/\b(\w+)\s*\([^;{}()]*\)\s*\{/g), ...code.matchAll(/#define\s+(\w+)\(/g)].map(match => match[1]))
  for (const [, name] of code.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    if (C_WORDS.has(name) || defined.has(name) || GAME_FUNCTIONS.has(name) || name.match(PREFIXED)) continue
    for (const call of calls(code, name)) use(name, 'snippet', call.count)
  }
}
// Nomes sem prefixo (fix16Mul, intToStr...) usados em snippets: confere os que o catálogo conhece.
for (const item of catalog.sgdkSystemFunctions) {
  if (item.name.match(PREFIXED)) continue
  for (const file of ['src/utils/retro/sgdkSnippets.js', 'src/utils/retro/sgdkDocsData.js'])
    for (const call of calls(texts[file], item.name)) use(item.name, file, call.count, sdk2Names.has(item.name))
}

function readHeaders(directory) {
  const parts = []
  const walk = current => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const file = path.join(current, entry.name)
    if (entry.isDirectory()) walk(file); else if (entry.name.endsWith('.h')) parts.push(fs.readFileSync(file, 'utf8'))
  } }
  walk(directory)
  const text = parts.join('\n'), version = text.match(/^\s*#define\s+SGDK_VERSION\s+([\d.]+)/m)?.[1]
  assert.ok(version, 'genesis.h sem SGDK_VERSION em ' + directory)
  return { version, text: text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '') }
}
function describe(header, name) {
  if (!new RegExp('\\b' + name + '\\b').test(header.text)) return null
  if (new RegExp('#define\\s+' + name + '\\b[^\\n]*_Pragma').test(header.text)) return null // nome aposentado: erro ou chamada sem efeito
  const macro = header.text.match(new RegExp('#define\\s+' + name + '\\(([^)]*)\\)'))
  const declaration = header.text.match(new RegExp('(?:^|\\n)[ \\t]*([\\w *]*?)\\b' + name + '\\s*\\(([^;{}()]*)\\)\\s*;'))
  const list = macro?.[1] ?? declaration?.[2]
  if (list === undefined) return { params: null }
  const params = /^\s*(?:void)?\s*$/.test(list) ? 0 : list.split(',').length
  const returns = macro ? null : declaration[1].replace(/\b(?:extern|static|inline)\b/g, '').replace(/\s+/g, ' ').replace(/ \*/g, '*').trim() || null
  return returns ? { params, returns } : { params }
}
let index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { symbols: {} }
if (sdkDirectories.length) {
  const headers = sdkDirectories.map(readHeaders), fresh = {}
  for (const name of [...used.keys()].sort()) {
    const entry = {}
    for (const header of headers) { const found = describe(header, name); if (found) entry[header.version] = found.returns ? [found.params, found.returns] : found.params }
    fresh[name] = entry
  }
  if (update) {
    index = { source: 'Gerado dos headers do SGDK por scripts/smoke-sdk-suggestions.mjs --update; não editar à mão.',
      versions: headers.map(header => header.version).sort(), symbols: fresh }
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 1) + '\n')
  } else for (const header of headers) for (const name of used.keys())
    assert.deepEqual(fresh[name][header.version], index.symbols[name]?.[header.version],
      name + ': índice versionado diverge dos headers do SGDK ' + header.version)
}
assert.ok(index.versions?.includes('1.81'), 'índice sem SGDK 1.81; gere com --update --sdk <inc>')
const problems = []
for (const [name, uses] of used) {
  const entry = index.symbols[name]
  for (const { source, count, sdk2, returns } of uses) {
    if (!entry || !Object.keys(entry).length) { problems.push(name + ' (' + source + '): não existe em nenhum SGDK indexado'); continue }
    const version = sdk2 ? index.versions.find(v => v !== '1.81' && v in entry) : '1.81'
    if (sdk2 && '1.81' in entry) problems.push(name + ' (' + source + '): marcado como SGDK 2.x, mas existe no 1.81')
    if (!version || !(version in entry)) { problems.push(name + ' (' + source + '): ausente no SGDK ' + (version || '2.x') + ' e não marcado como exclusivo de outra versão'); continue }
    const [params, declared] = Array.isArray(entry[version]) ? entry[version] : [entry[version], null]
    if (count !== null && params !== null && params !== count)
      problems.push(name + ' (' + source + '): ' + count + ' argumento(s), o SGDK ' + version + ' declara ' + params)
    if (returns && declared && returns.replace(/\s+/g, '') !== declared.replace(/\s+/g, ''))
      problems.push(name + ' (' + source + '): retorno "' + returns + '", o SGDK ' + version + ' declara "' + declared + '"')
  }
}
assert.deepEqual(problems, [])
// O teste precisa enxergar erros: nomes inventados e aridade errada são reprovados.
assert.deepEqual(describe({ text: 'void A_b(u16 x, u16 y);' }, 'A_b'), { params: 2, returns: 'void' })
assert.deepEqual(describe({ text: '\nconst Sprite* A_b(void);' }, 'A_b'), { params: 0, returns: 'const Sprite*' })
assert.equal(describe({ text: '#define A_b(i, v) _Pragma("This definition is deprecated")' }, 'A_b'), null)
assert.equal(calls('VDP_drawText("a, b)", 1, 2) // x, y', 'VDP_drawText')[0].count, 3)
assert.equal(describe({ text: '#define A_b(x) _Pragma("GCC error \\"x\\"")\n#define A_b _Pragma("GCC error")' }, 'A_c'), null)
assert.equal(calls('SPR_addSprite(&def, fix16ToInt(x), 0, TILE_ATTR(PAL0, 0, 0, 0))', 'SPR_addSprite')[0].count, 4)
assert.equal(calls('SYS_doVBlankProcess()', 'SYS_doVBlankProcess')[0].count, 0)
console.log('Sugestões SGDK: ' + used.size + ' nomes conferidos contra o índice dos headers (' + index.versions.join(', ') + ')' +
  (sdkDirectories.length ? '; índice conferido contra ' + sdkDirectories.length + ' SDK(s) instalado(s).' : '.'))
