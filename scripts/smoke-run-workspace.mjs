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
 // #67: uma barra só. Com projeto aberto, modos, construir/jogar/parar, painéis e IA ficam dentro da barra
 // principal (WorkspaceToolbar no slot da barra de título); nenhuma ação aparece duas vezes e nenhum ícone
 // tem dois significados.
 {
  const titlebar=fs.readFileSync(new URL('../src/components/TitleBar.vue',import.meta.url),'utf8'),toolbar=fs.readFileSync(new URL('../src/components/WorkspaceToolbar.vue',import.meta.url),'utf8')
  const emitted=source=>new Set([...source.matchAll(/\$emit\('([\w-]+)'/g)].map(match=>match[1]))
  const top=emitted(titlebar),bottom=emitted(toolbar)
  const icons=source=>[...source.matchAll(/class="(icon-[\w-]+)"/g)].map(match=>match[1])
  for(const gone of ['open-map-editor'])assert.ok(!top.has(gone)&&!titlebar.includes("'"+gone+"'"),'saiu da barra de título: '+gone)
  // Construir, jogar e parar ficam logo depois do seletor de emulador, só com ícone, e em mais nenhum lugar da barra.
  for(const moved of ['build','play','stop']){assert.ok(top.has(moved+'-retro')&&!bottom.has(moved),moved+' fica ao lado do emulador');assert.match(titlebar,new RegExp('<button class="tbBtn '+moved+'Btn"[^>]*:title="[^"]+"[^>]*:aria-label="[^"]+"[^>]*@click="\\$emit\\(\''+moved+'-retro\'\\)"'),moved)}
  assert.match(titlebar,/<\/select>\s*<\/div>\s*<!--[^>]*-->\s*<div v-if="hasWorkspace" class="build-section">/,'depois do seletor de emulador')
  for(const kept of ['menu-action','save-active','search','command-palette','help','updates','package-retro','toggle-cartridge','open-store-login','emulator-change'])assert.ok(top.has(kept),'continua na barra de título: '+kept)
  for(const only of ['code','maps','characters','scenes','run','game','resources','sidebar','terminal','ai','reset'])assert.ok(bottom.has(only),'barra de modos: '+only)
  // Terminal e IA aparecem em cima só quando não há barra de modos (nenhum projeto aberto).
  for(const event of ['toggle-ai-terminal','toggle-terminal'])assert.match(titlebar,new RegExp('<button\\s+v-if="!hasWorkspace"[^>]*@click="\\$emit\\(\''+event+'\'\\)"'),event+' só sem projeto aberto')
  assert.match(shell,/<TitleBar[\s\S]*?:has-workspace="!!workspacePath"/);assert.match(shell,/<template v-if="workspacePath" #workspace>\s*<WorkspaceToolbar[\s\S]*?<\/template>\s*<\/TitleBar>/,'a barra de modos mora dentro da barra principal')
  assert.equal((shell.match(/<WorkspaceToolbar/g)||[]).length,1);assert.match(titlebar,/<div class="titlebarCenter"><slot name="workspace">\{\{ title \}\}<\/slot><\/div>/)
  // Um ícone, um significado, nas duas partes da barra: nenhuma classe de ícone se repete entre elas, nem dentro de cada uma (fora os controles da janela).
  // (terminal e IA da barra de título só existem sem projeto aberto, quando a parte dos modos não existe: não contam.)
  {const always=titlebar.replace(/<button\s+v-if="!hasWorkspace"[\s\S]*?<\/button>/g,''),all=[...icons(always).filter(name=>!/^icon-(xmark|window-)/.test(name)),...icons(toolbar)],seen=new Set(),twice=all.filter(name=>seen.has(name)||!seen.add(name));assert.deepEqual([...new Set(twice)],[],'ícone repetido: '+twice.join(', '))}
  // Todos os botões são só ícone, com nome acessível e dica; nenhum botão some em janela estreita.
  assert.ok(!toolbar.includes('class="label'),'sem rótulos visíveis')
  for(const event of ['code','maps','characters','scenes','run','resources','sidebar','terminal','ai','reset'])assert.match(toolbar,new RegExp('<button type="button"(?=[^>]*:title="[^"]+")(?=[^>]*:aria-label="[^"]+")[^>]*@click="\\$emit\\(\''+event+'\'\\)"'),event)
  for(const rule of toolbar.matchAll(/([^{}]+)\{[^{}]*display:none[^{}]*\}/g))assert.match(rule[1].trim(),/(\.workspace-name|::-webkit-scrollbar)$/,'nunca some um botão: '+rule[1].trim())
  assert.ok(!shell.includes('@open-map-editor'));assert.doesNotMatch(shell,/<WorkspaceToolbar[^>]*@(build|play|stop)=/,'construir/jogar/parar saíram da parte dos modos');for(const wired of ['@build-retro="handleBuildRetro"','@play-retro="handlePlayRetro"','@stop-retro="stopEverything"'])assert.ok(shell.includes(wired),wired)
  // Ícones de painel ligam e desligam: clicar no que já está aberto fecha a barra lateral (atalhos e comandos só abrem).
  assert.match(shell,/function toggleActivityView\(id\) \{ if \(id !== 'store' && sidebarVisible\.value && activeView\.value === id\) \{ sidebarVisible\.value = false/);assert.match(shell,/function toggleCodeWorkspace\(\) \{ if \(editorMode\.value === 'code'\) toggleActivityView\('explorer'\); else openCodeWorkspace\(\) \}/)
  assert.match(shell,/@code="toggleCodeWorkspace"/);assert.match(shell,/@resources="toggleActivityView\('resources'\)"/);assert.match(shell,/@activity-bar-select="toggleActivityView"/);assert.match(shell,/Digit1: openCodeWorkspace,/)
  assert.match(fs.readFileSync(new URL('../src/components/ActivityBar.vue',import.meta.url),'utf8'),/:aria-pressed="panelVisible && activeView === item\.id"/)
  // Clique no explorador: arquivos de autoria abrem no editor deles (como o .tmx); se o editor não abrir, vira texto com aviso.
  {
   const {authoringEditorFor,relativeProjectPath,looksLikeMapKit}=await import('../src/utils/retro/authoringFiles.js')
   // Kit de mapas: nome livre, reconhecido pelo conteúdo; outros JSON (personagem, cena, config, quebrado) não são kit.
   assert.ok(looksLikeMapKit('{"version":1,"tileSize":8,"name":"k","tilesets":[],"brushes":[],"objects":[]}'))
   for(const text of ['','{quebrado','[]','null','{"version":1,"tileSize":8,"tilesets":[]}','{"format":"retro-studio.cutscene","version":1,"tileSize":8,"tilesets":[],"brushes":[],"objects":[]}','{"version":2,"tileSize":8,"tilesets":[],"brushes":[],"objects":[]}'])assert.equal(looksLikeMapKit(text),false,text)
   assert.match(shell,/if \(looksLikeMapKit\(await window\.retroStudio\.readTextFileOptional\?\.\(filePath\) \|\| ''\)\) editor = \{ kind: 'kit' \}/);assert.match(fs.readFileSync(new URL('../src/components/retro/TilemapEditor.vue',import.meta.url),'utf8'),/openKitFile: async path => editorState\.assetPackPath\.value === path \|\| await editorState\.openRecentKit\(\{ path \}\)/)
   // Imagens abrem no visualizador (só leitura), não como texto.
   {const {isViewableImage}=await import('../src/utils/retro/authoringFiles.js');for(const file of ['res/a.png','res/B.PNG','x.gif','x.jpg','x.jpeg','x.bmp'])assert.ok(isViewableImage(file),file);for(const file of ['','a.png.bak','a.pngx','a.tmx','a.json','a.svg'])assert.ok(!isViewableImage(file),file)
    assert.match(shell,/if \(isViewableImage\(filePath\)\) \{ imageViewerPath\.value = filePath; return \}/);assert.match(shell,/<ImageViewer v-if="imageViewerPath" :file-path="imageViewerPath" :project-path="workspacePath \|\| ''" @close="imageViewerPath = ''" \/>/)
    const viewer=fs.readFileSync(new URL('../src/components/retro/ImageViewer.vue',import.meta.url),'utf8');assert.match(viewer,/readImageFile\?\.\(props\.filePath\)/);assert.match(viewer,/image-rendering:pixelated/);assert.doesNotMatch(viewer,/writeFile|saveFile|writeTextFile/,'o visualizador não grava nada')}
   assert.equal(relativeProjectPath('/p/jogo/','/p/jogo/camera/camera.json'),'camera/camera.json');assert.equal(relativeProjectPath('C:\\p\\jogo','C:\\p\\jogo\\hud\\hud.json'),'hud/hud.json');assert.equal(relativeProjectPath('/p/jogo','/p/jogo2/camera/camera.json'),'')
   assert.deepEqual(authoringEditorFor('charsets/hero.charset.json'),{kind:'characters'});assert.deepEqual(authoringEditorFor('cutscenes/intro.cutscene.json'),{kind:'scene'});assert.deepEqual(authoringEditorFor('cutscenes/cutscene-config.json'),{kind:'scenes'})
   const dialogs={'world/world.json':'world','camera/camera.json':'camera','audio/audio.json':'audio','progress/progress.json':'progress','debug/debug.json':'debug','palettes/palettes.json':'palettes','hud/hud.json':'hud','controls/input-map.json':'inputs','physics/movement.json':'movement','retro-studio.toolchain.json':'toolchain'}
   for(const [file,id] of Object.entries(dialogs)){assert.deepEqual(authoringEditorFor(file),{kind:'dialog',id});assert.match(shell,new RegExp('const FILE_EDITORS = \\{[^}]*\\b'+id+': \\w+'),id)}
   // Só o arquivo-fonte, no lugar certo: cópias, backups, esquemas e arquivos gerados continuam texto.
   for(const file of ['','src/main.c','camera/camera.json.bak','backup/camera/camera.json','cutscenes/cutscene.schema.json','charsets/a/b.charset.json','.retrostudio/hud-export.json','retro-studio.json','maps/map-kit.json'])assert.equal(authoringEditorFor(file),null,file)
  }
  assert.match(shell,/@sidebar-open-file="openFromExplorer"/);assert.match(shell,/if \(editor\.kind === 'dialog'\) \{ fileEditor\.value = editor\.id; return \}/)
  assert.match(shell,/<component :is="FILE_EDITORS\[fileEditor\]" v-if="fileEditor && workspacePath" :key="fileEditor" :project-path="workspacePath" @close="fileEditor = ''" \/>/);assert.match(shell,/watch\(workspacePath, \(newPath\) => \{\s*fileEditor\.value = ''/,'trocar de projeto fecha o editor aberto pelo explorador')
  assert.match(shell,/window\.retroStudioToast\?\.warning\?\.\(t\('workspaceLayout\.openedAsText'\)\)\s*return openFile\(filePath\)/)
  assert.match(fs.readFileSync(new URL('../src/components/retro/CharsetMaker.vue',import.meta.url),'utf8'),/defineExpose\(\{[^}]*openProjectFile \}\)/);assert.match(fs.readFileSync(new URL('../src/components/retro/TilemapEditor.vue',import.meta.url),'utf8'),/openSceneFile: path => editorState\.cutscenes\.openScene\(path\)/)
  assert.match(fs.readFileSync(new URL('../src/components/ContextMenu.vue',import.meta.url),'utf8'),/'Abrir como texto' : 'Abrir'/)
  // Arrastar imagens do sistema para a janela importa pelo caminho seguro (mesmo IPC do painel Recursos); a árvore e as áreas com soltar próprio ficam de fora.
  {
   const drop=fs.readFileSync(new URL('../src/components/retro/ImageDropImport.vue',import.meta.url),'utf8')
   assert.match(shell,/<ImageDropImport :project-path="workspacePath \|\| ''" :enabled="!!isRetroProject && !authoringChanging" @imported="onCharacterExported" \/>/)
   assert.match(drop,/const OWN_TARGETS = '\.treeArea, \.drop-zone, dialog, \[data-own-file-drop\]'/);assert.match(drop,/includes\('Files'\)/,'só arquivos do sistema, não arrastos internos')
   assert.match(drop,/importAssetFromPath\(\{ projectPath, assetPath, asset: \{ type: 'sprite' \} \}\)/);assert.match(drop,/const images = paths\.filter\(isViewableImage\)/);assert.doesNotMatch(drop,/copyFileFromExternal|writeFile/,'nada de cópia direta: só a importação que não sobrescreve')
   assert.match(fs.readFileSync(new URL('../src/components/AppSidebar.vue',import.meta.url),'utf8'),/class="treeArea"/)
   assert.match(fs.readFileSync(new URL('../src/composables/useAssets.js',import.meta.url),'utf8'),/const saveAssets = async[\s\S]{0,400}saveProjectConfig\(path, JSON\.parse\(JSON\.stringify\(\{ \.\.\.config, assets: toSave \}\)\)\)/,'inventário salvo como dados simples')
  }
  // Modo Jogo: os sistemas do jogo na área principal (um lugar só; o painel Runtime de Recursos saiu).
  {
   const game=fs.readFileSync(new URL('../src/components/retro/GameWorkspace.vue',import.meta.url),'utf8'),assetsPanel=fs.readFileSync(new URL('../src/components/retro/AssetsManager.vue',import.meta.url),'utf8')
   assert.match(shell,/Digit5: openRunWorkspace, Digit6: openGameWorkspace, Digit7: openMusicWorkspace \}/);assert.match(shell,/@game="openGameWorkspace"/);assert.match(shell,/<GameWorkspace :key="workspacePath" ref="gameWorkspaceRef" :active="editorMode === 'game'"/)
   assert.match(shell,/runActivated\.value = false; gameActivated\.value = false;/,'trocar de projeto desmonta o modo Jogo')
   for(const id of ['world','camera','inputs','movement','hud','palettes','audio','cutscenes','progress','debug','toolchain']){assert.match(game,new RegExp("\\{ id: '"+id+"',"),'cartão '+id);assert.match(game,new RegExp('\\b'+id+': \\w+(Editor|Lab|Panel)'),'editor '+id)}
   for(const row of ['world','camera','hud','palettes','audio','cutscene-adapter','progress','debug'])assert.ok(game.includes("row: '"+row+"'"),'estado da exportação: '+row)
   assert.match(game,/installRuntime\?\.\(\{ projectPath \}\)/);assert.match(game,/exportOverview\?\.\(\{ projectPath \}\)/);assert.match(game,/function close\(\) \{ opened\.value = ''; void load\(\) \}/,'fechar um editor confere o estado de novo')
   // Dois modelos dos mesmos sistemas (cartões e lista), com a escolha guardada; pendências em painel próprio.
   assert.match(game,/<ul :class="view === 'cards' \? 'grid' : 'rows'">/);assert.match(game,/localStorage\.getItem\(VIEW_KEY\) === 'list' \? 'list' : 'cards'/);assert.match(game,/try \{ localStorage\.setItem\(VIEW_KEY, value\) \} catch/)
   for(const label of ['Cartões','Lista'])assert.match(game,new RegExp(':aria-pressed="view === \'\\w+\'" title="'+label+'" aria-label="'+label+'"'))
   assert.match(game,/<button type="button" @click="opened = row\.system">Abrir<\/button>/)
   assert.ok(!fs.existsSync(new URL('../src/components/retro/RuntimeManager.vue',import.meta.url)));assert.ok(!assetsPanel.includes('RuntimeManager'));assert.match(assetsPanel,/new CustomEvent\('retroStudio:open-game'/)
   assert.match(fs.readFileSync(new URL('../src/composables/useWorkspaceLayout.js',import.meta.url),'utf8'),/\['code','maps','characters','scenes','run','game'\]/)
  }
  // Ícones: o mesmo desenho não quer dizer duas coisas.
  assert.ok(!icons(toolbar).includes('icon-arrows-rotate'),'setas circulares são só do botão de atualizações');assert.equal(icons(titlebar).filter(name=>name==='icon-arrows-rotate').length,1)
  assert.ok(!icons(titlebar).includes('icon-grid-2'),'Mapas só na parte dos modos');for(const icon of ['icon-hammer','icon-play','icon-stop'])assert.ok(!icons(toolbar).includes(icon),icon+' só ao lado do emulador')
 }
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
