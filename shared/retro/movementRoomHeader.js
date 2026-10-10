// Canonical room compiler shared by browser-WASM build and SGDK diagnostics.
export function compileMovementRoomHeader(room){
 const rect=item=>'{'+['x','y','width','height'].map(key=>item[key]).join(',')+'}'
 return '#define LAB_SPAWN_X '+room.spawn.x+'\n#define LAB_SPAWN_Y '+room.spawn.y+'\n'+
  '#define LAB_BODY '+rect(room.body)+'\n#define LAB_COLLIDER_COUNT '+room.colliders.length+'\n'+
  '#define LAB_SLOPE_COUNT '+room.slopes.length+'\n'+
  'static const RetroCollider labColliders[]={'+room.colliders.map(c=>'{'+rect(c)+','+c.group+','+c.kind+'}').join(',')+'};\n'+
  'static const RetroSlope labSlopes[]={'+room.slopes.map(s=>'{'+rect(s)+','+s.group+','+s.leftHeight+','+s.rightHeight+'}').join(',')+'};\n'
}
