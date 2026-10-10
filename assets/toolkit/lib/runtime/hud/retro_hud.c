#include "retro_hud.h"
static uint16_t area(const RetroHudRegion *region){return (uint16_t)(region->width*region->height);}
static void fill(uint8_t *cells,uint16_t count,uint8_t value){uint16_t i;for(i=0;i<count;i++)cells[i]=value;}
static uint8_t textValid(const RetroHudDefinition *d,const RetroHudText *text){
 uint8_t i;
 if(text->length&&!text->glyphs)return 0;
 for(i=0;i<text->length;i++)if(text->glyphs[i]>=d->glyphCount)return 0;
 return 1;
}
static uint8_t valid(const RetroHudDefinition *d){
 uint16_t i,k;
 if(!d||!d->glyphs||!d->glyphCount||d->glyphCount>96||d->space>=d->glyphCount||(d->elementCount&&!d->elements)||(d->menuCount&&!d->menus)||d->elementCount>RETRO_HUD_MAX_ELEMENTS)return 0;
 for(i=0;i<d->glyphCount;i++)if(d->glyphs[i].glyph>=d->glyphCount||(i&&d->glyphs[i].point<=d->glyphs[i-1].point))return 0;
 for(i=0;i<d->elementCount;i++){
  const RetroHudElement *e=&d->elements[i];
  if(e->type>RETRO_HUD_ICONS||!e->width||e->width>40||e->first>=d->glyphCount||e->second>=d->glyphCount)return 0;
  if(e->type==RETRO_HUD_TEXT){if(!e->text)return 0;for(k=0;k<e->width;k++)if(e->text[k]>=d->glyphCount)return 0;}
  else if(e->value>=d->valueCount||(e->type==RETRO_HUD_NUMBER&&e->width>8)||(e->type!=RETRO_HUD_NUMBER&&!e->maximum))return 0;
  if(!e->sprite&&(e->x<0||e->y<0||e->x+e->width>d->hud.width||e->y>=d->hud.height))return 0;
 }
 for(i=0;i<d->menuCount;i++){
  const RetroHudMenu *m=&d->menus[i];uint8_t rows=(uint8_t)(m->itemCount+(m->title.length?2:0));
  if(!m->itemCount||!m->items||m->cursor>=d->glyphCount||!textValid(d,&m->title)||m->title.length>m->width||
   m->col+m->width>d->overlay.width||m->row+rows>d->overlay.height)return 0;
  for(k=0;k<m->itemCount;k++)if(!textValid(d,&m->items[k])||m->items[k].length+2>m->width)return 0;
 }
 if(d->dialogue.enabled&&(!d->dialogue.lines||d->dialogue.width<4||d->dialogue.cursor>=d->glyphCount||d->dialogue.col+d->dialogue.width>d->overlay.width||
  d->dialogue.row+d->dialogue.lines+(d->dialogue.speaker?1:0)>d->overlay.height))return 0;
 return 1;
}
uint8_t retroHudInit(RetroHud *hud,const RetroHudDefinition *d,const RetroHudHost *host,uint8_t *cells,uint8_t *overlayCells){
 static const RetroHudHost none={0,0,0,0};
 if(!hud)return 0;
 hud->ready=0;
 if(!valid(d)||(area(&d->hud)&&!cells)||(area(&d->overlay)&&!overlayCells))return 0;
 hud->definition=d;hud->host=host?*host:none;
 hud->want=cells;hud->shown=cells?cells+area(&d->hud):0;
 hud->overlayWant=overlayCells;hud->overlayShown=overlayCells?overlayCells+area(&d->overlay):0;
 hud->cursorHud=hud->cursorOverlay=0;hud->overlay=RETRO_HUD_NONE;hud->menu=hud->item=hud->closing=0;hud->overlayRow=hud->overlayRows=0;
 if(cells){fill(hud->want,area(&d->hud),RETRO_HUD_CLEAR);fill(hud->shown,area(&d->hud),RETRO_HUD_UNKNOWN);}
 /* Nothing of the overlay is on screen yet: there is nothing to erase. */
 if(overlayCells){fill(hud->overlayWant,area(&d->overlay),RETRO_HUD_CLEAR);fill(hud->overlayShown,area(&d->overlay),RETRO_HUD_CLEAR);}
 {uint16_t low,high;uint8_t digit;
  for(digit=0;digit<10;digit++){
   hud->digits[digit]=d->space;low=0;high=d->glyphCount;
   while(low<high){uint16_t middle=(uint16_t)((low+high)/2);if(d->glyphs[middle].point<(uint16_t)('0'+digit))low=(uint16_t)(middle+1);else high=middle;}
   if(low<d->glyphCount&&d->glyphs[low].point==(uint16_t)('0'+digit))hud->digits[digit]=d->glyphs[low].glyph;
  }}
 hud->dirtyHud=1;hud->dirtyOverlay=0;hud->changed=0;hud->fresh=1;
 hud->ready=1;retroHudTick(hud);
 return 1;
}
void retroHudElementGlyphs(const RetroHud *hud,uint16_t index,uint8_t *out){
 const RetroHudElement *e;uint32_t value,limit;uint8_t i;
 if(!hud||!hud->ready||!out||index>=hud->definition->elementCount)return;
 e=&hud->definition->elements[index];
 if(e->type==RETRO_HUD_TEXT){for(i=0;i<e->width;i++)out[i]=e->text[i];return;}
 value=hud->lastValue[index];
 if(e->type==RETRO_HUD_NUMBER){
  /* A value too large for the field shows all 9s, never a cut number. */
  const uint8_t *digits=hud->digits;
  limit=1;for(i=0;i<e->width;i++)limit*=10;
  if(value>=limit)value=limit-1;
  for(i=e->width;i>0;i--){out[i-1]=(value||i==e->width)?digits[value%10]:e->first;value/=10;}
  return;
 }
 if(e->type==RETRO_HUD_BAR){
  /* Any value above zero shows at least one cell; only the maximum fills the bar. */
  uint32_t filled;
  if(value>e->maximum)value=e->maximum;
  filled=(value*e->width)/e->maximum;
  if(value&&!filled)filled=1;
  if(value<e->maximum&&filled>=e->width)filled=(uint32_t)(e->width-1);
  for(i=0;i<e->width;i++)out[i]=i<filled?e->first:e->second;
  return;
 }
 if(value>e->width)value=e->width;
 for(i=0;i<e->width;i++)out[i]=i<value?e->first:e->second;
}
void retroHudTick(RetroHud *hud){
 const RetroHudDefinition *d;uint16_t i;uint8_t glyphs[40],k;
 if(!hud||!hud->ready)return;
 d=hud->definition;
 for(i=0;i<d->elementCount;i++){
  const RetroHudElement *e=&d->elements[i];
  if(e->type!=RETRO_HUD_TEXT){
   uint32_t value=hud->host.value?hud->host.value(hud->host.context,e->value):0;
   if(!hud->fresh&&value==hud->lastValue[i])continue;
   hud->lastValue[i]=value;
  }else if(!hud->fresh)continue;
  hud->changed|=(uint32_t)1<<i;
  if(e->sprite||!hud->want)continue;
  retroHudElementGlyphs(hud,i,glyphs);
  for(k=0;k<e->width;k++)hud->want[e->y*d->hud.width+e->x+k]=glyphs[k];
  hud->dirtyHud=1;
 }
 hud->fresh=0;
}
void retroHudAssumeClear(RetroHud *hud){
 uint16_t i,count;
 if(!hud||!hud->ready||!hud->shown)return;
 count=area(&hud->definition->hud);
 for(i=0;i<count;i++)if(hud->want[i]==RETRO_HUD_CLEAR)hud->shown[i]=RETRO_HUD_CLEAR;
}
static uint8_t glyphOf(const RetroHudDefinition *d,uint16_t point){
 uint16_t low=0,high=d->glyphCount;
 while(low<high){uint16_t middle=(uint16_t)((low+high)/2);if(d->glyphs[middle].point<point)low=(uint16_t)(middle+1);else high=middle;}
 if(low<d->glyphCount&&d->glyphs[low].point==point)return d->glyphs[low].glyph;
 return point=='?'?d->space:glyphOf(d,'?');
}
/* Writes UTF-8 text into a row of the overlay; stops at the width. Malformed bytes show as '?'. */
static void put(RetroHud *hud,uint8_t col,uint8_t row,uint8_t width,const char *text){
 const RetroHudDefinition *d=hud->definition;const uint8_t *s=(const uint8_t*)text;uint8_t *out=hud->overlayWant+row*d->overlay.width+col,count=0;
 while(s&&*s&&count<width){
  uint16_t point=*s++;uint8_t extra=0;
  if(point>=0xF0){point='?';extra=3;}
  else if(point>=0xE0){point&=0x0F;extra=2;}
  else if(point>=0xC0){point&=0x1F;extra=1;}
  else if(point>=0x80)point='?';
  if(extra==3){while(extra&&(*s&0xC0)==0x80){s++;extra--;}}
  else while(extra){if((*s&0xC0)!=0x80){point='?';break;}point=(uint16_t)((point<<6)|(*s++&0x3F));extra--;}
  out[count++]=glyphOf(d,point);
 }
 while(count<width)out[count++]=d->space;
}
static void glyphs(RetroHud *hud,uint8_t col,uint8_t row,uint8_t width,const RetroHudText *text){
 uint8_t *out=hud->overlayWant+row*hud->definition->overlay.width+col,i;
 for(i=0;i<width;i++)out[i]=i<text->length?text->glyphs[i]:hud->definition->space;
}
static void erase(RetroHud *hud){fill(hud->overlayWant,area(&hud->definition->overlay),RETRO_HUD_CLEAR);hud->dirtyOverlay=1;}
static void drawMenu(RetroHud *hud){
 const RetroHudDefinition *d=hud->definition;const RetroHudMenu *m=&d->menus[hud->menu];uint8_t row=m->row,i;RetroHudText blank={0,0};
 erase(hud);
 if(m->title.length){glyphs(hud,m->col,row,m->width,&m->title);glyphs(hud,m->col,(uint8_t)(row+1),m->width,&blank);row=(uint8_t)(row+2);}
 for(i=0;i<m->itemCount;i++){
  uint8_t *line=hud->overlayWant+(row+i)*d->overlay.width+m->col;
  line[0]=i==hud->item?m->cursor:d->space;line[1]=d->space;
  glyphs(hud,(uint8_t)(m->col+2),(uint8_t)(row+i),(uint8_t)(m->width-2),&m->items[i]);
 }
}
uint8_t retroHudMenuOpen(RetroHud *hud,uint16_t menu){
 if(!hud||!hud->ready||!hud->overlayWant||menu>=hud->definition->menuCount)return 0;
 hud->overlay=RETRO_HUD_MENU;hud->menu=(uint8_t)menu;hud->item=0;hud->closing=0;drawMenu(hud);
 hud->overlayRow=(uint8_t)(hud->definition->overlay.row+hud->definition->menus[menu].row);
 hud->overlayRows=(uint8_t)(hud->definition->menus[menu].itemCount+(hud->definition->menus[menu].title.length?2:0));
 return 1;
}
void retroHudMenuInput(RetroHud *hud,uint8_t pressed){
 const RetroHudMenu *m;
 if(!hud||!hud->ready||hud->overlay!=RETRO_HUD_MENU)return;
 m=&hud->definition->menus[hud->menu];
 if(pressed&RETRO_HUD_UP)hud->item=hud->item?(uint8_t)(hud->item-1):(uint8_t)(m->itemCount-1);
 else if(pressed&RETRO_HUD_DOWN)hud->item=(uint8_t)(hud->item+1<m->itemCount?hud->item+1:0);
 if(pressed&(RETRO_HUD_UP|RETRO_HUD_DOWN))drawMenu(hud);
 /* The callback may close this menu or open another: nothing of `m` is used after it. */
 if(pressed&RETRO_HUD_CONFIRM){if(hud->host.select)hud->host.select(hud->host.context,hud->menu,hud->item);}
 else if(pressed&RETRO_HUD_CANCEL){if(hud->host.cancel)hud->host.cancel(hud->host.context,hud->menu);}
}
static uint8_t box(RetroHud *hud){
 if(!hud||!hud->ready||!hud->overlayWant||!hud->definition->dialogue.enabled)return 0;
 hud->overlay=RETRO_HUD_DIALOGUE;hud->closing=0;erase(hud);
 hud->overlayRow=(uint8_t)(hud->definition->overlay.row+hud->definition->dialogue.row);
 hud->overlayRows=(uint8_t)(hud->definition->dialogue.lines+(hud->definition->dialogue.speaker?1:0));
 return 1;
}
uint8_t retroHudDialogueShow(RetroHud *hud,const char *speaker,const char *const *lines,uint8_t count){
 const RetroHudDialogue *g;uint8_t i,row;
 if(!box(hud))return 0;
 g=&hud->definition->dialogue;row=g->row;
 if(g->speaker){put(hud,g->col,row,g->width,speaker?speaker:"");row=(uint8_t)(row+1);}
 for(i=0;i<g->lines;i++)put(hud,g->col,(uint8_t)(row+i),g->width,lines&&i<count?lines[i]:"");
 return 1;
}
uint8_t retroHudChoiceShow(RetroHud *hud,const char *prompt,const char *const *options,uint8_t count,uint8_t selected){
 const RetroHudDialogue *g;const RetroHudDefinition *d;uint8_t i,row,first;
 if(!box(hud))return 0;
 d=hud->definition;g=&d->dialogue;row=g->row;
 if(g->speaker){put(hud,g->col,row,g->width,prompt?prompt:"");row=(uint8_t)(row+1);}
 /* More options than lines: the list starts where the selected one is still visible. */
 first=selected>=g->lines&&selected<count?(uint8_t)(selected-g->lines+1):0;
 for(i=0;i<g->lines;i++){
  uint8_t *line=hud->overlayWant+(row+i)*d->overlay.width+g->col,option=(uint8_t)(first+i);
  put(hud,(uint8_t)(g->col+2),(uint8_t)(row+i),(uint8_t)(g->width-2),options&&option<count?options[option]:"");
  line[0]=option<count&&option==selected?g->cursor:d->space;line[1]=d->space;
 }
 return 1;
}
void retroHudOverlayHide(RetroHud *hud){
 if(!hud||!hud->ready||hud->overlay==RETRO_HUD_NONE)return;
 hud->overlay=RETRO_HUD_NONE;hud->closing=1;erase(hud);
}
uint8_t retroHudOverlayVisible(const RetroHud *hud){return hud&&hud->ready&&(hud->overlay!=RETRO_HUD_NONE||hud->closing);}
void retroHudInvalidate(RetroHud *hud){
 if(!hud||!hud->ready)return;
 if(hud->shown)fill(hud->shown,area(&hud->definition->hud),RETRO_HUD_UNKNOWN);
 if(hud->overlayShown)fill(hud->overlayShown,area(&hud->definition->overlay),hud->overlay!=RETRO_HUD_NONE?RETRO_HUD_UNKNOWN:RETRO_HUD_CLEAR);
 hud->cursorHud=hud->cursorOverlay=0;hud->dirtyHud=hud->dirtyOverlay=1;
}
static uint8_t scan(const uint8_t *want,uint8_t *shown,uint16_t count,uint16_t *cursor,uint16_t *found){
 uint16_t i,at=*cursor;
 for(i=0;i<count;i++,at++){
  if(at>=count)at=0;
  if(want[at]!=shown[at]){shown[at]=want[at];*found=at;*cursor=(uint16_t)(at+1);return 1;}
 }
 return 0;
}
uint8_t retroHudNext(RetroHud *hud,RetroHudWrite *write){
 const RetroHudDefinition *d;uint16_t at;
 if(!hud||!hud->ready||!write)return 0;
 d=hud->definition;
 /* The overlay goes first: what the player is reading or choosing. */
 if(hud->dirtyOverlay&&hud->overlayWant){
  if(scan(hud->overlayWant,hud->overlayShown,area(&d->overlay),&hud->cursorOverlay,&at)){
   write->col=(uint8_t)(d->overlay.col+at%d->overlay.width);write->row=(uint8_t)(d->overlay.row+at/d->overlay.width);write->glyph=hud->overlayWant[at];write->overlay=1;
   /* Erasing an overlay cell also erases a HUD cell under it: that one is drawn again. */
   if(write->glyph==RETRO_HUD_CLEAR&&hud->shown&&write->col>=d->hud.col&&write->col<d->hud.col+d->hud.width&&write->row>=d->hud.row&&write->row<d->hud.row+d->hud.height){
    hud->shown[(write->row-d->hud.row)*d->hud.width+write->col-d->hud.col]=RETRO_HUD_UNKNOWN;hud->dirtyHud=1;
   }
   return 1;
  }
  hud->dirtyOverlay=0;
 }
 if(hud->closing){
  /* The overlay is erased: HUD cells it covered must be drawn again. */
  hud->closing=0;
  if(hud->shown){fill(hud->shown,area(&d->hud),RETRO_HUD_UNKNOWN);hud->dirtyHud=1;}
 }
 if(!hud->dirtyHud||!hud->want)return 0;
 /* A HUD cell under an open overlay waits: the overlay owns that screen cell. */
 while(scan(hud->want,hud->shown,area(&d->hud),&hud->cursorHud,&at)){
  uint8_t col=(uint8_t)(d->hud.col+at%d->hud.width),row=(uint8_t)(d->hud.row+at/d->hud.width);
  if(hud->overlay!=RETRO_HUD_NONE&&hud->overlayWant&&col>=d->overlay.col&&col<d->overlay.col+d->overlay.width&&row>=d->overlay.row&&row<d->overlay.row+d->overlay.height&&
   hud->overlayWant[(row-d->overlay.row)*d->overlay.width+col-d->overlay.col]!=RETRO_HUD_CLEAR)continue;
  write->col=col;write->row=row;write->glyph=hud->want[at];write->overlay=0;
  return 1;
 }
 hud->dirtyHud=0;
 return 0;
}
