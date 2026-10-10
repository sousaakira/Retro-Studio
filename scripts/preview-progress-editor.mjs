// #60: actual Vue UI with memory-only IPC, no game files or emulator.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-progress-ui-'))
const url=name=>JSON.stringify('/@fs/'+path.join(repository,name))
fs.writeFileSync(path.join(temporary,'index.html'),`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Retro Studio · fixture de progresso</title></head><body><div id="app"></div><script type="module">
import {createApp,h,ref} from ${JSON.stringify('/@fs/'+fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js')))};
import ProgressEditor from ${url('src/components/retro/ProgressEditor.vue')};
import {createProgressConfiguration,validateProgressConfiguration,progressCompatibility,progressMemory} from ${url('shared/retro/progressConfiguration.js')};
import ${url('src/styles.css')};
const project=ref('/fixture/A'),configs=new Map(),calls=[];
window.__progressFixture={project,calls,failSave:false,romHeader:true};
const initial=createProgressConfiguration();
Object.assign(initial,{flagCapacity:16,dataSize:8,flags:[{id:'key',name:'Chave da caverna',bit:0},{id:'boss',name:'Chefe derrotado',bit:1},{id:'door',name:'Porta aberta',bit:4}],
 fields:[{id:'coins',name:'Moedas',offset:0,bytes:2},{id:'lives',name:'Vidas',offset:2,bytes:1},{id:'score',name:'Pontuação',offset:4,bytes:4}],sram:{enabled:true,slots:2,offset:0,size:8192}});
const status=(config,revision)=>({config,revision,exported:true,memory:progressMemory(config),romHeaderDeclaresSram:window.__progressFixture.romHeader,headerConflict:false});
window.retroStudio={retro:{async progressConfiguration({projectPath}){return structuredClone(configs.get(projectPath)||status(initial,'fixture'))},async saveProgressConfiguration(payload){calls.push(structuredClone(payload));if(window.__progressFixture.failSave)throw Error('Fixture: disk unavailable');validateProgressConfiguration(payload.config);progressCompatibility((configs.get(payload.projectPath)||status(initial)).config,payload.config,{allowDroppedSchemas:payload.allowDroppedSchemas});const result={success:true,...status(structuredClone(payload.config),'fixture-'+calls.length)};configs.set(payload.projectPath,result);return result;}}};
createApp({render:()=>h(ProgressEditor,{projectPath:project.value,onClose:()=>document.body.setAttribute('data-closed','true')})}).mount('#app');
</script></body></html>`)
const server=await createServer({configFile:false,root:temporary,resolve:{alias:{vue:fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js'))}},plugins:[vue()],server:{host:'127.0.0.1',port:5182,strictPort:true,fs:{allow:[repository,temporary]}}})
await server.listen();console.log('Progress fixture: http://127.0.0.1:5182 (memory only)')
let closing=false
async function close(){if(closing)return;closing=true;await server.close();fs.rmSync(temporary,{recursive:true,force:true});process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
