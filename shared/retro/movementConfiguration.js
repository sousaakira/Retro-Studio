// #58: explicit per-project PAL/NTSC profiles; identical video-tick defaults.
export const MOVEMENT_FIELDS=Object.freeze([
 ['walkSpeed',0,32],['acceleration',0,32],['deceleration',0,32],['airAcceleration',0,32],
 ['gravity',1/256,32],['jumpSpeed',1/256,32],['maxFallSpeed',1/256,32],['jumpCutSpeed',0,32],
 ['dashSpeed',0,32],['wallSlideSpeed',0,32],['wallJumpX',0,32],['wallJumpY',0,32],
 ['dashTicks',0,120],['dashCooldownTicks',0,120],['wallLockTicks',0,120],
 ['coyoteTicks',0,60],['jumpBufferTicks',0,60],['slopeSnap',0,32]
])
const defaults={walkSpeed:1.5,acceleration:.5,deceleration:.5,airAcceleration:.5,
 gravity:.25,jumpSpeed:5,maxFallSpeed:7,jumpCutSpeed:2.5,dashSpeed:4,wallSlideSpeed:1,
 wallJumpX:3,wallJumpY:5,dashTicks:8,dashCooldownTicks:12,wallLockTicks:6,
 coyoteTicks:4,jumpBufferTicks:4,slopeSnap:2,airDash:true}
export function createMovementConfiguration(){
 return {format:'retro-studio.movement',version:1,timing:'video-ticks',profiles:{ntsc:{...defaults},pal:{...defaults}}}
}
export function validateMovementConfiguration(value){
 if(!value||value.format!=='retro-studio.movement'||value.version!==1||value.timing!=='video-ticks'||!value.profiles)
  throw Error('Unsupported movement configuration or timing policy.')
 for(const region of ['ntsc','pal']){
  const p=value.profiles[region]
  if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Missing '+region+' movement profile.')
  MOVEMENT_FIELDS.forEach(([key,min,max],i)=>{
   if(typeof p[key]!=='number'||!Number.isFinite(p[key])||p[key]<min||p[key]>max||
    !Number.isInteger(p[key]*(i<12?256:1)))throw Error(region+'.'+key+': invalid range or precision.')
  })
  if(typeof p.airDash!=='boolean'||p.jumpCutSpeed>p.jumpSpeed||p.wallSlideSpeed>p.maxFallSpeed)
   throw Error(region+': invalid jump cut, wall slide or air dash.')
 }
 return value
}
export function compileMovementHeader(value){
 validateMovementConfiguration(value)
 const row=region=>MOVEMENT_FIELDS.map(([key],i)=>value.profiles[region][key]*(i<12?256:1))
  .concat(value.profiles[region].airDash?1:0).join(',')
 return '/* Generated: Q8 px/video tick. PAL/NTSC profiles are explicit; no automatic scaling. */\n'+
  '#ifndef RETRO_PROJECT_MOVEMENT_CONFIG_H\n#define RETRO_PROJECT_MOVEMENT_CONFIG_H\n'+
  '#include "retro_runtime/retro_movement.h"\n'+
  'static const RetroMovementConfig retroProjectMovementNtsc={'+row('ntsc')+'};\n'+
  'static const RetroMovementConfig retroProjectMovementPal={'+row('pal')+'};\n'+
  '#endif\n'
}
