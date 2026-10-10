#include "retro_palette.h"
static void dirty(RetroPalette *p,uint8_t first,uint8_t last){
 if(p->dirtyFirst>p->dirtyLast){p->dirtyFirst=first;p->dirtyLast=last;return;}
 if(first<p->dirtyFirst)p->dirtyFirst=first;
 if(last>p->dirtyLast)p->dirtyLast=last;
}
/* Brightness of one palette: each of the 8 channel levels scaled by bright/256, rounded
 * to nearest. Returns 1 when some level changed. Seven multiplications per palette, and
 * none per color: most frames of a fade change no visible level at all. */
static uint8_t setBright(RetroPalette *p,uint8_t index,uint16_t bright){
 uint8_t level,changed=0;
 p->bright[index]=bright;
 for(level=0;level<8;level++){
  uint8_t value=(uint8_t)(bright>=256?level:(level*bright+128)>>8);
  if(value!=p->levels[index][level]){p->levels[index][level]=value;changed=1;}
 }
 return changed;
}
/* Recomputes a range; only colors that really changed are marked to be sent. */
static void output(RetroPalette *p,uint8_t first,uint8_t last){
 uint8_t i;
 for(i=first;i<=last;i++){
  const uint8_t *levels=p->levels[i>>4];
  uint16_t source=p->logical[i];
  uint16_t color=(uint16_t)((levels[(source>>1)&7]<<1)|(levels[(source>>5)&7]<<5)|(levels[(source>>9)&7]<<9));
  if(color!=p->colors[i]){p->colors[i]=color;dirty(p,i,i);}
 }
}
static uint8_t validCycle(const RetroPaletteCycle *c){
 /* count is checked alone first: the sum below must not wrap for a hand-written table. */
 return (uint8_t)(c->count>=2&&c->count<=15&&c->frames>=1&&(c->first&15)!=0&&c->first<RETRO_PALETTE_COLORS&&
  (c->first&15)+c->count<=16&&c->backward<=1);
}
uint8_t retroPaletteInit(RetroPalette *p,const uint16_t *base,const RetroPaletteCycle *cycles,uint8_t cycleCount){
 uint8_t i;
 if(!p)return 0;
 p->ready=0;
 if(!base||cycleCount>RETRO_PALETTE_MAX_CYCLES||(cycleCount&&!cycles))return 0;
 for(i=0;i<cycleCount;i++)if(!validCycle(&cycles[i]))return 0;
 p->cycles=cycles;p->cycleCount=cycleCount;p->active=0;
 p->fadeMask=0;p->fadeFrames=0;p->fadeFrame=0;p->fadeOut=0;
 for(i=0;i<RETRO_PALETTE_MAX_CYCLES;i++)p->timers[i]=0;
 for(i=0;i<4;i++){uint8_t level;p->bright[i]=256;p->fadeFrom[i]=256;for(level=0;level<8;level++)p->levels[i][level]=level;}
 for(i=0;i<RETRO_PALETTE_COLORS;i++)p->logical[i]=(uint16_t)(base[i]&0x0EEE);
 for(i=0;i<RETRO_PALETTE_COLORS;i++)p->colors[i]=p->logical[i];
 p->dirtyFirst=0;p->dirtyLast=RETRO_PALETTE_COLORS-1; /* first load sends everything */
 p->ready=1;
 return 1;
}
void retroPaletteSet(RetroPalette *p,uint8_t index,const uint16_t *colors16){
 uint8_t i,first;
 if(!p||!p->ready||index>3||!colors16)return;
 first=(uint8_t)(index<<4);
 for(i=0;i<16;i++)p->logical[first+i]=(uint16_t)(colors16[i]&0x0EEE);
 for(i=0;i<p->cycleCount&&i<RETRO_PALETTE_MAX_CYCLES;i++)if((p->cycles[i].first>>4)==index)p->timers[i]=0;
 output(p,first,(uint8_t)(first+15));
}
void retroPaletteCycleEnable(RetroPalette *p,uint8_t cycle,uint8_t on){
 if(!p||!p->ready||cycle>=p->cycleCount)return;
 if(on){if(!(p->active&(1u<<cycle)))p->timers[cycle]=0;p->active=(uint8_t)(p->active|(1u<<cycle));}
 else p->active=(uint8_t)(p->active&~(1u<<cycle));
}
void retroPaletteBrightness(RetroPalette *p,uint8_t mask,uint16_t bright){
 uint8_t i;
 if(!p||!p->ready)return;
 if(bright>256)bright=256;
 p->fadeMask=(uint8_t)(p->fadeMask&~mask);
 if(!p->fadeMask)p->fadeFrames=0;
 for(i=0;i<4;i++)if(mask&(1u<<i)){if(setBright(p,i,bright))output(p,(uint8_t)(i<<4),(uint8_t)((i<<4)+15));}
}
void retroPaletteFadeStart(RetroPalette *p,const RetroPaletteFade *fade){
 if(!p||!p->ready||!fade||!(fade->mask&15))return;
 if(!fade->frames){retroPaletteBrightness(p,(uint8_t)(fade->mask&15),fade->out?0:256);return;}
 /* Each palette starts from the brightness it has now: a fade that interrupts another
  * continues smoothly, and one that asks for what is already there changes nothing. */
 {uint8_t i;for(i=0;i<4;i++)p->fadeFrom[i]=p->bright[i];}
 p->fadeMask=(uint8_t)(fade->mask&15);p->fadeFrames=fade->frames;p->fadeFrame=0;p->fadeOut=(uint8_t)(fade->out?1:0);
}
uint8_t retroPaletteFading(const RetroPalette *p){return (uint8_t)(p&&p->ready&&p->fadeFrames!=0);}
uint8_t retroPaletteTick(RetroPalette *p){
 uint8_t i,k;
 if(!p||!p->ready)return 0;
 for(i=0;i<p->cycleCount;i++){
  const RetroPaletteCycle *c=&p->cycles[i];
  uint8_t last;uint16_t kept;
  if(!(p->active&(1u<<i)))continue;
  if(++p->timers[i]<c->frames)continue;
  p->timers[i]=0;
  last=(uint8_t)(c->first+c->count-1);
  if(c->backward){kept=p->logical[c->first];for(k=c->first;k<last;k++)p->logical[k]=p->logical[k+1];p->logical[last]=kept;}
  else{kept=p->logical[last];for(k=last;k>c->first;k--)p->logical[k]=p->logical[k-1];p->logical[c->first]=kept;}
  output(p,c->first,last);
 }
 if(p->fadeFrames){
  uint16_t step=(uint16_t)(++p->fadeFrame);
  for(i=0;i<4;i++)if(p->fadeMask&(1u<<i)){
   /* Linear from the starting brightness to black (out) or full (in). */
   uint16_t from=p->fadeFrom[i],bright;
   if(p->fadeOut)bright=(uint16_t)(from-(uint16_t)(((uint32_t)from*step)/p->fadeFrames));
   else bright=(uint16_t)(from+(uint16_t)(((uint32_t)(256-from)*step)/p->fadeFrames));
   if(setBright(p,i,bright))output(p,(uint8_t)(i<<4),(uint8_t)((i<<4)+15));
  }
  if(step>=p->fadeFrames){p->fadeFrames=0;p->fadeMask=0;}
 }
 return (uint8_t)(p->dirtyFirst<=p->dirtyLast);
}
void retroPaletteSent(RetroPalette *p){if(p){p->dirtyFirst=1;p->dirtyLast=0;}}
