import {MOVEMENT_FIELDS,createMovementConfiguration,validateMovementConfiguration} from '../../../shared/retro/movementConfiguration.js'
const fields=['x','y','velocityX','velocityY','grounded','facing','sliding','wall','contacts','jumped','dashRemaining','ticks','height','distance','flightTicks']
const fixed=new Set([0,1,2,3,12,13])
export async function createMovementLab(bytes){
 if(!bytes){
  const response=await fetch(new URL('../../assets/runtime/movement-lab.wasm',import.meta.url).href)
  if(!response.ok)throw Error('Não foi possível carregar o controlador da sala de testes.')
  bytes=await response.arrayBuffer()
 }
 const module=await WebAssembly.compile(bytes)
 if(WebAssembly.Module.imports(module).length)throw Error('Controlador da sala de testes com imports inesperados.')
 const api=(await WebAssembly.instantiate(module,{})).exports
 for(const name of ['movementLabPreset','movementLabConfigure','movementLabReset','movementLabTick','movementLabRead'])
  if(typeof api[name]!=='function')throw Error('Controlador da sala de testes incompatível.')
 const snapshot=()=>Object.fromEntries(fields.map((name,i)=>[name,api.movementLabRead(i)/(fixed.has(i)?256:1)]))
 return {
  reset(profile){
   const config=createMovementConfiguration();config.profiles.ntsc=profile;validateMovementConfiguration(config)
   api.movementLabPreset()
   MOVEMENT_FIELDS.forEach(([key],i)=>{if(!api.movementLabConfigure(i,profile[key]*(i<12?256:1)))throw Error('Parâmetro recusado: '+key)})
   api.movementLabConfigure(18,profile.airDash?1:0)
   if(!api.movementLabReset())throw Error('Configuração recusada pelo controlador C.')
   return snapshot()
  },
  step(axis,buttons){
   if(!Number.isInteger(axis)||!Number.isInteger(buttons)||axis<-1||axis>1||buttons<0||buttons>15||!api.movementLabTick(axis,buttons))
    throw Error('Passo recusado. Reinicie a sala para continuar.')
   return snapshot()
  },snapshot
 }
}
