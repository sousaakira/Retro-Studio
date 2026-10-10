// #42: merge of an unpacked package into a project folder without replacing anything.
import fs from 'node:fs/promises'
import path from 'node:path'
/** Copies every regular file of `source` into `target`. Identical files are left alone;
 * a name taken by other content is preserved and listed in `conflicts`. Links are ignored. */
export async function mergeUnpackedAssets(source, target) {
  const added = [], unchanged = [], conflicts = []
  async function walk(relative, depth) {
    if (depth > 16) throw new Error('Pacote com pastas demais.')
    for (const entry of await fs.readdir(path.join(source, relative), { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { await walk(name, depth + 1); continue }
      if (!entry.isFile()) continue
      if (added.length + unchanged.length + conflicts.length >= 4096) throw new Error('Pacote com arquivos demais.')
      const destination = path.join(target, name)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      const real = await fs.realpath(path.dirname(destination)), base = await fs.realpath(target)
      if (real !== base && !real.startsWith(base + path.sep)) throw new Error('Pacote tenta gravar fora da pasta de recursos.')
      const incoming = await fs.readFile(path.join(source, name))
      try {
        // wx: fails instead of replacing if the file exists (also closes the check/copy race).
        await fs.writeFile(destination, incoming, { flag: 'wx' })
        added.push(name)
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const info = await fs.lstat(destination)
        if (info.isFile() && incoming.equals(await fs.readFile(destination))) unchanged.push(name)
        else conflicts.push(name)
      }
    }
  }
  await walk('', 0)
  return { added, unchanged, conflicts }
}
