// #46: one read-only view of saved/exported/stale/conflicting/failed exports of a project.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parse,compileScript} from '@vue/compiler-sfc'
import {createRenderer,h,ref,nextTick} from 'vue'
import {exportOverview} from '../electron/retro/exportOverview.js'
import {copyProjectTemplate,prepareNewProject} from '../electron/retro/starterProject.js'
import {installNewProjectRuntime} from '../electron/retro/newProject.js'
import {installCutsceneRuntime} from '../electron/retro/cutsceneRuntime.js'
import {inputConfigurationStatus,saveInputConfiguration} from '../electron/retro/inputConfiguration.js'
import {movementConfigurationStatus,saveMovementConfiguration} from '../electron/retro/movementConfiguration.js'
import {progressConfigurationStatus,saveProgressConfiguration} from '../electron/retro/progressConfiguration.js'
import {publishCutsceneExport} from '../electron/retro/cutsceneExport.js'
const repository=fileURLToPath(new URL('../',import.meta.url)),template=path.join(repository,'assets/toolkit/examples/sgdk-starter')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retro-export-overview-'))
const copy=(source,target)=>fs.cpSync(source,target,{recursive:true,filter:file=>!file.includes(path.sep+'out'+path.sep)&&!file.endsWith(path.sep+'out')})
const old=globalThis.window
let app
try{
 // A project that uses nothing managed: every row is "absent" and nothing blocks the build.
 const empty=path.join(temporary,'empty');fs.mkdirSync(empty)
 let view=exportOverview(empty)
 assert.deepEqual(view.rows.map(item=>item.id),['world','input','movement','camera','audio','progress','cutscenes','cutscene-adapter','debug','palettes','hud'])
 assert.ok(view.rows.every(item=>item.state==='absent'));assert.deepEqual(view.summary,{current:0,absent:11,attention:0});assert.deepEqual(view.blocksBuild,[])
 assert.deepEqual(fs.readdirSync(empty),[],'the overview never writes')
 // The playable starter right after creation: what it uses is current, the rest is absent.
 const root=path.join(temporary,'game');fs.mkdirSync(root)
 copyProjectTemplate(template,root,copy);installNewProjectRuntime(root);installCutsceneRuntime(root)
 const project=JSON.parse(fs.readFileSync(path.join(template,'retro-studio.json'),'utf8'))
 fs.writeFileSync(path.join(root,'retro-studio.json'),JSON.stringify({name:'game',resourcePath:'res',assets:[],mapExport:project.mapExport,retroStudio:project.retroStudio},null,2))
 assert.equal((await prepareNewProject(root)).complete,true)
 const states=()=>Object.fromEntries(exportOverview(root).rows.map(item=>[item.id,item.state]))
 assert.deepEqual(states(),{world:'current',input:'absent',movement:'absent',camera:'current',audio:'current',progress:'absent',cutscenes:'absent','cutscene-adapter':'absent',debug:'absent',palettes:'absent',hud:'absent'})
 // Exports without a build gate of their own are followed too.
 saveInputConfiguration(root,{config:inputConfigurationStatus(root).config,revision:inputConfigurationStatus(root).revision})
 saveMovementConfiguration(root,{config:movementConfigurationStatus(root).config,revision:movementConfigurationStatus(root).revision})
 saveProgressConfiguration(root,{config:progressConfigurationStatus(root).config,revision:progressConfigurationStatus(root).revision})
 fs.writeFileSync(path.join(root,'cutscenes/intro.cutscene.json'),JSON.stringify({format:'retro-studio.cutscene',version:1,id:'intro',title:'Intro',steps:[{type:'wait',frames:1}]}))
 assert.equal(states().cutscenes,'unexported');assert.equal(publishCutsceneExport(root).success,true)
 assert.deepEqual(states(),{world:'current',input:'current',movement:'current',camera:'current',audio:'current',progress:'current',cutscenes:'current','cutscene-adapter':'absent',debug:'absent',palettes:'absent',hud:'absent'})
 assert.deepEqual(exportOverview(root).summary,{current:7,absent:4,attention:0})
 // Stale: the saved source no longer matches what was exported.
 const edit=(file,change)=>{const full=path.join(root,file),before=fs.readFileSync(full);fs.writeFileSync(full,change(before.toString('utf8')));return ()=>fs.writeFileSync(full,before)}
 let undo=edit('camera/camera.json',text=>text.replace('"deadZoneWidth": 48','"deadZoneWidth": 64'));assert.equal(states().camera,'stale');undo()
 undo=edit('controls/input-map.json',text=>{const config=JSON.parse(text);config.players[0].bindings.find(binding=>binding.id==='jump').bufferFrames=7;return JSON.stringify(config)})
 view=exportOverview(root);assert.equal(view.rows.find(item=>item.id==='input').state,'stale');assert.deepEqual(view.blocksBuild,[],'controls have no build gate: stale warns, does not block');assert.equal(view.summary.attention,1);undo()
 undo=edit('physics/movement.json',text=>text.replace(/"gravity":\s*[0-9.]+/,'"gravity": 0.5'));assert.equal(states().movement,'stale');undo()
 undo=edit('cutscenes/intro.cutscene.json',text=>text.replace('"frames":1','"frames":2'));assert.equal(states().cutscenes,'stale');undo()
 fs.writeFileSync(path.join(root,'cutscenes/extra.cutscene.json'),JSON.stringify({format:'retro-studio.cutscene',version:1,id:'extra',title:'Extra',steps:[]}));assert.equal(states().cutscenes,'stale');fs.rmSync(path.join(root,'cutscenes/extra.cutscene.json'))
 undo=edit('maps/cave.tmx',text=>text.replace('<map ','<map backgroundcolor="#000000" '));view=exportOverview(root)
 assert.equal(view.rows[0].state,'stale');assert.deepEqual(view.blocksBuild,['world']);assert.match(view.rows[0].message,/mudaram/);undo()
 // Conflict: a generated file edited outside the IDE is reported and preserved.
 for(const [id,file] of [['camera','src/generated/camera_config.h'],['input','src/generated/input_map.h'],['progress','src/generated/progress_config.h'],['audio','res/audio_resources.res'],['cutscenes','src/cutscene_data.h']]){
  const full=path.join(root,file),before=fs.readFileSync(full);fs.appendFileSync(full,'/* manual */\n')
  assert.equal(states()[id],'conflict',id);assert.ok(fs.readFileSync(full,'utf8').endsWith('/* manual */\n'));fs.writeFileSync(full,before)
 }
 // Unexported and failed.
 fs.renameSync(path.join(root,'src/generated/movement_config.h'),path.join(root,'movement.bak'));assert.equal(states().movement,'unexported');fs.renameSync(path.join(root,'movement.bak'),path.join(root,'src/generated/movement_config.h'))
 undo=edit('audio/audio.json',()=>'{broken');view=exportOverview(root);assert.equal(view.rows.find(item=>item.id==='audio').state,'failed');assert.ok(view.blocksBuild.includes('audio'));undo()
 undo=edit('controls/input-map.json',()=>'{"players":1}');assert.equal(states().input,'failed');undo()
 fs.renameSync(path.join(root,'audio/sfx/jump.wav'),path.join(root,'jump.bak'));assert.equal(states().audio,'failed','a missing original fails the audio export');fs.renameSync(path.join(root,'jump.bak'),path.join(root,'audio/sfx/jump.wav'))
 assert.deepEqual(exportOverview(root).summary,{current:7,absent:4,attention:0},'every check left the project as it was')
 // Panel: real Vue script with a minimal host.
 const component=path.join(repository,'src/components/retro/ExportOverviewPanel.vue'),source=fs.readFileSync(component,'utf8'),script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
 const {descriptor}=parse('<script setup>'+script+'</script><template><div ref="dialogElement"><button @click="load">x</button><button @click="close()">x</button><output>{{ JSON.stringify({rows:rows.map(r=>r.id+":"+r.state),headline,error,loading}) }}</output></div></template>')
 const compiled=compileScript(descriptor,{id:'overview-host',inlineTemplate:true}).content.replace(/from (['"])([^'"]+)\1/g,(_m,_q,specifier)=>'from '+JSON.stringify(specifier==='vue'?import.meta.resolve('vue'):pathToFileURL(path.resolve(path.dirname(component),specifier)).href))
 const file=path.join(temporary,'component.mjs');fs.writeFileSync(file,compiled)
 const Component=(await import(pathToFileURL(file).href)).default,reads=[];let closed=0
 globalThis.window={retroStudio:{retro:{exportOverview(payload){return new Promise((resolve,reject)=>reads.push({payload,resolve,reject}))}}}}
 const node=(type,text='')=>({type,text,children:[],parent:null,props:{},showModal(){},close(){}})
 const renderer=createRenderer({createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(n,t)=>{n.text=t},setElementText:(n,t)=>{n.text=t},patchProp:(n,k,_p,v)=>{n.props[k]=v},insert(n,p){n.parent=p;p.children.push(n)},remove(n){const index=n.parent?.children.indexOf(n);if(index>=0)n.parent.children.splice(index,1)},parentNode:n=>n.parent,nextSibling:()=>null})
 const projectPath=ref('/A'),host=node('root');app=renderer.createApp({render:()=>h(Component,{projectPath:projectPath.value,onClose(){closed++}})});app.mount(host)
 const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,5));await nextTick();await nextTick()}
 const state=()=>JSON.parse(host.children[0].children.find(n=>n.type==='output').text),click=index=>host.children[0].children.filter(n=>n.type==='button')[index].props.onClick()
 await flush();reads[0].resolve(exportOverview(root));await flush()
 let s=state();assert.match(s.headline,/Tudo o que o projeto usa está exportado e em dia/);assert.equal(s.rows[0].split(':')[1],'current');assert.equal(s.rows.at(-1).split(':')[1],'absent')
 undo=edit('maps/cave.tmx',text=>text.replace('<map ','<map backgroundcolor="#000000" '));click(0);await flush();reads[1].resolve(exportOverview(root));await flush();undo()
 s=state();assert.equal(s.rows[0],'world:stale','problems are listed first');assert.match(s.headline,/build pela IDE será recusado/)
 projectPath.value='/B';await flush();click(0);await flush();reads[2].reject(Error('late'));reads[3].resolve(exportOverview(empty));await flush()
 s=state();assert.equal(s.error,'');assert.match(s.headline,/ainda não usa nenhuma exportação/);click(1);assert.equal(closed,1)
 assert.match(source,/aria-labelledby="overview-title"/)
}finally{app?.unmount();if(old===undefined)delete globalThis.window;else globalThis.window=old;fs.rmSync(temporary,{recursive:true,force:true})}
console.log('Export overview: absent, current, stale, unexported, conflict and failed states for every managed export, build-blocking set, read-only checks and panel passed.')
