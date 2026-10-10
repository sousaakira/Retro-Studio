// #52: histórico por documento — passos, fusão de sequências rápidas, limite, estado gravado.
import assert from 'node:assert/strict'
import {createDocumentHistory} from '../shared/retro/documentHistory.js'
const doc=(value,selected=0)=>({value,list:[value],selected})
const history=createDocumentHistory({limit:5,coalesceMs:400,key:state=>JSON.stringify([state.value,state.list])})
assert.deepEqual([history.canUndo(),history.canRedo(),history.undo(),history.redo(),history.isSaved()],[false,false,null,null,false])
history.reset(doc('a'));assert.deepEqual([history.size(),history.isSaved(),history.canUndo()],[1,true,false])
// Edições espaçadas viram passos separados; desfazer e refazer devolvem cópias.
assert.equal(history.record(doc('b'),{now:1000}),true);assert.equal(history.record(doc('c'),{now:2000}),true);assert.equal(history.isSaved(),false)
const undone=history.undo();assert.deepEqual(undone,doc('b'));undone.list.push('alterado por fora');assert.deepEqual(history.current(),doc('b'),'o histórico não compartilha objetos com o editor')
assert.deepEqual(history.undo(),doc('a'));assert.equal(history.isSaved(),true,'voltar ao passo gravado é estar salvo');assert.equal(history.undo(),null)
assert.deepEqual(history.redo(),doc('b'));assert.deepEqual(history.redo(),doc('c'));assert.equal(history.redo(),null)
// Editar depois de desfazer descarta o ramo refeito.
history.undo();history.record(doc('d'),{now:9000});assert.equal(history.canRedo(),false);assert.deepEqual(history.undo(),doc('b'))
// Sequência rápida (digitar, arrastar): um passo só, e o estado anterior à sequência continua alcançável.
history.reset(doc('x'))
for(const [value,now] of [['x1',100],['x12',200],['x123',350],['x1234',700]])history.record(doc(value),{now})
assert.equal(history.size(),2);assert.deepEqual(history.current(),doc('x1234'));assert.deepEqual(history.undo(),doc('x'))
history.redo();history.record(doc('y'),{now:5000});assert.equal(history.size(),3,'pausa maior que a janela abre um passo novo')
// Depois de desfazer/refazer, a edição seguinte nunca se funde com o passo restaurado.
history.reset(doc('p'));history.record(doc('q'),{now:10});history.undo();history.redo();history.record(doc('r'),{now:20});assert.equal(history.size(),3);assert.deepEqual(history.undo(),doc('q'))
// Salvar no meio de uma sequência: o passo gravado não é reescrito pela edição seguinte.
history.reset(doc('s'));history.record(doc('s1'),{now:10});history.markSaved();history.record(doc('s2'),{now:20})
assert.equal(history.isSaved(),false);assert.deepEqual(history.undo(),doc('s1'));assert.equal(history.isSaved(),true)
// merge:false força um passo (ações discretas como remover um item logo após digitar).
history.reset(doc('m'));history.record(doc('m1'),{now:10});history.record(doc('m2'),{now:20,merge:false});assert.equal(history.size(),3)
// Só seleção mudou: nenhum passo novo, mas a seleção fica guardada no passo corrente.
history.reset(doc('k',0));assert.equal(history.record(doc('k',3),{now:10}),false);assert.equal(history.size(),1);history.record(doc('k2',3),{now:1000});assert.deepEqual(history.undo(),doc('k',3))
// Limite: os passos mais antigos saem; o marcador de gravado acompanha ou se perde.
history.reset(doc(0));for(let i=1;i<=10;i++)history.record(doc(i),{now:i*1000})
assert.equal(history.size(),5);let steps=0;while(history.undo())steps++;assert.equal(steps,4);assert.deepEqual(history.current(),doc(6));assert.equal(history.isSaved(),false,'o passo gravado saiu do histórico')
history.reset(doc(0),{isSaved:false});assert.equal(history.isSaved(),false);history.markSaved();assert.equal(history.isSaved(),true)
// Recarregar do disco ou trocar de documento: nada do documento anterior pode ser desfeito sobre o novo.
history.record(doc('edit'),{now:1});history.reset(doc('outro documento'));assert.deepEqual([history.canUndo(),history.canRedo(),history.size()],[false,false,1])
// Primeiro registro sem reset (editor criado vazio): vira o estado inicial, não gravado.
const empty=createDocumentHistory();assert.equal(empty.record({a:1}),true);assert.deepEqual([empty.size(),empty.isSaved(),empty.canUndo()],[1,false,false])
console.log('Document history: steps, copies, redo branch, rapid-sequence merge, saved marker, selection-only changes, limit and document switch passed.')
