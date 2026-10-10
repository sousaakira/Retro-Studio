// #64: sessão de depuração contra um stub falso do protocolo do GDB (sempre) e contra o BlastEm
// real (opcional): node scripts/smoke-debug-session.mjs --blastem <binário> --project <projeto
// construído com "make debug"> --toolkit <marsdev>. O BlastEm precisa de um display (Xvfb serve).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {DebugSession,DEBUG_BACKENDS} from '../electron/retro/debugSession.js'
import {BlastemNativeSession} from '../electron/retro/blastemNativeSession.js'
import {readTerminal,withoutEcho,parsePrint,parseVdpRegisters,parseVdpSprites,parseStop,parseBreakpointSet,memoryPlan,nativeCommands} from '../shared/retro/blastemDebugger.js'
import {createDebugService} from '../electron/retro/debugService.js'
import {loadDebugSymbols,describeAddress,addressLines,resolveLocation,resolveData,lineAddress} from '../electron/retro/debugSymbols.js'
import {planBuildFlavor,markBuildFlavor,lastBuildFlavor} from '../electron/retro/buildFlavor.js'
import {beginBuildSnapshot,finishBuildSnapshot} from '../electron/retro/buildSnapshot.js'
import {checksum,parseStream} from '../shared/retro/gdbRemote.js'
// Ruído com "$": a soma falha, mas o pacote verdadeiro logo depois é entregue.
assert.deepEqual(parseStream('hp=$10\n$S05#b8').events,[{type:'bad'},{type:'packet',data:'S05'}])
const option=name=>{const index=process.argv.indexOf(name);return index<0?'':process.argv[index+1]}
const blastem=DEBUG_BACKENDS.find(item=>item.id==='blastem-gdb'),ALLOWED=/^(\?|g|s|c|m[0-9a-f]+,[0-9a-f]+|[Zz]0,[0-9a-f]+,2)$/
const tick=(ms=5)=>new Promise(resolve=>setTimeout(resolve,ms))
/** Emulador falso: fala o protocolo pela entrada/saída padrão e "morre" com comando desconhecido, como o BlastEm. */
function fakeEmulator({silent=false,corruptFirst=false,noise=true}={}){
 const child=new EventEmitter(),log=[],memory=Buffer.alloc(0x10000);let pc=0x200,buffer='',alive=true,corrupt=corruptFirst,last=''
 memory.write('SEGA MEGA DRIVE ',0x100,'latin1');for(let i=0x400;i<0x800;i++)memory[i]=i&255
 const breakpoints=new Set()
 child.stdout=new PassThrough();child.stderr=new PassThrough();child.log=log;child.breakpoints=breakpoints
 const die=code=>{if(!alive)return;alive=false;child.stdout.end();setImmediate(()=>child.emit('exit',code))}
 child.kill=()=>die(null);child.crash=()=>die(1)
 const reply=text=>{
  if(!alive)return
  last='$'+text+'#'+(corrupt?'00':checksum(text).toUpperCase());corrupt=false
  // Ruído do emulador antes do pacote e resposta partida em dois pedaços.
  const raw=(noise?'aviso do emulador\n':'')+'+'+last,middle=raw.length>>1
  child.stdout.write(raw.slice(0,middle));setImmediate(()=>alive&&child.stdout.write(raw.slice(middle)))
 }
 const registers=()=>'00000000'.repeat(15)+'00ff0000'+'00002700'+pc.toString(16).padStart(8,'0')
 child.stdin={on(){},write(text){
  buffer+=text
  if(buffer.startsWith('-')){buffer=buffer.slice(1);last='$'+last.slice(1,last.lastIndexOf('#'))+'#'+checksum(last.slice(1,last.lastIndexOf('#')));child.stdout.write(last);return}
  const {events,rest}=parseStream(buffer);buffer=rest
  for(const event of events){
   if(event.type!=='packet')continue
   const command=event.data;log.push(command)
   if(silent)continue
   if(command==='?')reply('S05')
   else if(command==='g')reply(registers())
   else if(command==='s'){pc+=2;reply('S05')}
   else if(command==='c'){if(!breakpoints.size)continue;do pc+=2;while(!breakpoints.has(pc)&&pc<0xfffe);reply('S05')}
   else if(/^m/.test(command)){const [address,length]=command.slice(1).split(',').map(value=>parseInt(value,16));reply(address>=0xa00000&&address<0xa10000?'E01':memory.subarray(address&0xffff,(address&0xffff)+Math.min(length,255)).toString('hex'))}
   else if(/^[Zz]0,/.test(command)){const address=parseInt(command.split(',')[1],16);if(command[0]==='Z')breakpoints.add(address);else breakpoints.delete(address);reply('OK')}
   else die(1)
  }
 }}
 return child
}
const session=(options={})=>{const child=fakeEmulator(options.fake);return {child,debug:new DebugSession({backend:blastem,emulatorPath:'/fake/blastem',romPath:'/fake/rom.bin',launch:()=>child,timeout:500,startTimeout:options.startTimeout||500})}}

// 1. Sessão: início, registros, memória em pedaços, breakpoints, passo e continuar.
{
 const {child,debug}=session(),states=[];debug.on('state',event=>states.push(event.state+':'+(event.reason||'')))
 const start=await debug.start();assert.equal(start.pc,0x200);assert.equal(debug.state,'stopped');assert.deepEqual(states,['stopped:start'])
 await assert.rejects(debug.start(),/já foi iniciada/)
 assert.equal(Buffer.from(await debug.memory(0x100,16)).toString('latin1'),'SEGA MEGA DRIVE ')
 const before=child.log.length,big=await debug.memory(0x400,600);assert.equal(big.length,600);assert.equal(big[599],(0x400+599)&255)
 assert.deepEqual(child.log.slice(before),['m400,80','m480,80','m500,80','m580,80','m600,58'],'leituras grandes saem em pedaços de 128 bytes: o stub real corta em 255')
 for(const [address,length] of [[-1,4],[0,0],[0,4097],[0xFFFFFF,2],[1.5,4],[0x1000000,1]])await assert.rejects(debug.memory(address,length),/Faixa de memória inválida/)
 await assert.rejects(debug.memory(0xA00000,4),/não leu a memória em 0xA00000/);assert.equal(debug.state,'stopped','erro respondido pelo emulador não encerra a sessão')
 await assert.rejects(debug.setBreakpoint(0x211),/inválido/);await assert.rejects(debug.setBreakpoint(0x1000000),/inválido/)
 assert.deepEqual(await debug.setBreakpoint(0x210),[0x210]);assert.deepEqual(await debug.setBreakpoint(0x210),[0x210],'repetir não reenvia');assert.equal(child.log.filter(item=>item==='Z0,210,2').length,1)
 const stepped=await debug.step();assert.equal(stepped.pc,0x202)
 const stopped=await debug.continue();assert.equal(stopped.pc,0x210);assert.deepEqual(states.slice(-4),['running:','stopped:step','running:','stopped:breakpoint'])
 assert.deepEqual(await debug.setBreakpoint(0x210,false),[]);assert.ok(!child.breakpoints.has(0x210))
 for(let address=0x300;address<0x300+128;address+=2)await debug.setBreakpoint(address)
 await assert.rejects(debug.setBreakpoint(0x1000),/Limite de 64/)
 // 2. Rodando sem breakpoint que pare: nada de pausa; comandos são recusados na hora.
 for(const address of [...debug.breakpoints])await debug.setBreakpoint(address,false)
 const running=debug.continue();running.catch(()=>{});await tick()
 assert.equal(debug.state,'running')
 for(const action of [()=>debug.registers(),()=>debug.memory(0x100,4),()=>debug.step(),()=>debug.setBreakpoint(0x400),()=>debug.continue()])await assert.rejects(action(),/O jogo está rodando.*não|O jogo está rodando/)
 const closed=[];debug.on('closed',event=>closed.push(event.reason))
 debug.stop();await assert.rejects(running,/Sessão encerrada/);await tick()
 assert.deepEqual(closed,['Sessão encerrada.']);assert.equal(debug.state,'closed')
 await assert.rejects(debug.registers(),/Não há sessão|terminou/)
 assert.ok(child.log.every(command=>ALLOWED.test(command)),'só comandos conhecidos pelo stub: '+child.log.filter(command=>!ALLOWED.test(command)))
}
// 3. Emulador fechado pelo usuário; soma errada; emulador mudo; backend sem depuração.
{
 const {child,debug}=session(),closed=[];debug.on('closed',event=>closed.push(event.reason));await debug.start()
 child.crash();await tick();assert.equal(debug.state,'closed');assert.match(closed[0],/O emulador foi fechado \(código 1\)\. A sessão de depuração terminou\./)
 await assert.rejects(debug.step(),/Não há sessão|terminou/)
}
{
 // Comando sem resposta com a sessão aberta: o protocolo saiu de sincronia, a sessão é encerrada e dita.
 const {child,debug}=session(),closed=[];debug.on('closed',event=>closed.push(event.reason));await debug.start()
 child.stdin.write=()=>{};debug.timeout=40
 await assert.rejects(debug.memory(0x100,4),/parou de responder aos comandos de depuração\. A sessão foi encerrada\./);assert.equal(debug.state,'closed');assert.deepEqual(closed,['O emulador parou de responder aos comandos de depuração. A sessão foi encerrada.'])
}
{
 // Ruído do emulador com "+", "-" e "$" no meio de um passo: o comando não é repetido e a resposta de verdade não se perde.
 const {child,debug}=session({fake:{noise:false}});await debug.start()
 const write=child.stdin.write.bind(child.stdin);let injected=false
 child.stdin.write=text=>{if(!injected&&text.includes('$s#')){injected=true;child.stdout.write('+KDEBUG MESSAGE: dx=-3 hp=$10\n')}return write(text)}
 const after=await debug.step();assert.equal(after.pc,0x202,'um passo só');assert.equal(child.log.filter(command=>command==='s').length,1);debug.stop()
}
{
 // O emulador responde ao início mas não aos registros: o processo é encerrado, não fica órfão.
 const {child,debug}=session();let killed=0;const kill=child.kill;child.kill=()=>{killed++;kill()}
 const write=child.stdin.write.bind(child.stdin);child.stdin.write=text=>text.includes('$g#')?undefined:write(text)
 await assert.rejects(debug.start(),/parou de responder|terminou|Sessão encerrada/);assert.ok(killed>=1);assert.equal(debug.state,'closed')
}
{
 // Parou no breakpoint mas a leitura de registros falha: a sessão fecha e avisa, em vez de ficar "rodando".
 const {child,debug}=session(),closed=[];debug.on('closed',event=>closed.push(event.reason));await debug.start();await debug.setBreakpoint(0x210)
 const write=child.stdin.write.bind(child.stdin);let seen=false;child.stdin.write=text=>{if(text.includes('$c#'))seen=true;return seen&&text.includes('$g#')?undefined:write(text)}
 await assert.rejects(debug.continue(),/parou de responder/);assert.deepEqual([debug.state,closed.length],['closed',1])
}
{
 const {debug}=session({fake:{corruptFirst:true}});assert.equal((await debug.start()).pc,0x200,'pacote com soma errada é pedido de novo');debug.stop()
}
{
 const {debug}=session({fake:{silent:true},startTimeout:40});await assert.rejects(debug.start(),/não respondeu como depurador.*aviso na própria janela/);assert.equal(debug.state,'closed')
}
for(const backend of DEBUG_BACKENDS.filter(item=>!item.driver)){
 assert.ok(Object.values(backend.capabilities).every(value=>value===false));assert.ok(backend.notes.length)
 await assert.rejects(new DebugSession({backend,emulatorPath:'x',romPath:'y',launch:()=>{throw Error('não deve iniciar')}}).start(),/não oferece depuração/)
}
const native=DEBUG_BACKENDS.find(item=>item.id==='blastem-native'),on=backend=>Object.keys(backend.capabilities).filter(name=>backend.capabilities[name])
assert.deepEqual(on(blastem),['step','continue','breakpoints','registers','memory']);assert.deepEqual(on(native),['step','continue','frames','breakpoints','registers','memory','vdp','kdebug'])
for(const backend of DEBUG_BACKENDS){assert.equal(backend.capabilities.pause,false,'nenhum backend comprovou pausa');assert.equal(backend.capabilities.inputRecording,false,'nenhum backend comprovou gravação de entradas');assert.deepEqual(Object.keys(backend.capabilities),Object.keys(native.capabilities))}
await nativeChecks()

// 4. Tipo de build: trocar entre comum e depuração limpa antes; projeto antigo não ganha arquivo.
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-debug-'))
try{
 const project=path.join(temporary,'jogo');fs.mkdirSync(path.join(project,'src'),{recursive:true});fs.mkdirSync(path.join(project,'out'))
 assert.deepEqual(planBuildFlavor(project),{flavor:'release',goal:'',clean:false});markBuildFlavor(project,'release');assert.ok(!fs.existsSync(path.join(project,'.retrostudio/build-flavor.json')))
 assert.deepEqual(planBuildFlavor(project,'debug'),{flavor:'debug',goal:' debug',clean:true});assert.equal(planBuildFlavor(project,'qualquer').flavor,'release')
 markBuildFlavor(project,'debug');assert.equal(lastBuildFlavor(project),'debug');assert.equal(planBuildFlavor(project,'debug').clean,false);assert.equal(planBuildFlavor(project).clean,true)
 markBuildFlavor(project,'unknown');assert.equal(planBuildFlavor(project).clean,true);assert.equal(planBuildFlavor(project,'debug').clean,true)
 fs.writeFileSync(path.join(project,'.retrostudio/build-flavor.json'),'{');assert.equal(lastBuildFlavor(project),'unknown')
 markBuildFlavor(project,'release');assert.equal(planBuildFlavor(project).clean,false)
 for(const file of ['electron/retro/game.js','electron/retro/buildForTools.js']){
  const code=fs.readFileSync(file,'utf8');assert.equal((code.match(/clean && \$\{makeCmd\}\$\{goal\}` : makeCmd \+ goal/g)||[]).length,3,file+': os três caminhos de make usam o alvo');assert.match(code,/markBuildFlavor\(projectPath, 'unknown', \{ create: \w+\.flavor === 'debug' \}\)/)
 }

 // 5. Símbolos: ELF sintético com duas funções, uma estática repetida e uma variável.
 fs.writeFileSync(path.join(project,'src/main.c'),'int main(void){return 0;}\n')
 assert.equal(loadDebugSymbols(project),null,'sem jogo compilado')
 fs.writeFileSync(path.join(project,'out/rom.out'),syntheticElf());fs.writeFileSync(path.join(project,'out/rom.bin'),Buffer.alloc(512,1))
 let symbols=loadDebugSymbols(project)
 assert.deepEqual(symbols.functions.map(item=>item.name),['main','helper','update','helper']);assert.deepEqual(symbols.objects.map(item=>item.name),['score'])
 assert.equal(symbols.hasLines,false);assert.equal(symbols.association,'unproven','sem recibo da IDE a ligação ROM ↔ símbolos não é afirmada')
 assert.deepEqual(describeAddress(symbols,0x200),{name:'main',offset:0});assert.deepEqual(describeAddress(symbols,0x21e),{name:'main',offset:0x1e});assert.equal(describeAddress(symbols,0x220),null,'fora do tamanho declarado')
 assert.deepEqual(describeAddress(symbols,0x304),{name:'update',offset:4});assert.equal(describeAddress(symbols,0x100),null);assert.equal(describeAddress(symbols,0xff0000),null)
 assert.deepEqual(resolveLocation(symbols,'update'),{address:0x300,label:'update'});assert.deepEqual(resolveLocation(symbols,' 0x21E '),{address:0x21e,label:'0x21E'});assert.equal(resolveLocation(symbols,'$300').address,0x300)
 assert.throws(()=>resolveLocation(symbols,'helper'),/Há 2 funções chamadas “helper”/);assert.throws(()=>resolveLocation(symbols,'sumiu'),/não é um endereço/);assert.throws(()=>resolveLocation(symbols,'0x1000000'),/não é um endereço/)
 assert.throws(()=>resolveLocation(symbols,'main.c:1'),/sem informações de linha.*Construir para depurar/);assert.equal(lineAddress(symbols,'main.c',1),null);assert.equal(addressLines(symbols,[0x200],'').size,0)
 assert.deepEqual(resolveData(symbols,'score'),{address:0xff0010,size:2,label:'score'});assert.equal(resolveData(symbols,'0xFF0000').address,0xff0000);assert.throws(()=>resolveData(symbols,'main'),/nem uma variável/)
 const outside=path.join(temporary,'fora.out');fs.writeFileSync(outside,syntheticElf())
 const linked=path.join(temporary,'ligado');fs.mkdirSync(path.join(linked,'out'),{recursive:true});fs.symlinkSync(outside,path.join(linked,'out/rom.out'))
 assert.throws(()=>loadDebugSymbols(linked),/outside-project/)

 // 6. Serviço: o que a tela recebe. Recibo da IDE → ligação comprovada.
 const started=beginBuildSnapshot(project);assert.equal(finishBuildSnapshot(project,started,path.join(project,'out/rom.bin')).status,'recorded')
 const events=[],builds=[];let child=null,busy=false
 const service=createDebugService({toolkit:()=>'',emulatorPath:id=>id==='blastem'?process.execPath:id==='gen_sdl2'?process.execPath:null,selectedEmulator:()=>'gen_sdl2',
  build:async(projectPath,toolkit,options)=>{builds.push(options);return builds.length===1?{success:false,errors:[{file:'src/main.c',line:1,message:'erro'}],diagnosis:{message:'Falta o compilador.'}}:{success:true,errors:[]}},
  buildBusy:()=>busy,send:event=>events.push(event),launch:()=>(child=fakeEmulator())})
 let status=service.status(project)
 assert.deepEqual(status.backends.map(item=>[item.id,item.installed]),[['blastem-native',true],['blastem-gdb',true],['gen_sdl2',true],['picodrive',false]]);assert.equal(status.selectedEmulator,'gen_sdl2');assert.equal(status.session,null)
 assert.deepEqual([status.game.association,status.game.hasLines,status.game.functions,status.game.variables,status.game.flavor,status.game.rom.path],['proven',false,4,1,'release','out/rom.bin'])
 await assert.rejects(service.start(project,{backend:'gen_sdl2'}),/Genesis Plus GX não oferece depuração\. Este emulador só executa a ROM/)
 await assert.rejects(service.start(project,{backend:'nenhum'}),/desconhecido/);await assert.rejects(service.command(project,{command:'step'}),/Não há sessão de depuração aberta/)
 const empty=path.join(temporary,'vazio');fs.mkdirSync(empty);await assert.rejects(service.start(empty,{backend:'blastem-gdb'}),/Não há jogo compilado/);assert.equal(service.status(empty).game.association,'missing')
 let build=await service.build(project);assert.deepEqual([build.success,build.errors.length],[false,1]);assert.match(build.error,/falhou\. Falta o compilador\./);assert.equal(builds[0].flavor,'debug');assert.equal(typeof builds[0].onProcess,'function')
 busy=true;await assert.rejects(service.build(project),/Já há um build em andamento/);busy=false;assert.equal((await service.build(project)).success,true)
 // Emulador mudo: o erro volta na chamada, sem um segundo aviso de "sessão encerrada".
 const mute=createDebugService({toolkit:()=>'',emulatorPath:()=>process.execPath,selectedEmulator:()=>'blastem',build:async()=>({success:true}),send:event=>events.push(event),launch:()=>fakeEmulator({silent:true}),startTimeout:40})
 await assert.rejects(mute.start(project,{backend:'blastem-gdb'}),/não respondeu como depurador/);await tick(20);assert.equal(events.length,0);assert.equal(mute.status(project).session,null)
 const opened=await service.start(project,{backend:'blastem-gdb'});assert.equal(opened.session.state,'stopped');assert.equal(opened.session.rom,'out/rom.bin')
 assert.equal(events.length,1);assert.deepEqual([events[0].type,events[0].reason,events[0].stop.pcText,events[0].stop.function.name,events[0].stop.source],['state','start','0x000200','main',null]);assert.match(events[0].stop.sourceNote,/não foi construído para depurar/)
 await assert.rejects(service.build(project),/Encerre a sessão de depuração antes de construir/);await assert.rejects(service.command(empty,{command:'step'}),/outro projeto/)
 assert.equal(service.status(project).session.state,'stopped');assert.deepEqual([service.status(project).session.last.reason,service.status(project).session.last.stop.pc],['start',0x200],'a última parada acompanha o estado (tela remontada)')
 let answer=await service.command(project,{command:'breakpoint',location:'update'});assert.deepEqual(answer.session.breakpoints,[{address:0x300,addressText:'0x000300',label:'update'}])
 await assert.rejects(service.command(project,{command:'breakpoint',location:'main.c:1'}),/sem informações de linha/);await assert.rejects(service.command(project,{command:'breakpoint',location:'helper'}),/Há 2 funções/)
 assert.equal((await service.command(project,{command:'continue'})).warning,'');for(let i=0;i<20&&events.at(-1).reason!=='breakpoint';i++)await tick()
 assert.deepEqual([events.at(-2).session.state,events.at(-1).reason,events.at(-1).stop.pc,events.at(-1).stop.function.name],['running','breakpoint',0x300,'update'])
 await service.command(project,{command:'step'});assert.deepEqual(events.at(-1).stop.function,{name:'update',offset:2})
 answer=await service.command(project,{command:'registers'});assert.equal(answer.stop.registers.a7,0x00ff0000)
 answer=await service.command(project,{command:'memory',location:'0x100',length:16});assert.equal(Buffer.from(answer.bytes).toString('latin1'),'SEGA MEGA DRIVE ');assert.equal(answer.addressText,'0x000100');assert.equal(answer.region,'ROM')
 answer=await service.command(project,{command:'memory',location:'score'});assert.deepEqual([answer.address,answer.bytes.length,answer.label,answer.region],[0xff0010,2,'score','RAM do 68000'],'variável: o tamanho vem do símbolo')
 // Fora da ROM e da RAM o BlastEm real devolve lixo ou trava: a leitura nem é enviada.
 const sent=child.log.length
 for(const [address,length] of [[0xC00000,4],[0xA10000,2],[0x400000,16],[0x1F0,32],[0xFEFFFF,2]])await assert.rejects(service.command(project,{command:'memory',address,length}),/só lê a ROM \(0x000000–0x0001FF\) e a RAM do 68000/)
 assert.equal(child.log.length,sent);assert.equal((await service.command(project,{command:'memory',address:0x1F0,length:16})).region,'ROM');assert.equal((await service.command(project,{command:'memory',address:0xFFFFFE,length:64})).bytes.length,2)
 assert.equal((await service.command(project,{command:'memory',address:0xFF0000,length:99999})).bytes.length,4096);await assert.rejects(service.command(project,{command:'memory',location:'sumiu'}),/nem uma variável/)
 await assert.rejects(service.command(project,{command:'apagar-tudo'}),/desconhecido/)
 await assert.rejects(service.command(project,{command:'vdp'}),/protocolo remoto do GDB não lê o VDP/);await assert.rejects(service.command(project,{command:'frames',count:2}),/não avança por quadros/)
 answer=await service.command(project,{command:'breakpoint',address:0x300,enabled:false});assert.deepEqual(answer.session.breakpoints,[])
 assert.match((await service.command(project,{command:'continue'})).warning,/Sem breakpoints ativos.*não tem pausa/);await tick();assert.equal(service.status(project).session.state,'running')
 await assert.rejects(service.command(project,{command:'continue'}),/O jogo está rodando/,'continuar de novo com o jogo rodando é erro, não sucesso')
 await assert.rejects(service.command(project,{command:'registers'}),/O jogo está rodando/)
 // O usuário fecha a janela do emulador: a tela é avisada e a sessão some.
 child.crash();await tick(20);assert.deepEqual([events.at(-1).type,service.status(project).session],['closed',null]);assert.match(events.at(-1).reason,/O emulador foi fechado/)
 // Trocar de projeto com sessão aberta: ela é encerrada (não sobra emulador sem tela) e a tela antiga é avisada.
 await service.start(project,{backend:'blastem-gdb'});const orphan=child;assert.equal(service.status(empty).session,null);await tick()
 assert.deepEqual([events.at(-1).type,events.at(-1).projectPath,events.at(-1).reason],['closed',project,'Sessão encerrada: outro projeto foi aberto.']);assert.equal(service.status(project).session,null)
 await assert.rejects(service.command(project,{command:'step'}),/Não há sessão de depuração aberta/);assert.equal((await service.build(project)).success,true,'o outro projeto não fica travado');void orphan
 // Reconstruir com a sessão aberta: o link para o C some, porque o emulador segue com a ROM antiga.
 await service.start(project,{backend:'blastem-gdb'});fs.writeFileSync(path.join(project,'out/rom.bin'),Buffer.alloc(512,2))
 await service.command(project,{command:'step'});assert.equal(events.at(-1).stop.source,null);assert.match(events.at(-1).stop.sourceNote,/construído de novo depois do início desta sessão/)
 fs.writeFileSync(path.join(project,'out/rom.bin'),Buffer.alloc(512,1));await service.command(project,{command:'stop'})
 // Build para depurar: cancelar, saída do make quando não há erro reconhecido, e um por vez.
 {
  let finish=null,stopped=0
  const slow=createDebugService({toolkit:()=>'',emulatorPath:()=>process.execPath,selectedEmulator:()=>'blastem',send(){},build:(_p,_t,options)=>new Promise(resolve=>{options.onProcess(()=>{stopped++;resolve({success:false,cancelled:true,error:'Build cancelado.'})});finish=resolve})})
  assert.throws(()=>slow.cancelBuild(),/Não há build para depurar em andamento/)
  const running=slow.build(project);await tick();assert.equal(slow.status(project).building,true);await assert.rejects(slow.build(project),/Já há um build para depurar em andamento/)
  assert.deepEqual(slow.cancelBuild(),{success:true});assert.deepEqual([(await running).cancelled,stopped,slow.status(project).building],[true,1,false])
  const failing=slow.build(project);await tick();finish({success:false,stderr:'linha 1\nmake: *** No rule to make target \'debug\'.  Stop.\n',errors:[]})
  assert.match((await failing).error,/O build para depurar falhou\. Fim da saída do make: .*No rule to make target 'debug'/)
 }
 await service.start(project,{backend:'blastem-gdb'});const first=child;await service.start(project,{backend:'blastem-gdb'});await tick();assert.notEqual(child,first,'iniciar de novo substitui a sessão anterior')
 const count=events.length;await service.command(project,{command:'stop'});assert.deepEqual([events.length,events.at(-1).type,events.at(-1).reason],[count+1,'closed','Sessão encerrada.']);service.dispose()
 assert.ok([first,child].every(item=>item.log.every(command=>ALLOWED.test(command))))
 // Backend nativo pelo serviço: VDP, quadros, KDebug e limite de leitura próprio.
 {
  let terminal=null;const seen=[]
  const nativeService=createDebugService({toolkit:()=>'',emulatorPath:()=>process.execPath,selectedEmulator:()=>'blastem',build:async()=>({success:true}),send:event=>seen.push(event),launchTerminal:(file,args)=>(terminal=fakeTerminal(),terminal.args=args,terminal)})
  const openedNative=await nativeService.start(project,{backend:'blastem-native'});assert.deepEqual([openedNative.session.state,openedNative.session.backend,terminal.args[0]],['stopped','blastem-native','-d'])
  assert.deepEqual([seen[0].type,seen[0].lines],['log',['MEM_init: heap = e0ff0e62']],'mensagem KDebug chega como evento');assert.deepEqual([seen[1].type,seen[1].reason,seen[1].stop.pc],['state','start',0x200])
  const read=await nativeService.command(project,{command:'vdp'});assert.deepEqual([read.vdp.registers.length,read.vdp.registers[1],read.vdp.sprites.length],[3,{register:1,value:0x74,description:'Display enabled, V-ints enabled, Height: 28, Mode 5, 64K VRAM'},1])
  await nativeService.command(project,{command:'frames',count:3});for(let i=0;i<20&&seen.at(-1).reason!=='frames';i++)await tick();assert.deepEqual([seen.at(-1).reason,seen.at(-1).stop.pc],['frames',0x200+3*0x10])
  await nativeService.command(project,{command:'breakpoint',location:'update'});await nativeService.command(project,{command:'continue'});for(let i=0;i<20&&seen.at(-1).reason!=='breakpoint';i++)await tick();assert.deepEqual([seen.at(-1).reason,seen.at(-1).stop.function.name],['breakpoint','update'])
  assert.equal((await nativeService.command(project,{command:'memory',address:0xFF0000,length:99999})).bytes.length,1024,'limite do backend nativo');await assert.rejects(nativeService.command(project,{command:'memory',address:0xC00000,length:4}),/só lê a ROM/)
  await nativeService.command(project,{command:'stop'});assert.equal(seen.at(-1).type,'closed')
  const noTerminal=createDebugService({toolkit:()=>'',emulatorPath:()=>process.execPath,selectedEmulator:()=>'blastem',build:async()=>({success:true}),send(){}})
  await assert.rejects(noTerminal.start(project,{backend:'blastem-native'}),/precisa de um terminal/)
 }
 // Fontes alterados depois do build: a linha deixa de ser navegável (conferido com símbolos reais abaixo).
 fs.writeFileSync(path.join(project,'src/main.c'),'int main(void){return 1;}\n');assert.equal(service.status(project).game.sourcesChanged,true)

 // 7. Canais e superfície: só os quatro canais, todos confinados ao workspace selecionado.
 const main=fs.readFileSync('electron/main.js','utf8'),preload=fs.readFileSync('electron/preload.cjs','utf8')
 for(const channel of ['retro:debug-status','retro:debug-build','retro:debug-start','retro:debug-command']){assert.match(main,new RegExp("ipcMain\\.handle\\('"+channel+"', debugAnswer\\("));assert.ok(preload.includes("'"+channel+"'"))}
 assert.match(main,/launchTerminal: \(file, args, cwd\) => pty\.spawn\(file, args, \{ name: 'dumb', cols: 250, rows: 50, cwd, env: process\.env \}\)/)
 assert.match(main,/const debugAnswer = action => async \(_evt, payload = \{\}\) => \{\s+try \{ return await action\(await assetActionWorkspace\(payload\), payload\) \}/);assert.match(main,/app\.on\('before-quit', \(\) => debugService\.dispose\(\)\)/)

 // 8. Toolchain real: build de depuração traz linhas de C; build comum não.
 const real=option('--project'),toolkit=option('--toolkit')
 if(real&&toolkit){
  symbols=loadDebugSymbols(real,toolkit);assert.equal(symbols.hasLines,true,'projeto construído com make debug')
  const entry=resolveLocation(symbols,'main'),line=addressLines(symbols,[entry.address],toolkit).get(entry.address)
  assert.equal(line.file,'src/main.c');assert.ok(line.line>0);const source=fs.readFileSync(path.join(real,line.file),'utf8').split('\n')[line.line-1];assert.match(source,/\bmain\s*\(/,'a linha encontrada é a de main: '+source)
  assert.deepEqual(resolveLocation(symbols,'main.c:'+line.line),{address:entry.address,label:'src/main.c:'+line.line});assert.equal(resolveLocation(symbols,'src/main.c:'+line.line).address,entry.address)
  assert.throws(()=>resolveLocation(symbols,'nao_existe.c:3'),/Não há código compilado/)
  const library=symbols.functions.find(item=>item.name==='VDP_init');if(library){const where=addressLines(symbols,[library.address],toolkit).get(library.address);assert.ok(!where||where.file===null,'fonte do SGDK não é navegável dentro do projeto')}
  console.log('Real toolchain: '+symbols.functions.length+' functions, '+symbols.lines.size+' source files with lines, main at src/main.c:'+line.line+'.')
  // Casos que enganam a leitura da tabela de linhas, compilados aqui com o compilador do toolkit:
  // fonte sem troca de arquivo, dois "util.c" em pastas diferentes e projeto aberto por um link simbólico.
  {
   const gcc=path.join(toolkit,'m68k-elf/bin/m68k-elf-gcc'),small=path.join(temporary,'linhas')
   fs.mkdirSync(path.join(small,'src/sub'),{recursive:true});fs.mkdirSync(path.join(small,'out'))
   fs.writeFileSync(path.join(small,'src/h.h'),'static inline int tw(int x){\n  return x*2;\n}\n')
   fs.writeFileSync(path.join(small,'src/main.c'),'int a(int);int b(int);\nint main(void){\n  return a(1)+b(2);\n}\n')
   fs.writeFileSync(path.join(small,'src/util.c'),'int a(int x){\n  return x+1;\n}\nint a2(int x){\n  return x+2;\n}\n')
   fs.writeFileSync(path.join(small,'src/sub/util.c'),'#include "../h.h"\nvolatile int g;\nint b(int x){\n  g=tw(x);\n  return g;\n}\n')
   const built=spawnSync(gcc,['-m68000','-O1','-ggdb','-nostdlib','-ffreestanding','-Wl,-Ttext=0x200','-o','out/rom.out','src/main.c','src/util.c','src/sub/util.c'],{cwd:small,encoding:'utf8'});assert.equal(built.status,0,built.stderr)
   fs.writeFileSync(path.join(small,'out/rom.bin'),'rom')
   const link=path.join(temporary,'linhas-link');fs.symlinkSync(small,link)
   for(const root of [small,link]){
    const info=loadDebugSymbols(root,toolkit);assert.equal(info.hasLines,true);assert.deepEqual([...info.lines.keys()].filter(file=>file.endsWith('.c')).sort(),['src/main.c','src/sub/util.c','src/util.c'])
    const at=name=>info.functions.find(item=>item.name===name).address,where=address=>addressLines(info,[address],toolkit).get(address)
    assert.equal(resolveLocation(info,'src/main.c:2').address,at('main'),'fonte que nunca troca de arquivo tem linhas');assert.equal(where(at('main')).file,'src/main.c')
    assert.equal(resolveLocation(info,'src/util.c:1').address,at('a'));assert.equal(resolveLocation(info,'src/util.c:4').address,at('a2'))
    assert.equal(describeAddress(info,resolveLocation(info,'src/sub/util.c:3').address).name,'b','cada util.c fica com as suas linhas');assert.equal(where(resolveLocation(info,'src/sub/util.c:3').address).file,'src/sub/util.c');assert.equal(where(at('a')).file,'src/util.c')
    assert.throws(()=>resolveLocation(info,'util.c:1'),/Há 2 arquivos “util.c” no jogo: .*Informe a pasta/)
   }
  }
  // 9. BlastEm real.
  const emulator=option('--blastem')
  if(emulator){
   const live=new DebugSession({backend:blastem,emulatorPath:emulator,romPath:symbols.rom.real,startTimeout:20000,
    launch:(file,rom)=>{const run=spawn(file,['-D',rom],{cwd:path.dirname(file),stdio:['pipe','pipe','pipe']});option('--on-launch')&&spawn('sh',['-c',option('--on-launch')],{stdio:'ignore'});return run}})
   const states=[];live.on('state',event=>states.push(event.state))
   const first=await live.start();assert.equal(first.pc,0x200,'o BlastEm para na primeira instrução')
   assert.equal(Buffer.from(await live.memory(0x100,16)).toString('latin1'),'SEGA MEGA DRIVE ');const vectors=await live.memory(0,600);assert.equal(vectors.length,600);assert.deepEqual([...vectors.subarray(4,8)],[0,0,2,0],'vetor de reset = 0x200');assert.deepEqual([...vectors.subarray(0x100,0x104)],[0x53,0x45,0x47,0x41],'pedaços emendados na ordem')
   const stepped=await live.step();assert.notEqual(stepped.pc,first.pc)
   await live.setBreakpoint(entry.address);const hit=await live.continue();assert.equal(hit.pc,entry.address,'parou em main');assert.deepEqual(describeAddress(symbols,hit.pc),{name:'main',offset:0})
   assert.equal(addressLines(symbols,[hit.pc],toolkit).get(hit.pc).file,'src/main.c')
   const stack=await live.memory(hit.a7&0xffffff,4);assert.equal(stack.length,4);const ram=await live.memory(0xff0000,64);assert.equal(ram.length,64)
   await live.setBreakpoint(entry.address,false);const after=await live.step();assert.notEqual(after.pc,hit.pc)
   const closed=new Promise(resolve=>live.on('closed',event=>resolve(event.reason)));live.stop();assert.equal(await closed,'Sessão encerrada.')
   // Depurador nativo real, pelo mesmo terminal que a IDE usa (node-pty).
   const pty=(await import('node-pty')).default
   const nativeLive=new BlastemNativeSession({backend:native,emulatorPath:emulator,romPath:symbols.rom.real,cwd:path.dirname(emulator),startTimeout:20000,
    launch:(file,args,cwd)=>{const run=pty.spawn(file,args,{name:'dumb',cols:250,rows:50,cwd,env:process.env});option('--on-launch')&&spawn('sh',['-c',option('--on-launch')],{stdio:'ignore'});return run}})
   const messages=[];nativeLive.on('log',event=>messages.push(...event.lines))
   const begin=await nativeLive.start();assert.equal(begin.pc,0x200);assert.equal(begin.sr,0x2700)
   assert.equal(Buffer.from(await nativeLive.memory(0x100,16)).toString('latin1'),'SEGA MEGA DRIVE ');assert.deepEqual([...(await nativeLive.memory(4,5))],[0,0,2,0,vectors[8]],'leitura com sobra de 1 byte')
   const off=await nativeLive.vdp();assert.match(off.registers.find(item=>item.register===1).description,/Display disabled/)
   await nativeLive.setBreakpoint(entry.address);const reached=await nativeLive.continue();assert.equal(reached.pc,entry.address);assert.ok(messages.some(line=>/MEM_init/.test(line)),'KDebug do SGDK de depuração chegou: '+messages.length+' mensagens')
   const onScreen=await nativeLive.vdp();assert.match(onScreen.registers.find(item=>item.register===1).description,/Display enabled.*Mode 5/);assert.equal(onScreen.registers.find(item=>item.register===0x0c).value,0x81,'modo H40');assert.ok(onScreen.internal.some(item=>item.name==='Status'))
   await nativeLive.setBreakpoint(entry.address,false);const framed=await nativeLive.frames(120);assert.notEqual(framed.pc,entry.address);const sprites=(await nativeLive.vdp()).sprites;assert.ok(sprites.length>=1&&sprites[0].width>=8)
   await assert.rejects(nativeLive.frames(0),/1 a 600/);const one=await nativeLive.step();assert.ok(Number.isInteger(one.pc))
   const ended=new Promise(resolve=>nativeLive.on('closed',event=>resolve(event.reason)));nativeLive.stop();assert.equal(await ended,'Sessão encerrada.')
   console.log('Real BlastEm native debugger: registers, memory, breakpoint at main, '+messages.length+' KDebug messages, VDP registers before/after init (H40, mode 5), '+sprites.length+' sprite(s) after 120 frames.')
   console.log('Real BlastEm: stopped at 0x200, read header and RAM, stepped, hit breakpoint at main (0x'+entry.address.toString(16)+' = src/main.c:'+line.line+'), states '+states.join('→')+'.')
  }
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
/** Terminal falso do depurador nativo: ecoa o que recebe, responde e mostra o prompt. */
function fakeTerminal({silent=false}={}){
 let pc=0x200,data=()=>{},exit=()=>{},alive=true,next=0;const breakpoints=new Map(),log=[]
 const out=text=>alive&&setImmediate(()=>alive&&data(text.replace(/\n/g,'\r\n')))
 const terminal={log,emit:text=>out(text),onData(fn){data=fn},onExit(fn){exit=fn},kill(){if(alive){alive=false;setImmediate(()=>exit({exitCode:0}))}},crash(){alive=false;exit({exitCode:1})},
  write(text){
   const command=text.trim();log.push(command);if(silent)return
   let reply=''
   if(command.startsWith('p/x d0'))reply=['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3','a4','a5','a6'].map(name=>name+': 0').join('\n ')+'\n a7: e1000000\n sr: 2700\n pc: '+pc.toString(16)+'\n'
   else if(command.startsWith('p/x ['))reply=command.slice(4).split(' ').map(item=>{const [,address,size]=item.match(/^\[\$([0-9a-f]+)\]\.(\w)$/);const at=parseInt(address,16);return item+': '+(at===0x100&&size==='l'?'53454741':size==='l'?((at&255)*0x01010101>>>0).toString(16):(at&255).toString(16))}).join('\n ')+'\n'
   else if(command==='s'){pc+=2;reply=pc.toString(16).toUpperCase()+': nop\n'}
   else if(/^frames \d+$/.test(command)){pc+=Number(command.split(' ')[1])*0x10;reply=pc.toString(16).toUpperCase()+': nop\n'}
   else if(command==='c'){if(!breakpoints.size)return out(command+'\nKDEBUG MESSAGE: rodando sem parar\n');const [address,index]=[...breakpoints].sort((a,b)=>a[0]-b[0]).find(([address])=>address>pc)||[...breakpoints][0];pc=address;reply='KDEBUG MESSAGE: quadro pronto\n68K Breakpoint '+index+' hit\n'+pc.toString(16).toUpperCase()+': link.w a6, #$FFFFFFBC\n'}
   else if(/^b \$/.test(command)){const address=parseInt(command.slice(3),16);breakpoints.set(address,next);reply='68K Breakpoint '+(next++)+' set at $'+address.toString(16).toUpperCase()+'\n'}
   else if(/^d \d+$/.test(command)){const index=Number(command.slice(2)),found=[...breakpoints].find(item=>item[1]===index);if(found)breakpoints.delete(found[0]);else reply='Breakpoint '+index+' does not exist\n'}
   else if(command==='vr')reply='**Mode Group**\n00: 04 | H-ints disabled, Pal Select 1, HVC latch disabled, Display gen enabled\n01: 74 | Display enabled, V-ints enabled, Height: 28, Mode 5, 64K VRAM\n\n**DMA Group**\n13: 00 |\n\n**Internal Group**\nAddress: 9E00\nVINT Pending: false\nStatus: 4E00\n\nDebug Register: 0 | Output disabled: false, Force Layer: 0\n'
   else if(command==='vs')reply='Sprite 0: X=160(32), Y=280(152), Width=16, Height=24, Link=0, Pal=1, Pri=1, Pat=A400\n'
   else reply=command.split(' ')[0]+' is not a recognized command\n'
   out(command+'\n'+reply+'> ')
  }}
 if(!silent)out('Window created with size: 640 x 480\nKDEBUG MESSAGE: MEM_init: heap = e0ff0e62\n200: move #$2700, SR\n> ')
 return terminal
}
async function nativeChecks(){
 // Texto do terminal: prompt, eco, mensagens KDebug no meio, pedaços partidos e códigos de terminal.
 let state=readTerminal('boot\r\nKDEBUG MESSAGE: um\r\n200: move #$2700, SR\r\n> vr\r\n**Mode Group**\r\n00: 04 | x\r\n> parci')
 assert.deepEqual(state,{logs:['um'],replies:['boot\n200: move #$2700, SR\n','vr\n**Mode Group**\n00: 04 | x\n'],rest:'parci'})
 assert.deepEqual(readTerminal('c\nKDEBUG MESSAGE: a\nKDEBUG MESS'),{logs:['a'],replies:[],rest:'c\nKDEBUG MESS'},'mensagens saem enquanto o jogo roda; linha incompleta espera')
 assert.deepEqual(readTerminal('\x1b[0m> '),{logs:[],replies:[''],rest:''});assert.deepEqual(readTerminal('texto\n>'),{logs:[],replies:[],rest:'texto\n>'},'">" sem o espaço ainda não é prompt')
 assert.equal(withoutEcho('p/x d0\nd0: 1\n','p/x d0'),'d0: 1');assert.equal(withoutEcho('d0: 1\n','p/x d0'),'d0: 1')
 assert.deepEqual(parsePrint('d0: 0\n a7: e1000000\n sr: 2700',['d0','a7','sr']),[0,0xe1000000,0x2700]);assert.throws(()=>parsePrint('Failed to eval start',['d0']),/Resposta inesperada/)
 assert.deepEqual(parseStop('68K Breakpoint 3 hit\n2276: link.w a6, #$FFFFFFBC'),{breakpoint:3,address:0x2276,instruction:'link.w a6, #$FFFFFFBC'});assert.deepEqual(parseStop('B22: lsr.w #8, d0'),{breakpoint:null,address:0xb22,instruction:'lsr.w #8, d0'});assert.equal(parseStop('nada'),null)
 assert.deepEqual(parseBreakpointSet('68K Breakpoint 1 set at $2276'),{index:1,address:0x2276});assert.equal(parseBreakpointSet('erro'),null)
 assert.deepEqual(memoryPlan(0x100,10).map(group=>nativeCommands.read(group)),['p/x [$100].l [$104].l [$108].b [$109].b']);assert.equal(memoryPlan(0,64).length,2);assert.ok(memoryPlan(0,1024).every(group=>nativeCommands.read(group).length<130))
 assert.equal(nativeCommands.breakpoint(0x2276),'b $2276','sem "$" o BlastEm leria o número como decimal')
 const vdp=parseVdpRegisters('**Mode Group**\n00: 04 | H-ints disabled\n0C: 81 | Width: 40, Shadow/Highlight: disabled\n\n**DMA Group**\n13: 00 |\n\n**Internal Group**\nAddress: 9E00\nCD:      2 - invalid\nVINT Pending: false\n')
 assert.deepEqual(vdp.groups.map(group=>[group.title,group.rows.length]),[['Mode Group',2],['DMA Group',1]]);assert.deepEqual(vdp.registers[1],{register:0x0c,value:0x81,description:'Width: 40, Shadow/Highlight: disabled'});assert.deepEqual(vdp.internal.map(item=>item.name),['Address','CD','VINT Pending'])
 assert.throws(()=>parseVdpRegisters('vr is not a recognized command'),/ao ler o VDP/)
 assert.deepEqual(parseVdpSprites('Sprite 0: X=160(32), Y=280(152), Width=16, Height=24, Link=1, Pal=1, Pri=1, Pat=A400\nSprite 1: X=0(-128), Y=0(-128), Width=8, Height=8, Link=0, Pal=0, Pri=0, Pat=0'),
  [{index:0,x:32,y:152,rawX:160,rawY:280,width:16,height:24,link:1,palette:1,priority:1,pattern:0xa400},{index:1,x:-128,y:-128,rawX:0,rawY:0,width:8,height:8,link:0,palette:0,priority:0,pattern:0}])
 // Sessão nativa contra o terminal falso.
 const make=(options={})=>{const terminal=fakeTerminal(options.fake);return {terminal,debug:new BlastemNativeSession({backend:native,emulatorPath:'/fake/blastem',romPath:'/fake/rom.bin',cwd:'/fake',launch:(file,args,cwd)=>{terminal.launch=[file,args,cwd];return terminal},timeout:300,startTimeout:options.startTimeout||500})}}
 {
  const {terminal,debug}=make(),states=[],logs=[];debug.on('state',event=>states.push(event.state+':'+(event.reason||'')));debug.on('log',event=>logs.push(...event.lines))
  const start=await debug.start();assert.deepEqual([start.pc,start.a7,start.sr,debug.state],[0x200,0xe1000000,0x2700,'stopped']);assert.deepEqual(terminal.launch,['/fake/blastem',['-d','/fake/rom.bin'],'/fake']);assert.deepEqual(logs,['MEM_init: heap = e0ff0e62'])
  assert.equal(Buffer.from(await debug.memory(0x100,4)).toString('latin1'),'SEGA');assert.deepEqual([...(await debug.memory(0x204,6))],[4,4,4,4,8,9],'longs em ordem big-endian e bytes soltos no fim')
  for(const [address,length] of [[-1,4],[0,0],[0,1025],[0xFFFFFF,2]])await assert.rejects(debug.memory(address,length),/Faixa de memória inválida.*1024/)
  await assert.rejects(debug.setBreakpoint(0x211),/inválido/);assert.deepEqual(await debug.setBreakpoint(0x300),[0x300]);assert.deepEqual(await debug.setBreakpoint(0x400),[0x300,0x400])
  assert.equal((await debug.step()).pc,0x202);assert.equal((await debug.frames(2)).pc,0x222);await assert.rejects(debug.frames(0),/1 a 600/);await assert.rejects(debug.frames(601),/1 a 600/);await assert.rejects(debug.frames(1.5),/1 a 600/)
  assert.equal((await debug.continue()).pc,0x300);assert.deepEqual(states.slice(-6),['running:','stopped:step','running:','stopped:frames','running:','stopped:breakpoint']);assert.ok(logs.includes('quadro pronto'))
  assert.deepEqual(await debug.setBreakpoint(0x300,false),[0x400]);assert.ok(terminal.log.includes('d 0'),'remove pelo número que o emulador deu');assert.equal((await debug.continue()).pc,0x400)
  const vdpState=await debug.vdp();assert.deepEqual([vdpState.registers.length,vdpState.sprites[0].pattern,vdpState.internal.find(item=>item.name==='Status').value],[3,0xa400,'4E00'])
  await debug.setBreakpoint(0x400,false);const running=debug.continue();running.catch(()=>{});await tick(20);assert.equal(debug.state,'running');assert.ok(logs.includes('rodando sem parar'),'KDebug chega com o jogo rodando')
  for(const action of [()=>debug.registers(),()=>debug.vdp(),()=>debug.frames(1),()=>debug.memory(0x100,4),()=>debug.step()])await assert.rejects(action(),/O jogo está rodando/)
  const closed=[];debug.on('closed',event=>closed.push(event.reason));debug.stop();await assert.rejects(running,/Sessão encerrada/);await tick();assert.deepEqual(closed,['Sessão encerrada.'])
  assert.ok(terminal.log.every(command=>/^(p\/x [\w$ \[\].]+|s|c|vr|vs|frames \d+|b \$[0-9a-f]+|d \d+)$/.test(command)),'só comandos conhecidos: '+terminal.log.join(' | '))
 }
 {
  // Linha do jogo começando com "> " parece um prompt: a sessão espera a parada de verdade.
  const {terminal,debug}=make();await debug.start();await debug.setBreakpoint(0x300)
  const write=terminal.write.bind(terminal);terminal.write=text=>{if(text.trim()==='c'){terminal.emit('c\n> seta do jogo\n')}return write(text)}
  assert.equal((await debug.continue()).pc,0x300);assert.equal(debug.state,'stopped');debug.stop()
 }
 {const {terminal,debug}=make(),closed=[];debug.on('closed',event=>closed.push(event.reason));await debug.start();terminal.crash();await tick();assert.match(closed[0],/O emulador foi fechado \(código 1\)/);await assert.rejects(debug.step(),/Não há sessão|terminou/)}
 {const {debug}=make({fake:{silent:true},startTimeout:40});await assert.rejects(debug.start(),/não respondeu como depurador.*aviso na própria janela/);assert.equal(debug.state,'closed')}
 {const {terminal,debug}=make(),closed=[];debug.on('closed',event=>closed.push(event.reason));await debug.start();terminal.write=()=>{};await assert.rejects(debug.vdp(),/parou de responder/);assert.equal(closed.length,1)}
 {const debug=new BlastemNativeSession({backend:native,emulatorPath:'x',romPath:'y',launch:()=>{throw Error('sem terminal')}});await assert.rejects(debug.start(),/Não foi possível iniciar o emulador: sem terminal/);assert.equal(debug.state,'closed')}
}
function syntheticElf(){
 const names=['','main','helper','update','score'],strings=Buffer.from(names.join('\0')+'\0'),at=name=>strings.indexOf('\0'+name+'\0')+1
 const rows=[['main',0x200,0x20,0x12,1],['helper',0x280,8,2,1],['update',0x300,0x40,0x12,1],['helper',0x380,8,2,1],['score',0xff0010,2,0x11,2]],symbols=Buffer.alloc(16*(rows.length+1))
 rows.forEach(([name,address,size,info,section],index)=>{const offset=(index+1)*16;symbols.writeUInt32BE(at(name),offset);symbols.writeUInt32BE(address,offset+4);symbols.writeUInt32BE(size,offset+8);symbols[offset+12]=info;symbols.writeUInt16BE(section,offset+14)})
 const sectionNames=['','.text','.bss','.strtab','.symtab','.shstrtab'],nameBytes=Buffer.from(sectionNames.join('\0')+'\0')
 const definitions=[{type:0,flags:0,address:0,bytes:Buffer.alloc(0)},{type:1,flags:6,address:0x200,bytes:Buffer.alloc(0x200)},{type:8,flags:3,address:0xff0000,bytes:Buffer.alloc(0),size:32},
  {type:3,flags:0,address:0,bytes:strings},{type:2,flags:0,address:0,bytes:symbols,link:3,entrySize:16},{type:3,flags:0,address:0,bytes:nameBytes}]
 let position=52;for(const item of definitions){item.offset=position;position+=item.bytes.length}
 const table=position,elf=Buffer.alloc(table+definitions.length*40);Buffer.from('7f454c4601020100','hex').copy(elf)
 elf.writeUInt16BE(2,16);elf.writeUInt16BE(4,18);elf.writeUInt32BE(1,20);elf.writeUInt32BE(table,32);elf.writeUInt16BE(52,40);elf.writeUInt16BE(40,46);elf.writeUInt16BE(definitions.length,48);elf.writeUInt16BE(5,50)
 let nameOffset=0
 definitions.forEach((item,index)=>{const offset=table+index*40;elf.writeUInt32BE(nameOffset,offset);nameOffset+=sectionNames[index].length+1
  for(const [field,value] of [[4,item.type],[8,item.flags],[12,item.address],[16,item.offset],[20,item.size??item.bytes.length],[24,item.link||0],[36,item.entrySize||0]])elf.writeUInt32BE(value,offset+field);item.bytes.copy(elf,item.offset)})
 return elf
}
console.log('Debug session: fake GDB stub and fake native terminal (start, chunked memory, breakpoints, step, continue, refusal while running, disconnect, bad checksum, silent emulator), build flavor, symbols, service events and IPC surface passed.')
