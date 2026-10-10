import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { toTMX } from '../src/utils/retro/tmxFormat.js'
const source = fs.readFileSync(new URL('../src/composables/useTilemapEditorState.js', import.meta.url), 'utf8')
const ref = value => ({value})
const context = { mapWidthInternal: ref(8), mapHeightInternal: ref(8), TILE_SIZE_CONST: 8,
  rasterBindings: ref({fg:{assetId:'front',name:'Front',x:0,y:0}}), rasterImportName:ref('Front'),
  collisionMap:ref(Array(64).fill(31)), backgroundImage:ref({path:'bg.png'}),
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
context.tiles.value[3]=7
context.clearMapLayer('fg')
assert(context.tiles2.value.every(v=>v===0))
assert.equal(context.tiles.value[3],7)
assert(context.collisionMap.value.every(v=>v===31),'Removing imagery preserves collisions')
assert.equal(context.rasterBindings.value.fg,undefined)
context.clearMapLayer('background')
assert.equal(context.backgroundImage.value,null)
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
