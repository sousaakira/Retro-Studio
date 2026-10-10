// #61: actual Vue script/lifecycle of the toolchain panel with a minimal host (not layout proof).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-toolchain-panel-'))
const old=globalThis.window
let app
try{
 const component=fileURLToPath(new URL('../src/components/retro/ToolchainPanel.vue',import.meta.url))
 const source=fs.readFileSync(component,'utf8'),script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const buttons=['record','load','close()']
 const template='<template><div ref="dialogElement">'+buttons.map(code=>'<button @click="'+code+'">x</button>').join('')+'<output>{{ JSON.stringify({status,canRecord,error,saved,loading,saving,outdated,recordedModules,tools,scopes:scopes.map(g=>g.scope+g.items.length)}) }}</output></div></template>'
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 const compiled=compileScript(descriptor,{id:'toolchain-panel-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>
  'from '+JSON.stringify(specifier==='vue'?import.meta.resolve('vue'):pathToFileURL(path.resolve(path.dirname(component),specifier)).href))
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default
 const reads=[],writes=[];let closed=0
 globalThis.window={retroStudio:{retro:{toolchainStatus(payload){return new Promise((resolve,reject)=>reads.push({payload,resolve,reject}))},recordToolchain(payload){return new Promise((resolve,reject)=>writes.push({payload,resolve,reject}))}}}}
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
 const project=ref('/A'),editor=ref(null);let root
 root=node('root');app=renderer.createApp({render:()=>h(Component,{ref:editor,projectPath:project.value,onClose(){closed++}})});app.mount(root)
 const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,5));await nextTick();await nextTick()}
 const click=code=>root.children[0].children.filter(n=>n.type==='button')[buttons.indexOf(code)].props.onClick()
 const state=()=>JSON.parse(root.children[0].children.find(n=>n.type==='output').text)
 const detected=(extra={})=>({toolkit:'/t',sdk:{name:'sgdk',version:'1.81',root:'/t/m68k-elf'},compiler:'m68k-elf-gcc 13.1.0',rescomp:true,tools:{make:'GNU Make 4.3',java:'',python3:'Python 3.12'},...extra})
 const record={format:'retro-studio.toolchain',version:1,sdk:{name:'sgdk',version:'1.81'},compiler:'m68k-elf-gcc 13.1.0',runtime:{modules:{core:1,camera:1}},generators:{},ide:'0.9.0'}
 const response=(revision,extra={})=>({revision,record:null,recordInvalid:false,detected:detected(),library:{modules:{},generators:{},ide:''},installed:{core:1,camera:1},issues:[],environmentErrors:0,...extra})
 await flush();reads[0].resolve(response('a',{issues:[{severity:'error',scope:'environment',code:'tool-missing',message:'java'},{severity:'info',scope:'project',code:'not-recorded',message:'x'}]}));await flush()
 let s=state();assert.deepEqual(s.scopes,['environment1','project1'],'environment and project problems are listed apart');assert.equal(s.canRecord,true)
 assert.deepEqual(s.tools.map(tool=>tool[0]+'='+(tool[1]?'ok':'missing')),['SDK=ok','Compilador=ok','rescomp=ok','make=ok','Java=missing','Python=ok'])
 // Record, failure, retry, duplicate protection.
 click('record');await flush();assert.deepEqual(writes[0].payload,{projectPath:'/A',revision:'a'});click('record');assert.equal(writes.length,1);assert.equal(editor.value.canClose(),false);click('close()');assert.equal(closed,0)
 writes[0].reject(Error('disk unavailable'));await flush();assert.equal(state().error,'disk unavailable');assert.equal(state().canRecord,true)
 click('record');await flush();writes[1].resolve({success:true,...response('b',{record})});await flush()
 s=state();assert.equal(s.saved,true);assert.equal(s.recordedModules,'core v1, camera v1');assert.equal(s.outdated,false);assert.deepEqual(s.scopes,['environment0','project0'])
 // Installed modules changed since the record; no SDK or unreadable record cannot be recorded.
 click('load');await flush();reads[1].resolve(response('b',{record,installed:{core:1,camera:1,audio:1}}));await flush();assert.equal(state().outdated,true);assert.equal(state().canRecord,true)
 click('load');await flush();reads[2].resolve(response('c',{detected:detected({sdk:null,compiler:'',rescomp:false})}));await flush();assert.equal(state().canRecord,false);assert.equal(state().tools[0][1],'')
 click('load');await flush();reads[3].resolve(response('d',{recordInvalid:true}));await flush();assert.equal(state().canRecord,false)
 // Late replies never land in another project.
 click('load');await flush();reads[4].resolve(response('e'));await flush();click('record');await flush();project.value='/B';await flush()
 writes[2].resolve({success:true,...response('f',{record})});await flush();reads[5].resolve(response('other'));await flush();await flush()
 if(reads.length>6){reads[6].resolve(response('other'));await flush()}
 s=state();assert.equal(s.status.revision,'other');assert.equal(s.status.record,null);assert.equal(s.saved,false);assert.equal(s.saving,false)
 click('close()');assert.equal(closed,1)
 assert.match(source,/aria-labelledby="toolchain-title"/);assert.match(source,/@cancel\.prevent/)
}finally{app?.unmount();if(old===undefined)delete globalThis.window;else globalThis.window=old;fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Toolchain panel: environment/project split, tool list, record, failure, duplicate protection, changed modules, unrecordable states and late replies passed.')
