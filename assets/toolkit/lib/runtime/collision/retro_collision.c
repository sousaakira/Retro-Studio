#include "retro_collision.h"
#define POSITION_MIN ((RetroFixed)-8388608)
#define POSITION_MAX ((RetroFixed)8388352)
static RetroFixed fixed(int32_t value){return value*RETRO_FIXED_ONE;}
static int32_t pixel(RetroFixed value){
 return value/RETRO_FIXED_ONE-(value<0 && value%RETRO_FIXED_ONE!=0);
}
uint8_t retroWorldRect(const RetroRect *local,RetroFixed feetX,RetroFixed feetY,
                       uint8_t flipH,uint8_t flipV,RetroRect *result){
 int32_t x,y;
 if(!local || !result || local->width<=0 || local->height<=0 ||
    feetX<POSITION_MIN || feetX>POSITION_MAX || feetY<POSITION_MIN || feetY>POSITION_MAX)return 0;
 x=pixel(feetX)+(flipH?-(int32_t)local->x-local->width:local->x);
 y=pixel(feetY)+(flipV?-(int32_t)local->y-local->height:local->y);
 if(x < -32768 || x > 32767 || y < -32768 || y > 32767)return 0;
 *result=*local;result->x=(int16_t)x;result->y=(int16_t)y;return 1;
}
uint8_t retroFrameWorldRect(const RetroFrameBox *box,uint16_t frame,
                            RetroFixed feetX,RetroFixed feetY,
                            uint8_t flipH,uint8_t flipV,RetroRect *result){
 if(!box || !box->enabled || box->firstFrame>box->lastFrame ||
    frame<box->firstFrame || frame>box->lastFrame)return 0;
 return retroWorldRect(&box->box,feetX,feetY,flipH,flipV,result);
}
static uint8_t overlap(RetroFixed a,RetroFixed size,RetroFixed b,RetroFixed otherSize){
 return (uint8_t)(a<b+otherSize && a+size>b);
}
static RetroFixed boundedMove(RetroFixed position,RetroFixed delta){
 if(delta>0 && delta>POSITION_MAX-position)return POSITION_MAX-position;
 if(delta<0 && delta<POSITION_MIN-position)return POSITION_MIN-position;
 return delta;
}
static uint8_t faces(uint8_t kind){
 if(kind==RETRO_COLLIDER_SOLID)return 15;
 if(kind==RETRO_COLLIDER_PLATFORM)return 1;
 if((kind&240)==RETRO_COLLIDER_DIRECTIONAL)return kind&15;
 return 0;
}
uint8_t retroMirrorRect(const RetroRect *local,uint8_t flip,RetroRect *result){
 int32_t x;
 if(!local||!result||local->width<=0||local->height<=0)return 0;
 x=flip?-(int32_t)local->x-local->width:local->x;
 if(x < -32768 || x > 32767)return 0;
 *result=*local;result->x=(int16_t)x;return 1;
}
RetroMoveResult retroMoveBody(RetroBody *body,RetroFixed dx,RetroFixed dy,
                               const RetroCollider *colliders,uint16_t count,
                               uint8_t dropPlatforms){
 RetroMoveResult result={0,0,0,0};
 RetroFixed x,y,width,height;
 uint16_t i;
 if(!body || (count&&!colliders) || body->box.width<=0 || body->box.height<=0 ||
    body->x<POSITION_MIN || body->x>POSITION_MAX || body->y<POSITION_MIN || body->y>POSITION_MAX){
  result.invalid=1;return result;
 }
 dx=boundedMove(body->x,dx);dy=boundedMove(body->y,dy);
 x=body->x+fixed(body->box.x);y=body->y+fixed(body->box.y);
 width=fixed(body->box.width);height=fixed(body->box.height);
 for(i=0;i<count;i++){
  const RetroCollider *collider=&colliders[i];
  RetroFixed left,right,top;
  uint8_t directions=faces(collider->kind);
  if(!directions || !(body->mask&collider->group) ||
     collider->box.width<=0 || collider->box.height<=0)continue;
  left=fixed(collider->box.x);right=left+fixed(collider->box.width);top=fixed(collider->box.y);
  if(!overlap(y,height,top,fixed(collider->box.height)))continue;
  if((directions&4) && dx>0 && x+width<=left && dx>=left-x-width){dx=left-x-width;result.contacts|=RETRO_CONTACT_RIGHT;}
  else if((directions&8) && dx<0 && x>=right && dx<=right-x){dx=right-x;result.contacts|=RETRO_CONTACT_LEFT;}
 }
 body->x+=dx;x+=dx;
 for(i=0;i<count;i++){
  const RetroCollider *collider=&colliders[i];
  RetroFixed top,bottom,left;
  uint8_t directions=faces(collider->kind);
  if(!(body->mask&collider->group)||collider->box.width<=0||collider->box.height<=0||
    !directions)continue;
  if(collider->kind==RETRO_COLLIDER_PLATFORM && (dropPlatforms || dy<=0))continue;
  left=fixed(collider->box.x);top=fixed(collider->box.y);bottom=top+fixed(collider->box.height);
  if(!overlap(x,width,left,fixed(collider->box.width)))continue;
  if((directions&1) && dy>0 && y+height<=top && dy>=top-y-height){dy=top-y-height;result.contacts|=RETRO_CONTACT_FLOOR;}
  else if((directions&2) && dy<0 && y>=bottom && dy<=bottom-y){
   dy=bottom-y;result.contacts|=RETRO_CONTACT_CEILING;
  }
 }
 body->y+=dy;result.dx=dx;result.dy=dy;return result;
}
