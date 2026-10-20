// #49: exported feet-relative geometry consumed by the collision/combat runtime.
import {toPortablePath,samePortablePath} from '../shared/retro/portablePath.js'
import {validateCharsetSourceReferences} from '../shared/retro/charsetSources.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import vm from 'node:vm'
import {validateCharacterControllers,normalizeCharacterController} from '../src/utils/retro/characterController.js'
import {buildSgdkAnimationHeader,charsetGeometryHeader,charsetAnchor,charsetFrameAnchor,getCharsetFrameGrid,SGDK_SPRITE_FRAME_LIMIT} from '../src/utils/retro/charsetMaker.js'
import {charsetFrameOffset,charsetProjectVersion} from '../shared/retro/charsetAlignment.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-character-geometry-'))
const library=new URL('../assets/toolkit/lib/runtime/',import.meta.url).pathname
try {
 const animations=[{id:'sword',name:'sword',frameCount:3,loop:false,fps:8,
  frames:Array.from({length:3},()=>({width:80,height:48,anchorX:24,anchorY:48,durationTicks:1})),
  attack:{enabled:true,x:4,y:-32,width:36,height:16,firstFrame:1,lastFrame:2}}]
 const body={x:-8,y:-40,width:16,height:40}
 const header=buildSgdkAnimationHeader('ninja',animations).replace(/\n#endif\s*$/,
  '\n'+charsetGeometryHeader('ninja',animations,body,{custom:true,x:-5,y:-30,width:10,height:28})+'\n#endif\n')
 fs.writeFileSync(path.join(temporary,'ninja.h'),header)
 fs.writeFileSync(path.join(temporary,'default.h'),charsetGeometryHeader('default_ninja',animations,body))
 fs.writeFileSync(path.join(temporary,'genesis.h'),`#ifndef TEST_GENESIS_H
#define TEST_GENESIS_H
typedef unsigned short u16;typedef short s16;
typedef struct {u16 numFrame;} Animation;
typedef struct {Animation*animation;u16 animInd,frameInd,timer;} Sprite;
static inline void SPR_setFrameChangeCallback(Sprite*s,void(*cb)(Sprite*)){(void)s;(void)cb;}
static inline void SPR_setAnim(Sprite*s,u16 a){(void)s;(void)a;}
#endif
`)
 const source=path.join(temporary,'test.c')
 fs.writeFileSync(source,`#include <assert.h>
#include <limits.h>
#include "retro_character.h"
#include "retro_collision.h"
#include "retro_combat.h"
#include "ninja.h"
#include "default.h"
#define Q(n) ((RetroFixed)(n)*256)
int main(void){
 RetroCharacter c={0};RetroRect world={7,8,9,10},hurt={108,68,16,40};
 RetroRect invalid={0,0,0,2},local={-8,-40,16,40},alias=local;
 RetroAttackState attack={0};RetroCombatant target={10,0,1};
 assert(ninja_attack_boxes[0][0]==1&&ninja_attack_boxes[0][5]==1);
 assert(ninja_body_box.width==16&&NINJA_FRAME_WIDTH==80);
 assert(ninja_hurt_box.x==-5&&ninja_hurt_box.width==10&&NINJA_HURT_HEIGHT==28);
 assert(default_ninja_hurt_box.x==default_ninja_body_box.x&&default_ninja_hurt_box.width==16);
 assert(default_ninja_attack_boxes[0][0]==default_ninja_attack_geometry[0].enabled);
 assert(retroWorldRect(&ninja_body_box,Q(100),Q(100),0,0,&world));
 assert(world.x==92&&world.y==60&&world.width==16&&world.height==40);
 assert(retroWorldRect(&local,-1,-1,0,0,&world));assert(world.x==-9&&world.y==-41);
 assert(retroWorldRect(&alias,Q(100),Q(100),1,1,&alias));assert(alias.x==92&&alias.y==100);
 assert(!retroWorldRect(&invalid,0,0,0,0,&world));assert(world.x==-9);
 assert(!retroWorldRect(&local,INT32_MAX,0,0,0,&world));assert(world.x==-9);
 assert(!retroWorldRect(&local,Q(-32768),0,0,0,&world));assert(world.x==-9);
 assert(!retroWorldRect(0,0,0,0,0,&world));assert(!retroWorldRect(&local,0,0,0,0,0));
 assert(retroCharacterInit(&c,&ninja_character_definition,NINJA_ANIM_SWORD,0));
 assert(!retroFrameWorldRect(&ninja_attack_geometry[0],c.animation.frame,Q(100),Q(100),0,0,&world));
 assert(world.x==-9);
 retroCharacterTick(&c,0);
 assert(retroFrameWorldRect(&ninja_attack_geometry[0],c.animation.frame,Q(100),Q(100),0,0,&world));
 assert(world.x==104&&world.y==68&&world.width==36);
 assert(retroAttackBegin(&attack,0,3,1));
 assert(retroAttackApply(&attack,&world,&target,&hurt,0,3,0,0,0,0,0)==RETRO_DAMAGE_HIT);
 assert(target.health==7);
 assert(retroFrameWorldRect(&ninja_attack_geometry[0],2,Q(100),Q(100),1,1,&world));
 assert(world.x==60&&world.y==116);
 assert(!retroFrameWorldRect(&ninja_attack_geometry[0],3,Q(100),Q(100),0,0,&world));assert(world.x==60);
 {RetroFrameBox bad=ninja_attack_geometry[0];bad.enabled=0;
  assert(!retroFrameWorldRect(&bad,1,0,0,0,0,&world));bad.enabled=1;bad.firstFrame=3;
  assert(!retroFrameWorldRect(&bad,2,0,0,0,0,&world));}
 /* Body geometry remains local for movement; artwork width never becomes body width. */
 {RetroBody b={Q(100),Q(100),ninja_body_box,1};RetroCollider wall={{120,0,8,200},1,RETRO_COLLIDER_SOLID};
  RetroMoveResult moved=retroMoveBody(&b,Q(100),0,&wall,1,0);
  assert(!moved.invalid&&b.x==Q(112)&&moved.contacts==RETRO_CONTACT_RIGHT);}
 return 0;
}
`)
 const flags=['-std=c99','-Wall','-Wextra','-Werror','-I'+temporary,
  ...['core','character','collision'].map(dir=>'-I'+path.join(library,dir))]
 const sources=['core/retro_core.c','character/retro_character.c','collision/retro_collision.c','collision/retro_combat.c'].map(f=>path.join(library,f))
 const binary=path.join(temporary,'test')
 const built=spawnSync('cc',[...flags,source,...sources,'-o',binary],{encoding:'utf8'})
 assert.equal(built.status,0,built.stderr)
 const ran=spawnSync(binary,[],{encoding:'utf8'});assert.equal(ran.status,0,ran.stderr)
 // Legacy consumers compile without the optional runtime types.
 fs.writeFileSync(source,'#include "ninja.h"\nint main(void){return ninja_attack_boxes[0][0]!=1;}\n')
 const legacy=spawnSync('cc',[...flags,source,'-o',binary],{encoding:'utf8'})
 assert.equal(legacy.status,0,legacy.stderr)
 const index=process.argv.indexOf('--m68k-cc')
 if(index>=0){
  const cross=spawnSync(process.argv[index+1],['-m68000','-Os',...flags,'-c',path.join(library,'collision/retro_collision.c'),'-o',path.join(temporary,'collision.o')],{encoding:'utf8'})
  assert.equal(cross.status,0,cross.stderr||cross.error?.message)
  console.log('PASS exported geometry helpers compiled for 68000')
 }
 // Execute real SFC persistence/restore methods with a minimal host.
 const sfc=fs.readFileSync(new URL('../src/components/retro/CharsetMaker.vue',import.meta.url),'utf8')
 function code(name){const start=sfc.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0);const tail=sfc.slice(start);const end=tail.search(/\n(?:async )?function /);return end<0?tail:tail.slice(0,end)}
 const createCode=code('createCharsetProjectData')
 const context={Number,JSON,Math,Object,toPortablePath,samePortablePath,props:{projectPath:'/game'},validateCharacterControllers,normalizeCharacterController,validateCharsetSourceReferences,charsetAnchor,charsetFrameAnchor,charsetFrameOffset,charsetProjectVersion,getCharsetFrameGrid,SGDK_SPRITE_FRAME_LIMIT,
  getCharsetProjectFilePath:()=>'/game/charsets/ninja.charset.json',
  normalizeName:v=>String(v||'ninja'),migrationBackup:null,
  window:{retroStudio:{async readTextFileOptional(){return context.savedRaw}}}}
 for(const match of createCode.matchAll(/\b(\w+)\.value/g))context[match[1]]={value:0}
 Object.assign(context,{
  sourceFile:{value:{path:'/source/ninja.png',name:'ninja.png'}},sourceFileName:{value:'ninja.png'},
  activeProjectPath:{value:'/game/charsets/ninja.charset.json'},legacySessionPath:{value:''},
  selectedAnimation:{value:null},sheetImage:{value:{naturalWidth:160,naturalHeight:160}},
  bodyBox:{value:body},hurtBox:{value:{custom:true,x:-5,y:-30,width:10,height:28}},
  exportLayout:{value:{anchorX:24,anchorY:48}},animations:{value:[]},
  selectedAnimationId:{value:''},savedSelection:{value:null},animationName:{value:'idle'},
  characterName:{value:'ninja'},spriteName:{value:'SPR_NINJA'},captureMode:{value:'grid'}})
 const sheet={id:'sheet-1',name:'ninja.png',path:'/source/ninja.png',image:context.sheetImage.value}
 Object.assign(context,{sheets:{value:[sheet]},activeSourceId:{value:'sheet-1'},characterId:{value:'ninja-id'},sheetImageCache:new Map([['sheet-1',sheet]]),loadRulerGuides(){}})
 vm.createContext(context)
 for(const name of ['normalizeBox','normalizeAttack','createCharsetProjectData','prepareCharsetSources','restoreCharsetProject','applyCharsetProjectData','copyBodyToHurtBox'])vm.runInContext(code(name),context)
 const saved=context.createCharsetProjectData();assert.equal(saved.version,7)
 assert.deepEqual(JSON.parse(JSON.stringify(saved.hurtBox)),{custom:true,x:-5,y:-30,width:10,height:28})
 context.savedRaw=JSON.stringify(saved);context.hurtBox.value={custom:false}
 assert.equal(await context.restoreCharsetProject(),true)
 assert.equal(context.hurtBox.value.custom,true);assert.equal(context.hurtBox.value.width,10)
 const legacySaved={...saved,version:5};delete legacySaved.hurtBox
 context.savedRaw=JSON.stringify(legacySaved);assert.equal(await context.restoreCharsetProject(),true)
 assert.equal(context.hurtBox.value.custom,false);assert.equal(context.hurtBox.value.width,body.width)
 assert.equal(context.migrationBackup.raw,context.savedRaw,'migration backs up the original source')
 context.bodyBox.value={x:-3,y:-22,width:6,height:22};context.copyBodyToHurtBox()
 assert.equal(context.hurtBox.value.custom,true);assert.equal(context.hurtBox.value.width,6)
 assert.equal(context.createCharsetProjectData().hurtBox.width,6)
 // Mixed-sheet frames are bounded by their own image, independent of the visible sheet.
 const swordSheet={id:'sword-sheet',name:'sword.png',path:'/source/sword.png',image:{naturalWidth:16,naturalHeight:16}}
 context.sheetImageCache.set(swordSheet.id,swordSheet)
 const mixed={...saved,sources:[saved.sources[0],{id:swordSheet.id,name:swordSheet.name,path:swordSheet.path}],activeSourceId:swordSheet.id,
  animations:[{id:'attack',name:'attack',region:{x:80,y:0,width:48,height:48},frameWidth:48,frameHeight:48,frames:[
   {sourceId:'sheet-1',x:80,y:0,width:48,height:48},
   {sourceId:'sword-sheet',x:0,y:0,width:16,height:16}]}]}
 context.applyCharsetProjectData(mixed)
 assert.equal(context.animations.value[0].frames[1].sourceId,'sword-sheet')
 assert.equal(context.sheetImage.value.naturalWidth,16)
 const aligned=structuredClone(mixed);aligned.version=8
 Object.assign(aligned.animations[0].frames[1],{offsetX:-8,offsetY:-12})
 context.applyCharsetProjectData(aligned)
 assert.equal(context.animations.value[0].frames[1].offsetY,-12,'fine alignment survives document restore')
 assert.equal(context.createCharsetProjectData().version,8,'adjusted documents protect against older readers')
 context.applyCharsetProjectData(JSON.parse(JSON.stringify(context.createCharsetProjectData())))
 assert.equal(context.animations.value[0].frames[1].offsetX,-8)
 context.applyCharsetProjectData(mixed)
 const badOffset=structuredClone(aligned);badOffset.animations[0].frames[1].offsetX=129
 assert.throws(()=>context.applyCharsetProjectData(badOffset),/ajuste fino/)
 const invalid=structuredClone(mixed);invalid.animations[0].frames[1].width=17
 assert.throws(()=>context.applyCharsetProjectData(invalid),/Quadro livre inválido/)
 const missing=structuredClone(mixed);missing.animations[0].frames[1].sourceId='absent'
 assert.throws(()=>context.applyCharsetProjectData(missing),/Folha ausente/)
 assert.match(sfc,/hurtBox, animations.*scheduleCharsetProjectSave/,'hurtbox edits participate in autosave')
 assert.match(sfc,/ctx\.setLineDash\(\[3, 2\]\)/,'custom hurtbox has a distinct overlay')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Character geometry: actual exported header, legacy fallback, local body, frame attack/combat, flips, negative Q8, aliasing and bounds passed.')
