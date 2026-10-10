// #50: actual Vue UI with memory-only IPC and generated tones, no game files or emulator.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {wavFixture} from './audio-fixtures.mjs'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-audio-ui-'))
const url=name=>JSON.stringify('/@fs/'+path.join(repository,name))
const tone=(hz,seconds)=>'data:audio/wav;base64,'+wavFixture({hz,seconds,rate:22050,bits:16}).toString('base64')
const media={'audio/music/caverna.ogg':tone(220,3),'audio/sfx/pulo.wav':tone(880,.25),'audio/sfx/golpe.wav':tone(0,.4),'audio/sfx/alarme.wav':tone(1200,1.5)}
fs.writeFileSync(path.join(temporary,'index.html'),`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Retro Studio · fixture de áudio</title></head><body><div id="app"></div><script type="module">
import {createApp,h,ref} from ${JSON.stringify('/@fs/'+fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js')))};
import AudioEditor from ${url('src/components/retro/AudioEditor.vue')};
import {createAudioConfiguration,validateAudioConfiguration,audioMusicRows,audioEffectRows} from ${url('shared/retro/audioConfiguration.js')};
import ${url('src/styles.css')};
const project=ref('/fixture/A'),configs=new Map(),calls=[],media=${JSON.stringify(media)};
window.__audioFixture={project,calls,failSave:false};
const rooms=[{id:'caverna',name:'Caverna'},{id:'arena',name:'Arena do chefe'},{id:'entrada',name:'Entrada'}];
const candidates=['audio/music/caverna.vgm','audio/music/chefe.vgm','audio/music/caverna.ogg','audio/sfx/pulo.wav','audio/sfx/golpe.wav','audio/sfx/alarme.wav'];
const initial=Object.assign(createAudioConfiguration(),{music:[{id:'caverna',name:'Caverna',source:'audio/music/caverna.vgm',preview:'audio/music/caverna.ogg',timing:'auto'},{id:'chefe',name:'Chefe',source:'audio/music/chefe.vgm',preview:'',timing:'ntsc'}],
 effects:[{id:'pulo',name:'Pulo',source:'audio/sfx/pulo.wav',priority:2,channel:0},{id:'golpe',name:'Golpe',source:'audio/sfx/golpe.wav',priority:8,channel:0},{id:'alarme',name:'Alarme',source:'audio/sfx/alarme.wav',priority:12,channel:3}],rooms:[{room:'caverna',music:'caverna'},{room:'arena',music:'chefe'}]});
const report=config=>{const entries=[...audioMusicRows(config).map(r=>({kind:'music',id:r.id,index:r.index,source:r.source,exists:true,bytes:18432,romBytes:18432})),...audioEffectRows(config).map(r=>({kind:'effect',id:r.id,index:r.index,source:r.source,exists:r.id!=='golpe',bytes:9044,romBytes:r.id==='alarme'?21248:4352,rate:r.id==='alarme'?22050:14000,channels:r.id==='alarme'?2:1,bits:r.id==='alarme'?16:8,seconds:r.id==='alarme'?1.5:.3}))];
 const issues=[{severity:'error',code:'missing-source',message:'Efeito “golpe”: arquivo original não encontrado (audio/sfx/golpe.wav).'},{severity:'error',code:'invalid-resource-type',message:'res/resources.res:4: o rescomp não tem o tipo SOUND; use XGM para música e WAV para efeitos, ou cadastre o arquivo neste catálogo.'},{severity:'warning',code:'cutscene-vocabulary',message:'Cutscenes: som “porta” usa o valor SFX_DOOR, que não é um número nem uma macro deste catálogo.'},{severity:'info',code:'no-preview',message:'Música “chefe”: sem prévia. A IDE não sintetiza VGM; indique um .ogg, .wav ou .mp3 renderizado para ouvir no editor.'},{severity:'info',code:'wav-converted',message:'Efeito “alarme”: 22050 Hz, 2 canal(is), 16 bits será convertido para 14000 Hz mono 8 bits.'}];
 return {driver:{id:'xgm',name:'XGM (SGDK 1.81)',musicFormats:['.vgm','.xgm'],effectFormats:['.wav'],previewFormats:['.ogg','.wav','.mp3'],pcmChannels:4,effectChannels:config.effectChannels,sampleRate:14000,maxEffects:192,toolkit:{xgm:true,xgm2:false}},entries,romBytes:entries.reduce((n,e)=>n+e.romBytes,0),issues,errors:2}};
const status=(config,revision)=>({config,revision,exported:true,rooms,worldError:'',outputConflicts:[],candidates,report:report(config)});
window.retroStudio={retro:{async audioConfiguration({projectPath,draft}){if(draft)return {revision:'fixture',candidates,report:report(draft)};return structuredClone(configs.get(projectPath)||status(initial,'fixture'))},
 async saveAudioConfiguration(payload){calls.push(structuredClone(payload));if(window.__audioFixture.failSave)throw Error('Fixture: disk unavailable');validateAudioConfiguration(payload.config,{rooms:rooms.map(r=>r.id)});const result={success:true,...status(structuredClone(payload.config),'fixture-'+calls.length)};configs.set(payload.projectPath,result);return result},
 async getAssetPreview(_project,file){return media[file]?{success:true,preview:media[file]}:{success:false,error:'Arquivo não encontrado'}}}};
createApp({render:()=>h(AudioEditor,{projectPath:project.value,onClose:()=>document.body.setAttribute('data-closed','true')})}).mount('#app');
</script></body></html>`)
const server=await createServer({configFile:false,root:temporary,resolve:{alias:{vue:fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js'))}},plugins:[vue()],server:{host:'127.0.0.1',port:5183,strictPort:true,fs:{allow:[repository,temporary]}}})
await server.listen();console.log('Audio fixture: http://127.0.0.1:5183 (memory only)')
let closing=false
async function close(){if(closing)return;closing=true;await server.close();fs.rmSync(temporary,{recursive:true,force:true});process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
