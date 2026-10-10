// #59: preview port of runtime/camera/retro_camera.c. Integer Q8 arithmetic only;
// smoke-camera-preview compares every field with the native C controller.
import {CAMERA_FIELDS,validateCameraConfiguration,createCameraConfiguration,cameraProfileRow} from './cameraConfiguration.js'
export const CAMERA_FLAGS=Object.freeze({moved:1,transition:2,locked:4,script:8,regionChanged:16})
const NONE=0xFFFF,ONE=256,TARGET_LIMIT=32767*ONE
const approach=(value,target,amount)=>value<target?(target-value<=amount?target:value+amount):value>target?(value-target<=amount?target:value-amount):value
const inside=(r,x,y)=>x>=r.area.x*ONE&&x<(r.area.x+r.area.width)*ONE&&y>=r.area.y*ONE&&y<(r.area.y+r.area.height)*ONE
const rectangle=(r,width,height)=>r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=width&&r.y+r.height<=height
function confine(value,minimum,size,view){
 const low=minimum*ONE;let high=(minimum+size-view)*ONE
 if(high<low)high=low
 return value<low?low:value>high?high:value
}
function frame(position,focus,view,offset,zone){
 const centre=position+(Math.trunc(view/2)+offset)*ONE,half=zone*(ONE/2)
 if(focus<centre-half)return position+focus-(centre-half)
 if(focus>centre+half)return position+focus-(centre+half)
 return position
}
function advance(position,goal,maximum,smoothing){
 const delta=goal-position;let step=delta
 if(smoothing){step=Math.trunc(delta/(1<<smoothing));if(!step)step=delta}
 if(step>maximum)step=maximum
 if(step<-maximum)step=-maximum
 return position+step
}
const pixel=value=>(value<0?0:value>32767?32767:value)*ONE
const valid=value=>Number.isInteger(value)&&value>=-TARGET_LIMIT&&value<=TARGET_LIMIT
const facing=value=>value===-1||value===0||value===1
/** profile: one authored region profile (pixels, px/tick). Targets are Q8 integers. */
export function createCameraController(profile,view={width:320,height:224}){
 const source=createCameraConfiguration();source.profiles.ntsc=profile;validateCameraConfiguration(source)
 if(!Number.isInteger(view.width)||!Number.isInteger(view.height)||view.width<8||view.width>320||view.height<8||view.height>240)
  throw Error('Invalid camera view.')
 const row=cameraProfileRow(profile),config=Object.fromEntries(CAMERA_FIELDS.map(([key],i)=>[key,row[i]]))
 config.followX=profile.followX;config.followY=profile.followY
 let c={x:0,y:0,look:0,transitionSpeed:0,regions:[],region:NONE,released:NONE,roomWidth:0,roomHeight:0,
  ready:false,locked:false,transition:false,script:0,returning:false}
 const pick=(state,x,y)=>{
  let best=NONE
  state.regions.forEach((r,i)=>{if(i!==state.released&&inside(r,x,y)&&(best===NONE||r.priority>state.regions[best].priority))best=i})
  return best
 }
 const limits=state=>state.region===NONE?{x:0,y:0,width:state.roomWidth,height:state.roomHeight}:state.regions[state.region].limits
 return {
  /** regions: rows from cameraRegionRows (exported order and Q8 speeds). */
  enterRoom(roomWidth,roomHeight,regions,targetX,targetY,direction){
   if(!Number.isInteger(roomWidth)||!Number.isInteger(roomHeight)||roomWidth<1||roomHeight<1||roomWidth>32767||roomHeight>32767||
    !Array.isArray(regions)||regions.length>64||!valid(targetX)||!valid(targetY)||!facing(direction))return false
   for(const r of regions)if(!rectangle(r.area,roomWidth,roomHeight)||!rectangle(r.limits,roomWidth,roomHeight)||
    !Number.isInteger(r.transitionSpeed)||r.transitionSpeed<0||r.transitionSpeed>32*ONE||r.flags>1)return false
   const next={...c,roomWidth,roomHeight,regions,released:NONE,transition:false,script:0,returning:false,transitionSpeed:0}
   next.look=direction?config.lookAheadX*ONE*direction:0
   next.region=pick(next,targetX,targetY)
   next.locked=next.region!==NONE&&!!(regions[next.region].flags&1)
   const bounds=limits(next)
   next.x=confine(targetX+next.look-(Math.trunc(view.width/2)+config.focusX)*ONE,bounds.x,bounds.width,view.width)
   next.y=confine(targetY-(Math.trunc(view.height/2)+config.focusY)*ONE,bounds.y,bounds.height,view.height)
   next.ready=true;c=next;return true
  },
  tick(targetX,targetY,direction){
   const result={x:0,y:0,region:NONE,flags:0,invalid:true}
   if(!c.ready||!valid(targetX)||!valid(targetY)||!facing(direction))return result
   const n={...c};result.invalid=false
   if(direction)n.look=approach(n.look,config.lookAheadX*ONE*direction,config.lookAheadSpeed)
   if(n.released!==NONE&&!inside(n.regions[n.released],targetX,targetY))n.released=NONE
   if(!n.locked){
    const best=pick(n,targetX,targetY)
    if(best!==n.region){
     n.transitionSpeed=n.regions[best!==NONE?best:n.region].transitionSpeed
     n.region=best;n.transition=true;result.flags|=CAMERA_FLAGS.regionChanged
     n.locked=best!==NONE&&!!(n.regions[best].flags&1)
    }
   }
   if(n.returning){n.transition=true;n.transitionSpeed=config.scriptReturnSpeed}
   n.returning=false
   const bounds=limits(n);let goalX=n.x,goalY=n.y
   if(config.followX)goalX=frame(n.x,targetX+n.look,view.width,config.focusX,config.deadZoneWidth)
   if(config.followY)goalY=frame(n.y,targetY,view.height,config.focusY,config.deadZoneHeight)
   goalX=confine(goalX,bounds.x,bounds.width,view.width);goalY=confine(goalY,bounds.y,bounds.height,view.height)
   if(n.script&1)goalX=n.x
   if(n.script&2)goalY=n.y
   if(n.transition){
    result.flags|=CAMERA_FLAGS.transition
    if(!n.transitionSpeed){n.x=goalX;n.y=goalY}
    else{n.x=approach(n.x,goalX,n.transitionSpeed);n.y=approach(n.y,goalY,n.transitionSpeed)}
    if(n.x===goalX&&n.y===goalY)n.transition=false
   }else{
    n.x=advance(n.x,goalX,config.maxSpeedX,config.smoothingX)
    n.y=advance(n.y,goalY,config.maxSpeedY,config.smoothingY)
   }
   if(n.x!==c.x||n.y!==c.y)result.flags|=CAMERA_FLAGS.moved
   if(n.locked)result.flags|=CAMERA_FLAGS.locked
   if(n.script)result.flags|=CAMERA_FLAGS.script
   result.x=Math.trunc(n.x/ONE);result.y=Math.trunc(n.y/ONE)
   if(n.region!==NONE)result.region=n.regions[n.region].id
   c=n;return result
  },
  bounds(){return c.ready?{...limits(c)}:null},
  unlock(){if(!c.ready||!c.locked)return false;c={...c,locked:false,released:c.region};return true},
  scriptSet(axes,x,y){
   if(!c.ready||!Number.isInteger(axes)||axes<1||axes>3||!Number.isInteger(x)||!Number.isInteger(y))return false
   const n={...c}
   if(axes&1)n.x=confine(pixel(x),0,n.roomWidth,view.width)
   if(axes&2)n.y=confine(pixel(y),0,n.roomHeight,view.height)
   n.script|=axes;n.returning=false;c=n;return true
  },
  /** axes 1 mirrors the cutscene glue (X only); default releases both. */
  scriptRelease(axes=3){if(c.ready&&(c.script&axes))c={...c,script:c.script&~axes,returning:true}},
  /** Raw Q8 state for parity checks and overlays. */
  state(){return {x:c.x,y:c.y,look:c.look,region:c.region,released:c.released,locked:c.locked?1:0,transition:c.transition?1:0,script:c.script,returning:c.returning?1:0}}
 }
}
