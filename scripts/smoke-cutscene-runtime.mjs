// Compiles a sample cutscene with the shared compiler, builds the C runtime on
// the host with cc and checks the resulting command trace.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileProject, compileCutscene, defaultCutsceneConfig, dialoguePages, toAscii, movePath, OP } from '../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs'
import { createPreview, previewStep } from '../src/utils/retro/cutscenePreview.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = join(root, 'assets/toolkit/lib/cutscene')

assert.equal(toAscii('Olá, coração!'), 'Ola, coracao!')
assert.deepEqual(dialoguePages('um dois tres quatro cinco seis', { dialogue: { charsPerLine: 9, linesPerPage: 2 } }, false), [['um dois', 'tres'], ['quatro', 'cinco'], ['seis']])

const config = {
  ...defaultCutsceneConfig(),
  actors: [{ id: 'hero', name: 'Heroína', value: 0 }, { id: 'cat', name: 'Gato', value: 1 }],
  animations: [{ id: 'idle', value: 0 }, { id: 'walk', value: 1 }],
  portraits: [{ id: 'cat_face', value: 3 }],
  sounds: [{ id: 'chime', value: 7 }],
  abilities: [{ id: 'double_jump', value: 0 }],
  events: [{ id: 'shake', value: 2 }],
  flags: [{ id: 'met_cat' }, { id: 'helped' }],
  dialogue: { charsPerLine: 20, charsPerLineWithPortrait: 14, linesPerPage: 2, asciiOnly: true, uppercaseSpeaker: true }
}
const scene = {
  format: 'retro-studio.cutscene', version: 1, id: 'meet_cat', title: 'Encontro',
  steps: [
    { type: 'move', actor: 'hero', x: 40, relative: true, speed: 2, wait: true },
    { type: 'face', actor: 'cat', direction: 'actor', target: 'hero' },
    { type: 'say', actor: 'cat', portrait: 'cat_face', text: 'Olá! Você veio de muito longe até a clareira.' },
    { type: 'choice', prompt: 'Ajudar o gato?', options: [
      { text: 'Sim', steps: [{ type: 'set_flag', flag: 'helped' }, { type: 'sound', sound: 'chime' }] },
      { text: 'Não', steps: [{ type: 'event', event: 'shake', arg: -3 }] }
    ] },
    { type: 'if_flag', flag: 'helped', then: [{ type: 'ability', ability: 'double_jump' }], else: [{ type: 'wait', frames: 2 }] },
    { type: 'camera', mode: 'x', x: 100, speed: 0 },
    { type: 'set_flag', flag: 'met_cat' }
  ]
}

const bad = compileCutscene({ id: 'bad', steps: [{ type: 'say', actor: 'nobody', text: '' }, { type: 'fly' }] }, config)
assert.equal(bad.errors.length, 3, bad.errors.join('\n'))

const result = compileProject([{ path: 'cutscenes/meet_cat.cutscene.json', scene }], config)
assert.deepEqual(result.errors, [])
assert.match(result.idsHeader, /#define CUTSCENE_MEET_CAT 0/)
assert.match(result.idsHeader, /#define CUTSCENE_FLAG_HELPED 1/)
const says = result.scripts[0].ops.filter(op => op.op === OP.SAY)
assert.equal(says.length, 2, 'long text is split into two pages')
assert.equal(says[0].speaker, 'GATO')

const work = mkdtempSync(join(tmpdir(), 'rs-cutscene-'))
try {
  mkdirSync(join(work, 'src'))
  cpSync(join(lib, 'src/retrostudio'), join(work, 'src/retrostudio'), { recursive: true })
  writeFileSync(join(work, 'src/cutscene_ids.h'), result.idsHeader)
  writeFileSync(join(work, 'src/cutscene_data.h'), result.dataHeader)
  writeFileSync(join(work, 'src/harness.c'), `
#include <stdio.h>
#include "cutscene_data.h"
static int ax[2]={10,200}, ay[2]={100,100};
static void get(void *c,int a,int *x,int *y){(void)c;*x=ax[a];*y=ay[a];}
static void set(void *c,int a,int x,int y,int m){(void)c;ax[a]=x;ay[a]=y;if(!m)printf("arrive %d %d\\n",a,x);}
static void face(void *c,int a,int l){(void)c;printf("face %d %d\\n",a,l);}
static void show(void *c,const CutsceneDialogue *d){int i;(void)c;printf("say %s p%d",d->speaker,d->portrait);for(i=0;i<d->lineCount;i++)printf(" [%s]",d->lines[i]);printf("\\n");}
static void choice(void *c,const CutsceneChoice *ch){(void)c;printf("choice %s %d/%d\\n",ch->prompt,ch->cursor,ch->count);}
static void hide(void *c){(void)c;printf("hide\\n");}
static int camGet(void *c){(void)c;return 0;}
static void camSet(void *c,int f,int x){(void)c;printf("camera %d %d\\n",f,x);}
static void snd(void *c,int s){(void)c;printf("sound %d\\n",s);}
static void ab(void *c,int a){(void)c;printf("ability %d\\n",a);}
static void ev(void *c,int e,int a){(void)c;printf("event %d %d\\n",e,a);}
static void fin(void *c,int s){(void)c;printf("finished %d\\n",s);}
int main(void){
  CutsceneHost h={0,get,set,face,0,0,show,choice,hide,camGet,camSet,0,0,snd,0,ab,ev,fin,320};
  CutsceneRunner r; int frame; unsigned int input;
  CutsceneTrigger t={0,0,50,120,CUTSCENE_MEET_CAT,CUTSCENE_START_TOUCH,1,-1,-1};
  unsigned int inside=0;
  cutsceneInit(&r,&cutsceneLibrary);
  if(cutsceneTriggerFind(&r,&t,1,10,100,CUTSCENE_EVENT_TOUCH,&inside)!=0) return 2;
  cutsceneStart(&r,&h,CUTSCENE_MEET_CAT);
  for(frame=0;frame<200 && cutsceneIsActive(&r);frame++){
    input=0;
    if(frame==30||frame==31||frame==40) input=CUTSCENE_INPUT_CONFIRM;
    if(frame==35) input=CUTSCENE_INPUT_DOWN;
    if(frame==36) input=CUTSCENE_INPUT_UP;
    cutsceneStep(&r,&h,input);
  }
  printf("flags %d %d played %d active %d\\n",cutsceneFlag(&r,CUTSCENE_FLAG_MET_CAT),cutsceneFlag(&r,CUTSCENE_FLAG_HELPED),cutscenePlayed(&r,0),cutsceneIsActive(&r));
  inside=0;
  printf("retrigger %d\\n",cutsceneTriggerFind(&r,&t,1,10,100,CUTSCENE_EVENT_TOUCH,&inside));
  return 0;
}
`)
  const exe = join(work, 'harness')
  execFileSync('cc', ['-std=c99', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', join(work, 'src'), join(work, 'src/harness.c'), join(work, 'src/retrostudio/cutscene_runner.c'), '-o', exe], { stdio: 'inherit' })
  const trace = execFileSync(exe, { encoding: 'utf8' })
  assert.equal(trace, [
    'face 0 0',
    'arrive 0 50',
    'face 1 1',
    'say GATO p3 [Ola! Voce veio] [de muito longe]',
    'say GATO p3 [ate a] [clareira.]',
    'choice Ajudar o gato? 0/2',
    'choice Ajudar o gato? 1/2',
    'choice Ajudar o gato? 0/2',
    'hide',
    'sound 7',
    'ability 0',
    'camera 0 100',
    'camera 1 0',
    'finished 0',
    'flags 1 1 played 1 active 0',
    'retrigger -1',
    ''
  ].join('\n'))

  // Passo "Encerrar cena": termina dentro de um ramo; os passos seguintes não rodam.
  const early = { format: 'retro-studio.cutscene', version: 1, id: 'early_end', title: 'Fim antecipado', steps: [
    { type: 'set_flag', flag: 'met_cat' },
    { type: 'if_flag', flag: 'met_cat', then: [{ type: 'sound', sound: 'chime' }, { type: 'end' }], else: [] },
    { type: 'set_flag', flag: 'helped' }
  ] }
  const earlyResult = compileProject([{ path: 'cutscenes/early_end.cutscene.json', scene: early }], config)
  assert.deepEqual(earlyResult.errors, [])
  const ends = earlyResult.scripts[0].ops.filter(op => op.op === OP.END)
  assert.equal(ends.length, 2, 'explicit end plus the implicit end of the script')
  assert.equal(ends[0].path, 'steps.1.then.1')
  writeFileSync(join(work, 'src/cutscene_ids.h'), earlyResult.idsHeader)
  writeFileSync(join(work, 'src/cutscene_data.h'), earlyResult.dataHeader)
  writeFileSync(join(work, 'src/early.c'), `
#include <stdio.h>
#include "cutscene_data.h"
static void snd(void *c,int s){(void)c;printf("sound %d\\n",s);}
static void fin(void *c,int s){(void)c;printf("finished %d\\n",s);}
int main(void){
  CutsceneHost h={0,0,0,0,0,0,0,0,0,0,0,0,0,snd,0,0,0,fin,320};
  CutsceneRunner r; int frame;
  cutsceneInit(&r,&cutsceneLibrary);
  cutsceneStart(&r,&h,CUTSCENE_EARLY_END);
  for(frame=0;frame<20 && cutsceneIsActive(&r);frame++) cutsceneStep(&r,&h,0);
  printf("flags %d %d played %d active %d\\n",cutsceneFlag(&r,CUTSCENE_FLAG_MET_CAT),cutsceneFlag(&r,CUTSCENE_FLAG_HELPED),cutscenePlayed(&r,CUTSCENE_EARLY_END),cutsceneIsActive(&r));
  return 0;
}
`)
  const earlyExe = join(work, 'early')
  execFileSync('cc', ['-std=c99', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', join(work, 'src'), join(work, 'src/early.c'), join(work, 'src/retrostudio/cutscene_runner.c'), '-o', earlyExe], { stdio: 'inherit' })
  assert.equal(execFileSync(earlyExe, { encoding: 'utf8' }), ['sound 7', 'finished 0', 'flags 1 0 played 1 active 0', ''].join('\n'))

  // Rotas do comando Mover: o runtime C e a prévia do editor precisam dar o mesmo trajeto, quadro a quadro.
  const routeScene = skip => ({ format: 'retro-studio.cutscene', version: 1, id: 'route_demo', title: 'Rota', steps: [
    { type: 'move', actor: 'cat', wait: false, repeat: 'forever', style: 'float', route: [{ kind: 'move', x: 0, y: -6 }, { kind: 'wait', frames: 3 }, { kind: 'move', x: 0, y: 6 }] },
    { type: 'move', actor: 'hero', speed: 1.5, repeat: 2, style: 'float', route: [
      { kind: 'move', x: 16, y: -8 }, { kind: 'jump', x: 24, y: 0, height: 12, frames: 10 }, { kind: 'wait', frames: 5 },
      { kind: 'face', direction: 'left' }, { kind: 'to', x: 140, speed: 3 }
    ] },
    { type: 'move', actor: 'hero', x: -10, relative: true, turn: false },
    { type: 'wait_moves' },
    ...(skip ? [] : [{ type: 'wait', frames: 12 }])
  ] })
  const start = { hero: { x: 100, y: 180 }, cat: { x: 200, y: 120 } }
  assert.deepEqual(movePath(routeScene().steps[1], start.hero).at(-1), { x: 140, y: 164, jump: false })
  const tooLong = compileCutscene({ ...routeScene(), steps: [{ type: 'move', actor: 'hero', route: Array.from({ length: 17 }, () => ({ kind: 'move', x: 1 })) }, { type: 'move', actor: 'hero', repeat: 'forever', route: [{ kind: 'move', x: 1 }] }, { type: 'move', actor: 'hero', route: [{ kind: 'fly' }] }] }, config)
  assert.equal(tooLong.errors.length, 3, tooLong.errors.join('\n'))
  const routeTrace = skipAt => {
    const scene = routeScene(skipAt >= 0)
    const result = compileProject([{ path: 'cutscenes/route_demo.cutscene.json', scene }], config)
    assert.deepEqual(result.errors, [])
    assert.equal(result.scripts[0].ops.filter(op => op.op === OP.ROUTE).length, 3)
    assert.equal(result.scripts[0].ops.filter(op => op.op === OP.ROUTE_STEP).length, 9)
    writeFileSync(join(work, 'src/cutscene_ids.h'), result.idsHeader)
    writeFileSync(join(work, 'src/cutscene_data.h'), result.dataHeader)
    writeFileSync(join(work, 'src/route.c'), `
#include <stdio.h>
#include "cutscene_data.h"
static int px[2]={100,200},py[2]={180,120},pm[2],pl[2];
static void get(void *c,int a,int *x,int *y){(void)c;*x=px[a];*y=py[a];}
static void set(void *c,int a,int x,int y,int m){(void)c;px[a]=x;py[a]=y;pm[a]=m;}
static void face(void *c,int a,int l){(void)c;pl[a]=l;}
int main(void){
  CutsceneHost h={0,get,set,face,0,0,0,0,0,0,0,0,0,0,0,0,0,0,320};
  CutsceneRunner r; int frame;
  cutsceneInit(&r,&cutsceneLibrary);
  cutsceneStart(&r,&h,CUTSCENE_ROUTE_DEMO);
  for(frame=0;frame<400 && cutsceneIsActive(&r);frame++){
    cutsceneStep(&r,&h,frame==${skipAt}?CUTSCENE_INPUT_SKIP:0);
    printf("%d %d %d %d %d | %d %d %d %d\\n",frame,px[0],py[0],pm[0],pl[0],px[1],py[1],pm[1],cutsceneIsActive(&r));
  }
  return 0;
}
`)
    const exe = join(work, 'route')
    execFileSync('cc', ['-std=c99', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', join(work, 'src'), join(work, 'src/route.c'), join(work, 'src/retrostudio/cutscene_runner.c'), '-o', exe], { stdio: 'inherit' })
    const native = execFileSync(exe, { encoding: 'utf8' }).trim().split('\n')
    const sim = createPreview(compileCutscene(scene, config), scene, config, start)
    const preview = []
    for (let frame = 0; frame < 400 && !sim.done; frame++) {
      previewStep(sim, { skip: frame === skipAt })
      const { hero, cat } = sim.actors
      preview.push(`${frame} ${Math.trunc(hero.x)} ${Math.trunc(hero.y) + hero.lift} ${hero.moving ? 1 : 0} ${hero.left ? 1 : 0} | ${Math.trunc(cat.x)} ${Math.trunc(cat.y) + cat.lift} ${cat.moving ? 1 : 0} ${sim.done ? 0 : 1}`)
    }
    assert.deepEqual(preview, native, 'preview and C runtime follow the same route')
    return native
  }
  const played = routeTrace(-1)
  assert.ok(played.length > 60 && played.length < 400, `route ends on its own (${played.length} frames)`)
  assert.match(played.at(-1), /^\d+ 130 164 0 1 \| 200 \d+ 0 0$/, 'hero ends 10 px left of the route end, still facing left; the endless route stops')
  assert.ok(played.some(line => /^\d+ \d+ 1[0-5]\d 1 /.test(line)), 'jump arc and float lift the hero')
  const skipped = routeTrace(7)
  assert.match(skipped.at(-1), /^7 130 164 0 1 \|/, 'skipping jumps to the end of the finite routes')
  console.log('smoke-cutscene-runtime: ok')
} finally {
  rmSync(work, { recursive: true, force: true })
}
