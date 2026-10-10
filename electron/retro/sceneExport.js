import path from 'node:path'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {compileScene} from '../../shared/retro/sceneCompiler.js'
import {readProjectOutput,publishProjectOutputs} from './exportTransaction.js'
import {runtimeInstallationStatus} from './runtimeInstaller.js'
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex')
function bounded(root,name,limit=1024*1024){
 const bytes=readProjectOutput(root,name);
 if(bytes && bytes.length>limit)throw Error('Scene input exceeds limit: '+name);
 return bytes;
}
/* Caller supplies the main process workspace, never a renderer-selected root. */
export function exportSceneForProject(projectPath,scene){
 const root=fs.realpathSync(projectPath);
 if(scene?.projectPath && path.resolve(scene.projectPath)!==path.resolve(projectPath) && path.resolve(scene.projectPath)!==root)
  throw Error('Scene belongs to another workspace.');
 if(Buffer.byteLength(JSON.stringify(scene??null))>256*1024)throw Error('Scene exceeds 256 KiB.');
 const resources=bounded(root,'res/resources.res');
 if(resources===null)throw Error('Missing res/resources.res.');
 const symbols=[];
 for(const line of resources.toString('utf8').split(/\r?\n/)){
  const match=line.match(/^\s*SPRITE\s+([A-Za-z_][A-Za-z0-9_]*)\s+"/);
  if(match){
   if(symbols.includes(match[1]))throw Error('Duplicate SPRITE declaration: '+match[1]);
   symbols.push(match[1]);
  }
 }
 const result=compileScene(scene,{spriteResources:symbols});
 const status=runtimeInstallationStatus(root);
 if(status.files.filter(f=>f.moduleId==='scene').some(f=>f.status!=='current'))
  throw Error('Install or update the scene module in Resources > Runtime before exporting.');
 const base='src/generated/scene_'+result.name;
 const recordPath='.retrostudio/scene-exports/'+result.name+'.json';
 const record=bounded(root,recordPath,64*1024);
 let owned=null;
 if(record!==null){
  owned=JSON.parse(record.toString('utf8'));
  if(owned.version!==1||owned.name!==result.name||!Array.isArray(owned.files)||owned.files.length!==2||
   owned.files.some((f,i)=>f.path!==base+['.c','.h'][i]||!/^[a-f0-9]{64}$/.test(f.hash)))
   throw Error('Invalid scene export ownership record.');
 }
 const outputs=['.c','.h'].map((extension,i)=>{
  const target=base+extension,current=bounded(root,target);
  if(current!==null && hash(current)!==owned?.files[i].hash)throw Error('Scene output is customized or unmanaged; preserved: '+target);
  return {path:target,bytes:Buffer.from(i===0?result.source:result.header),expectedHash:hash(current)};
 });
 const metadata={version:1,name:result.name,objects:result.objects,files:outputs.map(o=>({path:o.path,hash:hash(o.bytes)}))};
 outputs.push({path:recordPath,bytes:Buffer.from(JSON.stringify(metadata,null,2)+'\n'),expectedHash:hash(record)});
 // Guard the same resources/runtime bytes used for generation under the writer lock.
 outputs.push({path:'res/resources.res',bytes:resources,expectedHash:hash(resources)});
 for(const file of status.files.filter(f=>f.moduleId==='scene')){
  const bytes=bounded(root,file.path,256*1024);
  if(hash(bytes)!==file.newHash)throw Error('Scene runtime changed during export; reload.');
  outputs.push({path:file.path,bytes,expectedHash:hash(bytes)});
 }
 const receipt=publishProjectOutputs(root,outputs,{producer:'scene-export'});
 return {...receipt,path:path.join(root,base+'.c'),headerPath:path.join(root,base+'.h'),objects:result.objects};
}
