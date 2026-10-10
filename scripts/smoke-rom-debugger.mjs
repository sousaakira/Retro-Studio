// #64: tela do depurador de ROM. Compila o <script setup> real e dirige os fluxos: capacidades
// por backend, início, parada com e sem linha de C, breakpoints, memória, jogo rodando,
// desconexão, build para depurar e troca de projeto.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {createI18n} from 'vue-i18n'
import {DEBUG_BACKENDS} from '../electron/retro/debugSession.js'
const locales=Object.fromEntries(['pt-BR','en','es','ja'].map(name=>[name,JSON.parse(fs.readFileSync(new URL('../src/locales/'+name+'.json',import.meta.url),'utf8'))]))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-rom-debugger-')),old=globalThis.window
const file=fileURLToPath(new URL('../src/components/retro/RomDebugger.vue',import.meta.url)),source=fs.readFileSync(file,'utf8')
let app
try{
 const buttons=['start()','end()','step()','resume()','addBreakpoint()','removeBreakpoint(0x300)','readMemory()','buildForDebug()',"backendId='gen_sdl2'","backendId='blastem-gdb'","breakpointText='update'","memoryText='score'","memoryText='0xC00000';memoryLength=99999",'load()','cancelBuild()','readVdp()','frameCount=5;advanceFrames()','frameCount=99999;advanceFrames()',"backendId='blastem-native'"]
 const output="{backendId,caps:CAPABILITIES.filter(can),open,running,stopped,place,reason,source:stop?.source||null,note:stop?.sourceNote||'',breakpoints:session?.breakpoints.map(item=>item.label)||[],rows,memory:memory&&memory.region,error,notice,closed,working,confirmRun,vdp:vdp&&{registers:vdp.registers.length,sprites:vdp.sprites.length},logs,game:game&&{lines:game.hasLines,flavor:game.flavor},buildErrors:buildErrors.length,locked,breakpointText}"
 const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const {descriptor}=parse('<script setup>'+script+'</script><template><div>'+buttons.map(code=>'<button @click="'+code+'">x</button>').join('')+'<output>{{ JSON.stringify('+output+') }}</output></div></template>')
 const compiled=compileScript(descriptor,{id:'host-rom-debugger',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_m,_q,specifier)=>'from '+JSON.stringify(/^[./]/.test(specifier)?pathToFileURL(path.resolve(path.dirname(file),specifier)).href:import.meta.resolve(specifier)))
 const target=path.join(temporary,'RomDebugger.mjs');fs.writeFileSync(target,compiled)
 // ---- IDE falsa ---------------------------------------------------------------------------
 const calls=[],listeners=new Set();let session=null,game={rom:{path:'out/rom.bin',size:655360},flavor:'release',functions:945,variables:221,hasLines:false,association:'proven',sourcesChanged:false},answers={}
 const backends=DEBUG_BACKENDS.map(item=>({...item,installed:item.id!=='picodrive'}))
 const fire=event=>{for(const listener of [...listeners])listener(event)}
 const registers=pc=>Object.fromEntries(['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3','a4','a5','a6','a7','sr','pc'].map(name=>[name,name==='pc'?pc:name==='sr'?0x2700:0]))
 const stopAt=(pc,name,offset,sourceAt,note='')=>({pc,pcText:'0x'+pc.toString(16).toUpperCase().padStart(6,'0'),function:name?{name,offset}:null,source:sourceAt,sourceNote:note,registers:registers(pc)})
 const snapshot=(state,breakpoints=session?.breakpoints||[])=>(session={state,backend:'blastem-native',projectPath:'/A',rom:'out/rom.bin',breakpoints})
 globalThis.window={retroStudio:{retro:{
  debugStatus:async payload=>{calls.push(['status',payload]);return answers.status||{success:true,backends,selectedEmulator:'gen_sdl2',game,session:payload.projectPath==='/A'?session:null}},
  debugStart:async payload=>{calls.push(['start',payload]);if(answers.start)return answers.start;snapshot('stopped',[]);queueMicrotask(()=>fire({type:'state',projectPath:'/A',session,reason:'start',stop:stopAt(0x200,null,0,null,'Sem linha de C: o jogo não foi construído para depurar.')}));return {success:true,session}},
  debugBuild:async payload=>{calls.push(['build',payload]);return answers.build},
  debugCommand:async payload=>{calls.push(['command',payload]);return answers.command(payload)},
  onDebugEvent:callback=>{listeners.add(callback);return ()=>listeners.delete(callback)}}}}
 const Component=(await import(pathToFileURL(target).href)).default
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},
  insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:n=>{const list=n.parent?.children||[];return list[list.indexOf(n)+1]||null}})
 const props=ref({projectPath:'/A',active:false,busy:false}),events=[],root=node('root')
 app=renderer.createApp({render:()=>h(Component,{...props.value,onOpenSource:value=>events.push(['open-source',value]),onBuilt:()=>events.push(['built']),onBuilding:value=>events.push(['building',value])})})
 app.use(createI18n({legacy:false,locale:'pt-BR',messages:{'pt-BR':locales['pt-BR']}}));app.mount(root)
 const flush=async()=>{for(let i=0;i<4;i++){await new Promise(resolve=>setTimeout(resolve,5));await nextTick()}}
 const click=async code=>{const index=buttons.indexOf(code);assert.ok(index>=0,code);await root.children[0].children.filter(n=>n.type==='button')[index].props.onClick();await flush()}
 const state=()=>JSON.parse(root.children[0].children.find(n=>n.type==='output').text)

 // 1. Oculta não consulta; visível mostra o backend e só as capacidades dele.
 await flush();assert.equal(calls.length,0);props.value={...props.value,active:true};await flush()
 assert.deepEqual(calls,[['status',{projectPath:'/A'}]])
 let s=state();assert.deepEqual([s.backendId,s.caps,s.open,s.game],['blastem-native',['step','continue','frames','breakpoints','registers','memory','vdp','kdebug'],false,{lines:false,flavor:'release'}])
 await click("backendId='gen_sdl2'");assert.deepEqual(state().caps,[],'emulador sem depuração: nada é oferecido')
 await click("backendId='blastem-gdb'");assert.deepEqual(state().caps,['step','continue','breakpoints','registers','memory'],'protocolo do GDB: sem VDP, quadros ou KDebug');await click("backendId='blastem-native'")
 // 2. Início: parado no começo, sem linha de C, com o motivo.
 await click('start()');s=state()
 assert.deepEqual(calls.at(-1),['start',{projectPath:'/A',backend:'blastem-native'}]);assert.deepEqual([s.open,s.stopped,s.running,s.reason,s.place,s.source],[true,true,false,'start','fora das funções do jogo',null]);assert.match(s.note,/não foi construído para depurar/)
 // 3. Breakpoint por nome; erro do serviço aparece e não derruba a tela.
 answers.command=payload=>payload.location==='update'?{success:true,session:snapshot('stopped',[{address:0x300,addressText:'0x000300',label:'update'}])}:{success:false,error:'“x” não é um endereço.'}
 await click("breakpointText='update'");await click('addBreakpoint()');s=state()
 assert.deepEqual(calls.at(-1),['command',{projectPath:'/A',command:'breakpoint',location:'update',enabled:true}]);assert.deepEqual([s.breakpoints,s.breakpointText,s.error],[['update'],'',''])
 // 4. Continuar: rodando até o evento de parada; linha de C navegável quando o serviço a comprova.
 answers.command=()=>{snapshot('running');queueMicrotask(()=>fire({type:'state',projectPath:'/A',session,reason:''}));return {success:true,warning:''}}
 await click('resume()');s=state();assert.deepEqual([s.running,s.stopped,s.notice],[true,false,''])
 fire({type:'state',projectPath:'/B',session:{state:'stopped',breakpoints:[]},reason:'breakpoint',stop:stopAt(0x999,'outro',0,null)});await flush();assert.equal(state().running,true,'evento de outro projeto é ignorado')
 snapshot('stopped');fire({type:'state',projectPath:'/A',session,reason:'breakpoint',stop:stopAt(0x306,'update',6,{file:'src/main.c',line:42})});await flush();s=state()
 assert.deepEqual([s.stopped,s.reason,s.place,s.source],[true,'breakpoint','update+0x6',{file:'src/main.c',line:42}])
 // 5. Memória: variável usa o tamanho do símbolo; endereço manda o comprimento, limitado a 4096; região não confiável é dita.
 answers.command=payload=>({success:true,address:0xff0010,addressText:'0xFF0010',label:payload.location,bytes:[0x53,0x45,0x47,0x41,0,255,...Array(14).fill(1)],region:'RAM do 68000'})
 await click("memoryText='score'");await click('readMemory()');s=state()
 assert.deepEqual(calls.at(-1),['command',{projectPath:'/A',command:'memory',location:'score'}]);assert.equal(s.memory,'RAM do 68000')
 assert.deepEqual(s.rows.map(row=>[row.address,row.text]),[['FF0010','SEGA··'+'·'.repeat(10)],['FF0020','····']]);assert.equal(s.rows[0].bytes.slice(0,17),'53 45 47 41 00 FF')
 await click("memoryText='0xC00000';memoryLength=99999");await click('readMemory()');assert.deepEqual(calls.at(-1)[1],{projectPath:'/A',command:'memory',location:'0xC00000',length:1024},'comprimento limitado ao que o backend lê')
 // VDP, quadros e KDebug (backend nativo).
 answers.command=payload=>payload.command==='vdp'?{success:true,vdp:{groups:[{title:'Mode Group',rows:[{register:1,value:0x74,description:'Display enabled'}]}],internal:[{name:'Status',value:'4E00'}],registers:[{register:1,value:0x74,description:'Display enabled'}],sprites:[{index:0,x:32,y:152,width:16,height:24,link:0,palette:1,priority:1,pattern:0xa400}]}}:{success:true}
 await click('readVdp()');assert.deepEqual(calls.at(-1)[1],{projectPath:'/A',command:'vdp'});assert.deepEqual(state().vdp,{registers:1,sprites:1})
 await click('frameCount=5;advanceFrames()');assert.deepEqual(calls.at(-1)[1],{projectPath:'/A',command:'frames',count:5});await click('frameCount=99999;advanceFrames()');assert.equal(calls.at(-1)[1].count,600)
 fire({type:'log',projectPath:'/A',lines:['MEM_init: heap = e0ff0e62','oi']});fire({type:'log',projectPath:'/B',lines:['de outro projeto']});await flush();assert.deepEqual(state().logs,['MEM_init: heap = e0ff0e62','oi'])
 fire({type:'log',projectPath:'/A',lines:Array.from({length:250},(_v,index)=>'linha '+index)});await flush();assert.deepEqual([state().logs.length,state().logs.at(-1)],[200,'linha 249'],'só as 200 mensagens mais recentes ficam na tela')
 fire({type:'state',projectPath:'/A',session,reason:'frames',stop:stopAt(0x400,'update',0x100,null)});await flush();assert.deepEqual([state().reason,state().vdp],['frames',null],'parada nova: a leitura antiga do VDP some')
 // 6. Passo: a parada nova apaga a leitura antiga (a memória pode ter mudado).
 answers.command=()=>{queueMicrotask(()=>fire({type:'state',projectPath:'/A',session,reason:'step',stop:stopAt(0x308,'update',8,null,'Linha src/main.c:43 no build, mas os fontes mudaram depois: a posição pode estar deslocada.')}));return {success:true}}
 await click('step()');s=state();assert.deepEqual([s.reason,s.place,s.source,s.memory],['step','update+0x8',null,null]);assert.match(s.note,/fontes mudaram depois/)
 // 7. Continuar sem breakpoint: aviso de que não há pausa; comando recusado enquanto roda.
 answers.command=payload=>payload.command==='breakpoint'?{success:true,session:snapshot('stopped',[])}:null
 await click('removeBreakpoint(0x300)');assert.deepEqual(calls.at(-1)[1],{projectPath:'/A',command:'breakpoint',address:0x300,enabled:false});assert.deepEqual(state().breakpoints,[])
 answers.command=payload=>payload.command==='continue'?(snapshot('running'),queueMicrotask(()=>fire({type:'state',projectPath:'/A',session,reason:''})),{success:true,warning:'Sem breakpoints ativos o jogo roda até a sessão ser encerrada: este emulador não tem pausa.'}):{success:false,error:'O jogo está rodando. Este emulador só devolve o controle em um breakpoint; encerre a sessão para parar.'}
 const sent=calls.length;await click('resume()');s=state();assert.deepEqual([s.confirmRun,s.running,calls.length],[true,false,sent],'sem breakpoints: primeiro avisa, nada é enviado')
 await click("breakpointText='update'");assert.equal(state().confirmRun,true)
 await click('resume()');s=state();assert.deepEqual([s.confirmRun,s.running],[false,true],'segundo pedido confirma');assert.match(s.notice,/não tem pausa/);assert.deepEqual(calls.at(-1)[1],{projectPath:'/A',command:'continue'})
 await click('readMemory()');assert.match(state().error,/O jogo está rodando/)
 // O emulador para de responder: o evento de fechamento e o erro da chamada trazem a mesma frase; aparece uma vez só.
 const silent='O emulador parou de responder aos comandos de depuração. A sessão foi encerrada.'
 snapshot('stopped');fire({type:'state',projectPath:'/A',session,reason:'step',stop:stopAt(0x308,'update',8,null)});await flush()
 answers.command=()=>{session=null;fire({type:'closed',projectPath:'/A',reason:silent});return {success:false,error:silent}}
 await click('step()');s=state();assert.deepEqual([s.open,s.closed,s.error],[false,silent,''])
 answers.command=()=>{session=null;return new Promise(resolve=>setTimeout(()=>{resolve({success:false,error:silent})},1))}
 await click('start()');snapshot('stopped');answers.command=()=>({success:false,error:silent});await click('step()');assert.equal(state().error,silent);fire({type:'closed',projectPath:'/A',reason:silent});await flush();s=state();assert.deepEqual([s.closed,s.error],[silent,''],'erro chega antes do evento: também não duplica')
 await click('start()');snapshot('running');fire({type:'state',projectPath:'/A',session,reason:''});await flush()
 // 8. O emulador é fechado: a tela diz e volta ao estado inicial.
 session=null;fire({type:'closed',projectPath:'/A',reason:'O emulador foi fechado (código 1). A sessão de depuração terminou.'});await flush();s=state()
 assert.deepEqual([s.open,s.running,s.source,s.memory],[false,false,null,null]);assert.match(s.closed,/O emulador foi fechado/)
 // 9. Falha ao iniciar (ex.: emulador não instalado) e encerramento pedido pelo usuário.
 answers.start={success:false,error:'BlastEm · protocolo remoto do GDB não está instalado. Instale o emulador em Configurações → Emuladores.'}
 await click('start()');s=state();assert.equal(s.open,false);assert.match(s.error,/não está instalado/);assert.equal(s.closed,'','um novo início limpa o aviso de desconexão')
 answers.start=null;await click('start()');assert.equal(state().open,true);assert.deepEqual(state().logs,[],'sessão nova começa sem mensagens antigas')
 answers.command=payload=>{assert.equal(payload.command,'stop');session=null;queueMicrotask(()=>fire({type:'closed',projectPath:'/A',reason:'Sessão encerrada.'}));return {success:true}}
 await click('end()');s=state();assert.deepEqual([s.open,s.closed],[false,'Sessão encerrada.'])
 // 10. Construir para depurar: falha lista os erros; sucesso atualiza o resumo e avisa o modo Executar.
 answers.build={success:false,error:'O build para depurar falhou.',errors:[{type:'error',file:'src/main.c',line:3,message:'x'},{type:'warning',file:'a.c',line:1,message:'y'}]}
 await click('buildForDebug()');s=state();assert.deepEqual([s.buildErrors,s.working],[1,'']);assert.match(s.error,/falhou/);assert.deepEqual(events.slice(-3),[['building',true],['building',false],['built']],'o modo Executar sabe que há um build usando out/')
 answers.build={success:true,errors:[]};game={...game,flavor:'debug',hasLines:true}
 await click('buildForDebug()');s=state();assert.deepEqual([s.game,s.buildErrors,s.error,s.notice],[{lines:true,flavor:'debug'},0,'','Jogo construído para depurar.']);assert.deepEqual(calls.filter(call=>call[0]==='build').at(-1),['build',{projectPath:'/A'}])
 answers.build={success:false,cancelled:true,error:'Build cancelado.',errors:[]};await click('buildForDebug()');s=state();assert.deepEqual([s.error,s.notice],['','Build para depurar cancelado. O próximo build limpa e refaz tudo.'])
 await click('cancelBuild()');assert.deepEqual(calls.at(-1),['build',{projectPath:'/A',cancel:true}])
 answers.build={success:true,errors:[]}
 // 11. Build da IDE em andamento trava as ações; ao terminar, o resumo é conferido de novo.
 props.value={...props.value,busy:true};await flush();assert.equal(state().locked,true)
 const before=calls.filter(call=>call[0]==='status').length;props.value={...props.value,busy:false};await flush();assert.equal(calls.filter(call=>call[0]==='status').length,before+1)
 // Tela remontada com uma sessão GDB já aberta: o backend mostrado é o da sessão e a última parada volta.
 session={state:'stopped',backend:'blastem-gdb',projectPath:'/A',rom:'out/rom.bin',breakpoints:[],last:{reason:'breakpoint',stop:stopAt(0x300,'update',0,{file:'src/main.c',line:9})}}
 await click('load()');s=state();assert.deepEqual([s.backendId,s.caps.includes('vdp'),s.open,s.reason,s.place,s.source],['blastem-gdb',false,true,'breakpoint','update',{file:'src/main.c',line:9}]);session=null;await click('load()')
 // 12. Troca de projeto: a sessão do outro projeto não aparece aqui.
 snapshot('stopped',[]);props.value={...props.value,projectPath:'/B'};await flush();assert.deepEqual(calls.at(-1),['status',{projectPath:'/B'}]);assert.equal(state().open,false);session=null
 app.unmount();app=null;assert.equal(listeners.size,0,'ao sair, o ouvinte de eventos é removido')

 // 13. Marcação real: controles habilitados só pela capacidade; pausa sempre desabilitada com o motivo; avisos anunciados.
 const template=source.match(/<template>([\s\S]*)<\/template>/)[1]
 assert.match(template,/:disabled="!stopped\|\|locked\|\|!can\('step'\)" @click="step"/);assert.match(template,/:disabled="!stopped\|\|locked\|\|!can\('continue'\)" @click="resume">\{\{ confirmRun \? t\('romDebug\.continueAnyway'\)/);assert.match(template,/<p v-if="confirmRun" role="alert"/)
 assert.match(template,/<button type="button" disabled :title="t\('romDebug\.pauseWhy'\)">/);assert.match(template,/:disabled="locked\|\|!game\?\.rom\|\|!can\('registers'\)\|\|!backend\?\.installed" @click="start"/)
 assert.match(template,/<form v-if="can\('frames'\)" class="field" @submit\.prevent="advanceFrames">/);assert.match(template,/<template v-if="can\('vdp'\)">/);assert.match(template,/<template v-if="can\('kdebug'\)">/)
 assert.match(template,/<li v-for="name in CAPABILITIES"[^>]*>.*t\('romDebug\.available'\) : t\('romDebug\.notAvailable'\)/);assert.match(template,/<li v-for="note in backend\.notes"/)
 assert.equal((template.match(/role="alert"/g)||[]).length,3);assert.ok((template.match(/role="status"/g)||[]).length>=2)
 for(const id of ['rom-debug-backend','rom-debug-breakpoint','rom-debug-memory','rom-debug-length','rom-debug-frames'])assert.ok(template.includes('<label for="'+id+'">')&&template.includes('id="'+id+'"'),id)
 assert.match(template,/v-if="stop\.source"> · <button type="button" class="link" @click="emit\('open-source'/);assert.ok(!/v-html/.test(template))
 // 14. Textos: as mesmas chaves nos quatro idiomas, todas as usadas existem, e os parâmetros coincidem.
 const flat=(value,prefix='')=>Object.entries(value).flatMap(([key,item])=>typeof item==='string'?[[prefix+key,item]]:flat(item,prefix+key+'.'))
 const reference=new Map(flat(locales['pt-BR'].romDebug))
 for(const [name,data] of Object.entries(locales)){const own=new Map(flat(data.romDebug));assert.deepEqual([...own.keys()].sort(),[...reference.keys()].sort(),name)
  for(const [key,text] of own)assert.deepEqual((text.match(/\{\w+\}/g)||[]).sort(),(reference.get(key).match(/\{\w+\}/g)||[]).sort(),name+' '+key)}
 const used=new Set([...source.matchAll(/t\('romDebug\.([\w.]+)'/g)].map(match=>match[1]))
 for(const key of used)assert.ok(key.endsWith('.')?[...reference.keys()].some(item=>item.startsWith(key)):reference.has(key),'texto ausente: '+key)
 for(const name of Object.keys(DEBUG_BACKENDS[0].capabilities))assert.ok(reference.has('cap.'+name),name);assert.equal([...reference.keys()].filter(key=>key.startsWith('cap.')).length,Object.keys(DEBUG_BACKENDS[0].capabilities).length)
 for(const name of ['start','step','breakpoint','frames','other'])assert.ok(reference.has('reason.'+name))
 const unused=[...reference.keys()].filter(key=>!used.has(key)&&!key.startsWith('cap.')&&!key.startsWith('reason.'));assert.deepEqual(unused,[],'texto sem uso')
 // 15. Modo Executar: a tela está lá, com navegação para o código.
 assert.match(fs.readFileSync(new URL('../src/components/retro/RunWorkspace.vue',import.meta.url),'utf8'),/<RomDebugger :project-path="projectPath" :active="active" :busy="building\|\|playing\|\|packaging" @open-source="emit\('open-error',\$event\)" @built="load" @building="debugBuilding=\$event" \/>/)
 console.log('ROM debugger: capabilities per backend, start, stop with and without C line, breakpoints, memory regions, running without pause, disconnect, debug build, project switch, markup and four locales passed.')
}finally{app?.unmount();globalThis.window=old;fs.rmSync(temporary,{recursive:true,force:true})}
