// #52: unsaved work of the visual editors, kept inside the project so that a crash, a power
// cut or a project switch does not lose it. A draft never replaces a source file by itself:
// the editor offers it and the user decides.
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
const DIRECTORY='.retrostudio/drafts'
const EDITOR=/^[a-z][a-z0-9-]{0,31}$/
// A dense 256x256 map with two layers serializes to about 1.5 MiB of TMX.
const limit=editor=>editor.startsWith('map-')?4*1024*1024:1024*1024
function target(projectPath,editor){
 if(typeof editor!=='string'||!EDITOR.test(editor))throw Error('Invalid draft name.')
 const root=fs.realpathSync(projectPath)
 // Every existing ancestor must be a real directory of this project: no link may redirect a draft.
 let current=root
 for(const part of DIRECTORY.split('/')){
  current=path.join(current,part)
  let info=null
  try{info=fs.lstatSync(current)}catch(error){if(error.code!=='ENOENT')throw error}
  if(info&&(info.isSymbolicLink()||!info.isDirectory()))throw Error('Draft folder is not a regular directory.')
 }
 return {root,directory:current,file:path.join(current,editor+'.json')}
}
/** null when there is no usable draft. An unreadable draft is reported, never guessed. */
export function readEditorDraft(projectPath,editor){
 const {file}=target(projectPath,editor)
 let info
 try{info=fs.lstatSync(file)}catch(error){if(error.code==='ENOENT')return null;throw error}
 if(!info.isFile()||info.size>limit(editor))return {unreadable:true}
 try{
  const draft=JSON.parse(fs.readFileSync(file,'utf8'))
  if(draft?.version!==1||draft.editor!==editor||typeof draft.savedAt!=='string'||draft.savedAt.length>64||!('state' in draft)||(draft.baseRevision!==null&&typeof draft.baseRevision!=='string'))return {unreadable:true}
  return {savedAt:draft.savedAt,baseRevision:draft.baseRevision,state:draft.state}
 }catch{return {unreadable:true}}
}
/** Atomic: a crash while writing leaves the previous draft (or none), never half of one. */
export function writeEditorDraft(projectPath,editor,{baseRevision=null,state}={}){
 if(state===undefined||(baseRevision!==null&&(typeof baseRevision!=='string'||baseRevision.length>256)))throw Error('Invalid draft.')
 const {directory,file}=target(projectPath,editor)
 const bytes=Buffer.from(JSON.stringify({version:1,editor,savedAt:new Date().toISOString(),baseRevision,state})+'\n')
 if(bytes.length>limit(editor))throw Error('Draft exceeds '+limit(editor)/1024/1024+' MiB.')
 fs.mkdirSync(directory,{recursive:true})
 // Drafts are local to this machine: the folder ignores itself, in every project, old or new.
 const ignore=path.join(directory,'.gitignore')
 if(!fs.existsSync(ignore))try{fs.writeFileSync(ignore,'*\n',{flag:'wx'})}catch{/* another writer got there first */}
 const temporary=path.join(directory,'.'+editor+'-'+randomUUID()+'.tmp')
 try{fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,file)}
 finally{try{fs.unlinkSync(temporary)}catch{/* renamed or never created */}}
 return {saved:true}
}
export function clearEditorDraft(projectPath,editor){
 const {file}=target(projectPath,editor)
 try{if(fs.lstatSync(file).isFile())fs.unlinkSync(file)}catch(error){if(error.code!=='ENOENT')throw error}
 return {cleared:true}
}
