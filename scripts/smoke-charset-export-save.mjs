import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../src/components/retro/CharsetMaker.vue', import.meta.url), 'utf8')
const start = source.indexOf('function scheduleCharsetProjectSave() {')
const end = source.indexOf('async function saveCharsetProject()', start)
assert.ok(start >= 0 && end > start)
let timerCount = 0, saveCount = 0, unmount
const context = {
  alignmentDrag: null,
  exporting: {value:true}, restoringProject:{value:false}, sourceFile:{value:{path:'/ninja.png'}},
  props:{projectPath:'/game'}, projectSaveStatus:{value:''}, projectSaveTimer:undefined,
  clearTimeout(){}, setTimeout(){timerCount++;return timerCount},
  saveCharsetProject(){saveCount++}, stopPlayback(){}, resizeObserver:null,motionQuery:null,
  onMotionPreferenceChange(){},onBeforeUnmount(callback){unmount=callback}
}
vm.createContext(context)
vm.runInContext(source.slice(start,end),context)
context.scheduleCharsetProjectSave()
assert.equal(timerCount,0,'export cannot queue autosaves with old ownership')
context.exporting.value=false
context.alignmentDrag={pointerId:1}
context.scheduleCharsetProjectSave()
assert.equal(timerCount,0,'a drag must not save intermediate offsets')
context.alignmentDrag=null
context.scheduleCharsetProjectSave()
assert.equal(timerCount,1,'normal editing keeps autosave')
const unmountStart=source.indexOf('onBeforeUnmount(() => {')
const unmountEnd=source.indexOf('\n})',unmountStart)+3
vm.runInContext(source.slice(unmountStart,unmountEnd),context)
context.exporting.value=true
unmount()
assert.equal(saveCount,0,'unmount cannot overwrite a pending transaction')
context.exporting.value=false
unmount()
assert.equal(saveCount,1)
const exportSource=source.slice(source.indexOf('async function exportCharacter()'),source.indexOf('</script>'))
assert.ok(exportSource.indexOf('await saveQueue') < exportSource.indexOf('const savedProjectRaw'))
assert.ok(exportSource.includes('retro.exportCharacter({'))
assert.ok(!exportSource.includes('copyAssetToProject('))
assert.ok(!exportSource.includes('writeTextFile(resourcesPath'))
assert.ok(!exportSource.includes('saveCharsetProject()) throw new Error(\'Recursos exportados'))
console.log('Charset export UI: autosave pause, queue drain, unmount protection and transaction usage passed.')
