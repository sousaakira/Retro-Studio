// #64: texto do depurador nativo do BlastEm (blastem -d). Conferido com o BlastEm 0.6.3:
// o prompt é "> " no começo da linha; números sem "$" são decimais; "frames 0" não volta.
export const KDEBUG_PREFIX='KDEBUG MESSAGE: '
const clean=text=>text.replace(/\r/g,'').replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'')
/**
 * Consome o que chegou do terminal. Devolve as mensagens KDebug completas, as respostas
 * terminadas por prompt e o resto ainda incompleto.
 */
export function readTerminal(buffer){
 let text=clean(buffer);const logs=[],replies=[]
 for(;;){
  // Prompt: "> " logo no início ou depois de uma quebra de linha, sem nada depois (ainda).
  const match=text.match(/(^|\n)> /);if(!match)break
  const end=match.index+match[1].length
  replies.push(text.slice(0,end));text=text.slice(end+2)
 }
 const keep=[]
 const lines=text.split('\n'),tail=lines.pop()
 for(const line of lines)if(line.startsWith(KDEBUG_PREFIX))logs.push(line.slice(KDEBUG_PREFIX.length));else keep.push(line)
 const out=replies.map(reply=>reply.split('\n').filter(line=>{if(line.startsWith(KDEBUG_PREFIX)){logs.push(line.slice(KDEBUG_PREFIX.length));return false}return true}).join('\n'))
 return {logs,replies:out,rest:[...keep,tail].join('\n')}
}
/** Tira o eco do comando (o terminal repete o que foi digitado) do começo da resposta. */
export function withoutEcho(reply,command){
 const lines=reply.split('\n');const index=lines.findIndex(line=>line.trim()===command.trim())
 return (index>=0?lines.slice(index+1):lines).join('\n').trim()
}
/** "d0: 2300\n a7: e0fffde4" → Map nome → número. Erro do depurador vira exceção. */
export function parsePrint(text,names){
 const values=new Map()
 for(const line of text.split('\n')){const match=line.match(/^\s*(.+?): ([0-9a-fA-F]+)\s*$/);if(match)values.set(match[1],parseInt(match[2],16))}
 for(const name of names)if(!values.has(name))throw Error('Resposta inesperada do depurador do BlastEm: '+text.slice(0,120))
 return names.map(name=>values.get(name)>>>0)
}
export const M68K_NAMES=Object.freeze(['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3','a4','a5','a6','a7','sr','pc'])
export const nativeCommands=Object.freeze({
 registers:'p/x '+M68K_NAMES.join(' '),
 step:'s',continue:'c',vdpRegisters:'vr',vdpSprites:'vs',
 frames:count=>'frames '+count,
 breakpoint:address=>'b $'+address.toString(16),
 removeBreakpoint:index=>'d '+index,
 /** Até 8 expressões por comando: linhas longas demais embaralham o eco do terminal. */
 read:items=>'p/x '+items.map(item=>'[$'+item.address.toString(16)+'].'+item.size).join(' ')
})
/** Divide uma faixa em leituras de 4 bytes (e bytes soltos no fim), em grupos de 8. */
export function memoryPlan(address,length){
 const items=[]
 for(let offset=0;offset<length;){const size=length-offset>=4?4:1;items.push({address:address+offset,size:size===4?'l':'b',bytes:size});offset+=size}
 const groups=[];for(let i=0;i<items.length;i+=8)groups.push(items.slice(i,i+8))
 return groups
}
export function parseBreakpointSet(text){const match=text.match(/Breakpoint (\d+) set at \$([0-9A-Fa-f]+)/);return match?{index:Number(match[1]),address:parseInt(match[2],16)}:null}
/** "68K Breakpoint 0 hit\n2276: link.w a6, #$FFFFFFBC" → {breakpoint, address, instruction}. */
export function parseStop(text){
 const hit=text.match(/Breakpoint (\d+) hit/),lines=text.split('\n').map(line=>line.trim()).filter(Boolean)
 const last=[...lines].reverse().find(line=>/^[0-9A-Fa-f]{1,6}: \S/.test(line))
 if(!last)return null
 const [, address, instruction]=last.match(/^([0-9A-Fa-f]{1,6}): (.*)$/)
 return {breakpoint:hit?Number(hit[1]):null,address:parseInt(address,16),instruction}
}
/** Saída de "vr": grupos de registros (número, valor, descrição do emulador) e estado interno. */
export function parseVdpRegisters(text){
 const groups=[],internal=[];let current=null
 for(const raw of text.split('\n')){
  const line=raw.trimEnd(),title=line.match(/^\*\*(.+)\*\*$/)
  if(title){current={title:title[1],rows:[]};groups.push(current);continue}
  const register=line.match(/^([0-9A-Fa-f]{2}): ([0-9A-Fa-f]{2}) \|\s?(.*)$/)
  if(register&&current){current.rows.push({register:parseInt(register[1],16),value:parseInt(register[2],16),description:register[3].trim()});continue}
  const field=line.match(/^([A-Za-z][A-Za-z -]*?):\s+(.+)$/)
  if(field)internal.push({name:field[1],value:field[2].trim()})
 }
 const registers=groups.flatMap(group=>group.rows)
 if(!registers.length)throw Error('Resposta inesperada do depurador do BlastEm ao ler o VDP.')
 return {groups:groups.filter(group=>group.rows.length),internal,registers}
}
/** Saída de "vs": uma linha por sprite da lista encadeada. */
export function parseVdpSprites(text){
 const sprites=[]
 for(const line of text.split('\n')){
  const match=line.match(/^Sprite (\d+): X=(-?\d+)\((-?\d+)\), Y=(-?\d+)\((-?\d+)\), Width=(\d+), Height=(\d+), Link=(\d+), Pal=(\d+), Pri=(\d+), Pat=([0-9A-Fa-f]+)/)
  if(match)sprites.push({index:+match[1],x:+match[3],y:+match[5],rawX:+match[2],rawY:+match[4],width:+match[6],height:+match[7],link:+match[8],palette:+match[9],priority:+match[10],pattern:parseInt(match[11],16)})
 }
 return sprites
}
