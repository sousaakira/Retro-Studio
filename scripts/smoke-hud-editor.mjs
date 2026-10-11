// #65: editor de HUD. Compila o <script setup> real e dirige: carregar, editar elementos, valores,
// menus e fonte, problemas que bloqueiam a exportação, salvar, rascunho, desfazer, conflito,
// arquivo de outra ferramenta e troca de projeto. A marcação real é conferida por texto.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {createHudConfiguration,validateHudConfiguration,SGDK_FONT_MAP} from '../shared/retro/hudConfiguration.js'
import {fontFromImage,emptyGlyphs} from '../shared/retro/hudFont.js'
import {renderHud} from '../shared/retro/hudRuntime.js'
import {HUD_SAMPLE_FONT} from '../shared/retro/hudSampleFont.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-hud-editor-')),old=globalThis.window
const file=fileURLToPath(new URL('../src/components/retro/HudEditor.vue',import.meta.url)),source=fs.readFileSync(file,'utf8')
let app
try{
 // ---- Importação de fonte (função pura que a tela usa) -----------------------------------
 {
  const width=32,height=16,rgba=new Uint8ClampedArray(width*height*4),set=(x,y,r,g,b,a=255)=>{const at=(y*width+x)*4;rgba[at]=r;rgba[at+1]=g;rgba[at+2]=b;rgba[at+3]=a}
  set(9,1,255,255,255);set(10,2,255,255,255);set(17,3,255,0,0);set(26,4,255,255,255,100) // 4ª célula: só um pixel quase transparente
  const font=fontFromImage(rgba,width,height)
  assert.deepEqual([font.glyphs.length,font.map,font.columns,font.cells,font.dropped],[3,' !"',4,8,5],'células vazias no fim são descartadas; mapa começa em ASCII')
  assert.deepEqual(font.colors.slice(0,3),[0,0x0EEE,0x000E]);assert.equal(font.glyphs[1][8+1],'1');assert.equal(font.glyphs[2][3*8+1],'2');assert.deepEqual(emptyGlyphs({map:' ab',glyphs:['0'.repeat(64),'0'.repeat(64),font.glyphs[1]]}),['a'])
  assert.throws(()=>fontFromImage(rgba,30,16),/30 × 16 px\. Largura e altura precisam ser múltiplos de 8/);assert.throws(()=>fontFromImage(new Uint8ClampedArray(8*8*4),8,8),/nenhum pixel opaco/)
  const many=new Uint8ClampedArray(8*8*4);for(let i=0;i<16;i++){many[i*4]=i*36%256;many[i*4+1]=(i>>3)*255;many[i*4+2]=(i&7)*36;many[i*4+3]=255};assert.throws(()=>fontFromImage(many,8,8),/mais de 15 cores/)
  const big=new Uint8ClampedArray(128*56*4);for(let cell=0;cell<112;cell++){const at=(((cell>>4)*8)*128+(cell&15)*8)*4;big[at]=big[at+1]=big[at+2]=big[at+3]=255};assert.throws(()=>fontFromImage(big,128,56),/tem 112 glifos; cabem 96/)
  // Planilha sem transparência (como as indexadas do console, cor 0 de fundo): a cor do canto vira o fundo.
  {const solid=new Uint8ClampedArray(16*8*4);for(let i=0;i<16*8;i++){solid[i*4]=0;solid[i*4+1]=0;solid[i*4+2]=0;solid[i*4+3]=255};const ink=(x,y)=>{solid[(y*16+x)*4]=solid[(y*16+x)*4+1]=solid[(y*16+x)*4+2]=255};ink(9,2);ink(10,3)
   const opaque=fontFromImage(solid,16,8);assert.deepEqual([opaque.backgroundAssumed,opaque.glyphs.length,opaque.glyphs[0],opaque.colors[1]],[true,2,'0'.repeat(64),0x0EEE]);assert.equal(opaque.glyphs[1][2*8+1],'1')
   assert.throws(()=>fontFromImage(new Uint8ClampedArray(8*8*4).fill(255),8,8),/tem uma cor só/);assert.equal(font.backgroundAssumed,false)}
  // Prévia: mesma grade do runtime, com as cores da fonte; sem fonte importada marca as células ocupadas.
  const sample={...createHudConfiguration(),font:{name:'x',map:HUD_SAMPLE_FONT.map,glyphs:[...HUD_SAMPLE_FONT.glyphs],colors:[...HUD_SAMPLE_FONT.colors]}},view=renderHud(sample,{values:{score:7,life:2}})
  assert.deepEqual([view.width,view.height,view.rgba.length],[320,224,320*224*4]);let lit=0;for(let i=3;i<view.rgba.length;i+=4)if(view.rgba[i])lit++;assert.ok(lit>80&&lit<2000,'pixels acesos: '+lit)
  for(let y=0;y<224;y++)for(let x=0;x<320;x++)if(view.rgba[(y*320+x)*4+3])assert.ok(y>=8&&y<16&&x>=8&&x<312,'nada desenhado fora das células do HUD: '+x+','+y)
  assert.ok(renderHud(createHudConfiguration(),{}).rgba.some(value=>value))
  // Janela com diálogo aberto embaixo: como no console, o HUD em plano lá do alto some; fechado, volta.
  {const talk={...sample,dialogue:{enabled:true,anchor:'bottom',x:0,y:0,width:36,lines:3,speaker:true,cursor:'>'}},open=renderHud(talk,{values:{score:7,life:2},dialogue:{speaker:'A',lines:['B']}}),top=image=>{for(let y=8;y<16;y++)for(let x=0;x<320;x++)if(image.rgba[(y*320+x)*4+3])return true;return false}
   assert.deepEqual(open.band,{edge:'bottom',rows:5});assert.equal(top(open),false,'HUD fora da faixa da janela não é desenhado');assert.equal(top(renderHud(talk,{values:{score:7,life:2}})),true);assert.deepEqual(renderHud(talk,{}).band,{edge:'top',rows:2})}
 }
 // ---- Componente ---------------------------------------------------------------------------
 const buttons=['load()','load(true)','save()','close()','close(true)',"addElement('text')","addElement('number')","addElement('bar')","addElement('icons')",'removeElement()','addValue()','removeValue(0)',"renameValue(0,'pontos')","renameValue(1,'pontos')",'addMenu()','addItem()','removeMenu()','useSampleFont()','useSgdkFont()',
  "element.text='OLÁ'","element.text='OLA'","element.sprite=true","element.x=3","element.x=8","config.dialogue.enabled=true","config.plane='bg-a'","config.safe.left=5","config.safe.left=8",'history.undo()','history.redo()','selected=0','selected=1',"overlay='menu'","staleAccepted=true"]
 const output="{ready:!!config,loading,saving,error,notice,validation,dirty,saved,custom,elements:config?.elements.map(item=>item.id+':'+item.type+(item.sprite?':sprite':''))||[],values:config?.values.map(item=>item.id)||[],menus:config?.menus.map(item=>item.id+'/'+item.items.length)||[],selected,selectedMenu,overlay,glyphs:config?.font.glyphs.length,cost:cost&&{sprites:cost.sprites,ram:cost.ramBytes},window:layout?.window||null,notes:layout?.notes.length||0,recoveredAt,draftStale,canClose:canClose(),canUndo:history.canUndo.value,text:element?.text,plane:config?.plane,state:Object.keys(state.values||{})}"
 const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const {descriptor}=parse('<script setup>'+script+'</script><template><div>'+buttons.map(code=>'<button @click="'+code.replace(/"/g,'&quot;')+'">x</button>').join('')+'<output>{{ JSON.stringify('+output+') }}</output></div></template>')
 const compiled=compileScript(descriptor,{id:'host-hud-editor',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_m,_q,specifier)=>'from '+JSON.stringify(/^[./]/.test(specifier)?pathToFileURL(path.resolve(path.dirname(file),specifier)).href:import.meta.resolve(specifier)))
 const target=path.join(temporary,'HudEditor.mjs');fs.writeFileSync(target,compiled)
 const calls=[],drafts=new Map();let disk={},answers={}
 const status=projectPath=>({config:JSON.parse(JSON.stringify(disk[projectPath].config)),revision:disk[projectPath].revision,saved:true,exported:true,foreign:!!disk[projectPath].foreign,conflicts:disk[projectPath].conflicts||[],runtimeInstalled:true,cutsceneNotes:[]})
 globalThis.window={retroStudio:{retro:{
  hudConfiguration:async payload=>{calls.push(['status',payload]);return answers.status?answers.status(payload):status(payload.projectPath)},
  saveHudConfiguration:async payload=>{calls.push(['save',JSON.parse(JSON.stringify(payload))]);if(answers.save)return answers.save(payload);validateHudConfiguration(payload.config);if(payload.revision!==disk[payload.projectPath].revision)return {success:false,error:'A configuração do HUD mudou no disco; recarregue antes de salvar.'};disk[payload.projectPath]={config:payload.config,revision:'r'+calls.length};return {success:true,...status(payload.projectPath)}},
  editorDraft:async payload=>{const key=payload.projectPath+'|'+payload.editor;if(payload.action==='write'){drafts.set(key,{state:payload.state,savedAt:'2026-10-10T15:00:00.000Z'});return {success:true}}if(payload.action==='clear'){drafts.delete(key);return {success:true}}return {success:true,draft:drafts.has(key)?{state:drafts.get(key).state,savedAt:drafts.get(key).savedAt}:null}}}}}
 disk['/A']={config:createHudConfiguration(),revision:'r0'};disk['/B']={config:{...createHudConfiguration(),elements:[]},revision:'b0'}
 const Component=(await import(pathToFileURL(target).href)).default
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},
  insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:n=>{const list=n.parent?.children||[];return list[list.indexOf(n)+1]||null}})
 const props=ref({projectPath:'/A'}),events=[],root=node('root'),instance=ref(null)
 app=renderer.createApp({render:()=>h(Component,{ref:instance,...props.value,onClose:()=>events.push('close')})});app.mount(root)
 const flush=async()=>{for(let i=0;i<5;i++){await new Promise(resolve=>setTimeout(resolve,5));await nextTick()}}
 const find=(n,type)=>n.type===type?n:n.children.map(child=>find(child,type)).find(Boolean)
 const click=async code=>{const index=buttons.indexOf(code);assert.ok(index>=0,code);const list=[];(function walk(n){if(n.type==='button')list.push(n);n.children.forEach(walk)})(root);await list[index].props.onClick();await flush()}
 const state=()=>JSON.parse(find(root,'output').text)
 await flush()
 // 1. Carrega o HUD do projeto; nada sujo; pode fechar.
 let s=state();assert.deepEqual([s.ready,s.dirty,s.custom,s.elements,s.values,s.canClose,s.window],[true,false,false,['score_label:text','score:number','life:icons'],['score','life'],true,{hud:{edge:'top',rows:2},overlay:null}])
 assert.deepEqual(s.state,['score','life'],'a prévia tem um valor de exemplo para cada valor do jogo')
 // 2. Elementos de cada tipo; o novo já nasce válido com a fonte em uso.
 for(const type of ['text','number','bar','icons'])await click("addElement('"+type+"')")
 s=state();assert.deepEqual(s.elements.slice(3),['texto:text','numero:number','barra:bar','icones:icons']);assert.deepEqual([s.validation,s.dirty,s.selected,s.canClose],['',true,6,false])
 // 3. Texto com caractere fora da fonte: problema dito, exportação bloqueada, nada enviado.
 await click('selected=0');await click("element.text='OLÁ'");s=state();assert.match(s.validation,/Elemento score_label: a fonte não tem o caractere “Á”/)
 const before=calls.filter(call=>call[0]==='save').length;await click('save()');assert.equal(calls.filter(call=>call[0]==='save').length,before,'com problema, nada é exportado')
 // 4. A fonte de exemplo tem o Á: o mesmo texto passa a valer. Voltar à fonte do SGDK com sprites em uso é recusado.
 await click('useSampleFont()');s=state();assert.deepEqual([s.validation,s.custom,s.glyphs],['',true,96]);assert.match(s.notice,/Fonte de exemplo com acentos/)
 await click('selected=1');await click('element.sprite=true');s=state();assert.ok(s.elements.includes('score:number:sprite'));assert.equal(s.cost.sprites,6)
 await click('element.x=3');assert.equal(state().validation,'','em sprites a posição é livre');await click('useSgdkFont()');s=state();assert.equal(s.custom,true);assert.match(s.notice,/Há elementos em sprites: eles precisam de uma fonte importada/)
 // 5. Posição fora da grade em elemento de plano e área segura fora da grade.
 await click('selected=0');await click('element.x=3');assert.match(state().validation,/Texto em plano só cai em múltiplos de 8 px/);await click('element.x=8')
 assert.match(state().validation,/ocupam as mesmas células|^$/);await click('history.undo()');await click('history.undo()')
 await click('config.safe.left=5');assert.match(state().validation,/múltiplos de 8 px/);await click('config.safe.left=8');assert.equal(state().validation,'')
 // 6. Valores: renomear acompanha os elementos; remover um valor em uso é recusado com o motivo.
 await click("renameValue(0,'pontos')");s=state();assert.deepEqual(s.values,['pontos','life']);assert.equal(s.validation,'');assert.ok(s.state.includes('pontos'))
 await click("renameValue(1,'pontos')");s=state();assert.deepEqual(s.values,['pontos','life']);assert.match(s.notice,/Já existe um valor chamado “pontos”/)
 await click('removeValue(0)');s=state();assert.deepEqual(s.values,['pontos','life']);assert.match(s.notice,/O valor “pontos” está em uso por um elemento/);await click('addValue()');assert.deepEqual(state().values,['pontos','life','valor'])
 // 7. Menus e diálogo: aparecem na prévia e mudam a faixa da janela.
 await click('addMenu()');s=state();assert.deepEqual([s.menus,s.overlay,s.validation],[['menu/1'],'menu','']);await click('addItem()');assert.deepEqual(state().menus,['menu/2']);assert.ok(state().window.overlay)
 await click('config.dialogue.enabled=true');s=state();assert.equal(s.validation,'');assert.ok(s.notes>=2)
 await click("config.plane='bg-a'");s=state();assert.deepEqual([s.window,s.validation],[null,'']);await click('history.undo()');assert.equal(state().plane,'window')
 // 8. Rascunho: sair sem exportar e voltar recupera as alterações; fechar pede uma decisão.
 // (edições rápidas viram um passo só do histórico: o desfazer acima pode ter voltado bastante; uma edição garante algo a exportar)
 await click('useSampleFont()');await click('addMenu()');assert.equal(state().dirty,true)
 await click('close()');assert.match(state().error,/Exporte o HUD ou use “Descartar e fechar”/);assert.deepEqual(events,[])
 const draftElements=state().elements.length;app.unmount();await flush() // o rascunho fica na memória da sessão e é espelhado em disco com atraso (coberto em smoke-editor-drafts)
 app=renderer.createApp({render:()=>h(Component,{...props.value,onClose:()=>events.push('close')})});root.children.length=0;app.mount(root);await flush()
 s=state();assert.deepEqual([s.elements.length,s.dirty,s.draftStale],[draftElements,true,false],'as alterações não exportadas voltam ao reabrir')
 // 9. Exportar: a configuração vai inteira, com a revisão lida; depois nada sujo e o rascunho some.
 await click('save()');s=state();assert.deepEqual([s.dirty,s.saved,s.error,s.canClose],[false,true,'',true]);const sent=calls.filter(call=>call[0]==='save').at(-1)[1]
 assert.deepEqual([sent.projectPath,sent.revision,sent.config.font.glyphs.length,sent.config.menus.length],['/A','r0',96,1]);validateHudConfiguration(sent.config);assert.ok(!drafts.has('/A|hud'))
 // 10. O disco mudou por fora depois de um rascunho: exportar por cima exige confirmação.
 await click("addElement('text')");app.unmount();await flush();disk['/A'].revision='fora';app=renderer.createApp({render:()=>h(Component,{...props.value,onClose:()=>events.push('close')})});root.children.length=0;app.mount(root);await flush()
 s=state();assert.equal(s.draftStale,true);const count=calls.filter(call=>call[0]==='save').length;await click('save()');assert.equal(calls.filter(call=>call[0]==='save').length,count,'rascunho sobre versão antiga não é exportado sem confirmação')
 await click('staleAccepted=true');await click('save()');assert.equal(calls.filter(call=>call[0]==='save').length,count+1);assert.equal(state().saved,true)
 // 11. Erro do serviço aparece sem prefixo técnico; conflito e arquivo de outra ferramenta bloqueiam.
 await click("addElement('text')");answers.save=()=>({success:false,error:"Error invoking remote method 'retro:save-hud-configuration': Error: Arquivo gerado do HUD foi personalizado ou é de outra ferramenta; nada foi alterado: src/generated/hud_config.h"})
 await click('save()');s=state();assert.equal(s.error,'Arquivo gerado do HUD foi personalizado ou é de outra ferramenta; nada foi alterado: src/generated/hud_config.h');assert.equal(s.dirty,true);answers.save=null
 await click('load(true)');assert.equal(state().dirty,false,'recarregar descarta');disk['/A'].conflicts=['src/generated/hud_config.h'];await click('load()');await click("addElement('text')");const blocked=calls.filter(call=>call[0]==='save').length;await click('save()');assert.equal(calls.filter(call=>call[0]==='save').length,blocked,'com arquivo gerado personalizado nada é exportado')
 disk['/A'].conflicts=[];await click('load(true)')
 // 12. Troca de projeto: carrega o outro HUD; resposta atrasada do anterior é ignorada; descartar fecha.
 let late;answers.status=payload=>payload.projectPath==='/A'?new Promise(resolve=>{late=resolve}):status(payload.projectPath)
 const slow=click('load()');await flush();props.value={projectPath:'/B'};await flush();late(status('/A'));await slow;await flush();s=state();assert.deepEqual([s.elements,s.loading],[[],false],'o HUD mostrado é o do projeto atual');answers.status=null
 await click("addElement('icons')");assert.deepEqual(state().values,['score','life']);await click('close(true)');assert.deepEqual(events,['close']);assert.ok(!drafts.has('/B|hud'))
 app.unmount();app=null
 // ---- Marcação real -------------------------------------------------------------------------
 const template=source.match(/<template>([\s\S]*)<\/template>/)[1]
 assert.match(template,/<dialog ref="dialogElement" class="hud-dialog" aria-labelledby="hud-title" @cancel\.prevent="close\(\)" @keydown="history\.onKeydown">/)
 for(const id of ['hud-plane','hud-width','hud-palette','hud-el-id','hud-el-anchor','hud-el-x','hud-el-text','hud-el-value','hud-el-digits','hud-map','hud-menu-id','hud-menu-title','hud-dlg-width','hud-dlg-lines','hud-overlay'])assert.ok(template.includes('for="'+id+'"')&&template.includes('id="'+id+'"'),'rótulo ligado ao campo: '+id)
 assert.ok((template.match(/role="alert"/g)||[]).length>=4);assert.match(template,/<canvas v-show="!validation" ref="canvas" class="pixel screen" role="img"/);assert.ok(!/v-html/.test(template))
 assert.match(template,/:disabled="blocked\|\|!dirty&&status\?\.exported\|\|!!validation\|\|!!status\?\.conflicts\.length\|\|status\?\.foreign\|\|\(draftStale&&!staleAccepted\)" @click="save"/)
 assert.match(template,/Nome \(só no código\)/);assert.match(template,/Nome \(só neste editor\)/);assert.match(template,/\{\{ dirty \? 'Descartar e recarregar' : 'Recarregar' \}\}/);assert.match(template,/aria-label="Altura da tela"/);assert.match(template,/retroHudSgdkColors/)
assert.match(template,/nunca aparece na tela/)
 {const game=fs.readFileSync(new URL('../src/components/retro/GameWorkspace.vue',import.meta.url),'utf8');assert.match(game,/hud: HudEditor/);assert.match(game,/\{ id: 'hud', row: 'hud', title: 'HUD e textos'/)}
 assert.equal(SGDK_FONT_MAP.length,95)
 console.log('HUD editor: font import, preview, elements of every type, blocked export with reasons, sample font, sprites, values, menus, dialogue, drafts, stale draft, service errors, conflicts, project switch and markup passed.')
}finally{app?.unmount();globalThis.window=old;fs.rmSync(temporary,{recursive:true,force:true})}
