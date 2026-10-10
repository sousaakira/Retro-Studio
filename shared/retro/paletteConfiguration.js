// #57: paletas do projeto (PAL0–PAL3), recursos atribuídos, ciclos e fades.
// Cores são palavras do VDP: 0000BBB0GGG0RRR0 (3 bits por canal, 512 cores).
import {validPaletteCycle} from './paletteRuntime.js'
export const PALETTE_FORMAT='retro-studio.palettes'
/** sizeof(RetroPalette) compilado para o 68000 (conferido no teste do runtime). */
export const PALETTE_STATE_BYTES=326
/** Código do módulo no 68000 com as opções de release do SGDK (-O3); cerca de 1,8 KiB com -O2/-Os. */
export const PALETTE_CODE_BYTES=4742
export const PALETTE_LIMITS=Object.freeze({palettes:4,colors:16,assignments:128,cycles:8,fades:8})
const ID=/^[a-z][a-z0-9_]{0,23}$/
export const vdpColor=(r,g,b)=>(r<<1)|(g<<5)|(b<<9)
export const vdpChannels=word=>[(word>>1)&7,(word>>5)&7,(word>>9)&7]
/** Nível 0–7 → 0–255, como a saída do console costuma ser representada (n × 36). */
export const vdpToRgb=word=>vdpChannels(word).map(level=>level*36)
// Mesma regra do rescomp do SGDK 1.81 ao converter uma imagem: os 3 bits altos de cada canal
// (trunca, não arredonda). Assim o editor e o jogo compilado chegam às mesmas cores.
export const rgbToVdp=(r,g,b)=>vdpColor(...[r,g,b].map(value=>Math.max(0,Math.min(255,value|0))>>5))
export const vdpToHex=word=>'#'+vdpToRgb(word).map(value=>value.toString(16).padStart(2,'0')).join('')
export function createPaletteConfiguration(){
 const gray=Array.from({length:16},(_,i)=>i===0?0:vdpColor(...Array(3).fill(Math.min(7,Math.round(i*7/15)))))
 return {format:PALETTE_FORMAT,version:1,backdrop:0,
  palettes:Array.from({length:4},(_,index)=>({name:'PAL'+index,colors:[...gray]})),assignments:[],cycles:[],fades:[]}
}
const portable=file=>typeof file==='string'&&file.length>0&&file.length<=512&&!file.startsWith('/')&&!/^[a-zA-Z]:/.test(file)&&!file.includes('\\')&&!/[\x00-\x1f]/.test(file)&&file.split('/').every(part=>part&&part!=='.'&&part!=='..')
export function validatePaletteConfiguration(value){
 if(!value||typeof value!=='object'||value.format!==PALETTE_FORMAT||value.version!==1)throw Error('Unsupported palette configuration.')
 if(!Array.isArray(value.palettes)||value.palettes.length!==4)throw Error('A palette configuration has exactly four palettes.')
 value.palettes.forEach((palette,index)=>{
  if(!palette||typeof palette.name!=='string'||!palette.name.trim()||palette.name.length>24||/[\x00-\x1f"\\*\/]/.test(palette.name))throw Error('Invalid name of palette '+index+'.')
  if(!Array.isArray(palette.colors)||palette.colors.length!==16||palette.colors.some(color=>!Number.isInteger(color)||color<0||(color&~0x0EEE)))throw Error('Invalid colors of palette '+index+'.')
 })
 if(!Number.isInteger(value.backdrop)||value.backdrop<0||value.backdrop>63)throw Error('Invalid backdrop color.')
 if(!Array.isArray(value.assignments)||value.assignments.length>PALETTE_LIMITS.assignments)throw Error('Invalid palette assignments.')
 const resources=new Set()
 for(const item of value.assignments){
  if(!item||!portable(item.resource)||!/\.png$/i.test(item.resource)||resources.has(item.resource)||!Number.isInteger(item.palette)||item.palette<0||item.palette>3)throw Error('Invalid palette assignment.')
  resources.add(item.resource)
 }
 const ids=new Set()
 const id=item=>{if(!item||!ID.test(item.id)||ids.has(item.id))throw Error('Invalid or repeated palette effect name.');ids.add(item.id)}
 if(!Array.isArray(value.cycles)||value.cycles.length>PALETTE_LIMITS.cycles)throw Error('Invalid palette cycles.')
 const used=new Set()
 for(const cycle of value.cycles){
  id(cycle)
  if(!Number.isInteger(cycle.palette)||cycle.palette<0||cycle.palette>3||!['forward','backward'].includes(cycle.direction)||
   !validPaletteCycle({first:cycle.palette*16+cycle.first,count:cycle.count,frames:cycle.frames,backward:0})||cycle.first<1||cycle.first>15)throw Error('Invalid palette cycle: '+cycle.id+'.')
  // Two cycles rotating the same color would depend on their order: refused.
  for(let i=0;i<cycle.count;i++){const color=cycle.palette*16+cycle.first+i;if(used.has(color))throw Error('Palette cycles overlap at color '+color+'.');used.add(color)}
 }
 if(!Array.isArray(value.fades)||value.fades.length>PALETTE_LIMITS.fades)throw Error('Invalid palette fades.')
 for(const fade of value.fades){
  id(fade)
  if(!['in','out'].includes(fade.kind)||!Array.isArray(fade.palettes)||!fade.palettes.length||fade.palettes.length>4||new Set(fade.palettes).size!==fade.palettes.length||
   fade.palettes.some(index=>!Number.isInteger(index)||index<0||index>3)||!Number.isInteger(fade.frames)||fade.frames<1||fade.frames>255)throw Error('Invalid palette fade: '+fade.id+'.')
 }
 return value
}
export const paletteWords=config=>config.palettes.flatMap(palette=>palette.colors)
export const paletteRuntimeCycles=config=>config.cycles.map(cycle=>({first:cycle.palette*16+cycle.first,count:cycle.count,frames:cycle.frames,backward:cycle.direction==='backward'?1:0}))
export const paletteRuntimeFades=config=>config.fades.map(fade=>({mask:fade.palettes.reduce((mask,index)=>mask|(1<<index),0),frames:fade.frames,out:fade.kind==='out'?1:0}))
const hex=word=>'0x'+word.toString(16).toUpperCase().padStart(4,'0')
export function compilePaletteHeader(config){
 validatePaletteConfiguration(config)
 const cycles=paletteRuntimeCycles(config),fades=paletteRuntimeFades(config),name=item=>item.id.toUpperCase()
 const lines=['/* Generated: project palettes, cycles and fades. Colors are VDP words (0BGR, 3 bits each). */',
  '#ifndef RETRO_PROJECT_PALETTE_CONFIG_H','#define RETRO_PROJECT_PALETTE_CONFIG_H','#include "../retro_runtime/retro_palette.h"','#define RETRO_PROJECT_PALETTES 1',
  '#define RETRO_PROJECT_BACKDROP '+config.backdrop,
  'static const uint16_t retroProjectPalettes[RETRO_PALETTE_COLORS]={',
  ...config.palettes.map((palette,index)=>' /* PAL'+index+' '+palette.name.replace(/\*\//g,'* /')+' */ '+palette.colors.map(hex).join(',')+(index<3?',':'')),'};',
  '#define RETRO_PROJECT_CYCLE_COUNT '+cycles.length]
 config.cycles.forEach((cycle,index)=>lines.push('#define RETRO_CYCLE_'+name(cycle)+' '+index))
 // C forbids empty arrays: one unused entry keeps the table valid when nothing is configured.
 lines.push('static const RetroPaletteCycle retroProjectCycles[]={'+(cycles.length?cycles.map(c=>'{'+[c.first,c.count,c.frames,c.backward]+'}').join(','):'{1,2,1,0}')+'};')
 lines.push('#define RETRO_PROJECT_FADE_COUNT '+fades.length)
 config.fades.forEach((fade,index)=>lines.push('#define RETRO_FADE_'+name(fade)+' '+index))
 lines.push('static const RetroPaletteFade retroProjectFades[]={'+(fades.length?fades.map(f=>'{'+[f.mask,f.frames,f.out]+'}').join(','):'{0,1,0}')+'};','#endif','')
 return lines.join('\n')
}
/** Custo e limites do que será exportado, para 60 Hz (NTSC) e 50 Hz (PAL). Estimativas de
 * planejamento a partir da configuração; não são medições na ROM. */
export function paletteCost(config){
 validatePaletteConfiguration(config)
 const cycles=config.cycles.map(cycle=>({id:cycle.id,wordsPerStep:cycle.count,stepsPerSecond:{ntsc:+(60/cycle.frames).toFixed(2),pal:+(50/cycle.frames).toFixed(2)},
  loopFrames:cycle.frames*cycle.count}))
 const fades=config.fades.map(fade=>({id:fade.id,maxWordsPerFrame:fade.palettes.length*16,frames:fade.frames,
  // Um canal tem 8 níveis: no máximo 7 quadros mudam a cor mais clara de cada paleta.
  visibleSteps:Math.min(fade.frames,7),seconds:{ntsc:+(fade.frames/60).toFixed(2),pal:+(fade.frames/50).toFixed(2)}}))
 // O adaptador envia uma única faixa contínua por quadro: do primeiro ao último índice que
 // pode mudar. O pior caso é todos os ciclos e o maior fade mudarem no mesmo quadro.
 const touched=new Set()
 for(const cycle of config.cycles)for(let i=0;i<cycle.count;i++)touched.add(cycle.palette*16+cycle.first+i)
 for(const fade of config.fades)for(const index of fade.palettes)for(let i=0;i<16;i++)touched.add(index*16+i)
 const worstFrameWords=touched.size?Math.max(...touched)-Math.min(...touched)+1:0
 // ROM: 64 cores + tabelas. RAM: sizeof(RetroPalette) no 68000 (conferido no teste do runtime).
 return {romBytes:128+Math.max(1,config.cycles.length)*4+Math.max(1,config.fades.length)*3,codeBytes:PALETTE_CODE_BYTES,ramBytes:PALETTE_STATE_BYTES,cycles,fades,worstFrameWords,
  // Carga inicial: as 64 cores de uma vez. CPU de um fade: 7 multiplicações por paleta por quadro
  // e, só nos quadros em que algum nível visível muda, a recomposição das 16 cores da paleta.
  loadWords:64,fadeMultipliesPerPalette:7,
  limitations:['four-palettes','fifteen-colors-plus-transparent','one-transfer-per-frame','fade-to-black-only','no-raster-effects','no-shadow-highlight','not-with-sgdk-fades']}
}
