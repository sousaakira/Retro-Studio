import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { toTMX } from '../src/utils/retro/tmxFormat.js'
const source = fs.readFileSync(new URL('../src/composables/useTilemapEditorState.js', import.meta.url), 'utf8')
const ref = value => ({value})
const context = { mapWidthInternal: ref(8), mapHeightInternal: ref(8), TILE_SIZE_CONST: 8,
  rasterBindings: ref({fg:{assetId:'front',name:'Front',x:0,y:0}}), rasterImportName:ref('Front'),
  collisionMap:ref(Array(64).fill(31)), backgroundImage:ref({path:'bg.png'}), rasterMapBusy:ref(false),
  pushState(){}, t:key=>key, window:{retroStudioToast:{error:message=>errors.push(message)}} }
const errors=[]
for(const key of ['tiles','tiles2','flipHMap','flipVMap','paletteMap','priorityMap','flipHMap2','flipVMap2','paletteMap2']) context[key]=ref(Array(64).fill(0))
context.tiles2.value[9]=5;context.flipHMap2.value[9]=true;context.paletteMap2.value[9]=2
vm.createContext(context)
vm.runInContext(source.slice(source.indexOf('    function clearBackgroundImage()'),source.indexOf('    async function copyImageFileToProject')),context)
vm.runInContext(source.slice(source.indexOf('    function clearMapLayer('),source.indexOf('    function reportRasterImportError')),context)
context.positionForeground('x',16)
assert.equal(context.tiles2.value[11],5)
assert.equal(context.flipHMap2.value[11],true)
assert.equal(context.paletteMap2.value[11],2)
assert.equal(context.tiles2.value[9],0)
context.positionForeground('x',80)
assert.equal(errors.length,1)
assert.equal(context.tiles2.value[11],5,'Moving out of bounds must not lose art')
// Cenário (BG): passos de 8 px levam junto atributos e prioridade; colisões ficam no lugar.
context.tiles.value[9]=7;context.priorityMap.value[9]=1
assert.equal(await context.positionMapLayer('bg',{x:8,y:16}),true)
assert.equal(context.tiles.value[9+1+16],7);assert.equal(context.priorityMap.value[9+1+16],1);assert.equal(context.tiles.value[9],0)
assert.deepEqual({...context.mapLayerPosition('bg')},{x:8,y:16})
assert.equal(await context.positionMapLayer('bg',{x:8,y:16}),true,'same position is a no-op')
assert.equal(await context.positionMapLayer('bg',{x:-800,y:0}),false);assert.equal(errors.length,2)
context.tiles.value=Array(64).fill(0);context.priorityMap.value=Array(64).fill(0)
assert.equal(await context.positionMapLayer('bg',{x:0,y:0}),false,'an empty layer has nothing to place');assert.equal(errors.length,3)
// Fundo visual: guarda o deslocamento em pixels, sem mexer em tiles.
assert.equal(await context.positionMapLayer('background',{x:-3,y:5.4}),true)
assert.deepEqual({...context.mapLayerPosition('background')},{x:-3,y:5})
assert.equal(context.tiles2.value[11],5)
context.tiles.value[3]=7
context.clearMapLayer('fg')
assert(context.tiles2.value.every(v=>v===0))
assert.equal(context.tiles.value[3],7)
assert(context.collisionMap.value.every(v=>v===31),'Removing imagery preserves collisions')
assert.equal(context.rasterBindings.value.fg,undefined)
context.clearMapLayer('background')
assert.equal(context.backgroundImage.value,null)
const moved=toTMX({width:8,height:8,tiles:[],tilesets:[],background:{path:'bg.png',fit:'cover',opacity:1,offsetX:-3,offsetY:5}})
assert(moved.includes('name="retroStudio.backgroundOffsetX" type="int" value="-3"')&&moved.includes('name="retroStudio.backgroundOffsetY" type="int" value="5"'))
assert(!toTMX({width:8,height:8,tiles:[],tilesets:[],background:{path:'bg.png',fit:'cover',opacity:1}}).includes('backgroundOffset'),'no offset keeps older maps byte-compatible')
const xml=toTMX({width:8,height:8,tiles:[],tilesets:[],rasterBindings:{fg:{assetId:'front',x:16,y:8}}})
assert(!xml.includes('tileset.png'),'An image-only map must not reference a missing tileset')
assert(xml.includes('retroStudio.rasterBindings'))
console.log('smoke-map-layers: PASS (positions, attributes, clipping prevention, removal, collisions and metadata)')

context.assetPack=ref({rasterMaps:[{id:'scenery'},{id:'front'}]})
context.assetPackRasterMaps=ref({scenery:'/bg.png',front:'/fg.png'})
context.rasterMapBusy=ref(false)
context.saveRasterCatalog=async (pack,mappings)=>{context.assetPack.value=pack;context.assetPackRasterMaps.value=mappings;return true}
context.reportRasterImportError=error=>{throw error}
vm.runInContext(source.slice(source.indexOf('    async function removeKitRasterMap('), source.indexOf('    async function importRasterMapToKit(')),context)
context.rasterBindings.value={bg:{assetId:'scenery'},fg:{assetId:'front'}}
context.tiles.value[1]=3;context.tiles2.value[2]=4
await context.removeKitRasterMap({id:'scenery'})
assert(context.tiles.value.every(v=>v===0))
assert.equal(context.tiles2.value[2],4)
assert(context.collisionMap.value.every(v=>v===31))
assert.equal(context.assetPack.value.rasterMaps.length,1)
console.log('smoke-map-layers: linked catalog removal PASS')
