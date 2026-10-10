// Actual Vue script/lifecycle + bundled C WASM, minimal host (not layout proof).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {createMovementConfiguration} from '../shared/retro/movementConfiguration.js'
import {movementDrafts} from '../src/utils/retro/movementDrafts.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-movement-editor-'))
const old=Object.fromEntries(['window','document','fetch','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]))
let app
try{
 const component=fileURLToPath(new URL('../src/components/retro/MovementLab.vue',import.meta.url))
 const source=fs.readFileSync(component,'utf8'),script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const template='<template><div ref="dialogElement"><button @click="config.profiles.ntsc.walkSpeed = 2">edit</button><button @click="save">save</button><button @click="preset">preset</button><button @click="load(true)">reload</button><button @click="region = region === \'pal\' ? \'ntsc\' : \'pal\'">region</button><button @click="step">step</button><button @click="traceJump">trace</button><button @click="togglePlaying">play</button><button @click="close()">close</button><button @click="onViewportBlur({relatedTarget:dialogElement})">internal blur</button><button @click="onViewportBlur({relatedTarget:null})">external blur</button><button @click="buildDiagnostic">build ROM</button><button @click="openDiagnostic">open ROM</button><output>{{diagnostic?.token}}|{{diagnosticBusy}}|{{diagnosticMessage}}</output><span>{{config?.profiles.ntsc.walkSpeed}}|{{dirty}}|{{saving}}|{{revisionConflict}}|{{error}}|{{snapshot?.ticks}}|{{snapshot?.height}}|{{playing}}</span></div></template>'
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 const compiled=compileScript(descriptor,{id:'movement-editor-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>{
  const resolved=specifier==='vue'?import.meta.resolve('vue'):pathToFileURL(path.resolve(path.dirname(component),specifier)).href
  return 'from '+JSON.stringify(resolved)+(specifier.endsWith('.json')?' with {type:"json"}':'')
 })
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default
 const reads=[],writes=[],builds=[],opens=[],events=new Map(),frames=new Map();let frameId=0,closed=0
 const media={matches:false,addEventListener(_name,fn){events.set('motion',fn)},removeEventListener(){events.delete('motion')}}
 globalThis.window={matchMedia:()=>media,addEventListener(name,fn){events.set(name,fn)},removeEventListener(name){events.delete(name)},retroStudio:{retro:{
  buildMovementDiagnostic(payload){return new Promise((resolve,reject)=>builds.push({payload,resolve,reject}))},
  openMovementDiagnostic(payload){return new Promise((resolve,reject)=>opens.push({payload,resolve,reject}))},
  movementConfiguration(payload){return new Promise((resolve,reject)=>reads.push({payload,resolve,reject}))},
  saveMovementConfiguration(payload){return new Promise((resolve,reject)=>writes.push({payload,resolve,reject}))}
 }}}
 globalThis.document={hidden:false,addEventListener(name,fn){events.set(name,fn)},removeEventListener(name){events.delete(name)}}
 const wasm=fs.readFileSync(new URL('../src/assets/runtime/movement-lab.wasm',import.meta.url))
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength)})
 globalThis.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId}
 globalThis.cancelAnimationFrame=id=>frames.delete(id)
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){},contains(target){for(let current=target;current;current=current.parent)if(current===this)return true;return false}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
 const project=ref('/A'),editor=ref(null);let root
 const mount=()=>{root=node('root');app=renderer.createApp({render:()=>h(Component,{ref:editor,projectPath:project.value,onClose(){closed++}})});app.mount(root)}
 const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,5));await nextTick();await nextTick()}
 const button=index=>root.children[0].children.filter(n=>n.type==='button')[index].props.onClick()
 const status=()=>root.children[0].children.find(n=>n.type==='span').text
 const response=(revision,walk=1.5)=>{const config=createMovementConfiguration();config.profiles.ntsc.walkSpeed=walk;return {config,revision,headerConflict:false}}
 mount();await flush();reads[0].resolve(response('a'));await flush();await flush()
 assert.match(status(),/^1.5\|false/);assert.equal(editor.value.canClose(),true)
 button(6);await flush();assert.match(status(),/\|41\|52.5\|false$/,'real C trace appears in Vue state')
 button(7);await flush();assert.equal(frames.size,1)
 button(9);await flush();assert.equal(frames.size,1,'focus inside the dialog keeps playback active');button(10);await flush();assert.equal(frames.size,0,'focus outside the dialog pauses playback');button(7);await flush();assert.equal(frames.size,1)
 const stale=[...frames.values()][0];events.get('blur')();await flush();assert.equal(frames.size,0);stale(100);await flush();assert.match(status(),/\|false$/)
 media.matches=true;events.get('motion')();button(7);await flush();assert.equal(frames.size,0,'reduced motion permits static tracing and stepping')
 media.matches=false;events.get('motion')()
 button(0);await flush();assert.equal(editor.value.canClose(),false)
 button(8);await flush();assert.equal(closed,0,'Escape/ordinary close preserves unsaved settings')
 button(1);await flush();assert.equal(writes[0].payload.projectPath,'/A');assert.equal(editor.value.canClose(),false)
 writes[0].reject(Error('disk unavailable'));await flush();assert.match(status(),/^2\|true\|false\|false\|disk unavailable/)
 button(1);await flush();project.value='/B';await flush()
 writes[1].resolve({success:true,...response('saved-a',2)});await flush();reads[1].resolve(response('b'));await flush()
 assert.match(status(),/^1.5\|false/,'late save never overwrites another project')
 project.value='/A';await flush();reads[2].resolve(response('saved-a',2));await flush();assert.match(status(),/^2\|false/)
 button(2);await flush();assert.match(status(),/^1.5\|true/)
 project.value='/B';await flush();reads[3].resolve(response('b'));await flush()
 project.value='/A';await flush();reads[4].resolve(response('external',3));await flush()
 assert.match(status(),/^1.5\|true\|false\|true/,'dirty draft remains isolated when source changes')
 button(1);await flush();assert.equal(writes.length,2,'conflicting draft cannot export')
 button(3);await flush();reads[5].resolve(response('external',3));await flush();assert.match(status(),/^3\|false\|false\|false/)
 button(0);await flush();app.unmount();app=null;assert.equal(frames.size,0)
 mount();await flush();reads[6].resolve(response('external',3));await flush();assert.match(status(),/^2\|true/,'session drafts survive unmount')
 button(1);await flush();writes[2].resolve({success:true,...response('saved-final',2)});await flush();assert.equal(editor.value.canClose(),true)
 button(4);await flush();button(2);await flush();assert.match(status(),/^2\|false/,'PAL preset never overwrites NTSC values')
 button(11);await flush();assert.equal(builds[0].payload.revision,'saved-final');assert.equal(editor.value.canClose(),false)
 button(11);await flush();assert.equal(builds.length,1,'duplicate build blocked')
 builds[0].reject(Error('compiler unavailable'));await flush();assert.match(status(),/compiler unavailable/);assert.equal(editor.value.canClose(),true)
 button(11);await flush();builds[1].resolve({success:true,token:'room-a',revision:'saved-final'});await flush()
 assert.match(root.children[0].children.find(n=>n.type==='output').text,/room-a/)
 button(7);await flush();assert.equal(frames.size,1)
 button(12);await flush();assert.equal(frames.size,0,'opening the emulator pauses playback before IPC');assert.match(status(),/\|false$/);assert.equal(opens[0].payload.token,'room-a');opens[0].resolve({success:false,message:'emulator unavailable'});await flush();assert.match(status(),/emulator unavailable/)
 button(11);await flush();project.value='/B';await flush();reads[7].resolve(response('b'));await flush()
 builds[2].resolve({success:true,token:'obsolete-a',revision:'saved-final'});await flush()
 assert.doesNotMatch(root.children[0].children.find(n=>n.type==='output').text,/obsolete-a/,'late ROM build cannot attach to another project')
 button(8);await flush();assert.equal(closed,1)
 assert.match(source,/aria-labelledby="movement-title"/);assert.match(source,/@cancel\.prevent/);assert.match(source,/viewBox/)
}finally{
 app?.unmount();movementDrafts.clear()
 for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}
 fs.rmSync(temporary,{recursive:true,force:true})
}
console.log('Movement editor: real C trace, explicit motion, stale frame guard, reduced motion, save failure, isolated drafts, late replies, conflicts and unmount recovery passed.')
