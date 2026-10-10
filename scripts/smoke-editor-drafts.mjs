// #52: rascunhos dos editores dentro do projeto e gravação atômica de arquivos de texto.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {readEditorDraft,writeEditorDraft,clearEditorDraft} from '../electron/retro/editorDrafts.js'
import {writeTextFileAtomically} from '../electron/retro/atomicText.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-drafts-'))
try{
 const root=path.join(temporary,'game');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'retro-studio.json'),'{}')
 assert.equal(readEditorDraft(root,'palettes'),null);assert.ok(!fs.existsSync(path.join(root,'.retrostudio')),'ler não cria nada')
 writeEditorDraft(root,'palettes',{baseRevision:'rev-1',state:{backdrop:3,list:[1,2]}})
 const draft=readEditorDraft(root,'palettes');assert.deepEqual([draft.baseRevision,draft.state],['rev-1',{backdrop:3,list:[1,2]}]);assert.ok(!Number.isNaN(Date.parse(draft.savedAt)))
 writeEditorDraft(root,'palettes',{baseRevision:null,state:'texto'});assert.deepEqual([readEditorDraft(root,'palettes').baseRevision,readEditorDraft(root,'palettes').state],[null,'texto'])
 assert.deepEqual(fs.readdirSync(path.join(root,'.retrostudio','drafts')).sort(),['.gitignore','palettes.json'],'nenhum temporário fica para trás')
 assert.equal(fs.readFileSync(path.join(root,'.retrostudio','drafts','.gitignore'),'utf8'),'*\n','rascunhos são locais: a pasta se ignora no Git, em qualquer projeto')
 writeEditorDraft(root,'audio',{state:{a:1}});assert.equal(readEditorDraft(root,'palettes').state,'texto','um editor não toca o rascunho do outro')
 clearEditorDraft(root,'palettes');assert.equal(readEditorDraft(root,'palettes'),null);clearEditorDraft(root,'palettes');assert.deepEqual(readEditorDraft(root,'audio').state,{a:1})
 // Recusas: nomes, tamanho, estado ausente.
 for(const name of ['../x','a/b','A','','x'.repeat(40),'.oculto',null])assert.throws(()=>writeEditorDraft(root,name,{state:1}),/Invalid draft name/,String(name))
 assert.throws(()=>writeEditorDraft(root,'big',{state:'x'.repeat(1024*1024)}),/1 MiB/)
 // Mapas grandes (256×256, duas camadas ≈ 1,5 MiB de TMX) cabem; o limite deles é 4 MiB.
 writeEditorDraft(root,'map-0a1b2c3d',{state:{path:'maps/a.tmx',tmx:'x'.repeat(1600*1024)}});assert.equal(readEditorDraft(root,'map-0a1b2c3d').state.tmx.length,1600*1024)
 assert.throws(()=>writeEditorDraft(root,'map-0a1b2c3d',{state:{tmx:'x'.repeat(4*1024*1024)}}),/4 MiB/);clearEditorDraft(root,'map-0a1b2c3d')
assert.throws(()=>writeEditorDraft(root,'none',{}),/Invalid draft/)
 assert.throws(()=>writeEditorDraft(root,'rev',{state:1,baseRevision:7}),/Invalid draft/);assert.equal(readEditorDraft(root,'big'),null)
 // Rascunho ilegível ou de outro editor é informado, nunca interpretado.
 fs.writeFileSync(path.join(root,'.retrostudio','drafts','camera.json'),'{metade');assert.deepEqual(readEditorDraft(root,'camera'),{unreadable:true})
 fs.writeFileSync(path.join(root,'.retrostudio','drafts','camera.json'),JSON.stringify({version:1,editor:'audio',savedAt:'x',baseRevision:null,state:1}));assert.deepEqual(readEditorDraft(root,'camera'),{unreadable:true})
 // Pasta de rascunhos que é link (ou arquivo) não redireciona escrita nem leitura.
 const linked=path.join(temporary,'linked'),outside=path.join(temporary,'outside');fs.mkdirSync(path.join(linked,'.retrostudio'),{recursive:true});fs.mkdirSync(outside)
 fs.symlinkSync(outside,path.join(linked,'.retrostudio','drafts'))
 assert.throws(()=>writeEditorDraft(linked,'audio',{state:1}),/regular directory/);assert.throws(()=>readEditorDraft(linked,'audio'),/regular directory/);assert.deepEqual(fs.readdirSync(outside),[])
 const blocked=path.join(temporary,'blocked');fs.mkdirSync(blocked);fs.writeFileSync(path.join(blocked,'.retrostudio'),'arquivo');assert.throws(()=>writeEditorDraft(blocked,'audio',{state:1}),/regular directory/)
 // Texto: substituição em um passo; falha deixa o arquivo anterior intacto e sem temporários.
 const file=path.join(root,'src.c');fs.writeFileSync(file,'antigo\n',{mode:0o640})
 await writeTextFileAtomically(file,'novo conteúdo\n');assert.equal(fs.readFileSync(file,'utf8'),'novo conteúdo\n');assert.equal(fs.statSync(file).mode&0o777,0o640,'permissões preservadas')
 await writeTextFileAtomically(path.join(root,'novo.txt'),'criado');assert.equal(fs.readFileSync(path.join(root,'novo.txt'),'utf8'),'criado')
 await assert.rejects(writeTextFileAtomically(path.join(root,'sem-pasta','x.txt'),'x'));assert.ok(!fs.existsSync(path.join(root,'sem-pasta')))
 fs.mkdirSync(path.join(root,'dir-alvo'));await assert.rejects(writeTextFileAtomically(path.join(root,'dir-alvo'),'x'));assert.ok(fs.statSync(path.join(root,'dir-alvo')).isDirectory())
 assert.deepEqual(fs.readdirSync(root).filter(name=>name.endsWith('.tmp')),[]);assert.equal(fs.readFileSync(file,'utf8'),'novo conteúdo\n')
 // Revisão da #52: o que uma gravação simples faria continua valendo.
 // Somente leitura: recusado, conteúdo intacto.
 const readonly=path.join(root,'ro.txt');fs.writeFileSync(readonly,'protegido',{mode:0o444})
 if(process.getuid?.()!==0){await assert.rejects(writeTextFileAtomically(readonly,'x'),/EACCES/);assert.equal(fs.readFileSync(readonly,'utf8'),'protegido')}
 // Link físico: os dois nomes veem o conteúdo novo.
 const hardA=path.join(root,'hard-a.txt'),hardB=path.join(root,'hard-b.txt');fs.writeFileSync(hardA,'1');fs.linkSync(hardA,hardB)
 await writeTextFileAtomically(hardA,'2');assert.equal(fs.readFileSync(hardB,'utf8'),'2');assert.equal(fs.statSync(hardA).nlink,2)
 // Link simbólico pendente continua link; o arquivo apontado é criado.
 const dangling=path.join(root,'pendente.txt');fs.symlinkSync('alvo-novo.txt',dangling)
 await writeTextFileAtomically(dangling,'criado pelo link');assert.ok(fs.lstatSync(dangling).isSymbolicLink());assert.equal(fs.readFileSync(path.join(root,'alvo-novo.txt'),'utf8'),'criado pelo link')
 // Pasta somente leitura com arquivo gravável: salva no lugar (não dá para criar temporário ao lado).
 if(process.getuid?.()!==0){const locked=path.join(root,'pasta-ro');fs.mkdirSync(locked);const inner=path.join(locked,'a.txt');fs.writeFileSync(inner,'antes');fs.chmodSync(locked,0o555)
  try{await writeTextFileAtomically(inner,'depois');assert.equal(fs.readFileSync(inner,'utf8'),'depois')}finally{fs.chmodSync(locked,0o755)}}
 // Arquivo aberto por link continua sendo link; o conteúdo vai para o alvo.
 const real=path.join(root,'real.txt'),link=path.join(root,'link.txt');fs.writeFileSync(real,'a');fs.symlinkSync(real,link)
 await writeTextFileAtomically(link,'b');assert.ok(fs.lstatSync(link).isSymbolicLink());assert.equal(fs.readFileSync(real,'utf8'),'b')
 const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8')
 assert.ok(main.includes('await writeTextFileAtomically(resolved, contents)')&&!/await fs\.writeFile\(resolved, contents, 'utf8'\)/.test(main),'salvar texto pela IDE é atômico')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Editor drafts: per-editor files, atomic replace, refusals, unreadable drafts, link confinement; atomic text saves with permissions, failures and links passed.')
