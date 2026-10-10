#include "retro_camera.h"
#define LIMIT (32*RETRO_FIXED_ONE)
#define TARGET_LIMIT ((RetroFixed)32767*RETRO_FIXED_ONE)
#define Q(value) ((RetroFixed)(value)*RETRO_FIXED_ONE)
static RetroFixed approach(RetroFixed value,RetroFixed target,RetroFixed amount){
 if(value<target)return target-value<=amount?target:value+amount;
 if(value>target)return value-target<=amount?target:value-amount;
 return value;
}
static uint8_t speed(RetroFixed value){return (uint8_t)(value>=0&&value<=LIMIT);}
static uint8_t target(RetroFixed value){return (uint8_t)(value>=-TARGET_LIMIT&&value<=TARGET_LIMIT);}
void retroCameraPreset(RetroCameraConfig *c){
 if(!c)return;
 *c=(RetroCameraConfig){2048,2048,256,1024,48,32,0,0,24,2,2,1,1};
}
uint8_t retroCameraValidate(const RetroCameraConfig *c){
 return (uint8_t)(c&&speed(c->maxSpeedX)&&c->maxSpeedX>0&&speed(c->maxSpeedY)&&c->maxSpeedY>0&&
  speed(c->lookAheadSpeed)&&speed(c->scriptReturnSpeed)&&
  c->deadZoneWidth>=0&&c->deadZoneWidth<=320&&c->deadZoneHeight>=0&&c->deadZoneHeight<=240&&
  c->focusX>=-160&&c->focusX<=160&&c->focusY>=-120&&c->focusY<=120&&
  c->lookAheadX>=0&&c->lookAheadX<=160&&(!c->lookAheadX||c->lookAheadSpeed>0)&&
  c->smoothingX<=6&&c->smoothingY<=6&&c->followX<=1&&c->followY<=1);
}
uint8_t retroCameraInit(RetroCamera *camera,int16_t viewWidth,int16_t viewHeight){
 RetroCamera fresh={0};
 if(!camera||viewWidth<8||viewWidth>320||viewHeight<8||viewHeight>240)return 0;
 fresh.viewWidth=viewWidth;fresh.viewHeight=viewHeight;
 fresh.region=fresh.released=RETRO_ID_NONE;*camera=fresh;return 1;
}
static uint8_t rectangle(const RetroRect *r,int16_t width,int16_t height){
 return (uint8_t)(r->x>=0&&r->y>=0&&r->width>0&&r->height>0&&
  (int32_t)r->x+r->width<=width&&(int32_t)r->y+r->height<=height);
}
static uint8_t inside(const RetroCameraRegion *r,RetroFixed x,RetroFixed y){
 return (uint8_t)(x>=Q(r->area.x)&&x<Q((int32_t)r->area.x+r->area.width)&&
  y>=Q(r->area.y)&&y<Q((int32_t)r->area.y+r->area.height));
}
static uint16_t pick(const RetroCamera *c,RetroFixed x,RetroFixed y){
 uint16_t i,best=RETRO_ID_NONE;
 for(i=0;i<c->regionCount;i++)
  if(i!=c->released&&inside(&c->regions[i],x,y)&&
   (best==RETRO_ID_NONE||c->regions[i].priority>c->regions[best].priority))best=i;
 return best;
}
static RetroRect limits(const RetroCamera *c){
 RetroRect room={0,0,c->roomWidth,c->roomHeight};
 return c->region==RETRO_ID_NONE?room:c->regions[c->region].limits;
}
static RetroFixed confine(RetroFixed value,int16_t minimum,int16_t size,int16_t view){
 RetroFixed low=Q(minimum),high=Q((int32_t)minimum+size-view);
 if(high<low)high=low;
 return value<low?low:value>high?high:value;
}
/* Position that puts the focus point back on the nearest dead-zone edge. */
static RetroFixed frame(RetroFixed position,RetroFixed focus,int16_t view,int16_t offset,int16_t zone){
 RetroFixed centre=position+Q(view/2+offset),half=(RetroFixed)zone*(RETRO_FIXED_ONE/2);
 if(focus<centre-half)return position+focus-(centre-half);
 if(focus>centre+half)return position+focus-(centre+half);
 return position;
}
static RetroFixed advance(RetroFixed position,RetroFixed goal,RetroFixed maximum,uint8_t smoothing){
 RetroFixed delta=goal-position,step=delta;
 if(smoothing){step=delta/(RetroFixed)(1<<smoothing);if(!step)step=delta;}
 if(step>maximum)step=maximum;
 if(step<-maximum)step=-maximum;
 return position+step;
}
uint8_t retroCameraEnterRoom(RetroCamera *camera,const RetroCameraConfig *config,
 int16_t roomWidth,int16_t roomHeight,const RetroCameraRegion *regions,uint16_t regionCount,
 RetroFixed targetX,RetroFixed targetY,signed char direction){
 RetroCamera next;RetroRect bounds;uint16_t i;
 if(!camera||!camera->viewWidth||!retroCameraValidate(config)||roomWidth<1||roomHeight<1||
  (regionCount&&!regions)||regionCount>64||!target(targetX)||!target(targetY)||direction<-1||direction>1)return 0;
 for(i=0;i<regionCount;i++)
  if(!rectangle(&regions[i].area,roomWidth,roomHeight)||!rectangle(&regions[i].limits,roomWidth,roomHeight)||
   !speed(regions[i].transitionSpeed)||regions[i].flags>RETRO_CAMERA_REGION_LOCK)return 0;
 next=*camera;next.roomWidth=roomWidth;next.roomHeight=roomHeight;
 next.regions=regions;next.regionCount=regionCount;next.released=RETRO_ID_NONE;
 next.transition=next.script=next.returning=0;next.transitionSpeed=0;
 if(direction)next.look=Q(config->lookAheadX)*direction;
 else next.look=0;
 next.region=pick(&next,targetX,targetY);
 next.locked=(uint8_t)(next.region!=RETRO_ID_NONE&&(regions[next.region].flags&RETRO_CAMERA_REGION_LOCK));
 bounds=limits(&next);
 next.x=confine(targetX+next.look-Q(next.viewWidth/2+config->focusX),bounds.x,bounds.width,next.viewWidth);
 next.y=confine(targetY-Q(next.viewHeight/2+config->focusY),bounds.y,bounds.height,next.viewHeight);
 next.ready=1;*camera=next;return 1;
}
RetroCameraResult retroCameraTick(RetroCamera *camera,const RetroCameraConfig *config,
 RetroFixed targetX,RetroFixed targetY,signed char direction){
 RetroCameraResult result={0,0,RETRO_ID_NONE,0,1};
 RetroCamera c;RetroRect bounds;RetroFixed goalX,goalY;uint16_t best;
 if(!camera||!camera->ready||!retroCameraValidate(config)||!target(targetX)||!target(targetY)||
  direction<-1||direction>1)return result;
 c=*camera;result.invalid=0;
 if(direction)c.look=approach(c.look,Q(config->lookAheadX)*direction,config->lookAheadSpeed);
 if(c.released!=RETRO_ID_NONE&&!inside(&c.regions[c.released],targetX,targetY))c.released=RETRO_ID_NONE;
 if(!c.locked){
  best=pick(&c,targetX,targetY);
  if(best!=c.region){
   c.transitionSpeed=c.regions[best!=RETRO_ID_NONE?best:c.region].transitionSpeed;
   c.region=best;c.transition=1;result.flags|=RETRO_CAMERA_REGION_CHANGED;
   c.locked=(uint8_t)(best!=RETRO_ID_NONE&&(c.regions[best].flags&RETRO_CAMERA_REGION_LOCK));
  }
 }
 if(c.returning){c.transition=1;c.transitionSpeed=config->scriptReturnSpeed;}
 c.returning=0;
 bounds=limits(&c);goalX=c.x;goalY=c.y;
 if(config->followX)goalX=frame(c.x,targetX+c.look,c.viewWidth,config->focusX,config->deadZoneWidth);
 if(config->followY)goalY=frame(c.y,targetY,c.viewHeight,config->focusY,config->deadZoneHeight);
 goalX=confine(goalX,bounds.x,bounds.width,c.viewWidth);
 goalY=confine(goalY,bounds.y,bounds.height,c.viewHeight);
 if(c.script&RETRO_CAMERA_AXIS_X)goalX=c.x;
 if(c.script&RETRO_CAMERA_AXIS_Y)goalY=c.y;
 if(c.transition){
  result.flags|=RETRO_CAMERA_TRANSITION;
  if(!c.transitionSpeed){c.x=goalX;c.y=goalY;}
  else{c.x=approach(c.x,goalX,c.transitionSpeed);c.y=approach(c.y,goalY,c.transitionSpeed);}
  if(c.x==goalX&&c.y==goalY)c.transition=0;
 }else{
  c.x=advance(c.x,goalX,config->maxSpeedX,config->smoothingX);
  c.y=advance(c.y,goalY,config->maxSpeedY,config->smoothingY);
 }
 if(c.x!=camera->x||c.y!=camera->y)result.flags|=RETRO_CAMERA_MOVED;
 if(c.locked)result.flags|=RETRO_CAMERA_LOCKED;
 if(c.script)result.flags|=RETRO_CAMERA_SCRIPT;
 result.x=(int16_t)(c.x/RETRO_FIXED_ONE);result.y=(int16_t)(c.y/RETRO_FIXED_ONE);
 if(c.region!=RETRO_ID_NONE)result.region=c.regions[c.region].id;
 *camera=c;return result;
}
uint8_t retroCameraBounds(const RetroCamera *camera,RetroRect *bounds){
 if(!camera||!camera->ready||!bounds)return 0;
 *bounds=limits(camera);return 1;
}
uint8_t retroCameraUnlock(RetroCamera *camera){
 if(!camera||!camera->ready||!camera->locked)return 0;
 camera->locked=0;camera->released=camera->region;return 1;
}
static RetroFixed pixel(int32_t value){return Q(value<0?0:value>32767?32767:value);}
uint8_t retroCameraScriptSet(RetroCamera *camera,uint8_t axes,int32_t x,int32_t y){
 if(!camera||!camera->ready||!axes||axes>(RETRO_CAMERA_AXIS_X|RETRO_CAMERA_AXIS_Y))return 0;
 if(axes&RETRO_CAMERA_AXIS_X)camera->x=confine(pixel(x),0,camera->roomWidth,camera->viewWidth);
 if(axes&RETRO_CAMERA_AXIS_Y)camera->y=confine(pixel(y),0,camera->roomHeight,camera->viewHeight);
 camera->script|=axes;camera->returning=0;return 1;
}
static void release(RetroCamera *camera,uint8_t axes){
 if(!camera||!camera->ready||!(camera->script&axes))return;
 camera->script&=(uint8_t)~axes;camera->returning=1;
}
void retroCameraScriptRelease(RetroCamera *camera){release(camera,RETRO_CAMERA_AXIS_X|RETRO_CAMERA_AXIS_Y);}
int retroCameraCutsceneGet(void *context){
 const RetroCamera *camera=(const RetroCamera *)context;
 return camera&&camera->ready?(int)(camera->x/RETRO_FIXED_ONE):0;
}
void retroCameraCutsceneSet(void *context,int follow,int x){
 RetroCamera *camera=(RetroCamera *)context;
 if(follow)release(camera,RETRO_CAMERA_AXIS_X); /* a host-owned Y stays scripted */
 else retroCameraScriptSet(camera,RETRO_CAMERA_AXIS_X,x,0);
}
int retroCameraCutsceneClamp(void *context,int x){
 const RetroCamera *camera=(const RetroCamera *)context;
 if(!camera||!camera->ready)return x;
 return (int)(confine(pixel(x),0,camera->roomWidth,camera->viewWidth)/RETRO_FIXED_ONE);
}
