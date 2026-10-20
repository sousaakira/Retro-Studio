// Jogo → Inimigos: o script real do EnemyEditor.vue num host mínimo, com a ponte chamando o
// exportador de verdade num projeto temporário (criar, salvar, reabrir, editar, remover, fechar).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {enemyProject} from './fixtures/enemy-project.mjs'
import {enemyConfigurationStatus,saveEnemyConfiguration} from '../electron/retro/enemyConfiguration.js'

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-enemy-editor-')),project=path.join(temporary,'game')
const old=Object.fromEntries(['window','document'].map(key=>[key,globalThis[key]]))
let app
try{
 await enemyProject(project).create()
 const component=fileURLToPath(new URL('../src/components/retro/EnemyEditor.vue',import.meta.url))
 const source=fs.readFileSync(component,'utf8'),script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const buttons=['addDefinition()',"chooseCharacter('charsets/ninja.charset.json')","renameId('ninja')","config.settings.palette.from='charsets/hero.charset.json';changed()",
  'save()','definition.health=7;changed()',"definition.animations.death='';changed()",'duplicate()','remove()','close()']
 const template='<template><div ref="dialogElement">'+buttons.map(code=>'<button @click="'+code.replace(/"/g,'&quot;')+'">x</button>').join('')+
  '<output>{{ JSON.stringify({config,selected,dirty,saving,error,saved,canSave,savedIds:[...savedIds],problems:status?.problems,upToDate:status?.upToDate,'+
  'death:definition?fallbackText(\'death\'):\'\',placed:definition?instancesOf(definition.id).length:0,characters:status?.characters?.length}) }}</output></div></template>'
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 const compiled=compileScript(descriptor,{id:'enemy-editor-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>
  'from '+JSON.stringify(specifier==='vue'?import.meta.resolve('vue'):pathToFileURL(path.resolve(path.dirname(component),specifier)).href))
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default
 let confirmAnswer=true,confirms=0,events=0,closed=0
 globalThis.window={confirm(){confirms++;return confirmAnswer},dispatchEvent(){events++},addEventListener(){},removeEventListener(){},retroStudio:{retro:{
  enemyConfiguration:async payload=>{assert.equal(payload.projectPath,project);return enemyConfigurationStatus(project,{draft:payload.config})},
  saveEnemyConfiguration:async payload=>{assert.equal(payload.projectPath,project);return saveEnemyConfiguration(project,{config:payload.config,revision:payload.revision})}
 }}}
 globalThis.CustomEvent=class{constructor(type,init){this.type=type;this.detail=init?.detail}}
 globalThis.document={addEventListener(){},removeEventListener(){}}
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
 let root
 const mount=()=>{root=node('root');app=renderer.createApp({render:()=>h(Component,{projectPath:project,onClose(){closed++}})});app.mount(root)}
 const flush=async(ms=5)=>{await new Promise(resolve=>setTimeout(resolve,ms));await nextTick();await nextTick()}
 const settle=()=>flush(320) // espera a conferência ao vivo (250 ms) do rascunho
 const click=code=>root.children[0].children.filter(n=>n.type==='button')[buttons.indexOf(code)].props.onClick()
 const state=()=>{const out=root.children[0].children.find(n=>n.type==='output');return JSON.parse(out.children[0]?.text??out.text)}

 mount();await flush()
 let s=state()
 assert.equal(s.characters,2);assert.deepEqual(s.config.definitions,[]);assert.equal(s.dirty,false)
 // Criar: personagem escolhido preenche as animações pelos nomes comuns.
 click('addDefinition()');click("chooseCharacter('charsets/ninja.charset.json')");click("renameId('ninja')")
 click("config.settings.palette.from='charsets/hero.charset.json';changed()");await settle()
 s=state()
 assert.equal(s.selected,'ninja');assert.equal(s.dirty,true)
 assert.deepEqual(s.config.definitions[0].animations,{idle:'idle',walk:'run',attack:'ataque',hurt:'dano',death:'morte'})
 assert.deepEqual(s.problems,[]);assert.equal(s.placed,2,'as duas instâncias do mapa já apontam para "ninja"')
 // Salvar e exportar.
 click('save()');await flush(20)
 s=state()
 assert.equal(s.saved,true,s.error);assert.equal(s.upToDate,true);assert.equal(s.dirty,false);assert.deepEqual(s.savedIds,['ninja'])
 assert.ok(fs.existsSync(path.join(project,'src/generated/enemy_data.h')));assert.equal(events,1)
 // Reabrir: a definição volta igual; o ID já salvo fica fixo.
 app.unmount();mount();await flush()
 s=state()
 assert.equal(s.config.definitions[0].id,'ninja');assert.equal(s.selected,'ninja');assert.equal(s.upToDate,true);assert.deepEqual(s.savedIds,['ninja'])
 // Editar: mudança vira rascunho conferido ao vivo; salvar grava a fonte.
 click('definition.health=7;changed()');click("definition.animations.death='';changed()");await settle()
 s=state()
 assert.equal(s.dirty,true);assert.equal(s.death,'usa Dano')
 click('save()');await flush(20)
 assert.equal(JSON.parse(fs.readFileSync(path.join(project,'enemies/enemies.json'),'utf8')).definitions[0].health,7)
 assert.match(fs.readFileSync(path.join(project,'src/generated/enemy_data.h'),'utf8'),/\.health=7/)
 // Duplicar gera ID novo; remover um tipo usado nos mapas pede confirmação e vira problema claro.
 click('duplicate()');await settle()
 s=state();assert.equal(s.selected,'ninja_2');assert.equal(s.config.definitions.length,2)
 click('remove()');await settle();assert.equal(confirms,1)
 s=state();assert.equal(s.config.definitions.length,1)
 const used=s.config.definitions[0].id;assert.equal(used,'ninja')
 click('remove()');await settle();assert.equal(confirms,2)
 s=state();assert.deepEqual(s.config.definitions,[]);assert.ok(s.problems.some(text=>/"ninja" não está cadastrado/.test(text)))
 // Fechar com mudanças: pergunta; recusar mantém aberto.
 confirmAnswer=false;click('close()');assert.equal(closed,0)
 confirmAnswer=true;click('close()');assert.equal(closed,1)
 assert.equal(JSON.parse(fs.readFileSync(path.join(project,'enemies/enemies.json'),'utf8')).definitions.length,1,'descartar não apaga o que foi salvo')
}finally{
 app?.unmount()
 for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}
 delete globalThis.CustomEvent
 fs.rmSync(temporary,{recursive:true,force:true})
}
console.log('Enemy editor: criar com animações sugeridas, conferência ao vivo, salvar e exportar, reabrir com ID fixo, editar, fallback, duplicar, remover usado e fechar com confirmação passaram.')
