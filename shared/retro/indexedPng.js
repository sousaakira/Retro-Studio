// #57: PNG indexado de 16 cores (índice 0 transparente), o formato que o rescomp do SGDK
// converte sem requantizar. Usado para salvar a CÓPIA de uma imagem já encaixada em uma paleta.
import {vdpToRgb} from './paletteConfiguration.js'
const TABLE=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;table[n]=c>>>0}return table})()
const crc32=bytes=>{let c=0xFFFFFFFF;for(const byte of bytes)c=TABLE[(c^byte)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function chunk(type,data){
 const out=new Uint8Array(12+data.length),view=new DataView(out.buffer)
 view.setUint32(0,data.length);for(let i=0;i<4;i++)out[4+i]=type.charCodeAt(i);out.set(data,8)
 view.setUint32(8+data.length,crc32(out.subarray(4,8+data.length)));return out
}
/** indices: Uint8Array (0–15) com width*height elementos; palette: 16 palavras do VDP. */
export async function encodeIndexedPng({width,height,indices,palette}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||indices.length!==width*height||palette.length!==16||indices.some(index=>index>15))throw Error('Invalid indexed image.')
 // 4 bits por pixel: com 8 bits o rescomp do SGDK grava uma paleta de 64 entradas para IMAGE.
 const stride=Math.ceil(width/2)+1,lines=new Uint8Array(height*stride)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)lines[y*stride+1+(x>>1)]|=indices[y*width+x]<<(x&1?0:4)
 const compressed=new Uint8Array(await new Response(new Blob([lines]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
 const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,width);view.setUint32(4,height);header[8]=4;header[9]=3
 const colors=new Uint8Array(48);palette.forEach((word,index)=>colors.set(vdpToRgb(word),index*3))
 const parts=[Uint8Array.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('PLTE',colors),chunk('tRNS',Uint8Array.from([0])),chunk('IDAT',compressed),chunk('IEND',new Uint8Array(0))]
 const out=new Uint8Array(parts.reduce((total,part)=>total+part.length,0));let offset=0
 for(const part of parts){out.set(part,offset);offset+=part.length}
 return out
}
