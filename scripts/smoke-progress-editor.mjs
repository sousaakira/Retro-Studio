// #60: actual Vue script/lifecycle with a minimal host (not layout proof).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {createProgressConfiguration,validateProgressConfiguration,compileProgressHeader} from '../shared/retro/progressConfiguration.js'
import {progressDrafts} from '../src/utils/retro/progressDrafts.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-progress-editor-'))
const old=Object.fromEntries(['window','document'].map(key=>[key,globalThis[key]]))
let app
try{
 const component=fileURLToPath(new URL('../src/components/retro/ProgressEditor.vue',import.meta.url))
 const source=fs.readFileSync(component,'utf8'),script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const buttons=['addFlag','addField','save','newSchema','close()','close(true)','load(true)','config.flagCapacity = 16','config.dataSize = 4','config.flags[1].bit = 0','config.flags[1].bit = 1',
  'config.fields[0].bytes = 2','config.sram.enabled = true','config.sram.slots = 8;config.sram.size = 512','config.sram.slots = 2;config.sram.size = 8192','removeHistory(1)','dropSchemas = true','config.flags.splice(0,1)','config.flags[0].bit = 5','config.sram.offset = 128','moveSlots = true','config.dataSize = 99999999','config.sram.enabled = false']
 const template='<template><div ref="dialogElement">'+buttons.map(code=>'<button @click="'+code+'">x</button>').join('')+
  '<output>{{ JSON.stringify({config,dirty,validation,error,header,memory,slotsMoved,canVersion,headerConflict,revisionConflict,saved,sameSchema,dropped,romHeader,exported,bits:bitCells.filter(c=>c.owners.length).length,bytes:byteCells.filter(c=>c.owners.length).length}) }}</output></div></template>'
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 const compiled=compileScript(descriptor,{id:'progress-editor-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>
  'from '+JSON.stringify(specifier==='vue'?import.meta.resolve('vue'):pathToFileURL(path.resolve(path.dirname(component),specifier)).href))
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default
 const reads=[],writes=[];let closed=0
 globalThis.window={retroStudio:{retro:{
  progressConfiguration(payload){return new Promise((resolve,reject)=>reads.push({payload,resolve,reject}))},
  saveProgressConfiguration(payload){return new Promise((resolve,reject)=>writes.push({payload,resolve,reject}))}
 }}}
 globalThis.document={}
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
 const project=ref('/A'),editor=ref(null);let root
 const mount=()=>{root=node('root');app=renderer.createApp({render:()=>h(Component,{ref:editor,projectPath:project.value,onClose(){closed++}})});app.mount(root)}
 const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,5));await nextTick();await nextTick()}
 const click=code=>root.children[0].children.filter(n=>n.type==='button')[buttons.indexOf(code)].props.onClick()
 const state=()=>JSON.parse(root.children[0].children.find(n=>n.type==='output').text)
 const response=(revision,config=createProgressConfiguration(),extra={})=>({config,revision,exported:false,romHeaderDeclaresSram:true,headerConflict:false,...extra})
 mount();await flush();reads[0].resolve(response('a'));await flush()
 // First export: the layout is free to change, nothing to migrate yet.
 let s=state();assert.equal(s.dirty,false);assert.equal(s.sameSchema,false);assert.equal(s.validation,'');assert.equal(editor.value.canClose(),true)
 assert.deepEqual(s.memory,{record:40,ram:100,stack:448,sram:0,firstByte:0,lastByte:255});assert.match(s.header,/RETRO_PROJECT_PROGRESS_SLOTS 0/)
 click('config.flagCapacity = 16');click('config.dataSize = 4');click('addFlag');click('addFlag');click('addField');await flush();s=state()
 assert.deepEqual(s.config.flags,[{id:'flag_1',name:'Flag 1',bit:0},{id:'flag_2',name:'Flag 2',bit:1}]);assert.deepEqual(s.config.fields,[{id:'field_1',name:'Campo 1',offset:0,bytes:1}])
 assert.equal(s.bits,2);assert.equal(s.bytes,1);assert.equal(s.dirty,true);assert.equal(s.validation,'');assert.match(s.header,/RETRO_PROJECT_PROGRESS_FLAG_FLAG_2 1/)
 click('config.flags[1].bit = 0');await flush();s=state();assert.match(s.validation,/used twice/);assert.equal(s.header,'')
 click('save');await flush();assert.equal(writes.length,0,'invalid layout cannot export')
 click('config.flags[1].bit = 1');click('config.fields[0].bytes = 2');click('addField');await flush();s=state()
 assert.equal(s.validation,'');assert.equal(s.config.fields[1].offset,2,'new fields take the first free byte');assert.equal(s.bytes,3)
 // SRAM settings and memory budget.
 click('config.sram.enabled = true');click('config.sram.slots = 8;config.sram.size = 512');await flush();assert.match(state().validation,/do not fit/)
 click('config.sram.slots = 2;config.sram.size = 8192');await flush();s=state()
 assert.equal(s.validation,'');assert.deepEqual(s.memory,{record:26,ram:100,stack:448,sram:512,firstByte:0,lastByte:511});assert.match(s.header,/0x200001-0x203FFF/)
 // Unsaved work blocks closing; failures keep the draft.
 click('close()');await flush();assert.equal(closed,0);assert.match(state().error,/Salve o progresso/);assert.equal(editor.value.canClose(),false)
 click('save');await flush();assert.equal(writes.length,1);click('save');assert.equal(writes.length,1,'duplicate save blocked')
 validateProgressConfiguration(writes[0].payload.config);assert.equal(writes[0].payload.revision,'a');assert.equal(writes[0].payload.allowDroppedSchemas,false)
 writes[0].reject(Error('disk unavailable'));await flush();s=state();assert.equal(s.dirty,true);assert.equal(s.error,'disk unavailable')
 const first=s.config
 click('save');await flush();writes[1].resolve({success:true,...response('b',first,{exported:true})});await flush();s=state()
 assert.equal(s.dirty,false);assert.equal(s.saved,true);assert.equal(s.sameSchema,true);assert.equal(s.header,compileProgressHeader(first))
 // After export: slot positions cannot move without an explicit choice.
 click('config.sram.offset = 128');await flush();s=state();assert.match(s.validation,/offset changed/);assert.equal(s.slotsMoved,true)
 click('moveSlots = true');await flush();assert.equal(state().validation,'');click('load(true)');await flush();reads[1].resolve(response('b',first,{exported:true}));await flush()
 assert.equal(state().canVersion,true)
 // After export: stored meaning only changes together with a new schema version.
 click('config.flags[1].bit = 0');await flush();assert.match(state().validation,/used twice/)
 click('config.flags.splice(0,1)');await flush();s=state();assert.match(s.validation,/flag moved/,'reusing a bit under the same schema is refused')
 click('load(true)');await flush();reads[2].resolve(response('b',first,{exported:true}));await flush()
 click('addFlag');await flush();s=state();assert.equal(s.validation,'','adding inside the reserved space keeps the schema');assert.equal(s.config.flags[2].bit,2)
 click('newSchema');await flush();s=state()
 assert.equal(s.config.schema,2);assert.deepEqual(s.config.history,[{schema:1,flagCapacity:16,dataSize:4}]);assert.equal(s.sameSchema,false);assert.equal(s.validation,'')
 click('newSchema');await flush();assert.equal(state().config.schema,2,'one new version per export');assert.equal(state().canVersion,false)
 click('config.dataSize = 99999999');await flush();s=state();assert.match(s.validation,/data size/);assert.ok(s.bytes<=64,'the byte map is bounded by the format limit')
 click('config.dataSize = 4');await flush();assert.equal(state().validation,'')
 click('config.flags[0].bit = 5');await flush();assert.equal(state().validation,'','a new version may move flags')
 // Dropping an old version needs an explicit choice and travels with the save.
 click('removeHistory(1)');await flush();s=state();assert.match(s.validation,/missing from the history/);assert.deepEqual(s.dropped,[1])
 click('save');await flush();assert.equal(writes.length,2)
 click('dropSchemas = true');await flush();assert.equal(state().validation,'')
 click('save');await flush();assert.equal(writes.length,3);assert.equal(writes[2].payload.allowDroppedSchemas,true);assert.equal(writes[2].payload.config.schema,2)
 // Late replies stay in their project; drafts survive switches and unmounts.
 const second=state().config
 project.value='/B';await flush();writes[2].resolve({success:true,...response('c',second,{exported:true})});await flush()
 reads[3].resolve(response('other'));await flush();s=state();assert.equal(s.config.schema,1,'late save never overwrites another project');assert.equal(s.dirty,false)
 project.value='/A';await flush();reads[4].resolve(response('c',second,{exported:true}));await flush();s=state()
 assert.equal(s.dirty,false);assert.equal(s.config.schema,2);assert.deepEqual(s.dropped,[])
 assert.equal(s.revisionConflict,false)
 click('addField');await flush();assert.equal(state().dirty,true)
 project.value='/B';await flush();reads[5].resolve(response('other'));await flush()
 project.value='/A';await flush();reads[6].resolve(response('external',first,{exported:true}));await flush();s=state()
 assert.equal(s.revisionConflict,true);assert.equal(s.config.schema,2,'the draft is preserved over an external change')
 click('save');await flush();assert.equal(writes.length,3,'conflicting draft cannot export')
 app.unmount();app=null;mount();await flush();reads[7].resolve(response('external',first,{exported:true}));await flush()
 assert.equal(state().config.fields.length,3,'session drafts survive unmount')
 click('load(true)');await flush();reads[8].resolve(response('external',first,{exported:true,headerConflict:true,romHeaderDeclaresSram:false}));await flush();s=state()
 assert.equal(s.dirty,false);assert.equal(s.revisionConflict,false);assert.equal(s.romHeader,false);assert.equal(s.headerConflict,true)
 click('addFlag');await flush();click('save');await flush();assert.equal(writes.length,3,'customized header is never overwritten')
 click('close(true)');await flush();assert.equal(closed,1);assert.equal(progressDrafts.size,0)
 // A failed load never deletes an existing draft on close.
 progressDrafts.set('/E',{config:first,baseline:'{}',revision:'x',exported:false,dropSchemas:false})
 app.unmount();app=null;project.value='/E';mount();await flush();reads[9].reject(Error('ipc down'));await flush()
 assert.equal(state?.call&&root.children[0].children.find(n=>n.type==='output')?.text.includes('ipc down'),true)
 click('close()');await flush();assert.equal(closed,2);assert.ok(progressDrafts.has('/E'))
 assert.match(source,/aria-labelledby="progress-title"/);assert.match(source,/@cancel\.prevent/)
}finally{
 app?.unmount();progressDrafts.clear()
 for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}
 fs.rmSync(temporary,{recursive:true,force:true})
}
console.log('Progress editor: free first layout, bit/byte maps, SRAM budget, schema discipline, new version, explicit dropped schemas, save failure, isolated drafts, late replies, conflicts and unmount recovery passed.')
