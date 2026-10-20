// Jogo → Inimigos: formato, resolução de referências, paleta, exportação transacional,
// propriedade dos arquivos gerados, porta de build e painel de exportações.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {enemyProject,HERO_PALETTE} from './fixtures/enemy-project.mjs'
import {rgbToVdp} from '../shared/retro/paletteConfiguration.js'
import {createEnemyConfiguration,createEnemyDefinition,validateEnemyConfiguration,parseTmxObjects,enemyInstance,setEnemyInstanceType,setEnemyInstanceProperty,ENEMY_ROOM_SPAWN_MAX} from '../shared/retro/enemies.js'
import {enemyConfigurationStatus,saveEnemyConfiguration,exportEnemies,validateEnemiesForBuild} from '../electron/retro/enemyConfiguration.js'
import {exportOverview} from '../electron/retro/exportOverview.js'
import {decodePng} from '../electron/retro/pngDecode.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'retro-enemy-export-'))
const read=file=>fs.readFileSync(path.join(root,file),'utf8')
const exists=file=>fs.existsSync(path.join(root,file))
const hash=file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')
const {write,png,character,tmx,create}=enemyProject(root)
const HERO=HERO_PALETTE
try{
 // Projeto mínimo: jogador (dono da paleta 1), inimigo com as mesmas cores, sala com 2 instâncias.
 await create()

 // TMX sem DOM: atributos, propriedades, autofechado e "class".
 const objects=parseTmxObjects(read('maps/room.tmx'))
 assert.equal(objects.length,3);assert.equal(objects[0].properties.patrolLeft,'40')
 assert.equal(parseTmxObjects('<object id="9" class="enemy" x="1" y="2"/>')[0].type,'enemy')
 assert.equal(enemyInstance({properties:{kind:'legado'}},createEnemyConfiguration().settings).reference,'legado')
 assert.throws(()=>enemyInstance({properties:{enemy:'a',respawn:'sempre'}},createEnemyConfiguration().settings),/Reaparecimento/)
 // Painel do objeto: tipo grava enemy e kind iguais; vazio volta ao padrão; números inteiros.
 let props=setEnemyInstanceType({kind:'',priority:1},'ninja')
 assert.deepEqual(props,{kind:'ninja',priority:1,enemy:'ninja'})
 props=setEnemyInstanceProperty(setEnemyInstanceProperty(props,'patrolLeft','40.6'),'facing','left')
 assert.equal(props.patrolLeft,41);assert.equal(props.facing,'left')
 assert.ok(!('patrolLeft' in setEnemyInstanceProperty(props,'patrolLeft','')))
 assert.deepEqual(setEnemyInstanceType(props,''),{kind:'',priority:1,patrolLeft:41,facing:'left'})
 assert.equal(enemyInstance({properties:props},createEnemyConfiguration().settings).patrolLeft,41)

 // Projeto sem inimigos: nada configurado, nenhuma exigência e o build segue.
 let status=enemyConfigurationStatus(root)
 assert.equal(status.configured,false);assert.deepEqual(validateEnemiesForBuild(root),{configured:false})
 assert.equal(status.characters.length,2)

 // Criar, salvar e reabrir.
 const config=createEnemyConfiguration()
 config.settings.palette={mode:'shared',slot:1,from:'charsets/hero.charset.json'}
 const ninja=createEnemyDefinition('ninja','Ninja')
 Object.assign(ninja,{character:'charsets/ninja.charset.json',animations:{idle:'idle',walk:'run',attack:'ataque',hurt:'dano',death:''},detectionRange:40})
 ninja.attack.enabled=true
 config.definitions.push(ninja)
 let saved=saveEnemyConfiguration(root,{config,revision:status.revision})
 assert.equal(saved.exported,true,saved.problems.join('\n'));assert.deepEqual(saved.problems,[])
 const header=read('src/generated/enemy_data.h')
 assert.match(header,/\.visual=&SPR_NINJA,\.palette=PAL1/)            // cores compatíveis: usa o sprite exportado
 assert.ok(!exists('res/enemies.res')&&!exists('res/generated/enemy-ninja.png'))
 assert.match(header,/\.attack=\{6,-28,20,14\}/)                      // área de ataque marcada na animação
 assert.match(header,/\{0,0,112,200,72,152,32,0,1,RETRO_ENEMY_RESPAWN_ROOM\} \/\* #3 Guarda \*\//)
 assert.match(header,/\{1,0,312,200,0,0,32,120,0,RETRO_ENEMY_RESPAWN_DELAY\}/) // "kind" legado, atraso de 2 s
 assert.match(header,/retroEnemyRoom\d+Pal\[\]/);assert.match(header,/RETRO_ENEMY_DATA_INSTANCE_COUNT 2/)
 assert.ok(saved.warnings.length===0)
 assert.deepEqual(saved.fallbacks.ninja,{death:'hurt'})                // morte usa a animação de dano
 status=enemyConfigurationStatus(root)
 assert.deepEqual(status.config,config);assert.equal(status.upToDate,true)
 assert.equal(validateEnemiesForBuild(root).instances,2)
 assert.equal(exportOverview(root).rows.find(row=>row.id==='enemies').state,'current')

 // Editar: só a fonte e o C mudam; o mapa fica intacto.
 const tmxHash=hash('maps/room.tmx')
 status.config.definitions[0].health=5
 saved=saveEnemyConfiguration(root,{config:status.config,revision:status.revision})
 assert.match(read('src/generated/enemy_data.h'),/\.health=5/);assert.equal(JSON.parse(read('enemies/enemies.json')).definitions[0].health,5)
 assert.equal(hash('maps/room.tmx'),tmxHash)
 assert.throws(()=>saveEnemyConfiguration(root,{config:status.config,revision:status.revision}),/recarregue/)

 // Mapa mudou: o build é barrado até exportar de novo; exportar não perde a fonte.
 tmx([{id:3,name:'Guarda',x:120,y:176,props:{enemy:'ninja'}},{id:4,x:300,y:176,props:{enemy:'ninja'}},{id:5,x:500,y:176,props:{enemy:'ninja',respawn:'never'}}])
 assert.throws(()=>validateEnemiesForBuild(root),/mudaram/)
 const overview=exportOverview(root);assert.ok(overview.blocksBuild.includes('enemies'))
 const sourceBefore=read('enemies/enemies.json')
 assert.equal(exportEnemies(root).exported,true);assert.equal(read('enemies/enemies.json'),sourceBefore)
 assert.match(read('src/generated/enemy_data.h'),/RETRO_ENEMY_DATA_INSTANCE_COUNT 3/)

 // Referências inválidas: mensagens claras, a fonte é salva e o build fica barrado.
 tmx([{id:3,x:100,y:176,props:{enemy:'fantasma'}},{id:4,x:300,y:176,props:{kind:''}}])
 status=enemyConfigurationStatus(root)
 assert.ok(status.problems.some(text=>/objeto #3.*"fantasma" não está cadastrado/.test(text)))
 assert.ok(status.problems.some(text=>/objeto #4.*escolha qual inimigo/.test(text)))
 const broken=JSON.parse(JSON.stringify(status.config))
 broken.definitions[0].animations.walk='voar'
 broken.definitions.push({...createEnemyDefinition('sem_export','Sem export'),character:'charsets/fantasma.charset.json',animations:{idle:'x',walk:'',attack:'',hurt:'',death:''}})
 saved=saveEnemyConfiguration(root,{config:broken,revision:status.revision})
 assert.equal(saved.exported,false)
 assert.ok(saved.problems.some(text=>/"voar".*não existe mais/.test(text)))
 assert.ok(saved.problems.some(text=>/fantasma\.charset\.json não foi encontrado/.test(text)))
 assert.equal(JSON.parse(read('enemies/enemies.json')).definitions.length,2)  // a edição não se perde
 assert.throws(()=>validateEnemiesForBuild(root),/Inimigos:/)
 character('lento','lento.png',[['idle',1]],{exportedFileName:'',exportedHeaderName:'',exportedResourceName:''})
 broken.definitions[1].character='charsets/lento.charset.json'
 status=enemyConfigurationStatus(root,{draft:broken})
 assert.ok(status.problems.some(text=>/ainda não foi exportado/.test(text)))

 // Limites: definição e instâncias por sala.
 assert.throws(()=>validateEnemyConfiguration({...createEnemyConfiguration(),settings:{...createEnemyConfiguration().settings,maxActive:9}}),/de 1 a 8/)
 tmx(Array.from({length:ENEMY_ROOM_SPAWN_MAX+1},(_,i)=>({id:i+10,x:8*i,y:176,props:{enemy:'ninja'}})))
 const valid=JSON.parse(JSON.stringify({...status.config,definitions:[status.config.definitions[0]]}))
 valid.definitions[0].animations.walk='run'
 assert.ok(enemyConfigurationStatus(root,{draft:valid}).problems.some(text=>/33 inimigos; o runtime aceita até 32/.test(text)))

 // Paleta própria: a linha 0 é das salas (recusada); a 3 está livre.
 tmx([{id:3,x:100,y:176,props:{enemy:'ninja'}}])
 const own=JSON.parse(JSON.stringify(valid));own.settings.palette={mode:'own',slot:0,from:''}
 assert.ok(enemyConfigurationStatus(root,{draft:own}).problems.some(text=>/linha 0 é carregada pelas salas/.test(text)))
 own.settings.palette.slot=3
 status=enemyConfigurationStatus(root)
 saved=saveEnemyConfiguration(root,{config:own,revision:status.revision})
 assert.equal(saved.exported,true,saved.problems.join('\n'))
 assert.match(read('src/generated/enemy_data.h'),/PAL_setPalette\(RETRO_ENEMY_DATA_PALETTE,SPR_NINJA\.palette->data,DMA\)/)

 // Cores diferentes: cópia remapeada (o sprite original não muda) e aviso das cores aproximadas.
 const ORIGINAL=hash('res/ninja.png')
 await png('res/ninja.png',[0,rgbToVdp(200,0,200),rgbToVdp(0,200,200),rgbToVdp(250,250,250)],(x,y)=>x%48<4?0:1+(y%3))
 const shared=JSON.parse(JSON.stringify(valid))
 status=enemyConfigurationStatus(root)
 saved=saveEnemyConfiguration(root,{config:shared,revision:status.revision})
 assert.equal(saved.exported,true,saved.problems.join('\n'))
 assert.ok(exists('res/generated/enemy-ninja.png')&&/SPRITE RETRO_ENEMY_SPR_NINJA "generated\/enemy-ninja\.png" 6 6 NONE 0 NONE/.test(read('res/enemies.res')))
 assert.match(read('src/generated/enemy_data.h'),/#include "\.\.\/\.\.\/res\/enemies\.h"/)
 assert.ok(saved.warnings.some(text=>/cor\(es\) aproximada\(s\)/.test(text)))
 const remapped=decodePng(fs.readFileSync(path.join(root,'res/generated/enemy-ninja.png')))
 assert.deepEqual(remapped.palette.slice(0,5).map(([r,g,b])=>rgbToVdp(r,g,b)),HERO)
 assert.notEqual(hash('res/ninja.png'),ORIGINAL)  // a imagem do personagem é do Charset Maker, não do exportador

 // Arquivo gerado editado à mão: preservado, salvar recusa, painel mostra conflito.
 write('src/generated/enemy_data.h',read('src/generated/enemy_data.h')+'/* meu ajuste */\n')
 status=enemyConfigurationStatus(root)
 assert.deepEqual(status.generatedConflicts,['src/generated/enemy_data.h'])
 assert.throws(()=>saveEnemyConfiguration(root,{config:shared,revision:status.revision}),/personalizado/)
 assert.match(read('src/generated/enemy_data.h'),/meu ajuste/)
 assert.equal(exportOverview(root).rows.find(row=>row.id==='enemies').state,'conflict')
 fs.rmSync(path.join(root,'src/generated/enemy_data.h'))

 // Cores compatíveis de novo: os gerados que sobraram são removidos (ainda eram da IDE).
 await png('res/ninja.png',HERO,(x,y)=>x%48<4?0:1+(y%3))
 status=enemyConfigurationStatus(root)
 saved=saveEnemyConfiguration(root,{config:shared,revision:status.revision})
 assert.equal(saved.exported,true);assert.ok(!exists('res/enemies.res')&&!exists('res/generated/enemy-ninja.png'))
 assert.deepEqual(Object.keys(JSON.parse(read('.retrostudio/enemy-export.json')).files),['src/generated/enemy_data.h'])
}finally{fs.rmSync(root,{recursive:true,force:true})}
console.log('Enemy export: TMX, kind legado, criar/salvar/reabrir/editar, mapa intacto, reexportar sem perda, referências inválidas, limites, paleta própria/compartilhada/remapeada, gerados personalizados e remoção conferidos.')
