// Developer tool (#64): ROM debugging in the REAL IDE with the real BlastEm.
//   E_PROJECTS=<empty scratch folder> E_NAME=<new project name> \
//     scripts/inspect-electron.sh <isolated-home> scripts/electron-debugger.steps.mjs <out-dir>
// Under Xvfb BlastEm opens a blocking "vsync" box; this script confirms it with xdotool.
import fs from 'node:fs';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process'
const BASE=process.env.E_PROJECTS,NAME=process.env.E_NAME||'depurar',ROOT=path.join(BASE||'',NAME)
if(!BASE||!fs.existsSync(BASE)||fs.existsSync(ROOT))throw Error('E_PROJECTS must be an existing scratch folder and E_NAME a project that does not exist yet.')
export default async ({evaluate,screenshot,desktop,key,wait,waitFor})=>{
 const set=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value})()`)
 const button=label=>evaluate(`(()=>{const b=[...document.querySelectorAll('.debugger button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)}));if(!b)return 'AUSENTE '+${JSON.stringify(label)};if(b.disabled)return 'DESABILITADO '+${JSON.stringify(label)};b.click();return 'ok'})()`)
 const text=selector=>evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(e=>e.textContent.replace(/\\s+/g,' ').trim()).join(' | ')`)
 const buttons=()=>evaluate(`[...document.querySelectorAll('.debugger .actions button')].map(b=>b.textContent.trim()+(b.disabled?' [desabilitado]':'')).join(' · ')`)
 // Confirma a caixa do BlastEm: ela fica no centro da tela virtual de 1440x900 e o botão OK em (719,339).
 const confirmBox=()=>spawn('sh',['-c','for i in 1 2 3 4 5 6 7 8; do sleep 1; xdotool mousemove 719 339 click 1; done'],{stdio:'ignore'})
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.title==='Novo Projeto Retro').click()`);await wait(800)
 await set('.form-input:not([readonly])',NAME);await set('.form-input[readonly]',BASE);await set('.form-select','sgdk-starter')
 await evaluate(`document.querySelector('.btn-create').click()`);await waitFor(`!!document.querySelector('nav.workspace-toolbar')`,90000,'workspace');await wait(2500)
 await key('5','Digit5',1,53);await waitFor(`!!document.querySelector('.debugger')`,15000,'depurador no modo Executar');await wait(1500)
 console.log('1. capacidades (BlastEm nativo):',await text('.debugger .capabilities li'))
 console.log('   notas:',await text('.debugger .notes li'))
 await set('#rom-debug-backend','gen_sdl2');await wait(400)
 console.log('2. capacidades (Genesis Plus GX):',await text('.debugger .capabilities li'));console.log('   notas:',await text('.debugger .notes li'));console.log('   ações:',await buttons())
 await set('#rom-debug-backend','blastem-gdb');await wait(400);console.log('   capacidades (BlastEm GDB):',await text('.debugger .capabilities li'))
 await set('#rom-debug-backend',process.env.E_BACKEND||'blastem-native');await wait(400)
 console.log('3. sem ROM:',await text('.debugger .game'),'| ações:',await buttons())
 await screenshot('d1-sem-rom')
 console.log('4. construir para depurar:',await button('Construir para depurar'))
 await waitFor(`/Jogo construído para depurar/.test(document.querySelector('.debugger')?.textContent||'')||!!document.querySelector('.debugger [role=alert]')||/NUNCA/.test(document.querySelector('.debugger')?.textContent||'')`,240000,'build de depuração');await wait(1500)
 console.log('   jogo:',await text('.debugger .game'));console.log('   tipo registrado:',fs.readFileSync(path.join(ROOT,'.retrostudio/build-flavor.json'),'utf8').trim(),'| ROM:',fs.statSync(path.join(ROOT,'out/rom.bin')).size,'bytes')
 const box=confirmBox()
 console.log('5. iniciar:',await button('Iniciar depuração'))
 await waitFor(`/Parado \\(/.test(document.querySelector('.debugger')?.textContent||'')||!!document.querySelector('.debugger [role=alert]')`,30000,'sessão parada');await wait(800)
 console.log('   estado:',await text('.debugger [role=status]'),'| alertas:',await text('.debugger [role=alert]'));console.log('   registros:',await text('.debugger .registers div'))
 await desktop('d2-desktop-emulador-parado');await screenshot('d2-parado-no-inicio')
 await set('#rom-debug-breakpoint','main');console.log('6. breakpoint em main:',await button('Adicionar'));await wait(1200);console.log('   lista:',await text('.debugger .rows li'))
 await set('#rom-debug-breakpoint','nao_existe');await button('Adicionar');await wait(800);console.log('   breakpoint inválido →',await text('.debugger [role=alert]'))
 console.log('7. continuar:',await button('Continuar'));await waitFor(`/Parado \\(breakpoint\\)/.test(document.querySelector('.debugger')?.textContent||'')`,30000,'parada em main');await wait(800)
 console.log('   estado:',await text('.debugger [role=status]'))
 await set('#rom-debug-memory','0x100');await set('#rom-debug-length','32');console.log('8. memória 0x100:',await button('Ler'));await wait(1200);console.log('  ',await text('.debugger .dump'))
 await set('#rom-debug-memory','0xC00000');await button('Ler');await wait(1000);console.log('   0xC00000 →',await text('.debugger [role=alert]'))
 await set('#rom-debug-memory','0xFF0000');await set('#rom-debug-length','16');await button('Ler');await wait(1000);console.log('   RAM 0xFF0000 →',await text('.debugger .dump'),'|',await text('.debugger .dump + .help, .debugger p.help'))
 if(await evaluate(`!!document.querySelector('#rom-debug-frames')`)){
  console.log('8b. ler o VDP:',await button('Ler o VDP'));await wait(1500);console.log('   registros:',await text('.debugger table.vdp tbody tr'));console.log('   interno:',await text('.debugger .vdp ~ dl.registers div'))
  console.log('   KDebug:',(await text('.debugger pre.dump:last-of-type')).slice(0,300))
 }
 await evaluate(`document.querySelector('.debugger .actions').scrollIntoView({block:'start'})`);await wait(500);await screenshot('d3-parado-em-main')
 console.log('9. abrir linha de C:',await evaluate(`(()=>{const b=document.querySelector('.debugger [role=status] button.link');if(!b)return 'SEM LINK';const label=b.textContent;b.click();return label})()`));await wait(3000)
 console.log('   editor:',await evaluate(`JSON.stringify({modo:document.querySelector('nav.workspace-toolbar [aria-pressed=true],nav.workspace-toolbar .active')?.textContent.trim(),aba:document.querySelector('.tab.active,.editor-tab.active')?.textContent.trim(),posicao:document.querySelector('.status-bar,footer')?.textContent.match(/Ln \\d+, Col \\d+/)?.[0]||[...document.querySelectorAll('*')].find(e=>!e.children.length&&/^Ln \\d+, Col \\d+$/.test(e.textContent.trim()))?.textContent.trim(),linhasVisiveis:[...document.querySelectorAll('.monaco-editor .line-numbers')].map(e=>Number(e.textContent)).sort((a,b)=>a-b).filter((v,i,l)=>i===0||i===l.length-1)})`))
 await screenshot('d4-codigo-na-linha')
 await key('5','Digit5',1,53);await wait(1500)
 if(await evaluate(`!!document.querySelector('#rom-debug-frames')`)){await set('#rom-debug-frames','90');console.log('9b. avançar 90 quadros:',await button('Avançar quadros'));await waitFor(`/Parado \\(fim dos quadros\\)/.test(document.querySelector('.debugger')?.textContent||'')`,30000,'fim dos quadros');console.log('   estado:',await text('.debugger [role=status]'));await button('Ler o VDP');await wait(1500);console.log('   sprites:',await text('.debugger table.vdp:last-of-type tbody tr'));await evaluate(`[...document.querySelectorAll('.debugger h4')].find(h=>h.textContent==='VDP').scrollIntoView({block:'start'})`);await wait(400);await desktop('d4b-vdp-apos-90-quadros')}
 console.log('10. passo:',await button('Passo'));await wait(1500);console.log('   estado:',await text('.debugger [role=status]'))
 const removed=await evaluate(`(()=>{const b=document.querySelector('.debugger .rows li button:not(.link)');if(!b)return 'AUSENTE';b.click();return 'ok'})()`);await wait(1000)
 console.log('11. remover breakpoint:',removed,'| continuar sem breakpoint:',await button('Continuar'));await wait(600);console.log('   aviso antes de rodar:',await text('.debugger [role=alert]'),'| estado:',(await text('.debugger [role=status]')).slice(0,60));console.log('   confirmar:',await button('Continuar mesmo assim'));await wait(2500)
 console.log('   estado:',await text('.debugger [role=status]'));console.log('   ações:',await buttons())
 await evaluate(`document.querySelector('.debugger .actions').scrollIntoView({block:'start'})`);await wait(400);await desktop('d5-desktop-jogo-rodando')
 // O usuário fecha o emulador: só o BlastEm iniciado por este Electron (filho dele) é encerrado.
 const pid=execFileSync('sh',['-c','pgrep -f "blastem -[dD] '+path.join(ROOT,'out/rom.bin')+'" | head -1']).toString().trim()
 console.log('12. fechar o emulador por fora (pid '+pid+')');if(pid)process.kill(Number(pid));await wait(2000)
 console.log('   alerta:',await text('.debugger [role=alert]'),'| ações:',await buttons())
 await screenshot('d6-emulador-fechado');box.kill()
}
