import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {ref} from 'vue'
import {validateCharsetSourceReferences} from '../shared/retro/charsetSources.js'
import {normalizeCharacterController,validateCharacterControllers,remapCharacterEvents,setTransitionCondition} from '../src/utils/retro/characterController.js'
import {buildSgdkAnimationHeader} from '../src/utils/retro/charsetMaker.js'
const base={id:'idle-id',name:'idle',frameCount:2,loop:true,fps:8,frames:[{width:32,height:48,anchorX:16,anchorY:48},{width:32,height:48,anchorX:16,anchorY:48}]}
const target={...structuredClone(base),id:'sword-id',name:'sword',loop:false}
const controller=normalizeCharacterController(null)
controller.events=[{frame:1,type:2,argument:5}]
controller.transitions=[{target:target.id,requireAll:2,requireNone:1,finished:false,minimumTicks:2,priority:8,predicate:65535}]
const animations=[{...base,controller},target]
validateCharacterControllers(animations)
const restored=JSON.parse(JSON.stringify(animations));validateCharacterControllers(restored)
restored[1].name='blade';restored.reverse()
const header=buildSgdkAnimationHeader('ninja',restored)
assert.match(header,/\{1,0,2UL,1UL,2,65535,8,0\}/,'ID reference resolves correctly after rename and reorder')
assert.match(header,/RetroCharacterEvent ninja_state_events_1\[\] = \{\{1,2,5\}\}/)
const malformed=structuredClone(animations);malformed[0].controller.events[0].frame=2
assert.throws(()=>validateCharacterControllers(malformed),/Evento fora/)
malformed[0].controller.events=[];malformed[0].controller.transitions[0].target='missing'
assert.throws(()=>validateCharacterControllers(malformed),/destino/)
assert.throws(()=>normalizeCharacterController({...controller,events:[{frame:0,type:1,argument:NaN}]}),/Argumento/)
const transition={requireAll:0,requireNone:0}
setTransitionCondition(transition,2,'all');assert.equal(transition.requireAll,2)
setTransitionCondition(transition,2,'none');assert.equal(transition.requireAll,0);assert.equal(transition.requireNone,2)
setTransitionCondition(transition,2,'any');assert.equal(transition.requireNone,0)
const source=fs.readFileSync(new URL('../src/components/retro/CharsetMaker.vue',import.meta.url),'utf8')
const animation={frames:[{id:'A'},{id:'B'},{id:'C'}],controller:{...normalizeCharacterController(null),events:[{frame:0,type:1,argument:1},{frame:1,type:1,argument:2},{frame:2,type:1,argument:3}]}}
const context={selectedAnimation:ref(animation),selectedFrame:ref(1),draggedFrame:ref(null),SGDK_SPRITE_FRAME_LIMIT:255,
 stopPlayback(){},remapCharacterEvents,ensureEditableFrames(){return context.selectedAnimation.value},
 syncManualAnimation(a){a.frameCount=a.frames.length},selectManualFrame(i){context.selectedFrame.value=i},
 getCharsetProjectFilePath(){return '/game/charsets/ninja.charset.json'},restoringProject:ref(false),projectSaveTimer:null,
 clearTimeout(){},validateCharacterControllers,validateCharsetSourceReferences,animations:ref(animations),migrationBackup:null,saveQueue:Promise.resolve(),
 createCharsetProjectData(){return {version:5,animations:context.animations.value}},upsertLibraryEntry(){},projectSaveStatus:ref(''),console:{warn(){}},writes:[],
 window:{retroStudio:{async writeTextFile(p,text){context.writes.push([p,text])}}}}
vm.createContext(context)
function load(name){const start=source.indexOf('function '+name+'('),next=source.indexOf('\nfunction ',start+1);assert.ok(start>=0);vm.runInContext(source.slice(start,next>=0?next:source.length),context)}
for(const name of ['moveManualFrame','removeManualFrame','duplicateTimelineFrame','dropTimelineFrame'])load(name)
context.moveManualFrame(1)
assert.deepEqual(Array.from(context.selectedAnimation.value.frames,f=>f.id),['A','C','B'])
assert.deepEqual(context.selectedAnimation.value.controller.events.map(e=>e.frame),[0,2,1])
context.duplicateTimelineFrame()
assert.equal(context.selectedAnimation.value.controller.events.length,3,'duplicating a pose does not duplicate attack/sound events')
context.selectedFrame.value=1;context.removeManualFrame()
assert.deepEqual(context.selectedAnimation.value.controller.events.map(e=>e.argument),[1,2])
context.draggedFrame.value=0;context.dropTimelineFrame(2)
assert.equal(context.selectedAnimation.value.controller.events[0].frame,2)
const saveStart=source.indexOf('async function saveCharsetProject()'),saveEnd=source.indexOf('\nasync function flushCharsetProjectSave()',saveStart)
vm.runInContext(source.slice(saveStart,saveEnd),context)
context.animations.value=malformed
assert.equal(await context.saveCharsetProject(),false);assert.equal(context.writes.length,0,'invalid behavior cannot replace a saved project')
context.animations.value=animations
assert.equal(await context.saveCharsetProject(),true)
assert.equal(JSON.parse(context.writes[0][1]).version,5)
assert.deepEqual(JSON.parse(context.writes[0][1]).animations[0].controller,controller)
assert.ok(source.includes("id=\"cm-panel-behavior\""))
console.log('Character authoring: references, roundtrip, C generation, timeline event remapping and invalid-save protection passed.')
