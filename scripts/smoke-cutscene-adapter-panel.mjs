// #63: actual Vue script/lifecycle of the derived-export panel with a minimal host (not layout proof).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-cutscene-panel-'))
const old=globalThis.window
let app
try{
 const component=fileURLToPath(new URL('../src/components/retro/CutsceneAdapterPanel.vue',import.meta.url))
 const source=fs.readFileSync(component,'utf8'),script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const buttons=['save','load','close()']
 const template='<template><div ref="dialogElement">'+buttons.map(code=>'<button @click="'+code+'">x</button>').join('')+'<output>{{ JSON.stringify({status,state,canExport,error,saved,loading,saving,groups:groups.map(g=>g.severity+g.items.length)}) }}</output></div></template>'
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 const compiled=compileScript(descriptor,{id:'cutscene-panel-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>
  'from '+JSON.stringify(specifier==='vue'?import.meta.resolve('vue'):pathToFileURL(path.resolve(path.dirname(component),specifier)).href))
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default
 const reads=[],writes=[];let closed=0
 globalThis.window={retroStudio:{retro:{cutsceneAdapter(payload){return new Promise((resolve,reject)=>reads.push({payload,resolve,reject}))},saveCutsceneAdapter(payload){return new Promise((resolve,reject)=>writes.push({payload,resolve,reject}))}}}}
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
 const project=ref('/A'),editor=ref(null);let root
 root=node('root');app=renderer.createApp({render:()=>h(Component,{ref:editor,projectPath:project.value,onClose(){closed++}})});app.mount(root)
 const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,5));await nextTick();await nextTick()}
 const click=code=>root.children[0].children.filter(n=>n.type==='button')[buttons.indexOf(code)].props.onClick()
 const state=()=>JSON.parse(root.children[0].children.find(n=>n.type==='output').text)
 const report=(issues=[])=>({issues,errors:issues.filter(i=>i.severity==='error').length,links:[{id:'met',bit:0}],played:null,rooms:[{id:'lab',numericId:1,triggers:2}],scenes:2,flags:3})
 const response=(revision,extra={})=>({revision,exported:false,current:false,report:report(),error:'',headerConflict:false,...extra})
 await flush();reads[0].resolve(response('a',{report:report([{severity:'warning',code:'flag-not-saved',message:'x'}])}));await flush()
 let s=state();assert.match(s.state,/Ainda não exportado/);assert.equal(s.canExport,true);assert.deepEqual(s.groups,['warning1'])
 // Export, failure, retry, duplicate protection.
 click('save');await flush();assert.equal(writes.length,1);assert.deepEqual(writes[0].payload,{projectPath:'/A',revision:'a'});click('save');assert.equal(writes.length,1);assert.equal(editor.value.canClose(),false)
 click('close()');assert.equal(closed,0,'closing waits for the export')
 writes[0].reject(Error('disk unavailable'));await flush();s=state();assert.equal(s.error,'disk unavailable');assert.equal(s.canExport,true)
 click('save');await flush();writes[1].resolve({success:true,...response('b',{exported:true,current:true})});await flush()
 s=state();assert.equal(s.saved,true);assert.match(s.state,/em dia/);assert.equal(s.canExport,false);click('save');assert.equal(writes.length,2)
 // Stale sources, errors, customized header and missing cutscene project decide what can be exported.
 click('load');await flush();reads[1].resolve(response('b',{exported:true,current:false}));await flush();s=state();assert.match(s.state,/exporte de novo/);assert.equal(s.canExport,true)
 click('load');await flush();reads[2].resolve(response('b',{report:report([{severity:'error',code:'unknown-cutscene',message:'Sala “lab”, objeto 4: a cena “gone” não existe em cutscenes/.'}])}));await flush()
 s=state();assert.match(s.state,/Corrija os erros/);assert.equal(s.canExport,false);assert.deepEqual(s.groups,['error1'])
 click('load');await flush();reads[3].resolve(response('b',{exported:true,headerConflict:true}));await flush();assert.match(state().state,/personalizado/);assert.equal(state().canExport,false)
 click('load');await flush();reads[4].resolve({revision:'x',exported:false,current:false,report:null,error:'O projeto não tem cutscenes/cutscene-config.json. Instale o runtime de cutscenes.',headerConflict:false});await flush()
 s=state();assert.match(s.state,/Instale o runtime/);assert.equal(s.canExport,false)
 // Late replies never land in another project.
 click('load');await flush();reads[5].resolve(response('c'));await flush();click('save');await flush();project.value='/B';await flush()
 writes[2].resolve({success:true,...response('d',{exported:true,current:true})});await flush();reads[6].resolve(response('other'));await flush();await flush()
 const late=reads.length>7;if(late){reads[7].resolve(response('other'));await flush()}
 s=state();assert.equal(s.status.revision,'other');assert.equal(s.saved,false);assert.equal(s.saving,false)
 click('close()');assert.equal(closed,1)
 assert.match(source,/aria-labelledby="adapter-title"/);assert.match(source,/@cancel\.prevent/)
}finally{app?.unmount();if(old===undefined)delete globalThis.window;else globalThis.window=old;fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Cutscene adapter panel: derived status, export, failure, duplicate protection, stale/error/conflict states and late replies passed.')
