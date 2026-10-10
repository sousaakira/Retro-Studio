// #64: uma sessão de depuração por janela da IDE. Junta o backend do emulador (debugSession.js)
// com os símbolos do jogo compilado (debugSymbols.js) e diz, a cada parada, onde o jogo está.
import fs from 'node:fs'
import path from 'node:path'
import {DEBUG_BACKENDS,DebugSession} from './debugSession.js'
import {BlastemNativeSession} from './blastemNativeSession.js'
import {loadDebugSymbols,describeAddress,addressLines,resolveLocation,resolveData} from './debugSymbols.js'
import {lastBuildFlavor} from './buildFlavor.js'
const hex=(value,digits=6)=>'0x'+value.toString(16).toUpperCase().padStart(digits,'0')
const RAM_START=0xFF0000
/** Conferido com o BlastEm 0.6.3: fora da ROM e da RAM o stub devolve valores sem sentido e, em
 * leituras maiores na área do VDP, para de responder. Backends com memoryScope 'rom-and-ram' só leem as duas. */
function memoryRegion(address,length,romSize){
 const end=address+length
 if(end<=romSize)return 'ROM'
 if(address>=RAM_START)return 'RAM do 68000'
 return null
}
/**
 * @param {{toolkit:()=>string, emulatorPath:(id:string)=>string|null, selectedEmulator:()=>string,
 *   build:(projectPath:string,toolkit:string,options:object)=>Promise<object>, buildBusy?:()=>boolean,
 *   send:(event:object)=>void, launch?:Function, launchTerminal?:Function, startTimeout?:number}} host
 * launch abre o emulador com entrada/saída em pipes (GDB); launchTerminal, em um terminal (depurador nativo).
 */
export function createDebugService(host){
 let active=null // {session, symbols, projectPath, backend, labels:Map<address,label>, last:{stop,reason}}
 let cancelBuild=null
 const toolkit=()=>host.toolkit()||''
 const backends=()=>DEBUG_BACKENDS.map(backend=>{const file=host.emulatorPath(backend.emulator);return {...backend,installed:!!(file&&fs.existsSync(file))}})
 function game(projectPath){
  const symbols=loadDebugSymbols(projectPath,toolkit())
  if(!symbols)return {symbols:null,summary:{rom:null,flavor:lastBuildFlavor(projectPath),functions:0,hasLines:false,association:'missing',sourcesChanged:false}}
  return {symbols,summary:{rom:symbols.rom?{path:symbols.rom.path,size:symbols.rom.size}:null,elf:symbols.elf.path,flavor:lastBuildFlavor(projectPath),functions:symbols.functions.length,
   variables:symbols.objects.length,hasLines:symbols.hasLines,association:symbols.association,sourcesChanged:symbols.sourcesChanged}}
 }
 /** Onde o jogo parou. A linha de C só é oferecida como navegável quando há prova de que a ROM,
  * os símbolos e os fontes no disco são do mesmo build. */
 function where(registers){
  const {symbols,projectPath}=active,pc=registers.pc&0xffffff,inFunction=describeAddress(symbols,pc)
  const line=addressLines(symbols,[pc],toolkit()).get(pc)||null
  // O recibo e os fontes são conferidos de novo a cada parada: editar ou reconstruir com a
  // sessão aberta tira o link, porque o emulador segue com a ROM antiga.
  let now=null
  try{now=loadDebugSymbols(projectPath,toolkit())}catch{/* tratado como "mudou" */}
  const rebuilt=!now||now.elf.hash!==symbols.elf.hash||now.rom?.hash!==symbols.rom.hash
  let source=null,sourceNote=''
  if(rebuilt)sourceNote='O jogo foi construído de novo depois do início desta sessão: o emulador ainda roda a ROM antiga. Encerre e inicie a depuração'+(line?.file?' (linha no build antigo: '+line.file+':'+line.line+').':'.')
  else if(!symbols.hasLines)sourceNote='Sem linha de C: o jogo não foi construído para depurar.'
  else if(!line)sourceNote='Este endereço não corresponde a uma linha de C (código de montagem ou da biblioteca).'
  else if(!line.file)sourceNote='A linha é de um arquivo fora do projeto ('+line.external+':'+line.line+').'
  else if(now.association!=='proven')sourceNote='Linha '+line.file+':'+line.line+', mas não há registro de build da IDE ligando esta ROM a estes símbolos. Construa de novo pela IDE.'
  else if(now.sourcesChanged)sourceNote='Linha '+line.file+':'+line.line+' no build, mas os fontes mudaram depois: a posição pode estar deslocada.'
  else source={file:line.file,line:line.line}
  return {pc,pcText:hex(pc),function:inFunction,source,sourceNote,registers}
 }
 function snapshot(){
  if(!active)return null
  return {state:active.session.state,backend:active.backend.id,projectPath:active.projectPath,rom:active.symbols.rom.path,last:active.last||null,
   breakpoints:[...active.session.breakpoints].sort((a,b)=>a-b).map(address=>({address,addressText:hex(address),label:active.labels.get(address)||hex(address)}))}
 }
 function requireActive(projectPath){
  if(!active||active.session.state==='closed')throw Error('Não há sessão de depuração aberta.')
  if(active.projectPath!==projectPath)throw Error('A sessão de depuração é de outro projeto. Encerre-a antes.')
  return active
 }
 function dispose(){const current=active;active=null;current?.session.removeAllListeners();current?.session.stop()}
 return {
  status(projectPath){
   let info
   try{info=game(projectPath).summary}catch(error){info={rom:null,flavor:lastBuildFlavor(projectPath),functions:0,hasLines:false,association:'missing',sourcesChanged:false,error:error.message}}
   // Trocou de projeto com uma sessão aberta: ela não teria mais tela para encerrá-la.
   if(active&&active.projectPath!==projectPath){const old=active.projectPath;dispose();host.send({type:'closed',projectPath:old,reason:'Sessão encerrada: outro projeto foi aberto.'})}
   const mine=active&&active.projectPath===projectPath&&active.session.state!=='closed'
   return {success:true,backends:backends(),selectedEmulator:host.selectedEmulator(),game:info,session:mine?snapshot():null,building:!!cancelBuild}
  },
  async build(projectPath){
   if(active)throw Error('Encerre a sessão de depuração antes de construir.')
   if(host.buildBusy?.())throw Error('Já há um build em andamento.')
   if(cancelBuild)throw Error('Já há um build para depurar em andamento.')
   cancelBuild=()=>{}
   let result
   try{result=await host.build(projectPath,toolkit(),{flavor:'debug',onProcess:stop=>{cancelBuild=stop}})}finally{cancelBuild=null}
   if(result.success)return {success:true,error:'',errors:[]}
   // Sem erro reconhecido de compilação, o fim da saída do make é a única pista.
   const tail=!result.error&&!(result.errors||[]).some(item=>item.type!=='warning'&&item.type!=='note')?String(result.stderr||'').trim().split(/\r?\n/).slice(-4).join(' ').slice(-400):''
   return {success:false,cancelled:!!result.cancelled,error:result.error||'O build para depurar falhou.'+(result.diagnosis?.message?' '+result.diagnosis.message:'')+(tail?' Fim da saída do make: '+tail:''),errors:(result.errors||[]).slice(0,100)}
  },
  cancelBuild(){
   if(!cancelBuild)throw Error('Não há build para depurar em andamento.')
   cancelBuild();return {success:true}
  },
  async start(projectPath,{backend:backendId}={}){
   const backend=backends().find(item=>item.id===backendId)
   if(!backend)throw Error('Backend de depuração desconhecido.')
   if(!backend.capabilities.registers)throw Error(backend.label+' não oferece depuração. '+backend.notes.join(' '))
   if(!backend.installed)throw Error(backend.label+' não está instalado. Instale o emulador em Configurações → Emuladores.')
   const {symbols}=game(projectPath)
   if(!symbols?.rom)throw Error('Não há jogo compilado. Construa o projeto antes de depurar.')
   dispose()
   const emulatorPath=host.emulatorPath(backend.emulator),timing=host.startTimeout?{startTimeout:host.startTimeout}:{}
   if(backend.driver==='native'&&!host.launchTerminal)throw Error('Este backend precisa de um terminal, que não está disponível nesta instalação.')
   const session=backend.driver==='native'
    ?new BlastemNativeSession({backend,emulatorPath,romPath:symbols.rom.real,launch:host.launchTerminal,cwd:path.dirname(emulatorPath),...timing})
    :new DebugSession({backend,emulatorPath,romPath:symbols.rom.real,...(host.launch?{launch:host.launch}:{}),...timing})
   const current=active={session,symbols,projectPath,backend,labels:new Map()}
   session.on('log',event=>{if(active===current)host.send({type:'log',projectPath,lines:event.lines.slice(-200).map(line=>String(line).slice(0,300))})})
   session.on('state',event=>{
    if(active!==current)return
    if(event.registers)current.last={stop:where(event.registers),reason:event.reason||''}
    host.send({type:'state',projectPath,session:snapshot(),reason:event.reason||'',stop:event.registers?current.last.stop:null})
   })
   // Falha ao iniciar volta como erro da própria chamada; só sessões já abertas avisam o fechamento.
   let opened=false
   session.on('closed',event=>{if(active!==current)return;active=null;if(opened)host.send({type:'closed',projectPath,reason:event.reason})})
   try{await session.start();opened=true}catch(error){if(active===current)active=null;throw error}
   return {success:true,session:snapshot()}
  },
  async command(projectPath,payload={}){
   const current=requireActive(projectPath),{session,symbols,labels,backend}=current
   const running=()=>{if(session.state==='running')throw Error('O jogo está rodando. Este emulador só devolve o controle em um breakpoint; encerre a sessão para parar.')}
   switch(payload.command){
    case 'step':await session.step();return {success:true}
    // A parada chega pelo evento 'state': continuar pode levar minutos ou nunca voltar.
    case 'continue':running();session.continue().catch(()=>{});return {success:true,warning:session.breakpoints.size?'':'Sem breakpoints ativos o jogo roda até a sessão ser encerrada: este emulador não tem pausa.'}
    case 'registers':{const registers=await session.registers();if(active!==current)throw Error('A sessão de depuração terminou.');return {success:true,stop:where(registers)}}
    case 'breakpoint':{
     const target=typeof payload.address==='number'?{address:payload.address,label:labels.get(payload.address)||hex(payload.address)}:resolveLocation(symbols,String(payload.location||'').slice(0,200))
     await session.setBreakpoint(target.address,payload.enabled!==false)
     if(payload.enabled!==false)labels.set(target.address,target.label);else labels.delete(target.address)
     return {success:true,session:snapshot()}
    }
    case 'memory':{
     const target=typeof payload.address==='number'?{address:payload.address,size:0,label:hex(payload.address)}:resolveData(symbols,String(payload.location||'').slice(0,200))
     const length=Math.max(1,Math.min(backend.memoryLimit||4096,Number.isInteger(payload.length)?payload.length:(target.size||64)))
     const size=Math.min(length,0x1000000-target.address),region=memoryRegion(target.address,size,symbols.rom.size)
     if(!region&&backend.memoryScope==='rom-and-ram')throw Error('Este emulador só lê a ROM (0x000000–'+hex(symbols.rom.size-1)+') e a RAM do 68000 (0xFF0000–0xFFFFFF). Fora delas ele devolve valores sem sentido ou para de responder.')
     const bytes=await session.memory(target.address,size)
     return {success:true,address:target.address,addressText:hex(target.address),label:target.label,bytes:[...bytes],region:region||'fora da ROM e da RAM'}
    }
    case 'frames':{
     if(!backend.capabilities.frames)throw Error(backend.label+' não avança por quadros.')
     running();if(!Number.isInteger(payload.count)||payload.count<1||payload.count>600)throw Error('Informe de 1 a 600 quadros.')
     session.frames(payload.count).catch(()=>{});return {success:true}
    }
    case 'vdp':{
     if(!backend.capabilities.vdp)throw Error(backend.label+' não lê o VDP.')
     return {success:true,vdp:await session.vdp()}
    }
    case 'stop':dispose();host.send({type:'closed',projectPath,reason:'Sessão encerrada.'});return {success:true}
    default:throw Error('Comando de depuração desconhecido.')
   }
  },
  dispose
 }
}
