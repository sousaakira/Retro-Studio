// #52: desfazer/refazer por documento (composable), rascunhos duráveis dos editores e
// recuperação do mapa em edição. A interface real é conferida por
// scripts/electron-undo-recovery.steps.mjs (IDE Electron isolada).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {ref,computed,nextTick,effectScope} from 'vue'
import {useDocumentUndo} from '../src/composables/useDocumentUndo.js'
import {DurableDrafts,draftTimer} from '../src/utils/retro/durableDrafts.js'
const old=globalThis.window
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const plainCopy=value=>JSON.parse(JSON.stringify(value)) // objects created inside vm contexts
try{
 // ---- Desfazer/refazer de um documento reativo --------------------------------------------
 const scope=effectScope()
 await scope.run(async()=>{
  const config=ref(null),blocked=ref(false),history=useDocumentUndo(config,{blocked:()=>blocked.value})
  assert.deepEqual([history.canUndo.value,history.undo(),history.redo()],[false,false,false],'sem documento não há o que desfazer')
  config.value={rooms:['a'],name:'x'};await nextTick();assert.equal(history.canUndo.value,false,'carregar não cria passo')
  config.value.rooms.push('b');await nextTick();assert.equal(history.canUndo.value,true)
  await sleep(450);config.value.name='y';await nextTick()
  assert.equal(history.undo(),true);await nextTick();assert.deepEqual(config.value,{rooms:['a','b'],name:'x'});assert.equal(history.canRedo.value,true)
  assert.equal(history.undo(),true);await nextTick();assert.deepEqual(config.value,{rooms:['a'],name:'x'});assert.equal(history.canUndo.value,false)
  assert.equal(history.redo(),true);await nextTick();assert.deepEqual(config.value.rooms,['a','b'])
  // Aplicar um passo não cria passo novo (nada de laço): refazer continua disponível.
  assert.equal(history.canRedo.value,true);assert.equal(history.redo(),true);await nextTick();assert.deepEqual(config.value,{rooms:['a','b'],name:'y'});assert.equal(history.canRedo.value,false)
  // Editar depois de desfazer descarta o ramo refeito.
  history.undo();await nextTick();await sleep(450);config.value.name='z';await nextTick();assert.equal(history.canRedo.value,false)
  // Bloqueado (salvando/carregando): nada muda.
  blocked.value=true;assert.equal(history.undo(),false);assert.equal(config.value.name,'z');blocked.value=false
  // Recarregar do disco ou trocar de projeto (null → objeto): histórico novo.
  config.value=null;await nextTick();config.value={rooms:['outro projeto'],name:'q'};await nextTick()
  assert.deepEqual([history.canUndo.value,history.canRedo.value,history.undo()],[false,false,false]);assert.equal(config.value.name,'q')
  // Teclado: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y; campos de texto ficam com o próprio desfazer.
  await sleep(450);config.value.name='r';await nextTick()
  const key=(extra)=>{let prevented=false;const handled=history.onKeydown({key:'z',ctrlKey:true,target:{tagName:'BUTTON'},preventDefault(){prevented=true},...extra});return [handled,prevented]}
  assert.deepEqual(key({target:{tagName:'INPUT',type:'text'}}),[false,false]);assert.equal(config.value.name,'r')
  assert.deepEqual(key({target:{tagName:'TEXTAREA'}}),[false,false]);assert.deepEqual(key({key:'s'}),[false,false]);assert.deepEqual(key({altKey:true}),[false,false])
  assert.deepEqual(key({target:{tagName:'INPUT',type:'range'}}),[true,true]);await nextTick();assert.equal(config.value.name,'q')
  assert.deepEqual(key({shiftKey:true}),[true,true]);await nextTick();assert.equal(config.value.name,'r')
  history.undo();await nextTick();assert.deepEqual(key({key:'y'}),[true,true]);await nextTick();assert.equal(config.value.name,'r')
  assert.deepEqual(key({metaKey:true,ctrlKey:false}),[true,true]);await nextTick();assert.equal(config.value.name,'q')
 })
 // Campos que o serviço carimba ao exportar (série, semente) não são edição: exportar não cria passo.
 await scope.run(async()=>{
  const config=ref(null),history=useDocumentUndo(config,{key:value=>JSON.stringify({...value,serial:undefined,seed:undefined})})
  config.value={enabled:false,serial:1,seed:7};await nextTick();config.value={enabled:false,serial:2,seed:9};await nextTick()
  assert.equal(history.canUndo.value,false,'resposta de uma exportação não vira passo');config.value.enabled=true;await nextTick();assert.equal(history.canUndo.value,true)
  history.undo();await nextTick();assert.deepEqual(config.value,{enabled:false,serial:2,seed:9},'desfazer não devolve a série antiga')
 })
 scope.stop()
 // ---- Rascunhos duráveis -------------------------------------------------------------------
 const disk=new Map(),calls=[]
 globalThis.window={retroStudio:{retro:{async editorDraft(payload){calls.push(payload.action+':'+payload.editor+':'+payload.projectPath);const id=payload.projectPath+'|'+payload.editor
  if(payload.action==='read')return {draft:disk.get(id)||null}
  if(payload.action==='write'){disk.set(id,{savedAt:'2026-10-10T12:00:00.000Z',baseRevision:payload.baseRevision,state:payload.state});return {saved:true}}
  disk.delete(id);return {cleared:true}}}}}
 const drafts=new DurableDrafts('world',{delay:10})
 assert.equal(drafts.needsHydration('/A'),true);await drafts.hydrate('/A');assert.equal(drafts.get('/A'),undefined);assert.equal(drafts.needsHydration('/A'),false)
 drafts.set('/A',{config:{rooms:[1]},baseline:'{}',revision:'rev-1'});drafts.set('/A',{config:{rooms:[1,2]},baseline:'{}',revision:'rev-1'});await sleep(40)
 assert.deepEqual(disk.get('/A|world').state.config,{rooms:[1,2]});assert.equal(disk.get('/A|world').baseRevision,'rev-1')
 assert.equal(calls.filter(call=>call.startsWith('write')).length,1,'edições em sequência viram uma gravação')
 assert.equal(drafts.recoveredAt('/A'),'','rascunho desta sessão não é "recuperado"')
 // Outra sessão (processo reiniciado): o rascunho volta do disco e é identificado como recuperado.
 const next=new DurableDrafts('world',{delay:10});await next.hydrate('/A')
 assert.deepEqual(next.get('/A').config,{rooms:[1,2]});assert.notEqual(next.recoveredAt('/A'),'');await next.hydrate('/A');assert.equal(calls.filter(call=>call==='read:world:/A').length,2,'lido uma vez por sessão')
 // Projetos e editores isolados.
 assert.equal(next.get('/B'),undefined);await next.hydrate('/B');assert.equal(next.get('/B'),undefined)
 const other=new DurableDrafts('audio',{delay:10});await other.hydrate('/A');assert.equal(other.get('/A'),undefined)
 // Salvar/descartar apaga o rascunho também no disco.
 next.delete('/A');await sleep(40);assert.equal(disk.has('/A|world'),false);assert.equal(next.recoveredAt('/A'),'')
 // O mesmo editor aberto em dois lugares: a instância limpa não apaga o rascunho da outra.
 {const shared=new DurableDrafts('audio',{delay:5}),dialog=Symbol('diálogo'),dock=Symbol('painel')
  shared.set('/A',{config:{sujo:1},revision:'r'},dialog);assert.equal(shared.deleteIfOwner('/A',dock),false);assert.deepEqual(shared.get('/A').config,{sujo:1})
  shared.claim('/A',dock);assert.equal(shared.deleteIfOwner('/A',dialog),false,'quem carregou o rascunho passa a ser o dono');assert.equal(shared.deleteIfOwner('/A',dock),true);assert.equal(shared.get('/A'),undefined)
  // Exportar/descartar apaga do disco sem esperar o atraso (uma queda logo depois não o traz de volta).
  shared.set('/A',{config:{x:1}},dialog);await sleep(30);assert.ok(disk.has('/A|audio'));shared.delete('/A');await Promise.resolve();await sleep(1);assert.equal(disk.has('/A|audio'),false)}
 // Um rascunho em memória nunca é substituído pelo do disco; rascunho ilegível é ignorado.
 disk.set('/C|world',{savedAt:'x',baseRevision:null,state:{config:{disco:true}}});const local=new DurableDrafts('world',{delay:10});local.set('/C',{config:{memoria:true}});await local.hydrate('/C');assert.deepEqual(local.get('/C').config,{memoria:true})
 disk.set('/D|world',{unreadable:true});const broken=new DurableDrafts('world');await broken.hydrate('/D');assert.equal(broken.get('/D'),undefined)
 // Falha da ponte não derruba o editor.
 globalThis.window.retroStudio.retro.editorDraft=async()=>{throw Error('disco cheio')}
 const warned=[],warn=console.warn;console.warn=message=>warned.push(message)
 try{const failing=new DurableDrafts('world',{delay:5});failing.set('/E',{config:{}});await sleep(30);await failing.hydrate('/F');assert.ok(warned.some(message=>/disco cheio/.test(message)));assert.deepEqual(failing.get('/E'),{config:{}})}finally{console.warn=warn}
 // Sem ponte (testes, navegador): continua sendo só um Map.
 delete globalThis.window.retroStudio.retro.editorDraft
 const plain=new DurableDrafts('world',{delay:5});assert.equal(plain.needsHydration('/A'),false);plain.set('/A',{config:1});plain.delete('/A');await sleep(20);plain.clear();assert.equal(plain.size,0)
 // draftTimer: chama uma vez depois que as edições param; cancel evita a chamada.
 let fired=0;const timer=draftTimer(()=>fired++,15);timer.touch();timer.touch();timer.touch();await sleep(50);assert.equal(fired,1);timer.touch();timer.cancel();await sleep(40);assert.equal(fired,1)
 // ---- Mapa em edição -----------------------------------------------------------------------
 const source=fs.readFileSync(new URL('../src/composables/useTilemapEditorState.js',import.meta.url),'utf8')
 const block=source.slice(source.indexOf('    // #52: recuperação de um mapa editado e não salvo'),source.indexOf('    async function loadExisting()'))
 assert.ok(block.length>500)
 let tick=null,loadedWith=null
 // Um rascunho por mapa: cada caminho tem o seu armazenamento.
 const byMap=new Map(),askedFor=[],confirms=[]
 const storeFor=key=>{askedFor.push(key);if(!byMap.has(key)){const data=new Map();byMap.set(key,{data,needsHydration:()=>false,async hydrate(){},get:project=>data.get(project),set:(project,value)=>data.set(project,value),delete:project=>data.delete(project),recoveredAt:()=>'10/10/2026, 12:00:00'})}return byMap.get(key)}
 const stored=storeFor('maps/hall.tmx').data
 const context={ref,props:{projectPath:'/game'},currentMapPath:ref('/game/maps/hall.tmx'),savedMapSnapshot:ref('<map v="disco"/>'),loadingMap:ref(false),saving:ref(false),mapDirty:ref(false),mapDraftsFor:storeFor,window:{confirm:message=>{confirms.push(message);return confirmAnswer}},
  normalizeAssetPath:value=>String(value).replace(/\\/g,'/'),serializeMap:()=>context.live,setInterval:callback=>{tick=callback;return 1},clearInterval(){},onScopeDispose(){},
  async loadExistingContent(fullPath,draft){loadedWith=[fullPath,draft];return true},live:'<map v="disco"/>'}
 let confirmAnswer=true
 vm.createContext(context);vm.runInContext(block+'\nthis.api={mapRecovery,offerMapDraft,restoreMapDraft,discardMapDraft}',context)
 const {api}=context
 // Sem alterações: nenhum rascunho é escrito.
 tick();assert.equal(stored.size,0)
 // Editando: o TMX em edição vai para o rascunho; o mesmo conteúdo não é regravado.
 context.mapDirty.value=true;context.live='<map v="editado"/>';tick();assert.deepEqual(plainCopy(stored.get('/game')),{path:'maps/hall.tmx',tmx:'<map v="editado"/>'})
 const first=stored.get('/game');tick();assert.equal(stored.get('/game'),first)
 // Salvou: o rascunho some.
 context.mapDirty.value=false;tick();assert.equal(stored.size,0)
 // Durante carga ou gravação nada é escrito; mapa fora do projeto ou que não é TMX não gera rascunho.
 context.mapDirty.value=true;context.saving.value=true;tick();assert.equal(stored.size,0);context.saving.value=false
 context.currentMapPath.value='/outro/maps/x.tmx';tick();context.currentMapPath.value='/game/maps/a.json';tick();assert.equal(stored.size,0);context.currentMapPath.value='/game/maps/hall.tmx'
 // Reabrir depois de uma interrupção: rascunho diferente do disco é oferecido, não aplicado.
 stored.set('/game',{path:'maps/hall.tmx',tmx:'<map v="editado"/>'});context.mapDirty.value=false
 await api.offerMapDraft('/game/maps/hall.tmx');assert.deepEqual(plainCopy(api.mapRecovery.value),{path:'maps/hall.tmx',savedAt:'10/10/2026, 12:00:00'});assert.equal(loadedWith,null)
 tick();assert.equal(stored.get('/game').tmx,'<map v="editado"/>','enquanto a oferta está pendente o rascunho não é apagado nem reescrito')
 // Restaurar: o conteúdo do rascunho é carregado; a referência de "salvo" continua sendo o disco.
 assert.equal(await api.restoreMapDraft(),true);assert.deepEqual(plainCopy(loadedWith),['/game/maps/hall.tmx','<map v="editado"/>']);assert.equal(api.mapRecovery.value,null)
 assert.equal(context.savedMapSnapshot.value,'<map v="disco"/>');assert.equal(context.loadingMap.value,false)
 // Descartar: apaga o rascunho. Rascunho de outro mapa ou igual ao disco não é oferecido.
 await api.offerMapDraft('/game/maps/hall.tmx');api.discardMapDraft();assert.equal(stored.size,0);assert.equal(api.mapRecovery.value,null)
 // Outro mapa tem o próprio rascunho: abrir e editar o salão não toca o da caverna.
 storeFor('maps/cave.tmx').data.set('/game',{path:'maps/cave.tmx',tmx:'<caverna/>'});await api.offerMapDraft('/game/maps/hall.tmx');assert.equal(api.mapRecovery.value,null)
 context.mapDirty.value=true;context.live='<map v="salão editado"/>';tick();assert.equal(stored.get('/game').tmx,'<map v="salão editado"/>');assert.equal(storeFor('maps/cave.tmx').data.get('/game').tmx,'<caverna/>')
 context.currentMapPath.value='/game/maps/cave.tmx';context.savedMapSnapshot.value='<disco/>';context.mapDirty.value=false
 await api.offerMapDraft('/game/maps/cave.tmx');assert.equal(plainCopy(api.mapRecovery.value).path,'maps/cave.tmx')
 // Restaurar com edições novas na tela pede confirmação; recusar não muda nada.
 context.mapDirty.value=true;confirmAnswer=false;loadedWith=null;assert.equal(await api.restoreMapDraft(),false);assert.equal(loadedWith,null);assert.equal(confirms.length,1);assert.ok(api.mapRecovery.value)
 confirmAnswer=true;assert.equal(await api.restoreMapDraft(),true);assert.deepEqual(plainCopy(loadedWith),['/game/maps/cave.tmx','<caverna/>'])
 context.currentMapPath.value='/game/maps/hall.tmx';context.savedMapSnapshot.value='<map v="disco"/>';context.mapDirty.value=false;stored.clear()
 stored.set('/game',{path:'maps/hall.tmx',tmx:'<map v="disco"/>'});await api.offerMapDraft('/game/maps/hall.tmx');assert.equal(api.mapRecovery.value,null);assert.equal(stored.size,0,'rascunho igual ao disco é removido')
 loadedWith=null;assert.equal(await api.restoreMapDraft(),false);assert.equal(loadedWith,null)
 // Integração estática: os sete editores de configuração e os dois de autoria.
 for(const [file,drafts] of [['AudioEditor','audioDrafts'],['CameraEditor','cameraDrafts'],['ProgressEditor','progressDrafts'],['WorldGraphEditor','worldDrafts'],['MovementLab','movementDrafts'],['PaletteEditor','paletteDrafts']]){
  const text=fs.readFileSync(new URL('../src/components/retro/'+file+'.vue',import.meta.url),'utf8')
  assert.match(text,new RegExp(drafts+'\\.needsHydration\\(projectPath\\)'),file+' recupera rascunho');assert.match(text,/useDocumentUndo\(config,/,file+' tem desfazer');assert.match(text,/history\.undo\(\)/);assert.match(text,/draftSaver\.touch\(\)/,file+' grava rascunho enquanto edita')
 }
 assert.match(fs.readFileSync(new URL('../src/components/retro/DebugPanel.vue',import.meta.url),'utf8'),/useDocumentUndo\(config,/)
 const maker=fs.readFileSync(new URL('../src/components/retro/CharsetMaker.vue',import.meta.url),'utf8')
 assert.match(maker,/\(\) => \{ recordHistory\(\); scheduleCharsetProjectSave\(\) \}/);assert.match(maker,/if \(applyingHistory \|\| restoringProject\.value \|\| exporting\.value/,'aplicar histórico, restaurar e exportar não criam passos')
 assert.equal((maker.match(/resetHistory\(\)/g)||[]).length>=4,true,'abrir, duplicar e falhar ao abrir começam histórico novo')
}finally{if(old===undefined)delete globalThis.window;else globalThis.window=old}
console.log('Editor recovery: document undo/redo (steps, no loops, reload, keyboard), durable drafts (debounce, sessions, isolation, failures), map draft offer/restore/discard and editor integration passed.')
