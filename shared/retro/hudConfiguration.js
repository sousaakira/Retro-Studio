// #65: HUD, fonte, menus e caixa de diálogo do jogo. Fonte de verdade: hud/hud.json.
// Tudo o que o jogador vê é texto do autor desenhado com os glifos da fonte; ids de valores,
// de menus e de itens só existem no header gerado, nunca na tela.
export const HUD_FORMAT='retro-studio.hud'
export const HUD_LIMITS=Object.freeze({glyphs:96,elements:32,values:16,menus:8,items:8,text:40,spriteCells:16,dialogueLines:4})
export const HUD_ANCHORS=Object.freeze(['top-left','top','top-right','left','center','right','bottom-left','bottom','bottom-right'])
export const HUD_PLANES=Object.freeze(['window','bg-a','bg-b'])
export const HUD_TYPES=Object.freeze(['text','number','bar','icons'])
/** Fonte padrão do SGDK: ASCII de espaço a DEL, 96 glifos em TILE_FONT_INDEX. */
export const SGDK_FONT_MAP=Array.from({length:95},(_value,index)=>String.fromCharCode(32+index)).join('')
const ID=/^[a-z][a-z0-9_]{0,23}$/
const fail=message=>{throw Error(message)}
const integer=(value,low,high,label)=>Number.isInteger(value)&&value>=low&&value<=high?value:fail(`${label}: use um inteiro de ${low} a ${high}.`)
const chars=text=>Array.from(String(text))
export function createHudConfiguration({width=320}={}){
 return {format:HUD_FORMAT,version:1,screen:{width,height:224},safe:{left:8,top:8,right:8,bottom:8},plane:'window',palette:3,priority:true,
  font:{name:'',glyphs:[],map:SGDK_FONT_MAP,colors:[0,0x0EEE,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},
  values:[{id:'score',max:999999},{id:'life',max:5}],
  elements:[{id:'score_label',type:'text',anchor:'top-left',x:0,y:0,text:'PONTOS'},{id:'score',type:'number',anchor:'top-left',x:56,y:0,value:'score',digits:6,pad:'0'},
   {id:'life',type:'icons',anchor:'top-right',x:0,y:0,value:'life',max:5,full:'*',empty:'.'}],
  menus:[],dialogue:{enabled:false,anchor:'bottom',x:0,y:0,width:36,lines:3,speaker:true,cursor:'>'}}
}
/** Caractere → índice do glifo. Espaço sempre existe. */
export function glyphTable(font){
 const table=new Map();chars(font.map).forEach((character,index)=>{if(!table.has(character))table.set(character,index)})
 return table
}
/** Texto → glifos, ou erro dizendo qual caractere a fonte não tem. */
export function encodeText(font,text,label){
 const table=glyphTable(font)
 return chars(text).map(character=>table.has(character)?table.get(character):fail(`${label}: a fonte não tem o caractere “${character}”. Acrescente-o ao mapa da fonte ou troque o texto.`))
}
const size=(element)=>element.type==='text'?chars(element.text).length:element.type==='number'?element.digits:element.type==='bar'?element.width:element.max
/** Posição em pixels do canto de um bloco de w × h pixels ancorado dentro da área segura. */
export function anchorPosition(config,anchor,x,y,width,height){
 const {safe,screen}=config,left=safe.left,right=screen.width-safe.right,top=safe.top,bottom=screen.height-safe.bottom
 const column=anchor.endsWith('left')||anchor==='left'?0:anchor.endsWith('right')||anchor==='right'?2:1,row=anchor.startsWith('top')?0:anchor.startsWith('bottom')?2:1
 return {x:(column===0?left:column===2?right-width:left+Math.floor((right-left-width)/2))+x,y:(row===0?top:row===2?bottom-height:top+Math.floor((bottom-top-height)/2))+y}
}
export function validateHudConfiguration(value){
 if(!value||value.format!==HUD_FORMAT||value.version!==1)fail('Formato de HUD desconhecido.')
 const screen=value.screen||{};if(![256,320].includes(screen.width)||![224,240].includes(screen.height))fail('Tela: use 256 ou 320 de largura e 224 ou 240 de altura.')
 const safe=value.safe||{};for(const side of ['left','top','right','bottom'])integer(safe[side],0,64,'Área segura ('+side+')')
 if(!HUD_PLANES.includes(value.plane))fail('Plano do HUD inválido.')
 integer(value.palette,0,3,'Paleta do HUD');if(typeof value.priority!=='boolean')fail('Prioridade do HUD inválida.')
 const font=value.font||{};if(typeof font.name!=='string'||font.name.length>64||typeof font.map!=='string'||!Array.isArray(font.glyphs)||!Array.isArray(font.colors)||font.colors.length!==16)fail('Fonte inválida.')
 const map=chars(font.map)
 if(!map.length||map.length>HUD_LIMITS.glyphs)fail(`Mapa da fonte: de 1 a ${HUD_LIMITS.glyphs} caracteres (o espaço da fonte no console é de ${HUD_LIMITS.glyphs} tiles).`)
 if(new Set(map).size!==map.length)fail('Mapa da fonte: o caractere “'+map.find((character,index)=>map.indexOf(character)!==index)+'” aparece duas vezes.')
 if(!map.includes(' '))fail('Mapa da fonte: precisa ter o espaço.')
 if(map.some(character=>character<' '||character==='\u007f'))fail('Mapa da fonte: caracteres de controle não são aceitos.')
 if(map.some(character=>character.codePointAt(0)>0xFFFF))fail('Mapa da fonte: o caractere “'+map.find(character=>character.codePointAt(0)>0xFFFF)+'” não é aceito (só caracteres até U+FFFF; emojis ficam de fora).')
 if(font.glyphs.length){
  if(font.glyphs.length!==map.length)fail(`A fonte tem ${font.glyphs.length} glifos e o mapa, ${map.length} caracteres. Cada glifo precisa de um caractere, na ordem da imagem.`)
  if(font.glyphs.some(glyph=>typeof glyph!=='string'||!/^[0-9a-f]{64}$/.test(glyph)))fail('Fonte: glifo inválido (8 × 8 pixels, 16 cores).')
 }else if(font.map!==SGDK_FONT_MAP)fail('Sem imagem de fonte, o mapa é o da fonte padrão do SGDK.')
 if(font.colors.some(color=>!Number.isInteger(color)||color<0||color>0x0EEE||color&0x0111))fail('Fonte: cor inválida.')
 const values=value.values;if(!Array.isArray(values)||values.length>HUD_LIMITS.values)fail(`Valores: até ${HUD_LIMITS.values}.`)
 const valueIds=new Set();for(const item of values){
  if(!ID.test(item?.id||'')||valueIds.has(item.id))fail('Valor com id inválido ou repetido: '+(item?.id||''));valueIds.add(item.id);integer(item.max,1,99999999,'Valor '+item.id+' (máximo)')
 }
 const elements=value.elements;if(!Array.isArray(elements)||elements.length>HUD_LIMITS.elements)fail(`Elementos: até ${HUD_LIMITS.elements}.`)
 const ids=new Set();let spriteCells=0
 for(const element of elements){
  const label='Elemento '+(element?.id||'')
  if(!ID.test(element?.id||'')||ids.has(element.id))fail('Elemento com id inválido ou repetido: '+(element?.id||''));ids.add(element.id)
  if(!HUD_TYPES.includes(element.type)||!HUD_ANCHORS.includes(element.anchor))fail(label+': tipo ou âncora inválidos.')
  integer(element.x,-320,320,label+' (x)');integer(element.y,-240,240,label+' (y)')
  if(element.type==='text'){if(typeof element.text!=='string'||!element.text.length||chars(element.text).length>HUD_LIMITS.text)fail(`${label}: texto de 1 a ${HUD_LIMITS.text} caracteres.`);encodeText(font,element.text,label)}
  else{
   if(!valueIds.has(element.value))fail(label+': escolha um valor do jogo.')
   const source=values.find(item=>item.id===element.value)
   if(element.type==='number'){
    integer(element.digits,1,8,label+' (dígitos)');if(chars(element.pad||'').length!==1)fail(label+': o preenchimento é um caractere.');encodeText(font,'0123456789'+element.pad,label)
    if(source.max>=10**element.digits)fail(`${label}: ${element.digits} dígito(s) não mostram o máximo de “${source.id}” (${source.max}). Aumente os dígitos ou reduza o máximo.`)
   }else{
    integer(element.type==='bar'?element.width:element.max,1,32,label+(element.type==='bar'?' (largura)':' (máximo)'))
    if(chars(element.full||'').length!==1||chars(element.empty||'').length!==1)fail(label+': cheio e vazio são um caractere cada.');encodeText(font,element.full+element.empty,label)
    if(element.type==='icons'&&source.max>element.max)fail(`${label}: mostra até ${element.max}, mas “${source.id}” chega a ${source.max}.`)
   }
  }
  if(element.sprite!==undefined&&typeof element.sprite!=='boolean')fail(label+': opção de sprite inválida.')
  if(element.sprite){if(!font.glyphs.length)fail(label+': elementos em sprites precisam de uma fonte importada (a fonte padrão do SGDK não vira sprite).');spriteCells+=size(element)}
 }
 if(spriteCells>HUD_LIMITS.spriteCells)fail(`Elementos em sprites somam ${spriteCells} caracteres; o limite é ${HUD_LIMITS.spriteCells} (cada caractere é um sprite do console).`)
 const menus=value.menus;if(!Array.isArray(menus)||menus.length>HUD_LIMITS.menus)fail(`Menus: até ${HUD_LIMITS.menus}.`)
 const menuIds=new Set()
 for(const menu of menus){
  const label='Menu '+(menu?.id||'')
  if(!ID.test(menu?.id||'')||menuIds.has(menu.id))fail('Menu com id inválido ou repetido: '+(menu?.id||''));menuIds.add(menu.id)
  if(!HUD_ANCHORS.includes(menu.anchor))fail(label+': âncora inválida.');integer(menu.x,-320,320,label+' (x)');integer(menu.y,-240,240,label+' (y)')
  if(typeof menu.title!=='string'||chars(menu.title).length>HUD_LIMITS.text)fail(label+': título longo demais.');encodeText(font,menu.title,label)
  if(chars(menu.cursor||'').length!==1)fail(label+': o cursor é um caractere.');encodeText(font,menu.cursor,label)
  if(!Array.isArray(menu.items)||!menu.items.length||menu.items.length>HUD_LIMITS.items)fail(`${label}: de 1 a ${HUD_LIMITS.items} itens.`)
  const itemIds=new Set()
  for(const item of menu.items){
   if(!ID.test(item?.id||'')||itemIds.has(item.id))fail(label+': item com id inválido ou repetido.');itemIds.add(item.id)
   if(typeof item.text!=='string'||!item.text.length||chars(item.text).length>HUD_LIMITS.text-2)fail(`${label}: texto do item de 1 a ${HUD_LIMITS.text-2} caracteres.`);encodeText(font,item.text,label+', item '+item.id)
  }
 }
 // Os nomes viram constantes no header: dois nomes diferentes não podem dar a mesma constante.
 const macros=new Map()
 const macro=(name,label)=>{if(macros.has(name))fail(`${label} e ${macros.get(name)} gerariam a mesma constante no código (${name}). Troque um dos nomes.`);macros.set(name,label)}
 for(const item of values)macro('RETRO_HUD_VALUE_'+item.id.toUpperCase(),'O valor “'+item.id+'”')
 for(const menu of menus){macro('RETRO_HUD_MENU_'+menu.id.toUpperCase(),'O menu “'+menu.id+'”');for(const item of menu.items)macro('RETRO_HUD_ITEM_'+menu.id.toUpperCase()+'_'+item.id.toUpperCase(),'O item “'+item.id+'” do menu “'+menu.id+'”')}
 const dialogue=value.dialogue||{}
 if(typeof dialogue.enabled!=='boolean'||!HUD_ANCHORS.includes(dialogue.anchor)||typeof dialogue.speaker!=='boolean')fail('Caixa de diálogo inválida.')
 integer(dialogue.x,-320,320,'Diálogo (x)');integer(dialogue.y,-240,240,'Diálogo (y)');integer(dialogue.width,8,40,'Diálogo (largura em caracteres)');integer(dialogue.lines,1,HUD_LIMITS.dialogueLines,'Diálogo (linhas)')
 if(chars(dialogue.cursor||'').length!==1)fail('Diálogo: o cursor é um caractere.');encodeText(font,dialogue.cursor,'Diálogo')
 layoutHud(value)
 return value
}
const cells=(config,anchor,x,y,width,height,label)=>{
 // Centralizado raramente cai em múltiplo de 8: no eixo centralizado a posição desce para a célula.
 const base=anchorPosition(config,anchor,0,0,width*8,height*8),centerX=!/left|right/.test(anchor),centerY=!/top|bottom/.test(anchor)
 const position={x:(centerX?Math.floor(base.x/8)*8:base.x)+x,y:(centerY?Math.floor(base.y/8)*8:base.y)+y}
 if(position.x%8||position.y%8)fail(`${label}: fica em (${position.x}, ${position.y}) px. Texto em plano só cai em múltiplos de 8 px: ajuste a posição ou a área segura${label.startsWith('Elemento')?', ou use sprites para posição livre':''}.`)
 if(position.x<0||position.y<0||position.x+width*8>config.screen.width||position.y+height*8>config.screen.height)fail(`${label}: sai da tela (${position.x}, ${position.y}, ${width*8} × ${height*8} px).`)
 return {col:position.x/8,row:position.y/8,width,height}
}
/** Faixa da janela (plano WINDOW) que cobre as linhas usadas: do alto até a última, ou da primeira até embaixo. */
function band(rows,total,label){
 if(!rows.length)return null
 const first=Math.min(...rows.map(item=>item.row)),last=Math.max(...rows.map(item=>item.row+item.height))
 const top={edge:'top',rows:last},bottom={edge:'bottom',rows:total-first}
 const chosen=top.rows<=bottom.rows?top:bottom
 if(chosen.rows>total)fail(label+': fora da tela.')
 return chosen
}
/**
 * Onde cada coisa cai: células (planos) ou pixels (sprites), e as duas regiões de células —
 * a do HUD e a das telas por cima (menus e diálogo). Lança erro para o que não cabe.
 */
export function layoutHud(config){
 const total=config.screen.height/8,columns=config.screen.width/8
 const elements=config.elements.map(element=>{
  const width=size(element),label='Elemento '+element.id
  if(element.sprite){
   const position=anchorPosition(config,element.anchor,element.x,element.y,width*8,8)
   if(position.x<0||position.y<0||position.x+width*8>config.screen.width||position.y+8>config.screen.height)fail(`${label}: sai da tela (${position.x}, ${position.y}).`)
   return {id:element.id,sprite:true,x:position.x,y:position.y,width}
  }
  return {id:element.id,sprite:false,...cells(config,element.anchor,element.x,element.y,width,1,label)}
 })
 const menus=config.menus.map(menu=>{
  const width=Math.max(chars(menu.title).length,...menu.items.map(item=>chars(item.text).length+2)),height=menu.items.length+(menu.title?2:0)
  return {id:menu.id,...cells(config,menu.anchor,menu.x,menu.y,width,height,'Menu '+menu.id),titleRows:menu.title?2:0}
 })
 const dialogue=config.dialogue.enabled?cells(config,config.dialogue.anchor,config.dialogue.x,config.dialogue.y,config.dialogue.width,config.dialogue.lines+(config.dialogue.speaker?1:0),'Caixa de diálogo'):null
 const tiled=elements.filter(item=>!item.sprite)
 for(let i=0;i<tiled.length;i++)for(let k=i+1;k<tiled.length;k++){
  const a=tiled[i],b=tiled[k]
  if(a.row===b.row&&a.col<b.col+b.width&&b.col<a.col+a.width)fail(`Elementos ${a.id} e ${b.id} ocupam as mesmas células.`)
 }
 const box=list=>{if(!list.length)return {col:0,row:0,width:0,height:0};const col=Math.min(...list.map(item=>item.col)),row=Math.min(...list.map(item=>item.row));return {col,row,width:Math.max(...list.map(item=>item.col+item.width))-col,height:Math.max(...list.map(item=>item.row+item.height))-row}}
 const overlays=[...menus,...(dialogue?[dialogue]:[])]
 const result={columns,rows:total,elements,menus,dialogue,hud:box(tiled),overlay:box(overlays),window:null,notes:[]}
 if(config.plane==='window'){
  // A janela é uma faixa só, colada no alto ou embaixo da tela, e esconde o plano A onde aparece.
  const hud=band(tiled,total,'HUD');let over=null
  if(tiled.length&&Math.min(hud.rows,total)>total/2&&tiled.some(item=>item.row<total/2)&&tiled.some(item=>item.row>=total/2))
   fail('Há elementos de HUD em cima e embaixo da tela. O plano de janela é uma faixa só, no alto ou embaixo: junte os elementos de um lado, use sprites nos do outro lado ou troque o plano do HUD.')
  if(overlays.length)over=band(overlays,total,'Menus e diálogo')
  result.window={hud,overlay:over}
  if(hud)result.notes.push(`O HUD usa a janela nas ${hud.rows} linha(s) de tiles ${hud.edge==='top'?'do alto':'de baixo'} (${hud.rows*8} px): o plano A do jogo não aparece ali.`)
  if(over)result.notes.push('Com um menu ou diálogo aberto, a janela passa a cobrir as linhas dele (do alto até a última linha dele, ou da primeira até embaixo — o que esconder menos do plano A). O HUD em plano que ficar fora dessa faixa some até fechar.')
 }else result.notes.push(`O HUD é desenhado no plano ${config.plane==='bg-a'?'A':'B'}, que rola junto com o cenário: serve para telas paradas (título, pausa), não para HUD sobre um mapa que anda. Fechar um menu ou diálogo apaga as células que ele ocupava: o jogo redesenha o cenário ali.`)
 // A área segura posiciona as âncoras; um deslocamento ou um bloco largo ainda pode sair dela.
 const {safe,screen}=config,outside=(x,y,width,height)=>x<safe.left||y<safe.top||x+width>screen.width-safe.right||y+height>screen.height-safe.bottom
 const out=[...elements.filter(item=>item.sprite?outside(item.x,item.y,item.width*8,8):outside(item.col*8,item.row*8,item.width*8,8)).map(item=>item.id),
  ...menus.filter(item=>outside(item.col*8,item.row*8,item.width*8,item.height*8)).map(item=>'menu '+item.id),...(dialogue&&outside(dialogue.col*8,dialogue.row*8,dialogue.width*8,dialogue.height*8)?['caixa de diálogo']:[])]
 if(out.length)result.notes.push('Fora da área segura (podem ser cortados em TVs antigas): '+out.join(', ')+'.')
 if(config.font.glyphs.length)result.notes.push('A fonte importada troca a fonte do console: textos desenhados pelo jogo com VDP_drawText (inclusive mensagens de erro) passam a sair com os glifos na ordem do mapa, não em ASCII.')
 return result
}
const hex=(value,digits=4)=>'0x'+value.toString(16).toUpperCase().padStart(digits,'0')
const upper=id=>id.toUpperCase()
const bytes=list=>'{'+(list.length?list.join(','):'0')+'}'
/** Glifo "aabb…" (64 nibbles, linha a linha) → 8 palavras de 32 bits do VDP. */
export const glyphWords=glyph=>Array.from({length:8},(_value,row)=>parseInt(glyph.slice(row*8,row*8+8),16)>>>0)
export function compileHudHeader(value){
 const config=validateHudConfiguration(value),layout=layoutHud(config),font=config.font,table=[...glyphTable(font)].map(([character,glyph])=>[character.codePointAt(0),glyph]).sort((a,b)=>a[0]-b[0])
 const code=text=>encodeText(font,text,'texto'),one=text=>code(text)[0],valueIndex=id=>config.values.findIndex(item=>item.id===id)
 let out='/* Gerado pelo Retro Studio a partir de hud/hud.json. Não edite: use Recursos → Runtime → HUD e textos. */\n#ifndef RETRO_PROJECT_HUD_CONFIG_H\n#define RETRO_PROJECT_HUD_CONFIG_H\n#include "../retro_runtime/retro_hud.h"\n'
 out+=`#define RETRO_PROJECT_HUD_VERSION 1\n#define RETRO_PROJECT_HUD_PLANE ${HUD_PLANES.indexOf(config.plane)} /* 0 janela, 1 plano A, 2 plano B */\n#define RETRO_PROJECT_HUD_PALETTE ${config.palette}\n#define RETRO_PROJECT_HUD_PRIORITY ${config.priority?1:0}\n`
 out+=`#define RETRO_PROJECT_HUD_CUSTOM_FONT ${font.glyphs.length?1:0}\n#define RETRO_PROJECT_HUD_GLYPHS ${chars(font.map).length}\n#define RETRO_PROJECT_HUD_SPRITES ${layout.elements.filter(item=>item.sprite).reduce((sum,item)=>sum+item.width,0)}\n`
 out+=`#define RETRO_PROJECT_HUD_CELLS ${layout.hud.width*layout.hud.height}\n#define RETRO_PROJECT_HUD_OVERLAY_CELLS ${layout.overlay.width*layout.overlay.height}\n`
 config.values.forEach((item,index)=>{out+=`#define RETRO_HUD_VALUE_${upper(item.id)} ${index}\n`})
 config.menus.forEach((menu,index)=>{out+=`#define RETRO_HUD_MENU_${upper(menu.id)} ${index}\n`;menu.items.forEach((item,position)=>{out+=`#define RETRO_HUD_ITEM_${upper(menu.id)}_${upper(item.id)} ${position}\n`})})
 if(font.glyphs.length)out+=`static const uint32_t retroProjectHudFontTiles[]={\n${font.glyphs.map(glyph=>' '+glyphWords(glyph).map(word=>hex(word,8)).join(',')).join(',\n')}\n};\n`
 out+=`#define RETRO_PROJECT_HUD_FONT_TILES ${font.glyphs.length?'retroProjectHudFontTiles':'0'}\n`
 let mask=0;for(const glyph of font.glyphs)for(const pixel of glyph)mask|=1<<parseInt(pixel,16)
 out+=`#define RETRO_PROJECT_HUD_COLOR_MASK ${hex(mask&0xFFFE)} /* cores que a fonte usa */\n`
 if(layout.elements.some(item=>item.sprite)){
  out+=`/* Glifo -> quadro da planilha de sprites (0xFF: glifo sem pixels, fora da planilha). */\nstatic const uint8_t retroProjectHudSpriteFrames[]={${hudSpriteSheet(config).frames.join(',')}};\n#define RETRO_PROJECT_HUD_SPRITE_FRAMES retroProjectHudSpriteFrames\n`
 }else out+='#define RETRO_PROJECT_HUD_SPRITE_FRAMES 0\n'
 out+=`static const uint16_t retroProjectHudColors[16]={${font.colors.map(color=>hex(color)).join(',')}};\n`
 out+=`/* Caractere (ponto de código) → glifo, em ordem crescente: usado para textos que chegam em UTF-8 (diálogos). */\nstatic const RetroHudGlyph retroProjectHudGlyphs[]={${table.map(([point,glyph])=>`{${point},${glyph}}`).join(',')}};\n`
 config.elements.forEach((element,index)=>{if(element.type==='text')out+=`static const uint8_t retroProjectHudText${index}[]=${bytes(code(element.text))};\n`})
 out+=`static const RetroHudElement retroProjectHudElements[]={\n${config.elements.map((element,index)=>{
  const place=layout.elements[index],type=HUD_TYPES.indexOf(element.type)
  const x=place.sprite?place.x:place.col-layout.hud.col,y=place.sprite?place.y:place.row-layout.hud.row
  return ` {${type},${place.sprite?1:0},${x},${y},${place.width},${element.type==='text'?0:valueIndex(element.value)},${element.type==='number'?one(element.pad):element.type==='text'?0:one(element.full)},${element.type==='text'||element.type==='number'?0:one(element.empty)},${element.type==='text'?'retroProjectHudText'+index:0},${element.type==='bar'||element.type==='icons'?config.values[valueIndex(element.value)].max:0}}`
 }).join(',\n')||' {0,0,0,0,0,0,0,0,0,0}'}\n};\n`
 config.menus.forEach((menu,index)=>{
  out+=`static const uint8_t retroProjectHudMenu${index}Title[]=${bytes(code(menu.title))};\n`
  menu.items.forEach((item,position)=>{out+=`static const uint8_t retroProjectHudMenu${index}Item${position}[]=${bytes(code(item.text))};\n`})
  out+=`static const RetroHudText retroProjectHudMenu${index}Items[]={${menu.items.map((item,position)=>`{retroProjectHudMenu${index}Item${position},${chars(item.text).length}}`).join(',')}};\n`
 })
 out+=`static const RetroHudMenu retroProjectHudMenus[]={\n${config.menus.map((menu,index)=>{const place=layout.menus[index];return ` {${place.col-layout.overlay.col},${place.row-layout.overlay.row},${place.width},{retroProjectHudMenu${index}Title,${chars(menu.title).length}},retroProjectHudMenu${index}Items,${menu.items.length},${one(menu.cursor)}}`}).join(',\n')||' {0,0,0,{0,0},0,0,0}'}\n};\n`
 const dialogue=layout.dialogue,band=layout.window||{hud:null,overlay:null},edge=item=>item?`{${item.edge==='top'?0:1},${item.rows}}`:'{0,0}'
 out+=`static const RetroHudDefinition retroProjectHud={\n retroProjectHudElements,${config.elements.length},retroProjectHudMenus,${config.menus.length},retroProjectHudGlyphs,${table.length},${one(' ')},\n`
 out+=` {${layout.hud.col},${layout.hud.row},${layout.hud.width},${layout.hud.height}},{${layout.overlay.col},${layout.overlay.row},${layout.overlay.width},${layout.overlay.height}},\n`
 out+=` ${dialogue?`{1,${dialogue.col-layout.overlay.col},${dialogue.row-layout.overlay.row},${dialogue.width},${config.dialogue.lines},${config.dialogue.speaker?1:0},${one(config.dialogue.cursor)}}`:'{0,0,0,0,0,0,0}'},\n ${edge(band.hud)},${edge(band.overlay)},${config.values.length}\n};\n`
 out+=`static const uint32_t retroProjectHudMaximums[]={${config.values.map(item=>item.max+'u').join(',')||'0'}};\n#endif\n`
 return out
}
/**
 * Planilha de glifos para os elementos em sprites: uma linha só, com os glifos que têm algum
 * pixel (o ResComp descarta quadros e linhas vazios, o que deslocaria os índices). frames[glifo]
 * = quadro na planilha, ou 255 para glifo sem pixels.
 */
export function hudSpriteSheet(config){
 const frames=[],kept=[]
 config.font.glyphs.forEach(glyph=>{if(/^0+$/.test(glyph))frames.push(255);else{frames.push(kept.length);kept.push(glyph)}})
 const width=Math.max(1,kept.length)*8,indices=new Uint8Array(width*8)
 kept.forEach((glyph,index)=>{for(let y=0;y<8;y++)for(let x=0;x<8;x++)indices[y*width+index*8+x]=parseInt(glyph[y*8+x],16)})
 return {width,height:8,indices,frames}
}
export function hudCost(value){
 const config=validateHudConfiguration(value),layout=layoutHud(config),glyphs=chars(config.font.map).length,sprites=layout.elements.filter(item=>item.sprite).reduce((sum,item)=>sum+item.width,0)
 const hudCells=layout.hud.width*layout.hud.height,overlayCells=layout.overlay.width*layout.overlay.height
 const texts=config.elements.filter(item=>item.type==='text').reduce((sum,item)=>sum+chars(item.text).length,0)+config.menus.reduce((sum,menu)=>sum+chars(menu.title).length+menu.items.reduce((total,item)=>total+chars(item.text).length+4,0),0)
 return {
  // A fonte importada ocupa o lugar da fonte do SGDK (96 tiles a partir de TILE_FONT_INDEX): nenhum tile a mais.
  vramTiles:0,fontTiles:config.font.glyphs.length?glyphs:0,sprites,spriteTiles:sprites,
  // Buffers de células (o que deve estar e o que está na tela) mais o estado do runtime e do adaptador.
  ramBytes:2*(hudCells+overlayCells)+320,
  romBytes:(config.font.glyphs.length?glyphs*32:0)+32+glyphs*4+config.elements.length*16+config.menus.length*20+texts+64,
  hudCells,overlayCells,windowRows:layout.window?{hud:layout.window.hud?.rows||0,overlay:layout.window.overlay?.rows||0}:null,
  worstFrameCells:Math.max(hudCells,overlayCells),notes:layout.notes
 }
}
