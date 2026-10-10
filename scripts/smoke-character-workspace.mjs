import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { ref } from 'vue'
import { useWorkspace } from '../src/composables/useWorkspace.js'
import { buildCommandPaletteCommands } from '../src/constants/commandPaletteCommands.js'
import { useKeyboardShortcuts } from '../src/composables/useKeyboardShortcuts.js'

const previous=globalThis.window
try {
  const path=ref('/A'),tabs=ref([{path:'/A/main.c'}]),active=ref('/A/main.c'),error=ref(null)
  let opened=0,refresh=0,allowed=false
  globalThis.window={retroStudio:{workspace:{async openRecent(value){opened++;return value}}},retroStudioToast:{success(){},error(){}}}
  const workspace=useWorkspace({workspacePath:path,tabs,activePath:active,lastError:error,refreshTree:async()=>{refresh++},beforeOpen:async()=>allowed})
  assert.equal(await workspace.openWorkspace('/B'),false)
  assert.equal(opened,0);assert.equal(path.value,'/A');assert.equal(tabs.value.length,1)
  allowed=true;await workspace.openWorkspace('/B')
  assert.equal(opened,1);assert.equal(path.value,'/B');assert.equal(tabs.value.length,0);assert.equal(refresh,1)
  const source=fs.readFileSync(new URL('../src/components/retro/CharsetMaker.vue',import.meta.url),'utf8')
  const prepare=source.slice(source.indexOf('async function prepareLeave()'),source.indexOf('\ndefineExpose('))
  let saves=0,result=true
  const context={ref,busy:{value:false},exporting:{value:true},restoringProject:{value:false},leaving:{value:false},preparedForLeave:false,stopPlayback(){},async flushCharsetProjectSave(){saves++;return result}}
  vm.createContext(context);vm.runInContext(prepare,context)
  assert.equal(await context.prepareLeave(),false);assert.equal(saves,0)
  context.exporting.value=false;result=false
  assert.equal(await context.prepareLeave(),false);assert.equal(context.preparedForLeave,false)
  result=true;assert.equal(await context.prepareLeave(),true);assert.equal(context.preparedForLeave,true)
  assert.equal(context.leaving.value,true,'interaction stays blocked until the transition resolves')
  context.resumeEditing();assert.equal(context.leaving.value,false)
  let finishSave
  context.flushCharsetProjectSave=()=>new Promise(resolve=>{finishSave=resolve})
  const pending=context.prepareLeave()
  assert.equal(context.leaving.value,true)
  assert.equal(await context.prepareLeave(),false,'concurrent transitions cannot unlock a pending save')
  finishSave(true);assert.equal(await pending,true);context.resumeEditing()
  let focused=0
  context.searchInput={focus(){focused++}}
  vm.runInContext('movementSearch.value = searchInput',context)
  context.focusSearch();assert.equal(focused,1)
  context.leaving.value=true;context.focusSearch();assert.equal(focused,1,'transition lock must also prevent focusing inert controls');context.resumeEditing()
  assert.match(source,/<Teleport to="body" :disabled="embedded"/)
  assert.match(source,/:inert="leaving"/,'all character controls are blocked while flushing')
  assert.match(source,/!preparedForLeave && sourceFile/,'prepared workspace switches must not write after backend selection changes')
  assert.match(source,/!props.active \|\| !isPlaying/,'hidden character editors must stop playback work')
  const app=fs.readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  assert.match(app,/beforeOpen: prepareAuthoringLeave/)
  assert.match(app,/v-if="charactersActivated" v-show="editorMode === 'characters'"/)
  assert.match(app,/saveActive: saveCurrentEditor/)
  assert.match(app,/saveAll: saveAllEditors/)
  assert.match(app,/:editor-mode="editorMode"/)
  assert.match(app,/:can-save-editor="editorMode === 'characters'/)
  let authoring=true,finds=0,prevented=0
  const keydown=useKeyboardShortcuts({activeTab:ref(null),hasAuthoringEditor:()=>authoring,triggerFindInMonaco:()=>finds++})
  const findEvent={isTrusted:true,key:'f',ctrlKey:true,preventDefault(){prevented++}}
  keydown(findEvent);assert.equal(finds,1,'authoring search works without an open code tab')
  authoring=false;keydown(findEvent);assert.equal(finds,1,'empty code mode keeps its existing guard');assert.equal(prevented,2)
  const titlebar=fs.readFileSync(new URL('../src/components/TitleBar.vue',import.meta.url),'utf8')
  assert.match(titlebar,/:disabled="!canSaveEditor && !hasDirtyTabs && !hasDirtyActiveTab"/)
  let commandsUsed=[]
  const commands=buildCommandPaletteCommands({saveActive:()=>commandsUsed.push('save'),saveAll:()=>commandsUsed.push('saveAll'),openCodeWorkspace:()=>commandsUsed.push('code'),openCharactersWorkspace:()=>commandsUsed.push('characters')})
  for (const id of ['file.save','file.saveAll','view.code','view.characters']) commands.find(command=>command.id===id).action()
  assert.deepEqual(commandsUsed,['save','saveAll','code','characters'])
  const saveAllSource=app.slice(app.indexOf('async function saveAllEditors()'),app.indexOf('\nfunction onCharacterExported'))
  const saveContext={authoringChanging:{value:false},mapEditorRef:{value:null},characterEditorRef:{value:{save:async()=>false}},saveAll:()=>commandsUsed.push('codeSave')}
  vm.createContext(saveContext);vm.runInContext(saveAllSource,saveContext)
  assert.equal(await saveContext.saveAllEditors(),false)
  assert.ok(!commandsUsed.includes('codeSave'),'failed character save must stop save-all')
  saveContext.characterEditorRef.value.save=async()=>true
  await saveContext.saveAllEditors();assert.equal(commandsUsed.at(-1),'codeSave')
  const toolbar=fs.readFileSync(new URL('../src/components/WorkspaceToolbar.vue',import.meta.url),'utf8')
  assert.match(toolbar,/:aria-pressed="editorMode === 'code'"/)
  assert.match(toolbar,/:aria-pressed="editorMode === 'characters'"/)
  const assets=fs.readFileSync(new URL('../src/components/retro/AssetsManager.vue',import.meta.url),'utf8')
  assert.match(assets,/if \(window.dispatchEvent\(request\)\) showCharsetMaker.value = true/,'standalone resources retain modal fallback')
  const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8')
  const selection=main.match(/ipcMain.handle\('workspace:select', async \(\) => \{([\s\S]*?)\n  \}\)/)[1]
  let activations=0
  const picker=new Function('dialog','log','currentWorkspacePath','aiAgent','addRecentWorkspace','indexWorkspace','return { async choose(){'+selection+'}, current(){return currentWorkspacePath} }')
    ({async showOpenDialog(){return {canceled:false,filePaths:['/B']}}},()=>{},'/A',{setWorkspace(){activations++}},()=>{activations++},()=>{activations++})
  assert.equal(await picker.choose(),'/B');assert.equal(picker.current(),'/A');assert.equal(activations,0,'picker must not activate before flushing')
  let release,after=0
  const serial=useWorkspace({workspacePath:path,tabs,activePath:active,lastError:error,refreshTree:async()=>{},beforeOpen:()=>new Promise(resolve=>{release=resolve}),afterOpen:()=>{after++}})
  const opening=serial.openWorkspace('/C')
  assert.equal(await serial.openWorkspace('/D'),false);assert.equal(after,0)
  release(false);await opening;assert.equal(after,1);assert.equal(path.value,'/B')
  console.log('Character workspace: guarded project switch, failed save/export retention, embedded hosting, hidden playback, save routing and modal fallback passed.')
} finally {globalThis.window=previous}
