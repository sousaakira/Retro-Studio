import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createI18n } from 'vue-i18n'
import { AcpSessionManager } from '../electron/ai/acp/manager.js'
import { createRenderer, h, nextTick, ref } from 'vue'
import { normalizeWorkspaceLayout, useWorkspaceLayout } from '../src/composables/useWorkspaceLayout.js'
import { useResizePanels } from '../src/composables/useResizePanels.js'

const previous=globalThis.window, storage=new Map()
const node=type=>({type,children:[]})
const renderer=createRenderer({createElement:node,createText:node,createComment:node,setText(){},setElementText(){},patchProp(){},insert(n,p){p.children.push(n);n.parent=p},remove(n){const i=n.parent?.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1)},parentNode:n=>n.parent,nextSibling:()=>null})
let app
try {
  globalThis.window={localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}}
  assert.deepEqual(normalizeWorkspaceLayout(null),normalizeWorkspaceLayout())
  assert.equal(normalizeWorkspaceLayout({sidebarWidth:900,terminalHeight:NaN,aiTerminalWidth:-10}).sidebarWidth,600)
  const project=ref('/A'),visible=ref(true),terminal=ref(false),ai=ref(false)
  const resize=useResizePanels({sidebarVisible:visible})
  const state={sidebarVisible:visible,sidebarWidth:resize.sidebarWidth,terminalHeight:resize.terminalHeight,aiTerminalWidth:resize.aiTerminalWidth,isTerminalOpen:terminal,isAITerminalOpen:ai}
  let manager,layouts=0
  app=renderer.createApp({setup(){manager=useWorkspaceLayout({projectPath:project,state,layout(){layouts++}});return()=>h('div')}})
  app.mount(node('root'))
  resize.sidebarWidth.value=320;manager.activate()
  visible.value=false;terminal.value=true;resize.sidebarWidth.value=510
  assert.equal(resize.gridTemplateColumns.value,'36px 0px 0px minmax(0,1fr)')
  project.value='/B'
  assert.equal(visible.value,true);assert.equal(resize.sidebarWidth.value,320);assert.equal(terminal.value,false)
  resize.sidebarWidth.value=410;ai.value=true
  project.value='/A'
  assert.equal(visible.value,false);assert.equal(resize.sidebarWidth.value,510);assert.equal(terminal.value,true);assert.equal(ai.value,false)
  manager.reset();assert.equal(visible.value,true);assert.equal(resize.sidebarWidth.value,320)
  project.value='/B';assert.equal(ai.value,true);assert.equal(resize.sidebarWidth.value,410)
  await nextTick();assert.ok(layouts>0)
  app.unmount();app=null
  resize.sidebarWidth.value=280;ai.value=false
  app=renderer.createApp({setup(){manager=useWorkspaceLayout({projectPath:project,state});return()=>h('div')}})
  app.mount(node('root'));manager.activate()
  assert.equal(resize.sidebarWidth.value,410);assert.equal(ai.value,true,'saved layout survives component recreation')
  app.unmount();app=null
  for(const key of storage.keys()) storage.set(key,'{broken')
  app=renderer.createApp({setup(){manager=useWorkspaceLayout({projectPath:project,state});return()=>h('div')}})
  app.mount(node('root'));assert.doesNotThrow(()=>manager.activate())
  globalThis.window.localStorage={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}}
  visible.value=false;project.value='/C';project.value='/B';assert.equal(visible.value,false,'memory fallback preserves layout')
  const content=fs.readFileSync(new URL('../src/components/AppContent.vue',import.meta.url),'utf8')
  assert.match(content,/<AppSidebar\s+v-show="sidebarVisible"/,'hiding must not unmount authoring tools')
  assert.match(content,/<MainEditorArea\s+style="grid-column: 4"/,'collapsed sidebar must not shift the editor into a zero-width column')
  const editor=fs.readFileSync(new URL('../src/components/MainEditorArea.vue',import.meta.url),'utf8')
  // #45: the terminal lives in a tab of the bottom dock; hiding the dock or switching tabs only hides it (v-show).
  assert.match(editor,/<section v-show="isTerminalOpen" class="bottom-dock"/,'hiding the bottom dock must preserve sessions')
  assert.match(editor,/<div v-show="current === 'terminal'"[^>]*>\s*<TerminalPanel v-if="terminalActivated" ref="terminalRef"/,'switching dock tabs must preserve terminal sessions')
  assert.doesNotMatch(editor,/<TerminalPanel[^>]*v-if="[^"]*isTerminalOpen/,'the terminal must never be unmounted by hiding the dock')
  const shell=fs.readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  assert.match(shell,/v-if="aiPanelActivated"\s+v-show="isAITerminalOpen"/,'hiding ACP must preserve the local prompt and running session')
  assert.match(shell,/:active="isAITerminalOpen"/,'hidden ACP must suspend visibility work')
  assert.match(shell,/<AcpAgentPanel :key="workspacePath \|\| ''"/,'workspace changes must replace the ACP session host')
  assert.match(shell,/:initial-draft="acpDrafts.get\(workspacePath\)/,'drafts are scoped to the project')
  const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8')
  const handler=main.match(/ipcMain.handle\('acp:prompt', async \(evt, payload = \{\}\) => \{([\s\S]*?)\n  \}\)/)[1]
  const invoke=new Function('currentWorkspacePath','acpSessionManager','realpathSync','evt','payload','return (async () => {'+handler+'})()')
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-acp-workspace-'))
  try {
    const A=path.join(temporary,'A'),B=path.join(temporary,'B');fs.mkdirSync(A);fs.mkdirSync(B)
    let prompts=0
    const session={workspacePath:A},manager={getSessionInfo:()=>session,prompt(){prompts++;return 'ok'}}
    assert.equal(await invoke(A,manager,fs.realpathSync,{sender:{id:1}},{workspacePath:A,text:'safe'}),'ok')
    await assert.rejects(invoke(B,manager,fs.realpathSync,{sender:{id:1}},{workspacePath:B,text:'wrong session'}),/outro workspace/)
    session.workspacePath=B
    await assert.rejects(invoke(B,manager,fs.realpathSync,{sender:{id:1}},{workspacePath:A,text:'stale panel'}),/outro workspace/)
    await assert.rejects(invoke(null,manager,fs.realpathSync,{sender:{id:1}},{text:'closed project'}),/outro workspace/)
    assert.equal(prompts,1,'mismatched requests must not reach the ACP client')
    const sessions=new AcpSessionManager();let disposed=0
    sessions.clients.set(7,{workspaceRoot:B,async dispose(){disposed++}})
    await sessions.stop(7,{workspacePath:A});assert.equal(disposed,0,'stale panel cleanup must not stop the new workspace session')
    await sessions.stop(7,{workspacePath:B});assert.equal(disposed,1)

    app.unmount();app=null
    const panelSource=fs.readFileSync(new URL('../src/components/AcpAgentPanel.vue',import.meta.url),'utf8')
    const script=panelSource.match(/<script setup>([\s\S]*?)<\/script>/)[1]
    const {descriptor}=parse('<script setup>'+script+'</script><template><div>{{ input }}</div></template>')
    const compiled=compileScript(descriptor,{id:'acp-disposed-test',inlineTemplate:true}).content
      .replace(/from (['"])vue\1/g,'from '+JSON.stringify(import.meta.resolve('vue')))
      .replace(/from (['"])vue-i18n\1/g,'from '+JSON.stringify(import.meta.resolve('vue-i18n')))
      .replace(/from (['"])marked\1/g,'from '+JSON.stringify(import.meta.resolve('marked')))
    const file=path.join(temporary,'acp-panel.mjs');fs.writeFileSync(file,compiled)
    const Panel=(await import(pathToFileURL(file).href)).default
    let resolveSettings,starts=0,bindings=0
    const stops=[]
    globalThis.window={retroStudio:{settings:{load:()=>new Promise(resolve=>{resolveSettings=resolve})},acp:{start(){starts++;return Promise.resolve({})},stop(payload){stops.push(payload);return Promise.resolve({})}}},addEventListener(){bindings++},removeEventListener(){}}
    app=renderer.createApp({render(){return h(Panel,{active:true,projectPath:A,initialDraft:'draft A'})}})
    app.use(createI18n({legacy:false,locale:'en',messages:{en:{}}}));app.mount(node('root'))
    app.unmount();app=null
    resolveSettings({});await nextTick();await nextTick()
    assert.equal(starts,0,'unmounted panel must not start after a late preference response')
    assert.equal(bindings,0,'unmounted panel must not bind events after its cleanup')
    assert.deepEqual(stops,[{workspacePath:A}])
  } finally {fs.rmSync(temporary,{recursive:true,force:true})}
  const toolbar=fs.readFileSync(new URL('../src/components/WorkspaceToolbar.vue',import.meta.url),'utf8')
  assert.match(toolbar,/aria-pressed="sidebarVisible"/);assert.match(fs.readFileSync(new URL('../src/components/TitleBar.vue',import.meta.url),'utf8'),/\$emit\('stop-retro'\)/)
  console.log('Workspace layout: project isolation, startup defaults, bounded settings, reset, persistence, unavailable storage and dock mounting passed.')
} finally {app?.unmount();globalThis.window=previous}
