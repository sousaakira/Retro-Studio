// #56: actual Vue script/lifecycle of the diagnostics panel with a minimal host (not layout proof).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
// #52: the panel also offers undo/redo; exporting must not become an undo step (checked below).
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-debug-panel-'))
const old=globalThis.window
let app
try{
 const component=fileURLToPath(new URL('../src/components/retro/DebugPanel.vue',import.meta.url))
 const source=fs.readFileSync(component,'utf8'),script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const buttons=['save','load','close()','close(true)','config.enabled = true','config.overlay.boxes = false',"config.transport = 'kdebug'","config.transport = 'usb'"]
 const template='<template><div ref="dialogElement">'+buttons.map(code=>'<button @click="'+code+'">x</button>').join('')+'<output>{{ JSON.stringify({config,dirty,validation,association,error,saved,saving,build:status?.build}) }}</output></div></template>'
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 const compiled=compileScript(descriptor,{id:'debug-panel-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>
  'from '+JSON.stringify(specifier==='vue'?import.meta.resolve('vue'):pathToFileURL(path.resolve(path.dirname(component),specifier)).href))
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default
 const reads=[],writes=[];let closed=0
 globalThis.window={retroStudio:{retro:{debugConfiguration(payload){return new Promise((resolve,reject)=>reads.push({payload,resolve,reject}))},saveDebugConfiguration(payload){return new Promise((resolve,reject)=>writes.push({payload,resolve,reject}))}}}}
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
 const project=ref('/A'),editor=ref(null);let root
 root=node('root');app=renderer.createApp({render:()=>h(Component,{ref:editor,projectPath:project.value,onClose(){closed++}})});app.mount(root)
 const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,5));await nextTick();await nextTick()}
 const click=code=>root.children[0].children.filter(n=>n.type==='button')[buttons.indexOf(code)].props.onClick()
 const state=()=>JSON.parse(root.children[0].children.find(n=>n.type==='output').text)
 const base={format:'retro-studio.debug',version:1,enabled:false,overlay:{performance:true,subject:true,boxes:true},transport:'none',serial:1}
 const last=(extra={})=>({finishedAt:'2026-10-10T12:00:00.000Z',rom:{path:'out/rom.bin',hash:'abcdef0123456789'.repeat(4)},state:'unknown',reason:'',...extra})
 const response=(revision,config=base,extra={})=>({config,revision,exported:true,foreign:false,build:config.enabled?'A1B2C3':'',headerConflict:false,lastBuild:null,...extra})
 await flush();reads[0].resolve(response('a'));await flush()
 let s=state();assert.equal(s.dirty,false);assert.match(s.association,/Sem registro de build da IDE/);assert.equal(s.build,'')
 // Editing, validation, unsaved work blocks closing.
 click('config.enabled = true');click('config.overlay.boxes = false');click("config.transport = 'usb'");await flush();s=state();assert.equal(s.dirty,true);assert.match(s.validation,/transport/)
 click('save');await flush();assert.equal(writes.length,0,'invalid configuration cannot export')
 click("config.transport = 'kdebug'");await flush();assert.equal(state().validation,'')
 click('close()');assert.equal(closed,0);await flush();assert.match(state().error,/Exporte o diagnóstico/);assert.equal(editor.value.canClose(),false)
 // Export, failure, retry, duplicate protection.
 click('save');await flush();assert.equal(writes.length,1);assert.equal(writes[0].payload.config.enabled,true);assert.equal(writes[0].payload.revision,'a');click('save');assert.equal(writes.length,1)
 writes[0].reject(Error('disk unavailable'));await flush();assert.equal(state().error,'disk unavailable');assert.equal(state().dirty,true)
 const exported={...base,enabled:true,overlay:{performance:true,subject:true,boxes:false},transport:'kdebug',serial:2}
 click('save');await flush();writes[1].resolve({success:true,...response('b',exported,{lastBuild:last({reason:'other-configuration'})})});await flush()
 s=state();assert.equal(s.saved,true);assert.equal(s.dirty,false);assert.equal(s.build,'A1B2C3');assert.match(s.association,/Não é possível afirmar.*outra configuração/)
 // Only proven states are affirmed; every other one says it is unknown and why.
 click('load');await flush();reads[1].resolve(response('b',exported,{lastBuild:last({state:'diagnostic',build:'A1B2C3'})}));await flush();assert.match(state().association,/é o diagnóstico #A1B2C3, confirmado pela identificação gravada na própria ROM/)
 click('load');await flush();reads[2].resolve(response('b',base,{lastBuild:last({state:'production-header'})}));await flush();assert.match(state().association,/usou o header de produção.*não confere se todos os arquivos foram recompilados/)
 click('load');await flush();reads[3].resolve(response('b',exported,{lastBuild:last({reason:'rom-changed'})}));await flush();assert.match(state().association,/Não é possível afirmar.*não é a do último build/)
 click('load');await flush();reads[4].resolve(response('b',exported,{lastBuild:last({reason:'identifier-not-in-rom'})}));await flush();assert.match(state().association,/identificação não está na ROM/)
 assert.doesNotMatch(state().association,/é o diagnóstico #/)
 // Customized header and late replies.
 click('load');await flush();reads[5].resolve(response('b',exported,{headerConflict:true}));await flush();click('config.overlay.boxes = false');await flush();click('save');await flush();assert.equal(writes.length,2,'customized header is never overwritten')
 click('load');await flush();reads[6].resolve(response('c',exported));await flush();click('config.overlay.boxes = false');await flush();click('save');await flush();project.value='/B';await flush()
 writes[2].resolve({success:true,...response('d',exported)});await flush();reads[7].resolve(response('other'));await flush();await flush()
 if(reads.length>8){reads[8].resolve(response('other'));await flush()}
 s=state();assert.equal(s.config.enabled,false,'late save never lands in another project');assert.equal(s.saved,false);assert.equal(s.saving,false)
 // A debug.json of another tool: said plainly, export disabled.
 click('load');await flush();reads[reads.length-1].resolve(response('f',base,{foreign:true,exported:false}));await flush();assert.match(state().association,/outra ferramenta/)
 const count=writes.length;click('config.enabled = true');await flush();click('save');await flush();assert.equal(writes.length,count)
 click('close(true)');assert.equal(closed,1)
 assert.match(source,/aria-labelledby="debug-title"/);assert.match(source,/@cancel\.prevent/);assert.match(source,/nunca como estimativa/)
}finally{app?.unmount();if(old===undefined)delete globalThis.window;else globalThis.window=old;fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Debug panel: production default, validation, export, failure, duplicate protection, ROM association states, conflicts and late replies passed.')
