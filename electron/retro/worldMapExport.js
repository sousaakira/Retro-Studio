// #55: only the bundled compiler executes; project inputs are copied to scratch.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readProjectOutput} from './exportTransaction.js'
import {resolveRuntimeLibraryPath,runtimeInstallationStatus} from './runtimeInstaller.js'
const execute=promisify(execFile),hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
const RECORD='.retrostudio/world-map-export.json'
const generated=name=>/^(?:src\/generated\/world_(?:maps|room_\d+(?:_objects)?)\.h|res\/generated\/(?:world-\d+-(?:bg|fg|pan|collision|hitbox)\.png|map-object-[a-f0-9]{64}\.png|world-(?:map-manifest\.json|resources\.res)))$/.test(name)
function bounded(root,name,limit=32*1024*1024){
 // Confinement before size preflight; readProjectOutput also rejects broken links.
 let target=root
 for(const [index,part] of name.split('/').entries()){
  target=path.join(target,part);let stat
  try{stat=fs.lstatSync(target)}catch(e){if(e.code==='ENOENT')return null;throw e}
  if(stat.isSymbolicLink()||(index<name.split('/').length-1?!stat.isDirectory():!stat.isFile()))throw Error('World export requires regular files: '+name)
  if(index===name.split('/').length-1&&stat.size>limit)throw Error('World export input too large: '+name)
 }
 return readProjectOutput(root,name)
}
function inputs(root){
 const files=new Map();let count=0,total=0
 const excluded=new Set(['.git','.retrostudio','.retro-studio','out','build','dist','dist-electron','node_modules','vendor','tools'])
 const extensions=new Set(['.json','.tmx','.tsx','.res','.png','.bmp','.jpg','.jpeg','.gif','.webp'])
 function walk(directory,depth=0){
  if(depth>32)throw Error('World inputs exceed directory depth.')
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   if(++count>8192)throw Error('World inputs exceed file count.')
   if(excluded.has(entry.name))continue
   const target=path.join(directory,entry.name),name=path.relative(root,target).split(path.sep).join('/')
   // Sources and outputs of other editors (camera, audio, progress, cutscenes, physics,
   // controls, toolchain record) are not read by the map exporter: saving them must not
   // make the exported maps look stale.
   // charsets/: character projects are read only by the character export. The sprite sheet it
   // writes to res/ stays an input, because a map object may show it.
   if(depth===0&&(['camera','audio','progress','cutscenes','physics','controls','debug','palettes','charsets','hud','game'].includes(entry.name)||name==='retro-studio.toolchain.json'))continue
   if(name==='res/audio_resources.res'||name==='res/hud_resources.res'||name==='res/generated/hud_glyphs.png')continue
   if(name==='world/world.json'||name==='res/resources.res'||generated(name)||/^res\/generated\/map-(?:bg|fg|collision|hitbox)\.png$/.test(name)||name==='res/generated/map-manifest.json')continue
   if(entry.isSymbolicLink())throw Error('World inputs cannot contain links: '+name)
   if(entry.isDirectory()){walk(target,depth+1);continue}
   if(!extensions.has(path.extname(name).toLowerCase())&&!/^src\/retro_runtime\/retro_scene\.[hc]$/.test(name))continue
   const bytes=bounded(root,name);total+=bytes?.length||0
   if(total>96*1024*1024)throw Error('World input snapshot exceeds 96 MiB.')
   // The IDE rewrites retro-studio.json for unrelated reasons (asset list, budgets):
   // only what the exporter reads from it decides whether the maps are stale.
   let relevant=bytes
   if(name==='retro-studio.json'&&bytes)try{const project=JSON.parse(bytes.toString('utf8'));relevant=Buffer.from(JSON.stringify([project.mapExport??null,project.retroStudio??null,project.scenery??null,project.hardwareBudget?.videoMode??null]))}catch{relevant=bytes}
   files.set(name,{bytes,hash:hash(relevant)})
  }
 }
 walk(root)
 // Images in res/ that no map, tileset, kit or project file mentions are not inputs of the
 // exporter (a character sheet rewritten by the character export, for example). They are
 // still copied to the staging area, but do not decide whether the maps are stale.
 let corpus=''
 // retro-studio.json is left out: its asset inventory lists every file and is not usage.
 for(const [name,file] of files)if(name!=='retro-studio.json'&&/\.(?:tmx|tsx|json)$/i.test(name)&&file.bytes&&file.bytes.length<=4*1024*1024)corpus+=file.bytes.toString('utf8')+'\n'
 for(const [name,file] of files)if(/^res\/[^/]+\.(?:png|bmp|jpe?g|gif|webp)$/i.test(name)&&!corpus.includes(path.posix.basename(name)))file.signed=false
 return files
}
function signature(files){return JSON.stringify([...files].filter(([,file])=>file.signed!==false).map(([name,file])=>[name,file.hash]))}
function resourceLines(bytes){
 const result=new Map()
 for(const line of bytes.toString('utf8').split(/\r?\n/)){
  const match=line.match(/^\s*([A-Z][A-Z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s/)
  if(match){if(result.has(match[2]))throw Error('Duplicate resource symbol: '+match[2]);result.set(match[2],line)}
 }
 return result
}
export async function prepareWorldMapExport(projectPath,config,{runCompiler=execute}={}){
 const root=fs.realpathSync(projectPath),resource=bounded(root,'res/resources.res',4*1024*1024)
 if(resource===null)throw Error('Missing res/resources.res.')
 const recordBytes=bounded(root,RECORD,1024*1024),owned=recordBytes===null?{version:1,files:[],resources:[]}:JSON.parse(recordBytes)
 if(![1,2].includes(owned.version)||!Array.isArray(owned.files)||owned.files.length>1024||!Array.isArray(owned.resources)||owned.resources.length>1024)throw Error('Invalid world map ownership record.')
 const names=new Set()
 for(const f of owned.files){if(!generated(f.path)||names.has(f.path)||!/^[a-f0-9]{64}$/.test(f.hash))throw Error('Invalid world map file ownership.');names.add(f.path)}
 const priorResources=new Map()
 for(const r of owned.resources){
  if(typeof r.symbol!=='string'||!/^RETRO_WORLD_ROOM_\d+(?:_\w+)?$|^GAME_MAP_OBJECT_[A-F0-9]{16}$/.test(r.symbol)||
    typeof r.line!=='string'||/[\r\n]/.test(r.line)||!/^\s*(PALETTE|TILESET|MAP|TILEMAP|SPRITE)\s/.test(r.line)||priorResources.has(r.symbol)||resourceLines(Buffer.from(r.line)).get(r.symbol)!==r.line)
   throw Error('Invalid world resource ownership.')
  priorResources.set(r.symbol,r.line)
 }
 const status=runtimeInstallationStatus(root)
 if(['world-sgdk','world','core','collision'].some(id=>!status.files.some(f=>f.moduleId===id)||status.files.some(f=>f.moduleId===id&&f.status!=='current')))throw Error('Install/update world-sgdk and collision in Resources > Runtime before exporting room maps.')
 const runtimeHashes=new Map(status.files.filter(f=>['world-sgdk','world','core','collision'].includes(f.moduleId)).map(f=>[f.path,hash(bounded(root,f.path,256*1024))]))
 runtimeHashes.set('.retrostudio/runtime-installation.json',hash(bounded(root,'.retrostudio/runtime-installation.json',1024*1024)))
 const snapshot=inputs(root),stamp=signature(snapshot),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'retro-world-export-'))
 try{
  const game=path.join(scratch,'game');fs.mkdirSync(game)
  for(const [name,file] of snapshot){const target=path.join(game,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.bytes)}
  fs.mkdirSync(path.join(game,'world'),{recursive:true});fs.writeFileSync(path.join(game,'world/world.json'),JSON.stringify(config))
  fs.mkdirSync(path.join(game,'res'),{recursive:true});fs.writeFileSync(path.join(game,'res/resources.res'),resource)
  // The legacy manifest is data only, never executable project code.
  const legacyManifest=bounded(root,'res/generated/map-manifest.json',4*1024*1024)
  const legacyObjects=legacyManifest===null?[]:JSON.parse(legacyManifest).objectResources||[]
  if(!Array.isArray(legacyObjects)||legacyObjects.length>48)throw Error('Invalid legacy object ownership.')
  const sharedObjects=new Map()
  for(const record of legacyObjects){
   const match=typeof record.path==='string'&&record.path.match(/^res\/generated\/map-object-([a-f0-9]{64})\.png$/)
   if(!match||record.symbol!=='GAME_MAP_OBJECT_'+match[1].slice(0,16).toUpperCase()||!/^[a-f0-9]{64}$/.test(record.hash)||sharedObjects.has(record.path))throw Error('Invalid legacy object ownership.')
   sharedObjects.set(record.path,record)
  }
  if(legacyManifest!==null){fs.mkdirSync(path.join(game,'res/generated'),{recursive:true});fs.writeFileSync(path.join(game,'res/generated/map-manifest.json'),legacyManifest)}
  const library=resolveRuntimeLibraryPath();if(!library)throw Error('Bundled runtime unavailable.')
  const tools=path.resolve(library,'../../examples/sgdk-skeleton/tools');fs.mkdirSync(path.join(game,'tools'))
  for(const name of ['export-map.py','export-world-maps.py'])fs.copyFileSync(path.join(tools,name),path.join(game,'tools',name))
  // The staged copy has no .retrostudio folder: carry over the proof that map triggers are exported.
  const adapterRecord=path.join(root,'.retrostudio/cutscene-adapter-export.json')
  if(fs.existsSync(adapterRecord)&&fs.lstatSync(adapterRecord).isFile()){fs.mkdirSync(path.join(game,'.retrostudio'),{recursive:true});fs.copyFileSync(adapterRecord,path.join(game,'.retrostudio/cutscene-adapter-export.json'))}
  const stage=path.join(scratch,'stage')
  await runCompiler('python3',[path.join(game,'tools/export-world-maps.py'),'--stage',stage],{cwd:game,timeout:180000,maxBuffer:1024*1024,windowsHide:true})
  // Salas com panoramas incluem o runtime de cenário: sem ele o build quebraria em um #include, sem explicação.
  let stagedHeader='';try{stagedHeader=fs.readFileSync(path.join(stage,'src/generated/world_maps.h'),'utf8')}catch{/* conferido adiante */}
  if(stagedHeader.includes('retro_scenery_sgdk.h')&&['scenery','scenery-sgdk'].some(id=>!status.files.some(f=>f.moduleId===id)||status.files.some(f=>f.moduleId===id&&f.status!=='current')))
   throw Error('Este mundo tem salas com panoramas, que usam o runtime de cenário. Instale ou atualize o módulo scenery-sgdk em Recursos → Runtime antes de exportar.')
  const files=new Map();let count=0,total=0
  function walk(base){for(const entry of fs.readdirSync(base,{withFileTypes:true})){
   if(++count>1024||entry.isSymbolicLink())throw Error('Invalid world compiler stage.')
   const target=path.join(base,entry.name)
   if(entry.isDirectory()){walk(target);continue}
   const name=path.relative(stage,target).split(path.sep).join('/')
   if(!entry.isFile()||!generated(name))throw Error('Unexpected world compiler output: '+name)
   const bytes=bounded(stage,name);total+=bytes.length;if(total>32*1024*1024)throw Error('World outputs exceed 32 MiB transaction limit.')
   files.set(name,bytes)
  }}walk(stage)
  if(!files.has('src/generated/world_maps.h')||!files.has('res/generated/world-map-manifest.json')||!files.has('res/generated/world-resources.res'))throw Error('Incomplete world map export.')
  const nextResources=resourceLines(files.get('res/generated/world-resources.res')),currentResources=resourceLines(resource)
  // Share content-addressed sprites already owned by the single-map exporter,
  // only when file bytes, manifest hash and exact declaration all agree.
  for(const [name,record] of sharedObjects){
   const bytes=files.get(name),line=nextResources.get(record.symbol)
   if(bytes&&line&&hash(bytes)===record.hash&&hash(bounded(root,name))===record.hash&&currentResources.get(record.symbol)===line&&!priorResources.has(record.symbol))priorResources.set(record.symbol,line)
  }
  for(const [symbol,line] of priorResources)if(currentResources.get(symbol)!==line)throw Error('World resource is customized or missing; preserved: '+symbol)
  for(const [symbol,line] of nextResources)if(currentResources.has(symbol)&&currentResources.get(symbol)!==priorResources.get(symbol))throw Error('Unmanaged resource symbol; preserved: '+symbol)
  const outputs=[]
  for(const [name,bytes] of files){const current=bounded(root,name),prior=owned.files.find(f=>f.path===name)
   const shared=sharedObjects.get(name)
   const adoptsShared=shared&&hash(bytes)===shared.hash&&hash(current)===shared.hash&&priorResources.has(shared.symbol)
   if(current!==null&&hash(current)!==prior?.hash&&!adoptsShared)throw Error('World output is customized or unmanaged; preserved: '+name)
   outputs.push({path:name,bytes,expectedHash:hash(current)})
  }
  const allResources=new Map([...priorResources,...nextResources]),order={PALETTE:0,TILESET:1,MAP:2,TILEMAP:2,SPRITE:3}
  // Update existing declarations in place so manual MAP consumers keep their
  // position after the managed TILESET. Append only genuinely new resources.
  const lines=resource.toString('utf8').split(/\r?\n/).map(line=>{
   const match=line.match(/^\s*([A-Z][A-Z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s/)
   return match&&priorResources.has(match[2])?nextResources.get(match[2])||line:line
  })
  while(lines.at(-1)==='')lines.pop()
  lines.push(...[...nextResources].filter(([symbol])=>!currentResources.has(symbol)).sort(([a,x],[b,y])=>order[x.trim().split(/\s+/)[0]]-order[y.trim().split(/\s+/)[0]]||a.localeCompare(b)).map(([,line])=>line))
  const declared=new Map()
  for(const line of lines){
   const map=line.match(/^\s*(?:MAP|TILEMAP)\s+\w+\s+(?:"[^"]*"|'[^']*'|\S+)\s+([A-Za-z_][A-Za-z0-9_]*)/)
   if(map&&declared.get(map[1])!=='TILESET')throw Error('MAP tileset must be declared earlier; existing resources preserved: '+map[1])
   const match=line.match(/^\s*([A-Z][A-Z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s/)
   if(match)declared.set(match[2],match[1])
  }
  const resourceBytes=Buffer.from([...lines,''].join('\n'))
  resourceLines(resourceBytes) // Verify final symbols after merging, too.
  outputs.push({path:'res/resources.res',bytes:resourceBytes,expectedHash:hash(resource)})
  // Retain obsolete outputs/declarations until the asset lifecycle proves no consumers.
  const metadata={version:2,worldHash:hash(Buffer.from(JSON.stringify(config))),inputHash:hash(Buffer.from(stamp)),runtimeHashes:[...runtimeHashes],activeFiles:[...files.keys()].sort(),files:[...owned.files.filter(f=>!files.has(f.path)),...outputs.filter(o=>generated(o.path)).map(o=>({path:o.path,hash:hash(o.bytes)}))],resources:[...allResources].map(([symbol,line])=>({symbol,line}))}
  if(metadata.files.length>1024||metadata.resources.length>1024||new Set(metadata.files.map(f=>f.path)).size!==metadata.files.length||new Set(metadata.resources.map(r=>r.symbol)).size!==metadata.resources.length)throw Error('World ownership exceeds item limits; previous generation preserved.')
  const bytes=Buffer.from(JSON.stringify(metadata,null,2)+'\n');if(bytes.length>1024*1024)throw Error('World ownership exceeds 1 MiB.')
  outputs.push({path:RECORD,bytes,expectedHash:hash(recordBytes)})
  function guard(){
   if(signature(inputs(root))!==stamp)throw Error('World map inputs changed during export; previous outputs preserved.')
   if(hash(bounded(root,'res/generated/map-manifest.json',4*1024*1024))!==hash(legacyManifest))throw Error('Legacy map ownership changed during export.')
   for(const [name,value] of runtimeHashes)if(hash(bounded(root,name,1024*1024))!==value)throw Error('World runtime changed during export; previous outputs preserved.')
  }
  guard();return {outputs,guard,roomCount:config.rooms.length}
 }finally{fs.rmSync(scratch,{recursive:true,force:true})}
}

/** No compiler or project code executes here; validate the managed generation. */
export function hasManagedWorldMapExport(projectPath){return bounded(fs.realpathSync(projectPath),RECORD,1024*1024)!==null}
export function validateWorldMapExportForBuild(projectPath,config){
 const root=fs.realpathSync(projectPath),bytes=bounded(root,RECORD,1024*1024)
 if(bytes===null){if(bounded(root,'src/generated/world_maps.h')!==null)throw Error('World map ownership record is missing; export the world before building.');return {configured:false}}
 const record=JSON.parse(bytes)
 if(record.version===1)throw Error('Exporte o mundo novamente para registrar a revisão dos recursos das salas.')
 if(record.version!==2||!Array.isArray(record.files)||record.files.length>1024||!Array.isArray(record.activeFiles)||record.activeFiles.length>1024||!Array.isArray(record.resources)||record.resources.length>1024||!Array.isArray(record.runtimeHashes)||record.runtimeHashes.length>64||!/^[a-f0-9]{64}$/.test(record.inputHash)||!/^[a-f0-9]{64}$/.test(record.worldHash))throw Error('Invalid world map generation record.')
 const files=new Map()
 for(const f of record.files){if(!f||!generated(f.path)||files.has(f.path)||!/^[a-f0-9]{64}$/.test(f.hash))throw Error('Invalid world map generation files.');files.set(f.path,f.hash)}
 if(!record.activeFiles.length||new Set(record.activeFiles).size!==record.activeFiles.length||record.activeFiles.some(name=>!files.has(name))||['src/generated/world_maps.h','res/generated/world-map-manifest.json','res/generated/world-resources.res'].some(name=>!record.activeFiles.includes(name)))throw Error('Invalid active world map outputs.')
 if(hash(Buffer.from(JSON.stringify(config)))!==record.worldHash||hash(Buffer.from(signature(inputs(root))))!==record.inputHash)throw Error('Os mapas ou imagens do mundo mudaram. Salve e exporte o mundo antes do build.')
 let total=0
 for(const name of record.activeFiles){const current=bounded(root,name);total+=current?.length||0;if(total>32*1024*1024||hash(current)!==files.get(name))throw Error('World output is modified or missing; preserved: '+name)}
 const manifest=JSON.parse(bounded(root,'res/generated/world-map-manifest.json'))
 if(manifest.version!==1||!Array.isArray(manifest.outputs)||manifest.outputs.length+1!==record.activeFiles.length||new Set(manifest.outputs.map(o=>o.path)).size!==manifest.outputs.length||manifest.outputs.some(o=>!record.activeFiles.includes(o.path)||files.get(o.path)!==o.hash))throw Error('World generation manifest disagrees with owned outputs.')
 const seen=new Set()
 for(const item of record.runtimeHashes){if(!Array.isArray(item)||item.length!==2||typeof item[0]!=='string'||!(/^src\/retro_runtime\/retro_(?:core|collision|slopes|combat|world|world_sgdk)\.[hc]$/.test(item[0])||item[0]==='.retrostudio/runtime-installation.json')||seen.has(item[0])||!/^[a-f0-9]{64}$/.test(item[1]))throw Error('Invalid world runtime generation guard.');seen.add(item[0]);if(hash(bounded(root,item[0],1024*1024))!==item[1])throw Error('World runtime changed; export the world before building.')}
 const required=['core','collision','combat','slopes','world','world_sgdk'].flatMap(name=>['h','c'].map(ext=>'src/retro_runtime/retro_'+name+'.'+ext))
 if([...required,'.retrostudio/runtime-installation.json'].some(name=>!seen.has(name)))throw Error('Incomplete world runtime generation guard.')
 const resource=bounded(root,'res/resources.res',4*1024*1024);if(resource===null)throw Error('Missing world resources.')
 const declared=resourceLines(resource),symbols=new Set()
 for(const r of record.resources){if(!r||typeof r.symbol!=='string'||symbols.has(r.symbol)||typeof r.line!=='string'||/[\r\n]/.test(r.line)||declared.get(r.symbol)!==r.line)throw Error('World resource declaration changed or missing; preserved.');symbols.add(r.symbol)}
 return {configured:true,signature:hash(Buffer.from(JSON.stringify([hash(bytes),record.inputHash,record.activeFiles.map(name=>[name,files.get(name)])])))}
}
