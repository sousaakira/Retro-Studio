#include "retro_scenery.h"
#define NONE 0xFFFFu
#define PENDING 0xFFFEu
static uint8_t power(uint16_t value){return value>=32&&value<=128&&!(value&(value-1));}
static uint16_t viewCells(uint16_t pixels){return (uint16_t)((pixels+7)/8+1);}
/* Lead and keep of one axis from the cells the plane has beyond what must be shown. */
static void spare(uint16_t extra,uint8_t *lead,uint8_t *keep){*lead=extra>=3;*keep=extra>=4?2:*lead;}
static uint8_t planes(const RetroSceneryLayer *layer){return layer->backCells?2:1;}
static const uint16_t *cellsOf(const RetroSceneryLayer *layer,uint8_t plane){return plane?layer->backCells:layer->cells;}
static const uint16_t *idsOf(const RetroSceneryLayer *layer,uint8_t plane){return plane?layer->backPatterns:layer->patterns;}
/* Pattern of the cell at `index` of a plane (RETRO_SCENERY_EMPTY: nothing drawn). */
static uint16_t patternAt(const RetroSceneryLayer *layer,uint8_t plane,uint32_t index){
 const uint16_t *ids=idsOf(layer,plane);
 return ids?ids[index]:(uint16_t)(cellsOf(layer,plane)[index]&RETRO_SCENERY_TILE_MASK);
}
uint8_t retroSceneryStreamInit(RetroSceneryStream *s,const RetroSceneryLayer *layer,
 uint16_t *slotOf,uint16_t *uses,uint16_t *freeSlots,uint16_t firstTile,uint16_t slotCount,
 uint16_t planeWidth,uint16_t planeHeight,uint16_t viewWidth,uint16_t viewHeight){
 uint16_t i,extraX,extraY;
 if(!s)return RETRO_SCENERY_INVALID;
 s->ready=0;
 if(!layer||!layer->cells||!layer->width||!layer->height||layer->width>1024||layer->height>1024||
  !layer->tileCount||layer->tileCount==RETRO_SCENERY_EMPTY||
  ((!layer->patterns||(layer->backCells&&!layer->backPatterns))&&layer->tileCount>RETRO_SCENERY_TILE_MASK+1u)||!slotOf||!uses||!freeSlots||!slotCount||
  (uint32_t)firstTile+slotCount>RETRO_SCENERY_TILE_MASK+1u||!power(planeWidth)||!power(planeHeight)||
  !viewWidth||!viewHeight||(viewWidth&7)||(viewHeight&7)||viewCells(viewWidth)>=planeWidth||viewCells(viewHeight)>=planeHeight)return RETRO_SCENERY_INVALID;
 s->layer=layer;s->slotOf=slotOf;s->uses=uses;s->freeSlots=freeSlots;s->firstTile=firstTile;s->slotCount=slotCount;
 s->planeWidth=planeWidth;s->planeHeight=planeHeight;s->viewWidth=viewWidth;s->viewHeight=viewHeight;
 /* The window must fit the plane: lead and keep shrink when the plane has no room. */
 extraX=(uint16_t)(planeWidth-viewCells(viewWidth));extraY=(uint16_t)(planeHeight-viewCells(viewHeight));
 spare(extraX,&s->leadX,&s->keepX);spare(extraY,&s->leadY,&s->keepY);
 for(i=0;i<layer->tileCount;i++)slotOf[i]=NONE;
 s->x0=s->x1=s->y0=s->y1=0;s->freeCount=slotCount;s->peak=0;s->partialPlanes=0;s->marginX=0;s->marginTop=s->marginBottom=0;
 s->leftX=s->rightX=s->leftY0=s->leftY1=s->rightY0=s->rightY1=0;s->ready=1;retroSceneryStreamReset(s);
 return RETRO_SCENERY_OK;
}
void retroSceneryStreamReset(RetroSceneryStream *s){
 uint16_t i;
 if(!s||!s->ready)return;
 /* Only patterns of the old window are loaded: clearing by slot would need the
  * reverse table, so walk the old window instead. */
 if(s->x1>s->x0&&s->y1>s->y0&&s->freeCount!=s->slotCount){
  int16_t x,y;uint8_t p;
  for(p=0;p<planes(s->layer);p++)for(y=s->y0;y<s->y1;y++)for(x=s->x0;x<s->x1;x++){
   uint16_t tile=patternAt(s->layer,p,(uint32_t)y*s->layer->width+(uint32_t)x);
   if(tile!=RETRO_SCENERY_EMPTY)s->slotOf[tile]=NONE;
  }
 }
 /* The margin parts (last plane, outside the window). */
 if(s->freeCount!=s->slotCount){
  int16_t x,y;uint8_t p=(uint8_t)(planes(s->layer)-1);
  for(y=s->leftY0;y<s->leftY1;y++)for(x=s->leftX;x<s->x0;x++){
   uint16_t tile=patternAt(s->layer,p,(uint32_t)y*s->layer->width+(uint32_t)x);
   if(tile!=RETRO_SCENERY_EMPTY)s->slotOf[tile]=NONE;
  }
  for(y=s->rightY0;y<s->rightY1;y++)for(x=s->x1;x<s->rightX;x++){
   uint16_t tile=patternAt(s->layer,p,(uint32_t)y*s->layer->width+(uint32_t)x);
   if(tile!=RETRO_SCENERY_EMPTY)s->slotOf[tile]=NONE;
  }
 }
 /* And the planes already sent of a line that was not finished. */
 if(s->partialPlanes&&s->freeCount!=s->slotCount){
  int16_t cell;uint8_t p;
  for(p=0;p<s->partialPlanes;p++)for(cell=s->partialFrom;cell<s->partialTo;cell++){
   uint16_t tile=patternAt(s->layer,p,s->partialVertical?(uint32_t)cell*s->layer->width+(uint32_t)s->partialAt:(uint32_t)s->partialAt*s->layer->width+(uint32_t)cell);
   if(tile!=RETRO_SCENERY_EMPTY)s->slotOf[tile]=NONE;
  }
 }
 s->partialPlanes=0;
 for(i=0;i<s->slotCount;i++){s->uses[i]=0;s->freeSlots[i]=(uint16_t)(s->slotCount-1-i);}
 s->freeCount=s->slotCount;s->x0=s->x1=s->y0=s->y1=0;s->built=0;s->cameraX=s->cameraY=0;
 s->leftX=s->rightX=s->leftY0=s->leftY1=s->rightY0=s->rightY1=0;
}
void retroSceneryStreamWindow(const RetroSceneryStream *s,uint16_t *width,uint16_t *height){
 uint16_t w=0,h=0;
 if(s&&s->ready){
  /* Screen, what is kept behind, the lead and the one-cell step being drawn. */
  w=(uint16_t)(viewCells(s->viewWidth)+s->keepX+s->leadX+1);h=(uint16_t)(viewCells(s->viewHeight)+s->keepY+s->leadY+1);
  if(w>s->layer->width)w=s->layer->width;
  if(h>s->layer->height)h=s->layer->height;
 }
 if(width)*width=w;
 if(height)*height=h;
}
RetroSceneryBudget retroSceneryStreamMinimumBudget(const RetroSceneryStream *s){
 RetroSceneryBudget budget={0,0};uint16_t w,h,longest;
 if(!s||!s->ready)return budget;
 retroSceneryStreamWindow(s,&w,&h);longest=w>h?w:h;
 /* One plane of a line, every cell new: its word plus its pattern; two name-table segments
  * when the plane wraps. The planes of a line may go in different calls. */
 budget.bytes=(uint16_t)(longest*(2u+RETRO_SCENERY_PATTERN_BYTES));budget.entries=(uint16_t)(longest+2u);
 return budget;
}
typedef struct {RetroSceneryStream *s;const RetroSceneryBudget *budget;const RetroScenerySink *sink;RetroSceneryResult *result;} Work;
/* One row (vertical 0: cells from..to at line `at`) or column (vertical 1) of plane p. 1 = drawn. */
static uint8_t add(Work *w,uint8_t p,uint8_t vertical,int16_t at,int16_t from,int16_t to){
 RetroSceneryStream *s=w->s;const RetroSceneryLayer *layer=s->layer;RetroSceneryResult *r=w->result;
 uint16_t count=(uint16_t)(to-from),fresh=0,i,step=vertical?layer->width:1,plane=vertical?s->planeHeight:s->planeWidth;
 uint16_t start=(uint16_t)from&(plane-1),first=plane-start<count?(uint16_t)(plane-start):count,bytes,entries;
 uint32_t origin=vertical?(uint32_t)from*layer->width+(uint32_t)at:(uint32_t)at*layer->width+(uint32_t)from,index;
 const uint16_t *cells=cellsOf(layer,p);
 uint16_t *out,*second=0;
 if(!count)return 1;
 for(i=0,index=origin;i<count;i++,index+=step){
  uint16_t tile=patternAt(layer,p,index);
  if(tile==RETRO_SCENERY_EMPTY)continue;
  if(tile>=layer->tileCount){r->status=RETRO_SCENERY_INVALID;goto undo;}
  if(s->slotOf[tile]==NONE){s->slotOf[tile]=PENDING;fresh++;}
 }
 bytes=(uint16_t)(count*2u+fresh*RETRO_SCENERY_PATTERN_BYTES);entries=(uint16_t)(fresh+(first<count?2u:1u));
 if(fresh>s->freeCount){r->status=RETRO_SCENERY_CAPACITY;goto undo;}
 if((uint32_t)r->bytes+bytes>w->budget->bytes||(uint32_t)r->entries+entries>w->budget->entries)goto undo;
 out=vertical?w->sink->cells(w->sink->context,p,(uint16_t)at&(s->planeWidth-1),start,first,1)
  :w->sink->cells(w->sink->context,p,start,(uint16_t)at&(s->planeHeight-1),first,0);
 if(out&&first<count)second=vertical?w->sink->cells(w->sink->context,p,(uint16_t)at&(s->planeWidth-1),0,(uint16_t)(count-first),1)
  :w->sink->cells(w->sink->context,p,0,(uint16_t)at&(s->planeHeight-1),(uint16_t)(count-first),0);
 if(!out||(first<count&&!second)){r->status=RETRO_SCENERY_SINK;s->ready=0;goto undo;}
 for(i=0,index=origin;i<count;i++,index+=step){
  uint16_t tile=patternAt(layer,p,index),slot;
  if(i==first)out=second;
  /* Empty: VRAM tile 0 (blank), attributes kept. */
  if(tile==RETRO_SCENERY_EMPTY){*out++=(uint16_t)(cells[index]&~RETRO_SCENERY_TILE_MASK);continue;}
  slot=s->slotOf[tile];
  if(slot==PENDING){
   slot=s->freeSlots[--s->freeCount];s->slotOf[tile]=slot;
   if(!w->sink->pattern(w->sink->context,tile,(uint16_t)(s->firstTile+slot))){r->status=RETRO_SCENERY_SINK;s->ready=0;return 0;}
  }
  s->uses[slot]++;
  *out++=(uint16_t)((cells[index]&~RETRO_SCENERY_TILE_MASK)|(s->firstTile+slot));
 }
 if((uint16_t)(s->slotCount-s->freeCount)>s->peak)s->peak=(uint16_t)(s->slotCount-s->freeCount);
 r->bytes=(uint16_t)(r->bytes+bytes);r->entries=(uint16_t)(r->entries+entries);r->patterns=(uint16_t)(r->patterns+fresh);r->cells=(uint16_t)(r->cells+count);
 return 1;
undo:
 for(i=0,index=origin;i<count;i++,index+=step){
  uint16_t tile=patternAt(layer,p,index);
  if(tile!=RETRO_SCENERY_EMPTY&&tile<layer->tileCount&&s->slotOf[tile]==PENDING)s->slotOf[tile]=NONE;
 }
 return 0;
}
/* Releases the patterns of one line of plane p. Leaving the window costs no transfer: the
 * cells stay in the plane, off screen. */
static void dropPlane(RetroSceneryStream *s,uint8_t p,uint8_t vertical,int16_t at,int16_t from,int16_t to){
 const RetroSceneryLayer *layer=s->layer;uint16_t step=vertical?layer->width:1;
 uint32_t index=vertical?(uint32_t)from*layer->width+(uint32_t)at:(uint32_t)at*layer->width+(uint32_t)from;
 for(;from<to;from++,index+=step){
  uint16_t tile=patternAt(layer,p,index),slot;
  if(tile==RETRO_SCENERY_EMPTY)continue;
  slot=s->slotOf[tile];
  if(!--s->uses[slot]){s->freeSlots[s->freeCount++]=slot;s->slotOf[tile]=NONE;}
 }
}
static void drop(RetroSceneryStream *s,uint8_t vertical,int16_t at,int16_t from,int16_t to){
 uint8_t p;
 for(p=0;p<planes(s->layer);p++)dropPlane(s,p,vertical,at,from,to);
}
/* Forgets a line drawn on some planes only (the camera went elsewhere). */
static void forgetPartial(RetroSceneryStream *s){
 uint8_t p;
 for(p=0;p<s->partialPlanes;p++)dropPlane(s,p,s->partialVertical,s->partialAt,s->partialFrom,s->partialTo);
 s->partialPlanes=0;
}
/* Draws a line on every plane, one plane per step: a plane that does not fit the budget
 * waits for the next call with the planes already sent. 1 = the whole line is drawn. */
static uint8_t line(Work *w,uint8_t vertical,int16_t at,int16_t from,int16_t to){
 RetroSceneryStream *s=w->s;uint8_t p=0;
 if(s->partialPlanes){
  if(s->partialVertical==vertical&&s->partialAt==at&&s->partialFrom==from&&s->partialTo==to)p=s->partialPlanes;
  else forgetPartial(s);
 }
 for(;p<planes(s->layer);p++){
  if(!add(w,p,vertical,at,from,to)){
   if(p&&s->ready){s->partialVertical=vertical;s->partialAt=at;s->partialFrom=from;s->partialTo=to;s->partialPlanes=p;}
   return 0;
  }
 }
 s->partialPlanes=0;
 return 1;
}
/* ---- Margin (version 3): last plane, rows [marginTop,marginBottom), outside the window. ----
 * The left part holds columns [leftX,x0) and rows [leftY0,leftY1), the right part columns
 * [x1,rightX) and rows [rightY0,rightY1); their rows are always inside the window rows. A
 * column that enters the window is counted by the window and leaves the margin; one that
 * leaves the window stays drawn and is counted by the margin (no transfer either way). */
static uint8_t marginPlane(const RetroSceneryStream *s){return (uint8_t)(planes(s->layer)-1);}
/* Counts again cells already drawn (their patterns are loaded). */
static void adopt(RetroSceneryStream *s,uint8_t vertical,int16_t at,int16_t from,int16_t to){
 const RetroSceneryLayer *layer=s->layer;uint16_t step=vertical?layer->width:1;uint8_t p=marginPlane(s);
 uint32_t index=vertical?(uint32_t)from*layer->width+(uint32_t)at:(uint32_t)at*layer->width+(uint32_t)from;
 for(;from<to;from++,index+=step){
  uint16_t tile=patternAt(layer,p,index);
  if(tile!=RETRO_SCENERY_EMPTY)s->uses[s->slotOf[tile]]++;
 }
}
/* Column c was just drawn by the window: it is no longer part of the margin. */
static void windowGained(RetroSceneryStream *s,int16_t c){
 if(!s->marginX)return;
 if(c>=s->x1&&c<s->rightX)dropPlane(s,marginPlane(s),1,c,s->rightY0,s->rightY1);
 if(c<s->x0&&c>=s->leftX)dropPlane(s,marginPlane(s),1,c,s->leftY0,s->leftY1);
}
static void tidy(RetroSceneryStream *s){
 if(s->rightX<s->x1)s->rightX=s->x1;
 if(s->leftX>s->x0)s->leftX=s->x0;
}
/* Column c is leaving the window (left or right edge): the margin keeps its rows. */
static void windowLosing(RetroSceneryStream *s,int16_t c,uint8_t left){
 if(!s->marginX)return;
 if(left)adopt(s,1,c,s->leftY0,s->leftY1);
 else adopt(s,1,c,s->rightY0,s->rightY1);
}
/* Row r is leaving the window: the margin lets it go first. */
static void rowLosing(RetroSceneryStream *s,int16_t r){
 uint8_t p=marginPlane(s);
 if(!s->marginX)return;
 if(r>=s->leftY0&&r<s->leftY1){dropPlane(s,p,0,r,s->leftX,s->x0);if(r==s->leftY0)s->leftY0++;else s->leftY1--;}
 if(r>=s->rightY0&&r<s->rightY1){dropPlane(s,p,0,r,s->x1,s->rightX);if(r==s->rightY0)s->rightY0++;else s->rightY1--;}
}
typedef struct {int16_t x0,x1,y0,y1;} Span;
static Span marginTarget(const RetroSceneryStream *s,int16_t vx0,int16_t vx1,int16_t vy0,int16_t vy1){
 Span t;int16_t m=(int16_t)s->marginX,width=(int16_t)s->layer->width;
 t.x0=(int16_t)(vx0-m<0?0:vx0-m);t.x1=(int16_t)(vx1+m>width?width:vx1+m);
 t.y0=vy0>s->marginTop?vy0:s->marginTop;t.y1=vy1<s->marginBottom?vy1:s->marginBottom;
 if(t.y0>t.y1)t.y1=t.y0;
 return t;
}
static int16_t clampCamera(int16_t value,uint16_t cells,uint16_t view){
 int32_t maximum=(int32_t)cells*8-view;
 if(maximum<0)maximum=0;
 if(value<0)return 0;
 return value>maximum?(int16_t)maximum:value;
}
static int16_t low(int16_t value,int16_t minimum){return value<minimum?minimum:value;}
static int16_t high(int16_t value,int16_t maximum){return value>maximum?maximum:value;}
typedef struct {int16_t vx0,vx1,vy0,vy1,tx0,tx1,ty0,ty1;} Frame;
static Frame frame(const RetroSceneryStream *s,int16_t x,int16_t y){
 Frame f;int16_t width=(int16_t)s->layer->width,height=(int16_t)s->layer->height;
 f.vx0=x>>3;f.vx1=high((int16_t)((x+s->viewWidth+7)>>3),width);
 f.vy0=y>>3;f.vy1=high((int16_t)((y+s->viewHeight+7)>>3),height);
 f.tx0=low((int16_t)(f.vx0-s->leadX),0);f.tx1=high((int16_t)(f.vx1+s->leadX),width);
 f.ty0=low((int16_t)(f.vy0-s->leadY),0);f.ty1=high((int16_t)(f.vy1+s->leadY),height);
 return f;
}
/* Draws the margin the screen of frame f needs (the window already covers the screen). */
static uint8_t coverMargin(Work *w,const Frame *f){
 RetroSceneryStream *s=w->s;uint8_t p=marginPlane(s);Span t=marginTarget(s,f->vx0,f->vx1,f->vy0,f->vy1);
 /* Columns first: with no rows yet they cost nothing; then the rows, a segment each. */
 while(s->leftX>t.x0){if(s->leftY0<s->leftY1&&!add(w,p,1,(int16_t)(s->leftX-1),s->leftY0,s->leftY1))return 0;s->leftX--;}
 while(s->rightX<t.x1){if(s->rightY0<s->rightY1&&!add(w,p,1,s->rightX,s->rightY0,s->rightY1))return 0;s->rightX++;}
 if(t.y0<t.y1){
  if(s->leftY0==s->leftY1)s->leftY0=s->leftY1=t.y0;
  if(s->rightY0==s->rightY1)s->rightY0=s->rightY1=t.y0;
  while(s->leftY0>t.y0){if(!add(w,p,0,(int16_t)(s->leftY0-1),s->leftX,s->x0))return 0;s->leftY0--;}
  while(s->leftY1<t.y1){if(!add(w,p,0,s->leftY1,s->leftX,s->x0))return 0;s->leftY1++;}
  while(s->rightY0>t.y0){if(!add(w,p,0,(int16_t)(s->rightY0-1),s->x1,s->rightX))return 0;s->rightY0--;}
  while(s->rightY1<t.y1){if(!add(w,p,0,s->rightY1,s->x1,s->rightX))return 0;s->rightY1++;}
 }
 return 1;
}
/* Releases the margin beyond what the screen of frame f needs, keeping keepX/keepY behind. */
static void shrinkMargin(RetroSceneryStream *s,const Frame *f){
 uint8_t p=marginPlane(s);Span t=marginTarget(s,f->vx0,f->vx1,f->vy0,f->vy1);
 int16_t top=(int16_t)(t.y0-s->keepY),bottom=(int16_t)(t.y1+s->keepY);
 if(t.y0==t.y1)top=bottom=t.y0; /* no row of the margin on screen: release them all */
 while(s->leftX<t.x0-s->keepX&&s->leftX<s->x0){dropPlane(s,p,1,s->leftX,s->leftY0,s->leftY1);s->leftX++;}
 while(s->rightX>t.x1+s->keepX&&s->rightX>s->x1){s->rightX--;dropPlane(s,p,1,s->rightX,s->rightY0,s->rightY1);}
 while(s->leftY0<s->leftY1&&s->leftY0<top){dropPlane(s,p,0,s->leftY0,s->leftX,s->x0);s->leftY0++;}
 while(s->leftY1>s->leftY0&&s->leftY1>bottom){s->leftY1--;dropPlane(s,p,0,s->leftY1,s->leftX,s->x0);}
 while(s->rightY0<s->rightY1&&s->rightY0<top){dropPlane(s,p,0,s->rightY0,s->x1,s->rightX);s->rightY0++;}
 while(s->rightY1>s->rightY0&&s->rightY1>bottom){s->rightY1--;dropPlane(s,p,0,s->rightY1,s->x1,s->rightX);}
}
/* Grows the window to the frame. level 0: only what the screen shows; 1: the lead too. */
static uint8_t cover(Work *w,const Frame *f,uint8_t lead){
 RetroSceneryStream *s=w->s;uint8_t moving=1;
 int16_t x0=lead?f->tx0:f->vx0,x1=lead?f->tx1:f->vx1,y0=lead?f->ty0:f->vy0,y1=lead?f->ty1:f->vy1;
 while(moving){
  moving=0;
  if(s->x1<x1){if(!line(w,1,s->x1,s->y0,s->y1))return 0;windowGained(s,s->x1);s->x1++;tidy(s);moving=1;}
  if(s->x0>x0){if(!line(w,1,(int16_t)(s->x0-1),s->y0,s->y1))return 0;windowGained(s,(int16_t)(s->x0-1));s->x0--;tidy(s);moving=1;}
  if(s->y1<y1){if(!line(w,0,s->y1,s->x0,s->x1))return 0;s->y1++;moving=1;}
  if(s->y0>y0){if(!line(w,0,(int16_t)(s->y0-1),s->x0,s->x1))return 0;s->y0--;moving=1;}
 }
 return !s->marginX||coverMargin(w,f);
}
static int16_t toward(int16_t from,int16_t to){
 if(to>from)return (int16_t)(to-from>8?from+8:to);
 return (int16_t)(from-to>8?from-8:to);
}
RetroSceneryResult retroSceneryStreamAdvance(RetroSceneryStream *s,int16_t cameraX,int16_t cameraY,
 const RetroSceneryBudget *budget,const RetroScenerySink *sink){
 RetroSceneryResult r={0,0,0,0,0,0,RETRO_SCENERY_INVALID,0};Work w;Frame f;
 if(!s||!s->ready||!budget||!sink||!sink->cells||!sink->pattern)return r;
 r.status=RETRO_SCENERY_OK;w.s=s;w.budget=budget;w.sink=sink;w.result=&r;
 cameraX=clampCamera(cameraX,s->layer->width,s->viewWidth);cameraY=clampCamera(cameraY,s->layer->height,s->viewHeight);
 if(s->built){
  f=frame(s,cameraX,cameraY);
  /* The camera left what is drawn: nothing can be reused. */
  if(f.tx0>=s->x1||f.tx1<=s->x0||f.ty0>=s->y1||f.ty1<=s->y0)retroSceneryStreamReset(s);
 }
 if(!s->built){
  /* Building from nothing (first frame, room change, jump): the caller keeps the
   * display hidden and calls until `complete`. The anchor does not move meanwhile. */
  if(s->x1==s->x0||s->y1==s->y0){s->cameraX=cameraX;s->cameraY=cameraY;f=frame(s,cameraX,cameraY);s->x0=s->x1=f.tx0;s->y0=f.ty0;s->y1=f.ty1;
   s->leftX=s->rightX=s->x0;s->leftY0=s->leftY1=s->rightY0=s->rightY1=s->y0;}
  f=frame(s,s->cameraX,s->cameraY);
  if(cover(&w,&f,1))s->built=1;
  r.x=s->cameraX;r.y=s->cameraY;r.complete=s->built&&s->cameraX==cameraX&&s->cameraY==cameraY;
  return r;
 }
 /* One cell at a time: draw what the next position shows, move, then release
  * what is behind. A row or column that does not fit the budget stops the camera. */
 while(r.status==RETRO_SCENERY_OK&&(s->cameraX!=cameraX||s->cameraY!=cameraY)){
  int16_t nextX=toward(s->cameraX,cameraX),nextY=toward(s->cameraY,cameraY);
  f=frame(s,nextX,nextY);
  if(!cover(&w,&f,0))break;
  s->cameraX=nextX;s->cameraY=nextY;
  while(s->x0<f.vx0-s->keepX){windowLosing(s,s->x0,1);drop(s,1,s->x0,s->y0,s->y1);s->x0++;}
  while(s->x1>f.vx1+s->keepX){s->x1--;windowLosing(s,s->x1,0);drop(s,1,s->x1,s->y0,s->y1);}
  while(s->y0<f.vy0-s->keepY){rowLosing(s,s->y0);drop(s,0,s->y0,s->x0,s->x1);s->y0++;}
  while(s->y1>f.vy1+s->keepY){s->y1--;rowLosing(s,s->y1);drop(s,0,s->y1,s->x0,s->x1);}
  if(s->marginX)shrinkMargin(s,&f);
 }
 if(r.status==RETRO_SCENERY_OK){
  /* Spare budget draws the lead, so the next movement finds its cells ready. */
  f=frame(s,s->cameraX,s->cameraY);
  r.complete=cover(&w,&f,1)&&s->cameraX==cameraX&&s->cameraY==cameraY;
 }
 r.x=s->cameraX;r.y=s->cameraY;
 return r;
}
int16_t retroSceneryPanoramaScroll(int16_t camera,uint16_t factor){
 return (int16_t)(((int32_t)camera*factor)>>8);
}
uint8_t retroSceneryStreamSetMargin(RetroSceneryStream *s,uint8_t cells,uint16_t firstRow,uint16_t endRow){
 if(!s||!s->ready)return RETRO_SCENERY_INVALID;
 /* Screen, both margins, what each side keeps behind and the column being drawn share the
  * plane's columns. */
 if(cells&&((uint32_t)viewCells(s->viewWidth)+2u*(cells+s->keepX)+1u>s->planeWidth||firstRow>=endRow||endRow>s->layer->height))return RETRO_SCENERY_INVALID;
 retroSceneryStreamReset(s);
 s->marginX=cells;s->marginTop=cells?(int16_t)firstRow:0;s->marginBottom=cells?(int16_t)endRow:0;
 return RETRO_SCENERY_OK;
}
uint8_t retroSceneryDriftMargin(uint16_t period){return period>1?(uint8_t)((period+6u)/8u):0;}
static uint32_t cycle(const RetroSceneryDrift *d,uint8_t hz){return (uint32_t)d->period*256u*hz;}
RetroSceneryDriftPhase retroSceneryDriftAdvance(const RetroSceneryDrift *d,RetroSceneryDriftPhase phase,uint16_t frames,uint8_t hz){
 uint32_t length,speed;
 if(!d||!d->period||d->period>RETRO_SCENERY_DRIFT_MAX_PERIOD||(hz!=50&&hz!=60))return 0;
 length=cycle(d,hz);speed=(uint32_t)(d->speed<0?-(int32_t)d->speed:d->speed);
 /* One frame adds speed/hz pixels: speed (8.8) in units of 1/(256*hz) pixel. */
 return (phase%length+(uint32_t)frames*speed%length)%length;
}
int16_t retroSceneryDriftShift(const RetroSceneryDrift *d,RetroSceneryDriftPhase phase,uint8_t hz,int16_t cameraX){
 uint16_t shift;
 if(!d||!d->period||d->period>RETRO_SCENERY_DRIFT_MAX_PERIOD||(hz!=50&&hz!=60))return 0;
 shift=(uint16_t)(phase%cycle(d,hz)/(256u*hz));
 /* Moving left is the same picture as moving right by the rest of the period. */
 if(d->speed<0&&shift)shift=(uint16_t)(d->period-shift);
 return cameraX>=(int16_t)shift?(int16_t)shift:(int16_t)(shift-d->period);
}
void retroSceneryLineScroll(int16_t *map,int16_t *back,uint16_t lines,int16_t cameraX,int16_t cameraY,
 const RetroSceneryDrift *drifts,const int16_t *shifts,uint16_t count){
 uint16_t line;int16_t base=(int16_t)-cameraX;
 /* Plain fills, then the visible run of each band: searching the bands on every line cost
  * half a frame on the 68000 and dropped the game to 30 fps. */
 if(map)for(line=0;line<lines;line++)map[line]=base;
 if(!back)return;
 for(line=0;line<lines;line++)back[line]=base;
 /* Last band first, so where bands overlap the first one wins. */
 while(count--){
  int32_t top=(int32_t)drifts[count].top-cameraY,bottom=(int32_t)drifts[count].bottom-cameraY;
  int16_t value=(int16_t)(base+shifts[count]);
  if(top<0)top=0;
  if(bottom>(int32_t)lines)bottom=lines;
  if(top<bottom)for(line=(uint16_t)top;line<(uint16_t)bottom;line++)back[line]=value;
 }
}
