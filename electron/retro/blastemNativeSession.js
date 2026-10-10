// #64: sessão com o depurador nativo do BlastEm (blastem -d), que conversa por um terminal.
// Mesma interface de DebugSession (protocolo do GDB), mais VDP, avanço por quadros e KDebug.
import {EventEmitter} from 'node:events'
import {readTerminal,withoutEcho,parsePrint,M68K_NAMES,nativeCommands,memoryPlan,parseBreakpointSet,parseStop,parseVdpRegisters,parseVdpSprites} from '../../shared/retro/blastemDebugger.js'
const MEMORY_LIMIT=1024,FRAME_LIMIT=600
const RUNNING='O jogo está rodando. Este emulador só devolve o controle em um breakpoint; encerre a sessão para parar.'
const SILENT='O emulador parou de responder aos comandos de depuração. A sessão foi encerrada.'
/**
 * `launch(emulatorPath, args, cwd)` devolve um terminal: {write(text), onData(fn), onExit(fn), kill()}.
 * Eventos: 'state' ({state,reason,registers}), 'closed' ({reason}) e 'log' ({lines}: mensagens KDebug do jogo).
 */
export class BlastemNativeSession extends EventEmitter{
 constructor({backend,emulatorPath,romPath,launch,cwd,timeout=4000,startTimeout=15000}){
  super();Object.assign(this,{backend,emulatorPath,romPath,launch,cwd,timeout,startTimeout})
  this.state='idle';this.buffer='';this.pending=null;this.queue=Promise.resolve();this.breakpoints=new Set();this.indexes=new Map();this.terminal=null
 }
 #set(state,extra={}){this.state=state;this.emit('state',{state,...extra})}
 #close(reason){
  if(this.state==='closed')return
  const pending=this.pending;this.pending=null;this.state='closed'
  if(pending){clearTimeout(pending.timer);pending.reject(Error(reason))}
  this.emit('closed',{reason})
 }
 #onData(chunk){
  this.buffer+=chunk
  if(this.buffer.length>4*1024*1024){this.#close('O emulador enviou dados demais; sessão encerrada.');this.stop();return}
  const {logs,replies,rest}=readTerminal(this.buffer);this.buffer=rest
  if(logs.length)this.emit('log',{lines:logs})
  for(const reply of replies){
   const pending=this.pending;if(!pending)continue // prompt de um comando que já expirou
   this.pending=null;clearTimeout(pending.timer);pending.resolve(pending.command===null?reply:withoutEcho(reply,pending.command))
  }
 }
 /** command null = só espera o próximo prompt (início). timeout 0 = sem limite. */
 #send(command,timeout=this.timeout){
  return new Promise((resolve,reject)=>{
   if(this.state==='closed'||!this.terminal)return reject(Error('A sessão de depuração terminou.'))
   this.pending={command,resolve,reject,timer:timeout?setTimeout(()=>{
    this.pending=null
    if(this.state!=='starting'&&this.state!=='closed'){this.#close(SILENT);this.stop()}
    reject(Error(SILENT))
   },timeout):null}
   if(command!==null)this.terminal.write(command+'\n')
  })
 }
 #serial(action){
  if(this.state==='running')return Promise.reject(Error(RUNNING))
  const run=this.queue.then(action,action);this.queue=run.catch(()=>{});return run
 }
 #requireStopped(){
  if(this.state==='running')throw Error(RUNNING)
  if(this.state!=='stopped')throw Error('Não há sessão de depuração parada.')
 }
 async #registers(){
  const values=parsePrint(await this.#send(nativeCommands.registers),M68K_NAMES)
  return Object.fromEntries(M68K_NAMES.map((name,index)=>[name,values[index]]))
 }
 async start(){
  if(this.state!=='idle')throw Error('A sessão já foi iniciada.')
  if(!this.backend?.capabilities?.registers)throw Error('Este emulador não oferece depuração.')
  this.state='starting'
  try{this.terminal=this.launch(this.emulatorPath,['-d',this.romPath],this.cwd)}
  catch(error){this.#close('Não foi possível iniciar o emulador: '+error.message);throw Error('Não foi possível iniciar o emulador: '+error.message)}
  this.terminal.onData(chunk=>this.#onData(String(chunk)))
  this.terminal.onExit(event=>this.#close(this.stopping?'Sessão encerrada.':'O emulador foi fechado'+(event?.exitCode?' (código '+event.exitCode+')':'')+'. A sessão de depuração terminou.'))
  let registers
  try{
   // O emulador para na primeira instrução e mostra o prompt.
   await this.#send(null,this.startTimeout)
   this.state='stopped';registers=await this.#registers()
  }catch(error){
   const closed=this.state==='closed'&&!/parou de responder/.test(error.message);this.stop()
   throw Error(closed?error.message:'O emulador não respondeu como depurador em '+Math.round(this.startTimeout/1000)+' s. Se ele mostrou um aviso na própria janela, confirme-o e tente de novo.')
  }
  this.#set('stopped',{reason:'start',registers})
  return registers
 }
 registers(){return this.#serial(async()=>{this.#requireStopped();return this.#registers()})}
 /** Lê até 1024 bytes do barramento do 68000. */
 memory(address,length){
  return this.#serial(async()=>{
   this.#requireStopped()
   if(!Number.isInteger(address)||!Number.isInteger(length)||address<0||address>0xFFFFFF||length<1||length>MEMORY_LIMIT||address+length>0x1000000)throw Error('Faixa de memória inválida (endereços de 24 bits, até '+MEMORY_LIMIT+' bytes por leitura neste emulador).')
   const out=new Uint8Array(length);let offset=0
   for(const group of memoryPlan(address,length)){
    const values=parsePrint(await this.#send(nativeCommands.read(group)),group.map(item=>'[$'+item.address.toString(16)+'].'+item.size))
    group.forEach((item,index)=>{for(let byte=0;byte<item.bytes;byte++)out[offset++]=(values[index]>>>(8*(item.bytes-1-byte)))&255})
   }
   return out
  })
 }
 setBreakpoint(address,enabled=true){
  return this.#serial(async()=>{
   this.#requireStopped()
   if(!Number.isInteger(address)||address<0||address>0xFFFFFF||address&1)throw Error('Endereço de breakpoint inválido (par, até 0xFFFFFF).')
   if(enabled===this.breakpoints.has(address))return [...this.breakpoints]
   if(enabled){
    if(this.breakpoints.size>=64)throw Error('Limite de 64 breakpoints por sessão.')
    const set=parseBreakpointSet(await this.#send(nativeCommands.breakpoint(address)))
    if(!set||set.address!==address)throw Error('O emulador recusou o breakpoint em 0x'+address.toString(16).toUpperCase()+'.')
    this.breakpoints.add(address);this.indexes.set(address,set.index)
   }else{
    const reply=await this.#send(nativeCommands.removeBreakpoint(this.indexes.get(address)))
    if(/does not exist/.test(reply))throw Error('O emulador não encontrou o breakpoint em 0x'+address.toString(16).toUpperCase()+'.')
    this.breakpoints.delete(address);this.indexes.delete(address)
   }
   return [...this.breakpoints]
  })
 }
 async #resume(command,reason,timeout){
  this.#requireStopped()
  this.#set('running')
  let stop
  try{
   stop=parseStop(await this.#send(command,timeout))
   // Uma linha do jogo começando com "> " parece um prompt: se não veio a instrução da parada,
   // o jogo continua rodando e o prompt de verdade ainda vai chegar.
   for(let extra=0;!stop&&extra<8;extra++)stop=parseStop(await this.#send(null,timeout))
  }catch(error){if(this.state!=='closed'){this.#close(error.message);this.stop()}throw error}
  if(!stop){this.#close('Resposta inesperada do emulador; sessão encerrada.');this.stop();throw Error('Resposta inesperada do emulador.')}
  let registers
  try{registers=await this.#registers()}catch(error){if(this.state!=='closed'){this.#close(error.message);this.stop()}throw error}
  this.#set('stopped',{reason:stop.breakpoint!==null?'breakpoint':reason,registers})
  return registers
 }
 step(){return this.#serial(()=>this.#resume(nativeCommands.step,'step',this.timeout))}
 continue(){return this.#serial(()=>this.#resume(nativeCommands.continue,'stopped',0))}
 /** Roda N quadros de vídeo e volta ao depurador (ou antes, em um breakpoint). */
 frames(count){
  if(!Number.isInteger(count)||count<1||count>FRAME_LIMIT)return Promise.reject(Error('Informe de 1 a '+FRAME_LIMIT+' quadros.'))
  // 50 ms por quadro de folga: o emulador pode estar mais lento que o tempo real.
  return this.#serial(()=>this.#resume(nativeCommands.frames(count),'frames',this.timeout+count*50))
 }
 /** Registros do VDP e lista de sprites, lidos do chip emulado. */
 vdp(){
  return this.#serial(async()=>{
   this.#requireStopped()
   const registers=parseVdpRegisters(await this.#send(nativeCommands.vdpRegisters))
   return {...registers,sprites:parseVdpSprites(await this.#send(nativeCommands.vdpSprites))}
  })
 }
 stop(){
  this.stopping=true
  try{this.terminal?.kill()}catch{/* já terminou */}
  if(this.state!=='closed')this.#close('Sessão encerrada.')
 }
}
