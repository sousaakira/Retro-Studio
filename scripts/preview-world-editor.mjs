// #55: actual Vue UI with memory-only IPC, no game files or emulator.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-world-ui-'))
const url=name=>JSON.stringify('/@fs/'+path.join(repository,name))
fs.writeFileSync(path.join(temporary,'index.html'),`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Retro Studio · fixture do mundo</title></head><body><div id="app"></div><script type="module">
import {createApp,h,ref} from ${JSON.stringify('/@fs/'+fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js')))};
import WorldGraphEditor from ${url('src/components/retro/WorldGraphEditor.vue')};
import {createWorldConfiguration,validateWorldConfiguration} from ${url('shared/retro/worldConfiguration.js')};
import ${url('src/styles.css')};
const project=ref('/fixture/A'),configs=new Map(),calls=[];
window.__worldFixture={project,calls,failSave:false};
const catalog={maps:[{path:'maps/entrada.tmx',width:320,height:224},{path:'maps/caverna.tmx',width:640,height:224}],errors:[],truncated:false};
window.retroStudio={retro:{async worldConfiguration({projectPath}){return structuredClone(configs.get(projectPath)||{config:createWorldConfiguration(),revision:'fixture',headerConflict:false,catalog})},async saveWorldConfiguration(payload){calls.push(structuredClone(payload));if(window.__worldFixture.failSave)throw Error('Fixture: disk unavailable');validateWorldConfiguration(payload.config);const result={success:true,config:structuredClone(payload.config),revision:'fixture-'+calls.length,headerConflict:false,catalog};configs.set(payload.projectPath,result);return result;}}};
createApp({render:()=>h(WorldGraphEditor,{projectPath:project.value,onClose:()=>document.body.setAttribute('data-closed','true')})}).mount('#app');
</script></body></html>`)
const server=await createServer({configFile:false,root:temporary,resolve:{alias:{vue:fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js'))}},plugins:[vue()],server:{host:'127.0.0.1',port:5179,strictPort:true,fs:{allow:[repository,temporary]}}})
await server.listen();console.log('World fixture: http://127.0.0.1:5179 (memory only)')
let closing=false
async function close(){if(closing)return;closing=true;await server.close();fs.rmSync(temporary,{recursive:true,force:true});process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
