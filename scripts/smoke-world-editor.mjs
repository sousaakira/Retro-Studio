// #55: execute actual Vue script with a minimal host; no Electron/game writes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {createWorldConfiguration,validateWorldConfiguration} from '../shared/retro/worldConfiguration.js'
import {worldDrafts} from '../src/utils/retro/worldDrafts.js'
const component=fileURLToPath(new URL('../src/components/retro/WorldGraphEditor.vue',import.meta.url)),source=fs.readFileSync(component,'utf8')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-world-editor-')),oldWindow=globalThis.window
let app
try{
 const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const template=`<template><div ref="dialogElement"><button @click="addRoom">room</button><button @click="addItem('entries')">entry</button><button @click="addItem('exits')">exit</button><button @click="addItem('checkpoints')">checkpoint</button><button @click="addCondition">condition</button><button @click="save">save</button><button @click="close()">close</button><button @click="close(true)">discard close</button><button @click="load(true)">reload</button><button @click="removeRoom">remove room</button><button @click="removeItem('entries',room.entries[0])">remove entry</button><button @click="room.name='Edited'">edit</button><button @click="selection=config.rooms[0].id">select first</button><output>{{JSON.stringify({config,dirty,saving,validation,error,revisionConflict,selection})}}</output></div></template>`
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 const compiled=compileScript(descriptor,{id:'world-editor-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>'from '+JSON.stringify(specifier==='vue'?import.meta.resolve('vue'):pathToFileURL(path.resolve(path.dirname(component),specifier)).href))
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default,reads=[],writes=[]
 globalThis.window={retroStudio:{retro:{worldConfiguration:payload=>new Promise((resolve,reject)=>reads.push({payload,resolve,reject})),saveWorldConfiguration:payload=>new Promise((resolve,reject)=>writes.push({payload,resolve,reject}))}}}
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
 const project=ref('/A'),editor=ref(null);let root,closed=0
 const mount=()=>{root=node('root');app=renderer.createApp({render:()=>h(Component,{ref:editor,projectPath:project.value,onClose(){closed++}})});app.mount(root)}
 const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,5));await nextTick()}
 const button=index=>root.children[0].children.filter(n=>n.type==='button')[index].props.onClick()
 const state=()=>JSON.parse(root.children[0].children.find(n=>n.type==='output').text)
 const catalog={maps:[{path:'maps/a.tmx',width:320,height:224}],errors:[],truncated:false}
 const response=(revision,config=createWorldConfiguration())=>({config,revision,catalog,headerConflict:false,mapError:''})
 mount();await flush();reads[0].resolve(response('a'));await flush()
 assert.equal(state().dirty,false);button(0);await flush();assert.equal(state().config.rooms.length,1);assert.equal(state().config.initial.room,'room_1');assert.equal(state().validation,'')
 button(1);button(2);button(3);button(4);await flush()
 const authored=state().config;validateWorldConfiguration(authored)
 assert.equal(authored.rooms[0].entries.length,2);assert.equal(authored.rooms[0].checkpoints.length,1);assert.equal(authored.rooms[0].exits[0].targetEntry,'spawn')
 button(10);await flush();assert.equal(state().config.rooms[0].entries.length,2,'referenced initial entry is preserved')
 button(6);await flush();assert.equal(closed,0);assert.equal(editor.value.canClose(),false)
 button(5);await flush();assert.equal(writes.length,1);button(5);assert.equal(writes.length,1,'duplicate save blocked')
 writes[0].reject(Error('disk unavailable'));await flush();assert.equal(state().dirty,true);assert.equal(state().error,'disk unavailable')
 button(0);await flush();assert.equal(state().config.rooms[1].id,'room_2');button(9);await flush();assert.equal(state().config.rooms.length,1,'unreferenced room can be removed')
 button(5);await flush();const submitted=writes[1].payload.config;assert.equal(submitted.rooms[0].id,authored.rooms[0].id)
 project.value='/B';await flush();writes[1].resolve({success:true,...response('saved-a',submitted)});reads[1].resolve(response('b'));await flush();assert.equal(state().config.rooms.length,0,'late save cannot overwrite B')
 project.value='/A';await flush();reads[2].resolve(response('saved-a',submitted));await flush();assert.equal(state().dirty,false)
 button(11);await flush();app.unmount();app=null;assert.equal(worldDrafts.get('/A').config.rooms[0].name,'Edited')
 mount();await flush();reads[3].resolve(response('external-a',submitted));await flush();assert.equal(state().config.rooms[0].name,'Edited');assert.equal(state().revisionConflict,true)
 button(5);await flush();assert.equal(writes.length,2,'stale draft cannot publish')
 button(8);await flush();reads[4].resolve(response('external-a',submitted));await flush();assert.equal(state().dirty,false);assert.equal(state().revisionConflict,false)
 button(11);await flush();app.unmount();app=null;mount();await flush();reads[5].resolve(response('external-a',submitted));await flush()
 assert.equal(state().dirty,true,'draft restored before second edit')
 button(0);await flush();button(5);await flush();const afterDraft=writes[2].payload.config
 writes[2].resolve({success:true,...response('after-draft',afterDraft)});await flush();assert.equal(state().dirty,false);assert.equal(worldDrafts.has('/A'),false,'saving a new edit clears the older restored draft')
 button(6);await flush();assert.equal(closed,1);app.unmount();app=null;mount();await flush();reads[6].resolve(response('after-draft',afterDraft));await flush();assert.equal(state().revisionConflict,false);assert.deepEqual(state().config,afterDraft)
 button(11);await flush();button(7);await flush();assert.equal(closed,2);app.unmount();app=null;assert.equal(worldDrafts.has('/A'),false,'explicit discard is not recached during unmount')
 assert.match(source,/aria-labelledby="world-title"/);assert.match(source,/@cancel\.prevent/)
 const actual=parse(source);assert.deepEqual(actual.errors,[]);compileScript(actual.descriptor,{id:'world-real-template',inlineTemplate:true})
 const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8'),preload=fs.readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8')
 assert.match(main,/worldConfigurationStatus\(await assetActionWorkspace\(payload\)\)/)
 assert.match(main,/saveWorldConfiguration\(await assetActionWorkspace\(payload\), \{config:payload.config,revision:payload.revision\}\)/)
 assert.match(preload,/worldConfiguration:.*retro:world-configuration/);assert.match(preload,/saveWorldConfiguration:.*retro:save-world-configuration/)
}finally{app?.unmount();worldDrafts.clear();if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;fs.rmSync(temporary,{recursive:true,force:true})}
console.log('World editor: real Vue authoring, stable IDs, safe removal, save failure, isolated drafts, late replies, conflicts, explicit discard and narrow workspace IPC passed.')
