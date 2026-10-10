// Developer tool: drive a local UI fixture in headless Chrome through the
// DevTools protocol (no dependencies) and save screenshots for visual review.
// node scripts/inspect-fixture.mjs <url> <steps.mjs> <output-dir> [--chrome <binary>]
// steps.mjs default-exports async ({evaluate,screenshot,viewport,key,mouse,wait}) => {}
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {pathToFileURL} from 'node:url'
const [url,stepsFile,output]=process.argv.slice(2)
if(!url||!stepsFile||!output){console.error('usage: inspect-fixture.mjs <url> <steps.mjs> <output-dir> [--chrome <binary>]');process.exit(2)}
if(!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url+'/'))throw Error('Only local fixtures are inspected.')
const flag=process.argv.indexOf('--chrome'),binary=flag>=0?process.argv[flag+1]:'google-chrome'
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'retro-inspect-'));fs.mkdirSync(output,{recursive:true})
const chrome=spawn(binary,['--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']})
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
try{
 const endpoint=await new Promise((resolve,reject)=>{
  let text='';const timer=setTimeout(()=>reject(Error('Chrome did not start: '+text.slice(-400))),20000)
  chrome.stderr.on('data',chunk=>{text+=chunk;const match=text.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1])}})
  chrome.on('exit',code=>reject(Error('Chrome exited: '+code+' '+text.slice(-400))))
 })
 const port=new URL(endpoint).port
 const target=await (await fetch('http://127.0.0.1:'+port+'/json/new?'+encodeURIComponent(url),{method:'PUT'})).json()
 const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
 let id=0;const pending=new Map(),errors=[]
 socket.onmessage=event=>{
  const message=JSON.parse(event.data)
  if(message.id){const entry=pending.get(message.id);pending.delete(message.id);message.error?entry.reject(Error(message.error.message)):entry.resolve(message.result)}
  else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text)
  else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(a=>a.value||a.description).join(' '))
 }
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})
 await send('Runtime.enable');await send('Page.enable')
 const api={
  wait,
  async viewport(width,height){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})},
  async evaluate(expression){
   const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
   if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text)
   return result.result.value
  },
  async screenshot(name){const shot=await send('Page.captureScreenshot',{format:'png'});const file=path.join(output,name+'.png');fs.writeFileSync(file,Buffer.from(shot.data,'base64'));console.log('saved '+file)},
  async key(key,code=key){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code})},
  async mouse(type,x,y,buttons=1){await send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1})}
 }
 await api.viewport(1280,900);await wait(1500)
 await (await import(pathToFileURL(path.resolve(stepsFile)).href)).default(api)
 if(errors.length){console.error('Page errors:\n'+errors.join('\n'));process.exitCode=1}else console.log('No page errors.')
 socket.close()
}finally{chrome.kill();await wait(300);fs.rmSync(profile,{recursive:true,force:true})}
