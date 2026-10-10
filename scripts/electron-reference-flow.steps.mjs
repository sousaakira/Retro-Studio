// Developer tool (#45): reference flow create → edit → build → problems → play in the REAL IDE.
//   E_PROJECTS=<empty scratch folder> E_NAME=<new project name> \
//     scripts/inspect-electron.sh <isolated-home> scripts/electron-reference-flow.steps.mjs <out-dir>
// The isolated home needs .retrostudio/ui-settings.json (toolkitPath) and emulator-config.json.
// Creates a NEW project under E_PROJECTS; it never opens or changes an existing game.
import fs from 'node:fs';import path from 'node:path'
const BASE=process.env.E_PROJECTS,NAME=process.env.E_NAME||'fluxo-referencia',ROOT=path.join(BASE||'',NAME)
if(!BASE||!fs.existsSync(BASE)||fs.existsSync(ROOT))throw Error('E_PROJECTS must be an existing scratch folder and E_NAME a project that does not exist yet.')
export default async ({evaluate,screenshot,desktop,key,type,wait,waitFor})=>{
 const click=(selector,text)=>evaluate(`(()=>{const list=[...document.querySelectorAll(${JSON.stringify(selector)})];const el=${text?`list.find(e=>(e.title||e.getAttribute('aria-label')||e.textContent).trim().startsWith(${JSON.stringify(text)}))`:'list[0]'};if(!el)return 'AUSENTE: ${selector} ${text||''}';el.click();return 'ok'})()`)
 const text=selector=>evaluate(`(document.querySelector(${JSON.stringify(selector)})?.innerText||'AUSENTE').replace(/\\s+/g,' ').slice(0,700)`)
 const set=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return 'AUSENTE';el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return 'ok'})()`)
 const toolbar=label=>click('nav.workspace-toolbar button',label)
 const mode=()=>evaluate(`[...document.querySelectorAll('nav.workspace-toolbar button[aria-pressed="true"]')].map(b=>b.textContent.trim()).join(',')`)
 // 1. Criar: o modal real; o campo de pasta (preenchido pelo seletor nativo na IDE) recebe o caminho direto.
 console.log('novo projeto:',await click('button','Novo Projeto Retro'));await wait(800)
 console.log('modelos:',await evaluate(`[...document.querySelectorAll('.form-select option')].map(o=>o.value+'='+o.textContent.trim()).join(' | ')`))
 await set('.form-input:not([readonly])',NAME);await set('.form-input[readonly]',BASE)
 const starter=await evaluate(`[...document.querySelectorAll('.form-select option')].find(o=>/starter|inicial/i.test(o.value+o.textContent))?.value||''`)
 if(starter)await set('.form-select',starter)
 await screenshot('02-novo-projeto');console.log('criar:',await click('.btn-create'))
 await waitFor(`!!document.querySelector('nav.workspace-toolbar')`,90000,'workspace aberto')
 await wait(2500);console.log('projeto em disco:',fs.existsSync(path.join(ROOT,'retro-studio.json')),'| barra:',await text('nav.workspace-toolbar'))
 await screenshot('03-workspace-codigo')
 // 2. Modos por atalho: Alt+5 abre Executar.
 await key('5','Digit5',1,53);await wait(1500)
 console.log('modo após Alt+5:',await mode(),'| foco:',await evaluate(`document.activeElement?.id||document.activeElement?.tagName`))
 console.log('EXECUTAR:',await text('section.run'));await screenshot('04-modo-executar')
 const building=()=>evaluate(`!!document.querySelector('nav.workspace-toolbar .workspace-progress')`)
 const build=async label=>{console.log(label,await toolbar('Construir'));await wait(1500);await waitFor(`!document.querySelector('nav.workspace-toolbar .workspace-progress')`,300000,'fim do build');await wait(1500)}
 // 3. Editar: Alt+1, abrir src/main.c pela árvore, digitar no Monaco e salvar com Ctrl+S.
 await key('1','Digit1',1,49);await wait(800);console.log('modo após Alt+1:',await mode())
 const node=async name=>{const r=await evaluate(`(()=>{const el=[...document.querySelectorAll('.tree-name')].find(e=>e.textContent.trim()===${JSON.stringify(name)});if(!el)return 'AUSENTE';const row=el.closest('.tree-row'),twistie=row.querySelector('.tree-twistie');if(twistie&&!twistie.classList.contains('tree-twistie--expanded'))twistie.click();else if(!twistie)row.click();return 'ok'})()`);await wait(1200);return r}
 if(await evaluate(`![...document.querySelectorAll('.tree-name')].some(e=>e.textContent.trim()==='src')`))console.log('expandir raiz:',await node(NAME))
 console.log('abrir pasta src:',await node('src'));console.log('abrir main.c:',await node('main.c'));await wait(2000)
 const main=path.join(ROOT,'src','main.c'),original=fs.readFileSync(main,'utf8')
 console.log('aba ativa:',await evaluate(`document.querySelector('.tab.active, .editor-tab.active, [class*="tab"][class*="active"]')?.textContent.trim().slice(0,40)`))
 await evaluate(`(()=>{const area=document.querySelector('.monaco-editor textarea');area?.focus();return !!area})()`)
 await key('Home','Home',2,36);await wait(200);await type('/* editado na IDE real */\n');await wait(600)
 await key('s','KeyS',2,83);await wait(1500)
 const edited=fs.readFileSync(main,'utf8');console.log('salvo em disco com a edição:',edited.startsWith('/* editado na IDE real */')&&edited.endsWith(original.slice(-200)))
 await screenshot('05-codigo-editado')
 // 4. Construir pela barra (persistente em qualquer modo) e conferir no modo Executar.
 await build('construir:')
 const rom=path.join(ROOT,'out','rom.bin');console.log('ROM:',fs.existsSync(rom)&&fs.statSync(rom).size)
 await key('5','Digit5',1,53);await wait(2500);console.log('EXECUTAR após build:',await text('section.run'));await screenshot('06-executar-apos-build')
 // 5. Erro proposital: o painel inferior abre em Problemas; clicar leva ao arquivo.
 fs.writeFileSync(main,edited.replace('/* editado na IDE real */','/* editado na IDE real */\nint erro_proposital = ;'))
 console.log('construir com erro:',await toolbar('Construir'))
 for(let i=0;i<12;i++){await wait(2500);const s=await evaluate(`JSON.stringify({progresso:document.querySelector('nav.workspace-toolbar .workspace-progress')?.textContent||null,construirDesabilitado:[...document.querySelectorAll('nav.workspace-toolbar button')].find(b=>b.textContent.trim()==='Construir').disabled,problemas:document.querySelector('#dock-tab-problems')?.textContent.trim(),avisos:[...document.querySelectorAll('[class*=toast]')].map(e=>e.textContent.trim().slice(0,90)).filter(Boolean).slice(0,2)})`);console.log(' t+'+((i+1)*2.5)+'s',s);if(/"progresso":null/.test(s)&&i>1)break}
 console.log('painel inferior:',await evaluate(`(()=>{const d=document.querySelector('.bottom-dock');return d&&getComputedStyle(d).display!=='none'?[...d.querySelectorAll('[role=tab]')].map(t=>t.textContent.trim()+(t.getAttribute('aria-selected')==='true'?'*':'')).join(' | '):'FECHADO'})()`))
 console.log('PROBLEMAS (dock):',await text('#dock-panel-problems'));console.log('PROBLEMAS (Executar):',await text('section.run section:last-of-type'))
 await screenshot('07-problemas')
 console.log('abrir erro:',await click('section.run .link'));await wait(1500);console.log('modo após clicar no erro:',await mode(),'| aba:',await evaluate(`document.querySelector('[class*="tab"][class*="active"]')?.textContent.trim().slice(0,40)`))
 fs.writeFileSync(main,edited);await build('construir corrigido:')
 console.log('problemas depois de corrigir:',await text('#dock-panel-problems'))
 // 6. Painel inferior por contexto, em cada modo.
 const dock=async()=>evaluate(`[...document.querySelectorAll('.bottom-dock [role=tab]')].map(t=>t.textContent.trim()).join(' | ')`)
 const context=async()=>{await evaluate(`document.querySelector('#dock-tab-context')?.click()`);await wait(1800);return text('#dock-panel-context')}
 console.log('dock em Código:',await dock())
 await key('3','Digit3',1,51);await wait(2500);console.log('modo:',await mode(),'| dock:',await dock(),'| contexto vazio:',await evaluate(`getComputedStyle(document.querySelector('#workspace-dock-timeline'),'::before').content.slice(0,60)`))
 await context()
 console.log('personagens do projeto:',await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>/Selecione um personagem/.test(o.textContent)));if(!s)return 'sem lista';const o=[...s.options].filter(o=>o.value);if(!o.length)return 'nenhum';s.value=o[0].value;s.dispatchEvent(new Event('change',{bubbles:true}));return o.map(x=>x.textContent.trim()).join(', ')})()`));await wait(3500)
 await evaluate(`document.querySelector('.movement-select')?.click()`);await wait(1200)
 console.log('linha do tempo no painel inferior:',await evaluate(`(()=>{const host=document.querySelector('#workspace-dock-timeline'),t=host?.querySelector('.animation-timeline');return t?'sim · '+t.querySelectorAll('.timeline-frame').length+' quadros · no editor: '+document.querySelectorAll('.charset-window .animation-timeline').length:'não ('+document.querySelectorAll('.animation-timeline').length+' no editor)'})()`))
 await screenshot('08-personagens-linha-do-tempo')
 // Autoria fora do código: mudar o FPS do movimento na linha do tempo, exportar o personagem e construir.
 const header=path.join(ROOT,'src','hero_animations.h'),headerBefore=fs.existsSync(header)?fs.readFileSync(header,'utf8'):''
 console.log('FPS do movimento → 4:',await evaluate(`(()=>{const input=[...document.querySelectorAll('#workspace-dock-timeline input[type=number]')][0];if(!input)return 'sem campo';input.value=4;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return 'ok'})()`));await wait(1500)
 console.log('personagem salvo sozinho:',/"fps": 4/.test(fs.readFileSync(path.join(ROOT,'charsets','hero.charset.json'),'utf8')))
 console.log('exportar personagem:',await evaluate(`(()=>{const b=[...document.querySelectorAll('.charset-window button')].find(b=>/Exportar para SGDK/.test(b.textContent));if(!b||b.disabled)return 'indisponível';b.click();return 'ok'})()`));await wait(4000)
 console.log('header do personagem mudou:',fs.existsSync(header)&&fs.readFileSync(header,'utf8')!==headerBefore)
 await build('construir com o personagem editado:');console.log('ROM após a edição do personagem:',fs.existsSync(rom)&&fs.statSync(rom).size)
 await evaluate(`document.querySelector('#dock-tab-terminal')?.click()`);await wait(800)
 console.log('ao sair da aba, a linha do tempo volta ao editor:',await evaluate(`document.querySelectorAll('.charset-window .animation-timeline').length+' no editor, '+document.querySelectorAll('#workspace-dock-timeline .animation-timeline').length+' no painel'`))
 await key('2','Digit2',1,50);await wait(4000);console.log('modo:',await mode(),'| dock:',await dock(),'| contexto:',(await context()).slice(0,200));await screenshot('09-mapas-audio')
 await key('4','Digit4',1,52);await wait(3000);console.log('modo:',await mode(),'| dock:',await dock())
 await key('5','Digit5',1,53);await wait(2000);console.log('modo:',await mode(),'| dock:',await dock(),'| contexto:',(await context()).slice(0,200));await screenshot('10-executar-diagnostico')
 // Setas trocam de aba no painel inferior (teclado).
 await evaluate(`document.querySelector('#dock-tab-context')?.focus()`);await key('ArrowLeft','ArrowLeft',0,37);await wait(300)
 console.log('aba após seta à esquerda:',await evaluate(`document.querySelector('.bottom-dock [role=tab][aria-selected=true]')?.textContent.trim()+' | foco: '+document.activeElement?.id`))
 // 7. Jogar: o emulador abre; Parar encerra.
 console.log('jogar:',await toolbar('Jogar'));await wait(12000)
 await waitFor(`/emulador/.test(document.querySelector('section.run .status')?.textContent||'')`,240000,'jogo em execução');await wait(6000)
 console.log('estado:',await text('section.run .status'),'| Construir desabilitado:',await evaluate(`[...document.querySelectorAll('nav.workspace-toolbar button')].find(b=>b.textContent.trim()==='Construir').disabled`));desktop('11-jogando-desktop')
 console.log('parar:',await toolbar('Parar'));await wait(3000);console.log('estado após parar:',await text('section.run .status'));desktop('12-apos-parar-desktop')
 // 8. Restaurar layout e recolher painéis continuam na barra.
 console.log('painel lateral:',await toolbar('Painel lateral'),await evaluate(`getComputedStyle(document.querySelector('.app').children[1]).display`),await toolbar('Painel lateral'))
 await screenshot('13-final')
}
