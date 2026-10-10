// #62: regras de composição mostradas no editor (as mesmas que o exportador aplica antes de olhar os pixels).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {explainScenery,panoramaPeriod,panoramaFactor,SCENERY_PLANE} from '../shared/retro/sceneryComposition.js'
const clouds={path:'../res/clouds.png',factorX:0.25,factorY:0,fit:'repeat-x',opacity:1,width:128,height:224},hills={path:'res\\hills.png',factorX:0.5,factorY:0,fit:'repeat-x',opacity:1,width:256,height:224}
const room={roomWidth:2048,roomHeight:448}
// Sem panoramas: o caminho de sempre.
assert.deepEqual(explainScenery({hasForeground:true}),{mode:'legacy',planes:[{plane:'BG_B',use:'cenário'},{plane:'BG_A',use:'frente'}],problems:[],notes:[]})
assert.equal(explainScenery({hasBackground:true}).planes[0].use,'cenário (com o fundo fixo desenhado junto)');assert.equal(explainScenery().planes[1].use,'livre')
// Duas velocidades: faixas no BG_B, mapa por streaming no BG_A, sem problemas.
let plan=explainScenery({...room,parallaxLayers:[clouds,hills]})
assert.deepEqual([plan.mode,plan.problems,plan.planes.map(item=>item.plane)],['scenery',[],['BG_B','BG_A']]);assert.match(plan.planes[0].use,/faixas/);assert.match(plan.planes[1].use,/streaming/);assert.ok(plan.notes.some(note=>/faixas horizontais da tela \(até 8\)/.test(note)))
assert.match(explainScenery({...room,parallaxLayers:[clouds,{...hills,factorX:0.25}]}).notes[0],/mesma velocidade viram uma imagem só/)
// Períodos: repetir usa o tamanho da imagem; eixo que não repete usa a tela; cover/contain/stretch escalam para a tela.
assert.deepEqual(panoramaPeriod(clouds,320,224),{x:128,y:224});assert.deepEqual(panoramaPeriod({...clouds,fit:'repeat'},320,224),{x:128,y:224});assert.deepEqual(panoramaPeriod({...clouds,fit:'repeat-y'},320,224),{x:320,y:224})
assert.deepEqual(panoramaPeriod({width:64,height:64,fit:'cover'},320,224),{x:320,y:320});assert.deepEqual(panoramaPeriod({width:64,height:64,fit:'contain'},320,224),{x:224,y:224});assert.deepEqual(panoramaPeriod({width:10,height:10,fit:'stretch'},320,224),{x:320,y:224});assert.equal(panoramaPeriod({fit:'cover'},320,224),null)
assert.deepEqual([0,0.25,0.5,1,1.5,2,9,-1,'x'].map(panoramaFactor),[0,64,128,256,384,512,512,0,0]);assert.deepEqual(SCENERY_PLANE,{width:512,height:256})
// Problemas: mesmas frases do exportador.
const problem=(input,pattern)=>{const result=explainScenery({...room,...input});assert.ok(result.problems.some(text=>pattern.test(text)),String(pattern)+' em '+JSON.stringify(result.problems))}
problem({parallaxLayers:[clouds],hasForeground:true},/usa cenário e frente \(os dois planos do console\) e também panoramas\. Não sobra plano/)
problem({parallaxLayers:[clouds],hasBackground:true},/Fundo fixo e panoramas no mesmo mapa/)
problem({parallaxLayers:[{...clouds,opacity:0.5}]},/Panorama 1 \(clouds\.png\): o console não mistura camadas; use opacidade 100%/)
problem({parallaxLayers:[{...clouds,width:300}]},/Panorama 1 \(clouds\.png\): repete a cada 300 px na horizontal e anda 432 px nesta sala\. O plano do console dá a volta a cada 512 px/)
problem({parallaxLayers:[{...clouds,fit:'repeat',factorY:0.5}]},/repete a cada 224 px na vertical e anda 112 px nesta sala/)
problem({parallaxLayers:[clouds,{...hills,factorY:0.125}]},/velocidades verticais diferentes\. Eles dividem um único plano/)
problem({parallaxLayers:[{...clouds,factorY:0.125},{...hills,factorY:0.125}]},/Faixas com velocidades horizontais diferentes exigem velocidade vertical 0/)
problem({parallaxLayers:Array(9).fill(clouds)},/mais de oito panoramas/)
assert.match(explainScenery({...room,parallaxLayers:[{...hills,path:'C:\\jogo\\res\\hills.png',opacity:0}]}).problems[0],/^Panorama 1 \(hills\.png\)/,'nome do arquivo com barra de Windows')
// Aceitos: panorama fixo de qualquer largura; largura qualquer se anda pouco; imagem sem tamanho conhecido vira nota.
assert.deepEqual(explainScenery({...room,parallaxLayers:[{...clouds,width:300,factorX:0}]}).problems,[]);assert.deepEqual(explainScenery({roomWidth:640,roomHeight:224,parallaxLayers:[{...clouds,width:300,factorX:0.5}]}).problems,[])
plan=explainScenery({...room,parallaxLayers:[{path:'a.png',fit:'cover'}]});assert.deepEqual(plan.problems,[]);assert.match(plan.notes[0],/tamanho da imagem ainda não é conhecido/)
// H32: a tela mais estreita muda os limites.
const once={...clouds,fit:'repeat-y',factorX:1}
assert.deepEqual(explainScenery({roomWidth:640,roomHeight:224,viewWidth:256,parallaxLayers:[once]}).problems,[],'H32: repetir a cada tela (256 px) divide o plano')
assert.match(explainScenery({roomWidth:640,roomHeight:224,viewWidth:320,parallaxLayers:[once]}).problems[0],/repete a cada 320 px na horizontal e anda 320 px/)
// As frases são as do exportador (as partes fixas aparecem nos dois arquivos).
const exporter=fs.readFileSync(new URL('../assets/toolkit/examples/sgdk-skeleton/tools/export-map.py',import.meta.url),'utf8')
for(const phrase of ['o console não mistura camadas; use opacidade 100%','Não sobra plano: mova os tiles da frente para a camada de cenário','Fundo fixo e panoramas no mesmo mapa','têm velocidades verticais diferentes. Eles dividem um único plano do console','exigem velocidade vertical 0 em todos os panoramas','O plano do console dá a volta a cada'])assert.ok(exporter.includes(phrase),phrase)
// A tela mostra o plano e anuncia os problemas.
const sidebar=fs.readFileSync(new URL('../src/components/retro/tilemap/TilemapSidebar.vue',import.meta.url),'utf8')
assert.match(sidebar,/<section v-if="state\.sceneryPlan\.value\.mode === 'scenery'" class="te-scenery-plan" aria-labelledby="te-scenery-plan-title">/);assert.match(sidebar,/<ul v-if="state\.sceneryPlan\.value\.problems\.length" role="alert"/)
assert.match(fs.readFileSync(new URL('../src/composables/useTilemapEditorState.js',import.meta.url),'utf8'),/hasForeground: tiles2\.value\.some\(tile => tile > 0\), hasBackground: !!backgroundImage\.value\?\.path/)
console.log('Scenery composition: plane mapping, periods, 8.8 factors, 9 refused combinations with the exporter wording, accepted cases and sidebar markup passed.')
