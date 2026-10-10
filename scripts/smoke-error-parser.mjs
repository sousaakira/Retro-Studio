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
console.log('Error parser: make failure lines, Python tracebacks, gcc/rescomp lines, no invented files; unopenable problem warns.')
