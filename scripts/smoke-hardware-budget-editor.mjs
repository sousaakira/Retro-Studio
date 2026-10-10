// Exercise production Vue state with a minimal host, not browser layout.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-budget-editor-'))
const previous=globalThis.window
let app
try {
  const source=fs.readFileSync(new URL('../src/components/retro/HardwareBudgetEditor.vue',import.meta.url),'utf8')
  const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  const template='<template><div><button @click="draft.videoMode = draft.videoMode === \'H40\' ? \'H32\' : \'H40\'">edit</button><button @click="save">save</button><button @click="discard">discard</button><span>{{ draft?.videoMode }}|{{ dirty }}|{{ conflict }}|{{ saving }}|{{ error }}</span></div></template>'
  const {descriptor}=parse('<script setup>'+script+'</script>'+template)
  const compiled=compileScript(descriptor,{id:'budget-editor-test',inlineTemplate:true}).content
    .replace(/from (['"])vue\1/g,'from '+JSON.stringify(import.meta.resolve('vue')))
    .replace(/from (['"])vue-i18n\1/g,'from '+JSON.stringify(import.meta.resolve('vue-i18n')))
  const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
  const Component=(await import(pathToFileURL(file).href)).default
  const calls=[];let confirmations=0,allowDiscard=false,savedEvents=0
  globalThis.window={confirm(){confirmations++;return allowDiscard},retroStudio:{retro:{saveHardwareBudget(payload){return new Promise((resolve,reject)=>calls.push({payload,resolve,reject}))}}}}
  const node=(type,text='')=>({type,text,children:[],parent:null,props:{}})
  const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const i=n.parent?.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1)},parentNode:n=>n.parent,nextSibling:()=>null})
  const project=ref('/A'),configuration=ref({projectPath:'/A',editable:true,revision:'a',budget:{videoMode:'H40',reservations:[],consumers:[]}}),editor=ref(null),root=node('root')
  app=renderer.createApp({render(){return h(Component,{ref:editor,projectPath:project.value,configuration:configuration.value,onSaved(){savedEvents++}})}})
  const messages=JSON.parse(fs.readFileSync(new URL('../src/locales/en.json',import.meta.url),'utf8'))
  app.use(createI18n({legacy:false,locale:'en',messages:{en:messages}}));app.mount(root)
  const tick=async()=>{await nextTick();await nextTick()}
  const button=index=>root.children[0].children.filter(n=>n.type==='button')[index].props.onClick()
  const status=()=>root.children[0].children.find(n=>n.type==='span').text
  await tick();button(0);await tick()
  assert.equal(editor.value.canClose(),false);assert.equal(confirmations,1)
  project.value='/B';await tick()
  assert.match(status(),/^\|false/,'old configuration must not load into the next project')
  configuration.value={projectPath:'/B',editable:true,revision:'b',budget:{videoMode:'H40'}};await tick()
  button(0);await tick()
  project.value='/A';configuration.value={projectPath:'/A',editable:true,revision:'a',budget:{videoMode:'H40'}};await tick()
  assert.match(status(),/^H32\|true\|false/,'draft is restored for its project')
  configuration.value={...configuration.value,revision:'external'};await tick()
  button(1);await tick();assert.equal(calls.length,0,'conflicting draft cannot save')
  assert.match(status(),/^H32\|true\|true/)
  allowDiscard=true;button(2);await tick();assert.match(status(),/^H40\|false/)
  button(0);await tick();button(1);await tick()
  assert.equal(calls[0].payload.revision,'external');assert.equal(calls[0].payload.projectPath,'/A')
  assert.equal(editor.value.canClose(),false,'pending save cannot close')
  calls[0].reject(new Error('disk unavailable'));await tick()
  assert.match(status(),/^H32\|true\|false\|false\|disk unavailable/,'failed save retains draft')
  button(1);await tick()
  project.value='/B';configuration.value={projectPath:'/B',editable:true,revision:'b',budget:{videoMode:'H40'}};await tick()
  calls[1].resolve({success:true,projectPath:'/A',revision:'new-a',budget:calls[1].payload.budget});await tick()
  assert.equal(savedEvents,0,'late save does not refresh another project')
  assert.match(status(),/^H32\|true/,'other project draft remains intact')
  button(1);await tick()
  calls[2].resolve({success:true,projectPath:'/B',revision:'new-b',budget:calls[2].payload.budget});await tick()
  assert.equal(savedEvents,1);assert.match(status(),/^H32\|false/)
  assert.equal(editor.value.canClose(),true)
  console.log('Hardware budget editor: isolated drafts, conflict guard, failure retention, late replies and explicit saves passed.')
} finally {app?.unmount();globalThis.window=previous;fs.rmSync(temporary,{recursive:true,force:true})}
