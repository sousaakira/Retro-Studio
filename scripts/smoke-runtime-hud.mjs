// #65: runtime do HUD no host. O header gerado pela IDE é compilado com o C real; uma sequência
// de valores, menus e diálogos é desenhada em uma tela de mentira (célula a célula, com orçamento
// por quadro) e comparada com o que a prévia do editor (shared/retro/hudRuntime.js) mostra.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createHudConfiguration,compileHudHeader,validateHudConfiguration,layoutHud,HUD_LIMITS} from '../shared/retro/hudConfiguration.js'
import {hudCells,elementGlyphs,textGlyphs,HUD_CLEAR} from '../shared/retro/hudRuntime.js'
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-hud-')),library=fileURLToPath(new URL('../assets/toolkit/lib/runtime/',import.meta.url))
try{
 // Fonte importada com acentos, fora da ordem ASCII: os dígitos não ficam juntos de propósito.
 const map=' !?.,:>*-#ABCDEFGHIJKLMNOPQRSTUVWXYZ5a0b1c2d3e4f6g7h8i9jklmnopqrstuvwxyzÁÉÍÓÚÃÕÇáéíóúãõç'
 const glyph=index=>Array.from({length:64},(_v,pixel)=>((index*7+pixel*3)%5===0?'1':'0')).join('')
 const config={...createHudConfiguration(),
  font:{name:'teste',map,glyphs:Array.from(map,(_c,index)=>glyph(index)),colors:[0,0x0EEE,0x000E,0,0,0,0,0,0,0,0,0,0,0,0,0]},
  values:[{id:'score',max:999999},{id:'life',max:5},{id:'energy',max:200},{id:'time',max:99}],
  elements:[{id:'label',type:'text',anchor:'top-left',x:0,y:0,text:'PONTOS:'},{id:'score',type:'number',anchor:'top-left',x:64,y:0,value:'score',digits:6,pad:'0'},
   {id:'life',type:'icons',anchor:'top-right',x:0,y:0,value:'life',max:5,full:'*',empty:'.'},{id:'energy',type:'bar',anchor:'top-left',x:0,y:8,value:'energy',width:10,full:'#',empty:'-'},
   {id:'time',type:'number',anchor:'top',x:3,y:5,value:'time',digits:2,pad:' ',sprite:true}],
  menus:[{id:'pause',anchor:'center',x:0,y:0,title:'PAUSA',cursor:'>',items:[{id:'resume',text:'Continuar'},{id:'options',text:'Opções'},{id:'quit',text:'Sair'}]},
   {id:'confirm',anchor:'top-left',x:0,y:0,title:'',cursor:'*',items:[{id:'no',text:'Não'},{id:'yes',text:'Sim'}]}],
  dialogue:{enabled:true,anchor:'bottom',x:0,y:0,width:36,lines:3,speaker:true,cursor:'>'}}
 validateHudConfiguration(config)
 const layout=layoutHud(config)
 fs.mkdirSync(path.join(temporary,'src/generated'),{recursive:true});fs.mkdirSync(path.join(temporary,'src/retro_runtime'))
 fs.writeFileSync(path.join(temporary,'src/generated/hud_config.h'),compileHudHeader(config))
 for(const [directory,file] of [['core','retro_core.h'],['hud','retro_hud.h']])fs.copyFileSync(path.join(library,directory,file),path.join(temporary,'src/retro_runtime',file))
 // Roteiro: cada passo muda o estado; o C desenha (com orçamento de células por quadro) e imprime a tela.
 const steps=[
  ['values',[0,0,0,0]],['values',[1234,3,100,7]],['values',[999999,5,200,99]],['values',[1000000,9,1,100]],['values',[42,0,199,0]],
  ['menu',0],['input','DOWN'],['input','DOWN'],['input','DOWN'],['input','UP'],['input','CONFIRM'],['values',[43,1,50,5]],['input','CANCEL'],['hide'],
  ['menu',1],['input','UP'],['hide'],
  ['dialogue','Guardião',['Olá! Você chegou.','A ponte está fechada…','Volte amanhã.']],['dialogue','',['Só uma linha']],['dialogue','NOME MUITO COMPRIDO QUE NÃO CABE NA CAIXA DE DIÁLOGO',['Texto com emoji 🙂 e letra ñ que a fonte não tem','x','y','quarta linha não aparece']],
  ['choice','Abrir a porta?',['Sim','Não','Talvez'],1],['choice','',['Único'],0],
  // Quatro opções em uma caixa de três linhas: a lista rola para a opção selecionada aparecer.
  ['choice','Qual?',['Um','Dois','Três','Quatro'],0],['choice','Qual?',['Um','Dois','Três','Quatro'],2],['choice','Qual?',['Um','Dois','Três','Quatro'],3],
  // Valor que muda com o diálogo aberto: o HUD fora da caixa acompanha.
  ['values',[55,4,120,9]],['hide'],
  ['menu',0],['dialogue','A',['troca direta de menu para diálogo']],['invalidate'],['hide'],['values',[7,2,0,1]]]
 const cString=text=>'"'+Buffer.from(text,'utf8').toString('binary').replace(/[^ -~]|["\\?]/g,character=>'\\'+character.charCodeAt(0).toString(8).padStart(3,'0'))+'"'
 const body=steps.map(step=>{
  if(step[0]==='values')return ` values[0]=${step[1][0]}u;values[1]=${step[1][1]}u;values[2]=${step[1][2]}u;values[3]=${step[1][3]}u;frame();`
  if(step[0]==='menu')return ` assert(retroHudMenuOpen(&hud,${step[1]}));frame();`
  if(step[0]==='input')return ` retroHudMenuInput(&hud,RETRO_HUD_${step[1]});frame();`
  if(step[0]==='hide')return ' retroHudOverlayHide(&hud);frame();'
  if(step[0]==='invalidate')return ' memset(screen,0xFE,sizeof screen);retroHudInvalidate(&hud);frame();'
  const lines=`(const char*const[]){${step[2].map(cString).join(',')}}`
  return step[0]==='dialogue'?` assert(retroHudDialogueShow(&hud,${cString(step[1])},${lines},${step[2].length}));frame();`:` assert(retroHudChoiceShow(&hud,${cString(step[1])},${lines},${step[2].length},${step[3]}));frame();`
 }).join('\n')
 const fixture=path.join(temporary,'test.c'),binary=path.join(temporary,'test')
 fs.writeFileSync(fixture,String.raw`#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "generated/hud_config.h"
#define COLS ${layout.columns}
#define ROWS ${layout.rows}
static uint8_t screen[ROWS][COLS],cells[2*RETRO_PROJECT_HUD_CELLS+8],overlayCells[2*RETRO_PROJECT_HUD_OVERLAY_CELLS+8];
static uint32_t values[4];static unsigned selected,cancelled,lastMenu,lastItem,budget=9,worst;
static RetroHud hud;
static unsigned reads;
static uint32_t value(void *context,uint16_t id){assert(context==&hud&&id<4);reads++;return values[id];}
static void choose(void *context,uint16_t menu,uint16_t item){(void)context;selected++;lastMenu=menu;lastItem=item;}
static void leave(void *context,uint16_t menu){(void)context;cancelled++;lastMenu=menu;}
/* Um "quadro": lê os valores e escreve no máximo budget células; repete até a tela ficar em dia. */
static void frame(void){
 RetroHudWrite w;unsigned frames=0,r,c;uint8_t sprite[8];
 for(;;){
  unsigned written=0;retroHudTick(&hud);
  while(written<budget&&retroHudNext(&hud,&w)){assert(w.col<COLS&&w.row<ROWS&&(w.glyph<RETRO_PROJECT_HUD_GLYPHS||w.glyph==RETRO_HUD_CLEAR));screen[w.row][w.col]=w.glyph;written++;}
  if(!written)break;
  if(++frames>worst)worst=frames;
  assert(frames<400);
 }
 for(r=0;r<ROWS;r++){for(c=0;c<COLS;c++)printf("%02x",screen[r][c]);}
 retroHudElementGlyphs(&hud,4,sprite);printf(" s%02x%02x o%u\n",sprite[0],sprite[1],retroHudOverlayVisible(&hud));
 /* Tela em dia: nada a varrer; um quadro parado custa só uma leitura por elemento com valor, sem recalcular nada. */
 assert(!hud.dirtyHud&&!hud.dirtyOverlay);
 {unsigned before=reads;uint32_t mask;hud.changed=0;retroHudTick(&hud);mask=hud.changed;assert(reads==before+(hud.host.value?4u:0u)&&!mask&&!hud.dirtyHud&&!retroHudNext(&hud,&w));}
 if(hud.overlay==RETRO_HUD_MENU)assert(hud.overlayRow==retroProjectHud.overlay.row+retroProjectHud.menus[hud.menu].row&&hud.overlayRows==retroProjectHud.menus[hud.menu].itemCount+(retroProjectHud.menus[hud.menu].title.length?2:0));
 if(hud.overlay==RETRO_HUD_DIALOGUE)assert(hud.overlayRow==retroProjectHud.overlay.row+retroProjectHud.dialogue.row&&hud.overlayRows==4);
}
int main(void){
 RetroHudHost host={value,choose,leave,&hud};RetroHudDefinition broken;unsigned i;
 memset(screen,0xFE,sizeof screen);memset(cells,0xA5,sizeof cells);memset(overlayCells,0xA5,sizeof overlayCells);
 assert(!retroHudInit(0,&retroProjectHud,&host,cells,overlayCells));assert(!retroHudInit(&hud,0,&host,cells,overlayCells));assert(!retroHudInit(&hud,&retroProjectHud,&host,0,overlayCells));assert(!retroHudInit(&hud,&retroProjectHud,&host,cells,0));
 broken=retroProjectHud;broken.space=200;assert(!retroHudInit(&hud,&broken,&host,cells,overlayCells));
 broken=retroProjectHud;broken.hud.width=3;assert(!retroHudInit(&hud,&broken,&host,cells,overlayCells)); /* elemento fora da região */
 broken=retroProjectHud;broken.overlay.height=2;assert(!retroHudInit(&hud,&broken,&host,cells,overlayCells));
 assert(!hud.ready);retroHudTick(&hud);assert(!retroHudNext(&hud,&(RetroHudWrite){0}));assert(!retroHudMenuOpen(&hud,0));
 assert(retroHudInit(&hud,&retroProjectHud,&host,cells,overlayCells));
 /* Primeiro tick: todos os elementos marcados para o adaptador (sprites inclusive); dígitos achados uma vez. */
 assert(hud.changed==0x1F&&hud.digits[5]==retroProjectHud.glyphs[0].glyph+0*0+hud.digits[5]);
 assert(!retroHudMenuOpen(&hud,9));retroHudMenuInput(&hud,RETRO_HUD_CONFIRM);assert(!selected);
${body}
 assert(selected==1&&cancelled==1&&lastMenu==RETRO_HUD_MENU_PAUSE&&RETRO_HUD_ITEM_PAUSE_OPTIONS==1&&RETRO_HUD_VALUE_ENERGY==2);
 for(i=0;i<8;i++)assert(cells[2*RETRO_PROJECT_HUD_CELLS+i]==0xA5&&overlayCells[2*RETRO_PROJECT_HUD_OVERLAY_CELLS+i]==0xA5); /* nada escrito além dos buffers */
 /* Plano de cenário: as células fora dos elementos são do jogo e não são tocadas ao iniciar. */
 assert(retroHudInit(&hud,&retroProjectHud,&host,cells,overlayCells));retroHudAssumeClear(&hud);
 {RetroHudWrite w;unsigned written=0;while(retroHudNext(&hud,&w)){assert(w.glyph!=RETRO_HUD_CLEAR);written++;}assert(written==7+6+5+10);}
 /* Sem callbacks: valores em zero, menus sem efeito, nada quebra. */
 assert(retroHudInit(&hud,&retroProjectHud,0,cells,overlayCells));memset(screen,0xFE,sizeof screen);frame();
 assert(retroHudMenuOpen(&hud,0));retroHudMenuInput(&hud,RETRO_HUD_CONFIRM);retroHudMenuInput(&hud,RETRO_HUD_CANCEL);retroHudOverlayHide(&hud);frame();
 fprintf(stderr,"%u\n",worst);
 return 0;
}
`)
 const build=spawnSync('gcc',['-std=c99','-O1','-Wall','-Wextra','-Werror','-pedantic','-fsanitize=address,undefined','-fno-sanitize-recover=all','-I',path.join(temporary,'src'),'-I',path.join(library,'core'),fixture,path.join(library,'hud/retro_hud.c'),'-o',binary],{encoding:'utf8'})
 assert.equal(build.status,0,build.stderr)
 const run=spawnSync(binary,{encoding:'utf8'});assert.equal(run.status,0,run.stdout.slice(-400)+run.stderr)
 const frames=run.stdout.trim().split('\n')
 // A mesma sequência na prévia do editor.
 const state={values:{score:0,life:0,energy:0,time:0}};let item=0,menu=null
 const expected=steps.map(step=>{
  if(step[0]==='values')state.values={score:step[1][0],life:step[1][1],energy:step[1][2],time:step[1][3]}
  else if(step[0]==='menu'){menu=config.menus[step[1]];item=0;state.menu={id:menu.id,item};state.dialogue=state.choice=null}
  else if(step[0]==='input'){if(step[1]==='UP')item=item?item-1:menu.items.length-1;if(step[1]==='DOWN')item=item+1<menu.items.length?item+1:0;state.menu={id:menu.id,item}}
  else if(step[0]==='hide'){state.menu=state.dialogue=state.choice=null}
  else if(step[0]==='dialogue'){state.menu=state.choice=null;state.dialogue={speaker:step[1],lines:step[2]}}
  else if(step[0]==='choice'){state.menu=state.dialogue=null;state.choice={prompt:step[1],options:step[2],selected:step[3]}}
  const view=hudCells(config,state),sprite=view.sprites.map(entry=>entry.glyph.toString(16).padStart(2,'0')).join('')
  return view.grid.flat().map(value=>value.toString(16).padStart(2,'0')).join('')+' s'+sprite+' o'+(view.overlay?1:0)
 })
 assert.equal(frames.length,steps.length+2)
 const show=line=>{const cells=line.split(' ')[0].match(/../g),text=Array.from(map);return Array.from({length:layout.rows},(_v,row)=>cells.slice(row*layout.columns,(row+1)*layout.columns).map(cell=>cell==='fe'?'·':text[parseInt(cell,16)]||'?').join('')).filter(row=>/[^·]/.test(row)).join('\n')}
 steps.forEach((step,index)=>assert.equal(frames[index],expected[index],'passo '+index+' '+JSON.stringify(step).slice(0,60)+'\nC:\n'+show(frames[index])+'\nprévia:\n'+show(expected[index])))
 // Sem callbacks: tudo zero, e a tela volta ao HUD depois do menu.
 const zero=hudCells(config,{values:{}}).grid.flat().map(value=>value.toString(16).padStart(2,'0')).join('')
 assert.equal(frames.at(-2).split(' ')[0],zero);assert.equal(frames.at(-1).split(' ')[0],zero)
 // O que o jogador vê, em casos que importam.
 const text=(element,value)=>elementGlyphs(config,config.elements.find(item=>item.id===element),value).map(index=>Array.from(map)[index]).join('')
 assert.deepEqual([text('score',0),text('score',42),text('score',999999),text('score',1000000),text('time',5),text('time',123)],['000000','000042','999999','999999',' 5','99'],'número: preenchimento, e 9s quando o valor não cabe (nunca um número cortado)')
 assert.deepEqual([text('energy',0),text('energy',1),text('energy',100),text('energy',199),text('energy',200),text('energy',999)],['----------','#---------','#####-----','#########-','##########','##########'],'barra: 1 célula para qualquer valor acima de zero; cheia só no máximo')
 assert.deepEqual([text('life',0),text('life',3),text('life',9)],['.....','***..','*****'])
 assert.equal(textGlyphs(config,'ñ🙂a',5).map(index=>Array.from(map)[index]).join(''),'??a  ','caractere que a fonte não tem vira "?"')
 assert.ok(!frames.some(line=>/RETRO|score|pause|resume/i.test(show(line))),'ids não aparecem na tela')
 assert.match(show(frames[steps.findIndex(step=>step[0]==='dialogue')]),/··Guardião +··\n··Olá! Voc\? chegou\. +··\n··A ponte está fechada\? /,'acentos da fonte aparecem; "ê" e "…", que ela não tem, viram "?"');assert.match(show(frames[steps.findIndex(step=>step[0]==='choice')]),/> Não/)
 {const last=steps.findIndex(step=>step[0]==='choice'&&step[3]===3),text=show(frames[last]);assert.match(text,/Dois +··\n··  Tr\?s +··\n··> Quatro/,'a quarta opção aparece com o cursor');assert.ok(!/  Um /.test(text))}
 const worst=Number(run.stderr.trim());assert.ok(worst>=2,'o orçamento de 9 células por quadro espalha as telas maiores por vários quadros: '+worst)
 // Tamanho do estado no 68000 (opcional): --m68k-cc <gcc>.
 const cross=process.argv[process.argv.indexOf('--m68k-cc')+1]
 if(process.argv.includes('--m68k-cc')){
  const object=path.join(temporary,'hud.o'),made=spawnSync(cross,['-std=c99','-m68000','-O2','-Wall','-Wextra','-Werror','-I',path.join(library,'core'),'-c',path.join(library,'hud/retro_hud.c'),'-o',object],{encoding:'utf8'});assert.equal(made.status,0,made.stderr)
  const size=spawnSync(cross.replace(/gcc$/,'size'),[object],{encoding:'utf8'});assert.equal(size.status,0,size.stderr);console.log('68000: retro_hud.o text '+size.stdout.trim().split('\n')[1].trim().split(/\s+/)[0]+' bytes.')
 }
 console.log('HUD runtime: '+steps.length+' steps (values, two menus, dialogue, choice, direct switch, invalidate) match the editor preview cell by cell; worst screen took '+worst+' frames at 9 cells per frame.')
}finally{fs.rmSync(temporary,{recursive:true,force:true})}
