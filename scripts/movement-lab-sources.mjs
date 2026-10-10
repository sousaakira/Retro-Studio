import {compileMovementRoomHeader} from '../shared/retro/movementRoomHeader.js'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
export const repository=fileURLToPath(new URL('../',import.meta.url))
export const runtime=path.join(repository,'assets/toolkit/lib/runtime')
export const sourcePaths=[
 'scripts/movement-lab-sources.mjs','scripts/build-movement-lab.mjs','shared/retro/movementRoomHeader.js',
 'assets/toolkit/fixtures/movement-lab.c','shared/retro/movementRoom.json',
 'assets/toolkit/lib/runtime/core/retro_core.h',
 'assets/toolkit/lib/runtime/collision/retro_collision.h','assets/toolkit/lib/runtime/collision/retro_collision.c',
 'assets/toolkit/lib/runtime/collision/retro_slopes.h','assets/toolkit/lib/runtime/collision/retro_slopes.c',
 'assets/toolkit/lib/runtime/movement/retro_movement.h','assets/toolkit/lib/runtime/movement/retro_movement.c'
]
export function sourceHash(){
 const hash=createHash('sha256')
 for(const name of sourcePaths)hash.update(name+'\0').update(fs.readFileSync(path.join(repository,name)))
 hash.update('generated-room-header\0').update(roomHeader())
 return hash.digest('hex')
}
export function roomHeader(){
 const room=JSON.parse(fs.readFileSync(path.join(repository,'shared/retro/movementRoom.json'),'utf8'))
 return compileMovementRoomHeader(room)
}
export const sources=['collision/retro_collision.c','collision/retro_slopes.c','movement/retro_movement.c'].map(name=>path.join(runtime,name))
export const includeFlags=['core','collision','movement'].map(name=>'-I'+path.join(runtime,name))
