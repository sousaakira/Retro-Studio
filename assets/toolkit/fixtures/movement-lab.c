/* #58: same C movement controller in browser WASM and native reference tests.
 * Lab-only wrapper; owns one isolated player/config and immutable room data. */
#include "retro_movement.h"
#include "movement-room-data.h"
#ifdef __wasm__
#include <stddef.h>
void *memcpy(void *destination,const void *source,size_t length){
 unsigned char *d=destination;const unsigned char *s=source;size_t i;
 for(i=0;i<length;i++)d[i]=s[i];return destination;
}
void *memset(void *destination,int value,size_t length){
 unsigned char *d=destination;size_t i;
 for(i=0;i<length;i++)d[i]=(unsigned char)value;return destination;
}
#endif
static RetroMovement labPlayer;
static RetroMovementConfig labConfig;
static RetroMovementResult labResult;
static int32_t ticks,flightTicks,lastFlight,lastDistance,peak,flightX,flightY;
static uint8_t inFlight;
void movementLabPreset(void){retroMovementPreset(&labConfig);}
int32_t movementLabConfigure(int32_t field,int32_t value){
 if(field<0||field>18||value<0||value>8192)return 0;
 switch(field){
  case 0:labConfig.walkSpeed=value;break;
  case 1:labConfig.acceleration=value;break;
  case 2:labConfig.deceleration=value;break;
  case 3:labConfig.airAcceleration=value;break;
  case 4:labConfig.gravity=value;break;
  case 5:labConfig.jumpSpeed=value;break;
  case 6:labConfig.maxFallSpeed=value;break;
  case 7:labConfig.jumpCutSpeed=value;break;
  case 8:labConfig.dashSpeed=value;break;
  case 9:labConfig.wallSlideSpeed=value;break;
  case 10:labConfig.wallJumpX=value;break;
  case 11:labConfig.wallJumpY=value;break;
  case 12:labConfig.dashTicks=(uint16_t)value;break;
  case 13:labConfig.dashCooldownTicks=(uint16_t)value;break;
  case 14:labConfig.wallLockTicks=(uint16_t)value;break;
  case 15:labConfig.coyoteTicks=(uint16_t)value;break;
  case 16:labConfig.jumpBufferTicks=(uint16_t)value;break;
  case 17:labConfig.slopeSnap=(int16_t)value;break;
  case 18:labConfig.airDash=(uint8_t)(value!=0);break;
 }
 return 1;
}
int32_t movementLabReset(void){
 RetroBody body={LAB_SPAWN_X*256,LAB_SPAWN_Y*256,LAB_BODY,1};
 if(!retroMovementValidate(&labConfig)||!retroMovementInit(&labPlayer,&body))return 0;
 labResult=(RetroMovementResult){0};ticks=0;flightTicks=0;lastFlight=0;lastDistance=0;inFlight=0;
 flightX=body.x;flightY=body.y;peak=body.y;return 1;
}
int32_t movementLabTick(int32_t axis,int32_t buttons){
 RetroFixed previousX=labPlayer.body.x,previousY=labPlayer.body.y;
 if(axis<-1||axis>1||buttons<0||buttons>15||ticks>=65535)return 0;
 labResult=retroMovementTick(&labPlayer,&labConfig,(RetroMovementInput){(signed char)axis,(uint8_t)buttons},
                            labColliders,LAB_COLLIDER_COUNT,labSlopes,LAB_SLOPE_COUNT);
 if(labResult.invalid)return 0;
 ticks++;
 if(labResult.jumped){inFlight=1;flightTicks=0;flightX=previousX;flightY=previousY;peak=previousY;}
 if(inFlight){
  flightTicks++;if(labPlayer.body.y<peak)peak=labPlayer.body.y;
  if(labPlayer.grounded){lastFlight=flightTicks;lastDistance=labPlayer.body.x-flightX;inFlight=0;}
 }
 return 1;
}
int32_t movementLabRead(int32_t field){
 switch(field){
  case 0:return labPlayer.body.x;case 1:return labPlayer.body.y;
  case 2:return labPlayer.velocityX;case 3:return labPlayer.velocityY;
  case 4:return labPlayer.grounded;case 5:return labPlayer.facing;
  case 6:return labPlayer.sliding;case 7:return labPlayer.wall;
  case 8:return labResult.contacts;case 9:return labResult.jumped;
  case 10:return labPlayer.dashRemaining;case 11:return ticks;
  case 12:return flightY-peak;case 13:return inFlight?labPlayer.body.x-flightX:lastDistance;
  case 14:return inFlight?flightTicks:lastFlight;
  default:return 0;
 }
}
