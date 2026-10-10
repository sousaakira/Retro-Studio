#include "retro_slopes.h"
#define POSITION_MIN ((RetroFixed)-8388608)
#define POSITION_MAX ((RetroFixed)8388352)
static uint8_t valid(const RetroSlope *s){
 return (uint8_t)(s && s->bounds.width>0 && s->bounds.height>0 &&
                 s->leftHeight<=s->bounds.height && s->rightHeight<=s->bounds.height);
}
uint8_t retroSlopeSurface(const RetroSlope *s,RetroFixed worldX,RetroFixed *surface){
 RetroFixed relative;
 int32_t difference;
 if(!surface || !valid(s))return 0;
 /* Subtract only inside the supported world domain to avoid arbitrary int32
  * input overflowing before the interval check. */
 if(worldX<POSITION_MIN || worldX>POSITION_MAX)return 0;
 relative=worldX-(RetroFixed)s->bounds.x*RETRO_FIXED_ONE;
 if(relative<0 || relative>=(RetroFixed)s->bounds.width*RETRO_FIXED_ONE)return 0;
 difference=(int32_t)s->rightHeight-s->leftHeight;
 /* Split before multiplying: |difference * remainder| <= 32767^2.
  * This preserves truncation toward zero without a 64-bit divide on 68000. */
 *surface=(RetroFixed)s->bounds.y*RETRO_FIXED_ONE+(RetroFixed)s->leftHeight*RETRO_FIXED_ONE+
          difference*(relative/s->bounds.width)+difference*(relative%s->bounds.width)/s->bounds.width;
 return 1;
}
RetroMoveResult retroMoveBodySlopes(RetroBody *body,RetroFixed dx,RetroFixed dy,
 const RetroCollider *colliders,uint16_t colliderCount,
 const RetroSlope *slopes,uint16_t slopeCount,int16_t snap,
 uint8_t grounded,uint8_t dropPlatforms){
 RetroMoveResult result={0,0,0,1};
 RetroBody moved;
 RetroFixed oldBottom,newBottom,oldCenter,center,chosen,target;
 uint16_t i;
 uint8_t found=0;
 if(!body || snap<0 || (slopeCount&&!slopes))return result;
 for(i=0;i<slopeCount;i++)if(!valid(&slopes[i]))return result;
 moved=*body;
 result=retroMoveBody(&moved,dx,dy,colliders,colliderCount,dropPlatforms);
 if(result.invalid)return result;
 if(!dropPlatforms && dy>=0){
  oldBottom=body->y+((RetroFixed)body->box.y+body->box.height)*RETRO_FIXED_ONE;
  newBottom=moved.y+((RetroFixed)moved.box.y+moved.box.height)*RETRO_FIXED_ONE;
  oldCenter=body->x+(RetroFixed)body->box.x*RETRO_FIXED_ONE+(RetroFixed)body->box.width*(RETRO_FIXED_ONE/2);
  center=moved.x+(RetroFixed)moved.box.x*RETRO_FIXED_ONE+(RetroFixed)moved.box.width*(RETRO_FIXED_ONE/2);
  chosen=newBottom;
  for(i=0;i<slopeCount;i++){
   const RetroSlope *s=&slopes[i];
   RetroFixed surface,previousSurface;
   uint8_t supported=0;
   if(!(body->mask&s->group) || !retroSlopeSurface(s,center,&surface))continue;
   if(grounded){
    /* Require continuity with this ramp, including entering at its endpoint
     * height. Grounded on a lower unrelated floor must never teleport uphill. */
    if(oldCenter<(RetroFixed)s->bounds.x*RETRO_FIXED_ONE)
     previousSurface=((RetroFixed)s->bounds.y+s->leftHeight)*RETRO_FIXED_ONE;
    else if(oldCenter>=((RetroFixed)s->bounds.x+s->bounds.width)*RETRO_FIXED_ONE)
     previousSurface=((RetroFixed)s->bounds.y+s->rightHeight)*RETRO_FIXED_ONE;
    else if(!retroSlopeSurface(s,oldCenter,&previousSurface))continue;
    supported=(uint8_t)(oldBottom==previousSurface);
   }
   if((oldBottom<=surface && newBottom>=surface) ||
      (supported && (!(result.contacts&RETRO_CONTACT_FLOOR) || surface<=newBottom) &&
       (surface<=newBottom || surface-newBottom<=(RetroFixed)snap*RETRO_FIXED_ONE))){
    if(!found || surface<chosen){chosen=surface;found=1;}
   }
  }
  if(found){
   target=chosen-((RetroFixed)moved.box.y+moved.box.height)*RETRO_FIXED_ONE;
   if(target<POSITION_MIN || target>POSITION_MAX){result.invalid=1;result.dx=0;result.dy=0;result.contacts=0;return result;}
   /* Ramp following must also respect solid ceilings and floors. */
   {
    RetroFixed beforeCorrection=moved.y;
    RetroMoveResult correction=retroMoveBody(&moved,0,target-moved.y,colliders,colliderCount,dropPlatforms);
    result.dy=moved.y-body->y;result.contacts|=correction.contacts;
    if(target<beforeCorrection && moved.y!=target){
     /* Advancing X without enough clearance would put the feet inside the
      * ramp and lose support next tick. Conservatively reject this step. */
     result.dx=0;result.dy=0;result.contacts|=RETRO_CONTACT_FLOOR;
     if(dx>0)result.contacts|=RETRO_CONTACT_RIGHT;
     else if(dx<0)result.contacts|=RETRO_CONTACT_LEFT;
     return result;
    }
    if(moved.y==target)result.contacts|=RETRO_CONTACT_FLOOR;
   }
  }
 }
 *body=moved;return result;
}
