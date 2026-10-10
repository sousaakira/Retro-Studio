// #57: espelho em JS de assets/toolkit/lib/runtime/palette/retro_palette.c para a prévia do
// editor. A paridade com o C é conferida por scripts/smoke-runtime-palette.mjs.
const scale=(color,bright)=>{
 if(bright>=256)return color&0x0EEE
 const r=((((color>>1)&7)*bright+128)>>8),g=((((color>>5)&7)*bright+128)>>8),b=((((color>>9)&7)*bright+128)>>8)
 return (r<<1)|(g<<5)|(b<<9)
}
export const validPaletteCycle=c=>!!c&&Number.isInteger(c.first)&&Number.isInteger(c.count)&&Number.isInteger(c.frames)&&c.count>=2&&c.frames>=1&&c.frames<=255&&
 (c.first&15)!==0&&c.first>=0&&c.first<64&&(c.first&15)+c.count<=16&&(c.backward===0||c.backward===1)
/** base: 64 palavras do VDP; cycles: [{first,count,frames,backward}] (first = índice global). */
export function createPaletteRuntime(base,cycles=[]){
 if(!Array.isArray(base)||base.length!==64||cycles.length>8||!cycles.every(validPaletteCycle))return null
 const p={cycles,logical:base.map(c=>c&0x0EEE),colors:base.map(c=>c&0x0EEE),bright:[256,256,256,256],timers:cycles.map(()=>0),active:0,
  fadeMask:0,fadeFrames:0,fadeFrame:0,fadeOut:0,fadeFrom:[256,256,256,256],dirtyFirst:0,dirtyLast:63}
 const dirty=(first,last)=>{if(p.dirtyFirst>p.dirtyLast){p.dirtyFirst=first;p.dirtyLast=last}else{p.dirtyFirst=Math.min(p.dirtyFirst,first);p.dirtyLast=Math.max(p.dirtyLast,last)}}
 const output=(first,last)=>{for(let i=first;i<=last;i++){const color=scale(p.logical[i],p.bright[i>>4]);if(color!==p.colors[i]){p.colors[i]=color;dirty(i,i)}}}
 const brightness=(mask,bright)=>{bright=Math.min(256,bright);p.fadeMask&=~mask;if(!p.fadeMask)p.fadeFrames=0;for(let i=0;i<4;i++)if(mask&(1<<i)){p.bright[i]=bright;output(i<<4,(i<<4)+15)}}
 return {state:p,
  set(index,colors){if(index<0||index>3||!colors)return;const first=index<<4;for(let i=0;i<16;i++)p.logical[first+i]=colors[i]&0x0EEE;cycles.forEach((c,i)=>{if((c.first>>4)===index)p.timers[i]=0});output(first,first+15)},
  cycle(index,on){if(index<0||index>=cycles.length)return;if(on){if(!(p.active&(1<<index)))p.timers[index]=0;p.active|=1<<index}else p.active&=~(1<<index)},
  brightness,
  fade(fade){if(!fade||!(fade.mask&15))return;if(!fade.frames){brightness(fade.mask&15,fade.out?0:256);return}p.fadeFrom=[...p.bright];p.fadeMask=fade.mask&15;p.fadeFrames=fade.frames;p.fadeFrame=0;p.fadeOut=fade.out?1:0},
  fading:()=>p.fadeFrames!==0,
  tick(){
   cycles.forEach((c,i)=>{
    if(!(p.active&(1<<i)))return
    if(++p.timers[i]<c.frames)return
    p.timers[i]=0
    const last=c.first+c.count-1
    if(c.backward){const kept=p.logical[c.first];for(let k=c.first;k<last;k++)p.logical[k]=p.logical[k+1];p.logical[last]=kept}
    else{const kept=p.logical[last];for(let k=last;k>c.first;k--)p.logical[k]=p.logical[k-1];p.logical[c.first]=kept}
    output(c.first,last)
   })
   if(p.fadeFrames){
    const step=++p.fadeFrame
    for(let i=0;i<4;i++)if(p.fadeMask&(1<<i)){
     const from=p.fadeFrom[i]
     p.bright[i]=p.fadeOut?from-Math.floor(from*step/p.fadeFrames):from+Math.floor((256-from)*step/p.fadeFrames)
     output(i<<4,(i<<4)+15)
    }
    if(step>=p.fadeFrames){p.fadeFrames=0;p.fadeMask=0}
   }
   return p.dirtyFirst<=p.dirtyLast
  },
  sent(){p.dirtyFirst=1;p.dirtyLast=0}}
}
