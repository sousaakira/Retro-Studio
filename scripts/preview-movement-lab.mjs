// Isolated browser fixture with in-memory IPC; no game files are read/written.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const repository=fileURLToPath(new URL('../',import.meta.url))
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-movement-ui-'))
const url=name=>JSON.stringify('/@fs/'+path.join(repository,name))
fs.writeFileSync(path.join(temporary,'index.html'),`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Retro Studio · fixture de física</title></head><body><div id="app"></div><script type="module">
import {createApp,h,ref} from ${JSON.stringify('/@fs/'+fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js')))};
import MovementLab from ${url('src/components/retro/MovementLab.vue')};
import {createMovementConfiguration} from ${url('shared/retro/movementConfiguration.js')};
import ${url('src/styles.css')};
const project=ref('/fixture/A');const configs=new Map();const calls=[];
window.__labFixture={project,calls,diagnosticCalls:[],failSave:false,failBuild:false,failOpen:false};
window.retroStudio={retro:{
async buildMovementDiagnostic(payload){window.__labFixture.diagnosticCalls.push({kind:'build',...payload});if(window.__labFixture.failBuild)throw Error('Fixture: compiler unavailable');return {success:true,token:'fixture-rom',revision:payload.revision};},
async openMovementDiagnostic(payload){window.__labFixture.diagnosticCalls.push({kind:'open',...payload});return window.__labFixture.failOpen?{success:false,message:'Fixture: emulator unavailable'}:{success:true,message:'Fixture: emulator launch simulated'};},
async movementConfiguration({projectPath}){return structuredClone(configs.get(projectPath)||{config:createMovementConfiguration(),revision:'fixture',headerConflict:false})},
async saveMovementConfiguration(payload){calls.push(structuredClone(payload));if(window.__labFixture.failSave)throw Error('Fixture: disk unavailable');const result={success:true,config:structuredClone(payload.config),revision:'fixture-'+calls.length,headerConflict:false};configs.set(payload.projectPath,result);return result;}
}};
createApp({render:()=>h(MovementLab,{projectPath:project.value,onClose:()=>document.body.setAttribute('data-closed','true')})}).mount('#app');
</script></body></html>`)
const server=await createServer({configFile:false,root:temporary,resolve:{alias:{vue:fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js'))}},plugins:[vue()],server:{host:'127.0.0.1',port:5178,strictPort:true,fs:{allow:[repository,temporary]}}})
await server.listen();console.log('Movement fixture: http://127.0.0.1:5178 (memory only)')
let closing=false
async function close(){if(closing)return;closing=true;await server.close();fs.rmSync(temporary,{recursive:true,force:true});process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
