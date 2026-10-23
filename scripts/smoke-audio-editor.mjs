// #50: actual Vue script/lifecycle with a minimal host and a fake Audio element (not layout or sound proof).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {createAudioConfiguration,validateAudioConfiguration} from '../shared/retro/audioConfiguration.js'
import {audioDrafts} from '../src/utils/retro/audioDrafts.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-audio-editor-'))
const old=Object.fromEntries(['window','document','Audio'].map(key=>[key,globalThis[key]]))
let app
try{
 const component=fileURLToPath(new URL('../src/components/retro/AudioEditor.vue',import.meta.url))
 const source=fs.readFileSync(component,'utf8'),script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const buttons=['addMusic','addEffect','save','refreshReport','close()','close(true)','load(true)',"playRoom('music_1')","playRoom('music_2')","playScript('music_2')",'restore','togglePause',"playRoom('')",
  "playEffect('sfx_1')","playEffect('sfx_2')","playEffect('sfx_1',4)","setRoomMusic('cave','music_2')","setRoomMusic('cave','')",'removeMusic(1)','config.effects[1].priority = 9','config.effects[0].priority = 99',
  'config.effects[0].priority = 2',"config.music[0].preview = 'audio/a.ogg'",'removeOrphans','config.effectChannels = 4']
 const template='<template><div ref="dialogElement">'+buttons.map(code=>'<button @click="'+code+'">x</button>').join('')+
  '<output>{{ JSON.stringify({config,dirty,validation,error,mix:mixState,log,previewError,exported,report,reportStale,outputConflicts,revisionConflict,saved,orphans:orphans.map(o=>o.room),music:musicFiles,effects:effectFiles,previews:previewFiles}) }}</output></div></template>'
 // #103: the VGM player (worklet + child component) is replaced; vgmCalls records what the editor asked.
 const stubs={'./VgmPlayer.vue':path.join(temporary,'vgm-player-stub.mjs'),'../../audio/vgmPlayer.js':path.join(temporary,'vgm-engine-stub.mjs')}
 fs.writeFileSync(stubs['./VgmPlayer.vue'],'export default {render(){return null}}\n')
 fs.writeFileSync(stubs['../../audio/vgmPlayer.js'],'export const vgmCalls=globalThis.vgmCalls=[];export const vgmPlayer={key:"",status:"idle"};'+
  'export function playVgm(o){vgmCalls.push(["play",o.key]);vgmPlayer.key=o.key;vgmPlayer.status="playing";return Promise.resolve(true)}'+
  'export function pauseVgm(){vgmCalls.push(["pause",vgmPlayer.key]);vgmPlayer.status="paused"}export function resumeVgm(){vgmCalls.push(["resume",vgmPlayer.key]);vgmPlayer.status="playing"}'+
  'export function stopVgmIf(key){vgmCalls.push(["stop",key]);if(vgmPlayer.key===key){vgmPlayer.key="";vgmPlayer.status="idle"}}export function projectVgm(){return Promise.resolve(new Uint8Array())}\n')
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 const compiled=compileScript(descriptor,{id:'audio-editor-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>
  'from '+JSON.stringify(specifier==='vue'?import.meta.resolve('vue'):stubs[specifier]?pathToFileURL(stubs[specifier]).href:pathToFileURL(path.resolve(path.dirname(component),specifier)).href))
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default
 const reads=[],writes=[],sounds=[],previews=[],events=new Map();let closed=0,gate=null
 globalThis.Audio=class{constructor(url){this.url=url;this.ended=false;this.playing=false;this.loop=false;sounds.push(this)}play(){this.playing=true;return Promise.resolve()}pause(){this.playing=false}addEventListener(name,fn){this['on'+name]=fn}finish(){this.ended=true;this.playing=false;this.onended?.()}}
 globalThis.window={retroStudio:{retro:{
  audioConfiguration(payload){return new Promise((resolve,reject)=>reads.push({payload,resolve,reject}))},
  saveAudioConfiguration(payload){return new Promise((resolve,reject)=>writes.push({payload,resolve,reject}))},
  async getAssetPreview(projectPath,assetPath){previews.push(projectPath+':'+assetPath);if(gate)await gate;return assetPath.includes('broken')?{success:false,error:'Arquivo não encontrado'}:{success:true,preview:'data:'+assetPath}}
 }}}
 globalThis.document={hidden:false,addEventListener(name,fn){events.set(name,fn)},removeEventListener(name){events.delete(name)}}
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
 const project=ref('/A'),editor=ref(null);let root
 const mount=()=>{root=node('root');app=renderer.createApp({render:()=>h(Component,{ref:editor,projectPath:project.value,onClose(){closed++}})});app.mount(root)}
 const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,5));await nextTick();await nextTick()}
 const click=code=>root.children[0].children.filter(n=>n.type==='button')[buttons.indexOf(code)].props.onClick()
 const state=()=>JSON.parse(root.children[0].children.find(n=>n.type==='output').text)
 const rooms=[{id:'cave',name:'Caverna'},{id:'hall',name:'Salão'}],candidates=['audio/a.vgm','audio/b.vgm','audio/a.ogg','audio/jump.wav','audio/hit.wav','audio/notes.mp3']
 const report=(issues=[])=>({driver:{id:'xgm',name:'XGM (SGDK 1.81)',musicFormats:['.vgm','.xgm'],effectFormats:['.wav'],previewFormats:['.ogg','.wav','.mp3'],pcmChannels:4,effectChannels:3,sampleRate:14000,maxEffects:192,toolkit:null},entries:[],romBytes:0,issues,errors:issues.filter(i=>i.severity==='error').length})
 const response=(revision,config=createAudioConfiguration(),extra={})=>({config,revision,exported:false,rooms,worldError:'',outputConflicts:[],candidates,report:report(),...extra})
 const playing=()=>sounds.filter(sound=>sound.playing).map(sound=>sound.url)
 mount();await flush();reads[0].resolve(response('a'));await flush()
 let s=state();assert.equal(s.dirty,false);assert.deepEqual(s.music,['audio/a.vgm','audio/b.vgm']);assert.deepEqual(s.effects,['audio/jump.wav','audio/hit.wav']);assert.deepEqual(s.previews,['audio/a.ogg','audio/jump.wav','audio/hit.wav','audio/notes.mp3'])
 assert.equal(s.mix.playing,65535);assert.equal(s.mix.voices.length,3);assert.equal(editor.value.canClose(),true)
 // New entries take the next unused original and a free stable ID.
 click('addMusic');click('addMusic');click('addEffect');click('addEffect');await flush();s=state()
 assert.deepEqual(s.config.music.map(item=>[item.id,item.source,item.timing]),[['music_1','audio/a.vgm','auto'],['music_2','audio/b.vgm','auto']])
 assert.deepEqual(s.config.effects.map(item=>[item.id,item.source,item.priority,item.channel]),[['sfx_1','audio/jump.wav',4,0],['sfx_2','audio/hit.wav',4,0]])
 assert.equal(s.validation,'');assert.equal(s.dirty,true);assert.equal(s.reportStale,true)
 assert.match(s.exported,/XGM retro_bgm_music_1 "\.\.\/audio\/a\.vgm" -1/);assert.match(s.exported,/#define RETRO_PROJECT_AUDIO_SFX_SFX_2 1/)
 click('config.effects[0].priority = 99');await flush();s=state();assert.match(s.validation,/priority/);assert.equal(s.exported,'');assert.equal(s.mix,null)
 click('save');await flush();assert.equal(writes.length,0,'invalid catalog cannot export')
 click('config.effects[0].priority = 2');click('config.effects[1].priority = 9');click("config.music[0].preview = 'audio/a.ogg'");await flush();assert.equal(state().validation,'')
 // Music: room track with a preview plays; a VGM track without preview plays on the emulated chips (#103).
 click("playRoom('music_1')");await flush();s=state();assert.equal(s.mix.playing,0);assert.deepEqual(playing(),['data:audio/a.ogg']);assert.equal(sounds[0].loop,true);assert.deepEqual(previews,['/A:audio/a.ogg'])
 click("playRoom('music_1')");await flush();assert.equal(sounds.length,1,'the same room track never restarts')
 click("playScript('music_2')");await flush();s=state();assert.equal(s.mix.playing,1);assert.equal(s.mix.overridden,1);assert.deepEqual(playing(),[]);assert.equal(s.previewError,'')
 assert.deepEqual(globalThis.vgmCalls.at(-1),['play','/A::audio/b.vgm'],'same key as the row player')
 click('togglePause');await flush();assert.deepEqual(globalThis.vgmCalls.at(-1),['pause','/A::audio/b.vgm'])
 click('togglePause');await flush();assert.deepEqual(globalThis.vgmCalls.at(-1),['resume','/A::audio/b.vgm'])
 click('restore');await flush();s=state();assert.equal(s.mix.playing,0);assert.equal(s.mix.overridden,0);assert.deepEqual(playing(),['data:audio/a.ogg']);assert.equal(previews.length,1,'preview data is fetched once')
 assert.deepEqual(globalThis.vgmCalls.at(-1),['stop','/A::audio/b.vgm'],'changing track ends the VGM')
 // Effects go through the exported channel policy.
 click("playEffect('sfx_1')");await flush();s=state();assert.equal(s.mix.voices[0].effect,0);assert.match(s.log[0],/“sfx_1” no canal 1\./);assert.ok(playing().includes('data:audio/jump.wav'))
 click("playEffect('sfx_2')");await flush();assert.match(state().log[0],/“sfx_2” no canal 2\./)
 click("playEffect('sfx_1',4)");await flush();s=state()
 assert.deepEqual(s.log.slice(0,4).map(line=>line.replace(/^Efeito “sfx_1” /,'')),['no canal 1, interrompendo “sfx_1”.','no canal 3, interrompendo “sfx_1”.','no canal 1, interrompendo “sfx_1”.','no canal 3.'])
 assert.equal(s.mix.voices[1].priority,9,'the higher priority voice was never interrupted')
 // A finished sound frees its channel for the next effect.
 sounds.filter(sound=>sound.url==='data:audio/hit.wav').forEach(sound=>sound.finish());await flush()
 click("playEffect('sfx_1')");await flush();assert.match(state().log[0],/no canal 2\./)
 // Pause stops every player; hiding the window pauses too.
 click('togglePause');await flush();assert.equal(state().mix.paused,1);assert.ok(!playing().includes('data:audio/a.ogg'),'pause stops the music')
 click('togglePause');await flush();assert.ok(playing().includes('data:audio/a.ogg'))
 globalThis.document.hidden=true;events.get('visibilitychange')();await flush();assert.equal(state().mix.paused,1);assert.ok(!playing().includes('data:audio/a.ogg'));globalThis.document.hidden=false
 click('togglePause');await flush()
 click("playRoom('')");await flush();assert.equal(state().mix.playing,65535)
 // Requests answered late (large previews) never leave a second looping player behind.
 {let open;gate=new Promise(resolve=>{open=resolve});const count=sounds.length
  click('config.music[0].preview = \'audio/a.ogg\'');await flush() // unchanged value: no rebuild
  click("playRoom('music_1')");click("playScript('music_2')");click('restore');click("playRoom('')");click("playRoom('music_1')");await flush()
  gate=null;open();await flush();await flush()
  assert.equal(sounds.length-count<=1,true);assert.deepEqual(playing().filter(url=>url==='data:audio/a.ogg').length,1,'exactly one music player')
  click("playRoom('')");await flush();assert.deepEqual(playing().filter(url=>url==='data:audio/a.ogg'),[])}
 // Room music and its cleanup when a track is removed.
 click("setRoomMusic('cave','music_2')");await flush();assert.deepEqual(state().config.rooms,[{room:'cave',music:'music_2'}])
 click('removeMusic(1)');await flush();s=state();assert.deepEqual(s.config.rooms,[]);assert.equal(s.config.music.length,1);assert.deepEqual(playing(),[],'editing the catalog silences the preview')
 click('addMusic');click("setRoomMusic('cave','music_2')");click('config.effectChannels = 4');await flush();assert.equal(state().mix.voices.length,4)
 // Report for the draft; unsaved work blocks closing; failures keep the draft.
 click('refreshReport');await flush();assert.deepEqual(reads[1].payload.draft,state().config)
 reads[1].resolve({revision:'a',candidates,report:report([{severity:'error',code:'missing-source',message:'Efeito “sfx_1”: arquivo original não encontrado.'}])});await flush()
 s=state();assert.equal(s.report.errors,1);assert.equal(s.reportStale,false);assert.equal(s.dirty,true)
 click('close()');await flush();assert.equal(closed,0);assert.match(state().error,/Salve o áudio/);assert.equal(editor.value.canClose(),false)
 click('save');await flush();assert.equal(writes.length,1);click('save');assert.equal(writes.length,1,'duplicate save blocked')
 validateAudioConfiguration(writes[0].payload.config,{rooms:['cave','hall']});assert.equal(writes[0].payload.revision,'a')
 writes[0].reject(Error('disk unavailable'));await flush();s=state();assert.equal(s.dirty,true);assert.equal(s.error,'disk unavailable')
 const authored=s.config
 // Late save reply after A -> B -> A: no resurrected draft, no false conflict.
 click('save');await flush();project.value='/B';await flush();reads[2].resolve(response('b'));await flush();assert.equal(state().config.music.length,0)
 project.value='/A';await flush();writes[1].resolve({success:true,...response('saved',authored,{exported:true})});await flush()
 reads[3].resolve(response('saved',authored,{exported:true}));await flush();reads[4]?.resolve(response('saved',authored,{exported:true}));await flush()
 s=state();assert.equal(s.dirty,false);assert.equal(s.revisionConflict,false);assert.equal(s.config.music.length,2);assert.equal(audioDrafts.size,0)
 // Drafts survive switches and unmounts; external changes and customized outputs block export.
 const before=reads.length
 click('addEffect');await flush();project.value='/B';await flush();reads[before].resolve(response('b'));await flush()
 project.value='/A';await flush();reads[before+1].resolve(response('external',authored,{exported:true}));await flush();s=state()
 assert.equal(s.config.effects.length,3);assert.equal(s.revisionConflict,true);click('save');await flush();assert.equal(writes.length,2,'conflicting draft cannot export')
 app.unmount();app=null;assert.deepEqual(playing(),[]);mount();await flush();reads[before+2].resolve(response('external',authored,{exported:true}));await flush();assert.equal(state().config.effects.length,3,'session drafts survive unmount')
 click('load(true)');await flush();reads[before+3].resolve(response('external',authored,{exported:true,outputConflicts:['res/audio_resources.res'],rooms:[],worldError:'Unexpected token',worldUnreadable:true}));await flush();s=state()
 assert.deepEqual(s.orphans,[]);assert.equal(s.validation,'','an unreadable world never turns room links into orphans')
 click('load(true)');await flush();reads[before+4].resolve(response('external',authored,{exported:true,outputConflicts:['res/audio_resources.res'],rooms:[rooms[1]],worldError:'Audio room is not in the world graph: cave'}));await flush();s=state()
 assert.equal(s.dirty,false);assert.deepEqual(s.orphans,['cave']);assert.match(s.validation,/not in the world graph/);assert.deepEqual(s.outputConflicts,['res/audio_resources.res'])
 click('removeOrphans');await flush();s=state();assert.equal(s.validation,'');assert.deepEqual(s.config.rooms,[]);click('save');await flush();assert.equal(writes.length,2,'customized output is never overwritten')
 click('close(true)');await flush();assert.equal(closed,1);assert.equal(audioDrafts.size,0)
 assert.match(source,/aria-labelledby="audio-title"/);assert.match(source,/@cancel\.prevent/);assert.match(source,/role="tablist"/)
}finally{
 app?.unmount();audioDrafts.clear()
 for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}
 fs.rmSync(temporary,{recursive:true,force:true})
}
console.log('Audio editor: candidates, stable IDs, room/scripted music with and without preview, channel policy with interruption, pause, room music, draft report, save failure, late replies, isolated drafts, conflicts and unmount recovery passed.')
