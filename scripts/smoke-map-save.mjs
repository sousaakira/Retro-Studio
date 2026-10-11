import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { computed, ref as vueRef, createRenderer, h, nextTick, watch } from 'vue'
import { createI18n } from 'vue-i18n'
import { toTMX } from '../src/utils/retro/tmxFormat.js'

// Exercise the real save function without loading Vue or Electron.
const source = readFileSync(new URL('../src/composables/useTilemapEditorState.js', import.meta.url), 'utf8')
const start = source.indexOf('    function serializeMap(outPath) {')
const end = source.indexOf('    function toggleTileAttribute', start)
assert.ok(start >= 0 && end > start)
const writes = [], events = [], operations = [], toasts = []
let registrations = 0
const ref = value => ({ value })
const context = {
    userTilesets: ref([{name:'terrain',path:'/game/maps/terrain.png',firstgid:1,columns:16,tilecount:256}]),
    backgroundImage: ref(null), parallaxLayers: ref([]), recentMaps: ref([]), rasterImportName: ref(''), rasterBindings: ref({}),
    assetPackPath: ref(''), assetPackMaps: ref([]),
    exportFailure: ref(null), musicTrack: ref('forest-clearing'), saving: ref(false), mapWidth: ref(40), mapHeight: ref(28),
    loadingMap: ref(false), currentMapPath: ref('/game/maps/first-room.tmx'), savedMapSnapshot: ref('previous map'),
    props: { projectPath:'/game' },
    ensureTiles() {}, relativeImagePath: () => '../maps/terrain.png',
    rememberRecentTilemap: () => [],
    toTMX(data) { assert.equal(data.tilesets[0].path,'../maps/terrain.png'); assert.equal(data.background,null); assert.equal(data.musicTrack,'forest-clearing'); assert.equal(data.parallaxLayers.length,0); return '<map />' },
    t(key) { return key },
    emit: name => events.push(name),
    window: {
      retroStudio: {
        ensureDirectory: async () => {},
        writeTextFile: async (path, text) => { writes.push({path,text}); operations.push('save') },
        retro: {
          updateTilemapResourceEntry: async () => { registrations++ },
          exportMapAfterSave: async (mapPath) => {
            assert.equal(mapPath, '/game/maps/first-room.tmx')
            operations.push('export')
            return { configured: true, exported: true }
          }
        }
      },
      retroStudioToast: {success(message) { toasts.push(message) }, error(error) { throw new Error(error) }}
    }
}
for (const key of ['tiles','tiles2','collisionMap','priorityMap','flipHMap','flipVMap','paletteMap','flipHMap2','flipVMap2','paletteMap2','objects']) context[key]=ref([])
vm.createContext(context)
vm.runInContext(source.slice(start,end),context)
assert.equal(await context.doSave('/game/maps/first-room.tmx'),true)
assert.equal(context.savedMapSnapshot.value,'<map />')
assert.deepEqual(writes,[{path:'/game/maps/first-room.tmx',text:'<map />'}])
assert.deepEqual(operations, ['save', 'export'], 'Exporter runs only after TMX is written')
assert.equal(registrations,0,'Saving a TMX must not silently change resources.res')
assert.deepEqual(events,['saved'])
assert.deepEqual(toasts, ['tilemap.savedAndExported'])
assert.equal(context.saving.value,false)
context.window.retroStudioToast.error = message => toasts.push(message)
context.window.retroStudio.retro.exportMapAfterSave = async () => ({
  configured: true, exported: false, error: '10 objetos animados; limite de 8',
  stderr: 'Traceback: limite de 8', stdout: 'Exportando Clareira'
})
assert.equal(await context.doSave('/game/maps/first-room.tmx'),false,'export failure must prevent callers from assuming the game was updated')
assert.equal(context.exportFailure.value.message, '10 objetos animados; limite de 8')
assert.match(context.exportFailure.value.details, /Traceback: limite de 8/)
assert.match(context.exportFailure.value.details, /Exportando Clareira/)
assert.equal(context.exportFailure.value.mapPath, '/game/maps/first-room.tmx')
assert.equal(context.saving.value, false)
context.window.retroStudio.retro.exportMapAfterSave = async () => ({ configured: true, exported: true })
assert.equal(await context.doSave('/game/maps/first-room.tmx'),true)
assert.equal(context.exportFailure.value, null, 'Successful retry clears the previous export error')
context.loadingMap.value=true
const writeCount=writes.length
assert.equal(await context.doSave('/game/maps/other.tmx'),false)
assert.equal(writes.length,writeCount)
context.loadingMap.value=false
context.window.retroStudio.writeTextFile=async()=>{throw new Error('Disk full')}
assert.equal(await context.doSave('/game/maps/other.tmx'),false)
assert.equal(context.currentMapPath.value,'/game/maps/first-room.tmx','failed write must keep the current filename')
assert.equal(context.savedMapSnapshot.value,'<map />','failed write must preserve saved baseline')
assert.equal(context.saving.value,false)
// Editor embutido (modo Mapas): a exportação após salvar usa o workspace aberto; mapa fora da lista do jogo volta com a lista para o aviso.
{
 const fsx=await import('node:fs')
 const main=fsx.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8')
 assert.match(main,/ipcMain\.handle\('tilemap:export-after-save'[\s\S]{0,400}path\.resolve\(data\?\.projectPath \|\| assertWorkspaceSelected\(\)\)/)
 assert.doesNotMatch(main,/Workspace do editor de mapas não está disponível/)
 assert.match(fsx.readFileSync(new URL('../electron/retro/mapExporter.js',import.meta.url),'utf8'),/skipped: true, sourceMaps: sourceMaps\.filter/)
 assert.match(fsx.readFileSync(new URL('../src/composables/useTilemapEditorState.js',import.meta.url),'utf8'),/exportResult\?\.skipped && exportResult\.sourceMaps\?\.length\) window\.retroStudioToast\?\.info\?\.\(t\('tilemap\.savedNotInGame'/)
}
console.log('smoke-map-save: PASS (save, export failure details and recovery)')

// Dirty state uses the exact serializer used for disk writes, not undo history.
context.toTMX=toTMX
context.computed=computed
for (const key of Object.keys(context)) if (context[key] && typeof context[key]==='object' && Object.hasOwn(context[key],'value')) context[key]=vueRef(context[key].value)
context.mapWidth.value=2;context.mapHeight.value=2
context.tiles.value=Array(4).fill(1);context.tiles2.value=Array(4).fill(1)
context.savedMapSnapshot.value=context.serializeMap(context.currentMapPath.value)
const dirtyDeclaration=source.match(/const mapDirty = computed\([^\n]+/)[0]
vm.runInContext(dirtyDeclaration.replace('const mapDirty','var observedDirty'),context)
assert.equal(context.observedDirty.value,false)
for (const key of ['tiles','tiles2','collisionMap','priorityMap','flipHMap','flipVMap','paletteMap','flipHMap2','flipVMap2','paletteMap2']) {
  const previous=context[key].value
  const cells=Array(4).fill(key==='tiles'||key==='tiles2'?1:0);cells[0]=key==='tiles'||key==='tiles2'?2:1;context[key].value=cells
  assert.equal(context.observedDirty.value,true,key+' changes must make the reactive editor dirty')
  assert.ok(context.serializeMap(context.currentMapPath.value)!==context.savedMapSnapshot.value,key+' edit must differ from saved TMX')
  context[key].value=previous
  assert.equal(context.observedDirty.value,false,key+' undo must restore the saved state')
}
context.objects.value=[{id:1,name:'Spawn',type:'player_spawn',x:2,y:3,width:2,height:5,properties:{}}]
assert.notEqual(context.serializeMap(context.currentMapPath.value),context.savedMapSnapshot.value)
context.savedMapSnapshot.value=context.serializeMap(context.currentMapPath.value)
context.objects.value[0].animationStart=1000
assert.equal(context.serializeMap(context.currentMapPath.value),context.savedMapSnapshot.value,'preview clock must not create authored changes')
assert.equal(context.observedDirty.value,false)

// Exercise real open/load guards with an asynchronous dialog and loader.
const offeredDrafts=[]
Object.assign(context,{selectingMapPath:ref(false),packLoading:ref(false),rasterMapBusy:ref(false),normalizeAssetPath:value=>value,forgetRecentTilemap:()=>[],loadMusicCatalog:async()=>{},offerMapDraft:async fullPath=>{offeredDrafts.push(fullPath)}})
const wrapper=source.slice(source.indexOf('    async function loadExisting()'),source.indexOf('    async function loadExistingContent('))
vm.runInContext(wrapper,context)
const openFunctions=source.slice(source.indexOf('    async function openMap()'),source.indexOf('    async function createMap()'))
vm.runInContext(openFunctions,context)
let resolveLoad,resolveDialog,loadedPath
context.loadExistingContent=path=>{loadedPath=path;return new Promise(resolve=>{resolveLoad=resolve})}
context.window.retroStudio.retro.selectFile=()=>new Promise(resolve=>{resolveDialog=resolve})
context.saving.value=true
assert.equal(await context.openRecentMap({path:'/game/maps/other.tmx'}),false)
assert.equal(context.currentMapPath.value,'/game/maps/first-room.tmx')
context.saving.value=false
const pendingOpen=context.openMap()
context.saving.value=true
resolveDialog({success:true,path:'/game/maps/other.tmx'})
assert.equal(await pendingOpen,false,'dialog result cannot switch paths during an intervening save')
assert.equal(context.currentMapPath.value,'/game/maps/first-room.tmx')
context.saving.value=false
const pendingLoad=context.openRecentMap({path:'/game/maps/other.tmx'})
assert.equal(context.loadingMap.value,true)
assert.equal(await context.openRecentMap({path:'/game/maps/third.tmx'}),false)
assert.equal(context.currentMapPath.value,'/game/maps/other.tmx')
assert.equal(loadedPath,'/game/maps/other.tmx')
resolveLoad(true);assert.equal(await pendingLoad,true);assert.equal(context.loadingMap.value,false)
assert.equal(context.savedMapSnapshot.value,context.serializeMap('/game/maps/other.tmx'))
vm.runInContext(source.slice(source.indexOf('    async function saveMapAs()'),source.indexOf('    function serializeMap(')),context)
context.canSave=ref(true)
context.window.retroStudio.retro.selectSaveFile=async()=>({success:false})
assert.equal(await context.saveMapAs(),false)
assert.equal(context.selectingMapPath.value,false)
context.window.retroStudio.retro.selectSaveFile=()=>new Promise(resolve=>{resolveDialog=resolve})
const choosing=context.saveMapAs()
assert.equal(context.selectingMapPath.value,true)
assert.equal(await context.saveMap(),false,'another save cannot start while choosing a filename')
resolveDialog({success:true,path:'/game/maps/unwritten.tmx'})
assert.equal(await choosing,false,'failed Save As must remain a failure')
assert.equal(context.currentMapPath.value,'/game/maps/other.tmx')
assert.equal(context.selectingMapPath.value,false)
const editor=readFileSync(new URL('../src/components/retro/TilemapEditor.vue',import.meta.url),'utf8')
assert.match(editor,/:inert="savingScenes \|\| editorState.workspaceLeaving.value \|\| editorState.loadingMap.value \|\| editorState.saving.value \|\| editorState.selectingMapPath.value"/,'loading must freeze editing before establishing a saved baseline')
console.log('smoke-map-save: PASS (dirty fields, preview exclusion, concurrent opens and late dialog guards)')

// Pending document-level mouseup must not commit a drag during a load/save.
const canvasSource=readFileSync(new URL('../src/components/retro/tilemap/TilemapCanvas.vue',import.meta.url),'utf8')
const gestureState={}
for (const key of ['loadingMap','saving','selectingMapPath','workspaceLeaving','isMovingSelection','isDrawing','isPanning']) gestureState[key]=vueRef(false)
for (const key of ['selection','moveStartInSelection','movePreview','dragStart','selectionDragEnd']) gestureState[key]=vueRef(null)
let gestureCommits=0,gestureStops=[]
Object.assign(gestureState,{pushState(){},moveSelectionTo(){gestureCommits++},moveSelectedObjectTo(){gestureCommits++}})
const gestureContext={props:{state:gestureState},movingObject:vueRef(null),selectionMouseUp:()=>{},onObjectDragMove(){},drawMap(){},document:{removeEventListener(){}},
  st:key=>gestureState[key]?.value,setSt:(key,value)=>{gestureState[key].value=value},watch:(...args)=>gestureStops.push(watch(...args))}
vm.createContext(gestureContext)
try {
  vm.runInContext(canvasSource.slice(canvasSource.indexOf('function cancelPendingGestures()'),canvasSource.indexOf('function zoomVal()')),gestureContext)
  vm.runInContext(canvasSource.slice(canvasSource.indexOf('function finishMoveSelection()'),canvasSource.indexOf('function onMapWrapMouseDown(')),gestureContext)
  vm.runInContext(canvasSource.slice(canvasSource.indexOf('function onObjectDragEnd()'),canvasSource.indexOf('</script>')),gestureContext)
  gestureState.selection.value={x1:0,y1:0};gestureState.movePreview.value={x1:1,y1:0};gestureState.isMovingSelection.value=true
  gestureContext.movingObject.value={x:4,y:5}
  gestureState.loadingMap.value=true
  assert.equal(gestureState.isMovingSelection.value,false);assert.equal(gestureState.selection.value,null)
  assert.equal(gestureContext.movingObject.value,null);assert.equal(gestureContext.selectionMouseUp,null)
  gestureContext.finishMoveSelection();assert.equal(gestureCommits,0)
  gestureContext.movingObject.value={x:4,y:5};gestureContext.onObjectDragEnd();assert.equal(gestureCommits,0)
  gestureState.loadingMap.value=false
  gestureState.selection.value={x1:0,y1:0};gestureState.movePreview.value={x1:1,y1:0};gestureState.isMovingSelection.value=true
  gestureContext.finishMoveSelection();assert.equal(gestureCommits,1,'normal selection dragging remains available')
} finally {gestureStops.forEach(stop=>stop())}
console.log('smoke-map-save: PASS (synchronous gesture cancellation and late mouseup guards)')

// Run the whole state composable in Vue, including real load and initial grid.
const temporary=mkdtempSync(path.join(os.tmpdir(),'retro-map-state-'))
const previousWindow=globalThis.window, previousStorage=globalThis.localStorage
let host
try {
  const origin=new URL('../src/composables/useTilemapEditorState.js',import.meta.url)
  const moduleSource=source.replace(/from (['"])([^'"]+)\1/g,(_,quote,specifier)=>{
    const resolved=specifier.startsWith('@/') ? new URL('../src/'+specifier.slice(2),import.meta.url).href
      : specifier.startsWith('.') ? new URL(specifier,origin).href : import.meta.resolve(specifier)
    return 'from '+JSON.stringify(resolved)
  })
  const modulePath=path.join(temporary,'map-state.mjs');writeFileSync(modulePath,moduleSource)
  const {useTilemapEditorState}=await import(pathToFileURL(modulePath).href)
  const fixture=JSON.stringify({width:2,height:2,tiles:[1,0,0,0],collision:[0,0,0,0],objects:[]})
  const actualWrites=[];let failWrite=false
  const storage={getItem(){return null},setItem(){}}
  globalThis.localStorage=storage
  globalThis.window={localStorage:storage,retroStudio:{
    readTextFileOptional:async()=>null,
    readTextFile:async name=>name==='/game/maps/room.json'?fixture:'[]',
    ensureDirectory:async()=>{},
    writeTextFile:async(name,text)=>{if(failWrite)throw new Error('Disk full');actualWrites.push({name,text})},
    retro:{findTilemapPackForMap:async()=>null,exportMapAfterSave:async()=>({configured:false}),selectSaveFile:async()=>({success:true,path:'/game/maps/room.tmx'})}
  },retroStudioToast:{success(){},error(){}}}
  const makeNode=type=>({type,children:[]})
  const renderer=createRenderer({createElement:makeNode,createText:makeNode,createComment:makeNode,setText(){},setElementText(){},patchProp(){},insert(n,p){p.children.push(n);n.parent=p},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
  let state
  host=renderer.createApp({setup(){state=useTilemapEditorState({projectPath:'/game',asset:null,assets:[]},()=>{});return()=>h('div')}})
  host.use(createI18n({legacy:false,locale:'en',messages:{en:{}},missingWarn:false,fallbackWarn:false}));host.mount(makeNode('root'))
  await nextTick()
  assert.equal(state.mapDirty.value,false,'mounting the initial grid must not create unsaved edits')
  assert.equal(state.canSave.value,false)
  assert.equal(await state.openRecentMap({path:'/game/maps/room.json'}),true)
  assert.equal(state.loadingMap.value,false);assert.equal(state.mapDirty.value,false)
  assert.equal(state.canSave.value,true,'a loaded map remains savable with no images')
  state.collisionMap.value[0]=1;assert.equal(state.mapDirty.value,true)
  failWrite=true;assert.equal(await state.saveMap(),false);assert.equal(state.mapDirty.value,true)
  assert.equal(state.currentMapPath.value,'/game/maps/room.json')
  failWrite=false;assert.equal(await state.saveMap(),true);assert.equal(state.mapDirty.value,false)
  assert.equal(actualWrites.length,1);assert.equal(actualWrites[0].name,'/game/maps/room.tmx','JSON imports must not be overwritten with XML')
  assert.match(actualWrites[0].text,/name="collision"/)
  console.log('smoke-map-save: PASS (full Vue state, clean initial grid, real loader, collision edits and save failure retention)')
} finally {
  host?.unmount();globalThis.window=previousWindow;globalThis.localStorage=previousStorage
  rmSync(temporary,{recursive:true,force:true})
}
