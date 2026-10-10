import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {toTMX} from '../src/utils/retro/tmxFormat.js'
import {runConfiguredMapExporter} from '../electron/retro/mapExporter.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
const repository=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-map-objects-'))
try{
 const root=path.join(temporary,'game')
 fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),root,{recursive:true})
 installCutsceneRuntime(root)
 fs.mkdirSync(path.join(root,'maps'))
 installRuntimeModules(root)
 const image=path.join(root,'maps/objects.png')
 const python=['from PIL import Image',"im=Image.new('RGBA',(48,16))",'for frame in range(3):',
  ' for y in range(2,14):','  for x in range(3+frame,13):',
  '   im.putpixel((frame*16+x,y),(224,96,32,255))','im.save('+JSON.stringify(image)+')'].join('\n')
 const generated=spawnSync('python3',['-c',python],{encoding:'utf8'})
 assert.equal(generated.status,0,generated.stderr)
 const mapPath=path.join(root,'maps/map.tmx')
 const visual={gid:1,width:2,height:2,frames:3,fps:6,loop:true,anchor:'bottom-center'}
 const objects=[
  {id:9,type:'lamp',x:3,y:3,width:3,height:4,properties:{priority:0},visual},
  {id:10,type:'lamp',x:9,y:3,width:3,height:4,properties:{priority:1,spriteOffsetX:1,flipH:true},visual},
  {id:11,type:'lantern',x:16,y:2,width:2,height:3,properties:{priority:1},visual:{...visual,anchor:'center',displayWidth:24,displayHeight:16,loop:false}},
  // The editor marker previews a player; this must never become a scenery object.
  {id:12,type:'player_spawn',x:1,y:1,width:2,height:5,properties:{},visual:{...visual,frames:99}}
 ]
 const save=(list)=>fs.writeFileSync(mapPath,toTMX({width:40,height:28,tiles:[],tilesets:[{name:'objects',path:'objects.png',firstgid:1,columns:6,tilecount:12}],objects:list}))
 save(objects)
 let result=await runConfiguredMapExporter({projectPath:root,mapPath})
 assert.equal(result.success,true,result.error)
 const manifestPath=path.join(root,'res/generated/map-manifest.json')
 const first=JSON.parse(fs.readFileSync(manifestPath,'utf8'))
 assert.equal(first.objectResources.length,2,'identical visuals reuse one derived sprite')
 const header=fs.readFileSync(path.join(root,'src/generated/map_objects.h'),'utf8')
 assert.ok(header.includes('GAME_MAP_OBJECT_COUNT 3'))
 assert.ok(header.includes(',28,40,0,0,0,1,0,0,0,1,gameMapObjectTimes0,3}'))
 assert.ok(header.includes(',93,40,0,0,0,1,1,1,0,1,gameMapObjectTimes1,3}'))
 assert.ok(header.includes(',124,20,0,0,0,1,1,0,0,0,gameMapObjectTimes2,3}'))
 assert.ok(header.includes('{10,10,10}'),'FPS converted to video ticks')
 const firstBytes=first.objectResources.map(r=>fs.readFileSync(path.join(root,r.path)))
 const pngCheck=spawnSync('python3',['-c',[
  'from PIL import Image','from pathlib import Path','import json',
  'root=Path('+JSON.stringify(root)+')',
  "manifest=json.loads((root/'res/generated/map-manifest.json').read_text())",
  "assert all(p[3]==0 for p in Image.open(root/'res/generated/map-bg.png').convert('RGBA').getdata())",
  "for resource in manifest['objectResources']:",
  " im=Image.open(root/resource['path'])",
  " assert im.mode=='P' and im.info['transparency']==0",
  " assert len({p for p in im.getdata() if p})==1",
 ].join('\n')],{encoding:'utf8'})
 assert.equal(pngCheck.status,0,pngCheck.stderr)
 result=await runConfiguredMapExporter({projectPath:root,mapPath})
 assert.equal(result.success,true,result.error)
 assert.equal(result.transaction.transactionId,null,'unchanged map reuses all derived outputs')
 const sdkIndex=process.argv.indexOf('--sgdk')
 if(sdkIndex>=0){
  const sdk=path.resolve(process.argv[sdkIndex+1])
  const make=spawnSync('make',['release','GDK='+sdk],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  assert.equal(make.status,0,String(make.stdout).slice(-8000)+String(make.stderr).slice(-8000))
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'))
  assert.ok(rom.subarray(256,272).toString('ascii').includes('SEGA'))
  console.log('PASS: editor TMX -> sprite PNG/ResComp -> skeleton scene ROM ('+rom.length+' bytes)')
 }
 // Other resource declarations must keep shared PNGs and their SPRITE symbol.
 const shared=first.objectResources[0]
 const resPath=path.join(root,'res/resources.res')
 fs.appendFileSync(resPath,'SPRITE EXTERNAL_OBJECT "'+shared.path.slice(4)+'" '+shared.width/8+' '+shared.height/8+' NONE 0 NONE\n')
 // Palette changes regenerate resources; publication removes only old owned files.
 const recolor=spawnSync('python3',['-c',"from PIL import Image\nim=Image.open("+JSON.stringify(image)+").convert('RGBA')\nim.putpixel((4,3),(32,192,96,255))\nim.save("+JSON.stringify(image)+")"],{encoding:'utf8'})
 assert.equal(recolor.status,0,recolor.stderr)
 result=await runConfiguredMapExporter({projectPath:root,mapPath})
 assert.equal(result.success,true,result.error)
 const next=JSON.parse(fs.readFileSync(manifestPath,'utf8'))
 assert.ok(next.objectResources.some(r=>r.path===shared.path && r.retained))
 assert.ok(fs.existsSync(path.join(root,shared.path)),'shared derived image preserved')
 assert.ok(fs.readFileSync(resPath,'utf8').includes('SPRITE '+shared.symbol+' '),'shared original declaration preserved')
 assert.ok(first.objectResources.filter(r=>r.path!==shared.path).every(r=>!fs.existsSync(path.join(root,r.path))),'unused owned object sprites removed')
 // Once the external consumer is removed, the derivative can be cleaned.
 fs.writeFileSync(resPath,fs.readFileSync(resPath,'utf8').split(/\r?\n/).filter(line=>!line.startsWith('SPRITE EXTERNAL_OBJECT ')).join('\n'))
 result=await runConfiguredMapExporter({projectPath:root,mapPath})
 assert.equal(result.success,true,result.error)
 assert.ok(!fs.existsSync(path.join(root,shared.path)))
 next.objectResources=JSON.parse(fs.readFileSync(manifestPath,'utf8')).objectResources
 assert.ok(fs.existsSync(image),'original sprite image preserved')
 // Customized derivatives are never removed or overwritten.
 const managed=next.objectResources[0]
 const original=fs.readFileSync(path.join(root,managed.path))
 fs.appendFileSync(path.join(root,managed.path),'custom')
 await assert.rejects(runConfiguredMapExporter({projectPath:root,mapPath}),/modified; preserved/)
 fs.writeFileSync(path.join(root,managed.path),original)
 // Exact bundled tools are known; any customization restores conservative
 // retention rather than treating arbitrary scripts as safe consumers.
 const compilerPath=path.join(root,'tools/cutscene-export.mjs')
 const compilerBytes=fs.readFileSync(compilerPath)
 fs.appendFileSync(compilerPath,'\n// custom consumer\n')
 save([objects[3]])
 result=await runConfiguredMapExporter({projectPath:root,mapPath})
 assert.equal(result.success,true,result.error)
 assert.ok(next.objectResources.every(r=>fs.existsSync(path.join(root,r.path))),'modified distributed tools preserve uncertain resources')
 fs.writeFileSync(compilerPath,compilerBytes)
 result=await runConfiguredMapExporter({projectPath:root,mapPath})
 assert.equal(result.success,true,result.error)
 assert.equal(JSON.parse(fs.readFileSync(manifestPath,'utf8')).objectResources.length,0)
 assert.ok(next.objectResources.every(r=>!fs.existsSync(path.join(root,r.path))))
 assert.ok(!fs.readFileSync(path.join(root,'res/resources.res'),'utf8').includes('SPRITE GAME_MAP_OBJECT_'))
 assert.ok(fs.readFileSync(path.join(root,'src/generated/map_objects.h'),'utf8').includes('GAME_MAP_OBJECT_COUNT 0'))
 assert.ok(fs.existsSync(image))
 // Invalid crops and unknown types never publish a partial map generation.
 // An object placed entirely outside the map can never be seen: the exporter says so
 // instead of exporting it (a fixture once used pixels where the TMX writer expects tiles).
 save([{...objects[0],x:60}]) // 480 px in a 320 px wide map
 {const outside=await runConfiguredMapExporter({projectPath:root,mapPath});assert.equal(outside.success,false);assert.match(JSON.stringify(outside),/fora do mapa/)}
 save([{...objects[0],visual:{...visual,gid:99999}}])
 result=await runConfiguredMapExporter({projectPath:root,mapPath})
 assert.equal(result.success,false)
 assert.match(result.error,/GID sem tileset/)
 assert.equal(JSON.parse(fs.readFileSync(manifestPath,'utf8')).objectResources.length,0)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Map objects: serialized kit visuals, positions/scaling, stable IDs, palettes, timing, preview exclusion, re-use and owned cleanup passed.')
