// #59: actual Vue script/lifecycle with a minimal host (not layout proof).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {createCameraConfiguration,validateCameraConfiguration,compileCameraHeader} from '../shared/retro/cameraConfiguration.js'
import {cameraDrafts} from '../src/utils/retro/cameraDrafts.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-camera-editor-'))
const old=Object.fromEntries(['window','document','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]))
let app
try{
 const component=fileURLToPath(new URL('../src/components/retro/CameraEditor.vue',import.meta.url))
 const source=fs.readFileSync(component,'utf8'),script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const buttons=['profile.deadZoneWidth = 80','save','addRegion','removeRegion','step','togglePlaying','unlock','scriptPan','scriptRelease','close()','close(true)','load(true)',
  "region = region === 'pal' ? 'ntsc' : 'pal'",'preset','current.lock = true','moveTarget(900,100);tick()','scriptX = 300',"roomId = 'hall'",'current.priority = 0','startAtEntry','profile.maxSpeedX = 0.1','removeOrphans']
 const template='<template><div ref="dialogElement">'+buttons.map(code=>'<button @click="'+code+'">x</button>').join('')+
  '<output>{{ JSON.stringify({config,dirty,validation,error,frame:frameState,target,ticks,playing,previewError,exported,headerConflict,revisionConflict,saved,roomId,selected,orphans:orphans.map(r=>r.id),active:activeRegion?.id||null,flags:flagLabels,deadZone}) }}</output></div></template>'
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 const compiled=compileScript(descriptor,{id:'camera-editor-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>
  'from '+JSON.stringify(specifier==='vue'?import.meta.resolve('vue'):pathToFileURL(path.resolve(path.dirname(component),specifier)).href))
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default
 const reads=[],writes=[],events=new Map(),frames=new Map();let frameId=0,closed=0
 const media={matches:false,addEventListener(_name,fn){events.set('motion',fn)},removeEventListener(){events.delete('motion')}}
 globalThis.window={matchMedia:()=>media,addEventListener(name,fn){events.set(name,fn)},removeEventListener(name){events.delete(name)},retroStudio:{retro:{
  cameraConfiguration(payload){return new Promise((resolve,reject)=>reads.push({payload,resolve,reject}))},
  saveCameraConfiguration(payload){return new Promise((resolve,reject)=>writes.push({payload,resolve,reject}))}
 }}}
 globalThis.document={hidden:false,addEventListener(name,fn){events.set(name,fn)},removeEventListener(name){events.delete(name)}}
 globalThis.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId}
 globalThis.cancelAnimationFrame=id=>frames.delete(id)
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
 const project=ref('/A'),editor=ref(null);let root
 const mount=()=>{root=node('root');app=renderer.createApp({render:()=>h(Component,{ref:editor,projectPath:project.value,onClose(){closed++}})});app.mount(root)}
 const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,5));await nextTick();await nextTick()}
 const click=code=>root.children[0].children.filter(n=>n.type==='button')[buttons.indexOf(code)].props.onClick()
 const state=()=>JSON.parse(root.children[0].children.find(n=>n.type==='output').text)
 const rooms=[{id:'cave',name:'Caverna',width:1280,height:448,entries:[{id:'spawn',x:100,y:200,facing:false}]},{id:'hall',name:'Salão',width:256,height:200,entries:[{id:'spawn',x:40,y:180,facing:true}]}]
 const response=(revision,config=createCameraConfiguration(),extra={})=>({config,revision,rooms,worldError:'',headerConflict:false,...extra})
 const runFrame=()=>{const [id,fn]=[...frames.entries()][0];frames.delete(id);fn(0)}
 mount();await flush();reads[0].resolve(response('a'));await flush()
 // Preview starts at the room entry with the exported framing.
 let s=state();assert.equal(s.dirty,false);assert.equal(s.roomId,'cave');assert.deepEqual(s.target,{x:100,y:200})
 assert.equal(s.frame.x,0);assert.equal(s.frame.y,88);assert.equal(s.frame.look,24);assert.deepEqual(s.frame.bounds,{x:0,y:0,width:1280,height:448})
 assert.deepEqual(s.deadZone,{x:136,y:184,width:48,height:32});assert.match(s.exported,/retroProjectCameraNtsc=\{2048,2048,256,1024,48,32,0,0,24,2,2,1,1\}/)
 assert.equal(editor.value.canClose(),true)
 // Stepping walks the target and uses the controller; playback is frame-driven.
 click('step');await flush();s=state();assert.equal(s.ticks,1);assert.equal(s.target.x,102)
 click('togglePlaying');await flush();assert.equal(frames.size,1);assert.equal(state().playing,true)
 for(let i=0;i<60;i++)runFrame()
 await flush();s=state();assert.equal(s.ticks,61);assert.equal(s.target.x,222);assert.ok(s.frame.x>0,'camera follows the walking target')
 const stale=[...frames.values()][0];events.get('blur')();await flush();assert.equal(frames.size,0);assert.equal(state().playing,false)
 stale(0);await flush();assert.equal(state().ticks,61,'a cancelled frame never advances the preview')
 media.matches=true;events.get('motion')();click('togglePlaying');await flush();assert.equal(frames.size,0,'reduced motion keeps explicit stepping only')
 click('step');await flush();assert.equal(state().ticks,62);media.matches=false;events.get('motion')()
 // Editing a profile restarts the preview from the same target with new data.
 click('profile.deadZoneWidth = 80');await flush();s=state()
 assert.equal(s.dirty,true);assert.equal(s.deadZone.width,80);assert.equal(s.ticks,0);assert.match(s.exported,/2048,2048,256,1024,80,32/)
 click('profile.maxSpeedX = 0.1');await flush();s=state();assert.match(s.validation,/precision/);assert.equal(s.exported,'');assert.match(s.previewError,/Corrija/)
 click('save');await flush();assert.equal(writes.length,0,'invalid configuration cannot export')
 click('preset');await flush();s=state();assert.equal(s.validation,'');assert.equal(s.config.profiles.ntsc.deadZoneWidth,48)
 click("region = region === 'pal' ? 'ntsc' : 'pal'");await flush();click('profile.deadZoneWidth = 80');await flush()
 s=state();assert.equal(s.config.profiles.pal.deadZoneWidth,80);assert.equal(s.config.profiles.ntsc.deadZoneWidth,48,'profiles are edited independently')
 // Regions: explicit priority, arena lock, script ownership in the preview.
 click('addRegion');await flush();s=state()
 assert.equal(s.config.rooms[0].id,'cave');assert.equal(s.selected,'region_1');assert.equal(s.config.rooms[0].regions[0].priority,0);assert.equal(s.validation,'')
 click('moveTarget(900,100);tick()');await flush();click('addRegion');await flush();s=state()
 assert.equal(s.selected,'region_2');assert.equal(s.config.rooms[0].regions[1].priority,1,'new regions take the next free priority')
 assert.deepEqual(s.config.rooms[0].regions[1].area,{x:740,y:0,width:320,height:224})
 click('current.priority = 0');await flush();assert.equal(state().validation,'')
 click('current.lock = true');await flush();s=state();assert.equal(s.active,'region_2');assert.match(s.flags,/arena travada/)
 assert.deepEqual(s.frame.bounds,{x:740,y:0,width:320,height:224});assert.match(s.exported,/retroProjectCameraRoom_\d+\[\]=\{.*,0,1\}\};/)
 click('moveTarget(900,100);tick()');await flush()
 click('unlock');await flush();s=state();assert.equal(s.active,null);assert.doesNotMatch(s.flags,/arena travada/)
 click('scriptX = 300');await flush();click('scriptPan');await flush();s=state();assert.equal(s.frame.x,300);assert.match(s.flags,/cena no controle/)
 click('step');await flush();assert.equal(state().frame.x,300,'the scripted axis ignores the target')
 click('scriptRelease');await flush();s=state();assert.match(s.flags,/transição/);assert.doesNotMatch(s.flags,/cena no controle/);assert.ok(s.frame.x>300&&s.frame.x<=306.5,'paced return')
 // Unsaved work blocks closing; failures keep the draft; late replies stay in their project.
 click('close()');await flush();assert.equal(closed,0);assert.match(state().error,/Salve a câmera/);assert.equal(editor.value.canClose(),false)
 click('save');await flush();assert.equal(writes.length,1);click('save');assert.equal(writes.length,1,'duplicate save blocked')
 validateCameraConfiguration(writes[0].payload.config,{rooms:{cave:{width:1280,height:448}}});assert.equal(writes[0].payload.revision,'a')
 writes[0].reject(Error('disk unavailable'));await flush();s=state();assert.equal(s.dirty,true);assert.equal(s.error,'disk unavailable')
 const authored=s.config
 click('save');await flush();project.value='/B';await flush()
 writes[1].resolve({success:true,...response('saved-a',authored)});await flush();reads[1].resolve(response('b'));await flush()
 s=state();assert.equal(s.config.rooms.length,0,'late save never overwrites another project');assert.equal(s.dirty,false)
 project.value='/A';await flush();reads[2].resolve(response('saved-a',authored));await flush();s=state()
 assert.equal(s.dirty,false);assert.equal(s.config.rooms[0].regions.length,2);assert.equal(s.exported,compileCameraHeader(authored,{rooms:{cave:{width:1280,height:448},hall:{width:256,height:200}}}))
 // Drafts survive project switches and unmounts; external changes are flagged.
 click('removeRegion');await flush();assert.equal(state().config.rooms[0].regions.length,1)
 project.value='/B';await flush();reads[3].resolve(response('b'));await flush()
 project.value='/A';await flush();reads[4].resolve(response('external',authored));await flush();s=state()
 assert.equal(s.config.rooms[0].regions.length,1);assert.equal(s.revisionConflict,true)
 click('save');await flush();assert.equal(writes.length,2,'conflicting draft cannot export')
 app.unmount();app=null;assert.equal(frames.size,0)
 mount();await flush();reads[5].resolve(response('external',authored));await flush();assert.equal(state().config.rooms[0].regions.length,1,'session drafts survive unmount')
 click('load(true)');await flush();reads[6].resolve(response('external',authored));await flush();s=state()
 assert.equal(s.dirty,false);assert.equal(s.revisionConflict,false);assert.equal(s.config.rooms[0].regions.length,2)
 // Rooms smaller than the screen and header conflicts.
 click("roomId = 'hall'");await flush();s=state();assert.deepEqual(s.target,{x:40,y:180});assert.equal(s.frame.x,0);assert.equal(s.frame.y,0)
 click('addRegion');await flush();assert.deepEqual(state().config.rooms[1].regions[0].limits,{x:0,y:0,width:256,height:200});assert.equal(state().validation,'')
 click('removeRegion');await flush();assert.equal(state().config.rooms.length,1,'rooms without regions leave the source');assert.equal(state().dirty,false)
 click('load(true)');await flush();reads[7].resolve(response('external',authored,{headerConflict:true}));await flush()
 click('profile.deadZoneWidth = 80');await flush();click('save');await flush();assert.equal(writes.length,2,'customized header is never overwritten')
 click('close(true)');await flush();assert.equal(closed,1);assert.equal(cameraDrafts.size,0)
 // Without a world graph the profiles remain tunable on the example room.
 app.unmount();app=null;project.value='/C';mount();await flush()
 reads[8].resolve(response('c',createCameraConfiguration(),{rooms:[]}));await flush();s=state()
 assert.equal(s.roomId,'');assert.equal(s.frame.y,48);click('addRegion');await flush();assert.equal(state().config.rooms.length,0,'regions need a world room')
 // Regions of a room removed from the world are listed and removable in the editor.
 app.unmount();app=null;project.value='/D';mount();await flush()
 reads[9].resolve(response('d',authored,{rooms:[rooms[1]],worldError:'Camera room is not in the world graph: cave'}));await flush();s=state()
 assert.deepEqual(s.orphans,['cave']);assert.match(s.validation,/not in the world graph/);assert.equal(s.dirty,false)
 click('removeOrphans');await flush();s=state();assert.deepEqual(s.orphans,[]);assert.equal(s.validation,'');assert.equal(s.config.rooms.length,0);assert.equal(s.dirty,true)
 click('close(true)');await flush()
 assert.match(source,/getScreenCTM/,'pointer mapping follows the SVG matrix, not its letterboxed box')
 assert.match(source,/aria-labelledby="camera-title"/);assert.match(source,/@cancel\.prevent/);assert.match(source,/prefers-reduced-motion/)
}finally{
 app?.unmount();cameraDrafts.clear()
 for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}
 fs.rmSync(temporary,{recursive:true,force:true})
}
console.log('Camera editor: exported framing preview, frame-driven playback, reduced motion, independent profiles, prioritized regions, arena lock, scripted ownership, save failure, isolated drafts, late replies, conflicts and unmount recovery passed.')
