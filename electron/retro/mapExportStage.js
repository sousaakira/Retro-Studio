import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { publishProjectOutputs, readProjectOutput, prepareProjectDirectory } from './exportTransaction.js'
import { inspectProjectAssets } from './assetReport.js'
import { resolveRuntimeLibraryPath } from './runtimeInstaller.js'
export const MAP_STAGE_PROTOCOL = 'retro-studio-map-outputs-v1'
const OUTPUTS = [
  'res/generated/map-bg.png', 'res/generated/map-fg.png',
  'res/generated/map-collision.png', 'res/generated/map-hitbox.png',
  'res/generated/map-manifest.json', 'src/generated/map_data.h', 'src/generated/map_objects.h', 'res/resources.res'
]
const hash = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex')

const OBJECT_FILE = /^res\/generated\/map-object-([a-f0-9]{64})\.png$/
function objectRecords(bytes) {
  if(bytes===null)return []
  if(bytes.length>1024*1024)throw Error('Map manifest exceeds 1 MiB.')
  const manifest=JSON.parse(bytes.toString('utf8'))
  const records=manifest.objectResources || []
  if(!Array.isArray(records)||records.length>48)throw Error('Invalid map object resource manifest.')
  const paths=new Set()
  for(const record of records){
    const match=typeof record.path==='string' && record.path.match(OBJECT_FILE)
    if(!match||paths.has(record.path)||!/^[a-f0-9]{64}$/.test(record.hash)||
      record.symbol!=='GAME_MAP_OBJECT_'+match[1].slice(0,16).toUpperCase())
      throw Error('Invalid map object resource ownership.')
    paths.add(record.path)
  }
  return records
}



function consumerSnapshot(root) {
  const records=[]
  let entries=0,total=0
  const excluded=new Set(['.git','.retrostudio','out','build','dist','dist-electron','node_modules','vendor'])
  const sourceExtensions=new Set(['.json','.tmx','.tsx','.res','.c','.h','.s','.asm','.py','.js','.mjs','.mk'])
  function walk(directory,depth=0){
    if(depth>64)throw Error('Map consumer inspection is too deep.')
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(++entries>20000)throw Error('Map consumer inspection exceeds file limit.')
      const target=path.join(directory,entry.name),relative=path.relative(root,target).split(path.sep).join('/')
      if(excluded.has(entry.name)||OUTPUTS.includes(relative)||OBJECT_FILE.test(relative)||relative==='res/resources.h')continue
      if(entry.isSymbolicLink()){records.push([relative,'link']);continue}
      if(entry.isDirectory()){records.push([relative,'directory']);walk(target,depth+1);continue}
      if(!entry.isFile()){records.push([relative,'special']);continue}
      if(!sourceExtensions.has(path.extname(entry.name).toLowerCase())&&entry.name!=='Makefile')continue
      const bytes=readProjectOutput(root,relative)
      total+=bytes.length
      if(bytes.length>1024*1024||total>32*1024*1024)throw Error('Map consumer sources exceed inspection limits.')
      records.push([relative,hash(bytes)])
    }
  }
  walk(root)
  return JSON.stringify(records)
}

function retainedObjects(root, oldObjects, outputs) {
  if(!oldObjects.length)return []
  const report=inspectProjectAssets(root)
  const library=resolveRuntimeLibraryPath()
  const template=path.resolve(library,'../../examples/sgdk-skeleton')
  const trustedDynamic=new Map([
    ['tools/export-map.py',path.join(template,'tools/export-map.py')],
    ['tools/export-world-maps.py',path.join(template,'tools/export-world-maps.py')],
    ['Makefile',path.join(template,'Makefile')],
    ...['compile-cutscenes.mjs','cutscene-compiler.mjs','cutscene-export.mjs','export-transaction.mjs']
      .map(name=>['tools/'+name,path.resolve(library,'../cutscene/tools',name)])
  ])
  const uncertain=report.skipped.length || report.ledgerError || report.exportRecoveryError ||
    report.dynamicSources.some(file=>{
      const trusted=trustedDynamic.get(file)
      return !trusted || !fs.existsSync(trusted) || hash(readProjectOutput(root,file))!==hash(fs.readFileSync(trusted))
    })
  const nextRes=outputs.find(o=>o.path==='res/resources.res')?.bytes.toString('utf8') || ''
  const ignored=new Set(['res/resources.res','res/resources.h','src/generated/map_objects.h'])
  return oldObjects.filter(record=>{
    const asset=report.assets.find(a=>a.path===record.path)
    return uncertain || nextRes.includes(path.posix.basename(record.path)) || nextRes.includes(record.symbol) ||
      asset?.references.some(file=>!ignored.has(file))
  })
}

function snapshotInputs(root, inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.length > 64) throw new Error('Invalid map input paths.')
  const files = new Map()
  let entries = 0, total = 0
  function walk(relative, depth = 0) {
    if (depth > 32 || ++entries > 8192) throw new Error('Map inputs exceed inspection limits.')
    if (typeof relative !== 'string' || !relative || relative.includes('\\') ||
        relative.startsWith('/') || /^[A-Za-z]:/.test(relative) || /[\x00-\x1f]/.test(relative) || 
        relative.split('/').some(part => !part || part === '.' || part === '..'))
      throw new Error('Invalid map input path.')
    if (OUTPUTS.includes(relative) || OBJECT_FILE.test(relative) || files.has(relative)) return
    let target = root
    for (const part of relative.split('/')) {
      target = path.join(target, part)
      try { if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Map inputs cannot contain symlinks.') }
      catch (error) { if (error.code === 'ENOENT') { files.set(relative, null); return }; throw error }
    }
    const stat = fs.lstatSync(target)
    if (stat.isDirectory()) {
      files.set(relative, 'directory')
      for (const name of fs.readdirSync(target).sort()) walk(relative + '/' + name, depth + 1)
    } else {
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('Unsupported map input file.')
      total += stat.size
      if (total > 128 * 1024 * 1024) throw new Error('Map inputs exceed 128 MiB.')
      files.set(relative, hash(fs.readFileSync(target)))
    }
  }
  inputPaths.forEach(relative => walk(relative))
  return JSON.stringify([...files].sort(([a],[b]) => a.localeCompare(b)))
}
export function prepareMapExportStage(projectPath, mapRelative, { inputPaths = [], expectedConfigHash } = {}) {
  const root = fs.realpathSync(projectPath)
  if (expectedConfigHash !== undefined && hash(readProjectOutput(root, 'retro-studio.json')) !== expectedConfigHash)
    throw new Error('Map configuration changed before export; reload before retrying.')
  const inputSnapshot = snapshotInputs(root, inputPaths)
  const relative = '.retrostudio/export-staging/' + randomUUID()
  const directory = prepareProjectDirectory(root, relative)
  const revisions = new Map(OUTPUTS.map(file => [file, hash(readProjectOutput(root, file))]))
  const oldObjects=objectRecords(readProjectOutput(root,'res/generated/map-manifest.json'))
  for(const record of oldObjects) {
    const current=hash(readProjectOutput(root,record.path))
    if(current!==null && current!==record.hash)throw Error('Generated map object image is modified; preserved: '+record.path)
    revisions.set(record.path,current)
  }
  const mapHash = hash(readProjectOutput(root, mapRelative))
  return {
    directory,
    publish() {
      if (snapshotInputs(root, inputPaths) !== inputSnapshot) throw new Error('Map inputs changed while exporting; previous outputs preserved.')
      if (hash(readProjectOutput(root, mapRelative)) !== mapHash) throw new Error('Map changed while exporting; saved map and previous outputs preserved.')
      const outputs = []
      let total = 0, count = 0
      function walk(base) {
        for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
          if (++count > 128) throw new Error('Map staging contains too many entries.')
          const file = path.join(base, entry.name)
          if (entry.isSymbolicLink()) throw new Error('Map staging cannot contain symlinks.')
          if (entry.isDirectory()) { walk(file); continue }
          if (!entry.isFile()) throw new Error('Map staging contains a non-regular file.')
          const outputPath = path.relative(directory, file).split(path.sep).join('/')
          if (!OUTPUTS.includes(outputPath) && !OBJECT_FILE.test(outputPath)) throw new Error('Unexpected map output: ' + outputPath)
          const size = fs.statSync(file).size
          total += size
          if (size > 32 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error('Map staged outputs exceed 32 MiB.')
          outputs.push({ path: outputPath, bytes: fs.readFileSync(file), expectedHash: revisions.has(outputPath) ? revisions.get(outputPath) : null })
        }
      }
      walk(directory)
      if (!outputs.some(output => output.path === 'src/generated/map_data.h')) throw new Error('Map exporter did not provide its generated header.')
      const manifestOutput=outputs.find(o=>o.path==='res/generated/map-manifest.json')
      if(oldObjects.length && !manifestOutput)throw Error('Missing map object ownership manifest; previous objects preserved.')
      const newObjects=objectRecords(manifestOutput?.bytes ?? null)
      for(const record of newObjects){
        const output=outputs.find(o=>o.path===record.path)
        if(!output || hash(output.bytes)!==record.hash)throw Error('Map object image does not match manifest.')
        if(!outputs.some(o=>o.path==='src/generated/map_objects.h'))throw Error('Missing map object renderer header.')
      }
      if(outputs.some(o=>OBJECT_FILE.test(o.path) && !newObjects.some(r=>r.path===o.path)))
        throw Error('Unowned map object image in staging.')
      const orphaned=oldObjects.filter(record=>!newObjects.some(r=>r.path===record.path))
      const consumers=orphaned.length ? consumerSnapshot(root) : null
      const retained=retainedObjects(root,orphaned,outputs)
      if(newObjects.length+retained.length>48)throw Error('Map object resources still used elsewhere exceed 48; existing files preserved.')
      if(retained.length){
        const resOutput=outputs.find(o=>o.path==='res/resources.res')
        if(!manifestOutput || !resOutput)throw Error('Missing map resource outputs; shared sprites preserved.')
        const oldRes=readProjectOutput(root,'res/resources.res')?.toString('utf8') || ''
        for(const record of retained){
          if(readProjectOutput(root,record.path)===null)throw Error('Shared map object image is missing: '+record.path)
          const declaration=oldRes.split(/\r?\n/).find(line=>line.match(/^\s*SPRITE\s+([A-Za-z_][A-Za-z0-9_]*)\s+/)?.[1]===record.symbol)
          if(!declaration)throw Error('Shared map object declaration is missing: '+record.symbol)
          resOutput.bytes=Buffer.concat([resOutput.bytes,Buffer.from(declaration+'\n')])
        }
        const manifest=JSON.parse(manifestOutput.bytes.toString('utf8'))
        manifest.objectResources=[...newObjects,...retained.map(r=>({...r,retained:true}))]
        manifestOutput.bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n')
      }
      for(const record of orphaned)if(!retained.some(r=>r.path===record.path))
        outputs.push({path:record.path,remove:true,expectedHash:revisions.get(record.path)})
      return {...publishProjectOutputs(root, outputs, { producer: 'map-export', beforePublish(){
        if(consumers!==null && consumerSnapshot(root)!==consumers)throw Error('Map object consumers changed during publication; previous resources preserved.')
      } }), retainedObjects:retained.map(r=>r.path)}
    },
    dispose() { fs.rmSync(directory, { recursive: true, force: true }) }
  }
}
