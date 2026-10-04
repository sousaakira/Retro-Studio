import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Exercise the real save function without loading Vue or Electron.
const source = readFileSync(new URL('../src/composables/useTilemapEditorState.js', import.meta.url), 'utf8')
const start = source.indexOf('    async function doSave(outPath) {')
const end = source.indexOf('    function toggleTileAttribute', start)
assert.ok(start >= 0 && end > start)
const writes = [], events = [], operations = [], toasts = []
let registrations = 0
const ref = value => ({ value })
const context = {
    userTilesets: ref([{name:'terrain',path:'/game/maps/terrain.png',firstgid:1,columns:16,tilecount:256}]),
    backgroundImage: ref(null), recentMaps: ref([]),
    saving: ref(false), mapWidth: ref(40), mapHeight: ref(28),
    props: { projectPath:'/game' },
    ensureTiles() {}, relativeImagePath: () => '../maps/terrain.png',
    rememberRecentTilemap: () => [],
    toTMX(data) { assert.equal(data.tilesets[0].path,'../maps/terrain.png'); assert.equal(data.background,null); return '<map />' },
    t(key) { return key },
    emit: name => events.push(name),
    window: {
      retroStudio: {
        ensureDirectory: async () => {},
        writeTextFile: async (path, text) => { writes.push({path,text}); operations.push('save') },
        retro: {
          updateTilemapResourceEntry: async () => { registrations++ },
          exportMapAfterSave: async (mapPath) => {
            assert.equal(mapPath, '/game/maps/first-room.tmx')
            operations.push('export')
            return { configured: true, exported: true }
          }
        }
      },
      retroStudioToast: {success(message) { toasts.push(message) }, error(error) { throw new Error(error) }}
    }
}
for (const key of ['tiles','tiles2','collisionMap','priorityMap','flipHMap','flipVMap','paletteMap','flipHMap2','flipVMap2','paletteMap2','objects']) context[key]=ref([])
vm.createContext(context)
vm.runInContext(source.slice(start,end),context)
await context.doSave('/game/maps/first-room.tmx')
assert.deepEqual(writes,[{path:'/game/maps/first-room.tmx',text:'<map />'}])
assert.deepEqual(operations, ['save', 'export'], 'Exporter runs only after TMX is written')
assert.equal(registrations,0,'Saving a TMX must not silently change resources.res')
assert.deepEqual(events,['saved'])
assert.deepEqual(toasts, ['tilemap.savedAndExported'])
assert.equal(context.saving.value,false)
console.log('smoke-map-save: PASS (TMX saved before configured game export)')
