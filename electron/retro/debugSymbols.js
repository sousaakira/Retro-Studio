// #64: símbolos e linhas de C do jogo compilado, para a depuração. Nada é afirmado sem prova:
// - a associação ROM ↔ símbolos só é "comprovada" quando o recibo de build da IDE lista os dois
//   arquivos com os hashes que estão no disco;
// - linha de C só existe quando o ELF traz informações de depuração (build "debug" do SGDK).
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {parseM68kElf} from './compiledResources.js'
import {inspectBuildSnapshot} from './buildSnapshot.js'
const MAX=64*1024*1024
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function regular(root,relative){
 const file=path.join(root,relative),real=fs.realpathSync(file),inside=path.relative(root,real)
 if(inside.startsWith('..')||path.isAbsolute(inside))throw Error('outside-project')
 const info=fs.statSync(real);if(!info.isFile()||info.size>MAX)throw Error('debug-file-limit')
 return {path:relative,real,bytes:fs.readFileSync(real)}
}
/** Tabela de símbolos completa (inclui funções estáticas, que o relatório de recursos ignora). */
function symbolTable(bytes,elf){
 const functions=[],objects=[]
 for(const section of elf.sections.filter(item=>item.type===2)){
  const strings=elf.sections[section.link];if(!strings||section.entrySize!==16)continue
  for(let offset=section.offset;offset+16<=section.offset+section.size;offset+=16){
   const type=bytes[offset+12]&15,index=bytes.readUInt16BE(offset+14)
   if((type!==1&&type!==2)||!index||index>=0xff00)continue
   const start=strings.offset+bytes.readUInt32BE(offset);let end=start
   while(end<strings.offset+strings.size&&bytes[end])end++
   const name=bytes.toString('latin1',start,end);if(!name||name.length>200)continue
   const entry={name,address:bytes.readUInt32BE(offset+4)&0xffffff,size:bytes.readUInt32BE(offset+8)}
   ;(type===2?functions:objects).push(entry)
   if(functions.length+objects.length>200000)throw Error('debug-symbol-limit')
  }
 }
 const order=(a,b)=>a.address-b.address||a.name.localeCompare(b.name)
 return {functions:functions.sort(order),objects:objects.sort(order)}
}
const tool=(toolkitPath,name)=>{
 for(const base of [path.join(toolkitPath||'','m68k-elf','bin'),path.join(toolkitPath||'','bin')]){const file=path.join(base,name);if(fs.existsSync(file))return file}
 return null
}
/** Caminho que o compilador gravou → caminho dentro do projeto (ou null se for de fora). */
function projectFile(root,file){
 let real
 try{real=fs.realpathSync(path.resolve(root,file))}catch{return null}
 const relative=path.relative(root,real)
 return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)?relative.split(path.sep).join('/'):null
}
function addr2line(elfReal,addresses,toolkitPath){
 const binary=tool(toolkitPath,'m68k-elf-addr2line'),found=new Map();if(!binary)return found
 for(let start=0;start<addresses.length;start+=400){
  let output
  try{output=execFileSync(binary,['-e',elfReal,'-a',...addresses.slice(start,start+400).map(address=>'0x'+address.toString(16))],{encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024})}catch{continue}
  const lines=output.split(/\r?\n/)
  for(let i=0;i+1<lines.length;i+=2){
   const address=parseInt(lines[i],16),match=lines[i+1].match(/^(.*):(\d+)(?: \(discriminator \d+\))?$/)
   if(Number.isFinite(address)&&match&&!match[1].includes('??'))found.set(address,{path:match[1],line:Number(match[2])})
  }
 }
 return found
}
/**
 * Tabela de linhas do ELF: fonte (relativo ao projeto) → linha → primeiro endereço.
 * O readelf só mostra o nome do arquivo de cada trecho (às vezes sem a pasta), e dois fontes
 * podem ter o mesmo nome. Por isso o arquivo de cada trecho é perguntado ao addr2line, que
 * devolve o caminho completo gravado pelo compilador; trecho sem resposta coerente fica de fora.
 */
function lineTable(root,elfReal,toolkitPath){
 const binary=tool(toolkitPath,'m68k-elf-readelf'),table=new Map();if(!binary)return table
 let output
 try{output=execFileSync(binary,['--debug-dump=decodedline',elfReal],{encoding:'utf8',timeout:20000,maxBuffer:64*1024*1024})}catch{return table}
 const sections=[];let current=null
 for(const row of output.split(/\r?\n/)){
  const header=row.match(/^(\S.*):$/)
  if(header&&!row.startsWith('CU:')){current={name:path.basename(header[1]),rows:[]};sections.push(current);continue}
  const match=current&&row.match(/^(\S+)\s+(\d+)\s+0x([0-9a-fA-F]+)/);if(!match)continue
  current.rows.push([Number(match[2]),parseInt(match[3],16)&0xffffff])
 }
 // Até 3 endereços por trecho: o primeiro pode ser compartilhado com o trecho vizinho.
 const probes=sections.flatMap(section=>section.rows.slice(0,3).map(row=>row[1])),answers=addr2line(elfReal,[...new Set(probes)],toolkitPath)
 for(const section of sections){
  let file=null
  for(const [line,address] of section.rows.slice(0,3)){const answer=answers.get(address);if(answer&&answer.line===line&&path.basename(answer.path)===section.name){file=projectFile(root,answer.path);break}}
  if(!file)continue
  const lines=table.get(file)||new Map();table.set(file,lines)
  for(const [line,address] of section.rows)if(!lines.has(line)||address<lines.get(line))lines.set(line,address)
 }
 return table
}
const cache=new Map()
/** null quando o projeto ainda não tem jogo compilado. */
export function loadDebugSymbols(projectPath,toolkitPath=''){
 const root=fs.realpathSync(projectPath)
 // Pares que os templates da IDE produzem (SGDK: out/rom.*; md-skeleton: out.elf/out.bin na raiz).
 let elfFile=null,romName='out/rom.bin'
 for(const [candidate,rom] of [['out/rom.out','out/rom.bin'],['out/rom.elf','out/rom.bin'],['build/rom.elf','out/rom.bin'],['out.elf','out.bin']])try{elfFile=regular(root,candidate);romName=rom;break}catch(error){if(error.code!=='ENOENT')throw error}
 if(!elfFile)return null
 const elfHash=hash(elfFile.bytes),key=root+'|'+elfHash+'|'+toolkitPath
 let parsed=cache.get(key)
 if(!parsed){
  const elf=parseM68kElf(elfFile.bytes)
  const lines=elf.sections.some(section=>section.name==='.debug_line'&&section.size>0)?lineTable(root,elfFile.real,toolkitPath):new Map()
  // O build comum também tem .debug_line, mas só do código de montagem do SGDK. Só vale como
  // "linha de C" quando a tabela cita um fonte C que existe dentro do projeto.
  const hasLines=[...lines.keys()].some(file=>/\.c$/i.test(file))
  parsed={...symbolTable(elfFile.bytes,elf),lines,hasLines}
  cache.clear();cache.set(key,parsed)
 }
 let rom=null
 try{const file=regular(root,romName);rom={path:file.path,real:file.real,hash:hash(file.bytes),size:file.bytes.length}}catch(error){if(error.code!=='ENOENT')throw error}
 // Mesma prova do Relatório de hardware: recibo da IDE citando exatamente estes dois arquivos.
 const snapshot=rom?inspectBuildSnapshot(root,{rom:{path:rom.path,hash:rom.hash},elf:{path:elfFile.path,hash:elfHash}}):null
 const proven=snapshot?.artifactAssociation==='matches-displayed-artifacts'
 return {root,elf:{path:elfFile.path,real:elfFile.real,hash:elfHash},rom,functions:parsed.functions,objects:parsed.objects,lines:parsed.lines,hasLines:parsed.hasLines,
  association:proven?'proven':'unproven',sourcesChanged:snapshot?.status==='changed-since-build'}
}
/** Função que contém o endereço: {name, offset} ou null. */
export function describeAddress(symbols,address){
 const list=symbols?.functions||[];let low=0,high=list.length-1,found=null
 while(low<=high){const middle=(low+high)>>1;if(list[middle].address<=address){found=list[middle];low=middle+1}else high=middle-1}
 if(!found)return null
 const offset=address-found.address
 // Sem tamanho declarado, só vale até a próxima função; longe demais não é "dentro" de nada.
 const next=list[list.indexOf(found)+1]
 if(found.size?offset>=found.size:(next?address>=next.address:offset>0x4000))return null
 return {name:found.name,offset}
}
/** Linhas de C dos endereços (addr2line do toolkit). Só arquivos dentro do projeto são navegáveis. */
export function addressLines(symbols,addresses,toolkitPath){
 const result=new Map()
 if(!symbols?.hasLines||!addresses.length)return result
 for(const [address,answer] of addr2line(symbols.elf.real,addresses.slice(0,64),toolkitPath)){
  const file=projectFile(symbols.root,answer.path)
  result.set(address,{file,external:file?null:path.basename(answer.path),line:answer.line})
 }
 return result
}
/** arquivo:linha → {address, line}. Aceita "main.c" ou "src/main.c"; nome repetido em pastas
 * diferentes é recusado em vez de adivinhado. Linha sem código cai na próxima linha com código. */
export function lineAddress(symbols,file,line){
 if(!symbols?.hasLines)return null
 const wanted=path.posix.normalize(String(file).split('\\').join('/')).replace(/^\.\//,'')
 const found=[...symbols.lines.keys()].filter(name=>name===wanted||name.endsWith('/'+wanted))
 if(found.length>1)throw Error('Há '+found.length+' arquivos “'+wanted+'” no jogo: '+found.join(', ')+'. Informe a pasta.')
 if(!found.length)return null
 const table=symbols.lines.get(found[0])
 for(let offset=0;offset<=8;offset++)if(table.has(line+offset))return {address:table.get(line+offset),file:found[0],line:line+offset}
 return null
}
/** Texto do usuário → faixa de memória: 0xFF0000 ou o nome de uma variável global do jogo. */
export function resolveData(symbols,text){
 const value=String(text||'').trim()
 if(/^(?:0x|\$)[0-9a-fA-F]{1,6}$/.test(value))return {address:parseInt(value.replace(/^(?:0x|\$)/,''),16),size:0,label:value}
 const found=(symbols?.objects||[]).filter(item=>item.name===value)
 if(found.length===1)return {address:found[0].address,size:found[0].size,label:value}
 if(found.length>1)throw Error('Há '+found.length+' variáveis chamadas “'+value+'”. Informe o endereço.')
 throw Error('“'+value+'” não é um endereço (0x…) nem uma variável global do jogo.')
}
/** Texto do usuário → endereço: 0x602, nome de função ou arquivo.c:linha. */
export function resolveLocation(symbols,text){
 const value=String(text||'').trim()
 if(/^(?:0x|\$)[0-9a-fA-F]{1,6}$/.test(value))return {address:parseInt(value.replace(/^(?:0x|\$)/,''),16),label:value}
 const line=value.match(/^([^:\s]+\.[A-Za-z]{1,4}):(\d{1,6})$/)
 if(line){
  if(!symbols?.hasLines)throw Error('Este jogo foi compilado sem informações de linha. Use “Construir para depurar” ou informe o nome de uma função.')
  const target=lineAddress(symbols,line[1],Number(line[2]))
  if(!target)throw Error('Não há código compilado em '+value+' nem nas 8 linhas seguintes.')
  return {address:target.address,label:target.file+':'+target.line}
 }
 const found=(symbols?.functions||[]).filter(item=>item.name===value)
 if(found.length===1)return {address:found[0].address,label:value}
 if(found.length>1)throw Error('Há '+found.length+' funções chamadas “'+value+'”. Use arquivo.c:linha ou o endereço.')
 throw Error('“'+value+'” não é um endereço (0x…), uma função do jogo nem arquivo.c:linha.')
}
