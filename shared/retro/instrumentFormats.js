// #89: importar e exportar instrumentos do YM2612 nos formatos dos trackers.
// Referência: carregadores do Furnace (src/engine/fileOpsIns.cpp) e papers/newIns.md.
// - Todos guardam os operadores na ordem dos registradores (S1, S3, S2, S4); o modelo do Retro
//   Studio usa S1..S4, então o 2º e o 3º trocam de lugar.
// - Detune: TFI, DMP e FUI usam a escala do Furnace/DefleMask (3 = sem detune, 0..2 negativos,
//   4..6 positivos); OPNI/WOPN guardam o byte do registrador (0..3 positivos, 4..7 negativos).
// Puro (DataView): roda na interface e no Node.
import {validateInstrument,PRESET_INSTRUMENTS} from './chipInstruments.js'

export const INSTRUMENT_IMPORT_FORMATS=Object.freeze(['.tfi','.dmp','.fui','.opni','.wopn'])
export const INSTRUMENT_EXPORT_FORMATS=Object.freeze({tfi:'TFI (TFM Music Maker)',dmp:'DMP (DefleMask)',fui:'FUI (Furnace)',opni:'OPNI (OPN2 Bank Editor)'})
const FILE_ORDER=[0,2,1,3]   // posição no arquivo → índice S1..S4 (é a própria inversa)
const FURNACE_TO_REGISTER=[7,6,5,0,1,2,3,4]
const dtFromFurnace=value=>FURNACE_TO_REGISTER[value&7]
const dtToFurnace=value=>(value&7)>=4?7-(value&7):(value&7)+3
const clamp=(value,max)=>Math.max(0,Math.min(max,value|0))

// Nomes em UTF-8; arquivos antigos de tracker usam Latin-1.
const decodeName=bytes=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes).trim()}catch{return new TextDecoder('latin1').decode(bytes).trim()}}
function reader(bytes){
 const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength)
 let at=0
 const need=count=>{if(at+count>data.length)throw Error('Arquivo de instrumento incompleto.')}
 return {
  get at(){return at},set at(value){at=value},length:data.length,
  u8(){need(1);return data[at++]},
  u16(){need(2);const value=view.getUint16(at,true);at+=2;return value},
  u16be(){need(2);const value=view.getUint16(at,false);at+=2;return value},
  i32(){need(4);const value=view.getInt32(at,true);at+=4;return value},
  text(count){need(count);const slice=data.subarray(at,at+count);at+=count;const end=slice.indexOf(0);return decodeName(end<0?slice:slice.subarray(0,end))},
  cstring(){const start=at;while(at<data.length&&data[at])at++;const value=new TextDecoder().decode(data.subarray(start,at));if(at<data.length)at++;return value.trim()},
  bytes(count){need(count);const value=data.subarray(at,at+count);at+=count;return value},
  ascii(count){need(count);return String.fromCharCode(...data.subarray(at,at+=count))}
 }
}
// Nome que cabe no modelo (até 64 caracteres; vazio vira "Instrumento").
const cleanName=name=>String(name||'').trim().slice(0,64).trim()||'Instrumento'
function emptyOps(){return [0,1,2,3].map(()=>({ar:31,d1r:0,d2r:0,rr:15,sl:0,tl:127,ks:0,mul:1,dt:0,am:0,ssg:0}))}
function fmInstrument(name,{alg,fb,ams=0,pms=0,fileOps}){
 const ops=emptyOps()
 fileOps.forEach((op,position)=>{ops[FILE_ORDER[position]]={ar:clamp(op.ar,31),d1r:clamp(op.d1r,31),d2r:clamp(op.d2r,31),rr:clamp(op.rr,15),sl:clamp(op.sl,15),
  tl:clamp(op.tl,127),ks:clamp(op.ks,3),mul:clamp(op.mul,15),dt:clamp(op.dt,7),am:op.am?1:0,ssg:clamp(op.ssg,15)}})
 return {name:cleanName(name),kind:'fm',alg:clamp(alg,7),fb:clamp(fb,7),ams:clamp(ams,3),pms:clamp(pms,7),ops}
}
// Registradores crus de um operador (OPNI/WOPN): DT/MUL, TL, RS/AR, AM/D1R, D2R, SL/RR, SSG-EG.
function rawOperator(input){
 const [dtMul,tl,rsAr,amDr,d2r,slRr,ssg]=input.bytes(7)
 return {mul:dtMul&15,dt:(dtMul>>4)&7,tl:tl&0x7f,ks:rsAr>>6,ar:rsAr&31,am:amDr>>7,d1r:amDr&31,d2r:d2r&31,sl:slRr>>4,rr:slRr&15,ssg:ssg&15}
}

function readTfi(input,name){
 if(input.length!==42)throw Error('TFI tem 42 bytes; este tem '+input.length+'.')
 const alg=input.u8(),fb=input.u8(),fileOps=[]
 for(let index=0;index<4;index++){
  const mul=input.u8(),dt=input.u8(),tl=input.u8(),ks=input.u8(),ar=input.u8(),d1r=input.u8(),d2r=input.u8(),rr=input.u8(),sl=input.u8(),ssg=input.u8()
  fileOps.push({mul,dt:dtFromFurnace(dt),tl,ks,ar,d1r,d2r,rr,sl,ssg})
 }
 return {instruments:[fmInstrument(name,{alg,fb,fileOps})],warnings:[]}
}

function readDmp(input,name){
 const version=input.u8()
 if(version>11)throw Error('DMP versão '+version+' não suportada.')
 let system=2
 // 2 = Genesis, 3 = SMS (PSG), 9 = Neo Geo: o FM do YM2610 é o mesmo OPN de 4 operadores do YM2612.
 if(version>=11){system=input.u8();if(![2,3,9].includes(system))throw Error(system===8?'Este DMP é do YM2151 (arcade), um chip FM diferente do YM2612.':'Este DMP é de outro sistema (código '+system+'), não do Mega Drive.')}
 const mode=version>1?input.u8():1
 if(!mode)return readDmpPsg(input,name,version,system)
 if(system!==2&&system!==9)throw Error('DMP FM de outro sistema.')
 if(version<10){const count=input.length===51||input.length===49?(input.u8(),4):(input.u8()?4:2);if(count!==4)throw Error('DMP de FM com 2 operadores (OPL) não é do YM2612.')}
 const pms=version>1?input.u8():0,fb=input.u8(),alg=input.u8(),ams=input.u8(),fileOps=[]
 for(let index=0;index<4;index++){
  const mul=input.u8(),tl=input.u8(),ar=input.u8(),d1r=input.u8(),sl=input.u8(),rr=input.u8(),am=input.u8(),ks=input.u8(),dt=input.u8(),d2r=input.u8(),ssg=input.u8()
  fileOps.push({mul,tl,ar,d1r,sl,rr,am,ks,dt:dtFromFurnace(dt&15),d2r,ssg})
 }
 return {instruments:[fmInstrument(name,{alg,fb,ams,pms,fileOps})],warnings:[]}
}
// Macro de volume do PSG (0..15, 15 = mais alto, um valor por quadro) → envelope aproximado.
const PSG_WARNING='Instrumento PSG: a macro de volume virou um envelope aproximado; arpejo e outras macros foram ignorados.'
function psgFromVolumeMacro(name,values){
 if(!values.length)return {name:cleanName(name),kind:'psg',envelope:{volume:0,attack:0,decay:0,sustain:0,release:2}}
 const levels=values.map(value=>15-clamp(value,15)),peak=levels.indexOf(Math.min(...levels)),volume=levels[peak],last=levels[levels.length-1]
 return {name:cleanName(name),kind:'psg',envelope:{volume,attack:Math.min(255,peak),decay:Math.min(255,levels.length-1-peak),sustain:Math.max(0,last-volume),release:2}}
}
// DMP do PSG (SMS).
function readDmpPsg(input,name,version,system){
 if(system!==3&&system!==2)throw Error('DMP padrão de outro sistema.')
 const length=input.u8(),values=[]
 for(let index=0;index<length;index++)values.push(version>5?input.i32():input.u8())
 return {instruments:[psgFromVolumeMacro(name,values)],warnings:[PSG_WARNING]}
}
// FUI de SN76489 (tipo 0): a macro de volume (recurso MA, código 0) vira o envelope.
function readFuiPsg(input,name){
 let title=name,volume=[]
 while(input.at+4<=input.length){
  const code=input.ascii(2)
  if(code==='EN')break
  const size=input.u16(),end=input.at+size
  if(end>input.length)throw Error('Instrumento do Furnace incompleto.')
  if(code==='NA')title=input.cstring()||name
  else if(code==='MA'){
   const header=input.u16()
   while(input.at<end){
    const start=input.at,macro=input.u8()
    if(macro===255)break
    const length=input.u8();input.u8();input.u8();input.u8()
    const flags=input.u8(),wordSize=[1,1,2,4][flags>>6],signed=(flags>>6)!==0
    input.at=start+header
    const values=[]
    for(let index=0;index<length;index++){
     const bytes=input.bytes(wordSize)
     let value=bytes.reduce((sum,byte,shift)=>sum+byte*256**shift,0)
     if(signed&&value>=2**(8*wordSize-1))value-=2**(8*wordSize)
     values.push(value)
    }
    // Só a macro de volume em sequência normal (ADSR/LFO do Furnace não têm equivalente direto).
    if(macro===0&&((flags>>1)&3)===0)volume=values
   }
  }
  input.at=end
 }
 return {instruments:[psgFromVolumeMacro(title,volume)],warnings:[PSG_WARNING]}
}

function readOpniRecord(input,version){
 const name=input.text(32)
 input.bytes(3)   // nota MIDI de deslocamento e tecla de percussão
 const fbAlg=input.u8(),lfo=input.u8(),fileOps=[0,1,2,3].map(()=>rawOperator(input))
 if(version>=2)input.bytes(4)   // atrasos de key-on/key-off do OPN2 Bank Editor
 return {name,fbAlg,lfo,fileOps}
}
const opniInstrument=(record,fallback)=>fmInstrument(record.name||fallback,{alg:record.fbAlg&7,fb:(record.fbAlg>>3)&7,ams:(record.lfo>>4)&3,pms:record.lfo&7,fileOps:record.fileOps})
function wopnVersion(input){
 const at=input.at,version=input.u16()
 if(version>=2&&version<=15)return version
 input.at=at;return 1
}
function readOpni(input,name){
 const magic=input.text(11)
 if(magic!=='WOPN2-INST'&&magic!=='WOPN2-IN2T')throw Error('Não é um arquivo OPNI.')
 const version=wopnVersion(input)
 input.u8()   // percussão
 return {instruments:[opniInstrument(readOpniRecord(input,version),name)],warnings:[]}
}
function readWopn(input,name){
 const magic=input.text(11)
 if(magic!=='WOPN2-BANK'&&magic!=='WOPN2-B2NK')throw Error('Não é um banco WOPN.')
 const version=wopnVersion(input),melodic=input.u16be(),percussion=input.u16be()
 input.u8()   // LFO global do banco
 if(melodic+percussion>64)throw Error('Banco WOPN com bancos demais.')
 if(version>=2)input.bytes(34*(melodic+percussion))
 const instruments=[]
 for(let bank=0;bank<melodic+percussion;bank++)for(let patch=0;patch<128;patch++){
  const record=readOpniRecord(input,version)
  // Patch vazio (tudo zero) fica de fora, como no Furnace.
  if(!record.name&&!record.fbAlg&&!record.lfo&&record.fileOps.every(op=>!op.mul&&!op.dt&&!op.tl&&!op.ar&&!op.d1r&&!op.d2r&&!op.sl&&!op.rr&&!op.ks&&!op.am&&!op.ssg))continue
  instruments.push(opniInstrument(record,(name||'WOPN')+' '+(bank<melodic?'':'percussão ')+(patch+1)))
 }
 return {instruments,warnings:instruments.length?[]:['O banco não tem instrumentos.']}
}

function readFui(input,name){
 const magic=input.ascii(4)
 if(magic==='-Fur')return readOldFui(input,name)
 if(magic!=='FINS')throw Error('Não é um instrumento do Furnace (.fui).')
 const version=input.u16(),type=input.u16()
 if(type===0)return readFuiPsg(input,name)
 if(type!==1)throw Error('Este instrumento do Furnace não é do Mega Drive (tipo '+type+').')
 let title=name,fm=null
 while(input.at+4<=input.length){
  const code=input.ascii(2)
  if(code==='EN')break
  const size=input.u16(),end=input.at+size
  if(end>input.length)throw Error('Instrumento do Furnace incompleto.')
  if(code==='NA')title=input.cstring()||name
  else if(code==='FM'){
   const flags=input.u8(),count=flags&15
   const algFb=input.u8(),lfo=input.u8()
   input.u8()
   if(version>=224)input.u8()
   if(count!==4)throw Error('Instrumento FM do Furnace com '+count+' operadores; o YM2612 usa 4.')
   const fileOps=[]
   for(let index=0;index<4;index++){
    const [dtMul,tl,rsAr,amDr,d2r,slRr,ssg]=input.bytes(7);input.u8()
    fileOps.push({mul:dtMul&15,dt:dtFromFurnace((dtMul>>4)&7),tl:tl&0x7f,ks:rsAr>>6,ar:rsAr&31,am:amDr>>7,d1r:amDr&31,d2r:d2r&31,sl:slRr>>4,rr:slRr&15,ssg:ssg&15})
   }
   fm={alg:(algFb>>4)&7,fb:algFb&7,ams:(lfo>>3)&3,pms:lfo&7,fileOps}
  }
  input.at=end
 }
 if(!fm)throw Error('O instrumento do Furnace não tem dados FM.')
 return {instruments:[fmInstrument(title,fm)],warnings:['Macros do Furnace (volume, arpejo, operadores) não são importadas: só o patch FM.']}
}

// Formato antigo do Furnace (versão < 127, papers/oldIns.md): bloco INST com o instrumento inteiro.
function readOldFui(input,name){
 if(input.ascii(12)!=='nace instr.-')throw Error('Não é um instrumento do Furnace (.fui).')
 input.u16();input.u16()
 const pointer=input.u16()|(input.u16()<<16)
 input.at=pointer
 if(input.ascii(4)!=='INST')throw Error('Instrumento do Furnace (formato antigo) sem o bloco INST.')
 input.u16();input.u16()   // tamanho do bloco
 const version=input.u16(),type=input.u8();input.u8()
 if(type!==1&&type!==0)throw Error('Este instrumento do Furnace não é do Mega Drive (tipo '+type+').')
 const title=input.cstring()||name
 // O instrumento inteiro vem gravado: FM sempre, mesmo num instrumento de PSG.
 const alg=input.u8(),fb=input.u8(),pms=input.u8(),ams=input.u8()
 input.bytes(4)   // nº de operadores (sempre 4 no OPN), preset OPLL, reservado
 const fileOps=[]
 for(let index=0;index<4;index++){
  const [am,ar,d1r,mul,rr,sl,tl,,ks,dt,d2r,ssg]=input.bytes(32)
  fileOps.push({am,ar,d1r,mul,rr,sl,tl,ks,dt:dtFromFurnace(dt),d2r,ssg})
 }
 if(type===0){
  // SN76489: pula Game Boy (4), C64 (24) e Amiga (16); macros: tamanhos, loops, 4 bytes, volume (int32).
  input.bytes(4+24+16)
  const count=version>=17?8:4,volumeLength=input.i32()
  input.bytes((count-1)*4+count*4+4)
  const values=[]
  for(let index=0;index<Math.min(Math.max(volumeLength,0),256);index++)values.push(input.i32())
  return {instruments:[psgFromVolumeMacro(title,values)],warnings:[PSG_WARNING]}
 }
 return {instruments:[fmInstrument(title,{alg,fb,ams,pms,fileOps})],warnings:['Macros do Furnace (volume, arpejo, operadores) não são importadas: só o patch FM.']}
}

/** Lê um arquivo de instrumento; devolve instrumentos sem ID (o editor dá IDs livres na música). */
export function importInstrumentFile(fileName,bytes){
 const base=String(fileName||'').split(/[\\/]/).pop()
 const name=base.replace(/\.[^.]+$/,'').slice(0,64)
 const extension=(base.match(/\.[^.]+$/)?.[0]||'').toLowerCase()
 const input=reader(bytes)
 const head=String.fromCharCode(...(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)).subarray(0,10))
 if(head==='WOPN2-INST'||head==='WOPN2-IN2T')return readOpni(input,name)
 if(head==='WOPN2-BANK'||head==='WOPN2-B2NK')return readWopn(input,name)
 if(head.startsWith('FINS')||head.startsWith('-Fur'))return readFui(input,name)
 if(extension==='.fui')return readFui(input,name)
 if(extension==='.tfi')return readTfi(input,name)
 if(extension==='.dmp')return readDmp(input,name)
 throw Error('Formato de instrumento não reconhecido. Use '+INSTRUMENT_IMPORT_FORMATS.join(', ')+'.')
}

/** Escreve um instrumento FM no formato pedido (tfi, dmp, fui, opni). */
export function exportInstrument(instrument,format){
 if(instrument?.kind!=='fm')throw Error('Só instrumentos FM são exportados para formatos de tracker.')
 const fileOps=FILE_ORDER.map(index=>instrument.ops[index])
 const out=[]
 if(format==='tfi'){
  out.push(instrument.alg,instrument.fb)
  for(const op of fileOps)out.push(op.mul,dtToFurnace(op.dt),op.tl,op.ks,op.ar,op.d1r,op.d2r,op.rr,op.sl,op.ssg)
 }else if(format==='dmp'){
  out.push(11,2,1,instrument.pms,instrument.fb,instrument.alg,instrument.ams)
  for(const op of fileOps)out.push(op.mul,op.tl,op.ar,op.d1r,op.sl,op.rr,op.am,op.ks,dtToFurnace(op.dt),op.d2r,op.ssg)
 }else if(format==='opni'){
  out.push(...'WOPN2-INST'.split('').map(c=>c.charCodeAt(0)),0,2,0,0)
  // Até 31 bytes sem partir um caractere UTF-8 no meio.
  let text=instrument.name,title=new TextEncoder().encode(text)
  while(title.length>31){text=text.slice(0,-1);title=new TextEncoder().encode(text)}
  out.push(...title,...new Array(32-title.length).fill(0),0,0,0,(instrument.fb<<3)|instrument.alg,(instrument.ams<<4)|instrument.pms)
  for(const op of fileOps)out.push((op.dt<<4)|op.mul,op.tl,(op.ks<<6)|op.ar,(op.am<<7)|op.d1r,op.d2r,(op.sl<<4)|op.rr,op.ssg)
  out.push(0,0,0,0)
 }else if(format==='fui'){
  const title=[...new TextEncoder().encode(instrument.name.slice(0,64)),0]
  const fm=[0xf4,(instrument.alg<<4)|instrument.fb,(instrument.ams<<3)|instrument.pms,0,0]
  for(const op of fileOps)fm.push((dtToFurnace(op.dt)<<4)|op.mul,op.tl,(op.ks<<6)|op.ar,(op.am<<7)|op.d1r,op.d2r,(op.sl<<4)|op.rr,op.ssg,0)
  const feature=(code,data)=>[code.charCodeAt(0),code.charCodeAt(1),data.length&0xff,data.length>>8,...data]
  out.push(...'FINS'.split('').map(c=>c.charCodeAt(0)),224,0,1,0,...feature('NA',title),...feature('FM',fm),...'EN'.split('').map(c=>c.charCodeAt(0)))
 }else throw Error('Formato de exportação desconhecido: '+format)
 return new Uint8Array(out)
}

/** ID livre para um instrumento da música, a partir do nome. */
export function instrumentIdFor(name,taken){
 const used=new Set([...PRESET_INSTRUMENTS.map(item=>item.id),...taken])
 const base=('meu-'+String(name||'instrumento').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')).slice(0,40).replace(/-+$/,'')||'meu-instrumento'
 let id=base,index=2
 while(used.has(id))id=base+'-'+index++
 return id
}
/** Instrumento importado/copiado → instrumento da música (ID livre, validado). */
export function songInstrument(source,taken,category='Da música'){
 const {id:_id,category:_category,...rest}=source
 return validateInstrument({...JSON.parse(JSON.stringify(rest)),id:instrumentIdFor(source.name,taken),name:String(source.name||'Instrumento').slice(0,64)||'Instrumento',category})
}
