// #65: o que o runtime C do HUD (retro_hud.c) põe em cada célula, em JS — para a prévia do
// editor e para o teste de paridade. Mesmas regras: número cheio de 9 quando não cabe, barra
// com ao menos uma célula para valor acima de zero, caractere sem glifo vira "?".
import {HUD_TYPES,glyphTable,layoutHud} from './hudConfiguration.js'
export const HUD_CLEAR=0xFE
const chars=text=>Array.from(String(text))
/** Glifos de um elemento para um valor do jogo. */
export function elementGlyphs(config,element,value=0){
 const table=glyphTable(config.font),glyph=character=>table.get(character),width=element.type==='text'?chars(element.text).length:element.type==='number'?element.digits:element.type==='bar'?element.width:element.max
 if(element.type==='text')return chars(element.text).map(glyph)
 value=Math.max(0,Math.floor(Number(value)||0))
 if(element.type==='number'){
  const limit=10**width;if(value>=limit)value=limit-1
  const out=[];for(let i=width;i>0;i--){out[i-1]=value||i===width?glyph(String(value%10)):glyph(element.pad);value=Math.floor(value/10)}
  return out
 }
 const maximum=element.type==='bar'?config.values.find(item=>item.id===element.value).max:element.max
 let filled
 if(element.type==='bar'){
  if(value>maximum)value=maximum
  filled=Math.floor(value*width/maximum);if(value&&!filled)filled=1;if(value<maximum&&filled>=width)filled=width-1
 }else filled=Math.min(value,width)
 return Array.from({length:width},(_value,index)=>glyph(index<filled?element.full:element.empty))
}
/** Texto UTF-8 (como chega dos diálogos) → glifos, com "?" (ou espaço) para o que a fonte não tem. */
export function textGlyphs(config,text,width){
 const table=glyphTable(config.font),unknown=table.has('?')?table.get('?'):table.get(' ')
 const out=chars(text).slice(0,width).map(character=>character.codePointAt(0)<=0xFFFF&&table.has(character)?table.get(character):unknown)
 while(out.length<width)out.push(table.get(' '))
 return out
}
/**
 * Grade de células da tela: glifo ou HUD_CLEAR. state: {values:{id:n}, menu:{id,item}|null,
 * dialogue:{speaker,lines}|null, choice:{prompt,options,selected}|null}.
 */
export function hudCells(config,state={}){
 const layout=layoutHud(config),grid=Array.from({length:layout.rows},()=>Array(layout.columns).fill(HUD_CLEAR)),table=glyphTable(config.font),space=table.get(' ')
 const sprites=[]
 config.elements.forEach((element,index)=>{
  const place=layout.elements[index],glyphs=elementGlyphs(config,element,element.type==='text'?0:state.values?.[element.value])
  if(place.sprite)glyphs.forEach((glyph,offset)=>sprites.push({x:place.x+offset*8,y:place.y,glyph}))
  else glyphs.forEach((glyph,offset)=>{grid[place.row][place.col+offset]=glyph})
 })
 const row=(col,line,width,glyphs)=>{for(let i=0;i<width;i++)grid[line][col+i]=i<glyphs.length?glyphs[i]:space}
 if(state.menu){
  const index=config.menus.findIndex(menu=>menu.id===state.menu.id),menu=config.menus[index],place=layout.menus[index];let line=place.row
  if(menu.title){row(place.col,line,place.width,chars(menu.title).map(character=>table.get(character)));row(place.col,line+1,place.width,[]);line+=2}
  menu.items.forEach((item,position)=>row(place.col,line+position,place.width,[position===(state.menu.item||0)?table.get(menu.cursor):space,space,...chars(item.text).map(character=>table.get(character))]))
 }else if((state.dialogue||state.choice)&&layout.dialogue){
  const box=layout.dialogue,settings=config.dialogue;let line=box.row
  if(settings.speaker){row(box.col,line,box.width,textGlyphs(config,(state.dialogue?state.dialogue.speaker:state.choice.prompt)||'',box.width));line++}
  // Mais opções que linhas: a lista começa onde a opção selecionada ainda aparece.
  const chosen=state.choice?state.choice.selected||0:0,first=state.choice&&chosen>=settings.lines&&chosen<state.choice.options.length?chosen-settings.lines+1:0
  for(let i=0;i<settings.lines;i++){
   if(state.dialogue)row(box.col,line+i,box.width,textGlyphs(config,state.dialogue.lines?.[i]||'',box.width))
   else row(box.col,line+i,box.width,[first+i<state.choice.options.length&&first+i===chosen?table.get(settings.cursor):space,space,...textGlyphs(config,state.choice.options[first+i]||'',box.width-2)])
  }
 }
 const overlay=!!(state.menu||((state.dialogue||state.choice)&&layout.dialogue))
 // Plano de janela com menu ou diálogo aberto: a janela cobre só as linhas dele (do alto até a última
 // ou da primeira até embaixo, o que cobrir menos); o HUD em plano fora dessa faixa não aparece.
 let band=layout.window?.hud||null
 if(config.plane==='window'&&overlay){
  const box=state.menu?layout.menus[config.menus.findIndex(menu=>menu.id===state.menu.id)]:layout.dialogue,top=box.row+box.height,bottom=layout.rows-box.row
  band=bottom<top?{edge:'bottom',rows:bottom}:{edge:'top',rows:top}
 }
 return {grid,sprites,layout,overlay,band:config.plane==='window'?band:null}
}
/** Imagem RGBA da tela do HUD (fundo transparente) para a prévia: usa os glifos e as cores da fonte. */
export function renderHud(config,state={},{vdpToRgb}={}){
 const {grid,sprites,layout,band,overlay}=hudCells(config,state),width=config.screen.width,height=config.screen.height,rgba=new Uint8ClampedArray(width*height*4)
 const color=index=>{const word=config.font.colors[index]||0;return vdpToRgb?vdpToRgb(word):[(word>>1&7)*36,(word>>5&7)*36,(word>>9&7)*36]}
 const draw=(glyph,x,y)=>{
  const pixels=config.font.glyphs[glyph];if(glyph===HUD_CLEAR)return
  for(let py=0;py<8;py++)for(let px=0;px<8;px++){
   // Sem fonte importada a prévia não tem os pixels da fonte do SGDK: marca a célula ocupada.
   const index=pixels?parseInt(pixels[py*8+px],16):(px>0&&px<7&&py>0&&py<7&&glyph!==0?1:0)
   if(!index||x+px<0||x+px>=width||y+py<0||y+py>=height)continue
   const at=((y+py)*width+x+px)*4,[r,g,b]=color(index);rgba[at]=r;rgba[at+1]=g;rgba[at+2]=b;rgba[at+3]=255
  }
 }
 // O que está no plano de janela só aparece dentro da faixa que a janela cobre agora.
 const shown=row=>!band||(band.edge==='top'?row<band.rows:row>=layout.rows-band.rows)
 grid.forEach((line,row)=>{if(shown(row))line.forEach((glyph,col)=>draw(glyph,col*8,row*8))})
 sprites.forEach(sprite=>draw(sprite.glyph,sprite.x,sprite.y))
 return {width,height,rgba,layout,band,overlay}
}
export {HUD_TYPES}
