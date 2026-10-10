// #65: configuração do HUD — validação (com as frases que o autor lê), layout com âncoras e área
// segura, faixa da janela, header (compilado e executado em C), custo, e o serviço da IDE em um
// projeto temporário: salvar, conflito, arquivo de outra ferramenta, trava de build, sprites.
// Com --sgdk <marsdev/m68k-elf>: constrói a ROM de diagnóstico (--keep-rom <arquivo> a guarda).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {HUD_FORMAT,HUD_LIMITS,SGDK_FONT_MAP,createHudConfiguration,validateHudConfiguration,layoutHud,anchorPosition,compileHudHeader,hudCost,hudSpriteSheet,encodeText,glyphWords} from '../shared/retro/hudConfiguration.js'
import {hudConfigurationStatus,saveHudConfiguration,validateHudForBuild} from '../electron/retro/hudConfiguration.js'
import {exportOverview} from '../electron/retro/exportOverview.js'
import {installRuntimeModules} from '../electron/retro/runtimeInstaller.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
import {HUD_SAMPLE_FONT} from '../shared/retro/hudSampleFont.js'
const repository=fileURLToPath(new URL('../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-hud-config-'))
const arg=name=>{const index=process.argv.indexOf(name);return index<0?'':process.argv[index+1]}
const clone=value=>JSON.parse(JSON.stringify(value))
try{
 // ---- 1. Padrão e âncoras ---------------------------------------------------------------
 const base=createHudConfiguration();validateHudConfiguration(base)
 assert.deepEqual([base.format,base.plane,base.font.map.length,base.font.glyphs.length],[HUD_FORMAT,'window',95,0]);assert.equal(base.font.map,SGDK_FONT_MAP)
 // Área segura de 8 px em tela de 320 × 224: cantos, bordas e centro de um bloco de 48 × 8.
 const at=(anchor,x=0,y=0)=>{const p=anchorPosition(base,anchor,x,y,48,8);return [p.x,p.y]}
 assert.deepEqual([at('top-left'),at('top'),at('top-right'),at('left'),at('center'),at('right'),at('bottom-left'),at('bottom'),at('bottom-right')],[[8,8],[136,8],[264,8],[8,108],[136,108],[264,108],[8,208],[136,208],[264,208]])
 assert.deepEqual(at('bottom-right',-8,-16),[256,192])
 let layout=layoutHud(base)
 assert.deepEqual(layout.elements.map(item=>[item.id,item.col,item.row,item.width]),[['score_label',1,1,6],['score',8,1,6],['life',34,1,5]]);assert.deepEqual(layout.window,{hud:{edge:'top',rows:2},overlay:null});assert.deepEqual(layout.hud,{col:1,row:1,width:38,height:1})
 // ---- 2. Fonte importada, menus, diálogo, sprites -----------------------------------------
 const map=' !?.,:>*-#0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç'
 const glyph=index=>Array.from({length:64},(_v,pixel)=>{const x=pixel%8,y=pixel>>3;return index===0?'0':(x>0&&x<7&&y>0&&y<7&&((x*3+y*5+index)%4!==0))?'1':(x===7||y===7?'0':'2')}).join('')
 const full={...createHudConfiguration(),font:{name:'fonte.png',map,glyphs:Array.from(map,(_c,index)=>glyph(index)),colors:[0,0x0EEE,0x0222,0,0,0,0,0,0,0,0,0,0,0,0,0]},
  values:[{id:'score',max:999999},{id:'life',max:5},{id:'energy',max:100},{id:'time',max:99}],
  elements:[{id:'label',type:'text',anchor:'top-left',x:0,y:0,text:'PONTUAÇÃO'},{id:'score',type:'number',anchor:'top-left',x:80,y:0,value:'score',digits:6,pad:'0'},
   {id:'life',type:'icons',anchor:'top-right',x:0,y:0,value:'life',max:5,full:'*',empty:'.'},{id:'energy',type:'bar',anchor:'top-left',x:0,y:8,value:'energy',width:12,full:'#',empty:'-'},
   {id:'time',type:'number',anchor:'top',x:0,y:12,value:'time',digits:2,pad:'0',sprite:true}],
  menus:[{id:'pause',anchor:'center',x:0,y:0,title:'PAUSA',cursor:'>',items:[{id:'resume',text:'Continuar'},{id:'options',text:'Opções'},{id:'quit',text:'Sair'}]}],
  dialogue:{enabled:true,anchor:'bottom',x:0,y:0,width:36,lines:3,speaker:true,cursor:'>'}}
 validateHudConfiguration(full);layout=layoutHud(full)
 assert.deepEqual(layout.elements.at(-1),{id:'time',sprite:true,x:152,y:20,width:2},'sprite: posição livre em pixels');assert.deepEqual(layout.menus[0],{id:'pause',col:14,row:11,width:11,height:5,titleRows:2},'centralizado desce para a grade')
 assert.deepEqual(layout.dialogue,{col:2,row:23,width:36,height:4});assert.deepEqual(layout.window,{hud:{edge:'top',rows:3},overlay:{edge:'bottom',rows:17}});assert.deepEqual(layout.overlay,{col:2,row:11,width:36,height:16})
 assert.ok(layout.notes.some(note=>/janela nas 3 linha\(s\) de tiles do alto \(24 px\): o plano A do jogo não aparece ali/.test(note)))
 assert.deepEqual(encodeText(full.font,'Opções','x').map(index=>Array.from(map)[index]).join(''),'Opções')
 assert.deepEqual(glyphWords('0123456789abcdef'.repeat(4)).map(word=>word.toString(16)),['1234567','89abcdef','1234567','89abcdef','1234567','89abcdef','1234567','89abcdef'])
 // Planilha de sprites: uma linha só, com os glifos que têm pixels; o espaço (vazio) fica de fora e o
 // header leva a tabela glifo → quadro. (Linhas ou quadros vazios seriam descartados pelo ResComp e deslocariam os índices.)
 const sheet=hudSpriteSheet(full),count=Array.from(map).length
 assert.deepEqual([sheet.width,sheet.height,sheet.indices.length,sheet.frames.length,sheet.frames[0],sheet.frames[1],sheet.frames[17]],[(count-1)*8,8,(count-1)*64,count,255,0,16]);assert.equal(sheet.indices[1*sheet.width+16*8+1],Number(glyph(17)[9]),'pixel (1,1) do glifo 17 no quadro 16')
 {const holes=clone(full);holes.font.glyphs[5]='0'.repeat(64);holes.font.glyphs[40]='0'.repeat(64);const next=hudSpriteSheet(holes);assert.deepEqual([next.frames[5],next.frames[6],next.frames[40],next.frames[41],next.width],[255,4,255,38,(count-3)*8],'glifos vazios no meio não deslocam os seguintes')}
 // ---- 3. O que não cabe, com a frase que o autor lê ---------------------------------------
 const bad=(change,pattern,label)=>{const next=clone(full);change(next);assert.throws(()=>validateHudConfiguration(next),pattern,label||String(pattern))}
 bad(c=>{c.elements[0].text='PONTUAÇÃO ñ'},/Elemento label: a fonte não tem o caractere “ñ”\. Acrescente-o ao mapa da fonte ou troque o texto\./)
 bad(c=>{c.menus[0].items[1].text='Opções…'},/Menu pause, item options: a fonte não tem o caractere “…”/)
 bad(c=>{c.elements[1].x=83},/Elemento score: fica em \(91, 8\) px\. Texto em plano só cai em múltiplos de 8 px: ajuste a posição ou a área segura, ou use sprites para posição livre\./)
 bad(c=>{c.safe.left=5},/múltiplos de 8 px/)
 bad(c=>{c.elements[1].x=296},/Elemento score: sai da tela/)
 bad(c=>{c.elements[1].x=40},/Elementos label e score ocupam as mesmas células\./)
 bad(c=>{c.elements[1].digits=5},/Elemento score: 5 dígito\(s\) não mostram o máximo de “score” \(999999\)\. Aumente os dígitos ou reduza o máximo\./)
 bad(c=>{c.values[1].max=9},/Elemento life: mostra até 5, mas “life” chega a 9\./)
 bad(c=>{c.elements[3].value='nada'},/Elemento energy: escolha um valor do jogo\./)
 bad(c=>{c.elements.push({id:'low',type:'text',anchor:'bottom-left',x:0,y:0,text:'FIM'})},/Há elementos de HUD em cima e embaixo da tela\. O plano de janela é uma faixa só/)
 bad(c=>{c.elements[4].digits=8;c.elements.push({id:'more',type:'icons',anchor:'left',x:0,y:0,value:'life',max:10,full:'*',empty:'.',sprite:true})},/Elementos em sprites somam 18 caracteres; o limite é 16/)
 bad(c=>{c.font.map=c.font.map+'A'},/tem \d+ glifos e o mapa, \d+ caracteres|aparece duas vezes/)
 bad(c=>{c.font.map=c.font.map.replace('B','A')},/o caractere “A” aparece duas vezes/)
 bad(c=>{c.font.map=c.font.map.slice(1)+'~'},/precisa ter o espaço/)
 bad(c=>{c.font.map=c.font.map.slice(0,-1)+'🙂'},/“🙂” não é aceito/)
 bad(c=>{c.font.glyphs[3]='xyz'},/glifo inválido/);bad(c=>{c.font.colors[1]=0x0FFF},/cor inválida/)
 bad(c=>{c.dialogue.width=41},/Diálogo \(largura em caracteres\): use um inteiro de 8 a 40/);bad(c=>{c.dialogue.y=16},/Caixa de diálogo: sai da tela/)
 bad(c=>{c.menus[0].items=[]},/Menu pause: de 1 a 8 itens/);bad(c=>{c.menus.push(clone(c.menus[0]))},/Menu com id inválido ou repetido: pause/);bad(c=>{c.elements[0].id='Label'},/id inválido/)
 // Nomes diferentes que dariam a mesma constante no código.
 bad(c=>{c.menus.push({...clone(c.menus[0]),id:'pause_x',items:[{id:'b',text:'A'}]});c.menus[0].items.push({id:'x_b',text:'A'})},/O item “b” do menu “pause_x” e O item “x_b” do menu “pause” gerariam a mesma constante no código \(RETRO_HUD_ITEM_PAUSE_X_B\)/)
 bad(c=>{c.format='outro'},/Formato de HUD desconhecido/);bad(c=>{c.screen.width=300},/Tela: use 256 ou 320/);bad(c=>{c.plane='sprites'},/Plano do HUD inválido/)
 {const next=clone(base);next.elements[2].sprite=true;assert.throws(()=>validateHudConfiguration(next),/elementos em sprites precisam de uma fonte importada/)}
 {const next=clone(base);next.font.map='ABC ';assert.throws(()=>validateHudConfiguration(next),/Sem imagem de fonte, o mapa é o da fonte padrão do SGDK/)}
 // Plano de fundo em vez de janela: sem faixa, com o aviso de que rola com o cenário; H32 muda as âncoras.
 {const next=clone(full);next.plane='bg-a';next.elements.push({id:'low',type:'text',anchor:'bottom-left',x:0,y:0,text:'FIM'});const view=layoutHud(validateHudConfiguration(next));assert.equal(view.window,null);assert.match(view.notes[0],/plano A, que rola junto com o cenário/)}
 {const next=clone(base);next.screen.width=256;assert.equal(layoutHud(next).elements[2].col,26)}
 // ---- 4. Header: compila com o runtime real e traz o que a configuração diz ---------------
 const header=compileHudHeader(full)
 assert.match(header,/#define RETRO_HUD_VALUE_SCORE 0\n#define RETRO_HUD_VALUE_LIFE 1/);assert.match(header,/#define RETRO_HUD_MENU_PAUSE 0\n#define RETRO_HUD_ITEM_PAUSE_RESUME 0\n#define RETRO_HUD_ITEM_PAUSE_OPTIONS 1/);assert.match(header,/#define RETRO_PROJECT_HUD_SPRITES 2\n/);assert.match(header,/#define RETRO_PROJECT_HUD_FONT_TILES retroProjectHudFontTiles\n/)
 assert.match(header,/#define RETRO_PROJECT_HUD_COLOR_MASK 0x0006 /);assert.match(header,/static const uint8_t retroProjectHudSpriteFrames\[\]=\{255,0,1,2,/);assert.match(header,/#define RETRO_PROJECT_HUD_SPRITE_FRAMES retroProjectHudSpriteFrames\n/)
 assert.match(compileHudHeader(base),/#define RETRO_PROJECT_HUD_SPRITE_FRAMES 0\n/);assert.match(compileHudHeader(base),/#define RETRO_PROJECT_HUD_COLOR_MASK 0x0000 /)
 assert.match(compileHudHeader(base),/#define RETRO_PROJECT_HUD_FONT_TILES 0\n/);assert.ok(!compileHudHeader(base).includes('retroProjectHudFontTiles['))
 assert.equal(compileHudHeader(full),compileHudHeader(clone(full)),'mesma configuração, mesmo header')
 const work=path.join(temporary,'c');fs.mkdirSync(path.join(work,'src/generated'),{recursive:true});fs.mkdirSync(path.join(work,'src/retro_runtime'))
 for(const [directory,file] of [['core','retro_core.h'],['hud','retro_hud.h']])fs.copyFileSync(path.join(repository,'assets/toolkit/lib/runtime',directory,file),path.join(work,'src/retro_runtime',file))
 const check=(config,body)=>{
  fs.writeFileSync(path.join(work,'src/generated/hud_config.h'),compileHudHeader(config))
  fs.writeFileSync(path.join(work,'t.c'),'#include <assert.h>\n#include <string.h>\n#include "generated/hud_config.h"\nstatic uint8_t cells[2*RETRO_PROJECT_HUD_CELLS+1],over[2*RETRO_PROJECT_HUD_OVERLAY_CELLS+1];\nint main(void){RetroHud hud;assert(retroHudInit(&hud,&retroProjectHud,0,cells,over));'+body+'return 0;}\n')
  const built=spawnSync('gcc',['-std=c99','-Wall','-Wextra','-Werror','-pedantic','-fsanitize=address,undefined','-I',path.join(work,'src'),'-I',path.join(repository,'assets/toolkit/lib/runtime/core'),path.join(work,'t.c'),path.join(repository,'assets/toolkit/lib/runtime/hud/retro_hud.c'),'-o',path.join(work,'t')],{encoding:'utf8'});assert.equal(built.status,0,built.stderr)
  const ran=spawnSync(path.join(work,'t'),{encoding:'utf8'});assert.equal(ran.status,0,ran.stderr)
 }
 check(full,`assert(retroProjectHud.elementCount==5&&retroProjectHud.menuCount==1&&retroProjectHud.glyphCount==${Array.from(map).length}&&retroProjectHud.valueCount==4);assert(retroProjectHud.hud.col==1&&retroProjectHud.hud.row==1&&retroProjectHud.hudBand.rows==3&&!retroProjectHud.hudBand.bottom&&retroProjectHud.overlayBand.bottom&&retroProjectHud.overlayBand.rows==17);assert(retroProjectHud.dialogue.enabled&&retroProjectHud.dialogue.width==36&&retroProjectHud.dialogue.lines==3);assert(retroProjectHudMaximums[2]==100u&&retroProjectHudColors[1]==0x0EEE&&sizeof retroProjectHudFontTiles==${Array.from(map).length}*32);assert(retroProjectHudElements[4].sprite&&retroProjectHudElements[4].x==152&&retroProjectHudElements[4].y==20);assert(retroHudMenuOpen(&hud,RETRO_HUD_MENU_PAUSE));`)
 check(base,'assert(retroProjectHud.elementCount==3&&!retroProjectHud.menuCount&&!retroProjectHud.dialogue.enabled&&RETRO_PROJECT_HUD_OVERLAY_CELLS==0);assert(!retroHudMenuOpen(&hud,0)&&!retroHudDialogueShow(&hud,"a",0,0));')
 {const empty=clone(base);empty.elements=[];empty.values=[];check(empty,'assert(!retroProjectHud.elementCount&&RETRO_PROJECT_HUD_CELLS==0);')}
 // Fonte de exemplo: 96 glifos, mapa válido, com os acentos do português.
 {const sample={...createHudConfiguration(),font:{name:HUD_SAMPLE_FONT.name,map:HUD_SAMPLE_FONT.map,glyphs:[...HUD_SAMPLE_FONT.glyphs],colors:[...HUD_SAMPLE_FONT.colors]}};validateHudConfiguration(sample)
  assert.equal(Array.from(HUD_SAMPLE_FONT.map).length,HUD_LIMITS.glyphs);encodeText(sample.font,'Pontuação: 0123456789 Opções Não É Ç ã õ á é í ó ú â ê ô','x');assert.equal(HUD_SAMPLE_FONT.glyphs[0],'0'.repeat(64),'o espaço é vazio');assert.ok(HUD_SAMPLE_FONT.glyphs.slice(1).every(glyph=>/1/.test(glyph)&&/^[01]{64}$/.test(glyph)))}
 // ---- 5. Custo: a fonte importada não custa VRAM além do lugar da fonte ---------------------
 let cost=hudCost(full)
 assert.deepEqual([cost.vramTiles,cost.fontTiles,cost.sprites,cost.spriteTiles,cost.hudCells,cost.overlayCells,cost.windowRows],[0,Array.from(map).length,2,2,38*2,36*16,{hud:3,overlay:17}]);assert.equal(cost.ramBytes,2*(76+576)+320)
 assert.deepEqual([hudCost(base).fontTiles,hudCost(base).sprites,hudCost(base).windowRows],[0,0,{hud:2,overlay:0}])
 // Avisos de layout: fora da área segura (deslocamento negativo, bloco largo), fonte importada × VDP_drawText, plano de cenário.
 {const next=clone(full);next.elements[0].x=-8;next.dialogue.width=40;const notes=layoutHud(validateHudConfiguration(next)).notes;assert.ok(notes.some(note=>/Fora da área segura \(podem ser cortados em TVs antigas\): label, caixa de diálogo\./.test(note)),notes.join(' | '));assert.ok(notes.some(note=>/VDP_drawText/.test(note)))}
 assert.ok(!layoutHud(base).notes.some(note=>/Fora da área segura|VDP_drawText/.test(note)));{const next=clone(base);next.plane='bg-b';assert.match(layoutHud(next).notes[0],/Fechar um menu ou diálogo apaga as células que ele ocupava/)}
 {const next=clone(base);next.screen.height=240;assert.equal(layoutHud(validateHudConfiguration(next)).rows,30)}
 // ---- 6. Serviço da IDE --------------------------------------------------------------------
 const root=path.join(temporary,'jogo');fs.mkdirSync(root)
 let status=await hudConfigurationStatus(root)
 assert.deepEqual([status.saved,status.exported,status.foreign,status.runtimeInstalled,status.conflicts],[false,false,false,false,[]]);assert.deepEqual(validateHudForBuild(root),{configured:false});assert.deepEqual(fs.readdirSync(root),[],'consultar não grava nada')
 assert.equal(exportOverview(root).rows.find(row=>row.id==='hud').state,'absent')
 await assert.rejects(saveHudConfiguration(root,{config:base,revision:'x'}),/mudou no disco; recarregue/)
 let saved=await saveHudConfiguration(root,{config:base,revision:status.revision})
 assert.deepEqual([saved.saved,saved.exported],[true,true]);assert.deepEqual(fs.readdirSync(path.join(root,'src/generated')),['hud_config.h']);assert.ok(!fs.existsSync(path.join(root,'res')),'sem sprites: nenhum recurso gerado')
 assert.equal(fs.readFileSync(path.join(root,'src/generated/hud_config.h'),'utf8'),compileHudHeader(base));assert.equal(validateHudForBuild(root).configured,true);assert.equal(exportOverview(root).rows.find(row=>row.id==='hud').state,'current')
 await assert.rejects(saveHudConfiguration(root,{config:base,revision:status.revision}),/mudou no disco/,'revisão antiga')
 // Com sprites: planilha de glifos e .res; depois sem sprites: o .res fica vazio em vez de apontar para a planilha.
 saved=await saveHudConfiguration(root,{config:full,revision:saved.revision});assert.equal(saved.exported,true)
 assert.equal(fs.readFileSync(path.join(root,'res/hud_resources.res'),'utf8'),'SPRITE RETRO_HUD_GLYPHS "generated/hud_glyphs.png" 1 1 NONE 0\n');const png=fs.readFileSync(path.join(root,'res/generated/hud_glyphs.png'));assert.deepEqual([...png.subarray(0,4)],[0x89,0x50,0x4e,0x47]);assert.equal(png.readUInt32BE(16),sheet.width);assert.equal(png.readUInt32BE(20),8);assert.equal(png[24],4,'4 bits por pixel')
 assert.equal(validateHudForBuild(root).configured,true)
 // Editado à mão depois de salvar → desatualizado; header personalizado → conflito, preservado.
 const edited=clone(full);edited.elements[0].text='PONTOS';fs.writeFileSync(path.join(root,'hud/hud.json'),JSON.stringify(edited))
 assert.throws(()=>validateHudForBuild(root),/O HUD mudou\. Use Salvar e exportar HUD antes do build\./);assert.equal(exportOverview(root).rows.find(row=>row.id==='hud').state,'stale');assert.ok(exportOverview(root).blocksBuild.includes('hud'))
 status=await hudConfigurationStatus(root);assert.deepEqual([status.exported,status.config.elements[0].text],[false,'PONTOS'])
 saved=await saveHudConfiguration(root,{config:edited,revision:status.revision});assert.equal(saved.exported,true)
 fs.appendFileSync(path.join(root,'src/generated/hud_config.h'),'// meu ajuste\n')
 assert.throws(()=>validateHudForBuild(root),/foi personalizado; revise-o.*src\/generated\/hud_config\.h/);assert.equal(exportOverview(root).rows.find(row=>row.id==='hud').state,'conflict')
 status=await hudConfigurationStatus(root);assert.deepEqual(status.conflicts,['src/generated/hud_config.h'])
 await assert.rejects(saveHudConfiguration(root,{config:edited,revision:status.revision}),/personalizado ou é de outra ferramenta; nada foi alterado/);assert.match(fs.readFileSync(path.join(root,'src/generated/hud_config.h'),'utf8'),/meu ajuste/)
 fs.writeFileSync(path.join(root,'src/generated/hud_config.h'),compileHudHeader(edited))
 const plain=clone(edited);plain.elements=plain.elements.filter(element=>!element.sprite)
 status=await hudConfigurationStatus(root);saved=await saveHudConfiguration(root,{config:plain,revision:status.revision})
 assert.equal(fs.readFileSync(path.join(root,'res/hud_resources.res'),'utf8'),'// HUD sem elementos em sprites.\n');assert.equal(validateHudForBuild(root).configured,true);assert.equal(saved.exported,true)
 // Arquivo ilegível depois de exportar: é o nosso, danificado — o build não segue com o header velho.
 fs.writeFileSync(path.join(root,'hud/hud.json'),'{');assert.throws(()=>validateHudForBuild(root),/hud\/hud\.json está ilegível/);await assert.rejects(hudConfigurationStatus(root),/ilegível/)
 // hud/hud.json de outra ferramenta, em projeto que nunca exportou: preservado, recurso fora de uso.
 const other=path.join(temporary,'outro');fs.mkdirSync(path.join(other,'hud'),{recursive:true});fs.writeFileSync(path.join(other,'hud/hud.json'),'{"widgets":[]}')
 status=await hudConfigurationStatus(other);assert.deepEqual([status.foreign,status.saved],[true,false]);assert.deepEqual(validateHudForBuild(other),{configured:false})
 await assert.rejects(saveHudConfiguration(other,{config:base,revision:status.revision}),/é de outra ferramenta; o arquivo foi preservado/);assert.equal(fs.readFileSync(path.join(other,'hud/hud.json'),'utf8'),'{"widgets":[]}')
 // Diálogos de cutscene: largura, linhas, acentos e caracteres que a fonte não tem. As cenas ficam em
 // cutscenes/**/*.cutscene.json; quem fala sai em maiúsculas e, com asciiOnly, os acentos viram letras simples.
 const scenes=path.join(temporary,'cenas');fs.mkdirSync(path.join(scenes,'cutscenes/capitulo1'),{recursive:true})
 const sampleFont={...clone(full),font:{name:HUD_SAMPLE_FONT.name,map:HUD_SAMPLE_FONT.map,glyphs:[...HUD_SAMPLE_FONT.glyphs],colors:[...HUD_SAMPLE_FONT.colors]},elements:[],values:[],menus:[]}
 const sceneConfig=dialogue=>fs.writeFileSync(path.join(scenes,'cutscenes/cutscene-config.json'),JSON.stringify({dialogue,actors:[{id:'guarda',name:'Lúcia'}]}))
 sceneConfig({charsPerLine:38,linesPerPage:4,asciiOnly:true,uppercaseSpeaker:true})
 fs.writeFileSync(path.join(scenes,'cutscenes/capitulo1/intro.cutscene.json'),JSON.stringify({steps:[{type:'say',speaker:'Guardião',text:'Olá, viajante… custa $5 & um ñandu!'},{type:'choice',prompt:'Ir?',options:[{text:'Sim ♥',steps:[]}]}]}))
 fs.writeFileSync(path.join(scenes,'cutscenes/notas.json'),JSON.stringify({text:'arquivo que não é cena: ¤'}))
 status=await hudConfigurationStatus(scenes);assert.deepEqual(status.cutsceneNotes,[],'caixa de diálogo desligada: nada a conferir')
 status=await saveHudConfiguration(scenes,{config:sampleFont,revision:status.revision})
 assert.equal(status.cutsceneNotes.length,4,status.cutsceneNotes.join(' | '));assert.match(status.cutsceneNotes[0],/quebram o texto em 38 caracteres por linha, mas a caixa de diálogo tem 36/);assert.match(status.cutsceneNotes[1],/4 linhas por página e a caixa de diálogo tem 3/);assert.match(status.cutsceneNotes[2],/A fonte tem acentos, mas as cenas estão configuradas para trocar acentos/)
 // Com asciiOnly: "…" vira "...", "ñ" vira "n", "♥" vira "?"; sobram os ASCII que a fonte de exemplo não tem ($ e &).
 assert.match(status.cutsceneNotes[3],/apareceriam como “\?”: \$ &$/)
 // Sem asciiOnly: acentos da fonte valem; quem fala sai em maiúsculas (GUARDIÃO, LÚCIA) e a fonte de exemplo não tem "Ú".
 sceneConfig({charsPerLine:36,linesPerPage:3,asciiOnly:false,uppercaseSpeaker:true})
 status=await hudConfigurationStatus(scenes);assert.equal(status.cutsceneNotes.length,1);assert.match(status.cutsceneNotes[0],/apareceriam como “\?”: … \$ & ñ ♥ Ú$/)
 sceneConfig({charsPerLine:36,linesPerPage:3,asciiOnly:false,uppercaseSpeaker:false});status=await hudConfigurationStatus(scenes);assert.match(status.cutsceneNotes[0],/: … \$ & ñ ♥$/)
 // Sem cutscene-config.json valem os padrões das cenas (32 por linha, 2 linhas, ASCII, maiúsculas).
 fs.rmSync(path.join(scenes,'cutscenes/cutscene-config.json'));status=await hudConfigurationStatus(scenes);assert.equal(status.cutsceneNotes.length,2);assert.match(status.cutsceneNotes[1],/: \$ &$/)
 // Salvar o HUD não mexe na exportação do mundo: os arquivos do HUD não são entradas do exportador de mapas.
 {
  const {toTMX}=await import('../src/utils/retro/tmxFormat.js'),{worldConfigurationStatus,saveWorldConfigurationWithMaps}=await import('../electron/retro/worldConfiguration.js'),{validateWorldForBuild}=await import('../electron/retro/worldConfiguration.js')
  const game=path.join(temporary,'com-mundo');fs.mkdirSync(path.join(game,'maps'),{recursive:true});fs.mkdirSync(path.join(game,'res'));fs.writeFileSync(path.join(game,'retro-studio.json'),JSON.stringify({mapExport:{}}));fs.writeFileSync(path.join(game,'res/resources.res'),'')
  installRuntimeModules(game);fs.writeFileSync(path.join(game,'maps/hall.tmx'),toTMX({width:8,height:4,collision:Array(32).fill(0)}))
  const world={format:'retro-studio.world',version:1,initial:{room:'hall',entry:'spawn'},rooms:[{id:'hall',name:'hall',map:'maps/hall.tmx',width:64,height:32,entries:[{id:'spawn',x:8,y:16,facing:false}],exits:[],checkpoints:[]}],conditions:[]}
  assert.equal((await saveWorldConfigurationWithMaps(game,{config:world,revision:worldConfigurationStatus(game).revision})).success,true);const before=validateWorldForBuild(game)
  let hudStatus=await hudConfigurationStatus(game);hudStatus=await saveHudConfiguration(game,{config:full,revision:hudStatus.revision});assert.ok(fs.existsSync(path.join(game,'res/hud_resources.res')))
  assert.deepEqual(validateWorldForBuild(game),before,'o mundo continua em dia depois de exportar o HUD (com sprites)')
  const edited2=clone(full);edited2.elements[0].text='PONTOS';await saveHudConfiguration(game,{config:edited2,revision:hudStatus.revision});assert.deepEqual(validateWorldForBuild(game),before)
 }
 // Canais, trava e panorama registrados.
 const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8'),preload=fs.readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8')
 for(const channel of ['retro:hud-configuration','retro:save-hud-configuration']){assert.match(main,new RegExp("ipcMain\\.handle\\('"+channel+"', async \\(_evt, payload = \\{\\}\\) => \\{\\s+(?:try \\{ )?return (?:await )?\\w+\\(await assetActionWorkspace\\(payload\\)"));assert.ok(preload.includes("'"+channel+"'"))}
 for(const file of ['game.js','buildForTools.js'])assert.match(fs.readFileSync(new URL('../electron/retro/'+file,import.meta.url),'utf8'),/validateHudForBuild\(projectPath\)[\s\S]{0,160}Validação do HUD: /)
 console.log('HUD configuration: anchors and safe area, window bands, imported font and character map, 27 refusals with reasons, generated header compiled and run in C, cost, IDE service (save, sprites, stale, conflict, damaged, foreign), cutscene checks and build gate passed.')
 // ---- 7. ROM de diagnóstico -----------------------------------------------------------------
 const sdk=arg('--sgdk')
 if(sdk){
  const game=path.join(temporary,'rom');fs.mkdirSync(path.join(game,'src'),{recursive:true});fs.mkdirSync(path.join(game,'res'))
  installRuntimeModules(game,{moduleIds:['hud-sgdk','cutscene-host']})
  installCutsceneRuntime(game) // o runner de cenas, para a ponte HUD ↔ cutscene compilar de verdade
  // Fonte de exemplo com acentos (a mesma que o editor oferece), para as capturas serem legíveis.
  const rom={...clone(full),font:{name:HUD_SAMPLE_FONT.name,map:HUD_SAMPLE_FONT.map,glyphs:[...HUD_SAMPLE_FONT.glyphs],colors:[...HUD_SAMPLE_FONT.colors]}};status=await hudConfigurationStatus(game);await saveHudConfiguration(game,{config:rom,revision:status.revision});assert.equal(validateHudForBuild(game).configured,true)
  fs.copyFileSync(path.join(repository,'assets/toolkit/fixtures/hud-diagnostic.c'),path.join(game,'src/main.c'))
  fs.writeFileSync(path.join(game,'res/resources.res'),'');fs.writeFileSync(path.join(game,'Makefile'),'include $(GDK)/makefile.gen\nout/src/main.o: out/res/hud_resources.o\n')
  const build=spawnSync('make',['-j2','release','GDK='+sdk],{cwd:game,env:{...process.env,PATH:path.join(sdk,'bin')+path.delimiter+process.env.PATH},encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024})
  assert.equal(build.status,0,(build.stdout+build.stderr).slice(-3000));assert.ok(!/warning:/.test(build.stdout+build.stderr),'sem avisos do compilador: '+(build.stdout+build.stderr).match(/.*warning:.*/)?.[0])
  const bytes=fs.readFileSync(path.join(game,'out/rom.bin'));assert.ok(bytes.subarray(256,272).toString().includes('SEGA'))
  if(arg('--keep-rom'))fs.copyFileSync(path.join(game,'out/rom.bin'),arg('--keep-rom'))
  console.log('Diagnostic ROM built with the real toolchain ('+bytes.length+' bytes): imported font with accents, window HUD, sprite element, menu and dialogue box.')
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
