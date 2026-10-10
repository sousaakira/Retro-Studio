// Issues #44/#45: project ownership and embedded map transitions.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { ref, effectScope } from 'vue'
import { useRetroProject } from '../src/composables/useRetroProject.js'
import { buildCommandPaletteCommands } from '../src/constants/commandPaletteCommands.js'
import { useTilemapEditor } from '../src/composables/useTilemapEditor.js'
const previous = globalThis.window
const scope = effectScope()
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject} }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
try {
  const checks = new Map(), configs = new Map(), lsp = []
  globalThis.window = { retroStudio: { retro: {
    isRetroProject(path) { const task = deferred(); checks.set(path, task); return task.promise },
    getProjectConfig(path) { const task = deferred(); configs.set(path, task); return task.promise },
    lspEnsureFlags(path) { lsp.push(path) }
  } } }
  const root = ref('/A')
  const project = scope.run(() => useRetroProject(root))
  checks.get('/A').resolve(true); await tick()
  root.value = '/B'
  assert.equal(project.projectConfig.value, null)
  assert.equal(project.isRetroProject.value, false)
  checks.get('/B').resolve(true); await tick()
  configs.get('/B').resolve({name:'B'}); await tick()
  configs.get('/A').resolve({name:'A'}); await tick()
  assert.deepEqual(project.projectConfig.value, {name:'B',path:'/B'})
  assert.deepEqual(lsp, ['/B'])
  root.value = '/C'; checks.get('/C').resolve(true); await tick()
  root.value = '/D'; checks.get('/D').resolve(true); await tick()
  configs.get('/D').resolve({name:'D'}); await tick()
  configs.get('/C').reject(new Error('old failure')); await tick()
  assert.equal(project.projectConfig.value.path, '/D')
  assert.equal(project.isRetroProject.value, true)

  let opened = [], configTask = deferred()
  window.retroStudio.retro.getProjectConfig = () => configTask.promise
  const maps = useTilemapEditor({workspacePath:root,projectConfig:ref({path:'/OLD'}),openEmbedded:context=>{opened.push(context);return true}})
  const pending = maps.openTilemapEditorFromBar()
  root.value = '/E'; configTask.resolve({assets:[]})
  assert.equal(await pending, false); assert.equal(opened.length, 0)
  configTask = deferred()
  const fresh = maps.openTilemapEditorForFile('/E/maps/room.tmx')
  configTask.resolve({assets:[{name:'tile'}]})
  assert.equal(await fresh,true)
  assert.equal(opened[0].projectPath,'/E'); assert.equal(opened[0].asset.path,'maps/room.tmx')

  const source = fs.readFileSync(new URL('../src/components/retro/TilemapEditor.vue',import.meta.url),'utf8')
  const functions = source.slice(source.indexOf('async function prepareLeave('),source.indexOf('function focusEditor('))
  const state = Object.fromEntries(['workspaceLeaving','loadingMap','saving','selectingMapPath','packLoading','rasterMapBusy','kitDirty','objectDraftDirty','vocabularyDraftDirty','mapDirty','exportFailure','canSave'].map(key=>[key,ref(false)]))
  state.packAuthor = {exporting:ref(false),authoring:ref(false),brushDraftDirty:ref(false)}
  state.cutscenes = {busy:ref(false),open:ref(false),dirty:ref(false),exportFailure:ref(false)}
  let saves=0, saveResult=true
  state.stopMusicPreview=()=>{}
  state.saveMap=async()=>{saves++;return saveResult}
  const context={savingScenes:ref(false),editorState:state,window:{},t:x=>x,props:{projectPath:'/E'}}
  vm.createContext(context);vm.runInContext(functions,context)
  for (const flag of [state.objectDraftDirty,state.vocabularyDraftDirty,state.packAuthor.brushDraftDirty]) {
    flag.value=true; assert.equal(await context.prepareLeave(),false); assert.equal(state.workspaceLeaving.value,false);flag.value=false
  }
  state.mapDirty.value=true;saveResult=false
  assert.equal(await context.prepareLeave(),false);assert.equal(state.workspaceLeaving.value,false)
  saveResult=true;assert.equal(await context.prepareLeave(),true);assert.equal(state.workspaceLeaving.value,true)
  assert.equal(await context.prepareLeave(),false);context.resumeEditing();assert.equal(state.workspaceLeaving.value,false)
  assert.equal(saves,2)
  context.props.embedded=true
  context.sceneEditorRef=ref({saveVocabulary:async()=>{state.vocabularyDraftDirty.value=false;return true}})
  let sceneSaved=false
  state.cutscenes.saveScene=async()=>{if(sceneSaved)state.cutscenes.dirty.value=false;return sceneSaved}
  state.mapDirty.value=false;state.cutscenes.open.value=true;state.cutscenes.dirty.value=true
  assert.equal(await context.prepareLeave(),false,'failed scene export must retain the workspace')
  assert.equal(state.workspaceLeaving.value,false)
  sceneSaved=true;state.vocabularyDraftDirty.value=true
  assert.equal(await context.prepareLeave(),true,'central scenes are saved before leaving')
  assert.equal(state.vocabularyDraftDirty.value,false);assert.equal(state.cutscenes.dirty.value,false)
  context.resumeEditing()
  const modes=[]
  const commands=buildCommandPaletteCommands({openMapsWorkspace:()=>modes.push('maps'),openScenesWorkspace:()=>modes.push('scenes')})
  commands.find(command=>command.id==='view.maps').action()
  commands.find(command=>command.id==='view.scenes').action()
  assert.deepEqual(modes,['maps','scenes'])
  assert.match(source,/:scene-mode|sceneMode/)
  assert.match(source,/<TilemapCutsceneEditor v-if="embedded"/)
  const appSource = fs.readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  const transitionFunctions = appSource.slice(appSource.indexOf('async function prepareCharactersLeave()'),appSource.indexOf('function saveCurrentEditor()'))
  let charactersResumed=0, mapsResumed=0, mapAccepted=false
  const transition = {characterEditorRef:ref({prepareLeave:async()=>true,resumeEditing:()=>charactersResumed++}),mapEditorRef:ref({prepareLeave:async()=>mapAccepted,resumeEditing:()=>mapsResumed++}),authoringChanging:ref(false),authoringTransition:null,mapOpening:false,window:{retroStudioToast:{warning:message=>dockWarnings.push(message)}},t:x=>x,
   dockAudioRef:ref(null),dockDebugRef:ref(null),isTerminalOpen:ref(false),dockTabs:ref({}),editorMode:ref('maps')}
  const dockWarnings=[]
  vm.createContext(transition);vm.runInContext(transitionFunctions,transition)
  assert.equal(await transition.prepareAuthoringLeave(),false)
  assert.equal(charactersResumed,1);assert.equal(mapsResumed,0,'do not release an unacquired map lock')
  assert.equal(transition.authoringChanging.value,false)
  mapAccepted=true
  assert.equal(await transition.prepareAuthoringLeave(),true)
  assert.equal(transition.authoringChanging.value,true)
  assert.equal(await transition.prepareAuthoringLeave(),false,'concurrent requests cannot acquire a second ticket')
  assert.equal(charactersResumed,1)
  transition.releaseAuthoringTransition()
  assert.equal(charactersResumed,2);assert.equal(mapsResumed,1)
  // #45: an editor hosted in the bottom dock with unexported work stops the switch, shows itself and frees the other editors.
  transition.dockAudioRef.value={canClose:()=>false}
  assert.equal(await transition.prepareAuthoringLeave(),false);assert.match(dockWarnings.at(-1),/Áudio: há alterações não exportadas/)
  assert.deepEqual([transition.isTerminalOpen.value,transition.dockTabs.value.maps,transition.authoringChanging.value],[true,'context',false]);assert.equal(charactersResumed,3);assert.equal(mapsResumed,2)
  transition.dockAudioRef.value={canClose:()=>true};transition.dockDebugRef.value={canClose:()=>false}
  assert.equal(await transition.prepareAuthoringLeave(),false);assert.match(dockWarnings.at(-1),/Diagnóstico/)
  transition.dockDebugRef.value=null;assert.equal(await transition.prepareAuthoringLeave(),true);transition.releaseAuthoringTransition()
  assert.equal(transition.authoringChanging.value,false)
  const sceneSource = fs.readFileSync(new URL('../src/components/retro/tilemap/TilemapCutsceneEditor.vue',import.meta.url),'utf8')
  const vocabularyFunctions = sceneSource.slice(sceneSource.indexOf('function resetConfigText()'),sceneSource.indexOf('async function addFlag()'))
  const saveTask = deferred(), text = ref('{"flags":[]}'), baseline = ref('')
  const vocabularyState = {vocabularyDraftDirty:ref(true)}
  const vocabulary = {configText:text,savedConfigText:baseline,props:{state:vocabularyState},window:{},c:{config:ref({flags:[]}),saveConfig:()=>saveTask.promise}}
  vm.createContext(vocabulary);vm.runInContext(vocabularyFunctions,vocabulary)
  const configSave = vocabulary.saveConfigText()
  text.value = '{"flags":[{"id":"new"}]}'
  saveTask.resolve(true);await configSave
  assert.equal(text.value,'{"flags":[{"id":"new"}]}')
  assert.equal(vocabularyState.vocabularyDraftDirty.value,true)
  console.log('Map workspace ownership, stale responses and draft/save guards OK')
} finally { scope.stop();globalThis.window=previous }
