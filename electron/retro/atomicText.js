// #52: text saves replace the file in one step. A crash or power cut in the middle of a save
// leaves the previous contents intact instead of a truncated source file.
// What a plain write would do stays true: a read-only file is refused, links (symbolic or hard)
// keep pointing to the same file, and a file that can be written in a folder that cannot is
// still saved (directly, since no temporary file can be created beside it).
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
const DIRECT=new Set(['EACCES','EPERM','EBUSY','EXDEV','EROFS'])
export async function writeTextFileAtomically(file,contents){
 let target=file,info=null
 try{
  const link=await fs.lstat(file)
  // A dangling link keeps being a link: the file it names is created.
  target=link.isSymbolicLink()?await fs.realpath(file).catch(async()=>path.resolve(path.dirname(file),await fs.readlink(file))):file
  info=await fs.stat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error})
 }catch(error){if(error.code!=='ENOENT')throw error}
 if(info){
  if(!info.isFile())throw Object.assign(Error('Destino não é um arquivo comum: '+target),{code:'EISDIR'})
  await fs.access(target,fs.constants.W_OK) // read-only: refused, as a plain write would be
  // Other names of the same file (hard links) must see the new contents too.
  if(info.nlink>1){await fs.writeFile(target,contents,'utf8');return}
 }
 const temporary=path.join(path.dirname(target),'.'+path.basename(target)+'.'+randomUUID()+'.tmp')
 let created=false
 try{
  const handle=await fs.open(temporary,'wx',info?info.mode&0o777:0o666);created=true
  try{await handle.writeFile(contents,'utf8');await handle.sync()}finally{await handle.close()}
  if(info)await fs.chmod(temporary,info.mode&0o777)
  await fs.rename(temporary,target)
 }catch(error){
  if(created)try{await fs.unlink(temporary)}catch{/* nothing to clean */}
  // No temporary file beside it, or the target is held open by another program (Windows):
  // write in place rather than fail a save that a plain write would have completed.
  if(info&&DIRECT.has(error.code)){await fs.writeFile(target,contents,'utf8');return}
  throw error
 }
}
