// #57: script e ciclo de vida reais do editor de paletas com um hospedeiro mínimo (não prova layout;
// a tela é conferida em scripts/preview-runtime-panels.mjs ?panel=palettes).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {createPaletteConfiguration,validatePaletteConfiguration,paletteCost} from '../shared/retro/paletteConfiguration.js'
import {paletteDrafts} from '../src/utils/retro/paletteDrafts.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-palette-editor-'))
const saved={window:globalThis.window,Image:globalThis.Image,document:globalThis.document,ImageData:globalThis.ImageData}
let app
try{
 const component=fileURLToPath(new URL('../src/components/retro/PaletteEditor.vue',import.meta.url))
 const source=fs.readFileSync(component,'utf8'),script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const buttons=['save','load','close()','close(true)',"selected = {palette:1,color:3}",'setChannel(0,7)','setChannel(1,99)',"picked = 'res/foto.png'","picked = 'res/heroi.png'",'fillFromImage()','assign()',"unassign('res/heroi.png')",
  "chosen = 'res/foto.png'",'saveIndexedCopy()','addCycle()','addFade()','config.cycles[0].count = 1','config.cycles[0].count = 3',"tab = 'resources'",'config.assignments[0].palette = 2','staleAccepted = true','load(true)']
 const template='<template><div ref="dialogElement">'+buttons.map(code=>'<button @click="'+code+'">x</button>').join('')+'<output>{{ JSON.stringify({config,dirty,validation,error,notice,saved,saving,draftStale,staleAccepted,recoveredAt,cost,analysis:Object.fromEntries(Object.entries(analysis).map(([k,v])=>[k,{colors:v.sourceColors,codes:v.conflicts.map(c=>c.code),changed:v.fit.changedPixels}])),unassigned}) }}</output></div></template>'
 const {descriptor}=parse('<script setup>'+script+'</script>'+template)
 const compiled=compileScript(descriptor,{id:'palette-editor-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_match,_quote,specifier)=>
  'from '+JSON.stringify(specifier==='vue'?import.meta.resolve('vue'):pathToFileURL(path.resolve(path.dirname(component),specifier)).href))
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default
 // Imagens em memória: o "navegador" devolve estes pixels para cada data URL pedida.
 const pixels={'data:heroi':{width:2,height:2,rgba:[252,0,0,255, 0,252,0,255, 0,0,252,255, 0,0,0,0]},
  'data:foto':{width:20,height:1,rgba:Array.from({length:20},(_,i)=>[(i%8)*36,(i>>3)*72,i%2?252:0,255]).flat()}}
 globalThis.Image=class{set src(value){this.data=pixels[value]}async decode(){if(!this.data)throw Error('imagem inválida')}get naturalWidth(){return this.data.width}get naturalHeight(){return this.data.height}}
 globalThis.ImageData=class{constructor(data,width,height){this.data=data;this.width=width;this.height=height}}
 globalThis.document={createElement:()=>({width:0,height:0,getContext(){let drawn;return {drawImage(image){drawn=image.data},getImageData:()=>({data:Uint8ClampedArray.from(drawn.rgba)}),putImageData(){}}}})}
 const reads=[],writes=[],imageReads=[],copies=[];let closed=0
 globalThis.window={retroStudio:{retro:{paletteConfiguration(payload){return new Promise((resolve,reject)=>reads.push({payload,resolve,reject}))},savePaletteConfiguration(payload){return new Promise((resolve,reject)=>writes.push({payload,resolve,reject}))},
  async paletteImage(payload){imageReads.push(payload);return payload.path==='res/heroi.png'?{dataUrl:'data:heroi'}:payload.path==='res/foto.png'?{dataUrl:'data:foto'}:{error:'Imagem ausente'}},
  async copyAssetToProject(projectPath,name,bytes){copies.push({projectPath,name,bytes});return {success:true,assetPath:'res/'+name}}}}}
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},
  insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:n=>{const list=n.parent?.children||[];return list[list.indexOf(n)+1]||null}})
 const project=ref('/A'),editor=ref(null),root=node('root')
 app=renderer.createApp({render:()=>h(Component,{ref:editor,projectPath:project.value,onClose(){closed++}})});app.mount(root)
 const flush=async()=>{for(let i=0;i<4;i++){await new Promise(resolve=>setTimeout(resolve,5));await nextTick()}}
 const click=code=>{const index=buttons.indexOf(code);assert.ok(index>=0,code);return root.children[0].children.filter(n=>n.type==='button')[index].props.onClick()}
 const state=()=>JSON.parse(root.children[0].children.find(n=>n.type==='output').text)
 const base=createPaletteConfiguration()
 const response=(revision,config=base,extra={})=>({config,revision,saved:true,exported:true,foreign:false,headerConflict:false,runtimeInstalled:true,images:['res/heroi.png','res/foto.png','res/ausente.png'],
  compiled:{built:false,resources:[],pending:0},cost:paletteCost(config),files:{},...extra})
 await flush();assert.deepEqual(reads[0].payload,{projectPath:'/A'});reads[0].resolve(response('a'));await flush()
 let s=state();assert.equal(s.dirty,false);assert.deepEqual(s.config,base);assert.deepEqual(s.unassigned,['res/heroi.png','res/foto.png','res/ausente.png'])
 // Editar uma cor: níveis limitados a 0–7, alteração não exportada bloqueia o fechamento.
 click("selected = {palette:1,color:3}");click('setChannel(0,7)');click('setChannel(1,99)');await flush();s=state()
 assert.equal(s.config.palettes[1].colors[3],(7<<1)|(7<<5)|((base.palettes[1].colors[3]>>9&7)<<9));assert.equal(s.dirty,true);assert.equal(s.validation,'')
 click('close()');assert.equal(closed,0);await flush();assert.match(state().error,/Exporte as paletas/);assert.equal(editor.value.canClose(),false)
 // Preencher a paleta com as cores de uma imagem: a imagem é só lida; com mais de 15 cores há aviso.
 click("picked = 'res/heroi.png'");await click('fillFromImage()');await flush();s=state()
 assert.deepEqual(s.config.palettes[1].colors.slice(0,4),[0,0x00E,0x0E0,0xE00]);assert.match(s.notice,/3 cores da imagem/);assert.deepEqual(imageReads,[{projectPath:'/A',path:'res/heroi.png'}])
 click("picked = 'res/foto.png'");await click('fillFromImage()');await flush();s=state();assert.match(s.notice,/tem 20 cores.*15/);assert.equal(new Set(s.config.palettes[1].colors.slice(1)).size,15);assert.equal(imageReads.length,2)
 // Atribuição e conflitos: a foto cabe na paleta que saiu dela? Não por inteiro: 20 cores foram unidas em 15.
 click("picked = 'res/foto.png'");click('assign()');await flush();s=state()
 assert.deepEqual(s.config.assignments,[{resource:'res/foto.png',palette:1}]);assert.deepEqual(s.unassigned,['res/heroi.png','res/ausente.png'])
 assert.deepEqual(s.analysis['res/foto.png'].codes,['too-many-colors','colors-not-in-palette']);assert.equal(s.analysis['res/foto.png'].colors,20);assert.equal(s.analysis['res/foto.png'].changed,5)
 assert.equal(imageReads.length,2,'imagem já lida não é pedida de novo')
 click("picked = 'res/heroi.png'");click('assign()');await flush();s=state();assert.deepEqual(s.analysis['res/heroi.png'].codes,['colors-not-in-palette'],'vermelho/verde/azul puros já não estão na paleta')
 click("unassign('res/heroi.png')");await flush();assert.equal(state().config.assignments.length,1)
 // Trocar a paleta atribuída recalcula o conflito.
 click('config.assignments[0].palette = 2');await flush();assert.equal(state().analysis['res/foto.png'].changed>5,true);click("selected = {palette:1,color:3}")
 // Cópia indexada: arquivo novo com nome derivado; nada escreve no original.
 click("chosen = 'res/foto.png'");await flush();await click('saveIndexedCopy()');await flush()
 assert.equal(copies.length,1);assert.deepEqual([copies[0].projectPath,copies[0].name],['/A','foto-pal2.png']);assert.deepEqual(copies[0].bytes.slice(0,8),[137,80,78,71,13,10,26,10])
 assert.match(state().notice,/Cópia indexada salva em res\/foto-pal2\.png\. O original res\/foto\.png não foi alterado/)
 // Efeitos: os padrões são válidos; valor inválido bloqueia a exportação e some o custo.
 click('addCycle()');click('addFade()');await flush();s=state();validatePaletteConfiguration(s.config);assert.equal(s.cost.cycles.length,1);assert.equal(s.cost.fades[0].maxWordsPerFrame,64)
 click('config.cycles[0].count = 1');await flush();s=state();assert.match(s.validation,/O ciclo “ciclo1” não cabe na paleta/);assert.equal(s.cost,null)
 click('save');await flush();assert.equal(writes.length,0,'configuração inválida não é exportada')
 click('config.cycles[0].count = 3');await flush();assert.equal(state().validation,'')
 // Exportar: envia a revisão lida; falha preserva as edições; sucesso zera o estado sujo.
 click('save');await flush();assert.equal(writes.length,1);assert.equal(writes[0].payload.revision,'a');assert.equal(state().saving,true)
 click('save');click('close(true)');await flush();assert.equal(writes.length,1);assert.equal(closed,0,'não fecha nem exporta de novo durante uma exportação')
 writes[0].resolve({success:false,error:'Palette configuration changed; reload before saving.'});await flush();s=state();assert.match(s.error,/mudaram no disco/);assert.equal(s.dirty,true);assert.equal(s.config.cycles.length,1)
 click('save');await flush();const sent=writes[1].payload.config;writes[1].resolve({success:true,...response('b',sent)});await flush();s=state()
 assert.deepEqual([s.dirty,s.saved,s.error],[false,true,'']);assert.equal(editor.value.canClose(),true);click('close()');assert.equal(closed,1)
 // Arquivo de outra ferramenta ou header personalizado: nada é exportado.
 click('load');await flush();reads[1].resolve(response('c',sent,{foreign:true}));await flush();click('addFade()');await flush();assert.equal(state().dirty,true);click('save');await flush();assert.equal(writes.length,2)
 click('load');await flush();reads[2].resolve(response('d',sent,{headerConflict:true}));await flush();click('addFade()');await flush();assert.equal(state().dirty,true);click('save');await flush();assert.equal(writes.length,2)
 // Troca de projeto: respostas atrasadas do projeto anterior não aparecem no novo.
 click('load');await flush();const late=reads[3];project.value='/B';await flush();assert.deepEqual(reads[4].payload,{projectPath:'/B'})
 late.resolve(response('velho',sent));await flush();assert.equal(state().config,null,'resposta do projeto anterior descartada')
 const other=createPaletteConfiguration();other.backdrop=7;reads[4].resolve(response('e',other));await flush();assert.equal(state().config.backdrop,7);assert.deepEqual(state().analysis,{})
 reads[4]=null;click('load');await flush();reads[5].reject(Error('sem acesso'));await flush();assert.match(state().error,/sem acesso/)
 // #52 (revisão): rascunho feito sobre uma versão antiga do arquivo não é exportado por cima do disco sem decisão.
 const mine=createPaletteConfiguration();mine.backdrop=9
 paletteDrafts.set('/C',{config:mine,revision:'antiga'});project.value='/C';await flush()
 const disk=createPaletteConfiguration();disk.backdrop=2;reads.at(-1).resolve(response('nova',disk));await flush();s=state()
 assert.deepEqual([s.config.backdrop,s.dirty,s.draftStale,s.staleAccepted],[9,true,true,false],'o rascunho volta, marcado como feito sobre versão antiga')
 const writesBefore=writes.length;click('save');await flush();assert.equal(writes.length,writesBefore,'exportação bloqueada até o usuário decidir')
 click('staleAccepted = true');await flush();click('save');await flush();assert.equal(writes.length,writesBefore+1);assert.equal(writes.at(-1).payload.config.backdrop,9)
 writes.at(-1).resolve({success:true,...response('depois',writes.at(-1).payload.config)});await flush();assert.deepEqual([state().dirty,state().draftStale,paletteDrafts.get('/C')],[false,false,undefined])
 // Descartar e recarregar: fica com o disco e o rascunho some.
 paletteDrafts.set('/C',{config:mine,revision:'antiga'});click('load(true)');await flush();reads.at(-1).resolve(response('nova2',disk));await flush();assert.deepEqual([state().config.backdrop,state().dirty,paletteDrafts.get('/C')],[2,false,undefined])
 app.unmount();app=null
}finally{app?.unmount();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Palette editor: load, color editing, palette from image, assignments and conflicts, indexed copy, effects, export contract, foreign/conflict blocks and project switch passed.')
