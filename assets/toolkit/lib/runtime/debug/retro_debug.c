#include "retro_debug.h"
/* A project that exported the diagnostics switch and turned it off compiles
 * this file to nothing: the production ROM carries no diagnostic code or text.
 * Without the switch the module is compiled normally. */
#if defined(__has_include) && __has_include("../generated/debug_config.h")
#include "../generated/debug_config.h"
#endif
#if !defined(RETRO_PROJECT_DEBUG) || RETRO_PROJECT_DEBUG
/* A field is written whole or not at all: a number cut in the middle would be
 * a different value shown as if it had been measured. */
typedef struct {char *text;uint8_t used,size,mark,full;} Writer;
static void put(Writer *w,char c){if(w->used+1<w->size)w->text[w->used++]=c;else w->full=1;}
static void begin(Writer *w){w->mark=w->used;}
/* Ends a field; when it did not fit, it is removed and '>' marks the cut. */
static uint8_t end(Writer *w){
 if(!w->full)return 1;
 w->used=w->mark;
 if(w->used&&w->text[w->used-1]==' ')w->used--;
 if(w->used+1<w->size)w->text[w->used++]='>';
 return 0;
}
static void text(Writer *w,const char *s){while(s&&*s)put(w,*s++);}
static void number(Writer *w,uint32_t value){
 char digits[10];uint8_t count=0;
 do{digits[count++]=(char)('0'+value%10);value/=10;}while(value);
 while(count)put(w,digits[--count]);
}
static void signedNumber(Writer *w,int32_t value){
 if(value<0){put(w,'-');number(w,(uint32_t)(-(value+1))+1u);}else number(w,(uint32_t)value);
}
static void hex(Writer *w,uint16_t value){
 uint8_t shift;
 for(shift=16;shift;){shift=(uint8_t)(shift-4);put(w,"0123456789ABCDEF"[(value>>shift)&15]);}
}
/* Q8 value as pixels with two decimals, truncated toward zero. */
static void fixed(Writer *w,RetroFixed value){
 uint32_t magnitude=value<0?(uint32_t)(-(value+1))+1u:(uint32_t)value,hundredths=((magnitude&255u)*100u)>>8;
 if(value<0)put(w,'-');
 number(w,magnitude>>8);put(w,'.');put(w,(char)('0'+hundredths/10));put(w,(char)('0'+hundredths%10));
}
static uint8_t finish(Writer *w){w->text[w->used]=0;return w->used;}
static void measured(Writer *w,const RetroDebugSample *s,uint16_t bit,uint32_t value){
 if(s->measured&bit)number(w,value);else text(w,"--");
}
void retroDebugPeaksReset(RetroDebugPeaks *p){
 if(!p)return;
 p->cpu=p->dmaQueue=p->dmaBytes=p->sprites=p->vdpSprites=p->frames=0;p->vramLowest=0xFFFF;
}
void retroDebugPeaksUpdate(RetroDebugPeaks *p,const RetroDebugSample *s){
 if(!p||!s)return;
 if(p->frames<0xFFFF)p->frames++;
 if((s->measured&RETRO_DEBUG_CPU)&&s->cpu>p->cpu)p->cpu=s->cpu;
 if(s->measured&RETRO_DEBUG_DMA){if(s->dmaQueue>p->dmaQueue)p->dmaQueue=s->dmaQueue;if(s->dmaBytes>p->dmaBytes)p->dmaBytes=s->dmaBytes;}
 if(s->measured&RETRO_DEBUG_SPRITES){if(s->sprites>p->sprites)p->sprites=s->sprites;if(s->vdpSprites>p->vdpSprites)p->vdpSprites=s->vdpSprites;}
 if((s->measured&RETRO_DEBUG_VRAM)&&s->vramFree<p->vramLowest)p->vramLowest=s->vramFree;
}
uint8_t retroDebugLinePerformance(char *line,const RetroDebugSample *s,const RetroDebugPeaks *p){
 Writer w={line,0,RETRO_DEBUG_LINE,0,0};
 if(!line)return 0;
 if(!s){line[0]=0;return 0;}
 begin(&w);text(&w,"CPU ");measured(&w,s,RETRO_DEBUG_CPU,s->cpu);if(s->measured&RETRO_DEBUG_CPU)put(&w,'%');if(!end(&w))return finish(&w);
 if(p&&(s->measured&RETRO_DEBUG_CPU)){begin(&w);text(&w," MAX ");number(&w,p->cpu);put(&w,'%');if(!end(&w))return finish(&w);}
 begin(&w);text(&w," FPS ");measured(&w,s,RETRO_DEBUG_FPS,s->fps);if(!end(&w))return finish(&w);
 begin(&w);text(&w," DMA ");measured(&w,s,RETRO_DEBUG_DMA,s->dmaQueue);
 if(s->measured&RETRO_DEBUG_DMA){put(&w,'/');number(&w,s->dmaBytes);put(&w,'B');}
 end(&w);return finish(&w);
}
uint8_t retroDebugLineMemory(char *line,const RetroDebugSample *s,const char *build){
 Writer w={line,0,RETRO_DEBUG_LINE,0,0};
 if(!line)return 0;
 if(!s){line[0]=0;return 0;}
 /* The build identifier comes first so it is never the part that gets cut. */
 if(build&&*build){begin(&w);put(&w,'#');text(&w,build);put(&w,' ');if(!end(&w))return finish(&w);}
 begin(&w);text(&w,"VRAM ");measured(&w,s,RETRO_DEBUG_VRAM,s->vramFree);
 if(s->measured&RETRO_DEBUG_VRAM){put(&w,'/');number(&w,s->vramTotal);}
 if(!end(&w))return finish(&w);
 if(s->measured&RETRO_DEBUG_VRAM){begin(&w);text(&w," BLK ");number(&w,s->vramLargest);if(!end(&w))return finish(&w);}
 /* vdpSprites is the engine's reserved maximum, not a count of sprites on screen. */
 begin(&w);text(&w," SPR ");measured(&w,s,RETRO_DEBUG_SPRITES,s->sprites);
 if(s->measured&RETRO_DEBUG_SPRITES){text(&w,"<=");number(&w,s->vdpSprites);}
 end(&w);return finish(&w);
}
uint8_t retroDebugLineSubject(char *line,const RetroDebugSubject *s){
 Writer w={line,0,RETRO_DEBUG_LINE,0,0};
 if(!line)return 0;
 if(!s){line[0]=0;return 0;}
 begin(&w);text(&w,"ST ");number(&w,s->state);if(!end(&w))return finish(&w);
 begin(&w);text(&w," AN ");number(&w,s->animation);put(&w,':');number(&w,s->frame);if(!end(&w))return finish(&w);
 begin(&w);text(&w," X ");signedNumber(&w,s->x);if(!end(&w))return finish(&w);
 begin(&w);text(&w," Y ");signedNumber(&w,s->y);end(&w);
 return finish(&w);
}
uint8_t retroDebugLineMotion(char *line,const RetroDebugSubject *s){
 Writer w={line,0,RETRO_DEBUG_LINE,0,0};
 if(!line)return 0;
 if(!s){line[0]=0;return 0;}
 begin(&w);text(&w,"VX ");fixed(&w,s->velocityX);if(!end(&w))return finish(&w);
 begin(&w);text(&w," VY ");fixed(&w,s->velocityY);if(!end(&w))return finish(&w);
 begin(&w);text(&w," CT ");hex(&w,s->contacts);end(&w);
 return finish(&w);
}
uint8_t retroDebugRecord(char *line,uint8_t size,const char *build,uint32_t frame,
 const RetroDebugSample *s,const RetroDebugSubject *subject){
 Writer w={line,0,size,0,0};
 if(!line||size<8)return 0;
 text(&w,"RSD1 b=");text(&w,build&&*build?build:"-");text(&w," f=");number(&w,frame);
 if(s){
  if(s->measured&RETRO_DEBUG_CPU){text(&w," cpu=");number(&w,s->cpu);}
  if(s->measured&RETRO_DEBUG_FPS){text(&w," fps=");number(&w,s->fps);}
  if(s->measured&RETRO_DEBUG_DMA){text(&w," dma=");number(&w,s->dmaQueue);put(&w,',');number(&w,s->dmaBytes);}
  if(s->measured&RETRO_DEBUG_VRAM){text(&w," vram=");number(&w,s->vramFree);put(&w,',');number(&w,s->vramLargest);put(&w,',');number(&w,s->vramTotal);}
  if(s->measured&RETRO_DEBUG_SPRITES){text(&w," spr=");number(&w,s->sprites);put(&w,',');number(&w,s->vdpSprites);}
 }
 if(subject){
  text(&w," st=");number(&w,subject->state);text(&w," an=");number(&w,subject->animation);put(&w,':');number(&w,subject->frame);
  text(&w," x=");signedNumber(&w,subject->x);text(&w," y=");signedNumber(&w,subject->y);
  text(&w," vx=");signedNumber(&w,subject->velocityX);text(&w," vy=");signedNumber(&w,subject->velocityY);
  text(&w," ct=");hex(&w,subject->contacts);
 }
 /* The terminator proves the record is complete; a record that does not fit is not sent. */
 text(&w," ;");
 if(w.full){line[0]=0;return 0;}
 return finish(&w);
}
#endif
