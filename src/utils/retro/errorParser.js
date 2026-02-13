/**
 * Utilitários de erros de compilação (frontend)
 * getErrorStats e getRelativeErrorPath para ErrorPanel
 */

export function getErrorStats(errors) {
  const stats = { total: errors?.length || 0, errors: 0, warnings: 0, notes: 0, files: 0 }
  if (!errors?.length) return stats
  const files = new Set()
  errors.forEach((e) => {
    if (e.severity === 'error') stats.errors++
    else if (e.severity === 'warning') stats.warnings++
    else stats.notes++
    if (e.file) files.add(e.file)
  })
  stats.files = files.size
  return stats
}

export function getRelativeErrorPath(error, projectPath) {
  const filePath = error?.file || ''
  if (!projectPath) return filePath
  if (filePath.includes(projectPath)) {
    return filePath.substring(projectPath.length).replace(/^[\\/]/, '')
  }
  return filePath
}
