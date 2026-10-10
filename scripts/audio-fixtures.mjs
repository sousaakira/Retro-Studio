// #50 test media generated in memory: no recorded or third-party audio is used.
/** PCM WAV: tone (hz) or noise burst with a linear fade, 8 or 16 bits. */
export function wavFixture({seconds=0.25,rate=14000,channels=1,bits=8,hz=0,tag=1}={}){
 const frames=Math.round(seconds*rate),width=bits/8,data=Buffer.alloc(frames*channels*width),header=Buffer.alloc(44)
 let seed=12345
 for(let i=0;i<frames;i++){
  seed=(Math.imul(seed,1103515245)+12345)>>>0
  const value=(hz?Math.sin(2*Math.PI*hz*i/rate):seed/2147483648-1)*(1-i/frames)*0.8
  for(let c=0;c<channels;c++){
   if(bits===8)data[(i*channels+c)]=Math.round(128+value*127)
   else data.writeInt16LE(Math.round(value*32767),(i*channels+c)*2)
  }
 }
 header.write('RIFF',0,'latin1');header.writeUInt32LE(36+data.length,4);header.write('WAVEfmt ',8,'latin1');header.writeUInt32LE(16,16)
 header.writeUInt16LE(tag,20);header.writeUInt16LE(channels,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*channels*width,28)
 header.writeUInt16LE(channels*width,32);header.writeUInt16LE(bits,34);header.write('data',36,'latin1');header.writeUInt32LE(data.length,40)
 return Buffer.concat([header,data])
}
/** VGM 1.50 with one looping YM2612 sine-like note (FM channel 1, single carrier). */
export function vgmFixture({block=4,fnum=0x269,seconds=1}={}){
 const commands=[],write=(register,value)=>commands.push(0x52,register,value)
 write(0x22,0);write(0x27,0);write(0x28,0);write(0x2B,0)
 for(const [base,values] of [[0x30,[1,1,1,1]],[0x40,[0x7F,0x7F,0x7F,0x10]],[0x50,[0x1F,0x1F,0x1F,0x1F]],[0x60,[0,0,0,0]],[0x70,[0,0,0,0]],[0x80,[0x0F,0x0F,0x0F,0x0F]]])
  values.forEach((value,index)=>write(base+index*4,value))
 write(0xB0,7);write(0xB4,0xC0);write(0xA4,(block<<3)|(fnum>>8));write(0xA0,fnum&255);write(0x28,0xF0)
 const loopAt=commands.length,frames=Math.round(seconds*60)
 for(let i=0;i<frames;i++)commands.push(0x62)
 commands.push(0x66)
 const header=Buffer.alloc(0x40),body=Buffer.from(commands),samples=frames*735
 header.write('Vgm ',0,'latin1');header.writeUInt32LE(0x40+body.length-4,4);header.writeUInt32LE(0x150,8)
 header.writeUInt32LE(samples,0x18);header.writeUInt32LE(0x40+loopAt-0x1C,0x1C);header.writeUInt32LE(samples,0x20);header.writeUInt32LE(60,0x24)
 header.writeUInt32LE(7670453,0x2C);header.writeUInt32LE(0x40-0x34,0x34)
 return Buffer.concat([header,body])
}
