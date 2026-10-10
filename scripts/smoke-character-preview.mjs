import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { ref } from 'vue'
import { createCharacterPreview } from '../src/utils/retro/characterPreview.js'
import { normalizeCharacterController } from '../src/utils/retro/characterController.js'
import { buildSgdkAnimationHeader } from '../src/utils/retro/charsetMaker.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-character-preview-'))
try {
 const idle={id:'idle',name:'idle',frameCount:2,loop:true,frames:[{width:32,height:48,durationTicks:2},{width:32,height:48,durationTicks:3}],controller:normalizeCharacterController(null)}
 const sword={id:'sword',name:'sword',frameCount:2,loop:false,frames:[{width:64,height:48,durationTicks:1},{width:64,height:48,durationTicks:2}],controller:normalizeCharacterController(null)}
 idle.controller.events=[{frame:0,type:1,argument:3},{frame:1,type:5,argument:4}]
 idle.controller.transitions=[{target:'sword',requireAll:2,requireNone:1,priority:5,minimumTicks:2,predicate:77,finished:false}]
 sword.controller.interruptible=false;sword.controller.events=[{frame:0,type:2,argument:9}]
 sword.controller.transitions=[{target:'idle',requireAll:0,requireNone:0,priority:0,minimumTicks:0,predicate:65535,finished:true}]
 const animations=[idle,sword],original=JSON.stringify(animations)
 const inputs=Array.from({length:80},(_,i)=>({flags:i%7===0?3:i%3===0?2:0,predicate:i%4<2}))
 const preview=createCharacterPreview(animations,'idle'),trace=[]
 function record(s){for(const e of s.events.filter(e=>e.tick===s.ticks))trace.push(`E,${s.ticks},${animations.findIndex(a=>a.id===e.animationId)},${e.frame},${e.type},${e.argument}`);trace.push(`S,${s.ticks},${animations.findIndex(a=>a.id===s.animationId)},${s.frame},${s.remaining},${s.elapsed},${+s.playing}`)}
 record(preview.snapshot());inputs.forEach(i=>record(preview.tick(i.flags,()=>i.predicate)))
 assert.equal(JSON.stringify(animations),original,'preview cannot edit authoring data')
 const lib=new URL('../assets/toolkit/lib/runtime/',import.meta.url).pathname
 fs.writeFileSync(path.join(temporary,'genesis.h'),`typedef unsigned short u16;
 typedef struct { unsigned short numFrame; } Animation;
 typedef struct { Animation *animation; unsigned short animInd,frameInd,timer; } Sprite;
 static inline void SPR_setFrameChangeCallback(Sprite*s,void(*cb)(Sprite*)){(void)s;(void)cb;}
 static inline void SPR_setAnim(Sprite*s,u16 a){(void)s;(void)a;}
 `)
 fs.writeFileSync(path.join(temporary,'character.h'),buildSgdkAnimationHeader('ninja',animations))
 fs.writeFileSync(path.join(temporary,'test.c'),`#include <stdio.h>
 #include "retro_character.h"
 #include "character.h"
 static unsigned tick=0, predicateValue=0;
 static uint8_t condition(void*ctx,uint16_t id){(void)ctx;(void)id;return predicateValue;}
 static void event(void*ctx,uint16_t state,const RetroCharacterEvent*e){(void)ctx;printf("E,%u,%u,%u,%u,%u\\n",tick,state,e->frame,e->type,e->argument);}
 static void print(const RetroCharacter*c){printf("S,%u,%u,%u,%u,%u,%u\\n",tick,retroCharacterStateId(c),c->animation.frame,c->animation.remaining,c->elapsed,c->animation.playing);}
 int main(void){RetroCharacter c={0};RetroCharacterHost h={0,condition,0,0,event};
 const unsigned flags[]={${inputs.map(i=>i.flags).join(',')}};
 const unsigned predicates[]={${inputs.map(i=>+i.predicate).join(',')}};
 unsigned i;
 if(!retroCharacterInit(&c,&ninja_character_definition,NINJA_ANIM_IDLE,&h))return 1;
 print(&c);
 for(i=0;i<${inputs.length};i++){tick++;predicateValue=predicates[i];retroCharacterTick(&c,flags[i]);print(&c);}
 return 0;}
 `)
 const binary=path.join(temporary,'test')
 const built=spawnSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-I'+temporary,'-I'+path.join(lib,'character'),'-I'+path.join(lib,'core'),path.join(temporary,'test.c'),path.join(lib,'character/retro_character.c'),path.join(lib,'core/retro_core.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(built.status,0,built.stderr)
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr)
 assert.deepEqual(run.stdout.trim().split('\n'),trace,'preview trace must match actual generated C controller')
 const reentrant=createCharacterPreview(animations,'idle')
 reentrant.tick(0)
 const second=reentrant.tick(2,()=>{const inner=reentrant.tick(2);assert.equal(inner.ticks,2);return true})
 assert.equal(second.ticks,2);assert.equal(second.animationId,'sword')
 const source=fs.readFileSync(new URL('../src/components/retro/CharsetMaker.vue',import.meta.url),'utf8')
 let timers=0,clears=0,canvasClears=0
 const context={behaviorPlaying:ref(false),behaviorTimer:null,behaviorTicket:0,behaviorState:ref(null),behaviorEngine:null,behaviorError:ref(''),
  behaviorPredicates:ref('77'),behaviorConditions:ref(2),behaviorCanvas:ref({width:64,height:48,getContext(){return {clearRect(){canvasClears++}}}}),sheetImage:ref(null),
  selectedAnimation:ref(idle),selectedAnimationId:ref('idle'),animations:ref(animations),inspectorTab:ref('behavior'),
  props:{active:true},reducedMotion:ref(false),previewHz:ref(60),createCharacterPreview,
  nextTick(fn){fn()},stopPlayback(){context.behaviorPlaying.value=false},
  clearTimeout(){clears++},setTimeout(fn){timers++;context.callback=fn;return timers}}
 vm.createContext(context)
 const start=source.indexOf('function stopBehaviorPreview()'),end=source.indexOf('watch([animations, selectedAnimationId, inspectorTab]',start)
 vm.runInContext(source.slice(start,end),context)
 context.resetBehaviorPreview();assert.equal(canvasClears,1);context.stepBehaviorPreview()
 assert.equal(context.behaviorState.value.ticks,1);assert.equal(JSON.stringify(animations),original)
 context.toggleBehaviorPreview();assert.equal(timers,1)
 const stale=context.callback
 context.stopBehaviorPreview();stale();assert.equal(context.behaviorState.value.ticks,1,'paused callbacks cannot advance the engine')
 assert.equal(context.behaviorPlaying.value,false);assert.ok(clears)
 context.props.active=false;context.stepBehaviorPreview();assert.equal(context.behaviorState.value.ticks,1)
 context.props.active=true;context.behaviorPredicates.value='bad';context.stepBehaviorPreview();assert.match(context.behaviorError.value,/predicado/)
 context.reducedMotion.value=true;context.toggleBehaviorPreview();assert.equal(context.behaviorPlaying.value,false)
} finally {fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Character preview: 80-tick generated C parity, events, conditions, predicates, readonly authoring and playback lifecycle passed.')
