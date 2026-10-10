// #59: actual Vue UI with memory-only IPC, no game files or emulator.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-camera-ui-'))
const url=name=>JSON.stringify('/@fs/'+path.join(repository,name))
fs.writeFileSync(path.join(temporary,'index.html'),`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Retro Studio · fixture da câmera</title></head><body><div id="app"></div><script type="module">
import {createApp,h,ref} from ${JSON.stringify('/@fs/'+fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js')))};
import CameraEditor from ${url('src/components/retro/CameraEditor.vue')};
import {createCameraConfiguration,validateCameraConfiguration} from ${url('shared/retro/cameraConfiguration.js')};
import ${url('src/styles.css')};
const project=ref('/fixture/A'),configs=new Map(),calls=[];
window.__cameraFixture={project,calls,failSave:false};
const rooms=[{id:'caverna',name:'Caverna',width:1280,height:448,entries:[{id:'spawn',x:100,y:200,facing:false}]},{id:'entrada',name:'Entrada',width:320,height:224,entries:[{id:'spawn',x:40,y:180,facing:false}]}];
const sizes=Object.fromEntries(rooms.map(r=>[r.id,{width:r.width,height:r.height}]));
const initial=createCameraConfiguration();
initial.rooms=[{id:'caverna',regions:[
 {id:'corredor',name:'Corredor alto',area:{x:320,y:0,width:320,height:448},limits:{x:320,y:0,width:320,height:224},priority:1,lock:false,transitionSpeed:2},
 {id:'arena',name:'Arena do chefe',area:{x:800,y:0,width:160,height:448},limits:{x:720,y:0,width:320,height:224},priority:3,lock:true,transitionSpeed:4}]}];
window.retroStudio={retro:{async cameraConfiguration({projectPath}){return structuredClone(configs.get(projectPath)||{config:initial,revision:'fixture',headerConflict:false,rooms,worldError:''})},async saveCameraConfiguration(payload){calls.push(structuredClone(payload));if(window.__cameraFixture.failSave)throw Error('Fixture: disk unavailable');validateCameraConfiguration(payload.config,{rooms:sizes});const result={success:true,config:structuredClone(payload.config),revision:'fixture-'+calls.length,headerConflict:false,rooms,worldError:''};configs.set(payload.projectPath,result);return result;}}};
createApp({render:()=>h(CameraEditor,{projectPath:project.value,onClose:()=>document.body.setAttribute('data-closed','true')})}).mount('#app');
</script></body></html>`)
const server=await createServer({configFile:false,root:temporary,resolve:{alias:{vue:fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js'))}},plugins:[vue()],server:{host:'127.0.0.1',port:5181,strictPort:true,fs:{allow:[repository,temporary]}}})
await server.listen();console.log('Camera fixture: http://127.0.0.1:5181 (memory only)')
let closing=false
async function close(){if(closing)return;closing=true;await server.close();fs.rmSync(temporary,{recursive:true,force:true});process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
