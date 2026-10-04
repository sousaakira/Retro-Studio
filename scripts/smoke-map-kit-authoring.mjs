import assert from 'node:assert/strict'
import { ref, computed } from 'vue'
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { useMapPackAuthoring } from '../src/composables/useMapPackAuthoring.js'
import { parseAssetPack, brushCells, inferObjectCategory } from '../src/utils/retro/tilemapAssetPack.js'
const root = await mkdtemp(join(tmpdir(),'map-kit-test-'))
try {
    for (const dir of ['a','b','export']) await mkdir(join(root,dir))
    for (const dir of ['a','b']) await writeFile(join(root,dir,'árvore.png'),dir)
    const state = {
        assetPack:ref(null),assetPackPath:ref(''),assetPackTilesets:ref({}),selectedPackBrush:ref(null),
        objectTemplateIndex:ref(0),selectedObject:ref(null),rememberSavedKit:async()=>{},
        selectedTileset:ref({path:join(root,'a','árvore.png'),columns:16,tilecount:256,firstgid:1}),
        selectedTileRegion:ref({idx:18,w:3,h:2}),projectPath:root
    }
    state.userTilesets=ref([state.selectedTileset.value])
    state.objectTemplates=computed(()=>state.assetPack.value?.objects || [{name:'Spawn',type:'player_spawn',width:2,height:5,properties:{}}])
    let output=join(root,'export','kit.json'),cancel=false,failCopy=false
    globalThis.window={retroStudio:{
        retro:{selectSaveFile:async()=>({success:!cancel,path:output})},
        copyFileFromExternal:async(source,dest)=>{
            if(failCopy)throw Error('copy failed')
            await mkdir(dest,{recursive:true});await copyFile(source,join(dest,basename(source)))
        },writeTextFile:writeFile
    },retroStudioToast:{success(){}}}
    const a=useMapPackAuthoring(state,key=>key)
    a.openAuthoring();assert.equal(state.assetPack.value.objects.length,1)
    a.brushDraft.value={name:'Floor',category:'Terrain',layer:'bg',collision:'solid'}
    a.saveBrush();assert.equal(a.error.value,'');assert.equal(state.assetPack.value.brushes[0].x,2)
    assert.deepEqual(brushCells(state.assetPack.value.brushes[0],state.selectedTileset.value),[19,20,21,35,36,37])
    const before=JSON.stringify(state.assetPack.value)
    state.selectedTileRegion.value={idx:15,w:4,h:2};a.brushDraft.value.name='Invalid';a.saveBrush()
    assert.ok(a.error.value);assert.equal(JSON.stringify(state.assetPack.value),before)
    a.editBrush(state.assetPack.value.brushes[0]);a.brushDraft.value.name='Updated';a.saveBrush()
    assert.equal(state.assetPack.value.brushes[0].name,'Updated')
    state.selectedTileset.value={...state.selectedTileset.value,path:join(root,'b','árvore.png'),firstgid:257}
    state.selectedTileRegion.value={idx:0,w:2,h:2};a.brushDraft.value.name='Decoration';a.saveBrush()
    assert.equal(state.assetPack.value.tilesets.length,2)
    state.selectedObject.value={name:'Gate',type:'room_exit',x:10,y:12,width:3,height:6,properties:{target:'next',enabled:true}}
    a.addObjectTemplate();assert.equal(state.assetPack.value.objects[1].properties.enabled,true)
    assert.ok(!('x' in state.assetPack.value.objects[1]))
    state.selectedTileset.value={...state.selectedTileset.value,path:join(root,'b','árvore.png'),columns:16,tilecount:256,firstgid:257}
    state.userTilesets.value=[state.selectedTileset.value]
    assert.equal(a.saveObjectTemplate({name:'Healing potion',type:'pickup',category:'item',width:2,height:2,properties:{item:'health'},visual:{tilesetId:state.selectedTileset.value.id,x:4,y:3,w:2,h:2,frames:4,fps:6,loop:true}}),true)
    await a.exportPack();assert.equal(a.error.value,'');assert.equal(a.exporting.value,false)
    const pack=parseAssetPack(await readFile(output,'utf8'))
    parseAssetPack(JSON.stringify({...pack,tilesets:pack.tilesets.map(ts=>({...ts,file:ts.file.normalize('NFD')}))}))
    assert.equal(pack.brushes.length,2);assert.equal(pack.objects[2].visual.frames,4);assert.equal(pack.objects[2].properties.item,'health');assert.notEqual(pack.tilesets[0].file,pack.tilesets[1].file)
    assert.ok(pack.objects[2].visual.tileset)
    assert.equal(await readFile(join(root,'export',pack.tilesets[0].file),'utf8'),'a')
    assert.equal(await readFile(join(root,'export',pack.tilesets[1].file),'utf8'),'b')
    cancel=true;output=join(root,'export','cancel.json');await a.exportPack()
    await assert.rejects(readFile(output));assert.equal(a.exporting.value,false)
    cancel=false;failCopy=true;output=join(root,'export','failure.json');await a.exportPack()
    assert.equal(a.error.value,'copy failed');await assert.rejects(readFile(output))
    a.removeBrush(state.assetPack.value.brushes[0].id);assert.equal(state.assetPack.value.brushes.length,1)
    a.removeObjectTemplate(0);assert.equal(state.assetPack.value.objects.length,2)
    assert.throws(()=>parseAssetPack(JSON.stringify({...pack,tilesets:[{id:'x',file:'../escape.png'}]})))
    assert.equal(inferObjectCategory({type:'pickup',properties:{item:'health'}}),'item')
    assert.equal(inferObjectCategory({type:'enemy'}),'enemy')
    assert.equal(inferObjectCategory({type:'room_exit'}),'interaction')
    console.log('smoke-map-kit-authoring: PASS (creation, region bounds, edit, object templates, portable export, duplicate filenames, cancel and failed copy)')
} finally { await rm(root,{recursive:true,force:true}) }
