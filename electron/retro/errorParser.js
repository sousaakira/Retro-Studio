const ERROR_PATTERNS = [
  /^([^:]+):(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/,
  /^([^:]+):(\d+):\s*(error|warning|note):\s*(.+)$/,
  /^(.+?):(\d+):\s*(.+)$/
]

export function parseErrorLine(line) {
  if (!line || typeof line !== 'string') return null

  for (const pattern of ERROR_PATTERNS) {
    const match = line.match(pattern)
    if (match) {
      const [, file, lineNum, ...rest] = match
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

  for (const line of lines) {
    const error = parseErrorLine(line)
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
