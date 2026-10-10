// #65: imagem de fonte (grade de glifos de 8 × 8) → glifos e cores do HUD. A imagem é só a
// origem da importação: os glifos ficam dentro de hud/hud.json.
import {HUD_LIMITS,SGDK_FONT_MAP} from './hudConfiguration.js'
import {rgbToVdp} from './paletteConfiguration.js'
/**
 * rgba: pixels da imagem (largura e altura múltiplas de 8). Células lidas da esquerda para a
 * direita, de cima para baixo; células vazias no fim são descartadas. Pixel com alfa < 128 é
 * transparente. Devolve {glyphs, colors, map, cells, dropped} ou lança erro com o motivo.
 */
export function fontFromImage(rgba,width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width%8||height%8)throw Error(`A imagem da fonte tem ${width} × ${height} px. Largura e altura precisam ser múltiplos de 8 (glifos de 8 × 8).`)
 if(rgba.length!==width*height*4)throw Error('Imagem da fonte inválida.')
 const columns=width/8,rows=height/8,palette=new Map(),glyphs=[]
 // Planilhas indexadas do console costumam vir sem transparência, com a cor 0 de fundo: sem nenhum
 // pixel transparente, a cor do canto de cima à esquerda é tratada como fundo.
 let solid=true;for(let at=3;at<rgba.length;at+=4)if(rgba[at]<128){solid=false;break}
 const background=solid?[rgba[0],rgba[1],rgba[2]]:null
 for(let cell=0;cell<columns*rows;cell++){
  let glyph=''
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
   const at=(((cell/columns|0)*8+y)*width+(cell%columns)*8+x)*4
   if(rgba[at+3]<128||(background&&rgba[at]===background[0]&&rgba[at+1]===background[1]&&rgba[at+2]===background[2])){glyph+='0';continue}
   const word=rgbToVdp(rgba[at],rgba[at+1],rgba[at+2])
   if(!palette.has(word)){
    if(palette.size===15)throw Error('A fonte usa mais de 15 cores (depois de convertidas para as do console). Uma paleta comporta 15 mais a transparência.')
    palette.set(word,palette.size+1)
   }
   glyph+=palette.get(word).toString(16)
  }
  glyphs.push(glyph)
 }
 let count=glyphs.length
 while(count>1&&/^0+$/.test(glyphs[count-1]))count--
 if(!palette.size)throw Error(background?'A imagem da fonte tem uma cor só: não há glifos para ler.':'A imagem da fonte não tem nenhum pixel opaco. O fundo precisa ser transparente e os glifos, opacos.')
 if(count>HUD_LIMITS.glyphs)throw Error(`A imagem tem ${count} glifos; cabem ${HUD_LIMITS.glyphs} (o espaço da fonte no console).`)
 const colors=Array(16).fill(0);for(const [word,index] of palette)colors[index]=word
 // Sugestão de mapa: a ordem ASCII, que é a das planilhas de fonte mais comuns. O autor confere e corrige.
 return {glyphs:glyphs.slice(0,count),colors,map:Array.from(SGDK_FONT_MAP).slice(0,count).join(''),cells:columns*rows,dropped:glyphs.length-count,columns,backgroundAssumed:!!background}
}
/** Caracteres do mapa cujo glifo não tem nenhum pixel (fora o espaço): provável mapa desalinhado. */
export function emptyGlyphs(font){
 return Array.from(font.map).filter((character,index)=>character!==' '&&font.glyphs[index]&&/^0+$/.test(font.glyphs[index]))
}
