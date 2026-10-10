// #61: templates may sit on top of another template and ask for an export pass
// after the runtime is installed, because generated headers and ownership
// records are never stored in a template.
import fs from 'node:fs'
import path from 'node:path'
import {exportCharacterToProject} from './characterExport.js'
import {worldConfigurationStatus,saveWorldConfigurationWithMaps} from './worldConfiguration.js'
import {cameraConfigurationStatus,saveCameraConfiguration} from './cameraConfiguration.js'
import {audioConfigurationStatus,saveAudioConfiguration} from './audioConfiguration.js'
const DESCRIPTOR='template.json',STAGING='starter'
function descriptor(directory){
 const file=path.join(directory,DESCRIPTOR)
 if(!fs.existsSync(file))return null
 const value=JSON.parse(fs.readFileSync(file,'utf8'))
 if(value?.format!=='retro-studio.template'||value.version!==1||(value.base!==undefined&&!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.base))||
  (value.prepare!==undefined&&value.prepare!=='starter')||(value.requires!==undefined&&(!Array.isArray(value.requires)||value.requires.length>32||value.requires.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(id)))))throw Error('Unsupported template descriptor.')
 return value
}
/** Checked before any folder is created: descriptor and base must be usable. */
export function inspectProjectTemplate(templatePath){
 const info=descriptor(templatePath)
 if(info?.base){
  const base=path.join(path.dirname(templatePath),info.base)
  if(!fs.existsSync(base)||descriptor(base)?.base)throw Error('Template base not found: '+info.base)
 }
 return info
}
/** Copies a template; one with a descriptor is laid over its base template. */
export function copyProjectTemplate(templatePath,projectPath,copyDirectory){
 const info=inspectProjectTemplate(templatePath)
 if(info?.base)copyDirectory(path.join(path.dirname(templatePath),info.base),projectPath)
 copyDirectory(templatePath,projectPath)
 // A template that was built or opened in place (during development of the IDE itself) has
 // build output and IDE records of its own; a new game never starts with someone else's ROM.
 for(const leftover of ['out','.retrostudio','.retro-studio'])fs.rmSync(path.join(projectPath,leftover),{recursive:true,force:true})
 if(info){fs.rmSync(path.join(projectPath,DESCRIPTOR),{force:true});if(info.prepare)fs.writeFileSync(path.join(projectPath,'.retrostudio-template-prepare'),info.prepare)}
 return info
}
/** Runs the exports a template asked for. Each step is independent: a missing
 * tool (for example Python for the maps) leaves the project usable and the
 * step is reported, so the user can finish it in the matching editor. */
export async function prepareNewProject(projectPath){
 const marker=path.join(projectPath,'.retrostudio-template-prepare')
 if(!fs.existsSync(marker))return {steps:[]}
 const kind=fs.readFileSync(marker,'utf8');fs.rmSync(marker,{force:true})
 if(kind!=='starter')return {steps:[]}
 const root=fs.realpathSync(projectPath),steps=[]
 const step=async(name,run)=>{try{await run();steps.push({name,done:true})}catch(error){steps.push({name,done:false,reason:error.message})}}
 const json=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))
 await step('personagem',()=>{
  const request=json(STAGING+'/character.json'),resources=path.join(root,'res/resources.res')
  exportCharacterToProject(root,{...request,png:fs.readFileSync(path.join(root,STAGING,request.imageName)),
   expectedResources:fs.existsSync(resources)?fs.readFileSync(resources,'utf8'):null,expectedHeader:null,expectedProject:null})
 })
 // Staged export inputs leave before the maps are exported, even when the character
 // step failed: the map export records every project file it saw. On failure they are
 // kept aside under .retrostudio, which the map export ignores.
 if(steps[0].done)fs.rmSync(path.join(root,STAGING),{recursive:true,force:true})
 else if(fs.existsSync(path.join(root,STAGING))){fs.mkdirSync(path.join(root,'.retrostudio'),{recursive:true});fs.renameSync(path.join(root,STAGING),path.join(root,'.retrostudio/template-'+STAGING))}
 await step('salas e mapas',async()=>{await saveWorldConfigurationWithMaps(root,{config:json('world/world.json'),revision:worldConfigurationStatus(root).revision})})
 await step('câmera',()=>{saveCameraConfiguration(root,{config:json('camera/camera.json'),revision:cameraConfigurationStatus(root).revision})})
 await step('áudio',()=>{saveAudioConfiguration(root,{config:json('audio/audio.json'),revision:audioConfigurationStatus(root).revision})})
 return {steps,complete:steps.every(item=>item.done)}
}
