// #63: map triggers and flag links exported for the reference cutscene host; example ROM with --sgdk.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parseCutsceneTriggers,unparsedCutsceneTriggers,inspectCutsceneAdapter,compileCutsceneAdapterHeader} from '../shared/retro/cutsceneAdapter.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
import {createProgressConfiguration} from '../shared/retro/progressConfiguration.js'
import {createAudioConfiguration} from '../shared/retro/audioConfiguration.js'
import {createCameraConfiguration} from '../shared/retro/cameraConfiguration.js'
import {cutsceneAdapterStatus,saveCutsceneAdapter,validateCutsceneAdapterForBuild} from '../electron/retro/cutsceneAdapter.js'
import {progressConfigurationStatus,saveProgressConfiguration} from '../electron/retro/progressConfiguration.js'
import {audioConfigurationStatus,saveAudioConfiguration} from '../electron/retro/audioConfiguration.js'
import {cameraConfigurationStatus,saveCameraConfiguration} from '../electron/retro/cameraConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
import {wavFixture,vgmFixture} from './audio-fixtures.mjs'
const repository=fileURLToPath(new URL('../',import.meta.url))
const argument=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1]}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-cutscene-adapter-'))
const put=(root,file,bytes)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),bytes)}
const world=rooms=>JSON.stringify({format:'retro-studio.world',version:1,initial:{room:rooms[0],entry:'spawn'},conditions:[],
 rooms:rooms.map(id=>({id,name:id,map:'maps/'+id+'.tmx',width:512,height:224,entries:[{id:'spawn',x:24,y:160,facing:false}],exits:[],checkpoints:[]}))})
const tmx=objects=>'<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.10" orientation="orthogonal" width="64" height="28" tilewidth="8" tileheight="8">\n <objectgroup id="2" name="objects">\n'+objects+' </objectgroup>\n</map>\n'
const trigger=(id,x,width,properties)=>'  <object id="'+id+'" type="cutscene_trigger" x="'+x+'" y="96.5" width="'+width+'" height="80">\n   <properties>\n'+Object.entries(properties).map(([name,value])=>'    <property name="'+name+'" value="'+value+'"/>\n').join('')+'   </properties>\n  </object>\n'
const lab=tmx(trigger(7,200,40,{cutscene:'meet'})+'  <object id="8" type="player_spawn" x="10" y="10"/>\n'+trigger(9,400,48,{cutscene:'again',start:'interact',once:'false',requires_flag:'met_cat'})+trigger(10,0,0,{cutscene:'again',start:'enter',unless_flag:'door_open'}))
const scenes={
 'meet':{format:'retro-studio.cutscene',version:1,id:'meet',title:'Encontro',steps:[
  {type:'music',music:'boss'},{type:'camera',mode:'x',x:150,speed:2,wait:true},{type:'move',actor:'cat',x:-40,relative:true,speed:1,wait:true},{type:'face',actor:'cat',direction:'left'},
  {type:'say',actor:'cat',speaker:'Gato',portrait:'',side:'left',text:'Ola. Quer abrir a porta?'},
  {type:'choice',prompt:'Abrir?',default:1,options:[{text:'Sim',steps:[{type:'set_flag',flag:'door_open',value:true},{type:'sound',sound:'door'}]},{text:'Nao',steps:[{type:'wait',frames:3}]}]},
  {type:'fade',direction:'out',frames:20},{type:'place',actor:'hero',x:330},{type:'show',actor:'cat',visible:false},{type:'fade',direction:'in',frames:20},
  {type:'set_flag',flag:'met_cat',value:true},{type:'wait',frames:30}]},
 'again':{format:'retro-studio.cutscene',version:1,id:'again',title:'De novo',steps:[{type:'say',actor:'hero',speaker:'Heroi',portrait:'',side:'left',text:'A porta ja foi vista.'}]}}
try{
 const root=path.join(temporary,'game'),other=path.join(temporary,'other')
 fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),root,{recursive:true});fs.mkdirSync(other)
 installRuntimeModules(root);installCutsceneRuntime(root)
 for(const name of ['retro_cutscene_host.h','retro_cutscene_host.c','retro_cutscene_sgdk.h'])assert.ok(fs.statSync(path.join(root,'src/retro_runtime',name)).isFile(),'runtime installer distributes '+name)
 // TMX parsing: only cutscene_trigger objects, defaults, entities and rounding.
 assert.deepEqual(parseCutsceneTriggers(lab),[{object:'7',x:200,y:97,width:40,height:80,cutscene:'meet',start:'touch',once:true,requiresFlag:'',unlessFlag:''},
  {object:'9',x:400,y:97,width:48,height:80,cutscene:'again',start:'interact',once:false,requiresFlag:'met_cat',unlessFlag:''},{object:'10',x:0,y:97,width:0,height:80,cutscene:'again',start:'enter',once:true,requiresFlag:'',unlessFlag:'door_open'}])
 assert.deepEqual(parseCutsceneTriggers('<object id="1" class="cutscene_trigger" x="1" y="2" width="3" height="4"><properties><property name="cutscene" value="a&amp;b"/></properties></object>')[0].cutscene,'a&b')
 // Comments are skipped, multiline property bodies are read, and markup the reader cannot follow is counted, never dropped.
 assert.deepEqual(parseCutsceneTriggers('<!-- <object id="1" type="cutscene_trigger" x="0" y="0" width="8" height="8"/> -->'),[])
 assert.equal(parseCutsceneTriggers('<object id="2" type="cutscene_trigger" x="-4" y="0" width="8" height="8"><properties><property name="cutscene">meet</property><property name="requires_flag">\n met_cat\n</property></properties></object>')[0].requiresFlag,'met_cat')
 assert.equal(unparsedCutsceneTriggers(lab),0);assert.equal(unparsedCutsceneTriggers("<object id='3' type='cutscene_trigger' x='0' y='0' width='8' height='8'/>"),1)
 assert.equal(unparsedCutsceneTriggers('<object id="4" name="a>b" type="cutscene_trigger" x="0" y="0" width="8" height="8"/>'),1)
 // Opt-in: nothing is gated or written before the first export, with or without a cutscene project.
 assert.deepEqual(validateCutsceneAdapterForBuild(other),{configured:false});assert.match(cutsceneAdapterStatus(other).error,/cutscene-config\.json/)
 assert.deepEqual(validateCutsceneAdapterForBuild(root),{configured:false})
 const config=JSON.parse(fs.readFileSync(path.join(root,'cutscenes/cutscene-config.json'),'utf8'))
 Object.assign(config,{actors:[{id:'hero',name:'Heroi',value:0},{id:'cat',name:'Gato',value:1}],sounds:[{id:'door',value:'RETRO_PROJECT_AUDIO_SFX_DOOR'}],music:[{id:'boss',value:'RETRO_PROJECT_AUDIO_MUSIC_BOSS'}],
  flags:[{id:'met_cat'},{id:'door_open'},{id:'local_only'}],includes:['generated/audio_config.h']})
 put(root,'cutscenes/cutscene-config.json',JSON.stringify(config,null,2));for(const [id,scene] of Object.entries(scenes))put(root,'cutscenes/'+id+'.cutscene.json',JSON.stringify(scene,null,2))
 put(root,'world/world.json',world(['lab','empty']));put(root,'maps/lab.tmx',lab);put(root,'maps/empty.tmx',tmx(''))
 let status=cutsceneAdapterStatus(root)
 assert.equal(status.error,'');assert.equal(status.exported,false);assert.equal(status.current,false);assert.equal(status.report.errors,0)
 assert.deepEqual(status.report.rooms,[{id:'lab',numericId:worldNumericId('lab'),triggers:3},{id:'empty',numericId:worldNumericId('empty'),triggers:0}])
 assert.deepEqual(status.report.issues.map(item=>item.code),['no-progress']);assert.deepEqual(status.report.links,[])
 // Progress present: flags with the same ID are linked, the rest is reported.
 const progress=Object.assign(createProgressConfiguration(),{flags:[{id:'door_open',name:'Porta',bit:3},{id:'met_cat',name:'Gato',bit:0}],fields:[{id:'coins',name:'Moedas',offset:0,bytes:2}],sram:{enabled:true,slots:1,offset:0,size:8192}})
 saveProgressConfiguration(root,{config:progress,revision:progressConfigurationStatus(root).revision})
 status=cutsceneAdapterStatus(root);assert.deepEqual(status.report.links,[{id:'met_cat',bit:0},{id:'door_open',bit:3}]);assert.deepEqual(status.report.issues.map(item=>item.code),['flag-not-saved','played-not-saved']);assert.equal(status.report.played,null)
 progress.fields.push({id:'cutscenes_played',name:'Cenas vistas',offset:4,bytes:1})
 saveProgressConfiguration(root,{config:progress,revision:progressConfigurationStatus(root).revision})
 status=cutsceneAdapterStatus(root);assert.deepEqual(status.report.played,{offset:4,bytes:1});assert.deepEqual(status.report.issues.map(item=>item.code),['flag-not-saved'])
 // Export: one header, transactional, nothing else touched.
 const original=fs.readFileSync(path.join(root,'src/main.c'),'utf8')
 let saved=saveCutsceneAdapter(root,{revision:status.revision});assert.equal(saved.success,true);assert.ok(saved.exported&&saved.current&&!saved.headerConflict)
 assert.throws(()=>saveCutsceneAdapter(root,{revision:status.revision}),/changed/);assert.equal(fs.readFileSync(path.join(root,'src/main.c'),'utf8'),original)
 const headerPath=path.join(root,'src/generated/cutscene_adapter.h'),header=fs.readFileSync(headerPath,'utf8')
 for(const text of ['#include "../cutscene_ids.h"','retroProjectCutsceneTriggers_'+worldNumericId('lab')+'[]={{200,97,40,80,CUTSCENE_MEET,CUTSCENE_START_TOUCH,1,-1,-1},{400,97,48,80,CUTSCENE_AGAIN,CUTSCENE_START_INTERACT,0,CUTSCENE_FLAG_MET_CAT,-1},{0,97,0,80,CUTSCENE_AGAIN,CUTSCENE_START_ENTER,1,-1,CUTSCENE_FLAG_DOOR_OPEN}};',
  '#define RETRO_PROJECT_CUTSCENE_ROOM_COUNT 1','retroProjectCutsceneFlags[]={{CUTSCENE_FLAG_MET_CAT,0},{CUTSCENE_FLAG_DOOR_OPEN,3}};','#define RETRO_PROJECT_CUTSCENE_PLAYED_OFFSET 4','#define RETRO_PROJECT_CUTSCENE_PLAYED_BYTES 1'])assert.ok(header.includes(text),text)
 assert.deepEqual(validateCutsceneAdapterForBuild(root),{configured:true,revision:saved.revision,rooms:1})
 // The skeleton map exporter refuses a map with triggers only while nothing would consume them.
 const exporter=fs.readFileSync(path.join(root,'tools/export-map.py'),'utf8');assert.match(exporter,/cutscene-adapter-export\.json'\)\.is_file\(\)/)
 // Stale: any source of the derived header blocks the build until re-exported.
 const stale=change=>{change();assert.equal(cutsceneAdapterStatus(root).current,false);assert.throws(()=>validateCutsceneAdapterForBuild(root),/mudaram|não existe|não está/)}
 stale(()=>put(root,'maps/lab.tmx',tmx(trigger(7,208,40,{cutscene:'meet'}))));put(root,'maps/lab.tmx',lab);assert.equal(validateCutsceneAdapterForBuild(root).configured,true)
 stale(()=>put(root,'maps/empty.tmx',tmx(trigger(1,0,8,{cutscene:'meet'}))));put(root,'maps/empty.tmx',tmx(''))
 stale(()=>fs.renameSync(path.join(root,'cutscenes/again.cutscene.json'),path.join(root,'cutscenes/again.bak')));fs.renameSync(path.join(root,'cutscenes/again.bak'),path.join(root,'cutscenes/again.cutscene.json'))
 stale(()=>{const next=structuredClone(config);next.flags=[{id:'door_open'},{id:'local_only'}];put(root,'cutscenes/cutscene-config.json',JSON.stringify(next))});put(root,'cutscenes/cutscene-config.json',JSON.stringify(config,null,2))
 assert.equal(validateCutsceneAdapterForBuild(root).configured,true)
 // Reference validation with the object and room named.
 const issues=objects=>{put(root,'maps/lab.tmx',tmx(objects));const result=cutsceneAdapterStatus(root);put(root,'maps/lab.tmx',lab);return result.report.issues.filter(item=>item.severity==='error')}
 assert.match(issues(trigger(4,0,8,{cutscene:'gone'}))[0].message,/Sala “lab”, objeto 4: a cena “gone” não existe/)
 assert.deepEqual(issues(trigger(4,0,8,{})+trigger(5,0,8,{cutscene:'meet',start:'click'})+trigger(6,0,8,{cutscene:'meet',requires_flag:'nope',unless_flag:'nah'})+trigger(7,0,0,{cutscene:'meet'})+trigger(8,40000,8,{cutscene:'meet'})).map(item=>item.code),
  ['missing-cutscene','invalid-start','unknown-flag','unknown-flag','empty-area','area-range'])
 assert.equal(issues(Array.from({length:33},(_,i)=>trigger(i+1,i*8,8,{cutscene:'meet'})).join(''))[0].code,'too-many-triggers')
 assert.equal(inspectCutsceneAdapter({rooms:[],scenes:['a-b','a_b'],flags:[],progress:null}).issues[0].code,'macro-collision')
 assert.match(inspectCutsceneAdapter({rooms:[],scenes:['flag_door'],flags:['door'],progress:null}).issues[0].message,/“door” e “flag_door”|reservada/)
 for(const id of ['none','flag_count','max_flags','op_end','count'])assert.equal(inspectCutsceneAdapter({rooms:[],scenes:[id],flags:[],progress:null}).issues[0]?.code,'macro-collision',id)
 assert.equal(inspectCutsceneAdapter({rooms:[],scenes:['intro','door'],flags:['door','none'],progress:null}).errors,0)
 assert.equal(issues("  <object id='3' type='cutscene_trigger' x='0' y='0' width='8' height='8'/>\n")[0].code,'unparsed-trigger')
 fs.renameSync(path.join(root,'maps/empty.tmx'),path.join(root,'maps/empty.bak'));assert.deepEqual(cutsceneAdapterStatus(root).report.issues.filter(item=>item.severity==='error').map(item=>item.code),['missing-map']);assert.throws(()=>validateCutsceneAdapterForBuild(root),/não foi encontrado/)
 fs.renameSync(path.join(root,'maps/empty.bak'),path.join(root,'maps/empty.tmx'));assert.equal(validateCutsceneAdapterForBuild(root).configured,true)
 put(root,'cutscenes/broken.cutscene.json','{oops');assert.match(cutsceneAdapterStatus(root).error,/cutscenes\/broken\.cutscene\.json: JSON inválido/);fs.rmSync(path.join(root,'cutscenes/broken.cutscene.json'))
 assert.throws(()=>compileCutsceneAdapterHeader({rooms:[{id:'r',numericId:1,triggers:[{object:'1',x:0,y:0,width:8,height:8,cutscene:'x',start:'touch',once:true,requiresFlag:'',unlessFlag:''}]}],scenes:[],flags:[],progress:null}),/não existe/)
 assert.match(compileCutsceneAdapterHeader({rooms:[],scenes:[],flags:[],progress:null}),/retroProjectCutsceneRooms\[\]=\{\{RETRO_ID_NONE,0,0\}\};/)
 // Customized header and broken record: reported, never overwritten.
 fs.appendFileSync(headerPath,'/* manual */');assert.ok(cutsceneAdapterStatus(root).headerConflict);assert.throws(()=>validateCutsceneAdapterForBuild(root),/personalizado/)
 assert.throws(()=>saveCutsceneAdapter(root,{revision:cutsceneAdapterStatus(root).revision}),/customized/);assert.ok(fs.readFileSync(headerPath,'utf8').endsWith('/* manual */'))
 fs.writeFileSync(headerPath,header);assert.equal(validateCutsceneAdapterForBuild(root).configured,true)
 // Without a world graph the single project map is exported as room RETRO_ID_NONE.
 fs.cpSync(path.join(root,'cutscenes'),path.join(other,'cutscenes'),{recursive:true});put(other,'maps/map.tmx',lab)
 const single=saveCutsceneAdapter(other,{revision:cutsceneAdapterStatus(other).revision});assert.deepEqual(single.report.rooms,[{id:'map',numericId:65535,triggers:3}])
 assert.match(fs.readFileSync(path.join(other,'src/generated/cutscene_adapter.h'),'utf8'),/retroProjectCutsceneTriggers_65535/)
 // Single-map project with another map name: the configured map is read; a configured map that is missing is an error, not zero triggers.
 const custom=path.join(temporary,'custom');fs.mkdirSync(custom);fs.cpSync(path.join(root,'cutscenes'),path.join(custom,'cutscenes'),{recursive:true})
 put(custom,'retro-studio.json',JSON.stringify({mapExport:{sourceMaps:['maps/level1.tmx']}}));put(custom,'maps/map.tmx',tmx(''))
 assert.deepEqual(cutsceneAdapterStatus(custom).report.issues.filter(item=>item.severity==='error').map(item=>item.code),['missing-map'])
 put(custom,'maps/level1.tmx',lab);assert.deepEqual(cutsceneAdapterStatus(custom).report.rooms,[{id:'map',numericId:65535,triggers:3}])
 const sdk=argument('--sgdk')
 if(sdk){
  // Example project: every shared module behind the reference host.
  put(root,'audio/music/room.vgm',vgmFixture({fnum:0x269}));put(root,'audio/music/boss.vgm',vgmFixture({fnum:0x4D2}));put(root,'audio/sfx/door.wav',wavFixture({seconds:.4,hz:880}))
  const audio=Object.assign(createAudioConfiguration(),{music:[{id:'room',name:'Sala',source:'audio/music/room.vgm',timing:'auto'},{id:'boss',name:'Chefe',source:'audio/music/boss.vgm',timing:'auto'}],
   effects:[{id:'door',name:'Porta',source:'audio/sfx/door.wav',priority:8,channel:0}],rooms:[{room:'lab',music:'room'}]})
  saveAudioConfiguration(root,{config:audio,revision:audioConfigurationStatus(root).revision})
  saveCameraConfiguration(root,{config:createCameraConfiguration(),revision:cameraConfigurationStatus(root).revision})
  fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/cutscene-diagnostic.c'),path.join(root,'src/main.c'))
  const sdkBuild=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],{cwd:root,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024})
  assert.equal(sdkBuild.status,0,sdkBuild.stdout.slice(-4000)+sdkBuild.stderr.slice(-4000))
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  assert.equal(validateCutsceneAdapterForBuild(root).configured,true,'the build regenerates cutscene headers without making the adapter stale')
  if(argument('--keep-rom'))fs.copyFileSync(path.join(root,'out/rom.bin'),argument('--keep-rom'))
  console.log('PASS example project: cutscene runner + reference host + camera + audio + progress -> SGDK ROM ('+rom.length+' bytes)')
 }
 for(const text of ['null','{bad']){put(root,'.retrostudio/cutscene-adapter-export.json',text);assert.throws(()=>cutsceneAdapterStatus(root),/Unsupported cutscene adapter export record/)}
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Cutscene adapter: TMX triggers, opt-in export, flag links, played field, reference validation, stale sources, single-map projects, conflicts and build gate passed.')
