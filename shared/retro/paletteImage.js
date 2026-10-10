// #57: cores de uma imagem diante de uma paleta do console. Tudo aqui trabalha sobre cópias
// em memória (RGBA); o arquivo original nunca é alterado.
import {rgbToVdp,vdpToRgb,vdpChannels} from './paletteConfiguration.js'
const TRANSPARENT=-1
/** Cores do VDP usadas pela imagem (alfa < 128 = transparente), da mais para a menos usada. */
export function imageColors(rgba){
 const counts=new Map();let transparent=0
 for(let i=0;i<rgba.length;i+=4){
  if(rgba[i+3]<128){transparent++;continue}
  const word=rgbToVdp(rgba[i],rgba[i+1],rgba[i+2]);counts.set(word,(counts.get(word)||0)+1)
 }
 return {colors:[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(([word,pixels])=>({word,pixels})),transparent,pixels:rgba.length/4}
}
const distance=(a,b)=>{const x=vdpChannels(a),y=vdpChannels(b);return (x[0]-y[0])**2+(x[1]-y[1])**2+(x[2]-y[2])**2}
/**
 * Reduz uma lista de cores a no máximo `limit`, juntando sempre o par mais parecido (a cor
 * com menos pixels cede para a outra). Determinístico; devolve as cores e para onde foi cada original.
 */
export function reduceColors(colors,limit=15){
 const kept=colors.map(color=>({...color,members:[color.word]}))
 while(kept.length>limit){
  let best=null
  for(let i=0;i<kept.length;i++)for(let j=i+1;j<kept.length;j++){
   const d=distance(kept[i].word,kept[j].word)
   if(!best||d<best.d||(d===best.d&&kept[i].pixels+kept[j].pixels<best.weight))best={i,j,d,weight:kept[i].pixels+kept[j].pixels}
  }
  const [winner,loser]=kept[best.i].pixels>=kept[best.j].pixels?[best.i,best.j]:[best.j,best.i]
  kept[winner].pixels+=kept[loser].pixels;kept[winner].members.push(...kept[loser].members);kept.splice(loser,1)
 }
 const mapping=new Map();for(const color of kept)for(const member of color.members)mapping.set(member,color.word)
 return {colors:kept.map(({word,pixels})=>({word,pixels})),mapping}
}
/** Paleta de 16 cores (índice 0 = transparente) a partir de uma imagem, quantizando se preciso. */
export function paletteFromImage(rgba,transparentWord=0){
 const found=imageColors(rgba),reduced=reduceColors(found.colors,15)
 const colors=[transparentWord,...reduced.colors.map(color=>color.word)];while(colors.length<16)colors.push(0)
 return {colors,sourceColors:found.colors.length,quantized:found.colors.length>15}
}
/**
 * Encaixa a imagem em uma paleta de 16 cores. O índice 0 é a transparência e nunca recebe
 * pixel opaco. Devolve os índices por pixel, a cópia RGBA "depois" e o relatório de conflitos.
 */
export function fitImageToPalette(rgba,palette){
 const pixels=rgba.length/4,indices=new Uint8Array(pixels),after=new Uint8ClampedArray(rgba.length)
 const cache=new Map(),missing=new Map();let changed=0,worst=0
 const nearest=word=>{
  if(cache.has(word))return cache.get(word)
  let best=1,bestDistance=Infinity
  for(let index=1;index<16;index++){const d=distance(word,palette[index]);if(d<bestDistance){bestDistance=d;best=index}}
  const result={index:best,distance:bestDistance};cache.set(word,result);return result
 }
 for(let pixel=0;pixel<pixels;pixel++){
  const i=pixel*4
  if(rgba[i+3]<128){indices[pixel]=0;continue}
  const word=rgbToVdp(rgba[i],rgba[i+1],rgba[i+2]),match=nearest(word)
  indices[pixel]=match.index
  const rgb=vdpToRgb(palette[match.index]);after[i]=rgb[0];after[i+1]=rgb[1];after[i+2]=rgb[2];after[i+3]=255
  if(match.distance){changed++;worst=Math.max(worst,match.distance);missing.set(word,(missing.get(word)||0)+1)}
 }
 const used=new Set(indices);used.delete(0)
 return {indices,after,changedPixels:changed,opaquePixels:pixels-indices.reduce((n,index)=>n+(index===0?1:0),0),
  missing:[...missing].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(([word,count])=>({word,pixels:count})),
  // Distância máxima em níveis do VDP (0 = idêntico): raiz da soma dos quadrados por canal.
  worstDistance:+Math.sqrt(worst).toFixed(2),usedIndices:[...used].sort((a,b)=>a-b),exact:changed===0}
}
/** Conflitos de um recurso atribuído a uma paleta, em termos que a tela pode mostrar. */
export function assignmentConflicts(rgba,palette){
 const found=imageColors(rgba),fit=fitImageToPalette(rgba,palette),conflicts=[]
 if(found.colors.length>15)conflicts.push({code:'too-many-colors',count:found.colors.length})
 if(fit.missing.length)conflicts.push({code:'colors-not-in-palette',count:fit.missing.length,pixels:fit.changedPixels})
 return {sourceColors:found.colors.length,transparentPixels:found.transparent,conflicts,fit}
}
export {TRANSPARENT}
