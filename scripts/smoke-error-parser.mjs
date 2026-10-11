// Saída de build → lista de problemas: só linhas que apontam um arquivo de verdade viram problema clicável.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseCompilationOutput, parseErrorLine } from '../electron/retro/errorParser.js'
// Exportador Python do projeto falha antes do compilador.
const python = parseCompilationOutput(`python3 tools/export-character.py
Traceback (most recent call last):
  File "/proj/tools/export-character.py", line 56, in <module>
    if __name__=="__main__":main()
  File "/proj/tools/export-character.py", line 20, in main
    if a!=b:raise ValueError("x")
ValueError: Animacoes do Charset Maker mudaram: exporte ninja.png novamente.
make: *** [Makefile:7: export-map] Error 1
`)
assert.deepEqual(python.map(error => [error.file, error.line, error.message]), [
  ['/proj/tools/export-character.py', 20, 'ValueError: Animacoes do Charset Maker mudaram: exporte ninja.png novamente.'],
  ['Makefile', 7, 'make: export-map Error 1']
])
assert.ok(python.every(error => error.type === 'error' && !/[*[\]"]/.test(error.file)), 'nenhum "arquivo" inventado a partir do texto do make')
// O make sem arquivo não vira problema clicável; o gcc continua igual.
for (const line of ['make: *** No rule to make target \'debug\'.  Stop.', 'make[1]: Leaving directory \'/proj\'', 'make: *** [out/rom.bin] Error 2', 'Traceback (most recent call last):']) assert.equal(parseErrorLine(line), null, line)
assert.deepEqual(parseErrorLine('src/main.c:12:5: error: expected \';\''), { file: 'src/main.c', line: 12, column: 5, type: 'error', message: 'expected \';\'', severity: 'error' })
assert.equal(parseErrorLine('src/main.c:9: warning: unused').type, 'warning')
assert.equal(parseErrorLine('res/resources.res:4: Couldn\'t open file').file, 'res/resources.res')
assert.equal(parseCompilationOutput('make[2]: *** [sub/Makefile:31: out/a.o] Error 1')[0].file, 'sub/Makefile')
// Traceback seguido de erro do compilador: os dois aparecem, sem misturar.
const mixed = parseCompilationOutput('Traceback (most recent call last):\n  File "t.py", line 3, in <module>\nKeyError: \'x\'\nsrc/a.c:1:1: error: boom')
assert.deepEqual(mixed.map(error => error.file), ['t.py', 'src/a.c'])
// Um problema cujo arquivo não abre avisa em vez de trocar o editor por um erro interno.
const shell = fs.readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
assert.match(shell, /if \(lastError\.value && !tabs\.value\.some\(\(tab\) => tab\.path === fullPath\)\) \{\s*lastError\.value = null\s*window\.retroStudioToast\?\.error\?\.\(t\('runMode\.cannotOpenProblem', \{ file \}\)\)/)
for (const locale of fs.readdirSync(new URL('../src/locales/', import.meta.url)).filter(name => name.endsWith('.json'))) assert.ok(JSON.parse(fs.readFileSync(new URL('../src/locales/' + locale, import.meta.url), 'utf8')).runMode?.cannotOpenProblem, locale)
// Botão direito em erro/aviso: menu para copiar a mensagem, a seleção ou todos os problemas; campos de texto, editor e terminal ficam de fora.
const copy = fs.readFileSync(new URL('../src/components/CopyErrorMenu.vue', import.meta.url), 'utf8')
assert.match(shell, /<CopyErrorMenu :errors="compilationErrors" \/>/)
assert.match(copy, /if \(event\.defaultPrevented\) return/, 'menus de contexto próprios continuam valendo')
assert.match(copy, /closest\('input, textarea, \[contenteditable="true"\], \.monaco-editor, \.xterm, \.copy-error-menu'\)/)
for (const surface of ['.toast', '.error-item', '.te-export-failure', '[role="alert"]']) assert.ok(copy.includes(surface), surface)
assert.match(copy, /navigator\.clipboard\.writeText\(item\.text\)/); assert.match(copy, /target\.closest\('dialog\[open\]'\) \|\| 'body'/, 'visível também dentro de janelas modais')
// Erros do processo principal chegam à tela sem o prefixo técnico do Electron.
{
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8')
  assert.equal((preload.match(/ipcRenderer\.invoke\(/g) || []).length, 1, 'toda chamada passa pelo invoke que limpa a mensagem')
  const pattern = new RegExp(preload.match(/replace\(\/(\^Error invoking remote method[^\n]*?)\/, ''\)/)[1])
  assert.equal("Error invoking remote method 'retro:build-movement-diagnostic': Error: Salve e exporte a física antes de gerar a ROM.".replace(pattern, ''), 'Salve e exporte a física antes de gerar a ROM.')
  assert.equal("Error invoking remote method 'fs:readTextFile': TypeError: x".replace(pattern, ''), 'x'); assert.equal('Erro comum: fica igual'.replace(pattern, ''), 'Erro comum: fica igual')
  // Sala de testes: a ROM só pode ser gerada depois do primeiro "Salvar e exportar".
  const lab = fs.readFileSync(new URL('../src/components/retro/MovementLab.vue', import.meta.url), 'utf8')
  assert.match(lab, /:disabled="blocked \|\| dirty \|\| !exported \|\| headerConflict \|\| revisionConflict"[^>]*@click="buildDiagnostic"/); assert.match(lab, /exported\.value=result\.exported!==false/); assert.match(lab, /saved\.value=true;exported\.value=true/)
  assert.match(fs.readFileSync(new URL('../electron/retro/movementConfiguration.js', import.meta.url), 'utf8'), /exported:data\.source!==null&&data\.header!==null/)
}
console.log('Error parser: make failure lines, Python tracebacks, gcc/rescomp lines, no invented files; unopenable problem warns.')
