// #52: histórico de desfazer/refazer de UM documento, por fotografias do estado.
// - Só entra no histórico o que o editor informa com record(): recarregar do disco, trocar de
//   documento ou aplicar o próprio desfazer não criam passos (reset/undo/redo devolvem o estado
//   e quem aplica não chama record enquanto aplica).
// - Mudanças em sequência rápida (digitar, arrastar um controle) viram um passo só.
// - Salvar não mexe no histórico; markSaved só diz qual passo está gravado.
const clone=value=>JSON.parse(JSON.stringify(value))
/**
 * key(state): texto que identifica o CONTEÚDO do documento. Campos que não fazem parte dele
 * (seleção, aba aberta) ficam fora da chave: mudá-los não cria passo, mas são restaurados
 * junto com o passo em que estavam.
 */
export function createDocumentHistory({limit=100,coalesceMs=400,key=state=>JSON.stringify(state)}={}){
 let steps=[],index=-1,saved=-1,lastRecord=-Infinity,lastWasCoalesced=false
 const current=()=>index>=0?steps[index]:null
 return {
  /** Novo documento (aberto, recarregado, trocado): o histórico anterior não se aplica a ele. */
  reset(state,{isSaved=true}={}){steps=[{key:key(state),state:clone(state)}];index=0;saved=isSaved?0:-1;lastRecord=-Infinity;lastWasCoalesced=false},
  /** Estado depois de uma edição do usuário. Devolve true quando criou ou atualizou um passo. */
  record(state,{now=Date.now(),merge=true}={}){
   if(index<0){this.reset(state,{isSaved:false});return true}
   const nextKey=key(state)
   if(nextKey===steps[index].key){steps[index].state=clone(state);return false} // só seleção/visão mudou
   const fresh={key:nextKey,state:clone(state)}
   // Sequência rápida: substitui o passo corrente, que nasceu nesta mesma sequência (o estado
   // anterior a ela continua logo abaixo). Nunca funde por cima do passo gravado.
   if(merge&&lastWasCoalesced&&now-lastRecord<coalesceMs&&index>0&&index!==saved&&index===steps.length-1){steps[index]=fresh;lastRecord=now;return true}
   steps=steps.slice(0,index+1);steps.push(fresh)
   if(saved>index)saved=-1
   if(steps.length>limit){const drop=steps.length-limit;steps=steps.slice(drop);saved=saved>=drop?saved-drop:-1}
   index=steps.length-1;lastRecord=now;lastWasCoalesced=true
   return true
  },
  canUndo:()=>index>0,canRedo:()=>index>=0&&index<steps.length-1,
  /** Devolve o estado a aplicar, ou null. Quem aplica não deve chamar record durante a aplicação. */
  undo(){if(index<=0)return null;index--;lastWasCoalesced=false;return clone(steps[index].state)},
  redo(){if(index<0||index>=steps.length-1)return null;index++;lastWasCoalesced=false;return clone(steps[index].state)},
  /** O estado corrente acabou de ser gravado com sucesso. */
  markSaved(){saved=index;lastWasCoalesced=false},
  isSaved:()=>index>=0&&index===saved,
  size:()=>steps.length,position:()=>index,current:()=>current()?clone(current().state):null
 }
}
