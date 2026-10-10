const ERROR_PATTERNS = [
  /^([^:]+):(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/,
  /^([^:]+):(\d+):\s*(error|warning|note):\s*(.+)$/,
  /^(.+?):(\d+):\s*(.+)$/
]

// "make: *** [Makefile:7: export-map] Error 1": o arquivo é o Makefile, não o texto antes dos dois-pontos.
const MAKE_FAILURE = /^make(?:\[\d+\])?: \*\*\* \[(.+?):(\d+): ([^\]]+)\]\s*(.*)$/
const TRACEBACK_FRAME = /^\s+File "(.+)", line (\d+)/

export function parseErrorLine(line) {
  if (!line || typeof line !== 'string') return null

  const make = line.match(MAKE_FAILURE)
  if (make) return { file: make[1].trim(), line: parseInt(make[2]), column: 1, type: 'error', message: `make: ${make[3].trim()} ${make[4].trim()}`.trim(), severity: 'error' }
  // Outras mensagens do make ("make: *** No rule...", "make: Leaving directory") não apontam arquivo.
  if (/^make(?:\[\d+\])?: /.test(line)) return null

  for (const pattern of ERROR_PATTERNS) {
    const match = line.match(pattern)
    if (match) {
      const [, file, lineNum, ...rest] = match
      // Um caminho de arquivo não tem aspas, asteriscos nem colchetes: é só texto com um número no meio.
      if (/["*[\]]/.test(file)) return null
      let type = 'error'
      let message = ''
      let column = 1

      if (rest.length === 3) {
        column = parseInt(rest[0])
        type = rest[1].toLowerCase()
        message = rest[2]
      } else if (rest.length === 2) {
        type = rest[0].toLowerCase()
        message = rest[1]
      } else {
        message = rest.join(':')
      }

      return {
        file: file.trim(),
        line: parseInt(lineNum),
        column,
        type,
        message: message.trim(),
        severity: type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info'
      }
    }
  }
  return null
}

export function parseCompilationOutput(output) {
  if (!output) return []

  const lines = output.split('\n')
  const errors = []
  const seenErrors = new Set()

  // Script Python que falha (exportadores do projeto): o erro é a última linha do traceback,
  // no arquivo e na linha do último quadro.
  let frame = null, tracing = false
  for (const line of lines) {
    if (/^Traceback \(most recent call last\):/.test(line)) { tracing = true; frame = null; continue }
    let error = null
    if (tracing) {
      const at = line.match(TRACEBACK_FRAME)
      if (at) { frame = { file: at[1], line: parseInt(at[2]) }; continue }
      if (/^\s/.test(line) || !line.trim()) continue
      tracing = false
      if (frame) error = { file: frame.file, line: frame.line, column: 1, type: 'error', message: line.trim(), severity: 'error' }
    }
    if (!error) error = parseErrorLine(line)
    if (error) {
      const key = `${error.file}:${error.line}:${error.message}`
      if (!seenErrors.has(key)) {
        errors.push(error)
        seenErrors.add(key)
      }
    }
  }
  return errors
}
