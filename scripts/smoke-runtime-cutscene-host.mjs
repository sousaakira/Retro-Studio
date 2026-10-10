// #63: reference cutscene host with the real runner, camera, audio and progress modules.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {compileProject,defaultCutsceneConfig} from '../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-cutscene-host-'))
const library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
const cutscene=fileURLToPath(new URL('../assets/toolkit/lib/cutscene/src/',import.meta.url))
try{
 const config={...defaultCutsceneConfig(),actors:[{id:'hero',name:'Herói',value:0},{id:'cat',name:'Gato',value:1}],animations:[{id:'wave',value:5}],
  sounds:[{id:'door',value:1}],music:[{id:'boss',value:2}],abilities:[{id:'dash',value:3}],events:[{id:'shake',value:4}],flags:[{id:'met_cat'},{id:'door_open'},{id:'unused'}]}
 const meet={format:'retro-studio.cutscene',version:1,id:'meet',title:'Encontro',steps:[
  {type:'music',music:'boss'},{type:'camera',mode:'x',x:300,speed:2,wait:true},
  {type:'move',actor:'cat',x:-40,relative:true,speed:2,wait:true},{type:'face',actor:'cat',direction:'left'},{type:'animate',actor:'cat',animation:'wave'},
  {type:'say',actor:'cat',speaker:'Gato',portrait:'',side:'left',text:'Ola. Quer abrir a porta?'},
  {type:'choice',prompt:'Abrir?',default:1,options:[{text:'Sim',steps:[{type:'set_flag',flag:'door_open',value:true},{type:'sound',sound:'door'}]},{text:'Nao',steps:[{type:'wait',frames:3}]}]},
  {type:'fade',direction:'out',frames:8},{type:'place',actor:'hero',x:500},{type:'show',actor:'cat',visible:false},{type:'fade',direction:'in',frames:8},
  {type:'ability',ability:'dash'},{type:'event',event:'shake',arg:7},{type:'set_flag',flag:'met_cat',value:true},{type:'animate',actor:'cat',animation:'auto'},{type:'wait',frames:20}]}
 const again={format:'retro-studio.cutscene',version:1,id:'again',title:'De novo',steps:[{type:'say',actor:'cat',speaker:'Gato',portrait:'',side:'left',text:'De novo?'}]}
 const compiled=compileProject([{path:'cutscenes/again.cutscene.json',scene:again},{path:'cutscenes/meet.cutscene.json',scene:meet}],config)
 assert.deepEqual(compiled.errors,[])
 fs.writeFileSync(path.join(temporary,'cutscene_ids.h'),compiled.idsHeader);fs.writeFileSync(path.join(temporary,'cutscene_data.h'),compiled.dataHeader)
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,`#include <assert.h>
#include <string.h>
#include "retro_cutscene_host.h"
#include "cutscene_data.h"
#define Q(n) ((RetroFixed)(n)*256)
static const RetroAudioEffect effects[]={{2,0},{8,0}};
static int musicCalls,lastMusic,effectCalls,abilities,events,eventArg,finishedCalls,finishedScript;
static void music(void *c,uint16_t track){(void)c;musicCalls++;lastMusic=track;}
static void effect(void *c,uint16_t e,uint8_t channel,uint8_t p){(void)c;(void)e;(void)channel;(void)p;effectCalls++;}
static void ability(void *c,int a){(void)c;assert(a==3);abilities++;}
static void event(void *c,int e,int arg){(void)c;assert(e==4);events++;eventArg=arg;}
static RetroCutsceneHost *chain;static int chained;
static void finished(void *c,int script){(void)c;finishedCalls++;finishedScript=script;if(chain&&script==CUTSCENE_MEET&&!chained)chained=retroCutsceneHostStart(chain,CUTSCENE_AGAIN);}
static const CutsceneTrigger triggers[]={
 {200,100,40,60,CUTSCENE_MEET,CUTSCENE_START_TOUCH,1,-1,-1},
 {400,100,40,60,CUTSCENE_AGAIN,CUTSCENE_START_INTERACT,0,CUTSCENE_FLAG_MET_CAT,-1},
 {0,0,1,1,CUTSCENE_AGAIN,CUTSCENE_START_ENTER,0,-1,CUTSCENE_FLAG_MET_CAT}};
static const RetroCutsceneFlagLink links[]={{CUTSCENE_FLAG_MET_CAT,0},{CUTSCENE_FLAG_DOOR_OPEN,9}};
static const RetroProgressConfig progressConfig={{1,16,12},0,0,0,0};
typedef struct {RetroCutsceneActor actors[2];RetroCameraConfig cc;RetroCamera cam;RetroAudio audio;RetroCutsceneHost host;} World;
static void setup(World *w){
 RetroAudioDriver d={music,effect,0,0,0};RetroCutsceneHooks hooks={ability,event,finished,0};
 memset(w,0,sizeof(*w));musicCalls=effectCalls=abilities=events=finishedCalls=0;
 w->actors[0].x=100;w->actors[0].y=150;w->actors[0].visible=1;w->actors[0].animation=RETRO_ID_NONE;
 w->actors[1].x=340;w->actors[1].y=150;w->actors[1].visible=1;w->actors[1].animation=RETRO_ID_NONE;
 retroCameraPreset(&w->cc);w->cc.lookAheadX=0;
 assert(retroCameraInit(&w->cam,320,224)&&retroCameraEnterRoom(&w->cam,&w->cc,1280,224,0,0,Q(100),Q(150),0));
 assert(retroAudioInit(&w->audio,&d,3,effects,2,3)&&retroAudioRoomMusic(&w->audio,0));
 assert(retroCutsceneHostInit(&w->host,&cutsceneLibrary,w->actors,2,&w->cam,&w->audio,&hooks,320));
}
/* Plays the meeting scene. skipAt < 0: never skip. choose: 0 = first option, 1 = default. */
static int play(World *w,int skipAt,int choose,int *sceneFrames){
 int frame,control,owned=0,sawDialogue=0,sawChoice=0,sawDark=0,sawWave=0,sawScript=0,x=100;
 for(frame=0;frame<2000;frame++){
  unsigned int input=0;
  if(frame==skipAt)input=CUTSCENE_INPUT_SKIP;
  else if(w->host.dialogueVisible)input=CUTSCENE_INPUT_CONFIRM;
  else if(w->host.choiceVisible)input=choose==0&&w->host.choice.cursor!=0?CUTSCENE_INPUT_UP:CUTSCENE_INPUT_CONFIRM;
  if(frame<60)x+=2; /* the player walks into the touch trigger */
  retroAudioTick(&w->audio);
  control=retroCutsceneHostUpdate(&w->host,triggers,3,(int16_t)x,150,input,0);
  if(control==RETRO_CUTSCENE_CONTROL_SCENE){
   owned++;
   if(w->host.dialogueVisible){sawDialogue=1;assert(!strcmp(w->host.dialogue.speaker,"GATO")&&w->host.dialogue.lineCount>=1&&w->host.dialogue.actor==1);}
   if(w->host.choiceVisible){sawChoice=1;assert(w->host.choice.count==2&&!strcmp(w->host.choice.options[0],"Sim"));}
   if(w->host.dark)sawDark=1;
   if(w->actors[1].animation==5)sawWave=1;
   if(w->audio.overridden)sawScript=1;
   x=w->actors[0].x; /* the game mirrors the hero actor while the scene owns it */
  }else if(owned)break;
  else{w->actors[0].x=(int16_t)x;}
  retroCameraTick(&w->cam,&w->cc,Q(w->actors[0].x),Q(150),0);
 }
 assert(frame<2000&&owned&&sawScript);
 if(skipAt<0)assert(sawDialogue&&sawChoice&&sawDark&&sawWave);
 if(sceneFrames)*sceneFrames=owned;
 return frame;
}
typedef struct {RetroCutsceneActor actors[2];int flags[3],played[2],music,overridden,dark,follow,script,scripted;} Result;
static Result result(World *w){
 Result r;int i;memset(&r,0,sizeof(r));
 memcpy(r.actors,w->actors,sizeof(r.actors));for(i=0;i<2;i++)r.actors[i].changed=0;
 for(i=0;i<3;i++)r.flags[i]=cutsceneFlag(&w->host.runner,i);
 r.played[0]=cutscenePlayed(&w->host.runner,CUTSCENE_AGAIN);r.played[1]=cutscenePlayed(&w->host.runner,CUTSCENE_MEET);
 r.music=w->audio.playing;r.overridden=w->audio.overridden;r.dark=w->host.dark;r.follow=w->host.cameraFollow;r.script=w->cam.script;r.scripted=w->audio.scripted;
 return r;
}
int main(void){
 static World w,other;Result full,skipped;RetroProgress progress,copy;int frames,skipFrames,at,i;uint16_t count;
 static const RetroCutsceneRoomTriggers rooms[]={{77,triggers,3}};
 /* Contract. */
 memset(&w,0,sizeof(w));
 assert(!retroCutsceneHostInit(0,&cutsceneLibrary,w.actors,2,0,0,0,320)&&!retroCutsceneHostInit(&w.host,0,w.actors,2,0,0,0,320));
 assert(!retroCutsceneHostInit(&w.host,&cutsceneLibrary,0,2,0,0,0,320)&&!retroCutsceneHostInit(&w.host,&cutsceneLibrary,w.actors,9,0,0,0,320)&&!w.host.ready);
 assert(retroCutsceneHostUpdate(&w.host,triggers,3,220,150,0,0)==RETRO_CUTSCENE_CONTROL_PLAYER&&!retroCutsceneHostStart(&w.host,0));
 assert(retroCutsceneRoomTriggers(rooms,1,77,&count)==triggers&&count==3&&!retroCutsceneRoomTriggers(rooms,1,5,&count)&&!count&&!retroCutsceneRoomTriggers(0,1,77,&count));
 /* Full run: every module was driven and the scene handed everything back. */
 setup(&w);play(&w,-1,0,&frames);full=result(&w);
 assert(full.actors[0].x==500&&full.actors[1].x==300&&full.actors[1].facingLeft&&!full.actors[1].visible&&full.actors[1].animation==RETRO_ID_NONE&&!full.actors[1].moving);
 assert(full.flags[0]==1&&full.flags[1]==1&&full.flags[2]==0&&full.played[1]&&!full.played[0]);
 assert(full.music==0&&!full.overridden&&lastMusic==0&&musicCalls==3&&effectCalls==1); /* room music is back */
 assert(!full.dark&&full.follow&&!full.script&&abilities==1&&events==1&&eventArg==7&&finishedCalls==1&&finishedScript==CUTSCENE_MEET);
 assert(w.host.control==RETRO_CUTSCENE_CONTROL_PLAYER&&!w.host.dialogueVisible&&!w.host.choiceVisible&&w.host.script==CUTSCENE_MEET);
 /* The other branch only differs in what the branch itself does. */
 setup(&other);play(&other,-1,1,0);skipped=result(&other);
 assert(skipped.flags[1]==0&&skipped.flags[0]==1&&effectCalls==0&&skipped.actors[0].x==500);
 /* Skipping on any frame ends in the same state as playing with the default choice
  * (sounds are not replayed; one-shot abilities and events still happen once). */
 for(at=0;at<frames+40;at+=3){
  setup(&other);play(&other,31+at,1,&skipFrames);(void)skipFrames;full=result(&other);
  assert(!memcmp(&full,&skipped,sizeof(full)));
  assert(abilities==1&&events==1&&finishedCalls==1&&other.host.control==RETRO_CUTSCENE_CONTROL_PLAYER&&!other.host.dialogueVisible&&!other.host.choiceVisible);
 }
 /* Control rules: the frame after the end still belongs to the scene, then the player. */
 setup(&w);assert(retroCutsceneHostStart(&w.host,CUTSCENE_AGAIN)&&w.host.control==RETRO_CUTSCENE_CONTROL_SCENE&&!retroCutsceneHostStart(&w.host,CUTSCENE_MEET));
 assert(retroCutsceneHostUpdate(&w.host,triggers,3,220,150,0,0)==RETRO_CUTSCENE_CONTROL_SCENE&&w.host.dialogueVisible&&w.host.textChanged);
 assert(retroCutsceneHostUpdate(&w.host,triggers,3,220,150,0,1)==RETRO_CUTSCENE_CONTROL_SCENE&&cutsceneIsActive(&w.host.runner)); /* no trigger while a scene runs */
 assert(!retroCutsceneHostStore(&w.host,&progress,&progressConfig,links,2,0,8)&&!retroCutsceneHostLoad(&w.host,&progress,&progressConfig,links,2,0,8));
 assert(retroCutsceneHostUpdate(&w.host,triggers,3,220,150,CUTSCENE_INPUT_CONFIRM,0)==RETRO_CUTSCENE_CONTROL_SCENE&&!cutsceneIsActive(&w.host.runner)&&finishedCalls==1);
 assert(retroCutsceneHostUpdate(&w.host,triggers,3,0,0,CUTSCENE_INPUT_CONFIRM,0)==RETRO_CUTSCENE_CONTROL_SCENE&&w.host.control==RETRO_CUTSCENE_CONTROL_PLAYER);
 /* Triggers: touch on entry only, once, interact with a required flag, enter per room. */
 assert(retroCutsceneHostUpdate(&w.host,triggers,3,0,50,0,0)==RETRO_CUTSCENE_CONTROL_PLAYER); /* enter needs retroCutsceneHostRoom */
 retroCutsceneHostRoom(&w.host);assert(retroCutsceneHostUpdate(&w.host,triggers,3,0,50,0,0)==RETRO_CUTSCENE_CONTROL_SCENE&&w.host.script==CUTSCENE_AGAIN);
 for(i=0;i<4;i++)retroCutsceneHostUpdate(&w.host,triggers,3,0,50,CUTSCENE_INPUT_SKIP,0);
 assert(w.host.control==RETRO_CUTSCENE_CONTROL_PLAYER&&retroCutsceneHostUpdate(&w.host,triggers,3,0,50,0,0)==RETRO_CUTSCENE_CONTROL_PLAYER);
 assert(retroCutsceneHostUpdate(&w.host,triggers,3,420,150,0,1)==RETRO_CUTSCENE_CONTROL_PLAYER); /* interact needs met_cat */
 assert(retroCutsceneHostUpdate(&w.host,triggers,3,220,150,0,0)==RETRO_CUTSCENE_CONTROL_SCENE&&w.host.script==CUTSCENE_MEET);
 for(i=0;i<6;i++)retroCutsceneHostUpdate(&w.host,triggers,3,220,150,CUTSCENE_INPUT_SKIP,0);
 assert(w.host.control==RETRO_CUTSCENE_CONTROL_PLAYER&&cutsceneFlag(&w.host.runner,CUTSCENE_FLAG_MET_CAT));
 assert(retroCutsceneHostUpdate(&w.host,triggers,3,220,150,0,0)==RETRO_CUTSCENE_CONTROL_PLAYER); /* once */
 assert(retroCutsceneHostUpdate(&w.host,triggers,3,420,150,0,0)==RETRO_CUTSCENE_CONTROL_PLAYER&&retroCutsceneHostUpdate(&w.host,triggers,3,420,150,0,1)==RETRO_CUTSCENE_CONTROL_SCENE);
 for(i=0;i<4;i++)retroCutsceneHostUpdate(&w.host,triggers,3,420,150,CUTSCENE_INPUT_SKIP,0);
 retroCutsceneHostRoom(&w.host);assert(retroCutsceneHostUpdate(&w.host,triggers,3,0,50,0,0)==RETRO_CUTSCENE_CONTROL_PLAYER); /* unless_flag */
 /* A touch scene found first does not swallow the room's enter trigger: it runs right after. */
 {static const CutsceneTrigger both[]={{0,0,400,400,CUTSCENE_MEET,CUTSCENE_START_TOUCH,1,-1,-1},{0,0,1,1,CUTSCENE_AGAIN,CUTSCENE_START_ENTER,1,-1,-1}};
  setup(&other);retroCutsceneHostRoom(&other.host);
  assert(retroCutsceneHostUpdate(&other.host,both,2,50,50,0,0)==RETRO_CUTSCENE_CONTROL_SCENE&&other.host.script==CUTSCENE_MEET);
  for(i=0;i<8&&other.host.control==RETRO_CUTSCENE_CONTROL_SCENE;i++)retroCutsceneHostUpdate(&other.host,both,2,50,50,CUTSCENE_INPUT_SKIP,0);
  assert(other.host.control==RETRO_CUTSCENE_CONTROL_PLAYER&&!cutscenePlayed(&other.host.runner,CUTSCENE_AGAIN));
  assert(retroCutsceneHostUpdate(&other.host,both,2,50,50,0,0)==RETRO_CUTSCENE_CONTROL_SCENE&&other.host.script==CUTSCENE_AGAIN);
  for(i=0;i<8&&other.host.control==RETRO_CUTSCENE_CONTROL_SCENE;i++)retroCutsceneHostUpdate(&other.host,both,2,50,50,CUTSCENE_INPUT_SKIP,0);
  assert(cutscenePlayed(&other.host.runner,CUTSCENE_AGAIN)&&retroCutsceneHostUpdate(&other.host,both,2,50,50,0,0)==RETRO_CUTSCENE_CONTROL_PLAYER);}
 /* Scenes can be chained from the finished hook: the player never gets a frame in between. */
 setup(&other);chain=&other.host;chained=0;assert(retroCutsceneHostStart(&other.host,CUTSCENE_MEET));
 for(i=0;i<8&&!chained;i++)assert(retroCutsceneHostUpdate(&other.host,0,0,0,0,CUTSCENE_INPUT_SKIP,0)==RETRO_CUTSCENE_CONTROL_SCENE);
 assert(chained&&cutsceneIsActive(&other.host.runner)&&other.host.script==CUTSCENE_AGAIN&&other.host.control==RETRO_CUTSCENE_CONTROL_SCENE);
 for(i=0;i<8&&other.host.control==RETRO_CUTSCENE_CONTROL_SCENE;i++)assert(retroCutsceneHostUpdate(&other.host,0,0,0,0,CUTSCENE_INPUT_SKIP,0)==RETRO_CUTSCENE_CONTROL_SCENE);
 assert(other.host.control==RETRO_CUTSCENE_CONTROL_PLAYER&&cutscenePlayed(&other.host.runner,CUTSCENE_AGAIN)&&finishedCalls==2);chain=0;
 /* Progress: flags by link, played history in a data field; a continued game behaves the same. */
 assert(retroProgressNew(&progress,&progressConfig));progress.data[0]=0x5A;progress.data[9]=0x5A;
 assert(retroCutsceneHostStore(&w.host,&progress,&progressConfig,links,2,1,8));
 assert(retroProgressFlag(&progress,&progressConfig,0)==1&&retroProgressFlag(&progress,&progressConfig,9)==0&&progress.data[0]==0x5A&&progress.data[9]==0x5A&&progress.data[1]==3);
 copy=progress;assert(!retroCutsceneHostStore(&w.host,&progress,&progressConfig,links,2,8,8)&&!retroCutsceneHostStore(&w.host,&progress,&progressConfig,links,2,0,9));
 {RetroCutsceneFlagLink bad[]={{0,16}};assert(!retroCutsceneHostStore(&w.host,&progress,&progressConfig,bad,1,0,0));}
 assert(!memcmp(&copy,&progress,sizeof(progress)));
 setup(&other);assert(retroCutsceneHostLoad(&other.host,&progress,&progressConfig,links,2,1,8));
 assert(cutsceneFlag(&other.host.runner,CUTSCENE_FLAG_MET_CAT)&&!cutsceneFlag(&other.host.runner,CUTSCENE_FLAG_DOOR_OPEN)&&cutscenePlayed(&other.host.runner,CUTSCENE_MEET)&&cutscenePlayed(&other.host.runner,CUTSCENE_AGAIN));
 assert(retroCutsceneHostUpdate(&other.host,triggers,3,220,150,0,0)==RETRO_CUTSCENE_CONTROL_PLAYER); /* once survives the save */
 /* Without camera and audio the host still runs every scene. */
 memset(&w,0,sizeof(w));assert(retroCutsceneHostInit(&w.host,&cutsceneLibrary,w.actors,2,0,0,0,320)&&retroCutsceneHostStart(&w.host,CUTSCENE_MEET));
 for(i=0;i<3000&&w.host.control==RETRO_CUTSCENE_CONTROL_SCENE;i++)retroCutsceneHostUpdate(&w.host,0,0,0,0,w.host.dialogueVisible||w.host.choiceVisible?CUTSCENE_INPUT_CONFIRM:0,0);
 assert(i<3000&&w.actors[0].x==500&&w.host.cameraFollow&&cutsceneFlag(&w.host.runner,CUTSCENE_FLAG_MET_CAT));
 return 0;
}
`)
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-fsanitize=address,undefined',...['core','camera','audio','progress','cutscene'].map(dir=>'-I'+path.join(library,dir)),'-I'+cutscene,'-I'+temporary]
 const sources=['camera/retro_camera.c','audio/retro_audio.c','progress/retro_progress.c','cutscene/retro_cutscene_host.c'].map(file=>path.join(library,file)).concat(path.join(cutscene,'retrostudio/cutscene_runner.c'))
 const built=spawnSync('cc',[...flags,fixture,...sources,'-o',binary],{encoding:'utf8'});assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8'});assert.equal(ran.status,0,ran.stdout+ran.stderr)
 const cross=process.argv.indexOf('--m68k-cc')
 if(cross>=0){
  const object=path.join(temporary,'host.o')
  const compiledObject=spawnSync(process.argv[cross+1],['-m68000','-std=c99','-Wall','-Wextra','-Werror','-O2',...['core','camera','audio','progress'].map(dir=>'-I'+path.join(library,dir)),'-I'+cutscene,'-c',path.join(library,'cutscene/retro_cutscene_host.c'),'-o',object],{encoding:'utf8'})
  assert.equal(compiledObject.status,0,compiledObject.stderr);console.log('PASS cutscene host compiled for 68000 ('+fs.statSync(object).size+' bytes object)')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Cutscene host: actors, animations, dialogue, choice, camera, fade, music, sound, hooks, skip-on-any-frame consistency, control rules, triggers, progress links and module-free mode passed.')
