// Developer tool (#45): CDP client for scripts/inspect-electron.sh. Not a product feature.
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
const [port,stepsFile,output]=process.argv.slice(2)
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let target=null
for(let attempt=0;attempt<60&&!target;attempt++){
 await wait(1000)
 try{target=(await (await fetch('http://127.0.0.1:'+port+'/json')).json()).find(item=>item.type==='page'&&/^http:\/\/localhost:5175\/(index\.html)?$/.test(item.url))}catch{}
}
if(!target)throw Error('The IDE window did not appear. Is the renderer dev server (npm run dev) running on port 5175?')
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
let id=0;const pending=new Map(),errors=[],events=[]
socket.onmessage=event=>{
 const message=JSON.parse(event.data)
 if(message.method==='Debugger.paused')events.push(message)
 if(message.id){const entry=pending.get(message.id);pending.delete(message.id);message.error?entry.reject(Error(message.error.message)):entry.resolve(message.result)}
 else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text)
 else if(message.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(message.params.type)){const text=message.params.args.map(a=>a.value||(a.preview?.properties?.length?JSON.stringify(Object.fromEntries(a.preview.properties.map(p=>[p.name,p.value]))):a.description)||'').join(' ');if(/\[Vue warn\]|Error|error/.test(text))errors.push(message.params.type+': '+text.slice(0,300))}
}
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})
await send('Runtime.enable');await send('Page.enable')
const api={
 wait,errors,
 /** Raw DevTools protocol call (Profiler, Debugger...); Debugger.paused events land in events. */
 send,events,
 async evaluate(expression){
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true})
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text)
  return result.result.value
 },
 /** Screenshot of the IDE window contents. */
 async screenshot(name){const shot=await send('Page.captureScreenshot',{format:'png'});const file=path.join(output,name+'.png');fs.writeFileSync(file,Buffer.from(shot.data,'base64'));console.log('saved '+file)},
 /** Screenshot of the whole virtual desktop (other windows, like the emulator, included). */
 desktop(name){const file=path.join(output,name+'.png');spawnSync('import',['-window','root',file]);console.log('saved '+file)},
 /** Real key press; modifiers: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift. */
 async key(key,code=key,modifiers=0,keyCode=0){for(const type of ['rawKeyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,modifiers,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode})},
 async type(text){await send('Input.insertText',{text})},
 // Arquivos do sistema arrastados para a janela: dropFiles(x,y,[caminhos absolutos]).
 async dropFiles(x,y,files){const data={items:[],files,dragOperationsMask:1};for(const type of ['dragEnter','dragOver','drop']){await send('Input.dispatchDragEvent',{type,x,y,data});await new Promise(resolve=>setTimeout(resolve,150))}},
 async waitFor(expression,timeout=30000,label=expression){const end=Date.now()+timeout;for(;;){if(await api.evaluate(expression))return true;if(Date.now()>end)throw Error('Timed out waiting for: '+label);await wait(250)}}
}
await api.waitFor(`!!document.querySelector('#root')?.children.length`,30000,'IDE mounted');await wait(1500)
let failed=false
try{await (await import(pathToFileURL(path.resolve(stepsFile)).href)).default(api)}catch(error){failed=true;console.error('STEP FAILED: '+error.message);try{await api.screenshot('zz-falha')}catch{}}
if(errors.length)console.log('Renderer warnings/errors ('+errors.length+'):\n'+[...new Set(errors)].slice(0,20).join('\n'));else console.log('No renderer warnings or errors.')
socket.close();process.exit(failed?1:0)
