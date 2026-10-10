// #64: protocolo remoto do GDB (o suficiente para depurar um 68000 em um emulador).
// Só texto e bytes: sem processo, sem rede. O transporte fica em electron/retro/debugSession.js.
const HEX='0123456789abcdef'
export const checksum=text=>{let sum=0;for(let i=0;i<text.length;i++)sum=(sum+text.charCodeAt(i))&255;return HEX[sum>>4]+HEX[sum&15]}
/** Pacote pronto para enviar: $dados#cs (com os caracteres reservados escapados). */
export function encodePacket(data){
 const escaped=String(data).replace(/[#$}*]/g,c=>'}'+String.fromCharCode(c.charCodeAt(0)^0x20))
 return '$'+escaped+'#'+checksum(escaped)
}
/** Desfaz escape e compressão por repetição ("x*n") do corpo de um pacote. */
export function decodeBody(body){
 let out=''
 for(let i=0;i<body.length;i++){
  const c=body[i]
  if(c==='}'&&i+1<body.length)out+=String.fromCharCode(body.charCodeAt(++i)^0x20)
  else if(c==='*'&&i+1<body.length&&out.length){const count=body.charCodeAt(++i)-29;if(count<1||count>97)throw Error('Invalid run length in debug packet.');out+=out[out.length-1].repeat(count)}
  else out+=c
 }
 return out
}
/**
 * Separa o que chegou em confirmações e pacotes. Devolve os eventos e o texto que sobrou
 * (pacote incompleto). Pacote com soma errada vira {type:'bad'}: quem chama responde '-'.
 */
export function parseStream(buffer){
 const events=[];let i=0
 while(i<buffer.length){
  const c=buffer[i]
  if(c==='+'){events.push({type:'ack'});i++;continue}
  if(c==='-'){events.push({type:'nak'});i++;continue}
  if(c!=='$'){i++;continue} // ruído entre pacotes (mensagens do emulador na mesma saída)
  const end=buffer.indexOf('#',i+1)
  if(end<0||end+2>=buffer.length)break
  const body=buffer.slice(i+1,end),sum=buffer.slice(end+1,end+3).toLowerCase()
  // Soma errada pode ser só um "$" solto no texto do emulador: retoma no próximo "$" em vez
  // de engolir um pacote verdadeiro que venha logo depois.
  if(sum!==checksum(body)){events.push({type:'bad'});const next=buffer.indexOf('$',i+1);i=next>=0&&next<end+3?next:end+3;continue}
  try{events.push({type:'packet',data:decodeBody(body)})}catch{events.push({type:'bad'})}
  i=end+3
 }
 return {events,rest:buffer.slice(i)}
}
export const hexToBytes=hex=>{if(hex.length%2||/[^0-9a-fA-F]/.test(hex))throw Error('Invalid hex data from the debug backend.');const out=new Uint8Array(hex.length/2);for(let i=0;i<out.length;i++)out[i]=parseInt(hex.substr(i*2,2),16);return out}
export const bytesToHex=bytes=>Array.from(bytes,byte=>HEX[byte>>4]+HEX[byte&15]).join('')
export const M68K_REGISTERS=Object.freeze(['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3','a4','a5','a6','a7','sr','pc'])
/** Resposta de "g" de um 68000: 18 registros de 32 bits, em hexadecimal big-endian. */
export function parseM68kRegisters(reply){
 if(/^E[0-9a-fA-F]{2}$/.test(reply))throw Error('The debug backend refused to read the registers ('+reply+').')
 if(reply.length<18*8||/[^0-9a-fA-F]/.test(reply.slice(0,18*8)))throw Error('Unexpected register data from the debug backend.')
 const out={};M68K_REGISTERS.forEach((name,index)=>{out[name]=parseInt(reply.substr(index*8,8),16)>>>0})
 out.sr&=0xFFFF
 return out
}
/** Resposta de parada: S05, T05..., W00 (terminou), X.. (morto). */
export function parseStopReply(reply){
 if(/^[ST][0-9a-fA-F]{2}/.test(reply)){const signal=parseInt(reply.substr(1,2),16);return {kind:'stopped',signal,reason:signal===5?'breakpoint-or-step':signal===2?'interrupted':'signal'}}
 if(/^[WX]/.test(reply))return {kind:'exited'}
 if(reply==='')return {kind:'unsupported'}
 if(/^E[0-9a-fA-F]{2}$/.test(reply))return {kind:'error',code:reply}
 return {kind:'unknown',text:reply.slice(0,40)}
}
export const commands=Object.freeze({
 halt:'?',registers:'g',step:'s',continue:'c',detach:'D',kill:'k',
 readMemory:(address,length)=>'m'+(address>>>0).toString(16)+','+length.toString(16),
 breakpoint:(address,insert)=>(insert?'Z':'z')+'0,'+(address>>>0).toString(16)+',2'
})
