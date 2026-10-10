// #50: music ownership and effect channel policy on the host; C/JS parity for the preview.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createAudioMixer,AUDIO_NONE} from '../shared/retro/audioMixer.js'
import {compileProject,defaultCutsceneConfig} from '../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-audio-'))
const library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
const cutscene=fileURLToPath(new URL('../assets/toolkit/lib/cutscene/src/retrostudio/',import.meta.url))
try{
 // Deterministic trace shared by both implementations: [operation, argument, busy mask].
 const effects=[[2,0],[2,0],[9,0],[5,2],[0,0],[15,3],[5,0],[1,1]]
 let seed=0x51F15E
 const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*n)}
 const trace=Array.from({length:4000},()=>{const kind=random(10);const tick=random(3)===0;return [tick?4:kind<6?0:kind<8?1:kind<9?2:3,kind<6?random(10):kind===3?random(2):random(6)-1,random(8)]})
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "retro_audio.h"
static const RetroAudioEffect effects[]={${effects.map(e=>'{'+e+'}').join(',')}};
static const int trace[][3]={${trace.map(row=>'{'+row+'}').join(',')}};
static int musicCalls,effectCalls,pauseCalls,lastMusic=-2,lastEffect=-1,lastChannel,lastPriority,mask,log;
static void music(void *c,uint16_t track){(void)c;musicCalls++;lastMusic=track;if(log)printf("M%u\\n",track);}
static void effect(void *c,uint16_t e,uint8_t channel,uint8_t priority){(void)c;effectCalls++;lastEffect=e;lastChannel=channel;lastPriority=priority;if(log)printf("E%u,%u,%u\\n",e,channel,priority);}
static void pause(void *c,uint8_t paused){(void)c;pauseCalls++;if(log)printf("P%u\\n",paused);}
static uint8_t busy(void *c,uint8_t channel){(void)c;return (uint8_t)((mask>>(channel-1))&1);}
static void frames(RetroAudio *a,int n){while(n--)retroAudioTick(a);}
int main(void){
 RetroAudioDriver d={music,effect,pause,busy,0},plain={music,effect,0,0,0},bad;RetroAudio a,copy;RetroAudioPlay p;unsigned i;
 static const RetroAudioRoomMusic rooms[]={{100,2},{200,0}};
 static const RetroAudioEffect wrong[]={{16,0}},far[]={{1,4}};
 memset(&a,0,sizeof(a));
 /* Contract. */
 assert(!retroAudioInit(0,&d,3,effects,8,3)&&!retroAudioInit(&a,0,3,effects,8,3)&&!retroAudioInit(&a,&d,3,effects,8,0)&&!retroAudioInit(&a,&d,3,effects,8,5));
 assert(!retroAudioInit(&a,&d,3,0,8,3)&&!retroAudioInit(&a,&d,3,wrong,1,3)&&!retroAudioInit(&a,&d,3,far,1,3)&&!a.ready);
 bad=d;bad.music=0;assert(!retroAudioInit(&a,&bad,3,effects,8,3));bad=d;bad.effect=0;assert(!retroAudioInit(&a,&bad,3,effects,8,3));
 assert(!retroAudioRoomMusic(&a,0)&&!retroAudioPause(&a,1)&&!retroAudioRestoreMusic(&a)&&!retroAudioPlayEffect(&a,0).channel&&!effectCalls&&!musicCalls);
 assert(retroAudioInit(&a,&d,3,effects,8,3)&&a.playing==RETRO_ID_NONE&&!musicCalls);
 /* Room music: started once, kept across rooms that share it, silence is explicit. */
 assert(retroAudioRoomMusic(&a,1)&&musicCalls==1&&lastMusic==1);
 assert(retroAudioRoomMusic(&a,1)&&musicCalls==1);
 assert(retroAudioRoomMusic(&a,2)&&musicCalls==2&&lastMusic==2);
 copy=a;assert(!retroAudioRoomMusic(&a,3)&&!retroAudioScriptMusic(&a,7)&&!memcmp(&a,&copy,sizeof(a))&&musicCalls==2);
 assert(retroAudioRoomMusic(&a,RETRO_ID_NONE)&&musicCalls==3&&lastMusic==RETRO_ID_NONE);
 assert(retroAudioRoomMusic(&a,2)&&musicCalls==4);
 /* Cutscene music hides the room music; room changes meanwhile are remembered, not played. */
 retroAudioCutsceneMusic(&a,0);assert(musicCalls==5&&lastMusic==0&&a.overridden);
 assert(retroAudioRoomMusic(&a,1)&&musicCalls==5&&a.playing==0);
 retroAudioCutsceneMusic(&a,0);assert(musicCalls==5);
 retroAudioCutsceneMusic(&a,-1);assert(musicCalls==6&&lastMusic==1&&!a.overridden);
 retroAudioCutsceneMusic(&a,-1);assert(musicCalls==6);
 /* A cutscene that plays the room's own track never restarts it. */
 retroAudioCutsceneMusic(&a,1);assert(musicCalls==6);retroAudioCutsceneMusic(&a,-1);assert(musicCalls==6);
 retroAudioCutsceneMusic(&a,99999);retroAudioCutsceneMusic(&a,3);assert(musicCalls==6&&!a.overridden);
 /* Scripted silence is possible and restores afterwards. */
 assert(retroAudioScriptMusic(&a,RETRO_ID_NONE)&&musicCalls==7&&lastMusic==RETRO_ID_NONE&&retroAudioRestoreMusic(&a)&&musicCalls==8&&lastMusic==1);
 /* Pause forwards only changes. */
 assert(retroAudioPause(&a,1)&&pauseCalls==1&&retroAudioPause(&a,7)&&pauseCalls==1&&retroAudioPause(&a,0)&&pauseCalls==2);
 /* Music chosen during a pause starts on resume, never under the pause. */
 i=(unsigned)musicCalls;assert(retroAudioPause(&a,1)&&retroAudioRoomMusic(&a,2)&&a.room==2&&a.playing==1&&musicCalls==(int)i&&pauseCalls==3);
 assert(retroAudioPause(&a,0)&&musicCalls==(int)i+1&&lastMusic==2&&a.playing==2&&pauseCalls==3); /* starting the track ends the pause */
 assert(retroAudioPause(&a,1)&&retroAudioRoomMusic(&a,1)&&retroAudioRoomMusic(&a,2)&&retroAudioPause(&a,0)&&musicCalls==(int)i+1&&pauseCalls==5); /* back to the same track: plain resume */
 assert(retroAudioRoomMusic(&a,1)&&musicCalls==(int)i+2);
 /* Same frame: the driver has not reported the first voices yet, but they stay reserved. */
 mask=0;assert(retroAudioPlayEffect(&a,0).channel==1&&retroAudioPlayEffect(&a,0).channel==2&&retroAudioPlayEffect(&a,0).channel==3);
 p=retroAudioPlayEffect(&a,0);assert(p.channel==1&&p.interrupted==0);assert(!retroAudioPlayEffect(&a,4).channel);
 frames(&a,1);assert(!retroAudioPlayEffect(&a,4).channel);frames(&a,1);assert(retroAudioPlayEffect(&a,4).channel==1); /* reservation ends, driver says free */
 retroAudioTick(0);assert(retroAudioInit(&a,&d,3,effects,8,3));retroAudioRoomMusic(&a,1);effectCalls=0;
 /* Effects: free channels first, in order. */
 mask=0;p=retroAudioPlayEffect(&a,0);frames(&a,2);assert(p.channel==1&&p.interrupted==RETRO_ID_NONE&&lastPriority==2);
 mask=1;p=retroAudioPlayEffect(&a,2);assert(p.channel==2&&lastEffect==2&&lastPriority==9);frames(&a,2);
 mask=3;p=retroAudioPlayEffect(&a,6);assert(p.channel==3&&p.interrupted==RETRO_ID_NONE);frames(&a,2);
 /* All busy: the lowest priority voice is interrupted by an equal or higher one... */
 mask=7;p=retroAudioPlayEffect(&a,1);assert(p.channel==1&&p.interrupted==0&&effectCalls==4);
 /* ...and a lower priority effect is dropped without touching the driver. */
 p=retroAudioPlayEffect(&a,4);assert(!p.channel&&p.interrupted==RETRO_ID_NONE&&effectCalls==4);
 /* Ties on priority interrupt the oldest voice. */
 p=retroAudioPlayEffect(&a,2);assert(p.channel==1&&p.interrupted==1); /* voices: 9,9,5 */
 p=retroAudioPlayEffect(&a,6);assert(p.channel==3&&p.interrupted==6);
 p=retroAudioPlayEffect(&a,2);assert(p.channel==3&&p.interrupted==6); /* 9,9,9 */
 p=retroAudioPlayEffect(&a,2);assert(p.channel==2&&p.interrupted==2); /* oldest of the three */
 /* Fixed channel: only that channel is considered. */
 p=retroAudioPlayEffect(&a,3);assert(!p.channel);                     /* priority 5 < 9 on channel 2 */
 p=retroAudioPlayEffect(&a,5);assert(p.channel==3&&p.interrupted==2&&lastPriority==15);
 frames(&a,2);mask=5;p=retroAudioPlayEffect(&a,3);assert(p.channel==2&&p.interrupted==RETRO_ID_NONE); /* finished voice is free */
 /* A finished voice is free for auto selection too, even when its old priority was higher. */
 frames(&a,2);mask=3;p=retroAudioPlayEffect(&a,4);assert(p.channel==3&&p.interrupted==RETRO_ID_NONE);
 p=retroAudioPlayEffect(&a,8);assert(!p.channel);retroAudioCutsceneSound(&a,-1);retroAudioCutsceneSound(&a,70000);
 i=effectCalls;retroAudioCutsceneSound(&a,7);assert(effectCalls==(int)i); /* fixed channel 1 is busy with priority 9 */
 frames(&a,2);mask=6;retroAudioCutsceneSound(&a,7);assert(effectCalls==(int)i+1&&lastChannel==1);
 /* Without a busy callback every started voice counts as busy until replaced. */
 assert(!retroAudioInit(&a,&plain,1,effects,8,2)); /* effect 5 asks for channel 3 */
 assert(retroAudioInit(&a,&plain,1,effects,3,2));
 assert(retroAudioPlayEffect(&a,2).channel==1&&retroAudioPlayEffect(&a,2).channel==2&&!retroAudioPlayEffect(&a,0).channel);
 p=retroAudioPlayEffect(&a,2);assert(p.channel==1&&p.interrupted==2);assert(retroAudioPause(&a,1));
 /* Room table lookup. */
 assert(retroAudioRoomTrack(rooms,2,200)==0&&retroAudioRoomTrack(rooms,2,100)==2&&retroAudioRoomTrack(rooms,2,7)==RETRO_ID_NONE&&retroAudioRoomTrack(0,2,100)==RETRO_ID_NONE);
 /* Trace for the JS mixer. */
 assert(retroAudioInit(&a,&d,5,effects,8,3));log=1;
 for(i=0;i<sizeof(trace)/sizeof(trace[0]);i++){
  mask=trace[i][2];
  if(trace[i][0]==0){p=retroAudioPlayEffect(&a,(uint16_t)trace[i][1]);printf("R%u,%u\\n",p.channel,p.interrupted);}
  else if(trace[i][0]==1)printf("r%u\\n",retroAudioRoomMusic(&a,trace[i][1]<0?RETRO_ID_NONE:(uint16_t)trace[i][1]));
  else if(trace[i][0]==2)retroAudioCutsceneMusic(&a,trace[i][1]);
  else if(trace[i][0]==3)retroAudioPause(&a,(uint8_t)trace[i][1]);
  else retroAudioTick(&a);
  printf("S%u,%u,%u,%u,%u\\n",a.room,a.scripted,a.playing,a.overridden,a.paused);
 }
 return 0;
}
`)
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I'+path.join(library,'core'),'-I'+path.join(library,'audio')]
 const built=spawnSync('cc',[...flags,fixture,path.join(library,'audio/retro_audio.c'),'-o',binary],{encoding:'utf8'});assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(ran.status,0,ran.stdout.slice(-300)+ran.stderr)
 // Same trace through the preview mixer.
 const lines=[];let mask=0
 const mixer=createAudioMixer({musicCount:5,channels:3,effects:effects.map(([priority,channel])=>({priority,channel})),driver:{
  music:track=>lines.push('M'+track),effect:(e,channel,priority)=>lines.push('E'+e+','+channel+','+priority),pause:paused=>lines.push('P'+(paused?1:0)),busy:channel=>(mask>>(channel-1))&1}})
 const seen={dropped:0,interrupted:0,free:0}
 for(const [kind,argument,busy] of trace){
  mask=busy
  if(kind===0){const p=mixer.playEffect(argument);lines.push('R'+p.channel+','+p.interrupted);if(argument<8){if(!p.channel)seen.dropped++;else if(p.interrupted!==AUDIO_NONE)seen.interrupted++;else seen.free++}}
  else if(kind===1)lines.push('r'+(mixer.roomMusic(argument<0?AUDIO_NONE:argument)?1:0))
  else if(kind===2){if(argument<0)mixer.restoreMusic();else mixer.scriptMusic(argument)}
  else if(kind===3)mixer.pause(argument)
  else mixer.tick()
  const s=mixer.state();lines.push('S'+[s.room,s.scripted,s.playing,s.overridden,s.paused])
 }
 const native=ran.stdout.trim().split('\n');assert.equal(lines.length,native.length)
 lines.forEach((line,index)=>assert.equal(line,native[index],'decision '+index))
 for(const [key,count] of Object.entries(seen))assert.ok(count>50,'trace must exercise '+key+' ('+count+')')
 assert.throws(()=>createAudioMixer({musicCount:1,effects:[{priority:16,channel:0}],channels:3}),/Invalid/)
 assert.throws(()=>createAudioMixer({musicCount:1,effects:[{priority:1,channel:4}],channels:3}),/Invalid/)
 // Real cutscene runner: vocabulary values are the exported catalog numbers.
 const config={...defaultCutsceneConfig(),sounds:[{id:'door',name:'Porta',value:1}],music:[{id:'boss',name:'Chefe',value:2}]}
 const scene={format:'retro-studio.cutscene',version:1,id:'intro',title:'Intro',steps:[
  {type:'music',music:'boss'},{type:'sound',sound:'door'},{type:'wait',frames:5},{type:'sound',sound:'door'},{type:'music',music:'room'},{type:'wait',frames:2}]}
 const story=compileProject([{path:'cutscenes/intro.cutscene.json',scene}],config);assert.deepEqual(story.errors,[])
 fs.writeFileSync(path.join(temporary,'cutscene_ids.h'),story.idsHeader);fs.writeFileSync(path.join(temporary,'cutscene_data.h'),story.dataHeader)
 const storySource=path.join(temporary,'story.c'),storyBinary=path.join(temporary,'story')
 fs.writeFileSync(storySource,`#include <assert.h>
#include <string.h>
#include "retro_audio.h"
#include "cutscene_data.h"
static const RetroAudioEffect effects[]={{2,0},{8,0}};
static int musicCalls,lastMusic=-2,effectCalls,lastEffect=-1;
static void music(void *c,uint16_t track){(void)c;musicCalls++;lastMusic=track;}
static void effect(void *c,uint16_t e,uint8_t channel,uint8_t priority){(void)c;(void)channel;(void)priority;effectCalls++;lastEffect=e;}
int main(void){
 RetroAudioDriver d={music,effect,0,0,0};RetroAudio a;CutsceneRunner runner;CutsceneHost host;int frame,sawScripted=0;
 memset(&a,0,sizeof(a));memset(&host,0,sizeof(host));
 assert(retroAudioInit(&a,&d,3,effects,2,3)&&retroAudioRoomMusic(&a,0)&&musicCalls==1);
 host.context=&a;host.sound=retroAudioCutsceneSound;host.music=retroAudioCutsceneMusic;
 cutsceneInit(&runner,&cutsceneLibrary);assert(cutsceneStart(&runner,&host,CUTSCENE_INTRO));
 for(frame=0;frame<60&&cutsceneIsActive(&runner);frame++){
  retroAudioTick(&a);cutsceneStep(&runner,&host,0);
  if(a.overridden){sawScripted=1;assert(a.playing==2&&lastMusic==2&&a.room==0);}
 }
 /* The scene took the music, played its cue twice and handed the room track back. */
 assert(!cutsceneIsActive(&runner)&&sawScripted&&effectCalls==2&&lastEffect==1);
 assert(!a.overridden&&a.playing==0&&lastMusic==0&&musicCalls==3);
 return 0;
}
`)
 const storyBuilt=spawnSync('cc',[...flags,'-I'+temporary,'-I'+path.dirname(cutscene),storySource,path.join(library,'audio/retro_audio.c'),path.join(cutscene,'cutscene_runner.c'),'-o',storyBinary],{encoding:'utf8'})
 assert.equal(storyBuilt.status,0,storyBuilt.stderr)
 const storyRun=spawnSync(storyBinary,[],{encoding:'utf8'});assert.equal(storyRun.status,0,storyRun.stderr||String(storyRun.signal))
 const cross=process.argv.indexOf('--m68k-cc')
 if(cross>=0){
  const object=path.join(temporary,'audio.o')
  const compiled=spawnSync(process.argv[cross+1],['-m68000','-std=c99','-Wall','-Wextra','-Werror','-O2','-I'+path.join(library,'core'),'-c',path.join(library,'audio/retro_audio.c'),'-o',object],{encoding:'utf8'})
  assert.equal(compiled.status,0,compiled.stderr);console.log('PASS audio module compiled for 68000 ('+fs.statSync(object).size+' bytes object)')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Runtime audio: room music, scripted override and restore, pause, free/interrupt/drop channel policy, fixed channels, same-frame reservation, real cutscene runner, room table and 4000-step C/JS parity passed.')
