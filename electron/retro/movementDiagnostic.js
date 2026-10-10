// #58: only bundled sources/build recipe run; project files are read-only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {resolveRuntimeLibraryPath,installRuntimeModules} from './runtimeInstaller.js'
import {movementConfigurationStatus} from './movementConfiguration.js'
import {readProjectOutput} from './exportTransaction.js'
import {compileMovementHeader} from '../../shared/retro/movementConfiguration.js'
import {compileMovementRoomHeader} from '../../shared/retro/movementRoomHeader.js'
import {fileURLToPath} from 'node:url'
const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function build(root,sdk){
 const executable=process.platform==='win32'?path.join(sdk,'bin/make.exe'):'make'
 await execute(executable,['-j2','release','GDK='+sdk],{cwd:root,timeout:60000,maxBuffer:1024*1024,windowsHide:true,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH}})
}
export function createMovementDiagnosticService({toolkit,launch,runBuild=build}={}){
 const receipts=new Map();let busy=false,disposed=false
 function status(root,revision){
  const data=movementConfigurationStatus(root)
  if(data.revision!==revision)throw Error('Os ajustes mudaram. Recarregue antes de gerar a ROM.')
  if(data.headerConflict||readProjectOutput(root,'physics/movement.json')===null)throw Error('Salve e exporte a física antes de gerar a ROM.')
  return data
 }
 return {
  async build(projectPath,{revision}={}){
   if(disposed)throw Error('A sessão de diagnóstico terminou.')
   if(busy)throw Error('Uma sala de física já está sendo compilada.')
   const project=fs.realpathSync(projectPath),data=status(project,revision),configured=toolkit?.()
   const sdk=typeof configured==='string'?[configured,path.join(configured,'m68k-elf'),path.join(configured,'mars/m68k-elf')].find(candidate=>fs.existsSync(path.join(candidate,'makefile.gen'))):null
   if(!sdk)throw Error('Configure um toolkit SGDK válido nas preferências.')
   busy=true;let root
   try{
    root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'retro-movement-room-')))
    const library=resolveRuntimeLibraryPath();if(!library)throw Error('Runtime distribuído indisponível.')
    const fixtures=path.resolve(library,'../../fixtures')
    const room=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../shared/retro/movementRoom.json',import.meta.url)),'utf8'))
    fs.mkdirSync(path.join(root,'src/generated'),{recursive:true});fs.mkdirSync(path.join(root,'res'))
    installRuntimeModules(root,{moduleIds:['core','collision','movement']})
    fs.copyFileSync(path.join(fixtures,'runtime-movement-sgdk.c'),path.join(root,'src/main.c'))
    fs.copyFileSync(path.join(fixtures,'movement-lab.c'),path.join(root,'src/retro_runtime/movement-lab.inc'))
    fs.writeFileSync(path.join(root,'src/retro_runtime/movement-room-data.h'),compileMovementRoomHeader(room))
    fs.writeFileSync(path.join(root,'src/generated/movement_config.h'),compileMovementHeader(data.config))
    fs.writeFileSync(path.join(root,'res/resources.res'),'')
    fs.writeFileSync(path.join(root,'Makefile'),'include $(GDK)/makefile.gen\n')
    await runBuild(root,sdk)
    if(disposed)throw Error('A sessão de diagnóstico terminou.')
    status(project,revision)
    const romPath=path.join(root,'out/rom.bin'),bytes=fs.readFileSync(romPath)
    if(bytes.length<512||!bytes.subarray(256,272).toString().includes('SEGA'))throw Error('A compilação não gerou uma ROM Mega Drive válida.')
    const token=randomUUID();receipts.set(token,{root,project,romPath,revision,hash:hash(bytes)})
    while(receipts.size>4){const oldest=receipts.keys().next().value;fs.rmSync(receipts.get(oldest).root,{recursive:true,force:true});receipts.delete(oldest)}
    return {success:true,token,romPath,revision,projectPath:project}
   }catch(error){if(root)fs.rmSync(root,{recursive:true,force:true});throw error}
   finally{busy=false}
  },
  dispose(){disposed=true;for(const receipt of receipts.values())fs.rmSync(receipt.root,{recursive:true,force:true});receipts.clear()},
  async open(projectPath,{token,revision}={}){
   if(disposed)throw Error('A sessão de diagnóstico terminou.')
   const project=fs.realpathSync(projectPath),receipt=receipts.get(token)
   if(!receipt||receipt.project!==project||receipt.revision!==revision)throw Error('Gere uma ROM para os ajustes atuais deste projeto.')
   status(project,revision)
   if(fs.realpathSync(receipt.romPath)!==receipt.romPath||hash(fs.readFileSync(receipt.romPath))!==receipt.hash)throw Error('A ROM de diagnóstico mudou. Gere novamente.')
   if(typeof launch!=='function')throw Error('Emulador indisponível.')
   return launch(receipt.romPath)
  }
 }
}
