// #70: jogo gerado. Escolher jogador -> src/game/*.{c,h} + main.c curto, sem tocar em código do autor.
// Com --sgdk <GDK> também compila a ROM com o código gerado (o CI roda sem o SDK).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {GAME_HOST_FILES,GAME_MAIN,GAME_ROLES,GAME_RUNTIME_FILES,createGameConfiguration,validateGameConfiguration,resolveGamePlayer,compileGameHost} from '../shared/retro/gameHost.js'
import {gameHostStatus,saveGameHost,validateGameForBuild,useMapSpawnAsStart} from '../electron/retro/gameHost.js'
import {mapSpawnPoint} from '../shared/retro/mapSpawn.js'
import {worldMapCatalog} from '../electron/retro/worldConfiguration.js'
import {exportOverview} from '../electron/retro/exportOverview.js'
import {validateWorldForBuild} from '../electron/retro/worldConfiguration.js'
import {copyProjectTemplate,prepareNewProject} from '../electron/retro/starterProject.js'
import {installNewProjectRuntime} from '../electron/retro/newProject.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
const repository=fileURLToPath(new URL('../',import.meta.url)),template=path.join(repository,'assets/toolkit/examples/sgdk-starter')
const templateMain=fs.readFileSync(path.join(repository,'assets/toolkit/examples/sgdk-skeleton/src/main.c'))
const argument=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1]}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-game-host-'))
const copy=(source,target)=>fs.cpSync(source,target,{recursive:true,filter:file=>!file.includes(path.sep+'out'+path.sep)&&!file.endsWith(path.sep+'out')})
const read=(root,file)=>fs.readFileSync(path.join(root,file),'utf8')
try{
 // Projeto com personagem (parado/andando/pulando/caindo), duas salas e tudo exportado.
 const root=path.join(temporary,'game');fs.mkdirSync(root)
 copyProjectTemplate(template,root,copy);installNewProjectRuntime(root);installCutsceneRuntime(root)
 const project=JSON.parse(fs.readFileSync(path.join(template,'retro-studio.json'),'utf8'))
 fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({name:'game',resourcePath:'res',assets:[],mapExport:project.mapExport,retroStudio:project.retroStudio},null,2))
 assert.equal((await prepareNewProject(root)).complete,true)
 for(const file of GAME_RUNTIME_FILES)assert.ok(fs.existsSync(path.join(root,'src/retro_runtime',file)),'módulo distribuído: '+file)
 // Quem não optou não muda: sem trava, sem arquivo, linha "não usado" no painel.
 assert.deepEqual(validateGameForBuild(root),{configured:false});assert.ok(!fs.existsSync(path.join(root,'game'))&&!fs.existsSync(path.join(root,'src/game')))
 assert.equal(exportOverview(root).rows.find(row=>row.id==='game').state,'absent')
 const authored=read(root,'src/main.c')
 let status=gameHostStatus(root,{templateMain})
 assert.deepEqual(status.config,createGameConfiguration());assert.ok(!status.configured&&!status.exported&&!status.foreign);assert.equal(status.main,'custom','main.c do autor é reconhecido')
 assert.deepEqual(status.problems,['Escolha o personagem do jogador.']);assert.equal(status.characters.length,1);assert.ok(status.characters[0].exported)
 assert.deepEqual(GAME_ROLES.filter(role=>!status.characters[0].animations.some(name=>name===role)),[],'o personagem do projeto inicial tem as quatro animações')
 assert.ok(status.start.room&&status.start.entry&&status.start.map.endsWith('.tmx'));assert.match(status.snippet,/gameInit\(\);[\s\S]*gameUpdate\(\);[\s\S]*gameEndFrame\(\);/)
 // Rascunho: o editor pergunta o que falta sem gravar nada.
 const config=createGameConfiguration();config.player.character=status.characters[0].path
 assert.deepEqual(gameHostStatus(root,{templateMain,config}).problems,['Escolha a animação de "parado" (as outras são opcionais e usam a de parado quando faltam).'])
 assert.throws(()=>saveGameHost(root,{config,revision:status.revision,templateMain}),/parado/);assert.ok(!fs.existsSync(path.join(root,'game')),'nada é gravado com a configuração incompleta')
 Object.assign(config.player.animations,{idle:'idle',walk:'walk',jump:'jump',fall:'fall'})
 assert.deepEqual(gameHostStatus(root,{templateMain,config}).problems,[]);assert.throws(()=>saveGameHost(root,{config,revision:'antiga',templateMain}),/Recarregue/)
 for(const bad of [{...config,version:2},{...config,format:'x'},{...config,player:{...config.player,character:'../fora.charset.json'}},{...config,player:{...config.player,animations:{...config.player.animations,voar:'x'}}},{...config,player:{character:config.player.character,animations:{idle:1,walk:'',jump:'',fall:''}}}])assert.throws(()=>validateGameConfiguration(bad))
 // Exportar: só src/game/ e os registros; o main.c do autor fica como estava.
 let saved=saveGameHost(root,{config,revision:status.revision,templateMain})
 assert.ok(saved.exported&&saved.configured&&!saved.mainWritten);assert.equal(saved.main,'custom');assert.equal(read(root,'src/main.c'),authored)
 for(const file of GAME_HOST_FILES)assert.ok(fs.statSync(path.join(root,file)).isFile(),file)
 assert.deepEqual(fs.readdirSync(path.join(root,'src/game')).sort(),GAME_HOST_FILES.map(file=>path.basename(file)).sort(),'nada além dos arquivos gerados')
 const generated=read(root,'src/game/game_config.h')
 assert.match(generated,/#include "hero_animations\.h"/);assert.match(generated,/#define GAME_PLAYER_SPRITE HERO\n/);assert.match(generated,/#define GAME_PLAYER_DEFINITION hero_character_definition\n/)
 for(const [role,name] of [['IDLE','IDLE'],['WALK','WALK'],['JUMP','JUMP'],['FALL','FALL']])assert.match(generated,new RegExp('#define GAME_PLAYER_ANIM_'+role+' HERO_ANIM_'+name+'\\n'))
 assert.match(generated,/#define GAME_PLAYER_BODY_X \(-?\d+\)\n#define GAME_PLAYER_BODY_Y \(-\d+\)\n#define GAME_PLAYER_BODY_WIDTH \d+\n#define GAME_PLAYER_BODY_HEIGHT \d+\n/)
 // Modular e legível: um assunto por arquivo, interface pública curta, comentários em português.
 const header=read(root,'src/game/game.h');for(const name of ['gameInit','gameUpdate','gameEndFrame','gamePlayerX','gamePlayerY','gameCameraX','gameRoomId','gameButtonsPressed','gameFail'])assert.match(header,new RegExp('\\b'+name+'\\('))
 assert.match(read(root,'src/game/game_world.c'),/retroWorldSgdkInit\(/);assert.match(read(root,'src/game/game_player.c'),/retroMovementTick\(/);assert.match(read(root,'src/game/game_camera.c'),/__has_include\("generated\/camera_config\.h"\)/);assert.match(read(root,'src/game/game_audio.c'),/__has_include\("generated\/audio_sgdk\.h"\)/)
 assert.doesNotMatch(read(root,'src/game/game_player.c'),/retroWorld|RetroCamera\b/,'o jogador não conhece salas nem câmera');assert.doesNotMatch(read(root,'src/game/game_world.c'),/retroMovementTick|SPR_/,'as salas não mexem em física nem sprites')
 for(const file of GAME_HOST_FILES){const text=read(root,file);assert.match(text,/^\/\* Gerado pelo Retro Studio/);assert.ok(text.length<8000,file+' é pequeno');assert.ok(!/\t/.test(text))}
 // Trava do build e painel de exportações; salvar de novo sem mudar nada não reescreve arquivos.
 assert.equal(validateGameForBuild(root).configured,true);let overview=exportOverview(root);assert.equal(overview.rows.find(row=>row.id==='game').state,'current');assert.ok(!overview.blocksBuild.includes('game'))
 assert.equal(validateWorldForBuild(root).configured,true,'exportar o jogo não deixa o mundo desatualizado')
 const before=fs.statSync(path.join(root,'src/game/game.c')).mtimeMs;saved=saveGameHost(root,{config,revision:saved.revision,templateMain});assert.equal(fs.statSync(path.join(root,'src/game/game.c')).mtimeMs,before)
 // Mudar a escolha sem exportar: o build é recusado com instrução; exportar resolve.
 const changed=JSON.parse(JSON.stringify(config));changed.player.animations.walk=''
 fs.writeFileSync(path.join(root,'game/game.json'),JSON.stringify(changed,null,2)+'\n')
 assert.throws(()=>validateGameForBuild(root),/mudou depois da última exportação/);overview=exportOverview(root);assert.equal(overview.rows.find(row=>row.id==='game').state,'stale');assert.ok(overview.blocksBuild.includes('game'))
 status=gameHostStatus(root,{templateMain});assert.ok(!status.exported);saved=saveGameHost(root,{config:changed,revision:status.revision,templateMain})
 assert.match(read(root,'src/game/game_config.h'),/#define GAME_PLAYER_ANIM_WALK HERO_ANIM_IDLE\n/,'situação sem animação usa a de parado');assert.equal(validateGameForBuild(root).configured,true)
 // Arquivo gerado alterado pelo programador: preservado, avisa, não impede o build, não é atualizado sem pedido explícito.
 fs.appendFileSync(path.join(root,'src/game/game_player.c'),'/* ajuste do programador */\n')
 status=gameHostStatus(root,{templateMain});assert.deepEqual(status.conflicts,['src/game/game_player.c']);assert.deepEqual(validateGameForBuild(root).conflicts,['src/game/game_player.c'])
 overview=exportOverview(root);assert.equal(overview.rows.find(row=>row.id==='game').state,'conflict');assert.ok(!overview.blocksBuild.includes('game'))
 assert.throws(()=>saveGameHost(root,{config:changed,revision:status.revision,templateMain}),/Gerar por cima/);assert.match(read(root,'src/game/game_player.c'),/ajuste do programador/)
 saved=saveGameHost(root,{config:changed,revision:status.revision,templateMain,overwrite:true});assert.deepEqual(saved.conflicts,[]);assert.doesNotMatch(read(root,'src/game/game_player.c'),/ajuste do programador/)
 // Animação ou personagem que sumiu: explicado, nada gerado; game.json de outra ferramenta: recurso fora de uso.
 const gone=JSON.parse(JSON.stringify(changed));gone.player.animations.jump='voando'
 assert.throws(()=>saveGameHost(root,{config:gone,revision:saved.revision,templateMain}),/"voando" não existe mais/)
 fs.renameSync(path.join(root,'src/hero_animations.h'),path.join(root,'src/hero_animations.h.bak'));assert.match(gameHostStatus(root,{templateMain}).problems.join(' '),/Falta src\/hero_animations\.h/);assert.throws(()=>validateGameForBuild(root),/hero_animations/);fs.renameSync(path.join(root,'src/hero_animations.h.bak'),path.join(root,'src/hero_animations.h'))
 fs.renameSync(path.join(root,'src/retro_runtime/retro_camera.h'),path.join(root,'src/retro_runtime/retro_camera.h.bak'));assert.match(gameHostStatus(root,{templateMain}).problems.join(' '),/Faltam módulos de apoio.*retro_camera\.h/);fs.renameSync(path.join(root,'src/retro_runtime/retro_camera.h.bak'),path.join(root,'src/retro_runtime/retro_camera.h'))
 // main.c do modelo é trocado uma vez pelo main.c curto; depois de editado pelo autor, nunca mais.
 const fresh=path.join(temporary,'fresh');copy(root,fresh);fs.rmSync(path.join(fresh,'game'),{recursive:true});fs.rmSync(path.join(fresh,'src/game'),{recursive:true});fs.rmSync(path.join(fresh,'.retrostudio/game-host-export.json'))
 fs.writeFileSync(path.join(fresh,'src/main.c'),templateMain.toString('utf8').replace(/\n/g,'\r\n'))
 status=gameHostStatus(fresh,{templateMain});assert.equal(status.main,'template','fim de linha diferente ainda é o modelo')
 saved=saveGameHost(fresh,{config,revision:status.revision,templateMain});assert.ok(saved.mainWritten);assert.equal(saved.main,'host');assert.equal(read(fresh,'src/main.c'),GAME_MAIN)
 assert.match(GAME_MAIN,/gameInit\(\);[\s\S]*gameUpdate\(\);[\s\S]*Seu código de cada quadro aqui[\s\S]*gameEndFrame\(\);/)
 fs.writeFileSync(path.join(fresh,'src/main.c'),GAME_MAIN.replace('/* Seu código de cada quadro aqui','(void)gamePlayerX(); /* meu jogo */ /* Seu código de cada quadro aqui'))
 status=gameHostStatus(fresh,{templateMain});assert.equal(status.main,'custom-host');saved=saveGameHost(fresh,{config:changed,revision:status.revision,templateMain});assert.ok(!saved.mainWritten);assert.match(read(fresh,'src/main.c'),/\/\* meu jogo \*\//)
 // Ponto de entrada sem chão: aviso (não impede), calculado dos colisores exportados da sala inicial.
 const world=JSON.parse(read(fresh,'world/world.json')),initial=world.rooms.find(room=>room.id===world.initial.room),entry=initial.entries.find(item=>item.id===world.initial.entry)
 assert.doesNotMatch(gameHostStatus(fresh,{templateMain}).warnings.join(' '),/Não há chão/,'a entrada do projeto inicial tem chão')
 const headerFile=fs.readdirSync(path.join(fresh,'src/generated')).filter(name=>/^world_room_\d+\.h$/.test(name)).find(name=>read(fresh,'src/generated/'+name).includes('Colliders[]'))
 assert.ok(headerFile&&entry)
 // Spawn desenhado no mapa: lido como os pés (centro da base); vira a entrada inicial com um clique e as salas são exportadas de novo.
 assert.deepEqual(mapSpawnPoint('<map><objectgroup><object id="2" name="Spawn" type="player_spawn" x="272" y="96" width="16" height="40"></object></objectgroup></map>'),{x:280,y:136})
 assert.deepEqual(mapSpawnPoint('<object id="1" type="enemy" x="1" y="2"/><object type="player_spawn" id="3" x="10.4" y="20"/>'),{x:10,y:20});assert.equal(mapSpawnPoint('<map></map>'),null);assert.equal(mapSpawnPoint(''),null)
 const mapFile=path.join(fresh,initial.map),spot={x:Math.min(entry.x+40,initial.width-8),y:entry.y}
 fs.writeFileSync(mapFile,read(fresh,initial.map).replace(/<object\b[^>]*type="player_spawn"[^>]*?(\/>|>[\s\S]*?<\/object>)/,'<object id="900" name="Spawn" type="player_spawn" x="'+(spot.x-8)+'" y="'+(spot.y-24)+'" width="16" height="24"/>'))
 status=gameHostStatus(fresh,{templateMain});assert.deepEqual(status.start.mapSpawn,spot);assert.match(status.warnings.join(' '),/O mapa tem um ponto Spawn em \(x \d+, y \d+\), mas a entrada inicial está em/)
 assert.deepEqual(worldMapCatalog(fresh).maps.find(map=>map.path===initial.map).spawn,spot)
 assert.deepEqual(await useMapSpawnAsStart(fresh),{success:true,...spot})
 status=gameHostStatus(fresh,{templateMain});assert.deepEqual([status.start.x,status.start.y],[spot.x,spot.y]);assert.doesNotMatch(status.warnings.join(' '),/ponto Spawn/);assert.deepEqual(status.problems,[],'as salas foram exportadas de novo')
 assert.equal(validateGameForBuild(fresh).configured,true);assert.match(read(fresh,'src/game/game_player.c'),/y - box->y <= 16\) y = box->y;/,'entrada um pouco dentro do chão começa em cima dele')
 fs.writeFileSync(mapFile,read(fresh,initial.map).replace(/<object\b[^>]*type="player_spawn"[^>]*\/>/,''));assert.equal(gameHostStatus(fresh,{templateMain}).start.mapSpawn,null);await assert.rejects(useMapSpawnAsStart(fresh),/não tem um ponto Spawn/)
 await useMapSpawnAsStart(fresh).catch(()=>{});{const world=(await import('../electron/retro/worldConfiguration.js'));const current=world.worldConfigurationStatus(fresh);await world.saveWorldConfigurationWithMaps(fresh,{config:current.config,revision:current.revision})}
 // Compilação real, quando o SDK está disponível.
 const sdk=argument('--sgdk')
 if(sdk){
  const options={cwd:fresh,encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024}
  const made=spawnSync('make',['-j2','release','GDK='+sdk,'NODE='+process.execPath],options);assert.equal(made.status,0,String(made.stdout).slice(-3000)+String(made.stderr).slice(-3000))
  assert.ok(fs.statSync(path.join(fresh,'out/rom.bin')).size>0);assert.doesNotMatch(String(made.stdout)+String(made.stderr),/src\/game\/[^\n]*warning:/,'código gerado compila sem avisos')
  if(argument('--keep-rom'))fs.copyFileSync(path.join(fresh,'out/rom.bin'),argument('--keep-rom'))
 }
 // Geração pura: mesmo jogador, mesmos bytes; sem jogador, erro.
 const player=resolveGamePlayer(config,JSON.parse(read(root,config.player.character))).player
 assert.deepEqual(compileGameHost(player),compileGameHost(player));assert.throws(()=>compileGameHost(null));assert.deepEqual(Object.keys(compileGameHost(player)),GAME_HOST_FILES)
 assert.deepEqual(resolveGamePlayer(config,null).problems,['O personagem escolhido não foi encontrado em '+config.player.character+'.'])
 assert.match(resolveGamePlayer(config,{characterName:'hero',animations:[{name:'idle'}]}).problems.join(' '),/ainda não foi exportado/)
 // Ligações: IPC, travas do build, painel, cartão e abertura pelo explorador.
 const source=file=>fs.readFileSync(path.join(repository,file),'utf8')
 const main=source('electron/main.js'),preload=source('electron/preload.cjs'),game=source('electron/retro/game.js'),tools=source('electron/retro/buildForTools.js'),workspace=source('src/components/retro/GameWorkspace.vue'),editor=source('src/components/retro/GameStartEditor.vue')
 assert.match(main,/ipcMain\.handle\('retro:game-host', async[\s\S]{0,200}gameHostStatus\(await assetActionWorkspace\(payload\)/);assert.match(main,/ipcMain\.handle\('retro:save-game-host'[\s\S]{0,260}overwrite: payload\.overwrite === true/)
 assert.match(preload,/gameHost: \(payload\) => invoke\('retro:game-host', payload\)/);assert.match(preload,/saveGameHost: \(payload\) => invoke\('retro:save-game-host', payload\)/);assert.match(preload,/useMapSpawnAsStart: \(payload\) => invoke\('retro:game-host-use-map-spawn', payload\)/);assert.match(editor,/@click="useSpawn">Usar o Spawn do mapa<\/button>/)
 assert.match(source('src/components/retro/WorldGraphEditor.vue'),/x:map\.spawn\?map\.spawn\.x:Math\.min\(24,map\.width-1\)/);assert.match(source('src/components/retro/WorldGraphEditor.vue'),/@click="item\.x=mapSpawn\.x;item\.y=mapSpawn\.y">Usar o Spawn do mapa/)
 for(const text of [game,tools])assert.match(text,/validateGameForBuild\(projectPath\)[\s\S]{0,220}'Jogador e início: '/)
 assert.match(source('electron/retro/worldMapExport.js'),/'hud','game'\]\.includes\(entry\.name\)/,'game/game.json não é entrada do exportador de mapas')
 assert.match(workspace,/start: GameStartEditor/);assert.match(workspace,/\{ id: 'start', row: 'game', title: 'Jogador e início'/)
 assert.match(editor,/saveGameHost\(\{ projectPath, config: clone\(config\.value\), revision: status\.value\.revision, overwrite \}\)/);assert.match(editor,/Gerar por cima \(descarta essas alterações\)/);assert.ok(!/v-html/.test(editor))
 for(const id of ['game-start-character','game-start-title'])assert.ok(editor.includes(id));assert.ok((editor.match(/role="alert"/g)||[]).length>=4)
 assert.match(source('src/utils/retro/authoringFiles.js'),/'game\/game\.json': 'start'/)
 console.log('Game host: opt-in, draft problems, modular generated files, build gate, stale/conflict/overwrite, author main.c preserved, template main.c replaced once, wiring'+(sdk?', real ROM build':'')+'.')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
