import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {compileScene} from '../shared/retro/sceneCompiler.js'
import {exportSceneForProject} from '../electron/retro/sceneExport.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
const repository=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-scene-export-'))
const scene={name:'reference',nodes:[
 {id:'scenery-lamp',type:'sprite',resourceId:'OBJECT_LAMP',x:80,y:96,supportX:8,supportY:16,animation:0,palette:1,hFlip:true,priority:true,loop:false,durations:[3,1]},
 {id:18,type:'sprite',resourceId:'OBJECT_LAMP',x:120,y:80,supportX:8,supportY:16,palette:1,loop:true}
]}
function run(command,args,options={}){
 const result=spawnSync(command,args,{encoding:'utf8',timeout:60000,...options})
 assert.equal(result.status,0,result.error?.message||String(result.stdout).slice(-6000)+String(result.stderr).slice(-6000))
 return result
}
try{
 const root=path.join(temporary,'game')
 fs.mkdirSync(path.join(root,'res'),{recursive:true})
 fs.writeFileSync(path.join(root,'res/resources.res'),'SPRITE OBJECT_LAMP "objects.png" 2 2 NONE 2 NONE\n')
 assert.throws(()=>exportSceneForProject(root,scene),/Install or update/)
 installRuntimeModules(root)
 const output=exportSceneForProject(root,scene)
 assert.equal(output.success,true)
 const bytes=fs.readFileSync(output.path)
 const again=exportSceneForProject(root,scene)
 assert.equal(again.transactionId,null)
 assert.deepEqual(again.objects,output.objects)
 const reversed=compileScene({...scene,nodes:[...scene.nodes].reverse()},{spriteResources:['OBJECT_LAMP']})
 assert.equal(reversed.objects.find(o=>o.sourceId==='scenery-lamp').id,output.objects[0].id)
 assert.throws(()=>exportSceneForProject(root,{...scene,projectPath:'/tmp/other-game'}),/another workspace/)
 for(const invalid of [
  {...scene,code:'void main(){}'}, {...scene,name:'../escape'},
  {...scene,nodes:[{...scene.nodes[0],type:'enemy'}]},
  {...scene,nodes:[{...scene.nodes[0],resourceId:'UNKNOWN'}]},
  {...scene,nodes:[scene.nodes[0],scene.nodes[0]]},
  {...scene,nodes:[{...scene.nodes[0],durations:[0]}]},
  {...scene,nodes:[{...scene.nodes[0],priority:'true'}]},
  {...scene,nodes:[{...scene.nodes[0],x:32768}]},
 ]) assert.throws(()=>exportSceneForProject(root,invalid))
 assert.deepEqual(fs.readFileSync(output.path),bytes)
 fs.appendFileSync(output.path,'/* custom */')
 assert.throws(()=>exportSceneForProject(root,scene),/customized or unmanaged/)
 fs.writeFileSync(output.path,bytes)
 const sdkIndex=process.argv.indexOf('--sgdk')
 if(sdkIndex>=0){
  const sdk=path.resolve(process.argv[sdkIndex+1])
  const python=['from PIL import Image',"im=Image.new('P',(32,16),0)",
   'im.putpalette([0,0,0,255,192,64]+[0]*762)','for y in range(2,14):',
   ' for x in range(3,13):','  im.putpixel((x,y),1)',
   '  im.putpixel((16+x,y),1 if y<10 else 0)',
   'im.save('+JSON.stringify(path.join(root,'res/objects.png'))+',bits=4)'].join('\n')
  run('python3',['-c',python])
  fs.writeFileSync(path.join(root,'src/main.c'),[
   '#include <genesis.h>','#include "generated/scene_reference.h"','#include "../res/resources.h"',
   'int main(void){u8 status;SPR_init();PAL_setPalette(PAL1,OBJECT_LAMP.palette->data,DMA);',
   ' status=scene_reference_init();if(status)VDP_drawText("Scene allocation failed",1,1);',
   ' while(1){scene_reference_position(0,0);SPR_update();SYS_doVBlankProcess();scene_reference_tick();}',
   ' return 0;}',''].join('\n'))
  fs.writeFileSync(path.join(root,'Makefile'),'export GDK := '+sdk+'\ninclude $(GDK)/makefile.gen\n')
  run('make',['release'],{cwd:root,maxBuffer:4*1024*1024})
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'))
  assert.ok(rom.length>=512)
  assert.ok(rom.subarray(256,272).toString('ascii').includes('SEGA'))
  console.log('PASS: exported scene + real SPRITE linked into SGDK ROM ('+rom.length+' bytes)')
 }
 const handlers=fs.readFileSync(path.join(repository,'electron/retro/scene.js'),'utf8')
 assert.ok(handlers.includes('exportSceneForProject(resolveWorkspace(), sceneData)'))
 assert.ok(!handlers.includes('sceneData.code ||'))
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Scene export: stable IDs, resources, diagnostics, bounded metadata, workspace/ownership protection and transaction reuse passed.')
