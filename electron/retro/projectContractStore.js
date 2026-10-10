import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { declareProjectContract } from '../../shared/retro/projectContract.js'

/**
 * Explicit declaration for a legacy project; callers must authorize their root.
 * This is not invoked when opening a game. Originals survive failed migration.
 */
export function declareRuntimeForProject(projectPath, declaration) {
  const root = fs.realpathSync(projectPath)
  const configPath = path.join(root, 'retro-studio.json')
  const configReal = fs.realpathSync(configPath)
  const relative = path.relative(root, configReal)
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative))
    throw new Error('Project configuration resolves outside the project.')
  const stat = fs.statSync(configReal)
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Project configuration must be a regular JSON file under 1 MiB.')
  const original = fs.readFileSync(configReal, 'utf8')
  const migrated = declareProjectContract(JSON.parse(original), declaration)
  const backupPath = path.join(root, `retro-studio.json.contract-v0.${randomUUID()}.bak`)
  const temporary = path.join(root, `.retro-studio-contract-${randomUUID()}.tmp`)
  fs.writeFileSync(backupPath, original, { flag: 'wx' })
  try {
    fs.writeFileSync(temporary, JSON.stringify(migrated, null, 2) + '\n', { flag: 'wx' })
    if (fs.readFileSync(configReal, 'utf8') !== original) throw new Error('Project changed during migration; retry.')
    fs.renameSync(temporary, configReal)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
  return { config: migrated, backupPath }
}
