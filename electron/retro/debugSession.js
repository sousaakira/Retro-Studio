// #64: depuração de uma ROM por um backend de emulador. Só o que o backend comprovadamente
// faz é oferecido; o resto é dito como "não disponível", nunca simulado.
import {spawn} from 'node:child_process'
import path from 'node:path'
import {EventEmitter} from 'node:events'
import {encodePacket,parseStream,commands,parseM68kRegisters,parseStopReply,hexToBytes} from '../../shared/retro/gdbRemote.js'

const NONE=Object.freeze({step:false,continue:false,frames:false,breakpoints:false,registers:false,memory:false,vdp:false,kdebug:false,pause:false,inputRecording:false})
/** Capacidades conferidas com o BlastEm 0.6.3 (scripts/smoke-debug-session.mjs --blastem). */
export const DEBUG_BACKENDS=Object.freeze([
 {id:'blastem-native',emulator:'blastem',driver:'native',label:'BlastEm · depurador nativo',memoryScope:'rom-and-ram',memoryLimit:1024,
  capabilities:{...NONE,step:true,continue:true,frames:true,breakpoints:true,registers:true,memory:true,vdp:true,kdebug:true},
  notes:['Com o jogo rodando, o emulador só devolve o controle em um breakpoint ou ao fim dos quadros pedidos: não há pausa.','Do VDP são lidos os registros e a lista de sprites. VRAM e CRAM aparecem só nas janelas do próprio BlastEm (teclas v e c).','A leitura de memória vale para a ROM e a RAM do 68000 (até 1024 bytes por vez); fora delas a leitura mexeria no hardware emulado.','Não há gravação nem reprodução de entradas: o comando de simular botões desta versão do BlastEm não funciona.']},
 {id:'blastem-gdb',emulator:'blastem',driver:'gdb',label:'BlastEm · protocolo remoto do GDB',memoryScope:'rom-and-ram',memoryLimit:4096,
  capabilities:{...NONE,step:true,continue:true,breakpoints:true,registers:true,memory:true},
  notes:['Com o jogo rodando, o emulador só devolve o controle em um breakpoint: não há pausa nem avanço por quadros.','VRAM, CRAM e registros do VDP não são expostos por este protocolo; use o depurador nativo.','A leitura de memória vale para a ROM e a RAM do 68000. Fora delas (portas de E/S, Z80, VDP) o emulador devolve valores sem sentido ou para de responder, por isso a IDE recusa a leitura.','Não há gravação nem reprodução de entradas por este protocolo.']},
 {id:'gen_sdl2',emulator:'gen_sdl2',driver:null,label:'Genesis Plus GX',capabilities:NONE,notes:['Este emulador só executa a ROM; não oferece interface de depuração.']},
 {id:'picodrive',emulator:'picodrive',driver:null,label:'PicoDrive',capabilities:NONE,notes:['Este emulador só executa a ROM; não oferece interface de depuração.']}
])
// O stub do BlastEm corta cada resposta em 255 bytes; 128 deixa folga.
const MEMORY_CHUNK=128,MEMORY_LIMIT=4096
const SILENT='O emulador parou de responder aos comandos de depuração. A sessão foi encerrada.'
const RUNNING='O jogo está rodando. Este emulador só devolve o controle em um breakpoint; encerre a sessão para parar.'
/**
 * Uma sessão = um processo de emulador. Estados: starting → stopped ⇄ running → closed.
 * Eventos: 'state' ({state,reason,registers}) e 'closed' ({reason}).
 * O stub do BlastEm encerra o emulador ao receber um comando que não conhece: daqui só saem
 * os comandos de `commands` (shared/retro/gdbRemote.js).
 */
export class DebugSession extends EventEmitter{
 constructor({backend,emulatorPath,romPath,launch=defaultLaunch,timeout=4000,startTimeout=15000}){
  super();this.backend=backend;this.emulatorPath=emulatorPath;this.romPath=romPath;this.launch=launch;this.timeout=timeout;this.startTimeout=startTimeout
  this.state='idle';this.buffer='';this.pending=null;this.queue=Promise.resolve();this.breakpoints=new Set();this.child=null
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
  if(this.buffer.length>1024*1024){this.#close('O emulador enviou dados demais; sessão encerrada.');this.stop();return}
  const {events,rest}=parseStream(this.buffer);this.buffer=rest
  for(const event of events){
   // Reenvio só enquanto o comando ainda não foi confirmado: um "-" solto no texto do emulador
   // (uma mensagem do jogo, por exemplo) não pode repetir um passo. Soma errada também só é
   // contestada com um comando esperando resposta.
   if(event.type==='ack'){if(this.pending)this.pending.acked=true;continue}
   if(event.type==='bad'){if(this.pending)this.child?.stdin.write('-');continue}
   if(event.type==='nak'){if(this.pending?.raw&&!this.pending.acked)this.child?.stdin.write(this.pending.raw);continue}
   if(event.type!=='packet')continue
   this.child?.stdin.write('+')
   const pending=this.pending
   if(!pending)continue // resposta atrasada de um comando que já expirou
   this.pending=null;clearTimeout(pending.timer);pending.resolve(event.data)
  }
 }
 /** Envia um comando e espera a resposta. timeout 0 = sem limite (continuar até um breakpoint). */
 #send(command,timeout=this.timeout){
  return new Promise((resolve,reject)=>{
   if(this.state==='closed'||!this.child)return reject(Error('A sessão de depuração terminou.'))
   const raw=encodePacket(command)
   this.pending={resolve,reject,raw,timer:timeout?setTimeout(()=>{
    this.pending=null
    // Depois de um comando sem resposta o protocolo fica fora de sincronia: a sessão não é mais confiável.
    if(this.state!=='starting'&&this.state!=='closed'){this.#close(SILENT);this.stop()}
    reject(Error(SILENT))
   },timeout):null}
   this.child.stdin.write(raw)
  })
 }
 // Com o jogo rodando a fila está presa no "continuar": recusa na hora em vez de esperar para sempre.
 #serial(action){
  if(this.state==='running')return Promise.reject(Error(RUNNING))
  const run=this.queue.then(action,action);this.queue=run.catch(()=>{});return run
 }
 #requireStopped(){
  if(this.state==='running')throw Error(RUNNING)
  if(this.state!=='stopped')throw Error('Não há sessão de depuração parada.')
 }
 async start(){
  if(this.state!=='idle')throw Error('A sessão já foi iniciada.')
  if(!this.backend?.capabilities?.registers)throw Error('Este emulador não oferece depuração.')
  this.state='starting'
  this.child=this.launch(this.emulatorPath,this.romPath)
  this.child.stdout.setEncoding('latin1');this.child.stdout.on('data',chunk=>this.#onData(chunk))
  this.child.stderr?.on('data',()=>{})
  this.child.stdin.on('error',()=>{})
  this.child.on('error',error=>this.#close('Não foi possível iniciar o emulador: '+error.message))
  this.child.on('exit',code=>this.#close(this.stopping?'Sessão encerrada.':'O emulador foi fechado'+(code?' (código '+code+')':'')+'. A sessão de depuração terminou.'))
  try{
   // O emulador para na primeira instrução e espera o depurador.
   const reply=parseStopReply(await this.#send(commands.halt,this.startTimeout))
   if(reply.kind!=='stopped')throw Error('Resposta inesperada do emulador ao iniciar a depuração.')
  }catch(error){
   const closed=this.state==='closed';this.stop()
   throw Error(closed?error.message:'O emulador não respondeu como depurador em '+Math.round(this.startTimeout/1000)+' s. Se ele mostrou um aviso na própria janela, confirme-o e tente de novo.')
  }
  let registers
  try{registers=await this.#registers()}catch(error){this.stop();throw error}
  this.#set('stopped',{reason:'start',registers})
  return registers
 }
 async #registers(){return parseM68kRegisters(await this.#send(commands.registers))}
 registers(){return this.#serial(async()=>{this.#requireStopped();return this.#registers()})}
 /** Lê até 4096 bytes do barramento do 68000 (ROM, RAM, portas). */
 memory(address,length){
  return this.#serial(async()=>{
   this.#requireStopped()
   if(!Number.isInteger(address)||!Number.isInteger(length)||address<0||address>0xFFFFFF||length<1||length>MEMORY_LIMIT||address+length>0x1000000)throw Error('Faixa de memória inválida (endereços de 24 bits, até 4096 bytes por leitura).')
   const out=new Uint8Array(length)
   for(let offset=0;offset<length;offset+=MEMORY_CHUNK){
    const size=Math.min(MEMORY_CHUNK,length-offset),reply=await this.#send(commands.readMemory(address+offset,size))
    if(/^E[0-9a-fA-F]{2}$/.test(reply)||reply.length!==size*2)throw Error('O emulador não leu a memória em 0x'+(address+offset).toString(16).toUpperCase()+'.')
    out.set(hexToBytes(reply),offset)
   }
   return out
  })
 }
 setBreakpoint(address,enabled=true){
  return this.#serial(async()=>{
   this.#requireStopped()
   if(!Number.isInteger(address)||address<0||address>0xFFFFFF||address&1)throw Error('Endereço de breakpoint inválido (par, até 0xFFFFFF).')
   if(enabled===this.breakpoints.has(address))return [...this.breakpoints]
   if(enabled&&this.breakpoints.size>=64)throw Error('Limite de 64 breakpoints por sessão.')
   const reply=await this.#send(commands.breakpoint(address,enabled))
   if(reply!=='OK')throw Error('O emulador recusou o breakpoint em 0x'+address.toString(16).toUpperCase()+'.')
   if(enabled)this.breakpoints.add(address);else this.breakpoints.delete(address)
   return [...this.breakpoints]
  })
 }
 async #resume(command,reasonWhenStopped,timeout){
  this.#requireStopped()
  this.#set('running')
  let reply
  try{reply=parseStopReply(await this.#send(command,timeout))}
  catch(error){if(this.state!=='closed'){this.#close(error.message);this.stop()}throw error}
  if(reply.kind==='exited'){this.#close('O jogo terminou no emulador.');this.stop();throw Error('O jogo terminou no emulador.')}
  if(reply.kind!=='stopped'){this.#close('Resposta inesperada do emulador; sessão encerrada.');this.stop();throw Error('Resposta inesperada do emulador.')}
  let registers
  try{registers=await this.#registers()}catch(error){if(this.state!=='closed'){this.#close(error.message);this.stop()}throw error}
  this.#set('stopped',{reason:reasonWhenStopped(registers),registers})
  return registers
 }
 /** Uma instrução do 68000. */
 step(){return this.#serial(()=>this.#resume(commands.step,()=>'step',this.timeout))}
 /** Roda até um breakpoint. Sem breakpoints ativos o controle não volta: é preciso encerrar a sessão. */
 continue(){return this.#serial(()=>this.#resume(commands.continue,registers=>this.breakpoints.has(registers.pc)?'breakpoint':'stopped',0))}
 stop(){
  this.stopping=true
  try{this.child?.kill()}catch{/* já terminou */}
  if(this.state!=='closed')this.#close('Sessão encerrada.')
 }
}
function defaultLaunch(emulatorPath,romPath){return spawn(emulatorPath,['-D',romPath],{cwd:path.dirname(emulatorPath),stdio:['pipe','pipe','pipe']})}
