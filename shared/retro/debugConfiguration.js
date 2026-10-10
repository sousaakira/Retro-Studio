// #56: in-game diagnostics switch. Production is the default: no instrumentation in the ROM.
export const DEBUG_TRANSPORTS=Object.freeze(['none','kdebug'])
export function createDebugConfiguration(){
 return {format:'retro-studio.debug',version:1,enabled:false,overlay:{performance:true,subject:true,boxes:true},transport:'none',serial:1,seed:0}
}
export function validateDebugConfiguration(value){
 if(!value||typeof value!=='object'||value.format!=='retro-studio.debug'||value.version!==1)throw Error('Unsupported debug configuration.')
 if(typeof value.enabled!=='boolean')throw Error('Invalid debug switch.')
 const overlay=value.overlay
 if(!overlay||typeof overlay!=='object'||['performance','subject','boxes'].some(key=>typeof overlay[key]!=='boolean'))throw Error('Invalid debug overlay.')
 if(!DEBUG_TRANSPORTS.includes(value.transport))throw Error('Invalid debug transport.')
 if(!Number.isInteger(value.serial)||value.serial<1||value.serial>0xFFFFFF)throw Error('Invalid debug serial.')
 if(value.seed!==undefined&&(!Number.isInteger(value.seed)||value.seed<0||value.seed>0xFFFFFFFF))throw Error('Invalid debug seed.')
 return value
}
/** build: identifier computed by the caller from the configuration (shown on screen and in records). */
export function compileDebugHeader(value,build){
 validateDebugConfiguration(value)
 if(!/^[0-9A-F]{6}$/.test(build))throw Error('Invalid debug build identifier.')
 const on=value.enabled,flag=(name,active)=>'#define RETRO_PROJECT_DEBUG_'+name+' '+(on&&active?1:0)
 return ['/* Generated: in-game diagnostics. RETRO_PROJECT_DEBUG 0 is the production build:',' * code inside #if RETRO_PROJECT_DEBUG blocks is not compiled at all. */',
  '#ifndef RETRO_PROJECT_DEBUG_CONFIG_H','#define RETRO_PROJECT_DEBUG_CONFIG_H','#define RETRO_PROJECT_DEBUG '+(on?1:0),
  flag('PERFORMANCE',value.overlay.performance),flag('SUBJECT',value.overlay.subject),flag('BOXES',value.overlay.boxes),flag('KDEBUG',value.transport==='kdebug'),
  '#define RETRO_PROJECT_DEBUG_BUILD "'+(on?build:'')+'"','#endif',''].join('\n')
}
