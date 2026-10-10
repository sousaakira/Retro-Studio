// #52: rascunhos de sessão dos editores que também sobrevivem a um fechamento inesperado.
// Continua sendo um Map por projeto (como antes); cada alteração é espelhada, com atraso curto,
// em .retrostudio/drafts/<editor>.json pelo processo principal. Nenhum arquivo de autoria é
// escrito por aqui: o rascunho só volta ao editor, que mostra as alterações como não salvas.
const bridge=()=>globalThis.window?.retroStudio?.retro?.editorDraft
const stores=new Set()
/** Grava agora tudo o que estava esperando (fechamento da janela). */
export async function flushAllDrafts(){await Promise.all([...stores].flatMap(store=>[...store.timers.keys()].map(projectPath=>store.flush(projectPath))))}
export class DurableDrafts extends Map{
 constructor(editor,{delay=500}={}){super();this.editor=editor;this.delay=delay;this.timers=new Map();this.recovered=new Map();this.hydrated=new Set();this.owners=new Map();stores.add(this)}
 #persist(projectPath){
  clearTimeout(this.timers.get(projectPath))
  this.timers.set(projectPath,setTimeout(()=>{this.timers.delete(projectPath);void this.flush(projectPath)},this.delay))
 }
 /** Grava agora o que está no Map (ou apaga o arquivo se não há rascunho). */
 async flush(projectPath){
  clearTimeout(this.timers.get(projectPath));this.timers.delete(projectPath)
  const call=bridge();if(!call)return
  try{
   if(super.has(projectPath)){const state=super.get(projectPath);await call({action:'write',projectPath,editor:this.editor,baseRevision:typeof state?.revision==='string'?state.revision:null,state:JSON.parse(JSON.stringify(state))})}
   else await call({action:'clear',projectPath,editor:this.editor})
  }catch(error){console.warn('[drafts] '+this.editor+': '+error.message)}
 }
 /** owner: a instância do editor que escreveu (o mesmo editor pode estar aberto em dois lugares). */
 set(projectPath,state,owner=null){super.set(projectPath,state);this.owners.set(projectPath,owner);this.#persist(projectPath);return this}
 /** A instância passou a mostrar este rascunho (carregou-o): ela pode apagá-lo ao ficar limpa. */
 claim(projectPath,owner){if(super.has(projectPath))this.owners.set(projectPath,owner)}
 /** Exportado ou descartado de propósito: some da memória e, sem esperar, do disco. */
 delete(projectPath){const had=super.delete(projectPath);this.recovered.delete(projectPath);this.owners.delete(projectPath);void this.flush(projectPath);return had}
 /** Instância limpa: só apaga o rascunho que ela mesma escreveu ou carregou, nunca o de outra. */
 deleteIfOwner(projectPath,owner){return super.has(projectPath)&&this.owners.get(projectPath)===owner?this.delete(projectPath):false}
 clear(){for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();this.recovered.clear();this.hydrated.clear();this.owners.clear();super.clear()}
 /** Há algo a buscar no disco? (Evita uma espera à toa quando não há ponte ou já foi lido.) */
 needsHydration(projectPath){return !!projectPath&&!this.hydrated.has(projectPath)&&!!bridge()&&!super.has(projectPath)}
 /** Uma vez por projeto e sessão: traz do disco o rascunho de uma sessão anterior, se houver. */
 async hydrate(projectPath){
  if(!projectPath||this.hydrated.has(projectPath))return
  const call=bridge();if(!call||super.has(projectPath)){this.hydrated.add(projectPath);return}
  try{
   const draft=(await call({action:'read',projectPath,editor:this.editor}))?.draft
   if(draft&&!draft.unreadable&&draft.state&&typeof draft.state==='object'&&!Array.isArray(draft.state)&&!super.has(projectPath)){super.set(projectPath,draft.state);this.recovered.set(projectPath,draft.savedAt)}
   this.hydrated.add(projectPath) // só depois de uma leitura que deu certo; uma falha tenta de novo
  }catch(error){console.warn('[drafts] '+this.editor+': '+error.message)}
 }
 /** Data (texto legível) do rascunho recuperado de outra sessão que está em uso, ou ''. */
 recoveredAt(projectPath){
  const saved=this.recovered.get(projectPath);if(!saved||!super.has(projectPath))return ''
  const date=new Date(saved);return Number.isNaN(date.getTime())?'sessão anterior':date.toLocaleString('pt-BR')
 }
}
/** Chama `action` depois que as edições param por `delay` ms (rascunho contínuo enquanto se edita). */
export function draftTimer(action,delay=700){
 let timer=0
 return {touch(){clearTimeout(timer);timer=setTimeout(()=>{timer=0;action()},delay)},cancel(){clearTimeout(timer);timer=0}}
}
