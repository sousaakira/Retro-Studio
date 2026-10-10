import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { inspectCompiledResources, parseM68kElf, resourceBudget, saveHardwareBudget } from '../electron/retro/compiledResources.js'
import { beginBuildSnapshot, finishBuildSnapshot } from '../electron/retro/buildSnapshot.js'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-hardware-report-'))
function syntheticElf() {
  const data = Buffer.alloc(1024)
  const u16 = (offset, value) => data.writeUInt16BE(value, offset)
  const u32 = (offset, value) => data.writeUInt32BE(value, offset)
  u16(0,16); u16(2,16); u32(4,0x1020); u16(8,1); u32(10,0x1030); u16(14,4); u16(16,1)
  u16(0x20,16); u32(0x22,0x1100)
  u32(0x30,0x1038); data[0x38]=2; data[0x39]=0; u32(0x3a,0x1060)
  u16(0x40,0); u16(0x42,4); u32(0x44,0x1200)
  u16(0x50,0); u16(0x52,2); u32(0x54,0x1280)
  u32(0x60,0x1080); u32(0x64,0x10a0)
  data[0x80]=1; data[0x81]=8; u32(0x82,0x1040)
  data[0xa0]=1; data[0xa1]=8; u32(0xa2,0x1050)
  u16(0x102,0x0eee)
  const stringNames = ['', 'NINJA', 'BG_TILES', 'OBJECT_PAL']
  const strings = Buffer.from(stringNames.join('\0')+'\0')
  const symbols = Buffer.alloc(64)
  let nameOffset=1
  for (let i=0;i<3;i++) {
    const offset=(i+1)*16
    symbols.writeUInt32BE(nameOffset,offset); nameOffset+=stringNames[i+1].length+1
    symbols.writeUInt32BE([0x1000,0x1040,0x1020][i],offset+4)
    symbols.writeUInt32BE([18,8,6][i],offset+8); symbols[offset+12]=0x11; symbols.writeUInt16BE(1,offset+14)
  }
  const names = ['', '.rodata', '.data', '.bss', '.strtab', '.symtab', '.shstrtab']
  const sectionNames = Buffer.from(names.join('\0')+'\0')
  const definitions = [
    {type:0,flags:0,address:0,bytes:Buffer.alloc(0)},
    {type:1,flags:2,address:0x1000,bytes:data},
    {type:1,flags:3,address:0xff0018,bytes:Buffer.alloc(8)},
    {type:8,flags:3,address:0xff0000,bytes:Buffer.alloc(0),size:24},
    {type:3,flags:0,address:0,bytes:strings},
    {type:2,flags:0,address:0,bytes:symbols,link:4,entrySize:16},
    {type:3,flags:0,address:0,bytes:sectionNames}
  ]
  let position=52
  for(const item of definitions){ item.offset=position; position+=item.bytes.length }
  const table=position, elf=Buffer.alloc(table+definitions.length*40)
  Buffer.from('7f454c4601020100','hex').copy(elf)
  elf.writeUInt16BE(2,16); elf.writeUInt16BE(4,18); elf.writeUInt32BE(1,20)
  elf.writeUInt32BE(table,32); elf.writeUInt16BE(52,40); elf.writeUInt16BE(40,46)
  elf.writeUInt16BE(definitions.length,48); elf.writeUInt16BE(6,50)
  nameOffset=0
  for(let i=0;i<definitions.length;i++){
    const item=definitions[i], offset=table+i*40
    elf.writeUInt32BE(nameOffset,offset); nameOffset+=names[i].length+1
    for(const [field,value] of [[4,item.type],[8,item.flags],[12,item.address],[16,item.offset],[20,item.size??item.bytes.length],[24,item.link||0],[36,item.entrySize||0]]) elf.writeUInt32BE(value,offset+field)
    item.bytes.copy(elf,item.offset)
  }
  return elf
}
function run(command,args,cwd){
  const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
  assert.equal(result.status,0,result.error?.message||String(result.stdout).slice(-8000)+String(result.stderr).slice(-8000))
}
try {
  const root=path.join(temporary,'game')
  fs.mkdirSync(path.join(root,'res'),{recursive:true}); fs.mkdirSync(path.join(root,'out'))
  fs.writeFileSync(path.join(root,'res/resources.res'),'SPRITE NINJA "ninja.png" 2 2 NONE 8 NONE\nTILESET BG_TILES "ninja.png" NONE\nPALETTE OBJECT_PAL "ninja.png"\n')
  const png=Buffer.alloc(24); Buffer.from('89504e470d0a1a0a','hex').copy(png); png.writeUInt32BE(32,16); png.writeUInt32BE(16,20)
  fs.writeFileSync(path.join(root,'res/ninja.png'),png)
  const original=fs.readFileSync(path.join(root,'res/ninja.png'))
  let report=inspectCompiledResources(root)
  assert.equal(report.staticRAM,null); assert.equal(report.elf,null)
  assert.equal(report.resources[0].status,'not-built')
  fs.writeFileSync(path.join(root,'out/rom.out'),syntheticElf())
  fs.writeFileSync(path.join(root,'out/rom.bin'),Buffer.alloc(1024))
  report=inspectCompiledResources(root)
  assert.equal(report.resources[0].status,'unknown-abi')
  assert.equal(report.staticRAM,32)
  const extended=syntheticElf(), extendedTable=extended.readUInt32BE(32)
  extended.writeUInt32BE(0xffff0018,extendedTable+2*40+12)
  extended.writeUInt32BE(0xffff0000,extendedTable+3*40+12)
  fs.writeFileSync(path.join(root,'out/rom.out'),extended)
  const signExtended=inspectCompiledResources(root)
  assert.equal(signExtended.staticRAM,32,'68000 RAM addresses normalize from SGDK sign extension')
  assert.equal(signExtended.sections.find(section=>section.name==='.bss').address,0xff0000)
  fs.writeFileSync(path.join(root,'out/rom.out'),syntheticElf())
  report=inspectCompiledResources(root,{abi:'sgdk-1.81'})
  assert.equal(report.freshness,'unknown')
  assert.equal(report.abiEvidence,'explicit-reader-assumption')
  assert.equal(report.rom.size,1024)
  const ninja=report.resources[0]
  assert.equal(ninja.status,'compiled')
  assert.equal(ninja.facts.maxNumTile,4)
  assert.equal(ninja.facts.frameCount,2)
  assert.equal(ninja.authoring.gridTiles,8)
  assert.equal(ninja.facts.paletteWords[1],0x0eee)
  assert.equal(report.resources[1].facts.tilePayloadRomBytes,128)
  const budget=resourceBudget(report.resources,{videoMode:'H32',consumers:[
    {resourceId:'NINJA',instances:3,mode:'sprite-stream'}, {resourceId:'BG_TILES',instances:1,mode:'tiles-resident'}
  ],reservations:[{id:'planeA',start:0xe000,bytes:4096}]})
  assert.equal(budget.plannedTileBytes,16*32, 'sprite frames reuse four tiles per instance, not six tiles for all frames')
  assert.equal(budget.plannedHardwareSprites,3)
  assert.equal(budget.limits.hardwareSprites,64)
  assert.equal(budget.limits.spritesPerLine,16)
  assert.equal(budget.occupancy,'planning-only')
  const plan=resourceBudget(report.resources,{planes:{width:64,height:32},tileArena:{start:512,bytes:256},
    consumers:[{resourceId:'NINJA',instances:3,mode:'sprite-stream'}]})
  assert.equal(plan.planes.nameTableBytesEach,4096)
  assert.ok(plan.warnings.includes('tile-arena-capacity'))
  assert.throws(()=>resourceBudget([],{planes:{width:128,height:128}}),/invalid-plane/)
  assert.throws(()=>resourceBudget([],{tileArena:{start:1,bytes:32}}),/invalid-tile/)
  assert.ok(resourceBudget([],{tileArena:{start:0,bytes:32},reservations:[{id:'sys',start:0,bytes:32}]}).warnings.includes('tile-arena-overlap'))
  const unknown=resourceBudget(report.resources,{consumers:[{resourceId:'MISSING',instances:1,mode:'sprite-stream'}]})
  assert.equal(unknown.plannedTileBytes,null); assert.equal(unknown.plannedHardwareSprites,null)
  assert.ok(resourceBudget(report.resources,{consumers:[{resourceId:'NINJA',instances:81,mode:'sprite-stream'}]}).warnings.includes('sprite-table-limit'))
  assert.ok(resourceBudget(report.resources,{reservations:[{id:'a',start:0,bytes:65536}],consumers:[{resourceId:'BG_TILES',instances:1,mode:'tiles-resident'}]}).warnings.includes('vram-capacity-limit'))
  assert.ok(resourceBudget(report.resources,{reservations:[{id:'a',start:0,bytes:16},{id:'b',start:8,bytes:16}]}).warnings.includes('overlapping-reservations'))
  assert.throws(()=>resourceBudget([],{videoMode:'H50'}),/invalid-budget/)
  assert.throws(()=>resourceBudget([],{consumers:[{resourceId:'NINJA',instances:-1,mode:'sprite-stream'}]}),/invalid-resource/)
  assert.throws(()=>resourceBudget([],{reservations:[{id:'a',start:65536,bytes:1}]}),/invalid-vram/)
  assert.throws(()=>inspectCompiledResources(root,{abi:'sgdk-2.20'}),/unsupported-resource-abi/)
  for(const mutation of [bytes=>{bytes[4]=2},bytes=>{bytes.writeUInt32BE(0xffffffff,32)},bytes=>{bytes.writeUInt16BE(0xffff,48)},bytes=>{bytes.writeUInt16BE(62,18)}]){
    const invalid=syntheticElf(); mutation(invalid); assert.throws(()=>parseM68kElf(invalid))
  }
  assert.throws(()=>parseM68kElf(Buffer.alloc(32)))
  assert.throws(()=>parseM68kElf(syntheticElf()).data(-1,4),/invalid-elf-read/)
  const corrupted=syntheticElf(); corrupted.writeUInt32BE(0xdeadbeef,52+10)
  fs.writeFileSync(path.join(root,'out/rom.out'),corrupted)
  const invalidResource=inspectCompiledResources(root,{abi:'sgdk-1.81'})
  assert.equal(invalidResource.resources[0].status,'unreadable-resource')
  fs.writeFileSync(path.join(root,'out/rom.out'),syntheticElf())
  fs.symlinkSync(path.join(temporary,'private.out'),path.join(root,'out/rom.elf'))
  fs.writeFileSync(path.join(temporary,'private.out'),syntheticElf()); fs.unlinkSync(path.join(root,'out/rom.out'))
  const confined=inspectCompiledResources(root)
  assert.equal(confined.elf,null); assert.ok(confined.diagnostics.some(item=>item.code==='outside-project'))
  assert.deepEqual(fs.readFileSync(path.join(root,'res/ninja.png')),original)
  fs.writeFileSync(path.join(root,'retro-studio.json'),'null')
  assert.ok(inspectCompiledResources(root).diagnostics.some(item=>item.code==='invalid-report-config'))
  fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({hardwareBudget:{planes:{width:128,height:128}}}))
  assert.equal(inspectCompiledResources(root).budget.invalid,true)
  fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({hardwareBudget:{resourceAbi:'sgdk-2.20'}}))
  assert.equal(inspectCompiledResources(root).abi,null)
  assert.ok(inspectCompiledResources(root).diagnostics.some(item=>item.code==='unsupported-resource-abi'))

  {
  const configPath=path.join(root,'retro-studio.json')
  for (const malformed of [{reservations:[null]}, {consumers:[null]}, {planes:true}]) {
    fs.writeFileSync(configPath,JSON.stringify({hardwareBudget:malformed}))
    assert.equal(inspectCompiledResources(root).configuration.editable,false,'malformed budget rows cannot enter the editor')
  }
  fs.writeFileSync(configPath,JSON.stringify({name:'Keep me',custom:{audio:7},hardwareBudget:{videoMode:'H40'}}))
  const revision=inspectCompiledResources(root).configuration.revision
  const budget={videoMode:'H32',resourceAbi:'sgdk-1.81',reservations:[{id:'font',start:512,bytes:3072}],consumers:[{resourceId:'NINJA',mode:'sprite-stream',instances:2}],extension:{keep:true}}
  const saved=saveHardwareBudget(root,{revision,budget})
  assert.equal(saved.success,true)
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath)),{name:'Keep me',custom:{audio:7},hardwareBudget:budget})
  assert.equal(inspectCompiledResources(root).configuration.revision,saved.revision)
  assert.equal(saveHardwareBudget(root,{revision:saved.revision,budget}).transactionId,null,'unchanged saves create no transaction')
  const unchanged=fs.readFileSync(configPath)
  assert.throws(()=>saveHardwareBudget(root,{revision,budget}),/budget-config-changed/)
  for(const invalid of [{...budget,resourceAbi:'other'},{...budget,consumers:[{resourceId:'',instances:1,mode:'sprite-stream'}]},{...budget,tileArena:{start:65536,bytes:32}}])
    assert.throws(()=>saveHardwareBudget(root,{revision:saved.revision,budget:invalid}))
  assert.deepEqual(fs.readFileSync(configPath),unchanged,'invalid or stale saves preserve the configuration')
  fs.writeFileSync(configPath,'{broken')
  assert.equal(inspectCompiledResources(root).configuration.editable,false)
  assert.throws(()=>saveHardwareBudget(root,{revision:null,budget}))
  assert.equal(fs.readFileSync(configPath,'utf8'),'{broken')
  const fresh=path.join(temporary,'fresh');fs.mkdirSync(fresh)
  assert.equal(inspectCompiledResources(fresh).configuration.revision,null)
  assert.equal(saveHardwareBudget(fresh,{revision:null,budget}).success,true)
  const linked=path.join(temporary,'linked');fs.mkdirSync(linked)
  fs.symlinkSync(configPath,path.join(linked,'retro-studio.json'))
  assert.throws(()=>saveHardwareBudget(linked,{revision:null,budget}))
  assert.equal(fs.readFileSync(configPath,'utf8'),'{broken','symlink targets are preserved')
  console.log('Hardware plan saves preserve unrelated settings, guard revisions, reuse unchanged output and reject invalid JSON, ranges and symlinks.')
  }
  const sdkIndex=process.argv.indexOf('--sgdk')
  if(sdkIndex>=0){
    const sdk=path.resolve(process.argv[sdkIndex+1]), actual=path.join(temporary,'actual')
    fs.mkdirSync(path.join(actual,'res'),{recursive:true}); fs.mkdirSync(path.join(actual,'src'))
    run('python3',['-c',[
      'from PIL import Image',"im=Image.new('P',(32,16),0)",'im.putpalette([0,0,0,255,128,0]+[0]*762)',
      'for y in range(16):',' for x in range(32):','  im.putpixel((x,y),1 if (x%16)>1 and y>1 else 0)',
      'im.save('+JSON.stringify(path.join(actual,'res/ninja.png'))+',bits=4)'
    ].join('\n')])
    fs.writeFileSync(path.join(actual,'res/resources.res'),'SPRITE NINJA "ninja.png" 2 2 NONE 8 NONE\nTILESET BG_TILES "ninja.png" NONE\nPALETTE OBJECT_PAL "ninja.png"\n')
    fs.writeFileSync(path.join(actual,'src/main.c'),[
      '#include <genesis.h>','#include "resources.h"',
      'int main(void){SPR_initEx(8);SPR_addSprite(&NINJA,40,40,TILE_ATTR(PAL1,1,0,0));',
      'VDP_loadTileSet(&BG_TILES,TILE_USER_INDEX,DMA);PAL_setPalette(PAL1,OBJECT_PAL.data,DMA);',
      'while(1){SPR_update();SYS_doVBlankProcess();}return 0;}',''
    ].join('\n'))
    fs.writeFileSync(path.join(actual,'Makefile'),'export GDK := '+sdk+'\ninclude $(GDK)/makefile.gen\n')
    const buildStart=beginBuildSnapshot(actual)
    run('make',['release'],actual)
    assert.equal(finishBuildSnapshot(actual,buildStart,path.join(actual,'out/rom.bin')).status,'recorded')
    const real=inspectCompiledResources(actual,{abi:'sgdk-1.81'})
    assert.ok(real.elf)
    assert.equal(real.buildSnapshot.artifactAssociation,'matches-displayed-artifacts')
    assert.ok(real.staticRAM>0,JSON.stringify(real.sections))
    assert.equal(real.resources[0].status,'compiled',JSON.stringify(real.diagnostics))
    assert.equal(real.resources[0].facts.frameCount,2)
    assert.equal(real.resources[0].facts.maxNumTile,4)
    assert.equal(real.resources[0].facts.width,16)
    assert.equal(real.resources[2].status,'compiled')
    assert.equal(real.resources[2].facts.paletteEntries,16)
    console.log('Real ResComp/68000 ELF inspected: ROM '+real.rom.size+' B, static RAM '+real.staticRAM+' B, sprite 4 tiles / 2 frames.')
  }
  const renderer=fs.readFileSync(new URL('../src/components/retro/HardwareReport.vue',import.meta.url),'utf8')
  assert.match(renderer,/sequence\+\+/)
  assert.match(renderer,/showModal\(\)/)
  assert.match(renderer,/onBeforeUnmount\(\(\) => \{ sequence\+\+; dialog\.value\?\.close\(\)/)
  assert.match(renderer,/if \(abi\.value\) \{ sequence\+\+; abi\.value = ''; return \}/)
  assert.match(renderer,/request !== sequence/)
  // #51: suggested actions come only from compiled facts and name the resource and its source file.
  {const {resourceSuggestions}=await import('../electron/retro/compiledResources.js')
   const compiled=(kind,symbol,facts)=>({kind,symbol,origin:'res/'+symbol+'.png',status:'compiled',facts})
   const list=resourceSuggestions({rom:{size:5*1024*1024},staticRAM:50000,resources:[
    compiled('IMAGE','bg',{compression:0,tileCount:1300,uncompressedTileBytes:41600}),compiled('TILESET','small',{compression:0,tileCount:20,uncompressedTileBytes:640}),
    compiled('IMAGE','packed',{compression:1,tileCount:400,uncompressedTileBytes:12800}),compiled('SPRITE','boss',{peakFrameSprites:9,peakFrameTiles:120}),compiled('SPRITE','hero',{peakFrameSprites:2,peakFrameTiles:6}),
    {kind:'IMAGE',symbol:'unbuilt',origin:'res/unbuilt.png',status:'not-built',facts:null,authoring:{gridTiles:9999}}]})
   assert.deepEqual(list.map(item=>item.code+':'+(item.symbol||'')),['uncompressed-tiles:bg','many-unique-tiles:bg','sprite-hardware-pieces:boss','sprite-frame-tiles:boss','static-ram-high:','rom-large:'])
   assert.deepEqual(list[0],{code:'uncompressed-tiles',symbol:'bg',origin:'res/bg.png',values:{tiles:1300,bytes:41600}})
   assert.deepEqual(resourceSuggestions({resources:[],staticRAM:null,rom:null}),[],'no compiled data, no suggestions: estimates never produce one')
   for(const locale of ['pt-BR','en','es','ja']){const text=JSON.parse(fs.readFileSync(new URL('../src/locales/'+locale+'.json',import.meta.url),'utf8')).hardwareReport
    assert.ok(text.suggestions);for(const item of list)assert.ok(text.suggestion[item.code],locale+' has '+item.code)}}
  console.log('Compiled resources: bounded ELF, explicit ABI, actual vs authoring facts, per-instance budget, unknowns, malformed input and workspace confinement passed.')
} finally { fs.rmSync(temporary,{recursive:true,force:true}) }
