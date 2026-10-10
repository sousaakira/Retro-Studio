// Developer tool (#39): character library in the REAL IDE — open, duplicate, independence of the copy.
//   E_PROJECTS=<empty scratch folder> E_NAME=<new project name> \
//     scripts/inspect-electron.sh <isolated-home> scripts/electron-character-library.steps.mjs <out-dir>
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto'
const BASE=process.env.E_PROJECTS,NAME=process.env.E_NAME||'biblioteca',ROOT=path.join(BASE||'',NAME)
if(!BASE||!fs.existsSync(BASE)||fs.existsSync(ROOT))throw Error('E_PROJECTS must be an existing scratch folder and E_NAME a project that does not exist yet.')
export default async ({evaluate,screenshot,key,wait,waitFor})=>{
 const set=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value})()`)
 const library=()=>evaluate(`JSON.stringify((()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>/Selecione um personagem/.test(o.textContent)));return {opcoes:[...s.options].filter(o=>o.value).map(o=>o.textContent.trim()),atual:s.selectedOptions[0]?.textContent.trim()}})())`)
 const files=()=>fs.readdirSync(path.join(ROOT,'charsets')).filter(name=>name.endsWith('.json')).sort()
 const hash=file=>createHash('sha1').update(fs.readFileSync(path.join(ROOT,file))).digest('hex').slice(0,12)
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.title==='Novo Projeto Retro').click()`);await wait(800)
 await set('.form-input:not([readonly])',NAME);await set('.form-input[readonly]',BASE);await set('.form-select','sgdk-starter')
 await evaluate(`document.querySelector('.btn-create').click()`);await waitFor(`!!document.querySelector('nav.workspace-toolbar')`,90000,'workspace');await wait(2500)
 await key('3','Digit3',1,51);await wait(2500)
 console.log('1. biblioteca ao abrir:',await library(),'| arquivos:',files().join(', '))
 await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>/Selecione um personagem/.test(o.textContent)));const o=[...s.options].filter(o=>o.value);s.value=o[0].value;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(3500)
 const original=files()[0],before=JSON.parse(fs.readFileSync(path.join(ROOT,'charsets',original),'utf8')),sheet=before.exportedFileName||before.sourceFile?.name
 const protectedFiles=['charsets/'+original,...fs.readdirSync(path.join(ROOT,'res')).filter(name=>/hero/.test(name)).map(name=>'res/'+name)],hashes=Object.fromEntries(protectedFiles.map(file=>[file,hash(file)]))
 console.log('2. aberto:',await library(),'| personagem:',before.characterName,'| animações:',before.animations.length,'| exportado como:',before.exportedFileName,before.exportedResourceName,before.exportedHeaderName)
 console.log('3. duplicar:',await evaluate(`(()=>{const b=[...document.querySelectorAll('button.cm-button')].find(b=>/Duplicar/.test(b.textContent)||/Duplicar/.test(b.title||''));if(!b)return 'AUSENTE';if(b.disabled)return 'DESABILITADO';b.click();return 'ok'})()`));await wait(4000)
 const after=files(),copyFile=after.find(name=>name!==original),copy=copyFile?JSON.parse(fs.readFileSync(path.join(ROOT,'charsets',copyFile),'utf8')):null
 console.log('   biblioteca:',await library(),'| arquivos:',after.join(', '))
 console.log('   cópia:',copy&&{nome:copy.characterName,animacoes:copy.animations.length,mesmaFolha:JSON.stringify(copy.sourceFile?.path||copy.sourceFile?.name)===JSON.stringify(before.sourceFile?.path||before.sourceFile?.name),exportadoComo:[copy.exportedFileName,copy.exportedResourceName,copy.exportedHeaderName]})
 console.log('   original e recursos exportados intactos:',protectedFiles.every(file=>hash(file)===hashes[file]),'| folha:',sheet)
 // Editar a cópia não mexe no original: FPS da primeira animação.
 await set('.animation-timeline input[type=number]','3');await wait(2000)
 const copyNow=JSON.parse(fs.readFileSync(path.join(ROOT,'charsets',copyFile),'utf8')),originalNow=JSON.parse(fs.readFileSync(path.join(ROOT,'charsets',original),'utf8'))
 console.log('4. FPS na cópia:',copyNow.animations[0].fps,'| no original:',originalNow.animations[0].fps,'| original intacto:',hash('charsets/'+original)===hashes['charsets/'+original])
 await screenshot('c1-copia-editada')
 // Voltar ao original pela biblioteca.
 await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>/Selecione um personagem/.test(o.textContent)));const o=[...s.options].find(o=>o.value&&o.value.endsWith(${JSON.stringify(original)}));s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(3000)
 console.log('5. reaberto o original:',await library(),'| FPS mostrado:',await evaluate(`document.querySelector('.animation-timeline input[type=number]')?.value`))
}
