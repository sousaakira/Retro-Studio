// #62: panoramas e streaming, do TMX à ROM. Sala larga com mapa por streaming e dois panoramas
// em faixas + sala pequena no caminho antigo. Confere o que o exportador gera, as combinações
// que ele recusa (com o motivo) e, com --sgdk <marsdev/m68k-elf>, constrói a ROM de referência
// (--keep-rom <arquivo> guarda a ROM para scripts/capture-rom.sh).
// #90: o mapa por streaming vai em binário (padrões, palavras de atributo e número de 16 bits por
// célula), sem o limite de 2048 tiles; sala sem panorama que não cabe na VRAM entra no streaming
// sozinha, com os dois planos.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {toTMX} from '../src/utils/retro/tmxFormat.js'
import {worldNumericId} from '../shared/retro/worldConfiguration.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {worldConfigurationStatus,saveWorldConfigurationWithMaps} from '../electron/retro/worldConfiguration.js'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-scenery-export-'))
const arg=name=>{const index=process.argv.indexOf(name);return index<0?'':process.argv[index+1]}
const BUDGET=700
try{
 const root=path.join(temporary,'game');for(const dir of ['tools','maps','world','res','src'])fs.mkdirSync(path.join(root,dir),{recursive:true})
 for(const name of ['export-map.py','export-world-maps.py'])fs.copyFileSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton/tools',name),path.join(root,'tools',name))
 installRuntimeModules(root,{moduleIds:['scenery-sgdk','movement']}) // movement: geometria que world_maps.h cita
 for(const file of ['retro_scenery.c','retro_scenery_sgdk.c','retro_world_sgdk.c','retro_world.c'])assert.ok(fs.existsSync(path.join(root,'src/retro_runtime',file)),'scenery-sgdk traz suas dependências: '+file)
 const config={mapExport:{sourceMaps:['maps/legacy.tmx'],runtimeGeometry:false},scenery:{tiles:BUDGET,dmaBytes:2048,dmaEntries:56}}
 const writeConfig=value=>fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify(value))
 writeConfig(config);fs.writeFileSync(path.join(root,'res/resources.res'),'')
 // Arte: tileset de 256 tiles diferentes (6 cores), nuvens (faixa de cima) e morros (faixa de baixo).
 const art=spawnSync('python3',['-c',`from PIL import Image, ImageDraw
import sys
root=sys.argv[1]
colors=[(0,0,0),(34,68,170),(68,136,238),(170,102,34),(238,170,68),(102,170,68),(238,238,238)]
tiles=Image.new('RGBA',(128,128))
for index in range(256):
    for y in range(8):
        for x in range(8):
            bit=(index>>((x//2)+(y//2)*4)%8)&1 if (x+y)%3 else (index>>(y%8))&1
            tiles.putpixel((index%16*8+x,index//16*8+y),colors[1+(index%3)*2+bit]+(255,))
tiles.save(root+'/res/tiles.png')
clouds=Image.new('RGBA',(128,224));draw=ImageDraw.Draw(clouds)
for cx,cy,r in [(20,36,14),(44,30,18),(70,40,12),(104,56,16)]:
    draw.ellipse((cx-r,cy-r//2,cx+r,cy+r//2),fill=(238,238,238,255));draw.ellipse((cx-r//2,cy-r//3,cx+r//2,cy+r//3),fill=(170,204,238,255))
clouds.save(root+'/res/clouds.png')
hills=Image.new('RGBA',(256,224));draw=ImageDraw.Draw(hills)
draw.polygon([(0,224),(0,170),(40,128),(96,176),(150,120),(210,168),(256,170),(256,224)],fill=(34,102,68,255))
draw.polygon([(0,224),(0,200),(64,176),(128,208),(190,180),(256,200),(256,224)],fill=(68,136,68,255))
hills.save(root+'/res/hills.png')
solid=Image.new('RGBA',(100,64),(200,60,60,255));solid.save(root+'/res/solid.png')
soft=Image.new('RGBA',(64,64),(200,60,60,128));soft.save(root+'/res/soft.png')
wide=Image.new('RGBA',(300,224),(0,0,0,0));ImageDraw.Draw(wide).rectangle((0,0,299,40),fill=(238,238,238,255));wide.save(root+'/res/wide.png')
`,root],{encoding:'utf8'});assert.equal(art.status,0,art.stderr)
 // Sala larga: chão variado por região (para o streaming trocar padrões), plataformas, céu vazio.
 const W=256,H=56,tiles=Array(W*H).fill(0)
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const ground=y>=44+((x>>4)&1)*2,platform=y===30+((x>>5)%3)*4&&(x%32)<14,pillar=x%48===5&&y>=20&&y<44
  if(ground||platform||pillar)tiles[y*W+x]=1+(((x>>4)*37+y*5+(x&3))&255)
 }
 const tileset=[{name:'tiles',path:'../res/tiles.png',columns:16,tilecount:256}]
 const clouds={path:'../res/clouds.png',factorX:0.25,factorY:0,fit:'repeat-x',opacity:1},hills={path:'../res/hills.png',factorX:0.5,factorY:0,fit:'repeat-x',opacity:1}
 const hallMap=extra=>toTMX({width:W,height:H,tiles,tilesets:tileset,collision:Array(W*H).fill(0),objects:[{id:1,type:'player_spawn',x:2,y:40,width:1,height:1}],parallaxLayers:[clouds,hills],...extra})
 const caveTiles=Array.from({length:40*28},(_v,i)=>1+(i*7)%256)
 const caveMap=toTMX({width:40,height:28,tiles:caveTiles,tilesets:tileset,collision:Array(40*28).fill(0),objects:[{id:1,type:'player_spawn',x:2,y:10,width:1,height:1}]})
 const save=(name,text)=>fs.writeFileSync(path.join(root,'maps',name+'.tmx'),text)
 save('hall',hallMap());save('cave',caveMap)
 fs.writeFileSync(path.join(root,'world/world.json'),JSON.stringify({format:'retro-studio.world',version:1,rooms:[{id:'hall',map:'maps/hall.tmx',width:W*8,height:H*8},{id:'cave',map:'maps/cave.tmx',width:320,height:224}]}))
 let count=0
 const run=()=>{const stage=path.join(temporary,'stage-'+(count++));return {stage,result:spawnSync('python3',[path.join(root,'tools/export-world-maps.py'),'--stage',stage],{encoding:'utf8'})}}
 const hall=worldNumericId('hall'),cave=worldNumericId('cave')
 // ---- 1. O que sai --------------------------------------------------------------------
 const {stage,result}=run();assert.equal(result.status,0,result.stdout+result.stderr)
 const header=fs.readFileSync(path.join(stage,'src/generated/world_maps.h'),'utf8'),resources=fs.readFileSync(path.join(stage,'res/generated/world-resources.res'),'utf8')
 const manifest=JSON.parse(fs.readFileSync(path.join(stage,'res/generated/world-map-manifest.json'))),plan=manifest.rooms.find(room=>room.id==='hall').manifest.scenery
 assert.match(header,/#include "\.\.\/retro_runtime\/retro_scenery_sgdk\.h"/);assert.match(header,/#if RETRO_RUNTIME_WORLD_SGDK_VERSION < 3\n#error/)
 // Velocidades em 8.8 (0,25 → 64; 0,5 → 128) e faixas de 8 em 8 linhas: os morros começam na linha 120 (faixa 15).
 assert.match(header,new RegExp('RetroSceneryBand retroWorldRoom'+hall+'Bands\\[\\]=\\{\\{64,0,15\\},\\{128,15,13\\}\\};'))
 assert.match(header,new RegExp('RetroSceneryPanorama retroWorldRoom'+hall+'Panorama=\\{&RETRO_WORLD_ROOM_'+hall+'_PAN_TILES,&RETRO_WORLD_ROOM_'+hall+'_PAN,retroWorldRoom'+hall+'Bands,2,0\\};'))
 assert.match(header,new RegExp('TileSet retroWorldRoom'+hall+'StreamTiles=\\{COMPRESSION_NONE,'+plan.patterns+',\\(u32\\*\\)RETRO_WORLD_ROOM_'+hall+'_STREAM_PATTERNS\\};'))
 assert.match(header,new RegExp('TileMap retroWorldRoom'+hall+'StreamCells=\\{COMPRESSION_NONE,'+W+','+H+',\\(u16\\*\\)RETRO_WORLD_ROOM_'+hall+'_STREAM_CELLS\\};'))
 assert.match(header,new RegExp('RetroScenerySgdkRoom retroWorldRoom'+hall+'Scenery=\\{&retroWorldRoom'+hall+'StreamTiles,&retroWorldRoom'+hall+'StreamCells,&retroWorldRoom'+hall+'Panorama,0,'+BUDGET+','+plan.windowPatterns+',2048,56,\\(const u16\\*\\)RETRO_WORLD_ROOM_'+hall+'_STREAM_IDS,0,0\\};'))
 assert.match(header,/#if RETRO_RUNTIME_SCENERY_SGDK_VERSION < 2\n#error/)
 assert.match(header,new RegExp('\\{'+hall+',0,0,0,0,\\{\\{&RETRO_WORLD_ROOM_'+hall+'_PALETTE,0\\},\\{0,0\\},.*\\},&retroScenerySgdkRenderer,&retroWorldRoom'+hall+'Scenery\\}'))
 assert.match(header,new RegExp('\\{'+cave+',&RETRO_WORLD_ROOM_'+cave+'_TILES,&RETRO_WORLD_ROOM_'+cave+',0,0,\\{.*\\},0,0\\}'),'a sala sem panorama segue no caminho antigo')
 // Recursos: padrões sem compressão (vão da ROM para a VRAM por DMA) e nada do caminho antigo para a sala de cenário.
 for(const line of ['BIN RETRO_WORLD_ROOM_'+hall+'_STREAM_PATTERNS "generated/world-'+hall+'-stream-patterns.bin" 2 2 0 NONE FALSE','BIN RETRO_WORLD_ROOM_'+hall+'_STREAM_CELLS "generated/world-'+hall+'-stream-cells.bin" 2 2 0 NONE FALSE','BIN RETRO_WORLD_ROOM_'+hall+'_STREAM_IDS "generated/world-'+hall+'-stream-ids.bin" 2 2 0 NONE FALSE',
  'TILESET RETRO_WORLD_ROOM_'+hall+'_PAN_TILES "generated/world-'+hall+'-pan.png" NONE ALL','TILEMAP RETRO_WORLD_ROOM_'+hall+'_PAN "generated/world-'+hall+'-pan.png" RETRO_WORLD_ROOM_'+hall+'_PAN_TILES NONE ALL','MAP RETRO_WORLD_ROOM_'+cave+' "generated/world-'+cave+'-bg.png" RETRO_WORLD_ROOM_'+cave+'_TILES NONE'])assert.ok(resources.split('\n').includes(line),line)
 assert.ok(!new RegExp('MAP RETRO_WORLD_ROOM_'+hall+' ').test(resources));assert.ok(!resources.includes('RETRO_WORLD_ROOM_'+cave+'_STREAM'));assert.ok(!resources.includes('_BACK_'),'com panorama, um plano só')
 // Binários: 32 bytes por padrão, 2 bytes por célula (atributos) e 2 por número; sem preenchimento.
 assert.equal(fs.statSync(path.join(stage,'res/generated/world-'+hall+'-stream-patterns.bin')).size,plan.patterns*32)
 for(const kind of ['cells','ids'])assert.equal(fs.statSync(path.join(stage,'res/generated/world-'+hall+'-stream-'+kind+'.bin')).size,W*H*2)
 for(const kind of ['PAN'])assert.ok(resources.indexOf('TILESET RETRO_WORLD_ROOM_'+hall+'_'+kind+'_TILES ')<resources.indexOf('TILEMAP RETRO_WORLD_ROOM_'+hall+'_'+kind+' '),'tileset antes do mapa que o usa')
 // Plano: células e padrões contados separadamente; a janela precisa de menos padrões do que o mapa tem.
 assert.deepEqual([plan.panorama,plan.factorY,plan.viewWidth,plan.viewHeight,plan.tiles,plan.dmaBytes,plan.dmaEntries],[true,0,320,224,BUDGET,2048,56])
 assert.ok(plan.patterns>200&&plan.windowPatterns<plan.patterns&&plan.windowPatterns>40,'mapa '+plan.patterns+' padrões, janela '+plan.windowPatterns)
 assert.ok(plan.panoramaPatterns>10&&plan.panoramaPatterns+plan.windowPatterns<=BUDGET)
 // Imagem do panorama: o plano inteiro (512 x 256), já repetido; faixa de cima e de baixo no lugar.
 const probe=spawnSync('python3',['-c',`from PIL import Image
import sys,json
image=Image.open(sys.argv[1]);pixels=image.load();w,h=image.size
rows=[any(pixels[x,y]%16 for x in range(w)) for y in range(h)]
print(json.dumps({'size':[w,h],'mode':image.mode,'first':rows.index(True),'gap':[y for y in range(70,112) if rows[y]],'same':all(pixels[x,40]==pixels[x+128,40] for x in range(384)),'hills':all(pixels[x,200]==pixels[x+256,200] for x in range(256)),'priority':max(pixels[x,y] for x in range(w) for y in range(h))<128}))`,path.join(stage,'res/generated/world-'+hall+'-pan.png')],{encoding:'utf8'})
 assert.equal(probe.status,0,probe.stderr);assert.deepEqual(JSON.parse(probe.stdout),{size:[512,256],mode:'P',first:21,gap:[],same:true,hills:true,priority:true})
 // ---- 2. Combinações impossíveis: cada uma com o motivo e a saída ------------------------
 const refuse=(label,setup,pattern)=>{setup();const attempt=run();assert.notEqual(attempt.result.status,0,label+' deveria ser recusado');assert.match(attempt.result.stdout+attempt.result.stderr,pattern,label);save('hall',hallMap());writeConfig(config)}
 refuse('frente + panorama',()=>save('hall',hallMap({tiles2:tiles.map((value,index)=>index===5?3:0)})),/usa cenário e frente \(os dois planos do console\) e também panoramas\. Não sobra plano/)
 refuse('fundo fixo + panorama',()=>save('hall',hallMap({background:{path:'../res/solid.png',fit:'cover',opacity:1}})),/Fundo fixo e panoramas no mesmo mapa/)
 refuse('opacidade',()=>save('hall',hallMap({parallaxLayers:[{...clouds,opacity:0.5}]})),/Panorama 1 \(clouds\.png\): o console não mistura camadas; use opacidade 100%/)
 refuse('transparência parcial',()=>save('hall',hallMap({parallaxLayers:[{...clouds,path:'../res/soft.png'}]})),/transparência parcial não existe no console/)
 refuse('velocidades diferentes sobrepostas',()=>save('hall',hallMap({parallaxLayers:[clouds,{...clouds,path:'../res/wide.png',fit:'repeat-x',factorX:0}]})),/Panorama 1 \(clouds\.png\) e Panorama 2 \(wide\.png\) têm velocidades horizontais diferentes e se sobrepõem nas linhas \d+–\d+ do plano/)
 refuse('velocidades verticais diferentes',()=>save('hall',hallMap({parallaxLayers:[clouds,{...hills,factorY:0.125}]})),/velocidades verticais diferentes\. Eles dividem um único plano/)
 refuse('faixas com scroll vertical',()=>save('hall',hallMap({parallaxLayers:[{...clouds,factorY:0.125},{...hills,factorY:0.125}]})),/Faixas com velocidades horizontais diferentes exigem velocidade vertical 0/)
 refuse('largura que não divide o plano',()=>save('hall',hallMap({parallaxLayers:[{...clouds,path:'../res/wide.png'}]})),/Panorama 1 \(wide\.png\): repete a cada 300 px na horizontal e anda 432 px nesta sala\. O plano do console dá a volta a cada 512 px/)
 refuse('reserva de cenário pequena',()=>writeConfig({...config,scenery:{...config.scenery,tiles:60}}),/Esta sala precisa de \d+ tiles de VRAM ao mesmo tempo \(\d+ dos panoramas e até \d+ do trecho de mapa em volta da tela\) e a reserva de cenário é de 60/)
 refuse('orçamento inválido',()=>writeConfig({...config,scenery:{dmaBytes:'muito'}}),/scenery\.dmaBytes: use um inteiro entre 256 e 7200/)
 refuse('orçamento menor que uma linha da janela',()=>writeConfig({...config,scenery:{...config.scenery,dmaBytes:1500}}),/o orçamento por quadro precisa comportar uma linha da janela do cenário — pelo menos 1530 bytes \(dmaBytes\) e 47 transferências/)
 refuse('transferências a menos',()=>writeConfig({...config,scenery:{...config.scenery,dmaEntries:40}}),/pelo menos 1530 bytes \(dmaBytes\) e 47 transferências/)
 refuse('primeiro tile do sistema',()=>writeConfig({...config,scenery:{...config.scenery,firstTile:8}}),/scenery\.firstTile: os 16 primeiros tiles são do sistema/)
 // Mesma velocidade vertical ≠ 0 e velocidades horizontais diferentes: recusado mesmo que só se toquem fora das 28 linhas da tela.
 refuse('faixas com vertical, fora da tela',()=>save('hall',hallMap({parallaxLayers:[{...clouds,factorY:0.125,fit:'repeat',path:'../res/tiles.png',factorX:1},{...hills,factorY:0.125}]})),/exigem velocidade vertical 0|velocidades horizontais diferentes e se sobrepõem/)
 refuse('imagem fora do projeto',()=>save('hall',hallMap({parallaxLayers:[{...clouds,path:'../../fora.png'}]})),/./)
 // Aceitos: mesma velocidade sobreposta (viram uma camada só), panorama fixo de qualquer largura, um panorama com scroll vertical.
 const accept=(label,layers,check)=>{save('hall',hallMap({parallaxLayers:layers}));const attempt=run();assert.equal(attempt.result.status,0,label+': '+attempt.result.stderr);check(fs.readFileSync(path.join(attempt.stage,'src/generated/world_maps.h'),'utf8'));save('hall',hallMap())}
 accept('mesma velocidade',[clouds,{...hills,factorX:0.25}],text=>assert.match(text,/Bands\[\]=\{\{64,0,28\}\};/))
 accept('fixo',[{...clouds,path:'../res/wide.png',factorX:0}],text=>assert.match(text,/Bands\[\]=\{\{0,0,28\}\};/))
 accept('uma camada com vertical',[{...clouds,fit:'repeat',path:'../res/tiles.png',factorX:1,factorY:0.5}],text=>assert.match(text,/Bands\[\]=\{\{256,0,28\}\};[\s\S]*Bands,1,128\};/))
 // Sala com mais de 2048 tiles diferentes: uma célula não os endereça; recusada na exportação, não em jogo.
 {
  const many=spawnSync('python3',['-c',`from PIL import Image
import sys
image=Image.new('RGBA',(512,336))
for index in range(64*42):
    for bit in range(12):
        if index>>bit&1:
            for dy in range(2):
                for dx in range(2):image.putpixel((index%64*8+bit%4*2+dx,index//64*8+bit//4*2+dy),(238,238,238,255))
    image.putpixel((index%64*8+7,index//64*8+7),(34,68,170,255))
image.save(sys.argv[1])`,path.join(root,'res/many.png')],{encoding:'utf8'});assert.equal(many.status,0,many.stderr)
  const big=Array.from({length:64*42},(_v,index)=>index+1)
  save('hall',toTMX({width:64,height:42,tiles:big,tilesets:[{name:'many',path:'../res/many.png',columns:64,tilecount:64*42}],collision:Array(64*42).fill(0),objects:[{id:1,type:'player_spawn',x:2,y:2,width:1,height:1}],parallaxLayers:[clouds]}))
  fs.writeFileSync(path.join(root,'world/world.json'),JSON.stringify({format:'retro-studio.world',version:1,rooms:[{id:'hall',map:'maps/hall.tmx',width:512,height:336},{id:'cave',map:'maps/cave.tmx',width:320,height:224}]}))
  // Ainda pequena demais: 64 × 42 tiles todos diferentes, e a tela inteira já passa do que a VRAM comporta.
  writeConfig({...config,scenery:{dmaBytes:2048,dmaEntries:56}})
  const crowded=run();assert.notEqual(crowded.result.status,0);assert.match(crowded.result.stderr,/Esta sala precisa de \d+ tiles de VRAM ao mesmo tempo .*; o console comporta 1424/)
  // Fase larga com 2688 tiles diferentes: passa, porque só a janela em volta da tela vai para a VRAM.
  const wide=Array.from({length:400*28},(_v,index)=>1+((index%400)*28+Math.floor(index/400))%2688)
  save('hall',toTMX({width:400,height:28,tiles:wide,tilesets:[{name:'many',path:'../res/many.png',columns:64,tilecount:64*42}],collision:Array(400*28).fill(0),objects:[{id:1,type:'player_spawn',x:2,y:2,width:1,height:1}],parallaxLayers:[clouds]}))
  fs.writeFileSync(path.join(root,'world/world.json'),JSON.stringify({format:'retro-studio.world',version:1,rooms:[{id:'hall',map:'maps/hall.tmx',width:3200,height:224},{id:'cave',map:'maps/cave.tmx',width:320,height:224}]}))
  const long=run();assert.equal(long.result.status,0,long.result.stderr)
  const longPlan=JSON.parse(fs.readFileSync(path.join(long.stage,'res/generated/world-map-manifest.json'))).rooms.find(room=>room.id==='hall').manifest.scenery
  const ids=fs.readFileSync(path.join(long.stage,'res/generated/world-'+hall+'-stream-ids.bin'));let highest=0;for(let i=0;i<ids.length;i+=2)highest=Math.max(highest,ids.readUInt16BE(i))
  assert.deepEqual([longPlan.patterns,longPlan.planes,highest],[2688,1,2687]);assert.ok(longPlan.windowPatterns<=45*28,'janela '+longPlan.windowPatterns)
  // Sem panorama e grande demais para ficar residente: streaming automático, cenário em BG_B e frente em BG_A.
  const front=Array.from({length:400*28},(_v,index)=>Math.floor(index/400)===20&&index%7===0?1+index%256:0)
  save('hall',toTMX({width:400,height:28,tiles:wide,tiles2:front.map(v=>v?v+2688:0),tilesets:[{name:'many',path:'../res/many.png',columns:64,tilecount:64*42},{name:'tiles',path:'../res/tiles.png',columns:16,tilecount:256}],collision:Array(400*28).fill(0),objects:[{id:1,type:'player_spawn',x:2,y:2,width:1,height:1}]}))
  const both=run();assert.equal(both.result.status,0,both.result.stderr)
  const bothPlan=JSON.parse(fs.readFileSync(path.join(both.stage,'res/generated/world-map-manifest.json'))).rooms.find(room=>room.id==='hall').manifest.scenery
  const bothHeader=fs.readFileSync(path.join(both.stage,'src/generated/world_maps.h'),'utf8')
  assert.deepEqual([bothPlan.planes,bothPlan.panorama],[2,false]);assert.ok(bothPlan.patterns>2688,'padrões dos dois planos numa tabela só: '+bothPlan.patterns)
  assert.match(bothHeader,new RegExp('Scenery=\\{&retroWorldRoom'+hall+'StreamTiles,&retroWorldRoom'+hall+'StreamCells,0,0,0,'+bothPlan.windowPatterns+',2048,56,\\(const u16\\*\\)RETRO_WORLD_ROOM_'+hall+'_STREAM_IDS,&retroWorldRoom'+hall+'BackCells,\\(const u16\\*\\)RETRO_WORLD_ROOM_'+hall+'_BACK_IDS\\};'))
  // A frente (quase vazia) é o plano 0: células vazias apontam para "nada" (0xFFFF), sem gastar padrão.
  const frontIds=fs.readFileSync(path.join(both.stage,'res/generated/world-'+hall+'-stream-ids.bin'));let empty=0;for(let i=0;i<frontIds.length;i+=2)if(frontIds.readUInt16BE(i)===0xFFFF)empty++
  assert.ok(empty>400*28-200,'frente vazia: '+empty)
  writeConfig(config)
  // Dimensões ímpares: o binário guarda o tamanho exato do mapa, sem o preenchimento em blocos de 16 px.
  const odd=Array.from({length:45*29},(_v,index)=>1+index%256)
  save('hall',toTMX({width:45,height:29,tiles:odd,tilesets:tileset,collision:Array(45*29).fill(0),objects:[{id:1,type:'player_spawn',x:2,y:2,width:1,height:1}],parallaxLayers:[clouds]}))
  fs.writeFileSync(path.join(root,'world/world.json'),JSON.stringify({format:'retro-studio.world',version:1,rooms:[{id:'hall',map:'maps/hall.tmx',width:360,height:232},{id:'cave',map:'maps/cave.tmx',width:320,height:224}]}))
  const small=run();assert.equal(small.result.status,0,small.result.stderr);const record=JSON.parse(fs.readFileSync(path.join(small.stage,'res/generated/world-map-manifest.json'))).rooms.find(room=>room.id==='hall').manifest.scenery
  assert.equal(record.windowPatterns,record.patterns,'a sala inteira cabe na janela: precisa de todos os padrões ('+record.windowPatterns+' de '+record.patterns+')');assert.equal(record.patterns,256)
  // Modo de vídeo declarado só no contrato do projeto (H32): a tela de 256 px vale para ajuste e limites.
  writeConfig({...config,retroStudio:{target:{videoMode:'H32'}}});const narrow=run();assert.equal(narrow.result.status,0,narrow.result.stderr)
  assert.equal(JSON.parse(fs.readFileSync(path.join(narrow.stage,'res/generated/world-map-manifest.json'))).rooms.find(room=>room.id==='hall').manifest.scenery.viewWidth,256)
  writeConfig(config);save('hall',hallMap());fs.writeFileSync(path.join(root,'world/world.json'),JSON.stringify({format:'retro-studio.world',version:1,rooms:[{id:'hall',map:'maps/hall.tmx',width:W*8,height:H*8},{id:'cave',map:'maps/cave.tmx',width:320,height:224}]}))
 }
 // Fundo fixo com a frente vazia (#90): o fundo vai sozinho para BG_B e o cenário para BG_A, cada um
 // com as próprias cores (desenhados juntos, os tiles misturariam as paletas das duas imagens).
 {
  save('cave',toTMX({width:40,height:28,tiles:caveTiles,tilesets:tileset,background:{path:'../res/hills.png',fit:'contain',opacity:1},collision:Array(40*28).fill(0),objects:[{id:1,type:'player_spawn',x:2,y:10,width:1,height:1}]}))
  const split=run();assert.equal(split.result.status,0,split.result.stderr)
  const planes=spawnSync('python3',['-c',`from PIL import Image
import sys
back,front=Image.open(sys.argv[1]),Image.open(sys.argv[2])
print(sum(1 for v in back.getdata() if v%16), sum(1 for v in front.getdata() if v%16), max(front.getdata())>=128)`,path.join(split.stage,'res/generated/world-'+cave+'-bg.png'),path.join(split.stage,'res/generated/world-'+cave+'-fg.png')],{encoding:'utf8'})
  assert.equal(planes.status,0,planes.stderr);const [backPixels,frontPixels,priority]=planes.stdout.trim().split(' ')
  assert.ok(Number(backPixels)>0&&Number(frontPixels)===40*28*64,'fundo em BG_B, cenário inteiro em BG_A: '+planes.stdout)
  assert.equal(priority,'False','o cenário mantém a prioridade dele (baixa): o personagem passa na frente')
  assert.match(fs.readFileSync(path.join(split.stage,'src/generated/world_maps.h'),'utf8'),new RegExp('\\{'+cave+',&RETRO_WORLD_ROOM_'+cave+'_TILES,&RETRO_WORLD_ROOM_'+cave+',&RETRO_WORLD_ROOM_'+cave+'_FG_TILES,&RETRO_WORLD_ROOM_'+cave+'_FG,'))
  save('cave',caveMap)
 }
 // Mapa inicial avulso (fora do mundo) continua recusando panoramas, dizendo onde eles funcionam.
 fs.copyFileSync(path.join(root,'maps/hall.tmx'),path.join(root,'maps/legacy.tmx'))
 const legacy=spawnSync('python3',[path.join(root,'tools/export-map.py')],{cwd:root,encoding:'utf8'});assert.notEqual(legacy.status,0);assert.match(legacy.stderr,/Panoramas móveis são executados nas salas do mundo/);fs.rmSync(path.join(root,'maps/legacy.tmx'))
 console.log('Scenery export: bands and 8.8 speeds, streamed layer resources, pattern budget ('+plan.panoramaPatterns+' panorama + '+plan.windowPatterns+' window of '+plan.patterns+' map patterns), 16 refused combinations with reasons, 3 accepted compositions.')
 // ---- 3. Pelo caminho da IDE: o serviço do mundo roda o exportador e publica no projeto -------
 const worldRoom=(id,width,height)=>({id,name:id,map:'maps/'+id+'.tmx',width,height,entries:[{id:'spawn',x:160,y:112,facing:false}],exits:[],checkpoints:[]})
 const worldConfig={format:'retro-studio.world',version:1,initial:{room:'hall',entry:'spawn'},rooms:[worldRoom('hall',W*8,H*8),worldRoom('cave',320,224)],conditions:[]}
 fs.rmSync(path.join(root,'world/world.json')) // o arquivo mínimo usado acima dá lugar ao que o serviço grava
 const publish=()=>saveWorldConfigurationWithMaps(root,{config:worldConfig,revision:worldConfigurationStatus(root).revision})
 // Projeto sem o módulo de cenário: a exportação para antes, dizendo o que instalar (em vez de o build quebrar em um #include).
 {
  const bare=path.join(temporary,'sem-modulo');fs.cpSync(root,bare,{recursive:true,filter:source=>!/retro_scenery/.test(source)&&!source.endsWith('.retrostudio')})
  installRuntimeModules(bare,{moduleIds:['world-sgdk','movement']});for(const file of ['retro_scenery.h','retro_scenery.c','retro_scenery_sgdk.h','retro_scenery_sgdk.c'])assert.ok(!fs.existsSync(path.join(bare,'src/retro_runtime',file)))
  fs.rmSync(path.join(bare,'world/world.json'),{force:true})
  await assert.rejects(saveWorldConfigurationWithMaps(bare,{config:worldConfig,revision:worldConfigurationStatus(bare).revision}),/salas com panoramas ou com mais tiles do que cabem na VRAM, que usam o runtime de cenário \(streaming\)\. Atualize os módulos em Jogo → Módulos de apoio → Revisar atualização… \(scenery-sgdk\)/)
  assert.ok(!fs.existsSync(path.join(bare,'src/generated/world_maps.h')),'nada foi publicado')
 }
 const published=await publish();assert.equal(published.success,true);assert.equal(published.mapsExported,2)
 const projectResources=fs.readFileSync(path.join(root,'res/resources.res'),'utf8')
 assert.ok(projectResources.includes('TILEMAP RETRO_WORLD_ROOM_'+hall+'_PAN '),'TILEMAP do panorama publicado');assert.ok(projectResources.indexOf('TILESET RETRO_WORLD_ROOM_'+hall+'_PAN_TILES ')<projectResources.indexOf('TILEMAP RETRO_WORLD_ROOM_'+hall+'_PAN '))
 for(const kind of ['PATTERNS','CELLS','IDS'])assert.ok(projectResources.includes('BIN RETRO_WORLD_ROOM_'+hall+'_STREAM_'+kind+' '),'BIN publicado: '+kind)
 for(const file of ['res/generated/world-'+hall+'-pan.png','res/generated/world-'+hall+'-bg.png','res/generated/world-'+hall+'-stream-ids.bin','src/generated/world_maps.h'])assert.ok(fs.existsSync(path.join(root,file)),'publicado: '+file)
 assert.match(fs.readFileSync(path.join(root,'src/generated/world_maps.h'),'utf8'),/&retroScenerySgdkRenderer/)
 assert.equal((await publish()).changed.length,0,'publicar de novo sem mudanças não reescreve nada')
 // Mudar a reserva de cenário muda o que é exportado: a exportação anterior passa a estar desatualizada.
 writeConfig({...JSON.parse(fs.readFileSync(path.join(root,'retro-studio.json'),'utf8')),scenery:{...config.scenery,dmaBytes:1800}})
 const again=await publish();assert.ok(again.changed.includes('src/generated/world_maps.h'),'mudança em scenery reexporta: '+JSON.stringify(again.changed));assert.match(fs.readFileSync(path.join(root,'src/generated/world_maps.h'),'utf8'),/,1800,56,\(const u16\*\)/)
 console.log('IDE world export: panorama image, TILEMAP resources and scenery bindings published; scenery settings mark the export stale.')
 // ---- 4. ROM de referência ---------------------------------------------------------------
 const sdk=arg('--sgdk')
 if(sdk){
  fs.writeFileSync(path.join(root,'src/fixture_ids.h'),'#define FIXTURE_HALL '+hall+'\n#define FIXTURE_CAVE '+cave+'\n#define FIXTURE_HALL_WIDTH '+W*8+'\n#define FIXTURE_HALL_HEIGHT '+H*8+'\n#define FIXTURE_CAVE_WIDTH 320\n#define FIXTURE_CAVE_HEIGHT 224\n#define FIXTURE_TILE_BUDGET '+BUDGET+'\n')
  fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/scenery-diagnostic.c'),path.join(root,'src/main.c'))
  fs.writeFileSync(path.join(root,'Makefile'),'include $(GDK)/makefile.gen\nout/src/main.o: out/res/resources.o\n')
  const build=spawnSync('make',['-j2','release','GDK='+sdk],{cwd:root,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024})
  assert.equal(build.status,0,(build.stdout+build.stderr).slice(-3000));assert.ok(!/warning:/.test(build.stdout+build.stderr),'sem avisos do compilador: '+(build.stdout+build.stderr).match(/.*warning:.*/)?.[0])
  const rom=fs.readFileSync(path.join(root,'out/rom.bin'));assert.ok(rom.subarray(256,272).toString().includes('SEGA'))
  if(arg('--keep-rom'))fs.copyFileSync(path.join(root,'out/rom.bin'),arg('--keep-rom'))
  console.log('Reference ROM built with the real toolchain ('+rom.length+' bytes): streamed room + two-band panorama + legacy room.')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
