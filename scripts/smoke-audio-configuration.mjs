// #50: audio catalog exported into managed rescomp resources and the real C module.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {soundResourceEntry,createAudioConfiguration,validateAudioConfiguration,compileAudioHeader,compileAudioSgdkHeader,compileAudioResources,audioEffectRows} from '../shared/retro/audioConfiguration.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
import {audioConfigurationStatus,saveAudioConfiguration,validateAudioForBuild,audioReport} from '../electron/retro/audioConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
import {wavFixture,vgmFixture} from './audio-fixtures.mjs'
const repository=fileURLToPath(new URL('../',import.meta.url))
const argument=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1]}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-audio-config-'))
const world=rooms=>JSON.stringify({format:'retro-studio.world',version:1,initial:{room:rooms[0],entry:'spawn'},conditions:[],
 rooms:rooms.map(id=>({id,name:id,map:'maps/'+id+'.tmx',width:320,height:224,entries:[{id:'spawn',x:24,y:160,facing:false}],exits:[],checkpoints:[]}))})
const put=(root,file,bytes)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),bytes)}
function media(root){
 put(root,'audio/music/cave.vgm',vgmFixture({fnum:0x269}));put(root,'audio/music/boss.vgm',vgmFixture({fnum:0x4D2}))
 put(root,'audio/sfx/jump.wav',wavFixture({seconds:.2,hz:880}));put(root,'audio/sfx/hit.wav',wavFixture({seconds:.3}))
 put(root,'res/sfx/alarm.wav',wavFixture({seconds:1.5,rate:22050,channels:2,bits:16,hz:1200}));put(root,'audio/preview/cave.ogg',Buffer.from('OggS'))
}
const catalog=()=>Object.assign(createAudioConfiguration(),{
 music:[{id:'cave',name:'Caverna',source:'audio/music/cave.vgm',preview:'audio/preview/cave.ogg',timing:'auto'},{id:'boss',name:'Chefe',source:'audio/music/boss.vgm',timing:'ntsc'}],
 effects:[{id:'jump',name:'Pulo',source:'audio/sfx/jump.wav',priority:2,channel:0},{id:'hit',name:'Golpe',source:'audio/sfx/hit.wav',priority:8,channel:0},
  {id:'alarm',name:'Alarme',source:'res/sfx/alarm.wav',priority:12,channel:3}],rooms:[]})
try{
 const root=path.join(temporary,'game'),other=path.join(temporary,'other')
 fs.cpSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton'),root,{recursive:true})
 fs.mkdirSync(other);installRuntimeModules(root);installCutsceneRuntime(root)
 for(const name of ['retro_audio.h','retro_audio.c','retro_audio_sgdk.h'])assert.ok(fs.statSync(path.join(root,'src/retro_runtime',name)).isFile(),'runtime installer distributes '+name)
 const original=fs.readFileSync(path.join(root,'src/main.c'),'utf8'),resources=fs.readFileSync(path.join(root,'res/resources.res'),'utf8'),otherStatus=audioConfigurationStatus(other)
 assert.deepEqual(validateAudioForBuild(root),{configured:false},'projects without an audio catalog are never gated')
 let status=audioConfigurationStatus(root)
 assert.deepEqual(status.config,createAudioConfiguration());assert.ok(!status.exported);assert.deepEqual(status.outputConflicts,[]);assert.deepEqual(status.candidates,[])
 assert.deepEqual(status.report.driver.musicFormats,['.vgm','.xgm']);assert.deepEqual(status.report.driver.effectFormats,['.wav']);assert.equal(status.report.driver.toolkit,null)
 // Catalog validation.
 media(root);const config=catalog()
 const rejects=(change,pattern,options)=>{const copy=structuredClone(config);change(copy);assert.throws(()=>validateAudioConfiguration(copy,options),pattern)}
 rejects(c=>{c.driver='xgm2'},/driver/);rejects(c=>{c.music[0].id='count'},/reserved/);{const ok=structuredClone(config);ok.effects[0].id='count';validateAudioConfiguration(ok)}
rejects(c=>{c.effectChannels=2},/channel count/);rejects(c=>{c.music[1].id='cave'},/duplicate/);rejects(c=>{c.music[0].id='Cave'},/Invalid/)
 rejects(c=>{c.music[0].source='audio/music/cave.mp3'},/Unsupported audio music source format/);rejects(c=>{c.effects[0].source='audio/sfx/jump.ogg'},/Unsupported audio effect source format/)
 rejects(c=>{c.music[0].source='../cave.vgm'},/path/);rejects(c=>{c.music[0].source='/abs/cave.vgm'},/path/);rejects(c=>{c.music[0].source='a"b.vgm'},/path/)
 rejects(c=>{c.music[0].preview='audio/preview/cave.flac'},/preview format/);rejects(c=>{c.music[0].timing='60hz'},/timing/)
 rejects(c=>{c.effects[0].priority=16},/priority/);rejects(c=>{c.effects[2].channel=4},/effect channel/);rejects(c=>{c.rooms=[{room:'cave',music:'none'}]},/unknown music/)
 rejects(c=>{c.rooms=[{room:'lab',music:'cave'}]},/not in the world graph/,{rooms:['cave']})
 rejects(c=>{c.effects=Array.from({length:193},(_,i)=>({id:'e'+i,name:'E',source:'a.wav',priority:0,channel:0}))},/Too many/)
 const same=structuredClone(config);same.effects.push({id:'cave',name:'Eco',source:'audio/sfx/hit.wav',priority:1,channel:0});validateAudioConfiguration(same) // music and effects have separate ID spaces
 // Candidates and report before exporting.
 status=audioConfigurationStatus(root)
 assert.deepEqual(status.candidates,['audio/music/boss.vgm','audio/music/cave.vgm','audio/preview/cave.ogg','audio/sfx/hit.wav','audio/sfx/jump.wav','res/sfx/alarm.wav'])
 // Room music needs the room in the world graph.
 config.rooms=[{room:'cave',music:'cave'},{room:'arena',music:'boss'}]
 assert.throws(()=>saveAudioConfiguration(root,{config,revision:status.revision}),/not in the world graph/)
 put(root,'world/world.json',world(['cave','arena','hall']))
 status=audioConfigurationStatus(root);assert.deepEqual(status.rooms.map(room=>room.id),['cave','arena','hall'])
 let saved=saveAudioConfiguration(root,{config,revision:status.revision},{toolkit:argument('--sgdk')||undefined})
 assert.equal(saved.success,true);assert.ok(saved.exported);assert.deepEqual(saved.config,config);assert.equal(saved.worldError,'')
 assert.deepEqual(audioConfigurationStatus(other),otherStatus);assert.equal(fs.readFileSync(path.join(root,'src/main.c'),'utf8'),original)
 assert.equal(fs.readFileSync(path.join(root,'res/resources.res'),'utf8'),resources,'the game resource file is never rewritten')
 assert.throws(()=>saveAudioConfiguration(root,{config,revision:status.revision}),/changed/)
 const read=file=>fs.readFileSync(path.join(root,file),'utf8')
 assert.match(read('res/audio_resources.res'),/^# Generated.*\n# media [a-f0-9]{32}\n/);assert.equal(read('res/audio_resources.res').replace(/^# media .*\n/m,''),compileAudioResources(config));assert.equal(read('src/generated/audio_config.h'),compileAudioHeader(config));assert.equal(read('src/generated/audio_sgdk.h'),compileAudioSgdkHeader(config))
 assert.deepEqual(read('res/audio_resources.res').trim().split('\n').slice(2),['XGM retro_bgm_boss "../audio/music/boss.vgm" 0','XGM retro_bgm_cave "../audio/music/cave.vgm" -1',
  'WAV retro_sfx_alarm "sfx/alarm.wav" XGM','WAV retro_sfx_hit "../audio/sfx/hit.wav" XGM','WAV retro_sfx_jump "../audio/sfx/jump.wav" XGM'])
 for(const text of ['#define RETRO_PROJECT_AUDIO_MUSIC_BOSS 0','#define RETRO_PROJECT_AUDIO_MUSIC_CAVE 1','#define RETRO_PROJECT_AUDIO_SFX_ALARM 0','#define RETRO_PROJECT_AUDIO_SFX_JUMP 2',
  '#define RETRO_PROJECT_AUDIO_CHANNELS 3','retroProjectAudioEffects[]={{12,3},{8,0},{2,0}};'])assert.ok(read('src/generated/audio_config.h').includes(text),text)
 assert.ok(read('src/generated/audio_sgdk.h').includes('{retro_sfx_alarm,sizeof(retro_sfx_alarm)}'));assert.ok(read('src/generated/audio_sgdk.h').includes('SOUND_PCM_CH2'))
 // Report: formats, driver, sizes and conversions.
 const report=saved.report,entry=id=>report.entries.find(item=>item.id===id&&item.kind==='effect'),codes=()=>audioConfigurationStatus(root).report.issues.map(item=>item.code+':'+(item.id||''))
 assert.equal(report.errors,0);assert.deepEqual(report.entries.map(item=>item.kind+':'+item.id+':'+item.index),['music:boss:0','music:cave:1','effect:alarm:0','effect:hit:1','effect:jump:2'])
 assert.equal(entry('jump').romBytes,2816);assert.equal(entry('hit').romBytes,4352);assert.equal(entry('alarm').romBytes,21248);assert.equal(entry('alarm').rate,22050)
 assert.equal(report.romBytes,2816+4352+21248+2*fs.statSync(path.join(root,'audio/music/cave.vgm')).size)
 assert.deepEqual(report.issues.map(item=>item.code+':'+item.id),['no-preview:boss','wav-converted:alarm'])
 assert.equal(report.entries[1].previewExists,true)
 if(argument('--sgdk'))assert.deepEqual(report.driver.toolkit,{xgm:true,xgm2:false},'SGDK 1.81 toolkit offers XGM only')
 assert.deepEqual(audioReport(root,config,{toolkit:path.join(temporary,'missing')}).issues.at(-1).code,'driver-unavailable')
 assert.equal(validateAudioForBuild(root).configured,true);assert.equal(validateAudioForBuild(root).romBytes,report.romBytes)
 // Exported header -> distributed C module, with the world room table.
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <string.h>
#include "generated/audio_config.h"
static int last=-1,played=-1,channel;
static void music(void *c,uint16_t track){(void)c;last=track;}
static void effect(void *c,uint16_t e,uint8_t ch,uint8_t p){(void)c;(void)p;played=e;channel=ch;}
int main(void){
 RetroAudioDriver d={music,effect,0,0,0};RetroAudio a;memset(&a,0,sizeof(a));
 assert(RETRO_PROJECT_AUDIO_ROOM_COUNT==2&&RETRO_PROJECT_AUDIO_MUSIC_COUNT==2&&RETRO_PROJECT_AUDIO_EFFECT_COUNT==3);
 assert(retroAudioInit(&a,&d,RETRO_PROJECT_AUDIO_MUSIC_COUNT,retroProjectAudioEffects,RETRO_PROJECT_AUDIO_EFFECT_COUNT,RETRO_PROJECT_AUDIO_CHANNELS));
 assert(retroAudioRoomTrack(retroProjectAudioRooms,RETRO_PROJECT_AUDIO_ROOM_COUNT,${worldNumericId('arena')})==RETRO_PROJECT_AUDIO_MUSIC_BOSS);
 assert(retroAudioRoomTrack(retroProjectAudioRooms,RETRO_PROJECT_AUDIO_ROOM_COUNT,${worldNumericId('hall')})==RETRO_ID_NONE);
 assert(retroAudioRoomMusic(&a,retroAudioRoomTrack(retroProjectAudioRooms,RETRO_PROJECT_AUDIO_ROOM_COUNT,${worldNumericId('cave')}))&&last==RETRO_PROJECT_AUDIO_MUSIC_CAVE);
 assert(retroAudioPlayEffect(&a,RETRO_PROJECT_AUDIO_SFX_ALARM).channel==3&&played==RETRO_PROJECT_AUDIO_SFX_ALARM&&channel==3);
 assert(retroAudioPlayEffect(&a,RETRO_PROJECT_AUDIO_SFX_JUMP).channel==1);
 return 0;
}
`)
 const runtime=path.join(root,'src/retro_runtime')
 const built=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I'+path.join(root,'src'),'-I'+runtime,fixture,path.join(runtime,'retro_audio.c'),'-o',binary],{encoding:'utf8'});assert.equal(built.status,0,built.stderr)
 assert.equal(spawnSync(binary,[],{encoding:'utf8'}).status,0)
 const sdk=argument('--sgdk')
 if(sdk){
  fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/audio-diagnostic.c'),path.join(root,'src/main.c'))
  const sdkBuild=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],{cwd:root,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024})
  assert.equal(sdkBuild.status,0,sdkBuild.stdout.slice(-4000)+sdkBuild.stderr.slice(-4000))
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  if(argument('--keep-rom'))fs.copyFileSync(path.join(root,'out/rom.bin'),argument('--keep-rom'))
  console.log('PASS exported audio catalog -> rescomp XGM/WAV -> shared audio C + SGDK XGM adapter -> SGDK ROM ('+rom.length+' bytes)')
  fs.writeFileSync(path.join(root,'src/main.c'),original)
 }
 // Conflicts the report must name.
 fs.appendFileSync(path.join(root,'res/resources.res'),'\nSOUND old_beep "sfx/alarm.wav" 0\nWAV retro_sfx_jump "sfx/alarm.wav" XGM\nXGM2 newer "x.vgm"\n')
 put(root,'cutscenes/cutscene-config.json',JSON.stringify({sounds:[{id:'jump',value:'RETRO_PROJECT_AUDIO_SFX_JUMP'},{id:'two',value:2},{id:'lost',value:'SFX_OLD'}],music:[{id:'boss',value:'RETRO_PROJECT_AUDIO_MUSIC_BOSS'},{id:'far',value:9}]}))
 let issues=audioConfigurationStatus(root).report.issues
 assert.deepEqual(issues.filter(item=>item.code!=='no-preview'&&item.code!=='wav-converted').map(item=>item.code),['duplicate-resource','invalid-resource-type','duplicate-resource','symbol-conflict','driver-mix','cutscene-vocabulary','cutscene-vocabulary'])
 fs.writeFileSync(path.join(root,'res/resources.res'),resources+'\nSOUND bare beep.wav 0\nIMAGE retro_bgm_cave img.png\n')
 assert.deepEqual(audioConfigurationStatus(root).report.issues.filter(item=>item.severity==='error').map(item=>item.code),['invalid-resource-type','symbol-conflict'],'unquoted rescomp paths are read too')
 assert.match(issues.find(item=>item.code==='invalid-resource-type').message,/resources\.res:\d+: o rescomp não tem o tipo SOUND/);assert.match(issues.filter(item=>item.code==='cutscene-vocabulary')[0].message,/lost/)
 assert.throws(()=>validateAudioForBuild(root),/SOUND/)
 fs.writeFileSync(path.join(root,'res/resources.res'),resources);fs.rmSync(path.join(root,'cutscenes/cutscene-config.json'))
 // Missing, unreadable and wasteful sources.
 fs.renameSync(path.join(root,'audio/sfx/hit.wav'),path.join(root,'audio/sfx/hit.bak'));assert.ok(codes().includes('missing-source:hit'));assert.throws(()=>validateAudioForBuild(root),/arquivo original não encontrado/)
 put(root,'audio/sfx/hit.wav',Buffer.from('not a wave file'));assert.ok(codes().includes('invalid-wav:hit'))
 put(root,'audio/sfx/hit.wav',wavFixture({seconds:.3,tag:3}));assert.ok(codes().includes('wav-not-pcm:hit'))
 put(root,'audio/sfx/hit.wav',wavFixture({seconds:.3,tag:0xFFFE}));assert.ok(codes().includes('wav-extensible:hit'))
 put(root,'audio/sfx/hit.wav',wavFixture({seconds:5}));assert.ok(codes().includes('long-effect:hit'))
 // A replaced original is a change the build must see: same catalog, new media digest.
 assert.throws(()=>validateAudioForBuild(root),/Um arquivo de música ou efeito mudou/)
 {const before=read('res/audio_resources.res'),again=saveAudioConfiguration(root,{config,revision:audioConfigurationStatus(root).revision});assert.equal(again.success,true);assert.notEqual(read('res/audio_resources.res'),before)}
 assert.equal(validateAudioForBuild(root).configured,true,'warnings do not block the build')
 put(root,'audio/music/cave.vgm',Buffer.from([0x1f,0x8b,8,0]));assert.ok(codes().includes('invalid-vgm:cave'))
 fs.rmSync(path.join(root,'audio/preview/cave.ogg'));assert.ok(codes().includes('missing-preview:cave'))
 fs.symlinkSync(os.tmpdir(),path.join(root,'audio/outside'));const escaped=structuredClone(config);escaped.effects[0].source='audio/outside/x.wav'
 assert.ok(audioReport(root,escaped).issues.some(item=>item.code==='missing-source'&&item.id==='jump'),'sources outside the project are never read')
 media(root);fs.rmSync(path.join(root,'audio/sfx/hit.bak'));fs.rmSync(path.join(root,'audio/outside'))
 saveAudioConfiguration(root,{config,revision:audioConfigurationStatus(root).revision});assert.equal(validateAudioForBuild(root).configured,true)
 const twice=structuredClone(config);twice.effects[1].source='audio/sfx/jump.wav';assert.ok(audioReport(root,twice).issues.some(item=>item.code==='shared-source'))
 // World changes, stale source and customized outputs: reported, nothing overwritten.
 put(root,'world/world.json','{broken');{const broken=audioConfigurationStatus(root);assert.equal(broken.worldUnreadable,true);assert.ok(broken.worldError);assert.deepEqual(broken.rooms,[]);assert.deepEqual(broken.config.rooms,config.rooms)}
 put(root,'world/world.json',world(['cave']));assert.match(audioConfigurationStatus(root).worldError,/not in the world graph/);assert.equal(audioConfigurationStatus(root).worldUnreadable,false);assert.throws(()=>validateAudioForBuild(root),/not in the world graph/)
 put(root,'world/world.json',world(['cave','arena','hall']))
 const edited=structuredClone(config);edited.effects[0].priority=3;put(root,'audio/audio.json',JSON.stringify(edited));assert.throws(()=>validateAudioForBuild(root),/mudou/)
 put(root,'audio/audio.json',JSON.stringify(config,null,2)+'\n');assert.equal(validateAudioForBuild(root).configured,true)
 fs.appendFileSync(path.join(root,'res/audio_resources.res'),'WAV mine "x.wav" XGM\n')
 assert.deepEqual(audioConfigurationStatus(root).outputConflicts,['res/audio_resources.res']);assert.throws(()=>validateAudioForBuild(root),/personalizado/)
 assert.throws(()=>saveAudioConfiguration(root,{config,revision:audioConfigurationStatus(root).revision}),/customized/);assert.ok(read('res/audio_resources.res').endsWith('WAV mine "x.wav" XGM\n'))
 for(const text of ['null','{bad','{"version":1,"files":{}}']){put(root,'.retrostudio/audio-export.json',text);assert.throws(()=>audioConfigurationStatus(root),/Unsupported audio export record/)}
 put(root,'audio/audio.json','{"version":99}');assert.throws(()=>audioConfigurationStatus(root),/Unsupported/)
 // An unmanaged file already at an output path is preserved on first export.
 fs.mkdirSync(path.join(other,'res'));fs.writeFileSync(path.join(other,'res/audio_resources.res'),'WAV own "a.wav" XGM\n')
 assert.throws(()=>saveAudioConfiguration(other,{config:createAudioConfiguration(),revision:audioConfigurationStatus(other).revision}),/unmanaged/)
 assert.equal(audioEffectRows(config)[0].symbol,'retro_sfx_alarm')
 // Plain asset import no longer writes the SOUND type rescomp does not have.
 const manager=await import('../src/utils/retro/projectAssetManager.js')
 assert.equal(manager.generateResourceEntry({type:'sound',name:'Beep.wav'}),'WAV BEEP "Beep.wav" XGM');assert.equal(manager.generateResourceEntry({type:'sound',name:'song.vgm'}),'XGM SONG "song.vgm"')
 assert.equal(manager.generateResourceEntry({type:'sound',name:'take.mp3'}),'');assert.equal(soundResourceEntry('X','a.ogg'),'');assert.equal(manager.generateResourceEntry({type:'sprite',name:'hero.png'}),'IMAGE HERO "hero.png" 0')
 assert.match(fs.readFileSync(new URL('../electron/retro/assetImport.js',import.meta.url),'utf8'),/type === 'sound' \? soundResourceEntry\(symbol, fileName\)/)
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Audio configuration: catalog validation, candidates, world-bound room music, transactional source/resources/headers, report (formats, driver, sizes, conflicts, cutscene vocabulary), build gate, confinement, conflicts and shared C passed.')
