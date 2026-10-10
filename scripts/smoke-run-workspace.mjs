// #45: modo Executar e painel inferior por contexto — scripts reais dos componentes em um
// hospedeiro Vue mínimo (não prova layout; a tela é conferida na IDE real por
// scripts/inspect-electron.sh), mais o fim de um build que falha.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {createI18n} from 'vue-i18n'
const messages=JSON.parse(fs.readFileSync(new URL('../src/locales/pt-BR.json',import.meta.url),'utf8'))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-run-workspace-'))
const old=globalThis.window
const apps=[]
async function host(file,buttons,output,stubs={}){
 const component=fileURLToPath(new URL(file,import.meta.url)),source=fs.readFileSync(component,'utf8')
 const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const template='<template><div>'+buttons.map(code=>'<button @click="'+code+'">x</button>').join('')+'<output>{{ JSON.stringify('+output+') }}</output></div></template>'
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 let compiled=compileScript(descriptor,{id:'host-'+path.basename(file),inlineTemplate:true}).content
 compiled=compiled.replace(/import (\w+) from (['"])(\.[^'"]+\.vue)\2/g,(_m,name)=>'const '+name+'={render(){return null}}') // child components are not under test
 compiled=compiled.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>'from '+JSON.stringify(/^[./]/.test(specifier)?pathToFileURL(path.resolve(path.dirname(component),specifier)).href:import.meta.resolve(specifier)))
 const target=path.join(temporary,path.basename(file)+'.mjs');fs.writeFileSync(target,compiled)
 const Component=(await import(pathToFileURL(target).href)).default
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},focus(){node.focused=this}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},
  insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:n=>{const list=n.parent?.children||[];return list[list.indexOf(n)+1]||null}})
 const props=ref({}),events=[],instance=ref(null),root=node('root')
 const app=renderer.createApp({render:()=>h(Component,{ref:instance,...props.value,...Object.fromEntries(stubs.emits.map(name=>['on'+name[0].toUpperCase()+name.slice(1).replace(/-(\w)/g,(_m,c)=>c.toUpperCase()),(...args)=>events.push([name,...args])]))})})
 app.use(createI18n({legacy:false,locale:'pt-BR',messages:{'pt-BR':messages}}));apps.push(app);app.mount(root)
 const flush=async()=>{for(let i=0;i<4;i++){await new Promise(resolve=>setTimeout(resolve,5));await nextTick()}}
 return {props,events,instance,flush,click:code=>{const index=buttons.indexOf(code);assert.ok(index>=0,code);return root.children[0].children.filter(n=>n.type==='button')[index].props.onClick()},state:()=>JSON.parse(root.children[0].children.find(n=>n.type==='output').text)}
}
try{
 // ---- Modo Executar --------------------------------------------------------------------
 const overviews=[],reports=[]
 globalThis.window={retroStudio:{retro:{exportOverview(payload){return new Promise((resolve,reject)=>overviews.push({payload,resolve,reject}))},inspectCompiledResources(payload){return new Promise(resolve=>reports.push({payload,resolve}))}}}}
 const run=await host('../src/components/retro/RunWorkspace.vue',['load()',"emit('build')","emit('open-mode','maps')"],'{state,pending:pending.map(r=>r.id),current:current.map(r=>r.id),blocking:[...blocking],rom:compiled?.rom?.path||null,freshness,loading,error,problems,busy}',{emits:['build','play','stop','open-error','open-mode']})
 run.props.value={projectPath:'/A',active:false,retro:true,errors:[]};await run.flush()
 assert.equal(overviews.length,0,'modo oculto não consulta o projeto')
 run.props.value={...run.props.value,active:true};await run.flush()
 assert.deepEqual(overviews[0].payload,{projectPath:'/A'});assert.equal(run.state().loading,true)
 const row=(id,state,message='')=>({id,title:id,editor:'Editor '+id,state,message,files:[]})
 overviews[0].resolve({rows:[row('world','stale','Os mapas mudaram.'),row('input','unexported','Ainda não exportado.'),row('camera','current'),row('debug','absent')],blocksBuild:['world'],summary:{}})
 reports[0].resolve({success:true,rom:{path:'out/rom.bin',size:655360,modifiedAt:'2026-10-10T12:00:00.000Z'},buildSnapshot:{status:'changed-since-build'}});await run.flush()
 let s=run.state();assert.deepEqual([s.pending,s.current,s.blocking,s.rom,s.loading,s.state],[['world','input'],['camera'],['world'],'out/rom.bin',false,'Pronto'])
 assert.match(s.freshness,/mudaram depois deste build/)
 // Estados: construindo, construindo para jogar, jogo no emulador, empacotando.
 for(const [extra,label] of [[{building:true},'Construindo…'],[{playing:true},'Construindo para jogar…'],[{running:true},'Jogo em execução no emulador'],[{packaging:true},'Empacotando…']]){run.props.value={...run.props.value,building:false,playing:false,running:false,packaging:false,...extra};await run.flush();assert.equal(run.state().state,label)}
 // Fim de um build: a tela confere de novo sozinha (ROM e pendências podem ter mudado).
 run.props.value={...run.props.value,packaging:false,building:true};await run.flush();const before=overviews.length
 run.props.value={...run.props.value,building:false};await run.flush();assert.equal(overviews.length,before+1)
 overviews.at(-1).resolve({rows:[row('world','current')],blocksBuild:[],summary:{}});reports.at(-1).resolve({success:true,rom:{path:'out/rom.bin',size:1,modifiedAt:'x'},buildSnapshot:{status:'matches-recorded-files'}});await run.flush()
 s=run.state();assert.deepEqual([s.pending,s.current],[[],['world']]);assert.match(s.freshness,/não mudaram desde este build/)
 // Problemas: erro, aviso e nota não se confundem.
 run.props.value={...run.props.value,errors:[{type:'error',file:'src/main.c',line:2,message:'x'},{type:'warning',file:'a.c',message:'y'},{type:'note',file:'a.c',message:'z'},{file:'b.c',message:'sem tipo'}]};await run.flush()
 assert.equal(run.state().problems,2)
 run.click("emit('build')");run.click("emit('open-mode','maps')");assert.deepEqual(run.events,[['build'],['open-mode','maps']])
 // Falha ao conferir e troca de projeto com resposta atrasada.
 run.click('load()');await run.flush();overviews.at(-1).reject(Error('sem acesso'));await run.flush();s=run.state();assert.match(s.error,/sem acesso/);assert.deepEqual(s.pending,[])
 run.click('load()');await run.flush();const late=overviews.at(-1);run.props.value={...run.props.value,projectPath:'/B'};await run.flush()
 assert.deepEqual(overviews.at(-1).payload,{projectPath:'/B'});late.resolve({rows:[row('world','failed','de A')],blocksBuild:['world']});await run.flush();assert.deepEqual(run.state().pending,[],'resposta do projeto anterior descartada')
 overviews.at(-1).resolve({rows:[],blocksBuild:[]});reports.at(-1).resolve({success:false});await run.flush();assert.equal(run.state().rom,null)
 run.props.value={...run.props.value,retro:false};await run.flush();assert.equal(run.state().rom,null)
 // ---- Painel inferior ------------------------------------------------------------------
 const dock=await host('../src/components/MainEditorArea.vue',["select('context')","select('problems')","select('terminal')"],'{current,tabs:dockTabs.map(t=>t.id+(t.count?":"+t.count:"")),terminalActivated}',{emits:['open-dock','dock-context-active','close-terminal','update:dockTabs']})
 const tabs=()=>{const last=dock.events.filter(e=>e[0]==='update:dockTabs').at(-1);if(last)dock.props.value={...dock.props.value,dockTabs:last[1]}}
 dock.props.value={mode:'code',contextLabel:'',isTerminalOpen:false,compilationErrors:[],dockTabs:{}};await dock.flush()
 s=dock.state();assert.deepEqual([s.current,s.tabs,s.terminalActivated],['terminal',['terminal','problems'],false],'painel fechado não inicia o terminal')
 dock.props.value={...dock.props.value,isTerminalOpen:true};await dock.flush();assert.equal(dock.state().terminalActivated,true)
 // Cada modo lembra a própria aba; modo sem aba de contexto cai no terminal.
 dock.props.value={...dock.props.value,mode:'characters',contextLabel:'Linha do tempo'};await dock.flush();dock.click("select('context')");tabs();await dock.flush()
 assert.deepEqual([dock.state().current,dock.state().tabs],['context',['terminal','problems','context']]);assert.deepEqual(dock.events.filter(e=>e[0]==='dock-context-active').at(-1),['dock-context-active',true])
 dock.props.value={...dock.props.value,mode:'code',contextLabel:''};await dock.flush();assert.equal(dock.state().current,'terminal');assert.deepEqual(dock.events.filter(e=>e[0]==='dock-context-active').at(-1),['dock-context-active',false])
 dock.props.value={...dock.props.value,mode:'characters',contextLabel:'Linha do tempo'};await dock.flush();assert.equal(dock.state().current,'context','ao voltar ao modo, a aba escolhida continua')
 // Fechar o painel desliga o contexto (a linha do tempo volta ao editor).
 dock.props.value={...dock.props.value,isTerminalOpen:false};await dock.flush();assert.deepEqual(dock.events.filter(e=>e[0]==='dock-context-active').at(-1),['dock-context-active',false])
 // Problemas novos trazem a lista para a frente e pedem para abrir o painel; os seguintes não roubam a aba.
 // Só avisos e notas (build que deu certo): o contador mostra, mas a aba não é roubada nem o painel aberto.
 dock.props.value={...dock.props.value,compilationErrors:[{severity:'warning',message:'w'},{severity:'info',message:'n'}]};await dock.flush();tabs()
 assert.equal(dock.state().tabs[1],'problems:2');assert.equal(dock.events.filter(e=>e[0]==='open-dock').length,0)
 dock.props.value={...dock.props.value,compilationErrors:[]};await dock.flush()
 dock.props.value={...dock.props.value,compilationErrors:[{severity:'error',message:'a'},{message:'b'}]};await dock.flush();tabs();await dock.flush()
 assert.deepEqual([dock.state().current,dock.state().tabs[1]],['problems','problems:2']);assert.equal(dock.events.filter(e=>e[0]==='open-dock').length,1)
 dock.click("select('terminal')");tabs();dock.props.value={...dock.props.value,isTerminalOpen:true,compilationErrors:[{message:'a'},{message:'b'},{message:'c'}]};await dock.flush();tabs();await dock.flush();assert.equal(dock.state().current,'terminal');assert.equal(dock.events.filter(e=>e[0]==='open-dock').length,1)
 dock.props.value={...dock.props.value,compilationErrors:[]};await dock.flush();dock.props.value={...dock.props.value,compilationErrors:[{message:'novo'}]};await dock.flush();tabs();await dock.flush();assert.equal(dock.state().current,'problems')
 // As abas escolhidas pertencem ao dono (ficam no layout do projeto): outro projeto, outras abas.
 dock.props.value={...dock.props.value,mode:'characters',dockTabs:{characters:'problems'}};await dock.flush();assert.equal(dock.state().current,'problems')
 dock.props.value={...dock.props.value,dockTabs:{}};await dock.flush();assert.equal(dock.state().current,'terminal')
 // ---- Build que falha: a barra volta a ficar disponível ---------------------------------
 const {useRetroBuild}=await import('../src/composables/useRetroBuild.js')
 let ran=0
 const build=useRetroBuild({workspacePath:ref('/A'),projectConfig:ref({}),retroUiSettings:ref({toolkitPath:'/toolkit'}),runGame(){ran++},buildOnly(){ran++},stopBuild(){},openSettings(){}})
 globalThis.window.retroStudioToast={warning(){},error(){},success(){}}
 await build.handleBuildRetro();assert.equal(build.isBuilding.value,true);build.handleBuildFailed();assert.deepEqual([build.isBuilding.value,build.isPlaying.value,build.buildProgressMessage.value],[false,false,''])
 build.handlePlayRetro();assert.equal(build.isPlaying.value,true);build.handleBuildFailed();assert.equal(build.isPlaying.value,false);assert.equal(ran,2)
 const shell=fs.readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 assert.match(shell,/onRunGameError\?\.\(\(\{ message \}\) => \{\s*handleBuildFailed\(\)/,'um build que falha encerra o estado "em andamento"')
 assert.match(shell,/onEmulatorClosed\?\.\(\(\) => \{ emulatorRunning\.value = false \}\)/)
 assert.match(shell,/function openTerminal\(\) \{ showTerminalTab\(\);/,'abrir o terminal mostra a aba Terminal');assert.match(shell,/dialog\[open\]'\) \|\| event\.target\?\.closest\?\.\('\.xterm'\)/,'atalhos de modo não agem atrás de um diálogo nem no terminal')
 assert.match(shell,/\[dockAudioRef\.value, 'Áudio'\], \[dockDebugRef\.value, 'Diagnóstico'\]/,'editores do painel inferior entram no guard de saída')
 assert.doesNotMatch(shell,/onBuildComplete\?\.\(\(payload\) => \{[^}]*compilationErrors\.value = \[\]/,'avisos de um build que deu certo continuam listados')
 assert.match(shell,/Digit1: openCodeWorkspace, Digit2: openTilemapEditorFromBar, Digit3: openCharactersWorkspace, Digit4: openScenesWorkspace, Digit5: openRunWorkspace/)
 for(const file of ['DebugPanel.vue','AudioEditor.vue'])assert.match(fs.readFileSync(new URL('../src/components/retro/'+file,import.meta.url),'utf8'),/<Teleport to="body" :disabled="embedded">\s*<component :is="embedded \? 'section' : 'dialog'"/)
 assert.match(fs.readFileSync(new URL('../src/components/retro/CharsetMaker.vue',import.meta.url),'utf8'),/<Teleport defer to="#workspace-dock-timeline" :disabled="!timelineDock">/)
}finally{for(const app of apps)app.unmount();if(old===undefined)delete globalThis.window;else globalThis.window=old;fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Run workspace: pending exports, compiled ROM freshness, states, refresh after build, problem kinds, stale responses; bottom dock tabs per mode, context activation, problems brought forward; failed build releases the toolbar.')
