import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {writeProjectAsset,assetContentHash} from '../electron/retro/projectAssets.js'
import {readGeneratedAssetLedger} from '../electron/retro/generatedAssetLedger.js'
import {planAssetQuarantine,quarantineProjectAssets,restoreAssetQuarantine,listAssetQuarantines} from '../electron/retro/assetQuarantine.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'retro-quarantine-'))
try{
  fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({custom:'preserve',assets:[]}))
  const bytes=Buffer.from('owned fixture')
  const asset=writeProjectAsset(root,'res','generated/raster-'+assetContentHash(bytes)+'.png',bytes)
  fs.writeFileSync(path.join(root,'res/ninja.png'),'original ninja')
  fs.writeFileSync(path.join(root,'tool.py'),'open(input())')
  fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({custom:'preserve',assets:[{id:'owned',path:asset.assetPath}]}))
  assert.throws(()=>planAssetQuarantine(root,['res/ninja.png']))
  const plan=planAssetQuarantine(root,[asset.assetPath])
  assert.ok(plan.warnings.dynamicSources.includes('tool.py'))
  assert.throws(()=>quarantineProjectAssets(root,[asset.assetPath],'stale'))
  assert.throws(()=>quarantineProjectAssets(root,[asset.assetPath],plan.planId,{beforePublish(index){if(index===2)throw Error('fail')}}))
  assert.deepEqual(fs.readFileSync(path.join(root,asset.assetPath)),bytes)
  assert.equal(readGeneratedAssetLedger(root).assets.length,1)
  const removed=quarantineProjectAssets(root,[asset.assetPath],plan.planId)
  assert.ok(!fs.existsSync(path.join(root,asset.assetPath)))
  assert.equal(readGeneratedAssetLedger(root).assets.length,0)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'retro-studio.json'))).assets.length,0)
  assert.equal(listAssetQuarantines(root).find(item=>item.id===removed.quarantineId).status,'quarantined')
  const config=JSON.parse(fs.readFileSync(path.join(root,'retro-studio.json')))
  config.custom='new edits'; config.assets.push({id:'other',path:'res/ninja.png'})
  fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify(config))
  fs.writeFileSync(path.join(root,asset.assetPath),'external replacement')
  assert.throws(()=>restoreAssetQuarantine(root,removed.quarantineId),/already exists/)
  assert.equal(fs.readFileSync(path.join(root,asset.assetPath),'utf8'),'external replacement')
  fs.unlinkSync(path.join(root,asset.assetPath))
  restoreAssetQuarantine(root,removed.quarantineId)
  assert.deepEqual(fs.readFileSync(path.join(root,asset.assetPath)),bytes)
  assert.equal(readGeneratedAssetLedger(root).assets.length,1)
  const restored=JSON.parse(fs.readFileSync(path.join(root,'retro-studio.json')))
  assert.equal(restored.custom,'new edits')
  assert.equal(restored.assets.length,2)
  assert.equal(fs.readFileSync(path.join(root,'res/ninja.png'),'utf8'),'original ninja')
  assert.throws(()=>restoreAssetQuarantine(root,removed.quarantineId),/already restored/)
  fs.writeFileSync(path.join(root,'res/resources.res'),'IMAGE IN_USE "'+asset.assetPath.replace(/^res\//,'')+'" 0')
  assert.throws(()=>planAssetQuarantine(root,[asset.assetPath]),/apparently unreferenced/)
}finally{fs.rmSync(root,{recursive:true,force:true})}
console.log('Asset quarantine: ownership, reference refusal, rollback, restore, conflicts, inventory merge and original Ninja passed.')
