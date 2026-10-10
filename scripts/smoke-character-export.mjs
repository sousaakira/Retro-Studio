import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exportCharacterToProject } from '../electron/retro/characterExport.js'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-character-export-'))
try {
  fs.mkdirSync(path.join(root,'charsets'))
  fs.writeFileSync(path.join(root,'retro-studio.json'), JSON.stringify({name:'Game',assets:[],custom:{preserve:true}}))
  const saved = { format:'retro-studio-charset-project',version:4, source:{path:'/original/ninja.png'}, animations:[{name:'idle'}] }
  const projectFile = 'charsets/ninja.charset.json'
  const original = JSON.stringify(saved)
  fs.writeFileSync(path.join(root,projectFile), original)
  const data = {...saved, version:6, hurtBox:{custom:true,x:-5,y:-30,width:10,height:28},exportedFileName:'ninja_sprites.png', exportedHeaderName:'ninja_animations.h',exportedResourceName:'SPR_NINJA'}
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('fixture PNG')])
  const request = { characterName:'ninja',imageName:'ninja_sprites.png',projectFile,png,resources:'SPRITE SPR_NINJA "ninja_sprites.png" 4 6 NONE\n',
    header:'// animations\n',characterProject:JSON.stringify(data),expectedProject:original,expectedResources:null,expectedHeader:null }
  const configOriginal = fs.readFileSync(path.join(root,'retro-studio.json'))
  assert.throws(()=>exportCharacterToProject(root,request,{beforePublish(index){if(index===2)throw new Error('injected')}}),/injected/)
  assert.ok(!fs.existsSync(path.join(root,'res/ninja_sprites.png')))
  assert.ok(!fs.existsSync(path.join(root,'res/resources.res')))
  assert.deepEqual(fs.readFileSync(path.join(root,'retro-studio.json')),configOriginal)
  assert.equal(fs.readFileSync(path.join(root,projectFile),'utf8'),original)
  const result = exportCharacterToProject(root,request)
  assert.equal(result.assetPath,'res/ninja_sprites.png')
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,projectFile),'utf8')).version,6)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,projectFile),'utf8')).hurtBox,data.hurtBox)
  const config = JSON.parse(fs.readFileSync(path.join(root,'retro-studio.json')))
  assert.equal(config.assets.length,1)
  assert.equal(config.custom.preserve,true)
  assert.throws(()=>exportCharacterToProject(root,request),/revision changed/)
  const next = {...request,expectedProject:request.characterProject,expectedResources:request.resources,expectedHeader:request.header}
  const again = exportCharacterToProject(root,next)
  assert.equal(again.asset.id,result.asset.id)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'retro-studio.json'))).assets.length,1)
  fs.writeFileSync(path.join(root,'res/ninja.png'),png)
  assert.throws(()=>exportCharacterToProject(root,{...next,imageName:'ninja.png',characterProject:JSON.stringify({...data,exportedFileName:'ninja.png'})}),/another source/)
  assert.deepEqual(fs.readFileSync(path.join(root,'res/ninja.png')),png)
  assert.throws(()=>exportCharacterToProject(root,{...next,projectFile:'../outside.charset.json'}))
  // #42: a folha passa a ser guardada relativa ao projeto. Um charset antigo, com o caminho
  // absoluto da mesma folha, continua dono das próprias saídas; outra folha continua recusada.
  const legacyFile='charsets/legacy.charset.json', legacySaved={...data,source:{path:path.join(root,'art','hero.png')},exportedFileName:'hero_sprites.png',exportedHeaderName:'hero_animations.h',exportedResourceName:'SPR_HERO'}
  fs.writeFileSync(path.join(root,legacyFile),JSON.stringify(legacySaved))
  fs.writeFileSync(path.join(root,'res/hero_sprites.png'),png)
  const resourcesNow=fs.readFileSync(path.join(root,'res/resources.res'),'utf8')
  const legacyRequest={characterName:'hero',imageName:'hero_sprites.png',projectFile:legacyFile,png,resources:resourcesNow+'SPRITE SPR_HERO "hero_sprites.png" 4 6 NONE\n',
    header:'// hero\n',expectedProject:JSON.stringify(legacySaved),expectedResources:resourcesNow,expectedHeader:null}
  assert.throws(()=>exportCharacterToProject(root,{...legacyRequest,characterProject:JSON.stringify({...legacySaved,source:{path:'art/villain.png'}})}),/another source/)
  exportCharacterToProject(root,{...legacyRequest,characterProject:JSON.stringify({...legacySaved,source:{path:'art/hero.png'}})})
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,legacyFile),'utf8')).source.path,'art/hero.png')
} finally { fs.rmSync(root,{recursive:true,force:true}) }
console.log('Character export: five outputs, rollback, original protection, stale revisions and inventory preservation passed.')
