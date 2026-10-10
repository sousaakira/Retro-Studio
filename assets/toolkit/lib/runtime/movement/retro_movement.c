#include "retro_movement.h"
#define LIMIT (32*RETRO_FIXED_ONE)
static RetroFixed absolute(RetroFixed value){return value<0?-value:value;}
static RetroFixed approach(RetroFixed value,RetroFixed target,RetroFixed amount){
 if(value<target)return target-value<=amount?target:value+amount;
 if(value>target)return value-target<=amount?target:value-amount;
 return value;
}
static uint8_t speed(RetroFixed value){return (uint8_t)(value>=0&&value<=LIMIT);}
void retroMovementPreset(RetroMovementConfig *c){
 if(!c)return;
 *c=(RetroMovementConfig){384,128,128,128,64,1280,1792,640,
                         1024,256,768,1280,8,12,6,4,4,2,1};
}
uint8_t retroMovementValidate(const RetroMovementConfig *c){
 return (uint8_t)(c&&speed(c->walkSpeed)&&speed(c->acceleration)&&speed(c->deceleration)&&
  speed(c->airAcceleration)&&speed(c->gravity)&&c->gravity>0&&speed(c->jumpSpeed)&&c->jumpSpeed>0&&
  speed(c->maxFallSpeed)&&c->maxFallSpeed>0&&speed(c->jumpCutSpeed)&&c->jumpCutSpeed<=c->jumpSpeed&&
  speed(c->dashSpeed)&&speed(c->wallSlideSpeed)&&c->wallSlideSpeed<=c->maxFallSpeed&&
  speed(c->wallJumpX)&&speed(c->wallJumpY)&&c->dashTicks<=120&&c->dashCooldownTicks<=120&&
  c->wallLockTicks<=120&&c->coyoteTicks<=60&&c->jumpBufferTicks<=60&&
  c->slopeSnap>=0&&c->slopeSnap<=32&&c->airDash<=1);
}
uint8_t retroMovementInit(RetroMovement *state,const RetroBody *body){
 RetroBody check;RetroMovement fresh={0};
 if(!state||!body)return 0;
 check=*body;if(retroMoveBody(&check,0,0,0,0,0).invalid)return 0;
 fresh.body=*body;fresh.ready=1;*state=fresh;return 1;
}
static uint8_t support(const RetroMovement *s,const RetroMovementConfig *c,
 const RetroCollider *colliders,uint16_t count,const RetroSlope *slopes,uint16_t slopeCount,uint8_t drop){
 RetroBody probe=s->body;
 RetroMoveResult r=retroMoveBodySlopes(&probe,0,1,colliders,count,slopes,slopeCount,c->slopeSnap,s->grounded,drop);
 return (uint8_t)(!r.invalid&&(r.contacts&RETRO_CONTACT_FLOOR));
}
static signed char wallAt(const RetroBody *body,const RetroCollider *colliders,uint16_t count,signed char axis){
 RetroBody left=*body,right=*body;
 uint8_t l=(uint8_t)(retroMoveBody(&left,-1,0,colliders,count,0).contacts&RETRO_CONTACT_LEFT);
 uint8_t r=(uint8_t)(retroMoveBody(&right,1,0,colliders,count,0).contacts&RETRO_CONTACT_RIGHT);
 if(l&&r)return axis<0?-1:1;
 return l?-1:r?1:0;
}
RetroMovementResult retroMovementTick(RetroMovement *state,const RetroMovementConfig *c,
 RetroMovementInput input,const RetroCollider *colliders,uint16_t count,const RetroSlope *slopes,uint16_t slopeCount){
 RetroMovementResult result={0,0,0,0,0,0,0,1};
 RetroMovement next;RetroBody check;
 RetroFixed dx,dy,max,partX,partY,oldX,oldY;
 uint16_t i,steps;
 uint8_t drop,wasGrounded,stopX=0,stopY=0;
 if(!state||state->ready!=1||!retroMovementValidate(c)||input.axis<-1||input.axis>1||
  (input.buttons&~15)||state->velocityX<-LIMIT||state->velocityX>LIMIT||
  state->velocityY<-LIMIT||state->velocityY>LIMIT||state->grounded>1||state->facing>1||state->movementFacing>1||
  state->sliding>1||state->wall<-1||state->wall>1||state->dashRemaining>120||
  state->dashCooldown>240||state->wallLock>120||state->coyote>60||state->jumpBuffer>60||
  (state->dashRemaining&&state->dashDirection!=-1&&state->dashDirection!=1))return result;
 check=state->body;
 if(retroMoveBodySlopes(&check,0,0,colliders,count,slopes,slopeCount,c->slopeSnap,0,0).invalid)return result;
 next=*state;oldX=next.body.x;oldY=next.body.y;wasGrounded=next.grounded;
 drop=(uint8_t)((input.buttons&RETRO_MOVE_DROP_HELD)!=0);
 next.grounded=(uint8_t)(next.velocityY>=0&&support(&next,c,colliders,count,slopes,slopeCount,drop));
 next.wall=wallAt(&next.body,colliders,count,input.axis);
 if(next.grounded)next.coyote=c->coyoteTicks;
 if(drop)next.coyote=0;
 if(input.buttons&RETRO_MOVE_JUMP_PRESSED)next.jumpBuffer=c->jumpBufferTicks?c->jumpBufferTicks:1;
 if(input.axis&&!next.dashRemaining&&!next.wallLock)next.movementFacing=(uint8_t)(input.axis<0);
 if((input.buttons&RETRO_MOVE_DASH_PRESSED)&&!next.dashRemaining&&!next.dashCooldown&&
    c->dashTicks&&c->dashSpeed&&(next.grounded||c->airDash)){
  next.dashRemaining=c->dashTicks;next.dashCooldown=c->dashTicks+c->dashCooldownTicks;
  next.dashDirection=input.axis?input.axis:(next.facing?-1:1);next.movementFacing=(uint8_t)(next.dashDirection<0);
  next.wallLock=0;result.dashStarted=1;
 }
 if(next.jumpBuffer&&!drop&&!next.dashRemaining){
  if(next.grounded||next.coyote){
   next.velocityY=-c->jumpSpeed;next.grounded=0;next.coyote=0;next.jumpBuffer=0;result.jumped=1;
  }else if(next.wall&&c->wallJumpX&&c->wallJumpY){
   next.velocityX=-next.wall*c->wallJumpX;next.velocityY=-c->wallJumpY;
   next.wallLock=c->wallLockTicks;next.movementFacing=(uint8_t)(next.wall>0);
   next.jumpBuffer=0;result.jumped=1;
  }
 }
 next.sliding=0;
 if(next.dashRemaining){next.velocityX=next.dashDirection*c->dashSpeed;next.velocityY=0;}
 else{
  if(!next.wallLock)next.velocityX=approach(next.velocityX,input.axis*c->walkSpeed,
   input.axis?(next.grounded?c->acceleration:c->airAcceleration):c->deceleration);
  if(!result.jumped){
   if(!(input.buttons&RETRO_MOVE_JUMP_HELD)&&next.velocityY<-c->jumpCutSpeed)next.velocityY=-c->jumpCutSpeed;
   next.velocityY+=c->gravity;if(next.velocityY>c->maxFallSpeed)next.velocityY=c->maxFallSpeed;
  }
  if(!next.grounded&&!next.wallLock&&!result.jumped&&next.velocityY>=0&&next.wall&&input.axis==next.wall&&c->wallSlideSpeed){
   next.sliding=1;next.facing=(uint8_t)(next.wall>0);
   if(next.velocityY>c->wallSlideSpeed)next.velocityY=c->wallSlideSpeed;
  }
 }
 dx=next.velocityX;dy=next.velocityY;
 max=absolute(dx)>absolute(dy)?absolute(dx):absolute(dy);
 steps=slopeCount?(uint16_t)((max+RETRO_FIXED_ONE-1)/RETRO_FIXED_ONE):1;if(!steps)steps=1;
 for(i=0;i<steps;i++){
  RetroMoveResult movement;
  partX=stopX?0:dx*(i+1)/steps-dx*i/steps;
  partY=stopY?0:dy*(i+1)/steps-dy*i/steps;
  movement=retroMoveBodySlopes(&next.body,partX,partY,colliders,count,slopes,slopeCount,c->slopeSnap,next.grounded,drop);
  if(movement.invalid)return (RetroMovementResult){0,0,0,0,0,0,0,1};
  result.contacts|=movement.contacts;
  if(movement.contacts&(RETRO_CONTACT_LEFT|RETRO_CONTACT_RIGHT)){stopX=1;next.velocityX=0;next.dashRemaining=0;}
  if(movement.contacts&(RETRO_CONTACT_FLOOR|RETRO_CONTACT_CEILING)){stopY=1;next.velocityY=0;}
  next.grounded=(uint8_t)(next.velocityY>=0&&support(&next,c,colliders,count,slopes,slopeCount,drop));
 }
 next.grounded=(uint8_t)(next.velocityY>=0&&support(&next,c,colliders,count,slopes,slopeCount,drop));
 next.wall=wallAt(&next.body,colliders,count,input.axis);
 if(next.grounded){next.coyote=c->coyoteTicks;next.sliding=0;result.contacts|=RETRO_CONTACT_FLOOR;}
 if(!next.wall)next.sliding=0;
 if(!next.grounded&&!next.wallLock&&!next.dashRemaining&&!result.jumped&&next.velocityY>=0&&
    next.wall&&input.axis==next.wall&&c->wallSlideSpeed){
  next.sliding=1;next.facing=(uint8_t)(next.wall>0);
  if(next.velocityY>c->wallSlideSpeed)next.velocityY=c->wallSlideSpeed;
 }
 next.facing=next.sliding?(uint8_t)(next.wall>0):next.movementFacing;
 if(next.wall<0)result.contacts|=RETRO_CONTACT_LEFT;else if(next.wall>0)result.contacts|=RETRO_CONTACT_RIGHT;
 result.landed=(uint8_t)(next.grounded&&!wasGrounded);
 if(next.dashRemaining)next.dashRemaining--;
 if(next.dashCooldown)next.dashCooldown--;
 if(next.wallLock)next.wallLock--;
 if(next.coyote&&!next.grounded)next.coyote--;
 if(next.jumpBuffer)next.jumpBuffer--;
 result.dx=next.body.x-oldX;result.dy=next.body.y-oldY;result.invalid=0;
 result.conditions=(next.grounded?1u:0u)|(next.velocityX?2u:0u)|(result.jumped?4u:0u)|(next.wall?16u:0u);
 *state=next;return result;
}
