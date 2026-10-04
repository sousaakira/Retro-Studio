import assert from 'node:assert/strict'
import { parseAssetPack, brushCells, relativeImagePath, normalizeAssetPath } from '../src/utils/retro/tilemapAssetPack.js'
import { toTMX } from '../src/utils/retro/tmxFormat.js'
const pack = { version:1, tileSize:8, tilesets:[{id:'a',file:'terrain.png'}], brushes:[{id:'floor',tileset:'a',x:2,y:1,w:2,h:2,layer:'bg',collision:'solid'}], objects:[{type:'exit',width:3,height:6,properties:{target:'next',enabled:true}}] }
assert.equal(parseAssetPack(JSON.stringify(pack)).brushes.length,1)
assert.throws(()=>parseAssetPack(JSON.stringify({...pack,tilesets:[{id:'a',file:'../outside.png'}]})))
assert.throws(()=>parseAssetPack(JSON.stringify({...pack,brushes:[{...pack.brushes[0],w:Infinity}]})))
assert.deepEqual(brushCells(pack.brushes[0],{firstgid:513,columns:32,tilecount:512}),[547,548,579,580])
assert.throws(()=>brushCells({...pack.brushes[0],x:31},{firstgid:1,columns:32,tilecount:512}))
assert.equal(relativeImagePath('/game/maps/first.tmx','/game/res/terrain.png'),'../res/terrain.png')
assert.equal(relativeImagePath('C:\\game\\maps\\first.tmx','C:\\game\\art\\forest.png'),'../art/forest.png')
const tmx=toTMX({width:2,height:2,tiles:[1,513,514,2],tilesets:[{name:'forest & stone',path:'../art/terrain.png',firstgid:1,columns:16,tilecount:256},{name:'props',path:'../art/objects.png',firstgid:513,columns:32,tilecount:512}],objects:[{id:42,name:'Gate "A"',type:'exit',x:3,y:4,width:5,height:6,properties:{target:'one&two',enabled:true,count:2}}]})
assert.match(tmx,/firstgid="513"[^>]*tilecount="512" columns="32"/)
assert.match(tmx,/source="..\/art\/objects.png" width="256" height="128"/)
assert.match(tmx,/width="40" height="48"/)
assert.match(tmx,/forest &amp; stone/)
assert.match(tmx,/Gate &quot;A&quot;/)
assert.match(tmx,/name="enabled" type="bool" value="true"/)
assert.match(tmx,/nextobjectid="43"/)
const backgroundTmx=toTMX({width:1,height:1,background:{path:'../res/sky & clouds.png',fit:'contain',opacity:0.65}})
assert.match(backgroundTmx,/name="retroStudio\.backgroundImage" value="\.\.\/res\/sky &amp; clouds\.png"/)
assert.match(backgroundTmx,/name="retroStudio\.backgroundFit" value="contain"/)
assert.match(backgroundTmx,/name="retroStudio\.backgroundOpacity" type="float" value="0\.65"/)
console.log('smoke-map-library: PASS')

assert.equal(normalizeAssetPath('/game/maps/../res/pack/terrain.png'),'/game/res/pack/terrain.png')
assert.match(toTMX({width:1,height:1,objects:[{id:1,properties:{dialogue:'line1\nline2\ttab'}}]}),/line1&#10;line2&#9;tab/)
