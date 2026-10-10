// Developer tool (#52): undo/redo of a character and draft recovery, in the REAL IDE.
//   E_PROJECTS=<empty scratch folder> E_NAME=<new project name> \
//     scripts/inspect-electron.sh <isolated-home> scripts/electron-undo-recovery.steps.mjs <out-dir>
import fs from 'node:fs';import path from 'node:path'
const BASE=process.env.E_PROJECTS,NAME=process.env.E_NAME||'desfazer',ROOT=path.join(BASE||'',NAME)
if(!BASE||!fs.existsSync(BASE)||fs.existsSync(ROOT))throw Error('E_PROJECTS must be an existing scratch folder and E_NAME a project that does not exist yet.')
export default async ({evaluate,screenshot,key,wait,waitFor})=>{
 const set=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return 'ok'})()`)
 const button=(scope,label)=>evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(b=>(b.title||b.textContent).trim().startsWith(${JSON.stringify(label)}));if(!b)return 'AUSENTE '+${JSON.stringify(label)};if(b.disabled)return 'desabilitado';b.click();return 'ok'})()`)
 const saved=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'charsets','hero.charset.json'),'utf8'))
 const view=()=>evaluate(`JSON.stringify({movimentos:[...document.querySelectorAll('.movement-select')].map(b=>b.title),fps:document.querySelector('.animation-timeline input[type=number]')?.value,quadros:document.querySelectorAll('.animation-timeline .timeline-frame').length,estado:document.querySelector('.charset-kicker')?.textContent.replace(/\\s+/g,' ').trim(),desfazer:!document.querySelector('.history-buttons button').disabled,refazer:!document.querySelectorAll('.history-buttons button')[1].disabled})`)
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.title==='Novo Projeto Retro').click()`);await wait(800)
 await set('.form-input:not([readonly])',NAME);await set('.form-input[readonly]',BASE);await set('.form-select','sgdk-starter')
 await evaluate(`document.querySelector('.btn-create').click()`);await waitFor(`!!document.querySelector('nav.workspace-toolbar')`,90000,'workspace');await wait(2500)
 await key('3','Digit3',1,51);await wait(2500)
 await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>/Selecione um personagem/.test(o.textContent)));const o=[...s.options].filter(o=>o.value);s.value=o[0].value;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(3500)
 await evaluate(`document.querySelector('.movement-select')?.click()`);await wait(1200)
 console.log('aberto:',await view())
 // 1. Tempo: FPS 8 → 3.
 await set('.animation-timeline input[type=number]','3');await wait(1500);console.log('FPS 3:',await view(),'| disco fps:',saved().animations[0].fps)
 // 2. Quadro: duplicar.
 console.log('duplicar quadro:',await button('.animation-timeline','Duplicar quadro'));await wait(1500);console.log('3 quadros:',await view(),'| disco:',saved().animations[0].frameCount)
 // 3. Remoção: apagar o segundo movimento.
 console.log('remover movimento:',await evaluate(`(()=>{const entry=document.querySelectorAll('.movement-entry')[1];const b=[...entry.querySelectorAll('button')].find(b=>/Remover|Excluir|×/.test((b.title||b.getAttribute('aria-label')||b.textContent)));if(!b)return 'AUSENTE: '+[...entry.querySelectorAll('button')].map(b=>b.title||b.getAttribute('aria-label')||b.textContent.trim()).join('|');b.click();return 'ok'})()`));await wait(1500)
 console.log('sem walk:',await view(),'| disco:',saved().animations.map(a=>a.name).join(','))
 await screenshot('u1-depois-das-edicoes')
 // Desfazer três vezes: botão, depois Ctrl+Z com o foco em um botão do editor.
 console.log('desfazer (botão):',await button('.history-buttons','Desfazer'));await wait(1500);console.log(' →',await view(),'| disco:',saved().animations.map(a=>a.name).join(','))
 await evaluate(`document.querySelector('.history-buttons button').focus()`);await key('z','KeyZ',2,90);await wait(1500);console.log('Ctrl+Z →',await view(),'| disco quadros:',saved().animations[0].frameCount)
 await key('z','KeyZ',2,90);await wait(1500);console.log('Ctrl+Z →',await view(),'| disco fps:',saved().animations[0].fps)
 await key('z','KeyZ',2,90);await wait(800);console.log('Ctrl+Z no início (nada a desfazer) →',await view())
 // Refazer tudo: Ctrl+Shift+Z e Ctrl+Y.
 await key('z','KeyZ',10,90);await wait(1200);await key('y','KeyY',2,89);await wait(1200);await key('y','KeyY',2,89);await wait(1500)
 console.log('refeito →',await view(),'| disco:',saved().animations.map(a=>a.name).join(','),saved().animations[0].fps,saved().animations[0].frameCount)
 // Estabilidade: histórico e salvamento não se realimentam.
 const before=await view(),bytes=fs.readFileSync(path.join(ROOT,'charsets','hero.charset.json'),'utf8'),mtime=fs.statSync(path.join(ROOT,'charsets','hero.charset.json')).mtimeMs
 await wait(4000);console.log('parado por 4 s: mesma tela:',before===await view(),'| mesmo arquivo:',bytes===fs.readFileSync(path.join(ROOT,'charsets','hero.charset.json'),'utf8'),'| sem regravar:',mtime===fs.statSync(path.join(ROOT,'charsets','hero.charset.json')).mtimeMs)
 // Campo de texto mantém o próprio desfazer: Ctrl+Z com foco no nome do personagem não mexe no documento.
 await evaluate(`document.querySelector('.character-name input').focus()`);await key('z','KeyZ',2,90);await wait(800);console.log('Ctrl+Z em campo de texto → documento intacto:',before===await view())
 await screenshot('u2-refeito')
 // Exportar e depois desfazer: os arquivos exportados continuam sendo deste personagem.
 const exportNow=async()=>{const r=await button('.charset-window','Exportar para SGDK');await wait(4000);return r+' → '+(await evaluate(`[...document.querySelectorAll('[class*=toast]')].map(e=>e.textContent.trim().slice(0,110)).filter(t=>t.length>3).slice(-1)[0]||'sem aviso'`))}
 console.log('exportar:',await exportNow(),'| registrado:',saved().exportedFileName)
 await evaluate(`document.querySelectorAll('.movement-select')[1]?.click()`);await wait(800);await evaluate(`document.querySelector('.movement-select')?.click()`);await wait(800)
 console.log('selecionar não cria passo → desfazer continua apontando para a edição anterior:',await view())
 await evaluate(`document.querySelector('.history-buttons button').focus()`);await key('z','KeyZ',2,90);await wait(1500)
 console.log('desfeito depois de exportar → registro de exportação preservado:',saved().exportedFileName,saved().exportedHeaderName)
 console.log('exportar de novo:',await exportNow())
 // Recuperação de rascunho: paletas editadas e não exportadas; a janela é recarregada sem aviso.
 await key('1','Digit1',1,49);await wait(800)
 console.log('recursos:',await evaluate(`(()=>{const b=[...document.querySelectorAll('nav.workspace-toolbar button')].find(b=>b.textContent.trim()==='Recursos');b.click();return 'ok'})()`));await wait(1500)
 console.log('runtime:',await button('.app','Runtime'));await wait(1200);console.log('paletas:',await button('body','Paletas e composição'));await wait(2500)
 console.log('editar cor:',await evaluate(`(()=>{const s=document.querySelector('dialog.palette-dialog button[aria-label^="PAL1 cor 3"]');if(!s)return 'AUSENTE';s.click();return 'ok'})()`));await wait(300)
 await evaluate(`(()=>{const r=document.querySelectorAll('dialog.palette-dialog .mixer input[type=range]')[0];r.value=7;r.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(2500)
 const draftFile=path.join(ROOT,'.retrostudio','drafts','palettes.json')
 console.log('rascunho em disco:',fs.existsSync(draftFile)&&JSON.parse(fs.readFileSync(draftFile,'utf8')).state.config.palettes[1].colors[3],'| paletas exportadas:',fs.existsSync(path.join(ROOT,'palettes','palettes.json')))
 console.log('desfazer na paleta:',await button('dialog.palette-dialog','Desfazer'));await wait(1200);console.log(' cor depois de desfazer:',await evaluate(`document.querySelector('dialog.palette-dialog button[aria-label^="PAL1 cor 3"]').getAttribute('aria-label')`))
 console.log('refazer na paleta:',await button('dialog.palette-dialog','Refazer'));await wait(2000);console.log(' cor depois de refazer:',await evaluate(`document.querySelector('dialog.palette-dialog button[aria-label^="PAL1 cor 3"]').getAttribute('aria-label')`))
 await screenshot('u3-paleta-editada')
 console.log('recarregando a janela (interrupção)…');await evaluate(`setTimeout(()=>location.reload(),50)`);await wait(6000)
 await waitFor(`!!document.querySelector('#root')?.children.length`,30000,'recarregada');await wait(2500)
 console.log('projeto reaberto sozinho:',await evaluate(`!!document.querySelector('nav.workspace-toolbar')`))
 console.log('recursos:',await evaluate(`(()=>{const b=[...document.querySelectorAll('nav.workspace-toolbar button')].find(b=>b.textContent.trim()==='Recursos');b.click();return 'ok'})()`));await wait(1500)
 console.log('runtime:',await button('.app','Runtime'));await wait(1200);console.log('paletas:',await button('body','Paletas e composição'));await wait(3000)
 console.log('depois da interrupção:',await evaluate(`JSON.stringify({cor:document.querySelector('dialog.palette-dialog button[aria-label^="PAL1 cor 3"]')?.getAttribute('aria-label'),aviso:[...document.querySelectorAll('dialog.palette-dialog .notice')].map(e=>e.textContent.trim()).find(t=>/recuperad/.test(t))||null,rodape:document.querySelector('dialog.palette-dialog footer small')?.textContent.trim()})`))
 await screenshot('u4-rascunho-recuperado')
 console.log('descartar e recarregar:',await button('dialog.palette-dialog','Descartar e recarregar'));await wait(2500)
 console.log('depois de descartar:',await evaluate(`document.querySelector('dialog.palette-dialog button[aria-label^="PAL1 cor 3"]')?.getAttribute('aria-label')`),'| rascunho em disco:',fs.existsSync(draftFile),'| paletas exportadas:',fs.existsSync(path.join(ROOT,'palettes','palettes.json')))
}
