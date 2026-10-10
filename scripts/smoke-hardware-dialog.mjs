// Real Vue lifecycle/watchers with a small host. This does not verify browser
// rendering/focus: the test template exercises only the production script.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-hardware-dialog-'))
const previous=globalThis.window
try {
  const source=fs.readFileSync(new URL('../src/components/retro/HardwareReport.vue',import.meta.url),'utf8')
  const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  const { descriptor }=parse('<script setup>'+script+'</script><template><dialog ref="dialog"><button @click="abi = \'sgdk-1.81\'">ABI</button><span>{{ report?.projectPath }}</span></dialog></template>')
  const compiled=compileScript(descriptor,{id:'hardware-dialog-test',inlineTemplate:true}).content
    .replace(/import HardwareBudgetEditor from ['"]\.\/HardwareBudgetEditor\.vue['"]/, 'const HardwareBudgetEditor = {}')
    .replace(/from (['"])vue\1/g,'from '+JSON.stringify(import.meta.resolve('vue')))
    .replace(/from (['"])vue-i18n\1/g,'from '+JSON.stringify(import.meta.resolve('vue-i18n')))
  const file=path.join(temporary,'component.mjs')
  fs.writeFileSync(file,compiled)
  const Component=(await import(pathToFileURL(file).href)).default
  const calls=[], operations=[]
  globalThis.window={retroStudio:{retro:{inspectCompiledResources(payload){
    return new Promise(resolve=>calls.push({payload,resolve}))
  }}}}
  const node=(type,text='')=>({type,text,children:[],parent:null,props:{},open:false,
    showModal(){this.open=true;operations.push('show')}, close(){this.open=false;operations.push('close')}
  })
  const renderer=createRenderer({
    createElement:type=>node(type), createText:text=>node('text',text), createComment:text=>node('comment',text),
    setText:(value,text)=>{value.text=text}, setElementText:(value,text)=>{value.text=text},
    patchProp:(value,key,_previous,valueNext)=>{value.props[key]=valueNext},
    insert(value,parent,anchor){if(value.parent){const i=value.parent.children.indexOf(value);if(i>=0)value.parent.children.splice(i,1)}
      value.parent=parent;const i=parent.children.indexOf(anchor);if(i<0)parent.children.push(value);else parent.children.splice(i,0,value)},
    remove(value){operations.push('remove');const i=value.parent?.children.indexOf(value);if(i>=0)value.parent.children.splice(i,1);value.parent=null},
    parentNode:value=>value.parent, nextSibling(value){const children=value.parent?.children||[];return children[children.indexOf(value)+1]||null}
  })
  const project=ref('/game/A'), show=ref(true), root=node('root')
  const app=renderer.createApp({render(){return show.value?h(Component,{projectPath:project.value}):null}})
  app.use(createI18n({legacy:false,locale:'en',messages:{en:{hardwareReport:{unavailable:'Unavailable'}}}}))
  app.mount(root)
  await nextTick(); await nextTick()
  assert.equal(root.children[0].open,true)
  assert.equal(calls.length,1);assert.equal(calls[0].payload.projectPath,'/game/A');assert.equal(calls[0].payload.abi,undefined)
  root.children[0].children.find(child=>child.type==='button').props.onClick()
  await nextTick()
  assert.equal(calls.at(-1).payload.abi,'sgdk-1.81')
  project.value='/game/B'
  await nextTick(); await nextTick()
  assert.equal(calls.at(-1).payload.projectPath,'/game/B')
  assert.equal(calls.at(-1).payload.abi,undefined,'reader selection must not cross project boundaries')
  calls.at(-1).resolve({success:true,projectPath:'/game/B'})
  await nextTick();await nextTick()
  assert.equal(root.children[0].children.find(child=>child.type==='span').text,'/game/B')
  for(const call of calls.filter(call=>call.payload.projectPath==='/game/A'))call.resolve({success:true,projectPath:'/game/A'})
  await nextTick();await nextTick()
  assert.equal(root.children[0].children.find(child=>child.type==='span').text,'/game/B','late reply must not replace the current report')
  show.value=false
  await nextTick()
  assert.ok(operations.includes('close'),'native close must execute while the dialog ref exists')
  assert.ok(operations.indexOf('close')<operations.indexOf('remove'),'close happens before DOM removal')
  app.unmount()
  console.log('Hardware dialog: production Vue watchers/hooks reset cross-project ABI, discard late results and close natively before removal.')
} finally {globalThis.window=previous;fs.rmSync(temporary,{recursive:true,force:true})}
