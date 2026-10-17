import assert from 'node:assert/strict'
import { ref, effectScope } from 'vue'
import { AUTOTILE_FORMAT, validateAutotile, generateAutotiles, nineSliceRules, autotilePlacement } from '../src/utils/retro/autotileRules.js'
import { useAutotileAuthoring } from '../src/composables/useAutotileAuthoring.js'
const clone = value => JSON.parse(JSON.stringify(value))
const document = { format:AUTOTILE_FORMAT,version:1,tileSize:8,name:'Terrain',width:3,height:3,mask:Array(9).fill(1),rules:nineSliceRules(0,3,9) }
validateAutotile(document,9)
assert.deepEqual(generateAutotiles(document).tiles,[0,1,2,3,4,5,6,7,8])
const wildcard={name:'Base',tile:4,pattern:[-1,-1,-1,-1,1,-1,-1,-1,-1]}
const thin={...document,width:1,height:1,mask:[1],rules:[...document.rules,wildcard]}
assert.deepEqual(generateAutotiles(thin).tiles,[4])
assert.equal(generateAutotiles({...thin,rules:document.rules}).unmatched,1)
assert.equal(generateAutotiles({...thin,rules:[{...wildcard,enabled:false}]}).unmatched,1)
const diagonal={name:'Inner corner',tile:8,pattern:[0,1,-1,1,1,1,-1,1,-1]}
const hole={...document,mask:[0,1,1,1,1,1,1,1,1],rules:[diagonal,wildcard]}
assert.equal(generateAutotiles(hole).tiles[4],8,'Diagonal pattern selects the inner corner')
assert.equal(generateAutotiles({...hole,rules:[wildcard,diagonal]}).tiles[4],4,'Rule order is significant')
assert.throws(()=>nineSliceRules(1,3,9),/presetBounds/)
assert.throws(()=>validateAutotile({...document,mask:[1]},9),/invalidDocument/)
assert.throws(()=>validateAutotile({...document,rules:[{...wildcard,tile:9}]},9),/invalidRule/)
assert.throws(()=>validateAutotile({...document,rules:[{...wildcard,pattern:Array(9).fill(-1)}]},9),/invalidRule/)
const ts={id:'terrain',path:'/game/res/terrain.png',name:'Terrain',firstgid:100,columns:3,tilecount:9}
const output=generateAutotiles(document),placed=autotilePlacement(document,output,ts,{width:8,height:4,x:1,y:0,current:Array(32).fill(50)})
assert.equal(placed.cells[4].gid,104)
assert.equal(placed.replaced,9)
assert.throws(()=>autotilePlacement(document,output,ts,{width:8,height:4,x:7,y:0,current:[]}),/placementBounds/)

const history=[],state={projectPath:'/game',userTilesets:ref([ts]),selectedTileset:ref(ts),selectedTileRegion:ref({idx:0,w:1,h:1}),activeLayer:ref('bg'),selection:ref(null),mapWidth:ref(8),mapHeight:ref(4),loadingMap:ref(false),saving:ref(false),workspaceLeaving:ref(false),ensureTiles(){},pushState(){history.push(clone(this.tiles.value))}}
for(const key of ['tiles','tiles2','flipHMap','flipVMap','paletteMap','flipHMap2','flipVMap2','paletteMap2','collisionMap','priorityMap'])state[key]=ref(Array(32).fill(key.startsWith('flip')?true:key.startsWith('palette')?3:key==='tiles'?50:7))
state.objects=ref([{id:1,type:'player_spawn'}])
const scope=effectScope(),a=scope.run(()=>useAutotileAuthoring(state))
a.start()
a.chosenTile.value=8;a.preset(true)
assert.equal(a.draft.value.rules.length,10)
assert.ok(a.draft.value.rules.every(rule=>rule.tile===8),'Separate pieces can start at the final tile without requiring a contiguous block')
const scattered=[8,1,6,3,0,5,2,7,4]
a.draft.value.rules.slice(0,9).forEach((rule,index)=>{rule.tile=scattered[index]})
assert.deepEqual(generateAutotiles({...a.draft.value,width:3,height:3,mask:Array(9).fill(1)}).tiles,scattered,'Arbitrary atlas positions preserve corners, edges and center roles')
a.draft.value=clone(document);a.originX.value=1;a.originY.value=0;a.showOnMap.value=true
const before=clone(Object.fromEntries(['tiles','tiles2','collisionMap','priorityMap','paletteMap','objects'].map(k=>[k,state[k].value])))
assert.equal(a.preview.value.cells.length,9)
assert.equal(history.length,0,'Preview cannot create undo steps')
assert.deepEqual(state.tiles.value,before.tiles,'Preview cannot paint')
assert.equal(a.apply(),true)
assert.deepEqual(history[0],before.tiles)
assert.equal(history.length,2,'Application has before and after snapshots')
assert.equal(state.tiles.value[2*8+3],108)
assert.equal(state.tiles.value[0],50,'Empty shape cells preserve existing artwork')
for(const key of ['tiles2','collisionMap','priorityMap','paletteMap','objects'])assert.deepEqual(state[key].value,before[key],key+' must be preserved')
assert.equal(state.flipHMap.value[1],false)
assert.equal(state.flipHMap.value[0],true)
assert.equal(a.open.value,false)
a.open.value=true;a.originX.value=7
const painted=clone(state.tiles.value)
assert.equal(a.apply(),false);assert.deepEqual(state.tiles.value,painted,'Out-of-bounds application is atomic')
a.originX.value=1;a.draft.value.rules=[]
assert.equal(a.apply(),false)
a.draft.value=clone(document)
state.loadingMap.value=true;assert.equal(a.apply(),false);state.loadingMap.value=false
const originalWindow=globalThis.window;let raw=null,writes=0
globalThis.window={retroStudio:{retro:{selectSaveFile:async()=>({success:true,path:'/game/autotiles/terrain.json'}),selectFile:async()=>({success:true,path:'/game/autotiles/terrain.json'})},readTextFileOptional:async()=>raw,writeTextFile:async(_p,text)=>{raw=text;writes++}}}
try{
 await a.save();assert.equal(writes,1);assert.equal(JSON.parse(raw).source.path,'res/terrain.png')
 const valid=raw;a.draft.value.rules=[];await a.load();assert.equal(a.draft.value.rules.length,9)
 raw='changed by another editor';await a.save();assert.equal(a.error.value,'fileConflict');assert.equal(writes,1)
 raw=JSON.stringify({...JSON.parse(valid),mask:[1]});const current=clone(a.draft.value);await a.load();assert.deepEqual(a.draft.value,current,'Bad files cannot replace the draft')
}finally{globalThis.window=originalWindow;scope.stop()}
console.log('Autotile: corners/edges/center, diagonals, first-match order, bounds, immutable preview, atomic application, undo snapshots, attribute preservation and JSON roundtrip/conflicts passed.')
