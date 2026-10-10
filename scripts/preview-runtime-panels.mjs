// #53/#56/#61/#63: actual Vue panels with memory-only IPC. ?panel=toolchain, cutscenes, debug or input.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-panels-ui-'))
const url=name=>JSON.stringify('/@fs/'+path.join(repository,name))
// Optional: --hardware-report <file.json> shows a real report (see docs/HARDWARE_REPORT.md).
const reportFlag=process.argv.indexOf('--hardware-report'),hardwareReport=reportFlag>=0?fs.readFileSync(process.argv[reportFlag+1],'utf8'):'null'
// Optional: --asset-report <file.json> shows a real inspectProjectAssets() result in ?panel=assets (#42).
// Optional: --palette-fixture <file.json> = {status, images:{path:dataUrl}} for ?panel=palettes (#57).
const paletteFlag=process.argv.indexOf('--palette-fixture'),paletteFixture=paletteFlag>=0?fs.readFileSync(process.argv[paletteFlag+1],'utf8'):'null'
const assetFlag=process.argv.indexOf('--asset-report'),assetReport=assetFlag>=0?fs.readFileSync(process.argv[assetFlag+1],'utf8'):'null'
fs.writeFileSync(path.join(temporary,'index.html'),`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Retro Studio · fixture de painéis</title></head><body><div id="app"></div><script type="module">
import {createApp,h} from ${JSON.stringify('/@fs/'+fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js')))};
import ToolchainPanel from ${url('src/components/retro/ToolchainPanel.vue')};
import CutsceneAdapterPanel from ${url('src/components/retro/CutsceneAdapterPanel.vue')};
import DebugPanel from ${url('src/components/retro/DebugPanel.vue')};
import InputActionsEditor from ${url('src/components/retro/InputActionsEditor.vue')};
import ExportOverviewPanel from ${url('src/components/retro/ExportOverviewPanel.vue')};
import HardwareReport from ${url('src/components/retro/HardwareReport.vue')};
import AssetsManager from ${url('src/components/retro/AssetsManager.vue')};
import PaletteEditor from ${url('src/components/retro/PaletteEditor.vue')};
import HudEditor from ${url('src/components/retro/HudEditor.vue')};
import {createHudConfiguration,validateHudConfiguration} from ${url('shared/retro/hudConfiguration.js')};
import {HUD_SAMPLE_FONT} from ${url('shared/retro/hudSampleFont.js')};
import {createI18n} from ${JSON.stringify('/@fs/'+fileURLToPath(import.meta.resolve('vue-i18n/dist/vue-i18n.esm-bundler.js')))};
import messages from ${url('src/locales/pt-BR.json')};
import {createInputConfiguration,validateInputConfiguration} from ${url('shared/retro/inputMapping.js')};
import {compareToolchain} from ${url('shared/retro/toolchain.js')};
import {inspectCutsceneAdapter} from ${url('shared/retro/cutsceneAdapter.js')};
import ${url('src/styles.css')};
const panel=new URLSearchParams(location.search).get('panel')||'toolchain',calls=[];window.__panelFixture={calls};
const library={modules:{core:1,camera:2,audio:1,progress:1},generators:{'map-outputs':1,'cutscene-runtime':2,'cutscene-bytecode':1},ide:'0.9.0'};
const detected={toolkit:'/toolkit',sdk:{name:'sgdk',version:'2.00',root:'/toolkit/m68k-elf'},compiler:'m68k-elf-gcc 13.1.0',rescomp:true,tools:{make:'GNU Make 4.3',java:'',python3:'Python 3.12.3'}};
let record={format:'retro-studio.toolchain',version:1,sdk:{name:'sgdk',version:'1.81'},compiler:'m68k-elf-gcc 13.1.0',runtime:{modules:{core:1,camera:1,audio:1}},generators:library.generators,ide:'0.9.0'};
const toolchain=()=>({revision:'r'+calls.length,record,recordInvalid:false,detected,library,installed:{core:1,camera:1,audio:1,progress:1},issues:compareToolchain(record,detected,library),environmentErrors:2});
const trigger=(object,cutscene,extra={})=>({object,x:8,y:8,width:16,height:16,cutscene,start:'touch',once:true,requiresFlag:'',unlessFlag:'',...extra});
const adapter=()=>({revision:'a'+calls.length,exported:true,current:false,error:'',headerConflict:false,report:inspectCutsceneAdapter({rooms:[{id:'caverna',numericId:1,map:'maps/caverna.tmx',triggers:[trigger('4','encontro'),trigger('9','sumiu'),trigger('12','encontro',{requiresFlag:'porta'})]},{id:'salao',numericId:2,map:'maps/salao.tmx',triggers:[]}],
 scenes:['encontro','final'],flags:['conheceu_gato','porta_aberta'],progress:{flags:[{id:'conheceu_gato',bit:0}],fields:[]}})});
let debugConfig={format:'retro-studio.debug',version:1,enabled:true,overlay:{performance:true,subject:true,boxes:true},transport:'kdebug',serial:3},inputConfig=createInputConfiguration(3);
const debug=()=>({config:debugConfig,revision:'d'+calls.length,exported:true,build:debugConfig.enabled?'A1ED2F':'',headerConflict:false,lastBuild:{finishedAt:'2026-10-10T12:00:00.000Z',rom:{path:'out/rom.bin',hash:'3f9a1c0d77e2'.padEnd(64,'0')},headerHash:'x',matchesCurrentHeader:true,stable:true}});
window.retroStudio={retro:{async toolchainStatus(){return toolchain()},async recordToolchain(payload){calls.push(payload);record={...record,sdk:{name:'sgdk',version:'2.00'},runtime:{modules:{core:1,camera:1,audio:1,progress:1}}};return {success:true,...toolchain()}},
 async debugConfiguration(){return debug()},async saveDebugConfiguration(payload){calls.push(payload);debugConfig=payload.config;return {success:true,...debug()}},
 async inputConfiguration(){return {config:inputConfig,revision:'i'+calls.length,headerConflict:false}},async saveInputConfiguration(payload){calls.push(payload);validateInputConfiguration(payload.config);inputConfig=payload.config;return {success:true,config:inputConfig,revision:'i'+calls.length,headerConflict:false}},
 async exportOverview(){const r=(id,title,editor,state,message,files)=>({id,title,editor,state,message,files});const rows=[r('world','Salas e mapas do mundo','Salas e conexões','stale','Os mapas ou imagens do mundo mudaram. Salve e exporte o mundo antes do build.',['world/world.json','src/generated/world_config.h']),r('input','Controles','Configurar controles','current','',['controls/input-map.json','src/generated/input_map.h']),r('movement','Física do personagem','Física e sala de testes','stale','A fonte mudou depois da última exportação.',['physics/movement.json','src/generated/movement_config.h']),r('camera','Câmera','Câmera','conflict','O header da câmera foi personalizado; revise-o antes do build. O arquivo foi preservado.',['camera/camera.json','src/generated/camera_config.h']),r('audio','Áudio','Áudio: músicas e efeitos','failed','Efeito “golpe”: arquivo original não encontrado (audio/sfx/golpe.wav).',['audio/audio.json','res/audio_resources.res']),r('progress','Progresso e save','Progresso e save','current','',['progress/progress.json','src/generated/progress_config.h']),r('cutscenes','Cenas (cutscenes)','Editor de cenas','unexported','Há cenas salvas que ainda não foram compiladas.',['cutscenes/cutscene-config.json']),r('cutscene-adapter','Gatilhos e flags de cutscene','Cutscenes: gatilhos e flags','absent','',[]),r('debug','Diagnóstico em jogo','Diagnóstico em jogo','absent','',[])];return {rows,summary:{current:2,absent:2,attention:5},blocksBuild:['world','camera','audio']}},
// ?panel=hud (#65): HUD de exemplo em memória — fonte com acentos, relógio em sprites, menu e diálogo.
 async hudConfiguration(){window.__hud??={...createHudConfiguration(),font:{name:HUD_SAMPLE_FONT.name,map:HUD_SAMPLE_FONT.map,glyphs:[...HUD_SAMPLE_FONT.glyphs],colors:[...HUD_SAMPLE_FONT.colors]},values:[{id:'score',max:999999},{id:'life',max:5},{id:'energy',max:100},{id:'time',max:99}],
   elements:[{id:'label',type:'text',anchor:'top-left',x:0,y:0,text:'PONTUAÇÃO'},{id:'score',type:'number',anchor:'top-left',x:80,y:0,value:'score',digits:6,pad:'0'},{id:'life',type:'icons',anchor:'top-right',x:0,y:0,value:'life',max:5,full:'*',empty:'.'},{id:'energy',type:'bar',anchor:'top-left',x:0,y:8,value:'energy',width:12,full:'#',empty:'-'},{id:'time',type:'number',anchor:'top',x:0,y:12,value:'time',digits:2,pad:'0',sprite:true}],
   menus:[{id:'pause',anchor:'center',x:0,y:0,title:'PAUSA',cursor:'>',items:[{id:'resume',text:'Continuar'},{id:'options',text:'Opções'},{id:'quit',text:'Sair'}]}],dialogue:{enabled:true,anchor:'bottom',x:0,y:0,width:36,lines:3,speaker:true,cursor:'>'}};
  return {config:JSON.parse(JSON.stringify(window.__hud)),revision:'h'+calls.length,saved:true,exported:true,foreign:false,conflicts:[],runtimeInstalled:false,cutsceneNotes:['As cenas quebram o texto em 38 caracteres por linha, mas a caixa de diálogo tem 36: o fim das linhas seria cortado. Ajuste a largura da caixa ou “caracteres por linha” em Cenas.']}},
 async saveHudConfiguration(payload){calls.push(payload);validateHudConfiguration(payload.config);window.__hud=payload.config;return {success:true,...await this.hudConfiguration()}},
 async editorDraft(){return {success:true,draft:null}},
 async paletteConfiguration(){const fixture=${paletteFixture};if(!fixture)return {error:'sem --palette-fixture'};window.__paletteStatus??=fixture.status;return JSON.parse(JSON.stringify(window.__paletteStatus))},
 async savePaletteConfiguration(payload){calls.push(payload);window.__paletteStatus={...window.__paletteStatus,config:payload.config,saved:true,exported:true,revision:'p'+calls.length};return {success:true,...JSON.parse(JSON.stringify(window.__paletteStatus))}},
 async paletteImage({path}){const fixture=${paletteFixture};return fixture?.images?.[path]?{path,dataUrl:fixture.images[path]}:{error:'Imagem ausente'}},
 async copyAssetToProject(projectPath,filename,buffer){calls.push({copy:filename,bytes:buffer.length,head:buffer.slice(0,8)});return {success:true,assetPath:'res/'+filename}},
 async inspectAssets(){const report=${assetReport};return report?{...report,quarantines:[]}:{success:false,error:'sem --asset-report'}},async quarantineAssets(payload){calls.push(payload);return {success:false,canceled:true}},
 async inspectCompiledResources({projectPath}){const report=${hardwareReport};return report?{success:true,projectPath,...report}:{success:false}},
 async cutsceneAdapter(){return adapter()},async saveCutsceneAdapter(payload){calls.push(payload);return {success:true,...adapter()}}}};
createApp({render:()=>h({cutscenes:CutsceneAdapterPanel,debug:DebugPanel,input:InputActionsEditor,overview:ExportOverviewPanel,hardware:HardwareReport,assets:AssetsManager,palettes:PaletteEditor,hud:HudEditor}[panel]||ToolchainPanel,{projectPath:'/fixture/A',onClose:()=>document.body.setAttribute('data-closed','true')})}).use(createI18n({legacy:false,locale:'pt-BR',messages:{'pt-BR':messages}})).mount('#app');
</script></body></html>`)
const server=await createServer({configFile:false,root:temporary,resolve:{alias:{vue:fileURLToPath(import.meta.resolve('vue/dist/vue.esm-bundler.js')),'@':path.join(repository,'src')}},plugins:[vue()],server:{host:'127.0.0.1',port:5184,strictPort:true,fs:{allow:[repository,temporary]}}})
await server.listen();console.log('Panels fixture: http://127.0.0.1:5184/?panel=toolchain | cutscenes | debug | input (memory only)')
let closing=false
async function close(){if(closing)return;closing=true;await server.close();fs.rmSync(temporary,{recursive:true,force:true});process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
