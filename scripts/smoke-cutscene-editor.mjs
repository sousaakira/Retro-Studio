// Exercises the cutscene editor without Electron: authoring composable with a
// file-backed bridge, preview simulator and an SSR render of the editor component.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createI18n } from 'vue-i18n'
import { ref, nextTick, createSSRApp, h } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { prepareCutsceneExport, publishCutsceneExport } from '../electron/retro/cutsceneExport.js'
import { useCutsceneAuthoring } from '../src/composables/useCutsceneAuthoring.js'
import { createPreview, previewStep } from '../src/utils/retro/cutscenePreview.js'
import { compileCutscene } from '../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs'

const project = await mkdtemp(join(tmpdir(), 'rs-cutscene-editor-'))
const toasts = []
const walk = async dir => {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else if (entry.name.endsWith('.cutscene.json')) out.push(relative(project, full))
  }
  return out
}
globalThis.window = {
  confirm: () => true,
  retroStudioToast: { success: m => toasts.push(['success', m]), error: m => toasts.push(['error', m]), warning: m => toasts.push(['warning', m]), info: m => toasts.push(['info', m]) },
  retroStudio: {
    readTextFile: path => readFile(path, 'utf8'),
    readTextFileOptional: path => readFile(path, 'utf8').catch(() => null),
    writeTextFile: async (path, text) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text) },
    retro: {
      exportCutscenes: async ({projectPath,phase}) => phase==='prepare' ? prepareCutsceneExport(projectPath) : publishCutsceneExport(projectPath),
      listCutscenes: async () => ({ files: (await walk(join(project, 'cutscenes'))).sort() }),
      cutsceneRuntimeStatus: async () => ({ available: true, installed: true, upToDate: true, files: [] }),
      getAssetPreview: async () => ({ success: false })
    }
  }
}

try {
  await mkdir(join(project, 'cutscenes'), { recursive: true })
  await writeFile(join(project, 'cutscenes/cutscene-config.json'), JSON.stringify({
    format: 'retro-studio.cutscene-config', version: 1,
    output: { ids: 'src/cutscene_ids.h', data: 'src/cutscene_data.h' },
    actors: [{ id: 'alice', name: 'Alice', value: 0, mapObjectType: 'player_spawn' }, { id: 'cat', name: 'Gato', value: 1, mapObjectType: 'ability_cat' }],
    animations: [{ id: 'idle', value: 0 }],
    portraits: [{ id: 'cat', value: 1 }],
    flags: [{ id: 'met_cat' }]
  }))
  const objects = ref([
    { id: 1, type: 'player_spawn', x: 4, y: 20, width: 2, height: 5, properties: {} },
    { id: 2, type: 'ability_cat', x: 30, y: 19, width: 4, height: 6, properties: {} }
  ])
  const host = { objects, currentMapPath: ref(join(project, 'maps/room.tmx')), mapHeight: ref(28), tileSize: 8, projectPath: project }
  const c = useCutsceneAuthoring(host)
  await new Promise(resolve => setTimeout(resolve, 20))
  await c.openEditor()
  assert.equal(c.files.value.length, 0)
  assert.equal(await c.createScene('Encontro Gato!', 'Encontro'), true)
  assert.equal(c.scenePath.value, 'cutscenes/encontro_gato.cutscene.json')
  assert.equal(c.scene.value.map, 'maps/room.tmx')

  c.addAfterSelected('move')
  c.updateStep('steps.0', 'actor', 'alice')
  c.startPick('steps.0')
  c.completePick({ x: 140, y: 199 })
  assert.equal(c.scene.value.steps[0].x, 100, 'relative move stores the delta from the actor (spawn centre x = 40)')
  c.addAfterSelected('say')
  c.updateStep('steps.1', 'actor', 'cat')
  c.updateStep('steps.1', 'portrait', 'cat')
  c.updateStep('steps.1', 'text', 'Você me ouviu? Venha comigo até a árvore antiga.')
  c.addAfterSelected('choice')
  c.insertStep('steps.2.options.0.steps', 0, 'set_flag')
  c.updateStep('steps.2.options.0.steps.0', 'flag', 'met_cat')
  assert.equal(c.compiled.value.errors.length, 0, c.compiled.value.errors.join('\n'))
  assert.ok(c.overlay.value.some(mark => mark.kind === 'path' && mark.to.x === 140), 'overlay draws the move path')
  assert.ok(c.dirty.value)
  assert.equal(await c.saveScene(),true)
  assert.equal(c.exportFailure.value,false)
  assert.equal(c.dirty.value, false)
  assert.deepEqual(c.projectErrors.value, [])
  const ids = await readFile(join(project, 'src/cutscene_ids.h'), 'utf8')
  assert.match(ids, /#define CUTSCENE_ENCONTRO_GATO 0/)
  assert.match(await readFile(join(project, 'src/cutscene_data.h'), 'utf8'), /cutsceneLibrary/)

  c.moveStep('steps.1', -1)
  assert.equal(c.scene.value.steps[0].type, 'say')
  c.removeStep('steps.0')
  assert.equal(c.scene.value.steps[0].type, 'move')

  // A scene referencing an unknown flag must keep the headers untouched.
  c.updateStep('steps.1.options.0.steps.0', 'flag', 'nope')
  assert.equal(await c.saveScene(),false)
  assert.equal(c.exportFailure.value,true)
  assert.ok(c.projectErrors.value.some(error => error.includes('nope')))
  assert.match(await readFile(join(project, 'src/cutscene_ids.h'), 'utf8'), /CUTSCENE_ENCONTRO_GATO/)
  c.updateStep('steps.1.options.0.steps.0', 'flag', 'met_cat')

  assert.equal(await c.saveScene(),true)
  const originalWrite = window.retroStudio.writeTextFile
  let releaseWrite
  window.retroStudio.writeTextFile = async (path,text) => {
    if (path.endsWith('.cutscene.json')) await new Promise(resolve => {releaseWrite=resolve})
    return originalWrite(path,text)
  }
  c.scene.value.title='First edit'
  const saving = c.saveScene()
  assert.equal(c.busy.value,true)
  assert.equal(await c.saveScene(),false,'concurrent saves are rejected')
  c.scene.value.title='Newer edit'
  await new Promise(setImmediate)
  releaseWrite();assert.equal(await saving,false)
  assert.equal(c.dirty.value,true,'baseline represents bytes written, not newer edits')
  assert.equal(JSON.parse(await readFile(join(project,c.scenePath.value),'utf8')).title,'First edit')
  window.retroStudio.writeTextFile=async()=>{throw new Error('disk full')}
  assert.equal(await c.saveScene(),false)
  assert.equal(c.dirty.value,true);assert.equal(c.busy.value,false)
  window.retroStudio.writeTextFile=originalWrite
  assert.equal(await c.saveScene(),true)
  assert.equal(c.dirty.value,false);assert.equal(c.exportFailure.value,false)

  c.scene.value.title='Encontro'
  assert.equal(await c.saveScene(),true)

  // Preview simulator: move, two-choice branch and flag.
  const sim = createPreview(c.compiled.value, c.scene.value, c.config.value, c.positionsBefore('__start__'))
  for (let i = 0; i < 120 && sim.state !== 'choice'; i++) previewStep(sim, {})
  assert.equal(sim.actors.alice.x, 140)
  assert.equal(sim.state, 'choice')
  previewStep(sim, { down: true })
  assert.equal(sim.choice.cursor, 1)
  previewStep(sim, { up: true })
  previewStep(sim, { confirm: true })
  for (let i = 0; i < 10 && !sim.done; i++) previewStep(sim, {})
  assert.ok(sim.done)
  assert.ok(sim.flags.has('met_cat'))

  const skip = createPreview(compileCutscene(c.scene.value, c.config.value), c.scene.value, c.config.value, c.positionsBefore('__start__'))
  previewStep(skip, { skip: true })
  assert.ok(skip.done && skip.flags.has('met_cat'), 'skipping takes the default option and still applies flags')
  console.log('PASS: authoring, compile on save and preview simulator')

  // SSR render of the editor component with the modal open.
  const source = await readFile(new URL('../src/components/retro/tilemap/TilemapCutsceneEditor.vue', import.meta.url), 'utf8')
  let code = compileScript(parse(source).descriptor, { id: 'cutscene-smoke', inlineTemplate: true }).content
  code = code.replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`).replaceAll('from "vue"', `from '${import.meta.resolve('vue')}'`)
  code = code.replace("from 'vue-i18n'", `from '${import.meta.resolve('vue-i18n')}'`)
  code = code.replace("'../../../../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs'", `'${new URL('../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs', import.meta.url)}'`)
  code = code.replace("'@/utils/retro/cutscenePreview.js'", `'${new URL('../src/utils/retro/cutscenePreview.js', import.meta.url)}'`)
  const file = join(project, 'editor.mjs')
  await writeFile(file, code)
  const component = (await import(pathToFileURL(file))).default
  const state = { cutscenes: c, objects, selectedObjectId: ref(null), addCutsceneTrigger: () => 1, mapWidth: ref(40), mapHeight: ref(28), mapCanvas: ref(null), zoom: ref(2), userTilesets: ref([]) }
  const appFor = props => createSSRApp({render:()=>h(component,props)}).use(createI18n({legacy:false,locale:'en',messages:{en:{workspaceLayout:{publication_exported:'Published',publication_stale:'Pending',publication_failed:'Failed',publication_unknown:'Unknown'}}}}))
  const ctx = {}
  const launcher = await renderToString(appFor({state}), ctx)
  assert.match(launcher, /Editor de cenas/)
  assert.match(launcher, /Encontro/)
  const modal = Object.values(ctx.teleports || {}).join('')
  assert.match(modal, /Roteiro/)
  assert.match(modal, /Mover/)
  assert.ok(modal.includes('Escolher no mapa') && modal.includes('↳'), 'inspector and branch rows render')
  const centralCtx = {}
  const central = await renderToString(appFor({state,embedded:true,active:true}),centralCtx)
  assert.match(central,/role="region"/)
  assert.match(central,/Roteiro/)
  assert.match(central,/Cenas do projeto/)
  assert.doesNotMatch(Object.values(centralCtx.teleports || {}).join(''),/cs-dialog/,'embedded editor renders in the central host')
  await nextTick()
  const originalRead=window.retroStudio.readTextFile
  let releaseRead
  window.retroStudio.readTextFile=async path=>{
    if(path.endsWith('/deferred.cutscene.json')) return await new Promise(resolve=>{releaseRead=()=>resolve(JSON.stringify({...c.scene.value,id:'deferred'}))})
    return originalRead(path)
  }
  const opening=c.openScene('cutscenes/deferred.cutscene.json')
  assert.equal(c.busy.value,true)
  assert.equal(await c.openScene('cutscenes/encontro_gato.cutscene.json'),false)
  assert.equal(await c.saveScene(),false)
  assert.equal(await c.createScene('blocked','Blocked'),false)
  releaseRead();assert.equal(await opening,true);assert.equal(c.busy.value,false)
  window.retroStudio.readTextFile=originalRead
  assert.equal(await c.openScene('cutscenes/encontro_gato.cutscene.json'),true)
  const originalList=window.retroStudio.retro.listCutscenes
  let releaseList
  window.retroStudio.retro.listCutscenes=()=>new Promise(resolve=>{releaseList=()=>originalList().then(resolve)})
  const recompile=c.recompileAll()
  assert.equal(c.busy.value,true)
  assert.equal(await c.openEditor(),false)
  releaseList();assert.equal(await recompile,true)
  assert.equal(c.busy.value,false)
  window.retroStudio.retro.listCutscenes=originalList
  window.retroStudio.writeTextFile=async(path,text)=>{
    if(path.endsWith('/second.cutscene.json')) await new Promise(resolve=>{releaseWrite=resolve})
    return originalWrite(path,text)
  }
  const creating=c.createScene('second','Second')
  assert.equal(c.busy.value,true)
  assert.equal(await c.openEditor(),false)
  await new Promise(setImmediate)
  releaseWrite();assert.equal(await creating,true);assert.equal(c.busy.value,false)
  window.retroStudio.writeTextFile=originalWrite
  await writeFile(join(project,'src/cutscene_ids.h'),'/* custom header */')
  c.scene.value.title='Authored JSON must survive a publication conflict'
  assert.equal(await c.saveScene(),false)
  assert.equal(c.dirty.value,false,'authored source is saved even when publication is blocked')
  assert.equal(c.exportFailure.value,true)
  assert.equal(JSON.parse(await readFile(join(project,c.scenePath.value),'utf8')).title,c.scene.value.title)
  assert.equal(await readFile(join(project,'src/cutscene_ids.h'),'utf8'),'/* custom header */')
  console.log('PASS: editor component renders launcher and modal')
} finally {
  await rm(project, { recursive: true, force: true })
}
