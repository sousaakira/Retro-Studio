import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { publishProjectOutputs, inspectPendingProjectExport, recoverProjectExport } from '../electron/retro/exportTransaction.js'
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-export-'))
try {
  const root = path.join(temporary, 'game')
  fs.mkdirSync(root)
  const make = (file, text) => ({ path: file, bytes: Buffer.from(text) })
  const bulk=Array.from({length:128},(_,index)=>make('bulk/'+index+'.bin','old'))
  const bulkReceipt=publishProjectOutputs(root,bulk,{producer:'bulk-limit'})
  assert.equal(bulkReceipt.changed.length,128)
  assert.throws(()=>publishProjectOutputs(root,[...bulk,make('bulk/129.bin','extra')]),{message:'Invalid export transaction.'})
  assert.throws(()=>publishProjectOutputs(root,bulk.map(item=>({...item,bytes:Buffer.from('new')})),{
    producer:'bulk-rollback',beforePublish(index){if(index===127)throw Error('bulk rollback')}
  }),/bulk rollback/)
  assert.ok(bulk.every(item=>fs.readFileSync(path.join(root,item.path),'utf8')==='old'))
  let receipt = publishProjectOutputs(root, [make('res/atlas.png', 'old'), make('inc/map.h', 'old header')], { producer: 'map' })
  assert.equal(receipt.changed.length, 2)
  const atlas = path.join(root, 'res/atlas.png')
  fs.utimesSync(atlas, new Date(1000), new Date(1000))
  const journalsBefore=fs.readdirSync(path.join(root,'.retrostudio/export-transactions')).length
  receipt = publishProjectOutputs(root, [make('res/atlas.png', 'old'), make('inc/map.h', 'old header')])
  assert.equal(receipt.reused.length, 2)
  assert.equal(receipt.transactionId,null)
  assert.equal(fs.readdirSync(path.join(root,'.retrostudio/export-transactions')).length,journalsBefore)
  assert.equal(fs.statSync(atlas).mtimeMs, 1000)
  const readBefore=fs.readFileSync
  let competingChecked=false
  fs.readFileSync=(target,...args)=>{
    if(target===atlas&&!competingChecked){
      competingChecked=true
      const competingSource='import {publishProjectOutputs} from '+JSON.stringify(new URL('../electron/retro/exportTransaction.js',import.meta.url).href)+
        ';try{publishProjectOutputs('+JSON.stringify(root)+',[{path:"res/atlas.png",bytes:Buffer.from("competitor")}]);process.exit(9)}catch(e){if(!e.message.includes("active"))throw e}'
      const competitor=spawnSync(process.execPath,['--input-type=module','-e',competingSource],{encoding:'utf8'})
      assert.equal(competitor.status,0,competitor.stderr)
    }
    return readBefore(target,...args)
  }
  try{receipt=publishProjectOutputs(root,[make('res/atlas.png','old'),make('inc/map.h','old header')])}
  finally{fs.readFileSync=readBefore}
  assert.equal(competingChecked,true)
  assert.equal(receipt.transactionId,null)
  assert.equal(fs.readFileSync(atlas,'utf8'),'old')

  assert.throws(() => publishProjectOutputs(root, [make('res/atlas.png', 'new'), make('inc/map.h', 'new header')],
    { beforePublish(index) { if (index === 1) throw new Error('injected failure') } }), /injected failure/)
  assert.equal(fs.readFileSync(atlas, 'utf8'), 'old')
  assert.equal(fs.readFileSync(path.join(root, 'inc/map.h'), 'utf8'), 'old header')
  assert.throws(() => publishProjectOutputs(root, [make('res/new.png', 'new'), make('inc/map.h', 'new')],
    { beforePublish(index) { if (index === 1) throw new Error('fail') } }))
  assert.ok(!fs.existsSync(path.join(root, 'res/new.png')))
  assert.throws(() => publishProjectOutputs(root, [{ ...make('res/atlas.png', 'x'), expectedHash: null }]), /revision changed/)
  assert.equal(fs.readFileSync(atlas, 'utf8'), 'old')
  assert.throws(() => publishProjectOutputs(root, [{path:'res/atlas.png',remove:true},make('inc/map.h','new')],
    {beforePublish(index){if(index===1)throw new Error('removal failure')}}),/removal failure/)
  assert.equal(fs.readFileSync(atlas,'utf8'),'old')
  publishProjectOutputs(root,[{path:'res/atlas.png',remove:true}])
  assert.ok(!fs.existsSync(atlas))
  publishProjectOutputs(root,[make('res/atlas.png','old')])
  assert.throws(() => publishProjectOutputs(root, [make('../outside', 'x')]))
  assert.throws(() => publishProjectOutputs(root, [make('res/x', 'x'), make('res/x', 'y')]))
  fs.symlinkSync(temporary, path.join(root, 'escape'))
  assert.throws(() => publishProjectOutputs(root, [make('escape/outside', 'x')]))
  fs.symlinkSync(path.join(temporary, 'missing'), path.join(root, 'res/broken'))
  assert.throws(() => publishProjectOutputs(root, [make('res/broken', 'x')]))
  assert.throws(() => publishProjectOutputs(root, [make('res/atlas.png', 'new'), make('inc/map.h', 'new')],
    { beforePublish(index) {
      if (index === 1) { fs.writeFileSync(atlas, 'external change'); throw new Error('fail') }
    } }), /requires recovery/)
  assert.equal(fs.readFileSync(atlas, 'utf8'), 'external change')
  assert.ok(fs.existsSync(path.join(root, '.retrostudio/export.lock')))
  assert.throws(() => publishProjectOutputs(root, [make('res/atlas.png', 'x')]), /requires recovery/)
  const journals = fs.readdirSync(path.join(root, '.retrostudio/export-transactions'))
    .map(id => JSON.parse(fs.readFileSync(path.join(root, '.retrostudio/export-transactions', id, 'journal.json'))))
  assert.ok(journals.some(journal => journal.state === 'rolled-back'))
  assert.ok(journals.some(journal => journal.state === 'recovery-required'))
  const pending = inspectPendingProjectExport(root)
  assert.equal(pending.active, false)
  assert.throws(() => recoverProjectExport(root, pending.transactionId), /conflict/)
  assert.equal(fs.readFileSync(atlas, 'utf8'), 'external change')
  fs.writeFileSync(atlas, 'new')
  const recovered = recoverProjectExport(root, pending.transactionId)
  assert.ok(recovered.restored.includes('res/atlas.png'))
  assert.equal(fs.readFileSync(atlas, 'utf8'), 'old')
  assert.equal(inspectPendingProjectExport(root).pending, false)
  publishProjectOutputs(root, [make('res/atlas.png', 'after recovery')])
  const moduleUrl = new URL('../electron/retro/exportTransaction.js', import.meta.url).href
  const childSource = 'import { publishProjectOutputs } from ' + JSON.stringify(moduleUrl) +
    '; publishProjectOutputs(' + JSON.stringify(root) +
    ', [{path:"res/atlas.png",bytes:Buffer.from("interrupted")},{path:"inc/map.h",bytes:Buffer.from("interrupted header")}],{beforePublish(index){if(index===1)process.exit(23)}})'
  const interrupted = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], { encoding: 'utf8' })
  assert.equal(interrupted.status, 23, interrupted.stderr)
  assert.equal(fs.readFileSync(atlas, 'utf8'), 'interrupted')
  const crashed = inspectPendingProjectExport(root)
  assert.equal(crashed.active, false)
  const claimsDirectory = path.join(root, '.retrostudio/export-recovery')
  fs.mkdirSync(claimsDirectory, { recursive: true })
  const liveClaim = path.join(claimsDirectory, 'live.json')
  fs.writeFileSync(liveClaim, JSON.stringify({ version: 1, pid: process.pid, transactionId: crashed.transactionId }))
  assert.equal(inspectPendingProjectExport(root).active, true)
  assert.throws(() => recoverProjectExport(root, crashed.transactionId), /still active/)
  fs.unlinkSync(liveClaim)
  const recoveryChildSource = 'import fs from "node:fs"; import { recoverProjectExport } from ' + JSON.stringify(moduleUrl) +
    '; const rename=fs.renameSync; fs.renameSync=(source,target)=>{rename(source,target);if(target===' + JSON.stringify(atlas) +
    ')process.exit(24)}; recoverProjectExport(' + JSON.stringify(root) + ',' + JSON.stringify(crashed.transactionId) + ')'
  const interruptedRecovery = spawnSync(process.execPath, ['--input-type=module', '-e', recoveryChildSource], { encoding: 'utf8' })
  assert.equal(interruptedRecovery.status, 24, interruptedRecovery.stderr)
  assert.equal(inspectPendingProjectExport(root).active, false)
  assert.ok(fs.readdirSync(claimsDirectory).some(name => name.endsWith('.json')))
  recoverProjectExport(root, crashed.transactionId)
  assert.equal(fs.readFileSync(atlas, 'utf8'), 'after recovery')
  assert.equal(fs.readFileSync(path.join(root, 'inc/map.h'), 'utf8'), 'old header')
  assert.equal(inspectPendingProjectExport(root).pending, false)
  const preparationChildSource='import fs from "node:fs"; import { publishProjectOutputs } from '+JSON.stringify(moduleUrl)+
    '; const write=fs.writeFileSync; fs.writeFileSync=(target,...args)=>{write(target,...args);if(String(target).endsWith(".before"))process.exit(25)}; publishProjectOutputs('+
    JSON.stringify(root)+',[{path:"res/atlas.png",bytes:Buffer.from("should not publish")}])'
  const interruptedPreparation=spawnSync(process.execPath,['--input-type=module','-e',preparationChildSource],{encoding:'utf8'})
  assert.equal(interruptedPreparation.status,25,interruptedPreparation.stderr)
  const preparing=inspectPendingProjectExport(root)
  assert.equal(preparing.state,'preparing')
  assert.equal(preparing.outputs.length,0)
  assert.equal(fs.readFileSync(atlas,'utf8'),'after recovery')
  recoverProjectExport(root,preparing.transactionId)
  assert.equal(inspectPendingProjectExport(root).pending,false)
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
console.log('Export transaction: incremental writes, rollback, snapshots, concurrent change and path confinement passed.')
