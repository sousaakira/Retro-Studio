// #89: PSG do Mega Drive (SN76489 dentro do VDP): 3 canais de onda quadrada e 1 de ruído,
// volume em 16 passos de 2 dB. Ruído com LFSR de 16 bits (taps 0 e 3, como no VDP da Sega).
export const PSG_CLOCK_NTSC=3579545
export const PSG_CLOCK_PAL=3546893
const VOLUME=Array.from({length:16},(_,index)=>index===15?0:10**(-index/10))

export class Sn76489{
 constructor(clock=PSG_CLOCK_NTSC){this.clock=clock;this.reset()}
 reset(){
  this.period=[0x3ff,0x3ff,0x3ff,0x10]
  this.volume=[15,15,15,15]
  this.counter=[0,0,0,0]
  this.output=[1,1,1,1]
  this.noise=0;this.lfsr=0x8000;this.latch=0
 }
 /** Um byte como o 68000/Z80 escreve na porta do PSG. */
 write(byte){
  byte&=0xff
  if(byte&0x80){
   this.latch=(byte>>4)&7
   const channel=this.latch>>1,data=byte&15
   if(this.latch&1)this.volume[channel]=data
   else if(channel===3)this.setNoise(data)
   else this.period[channel]=(this.period[channel]&0x3f0)|data
   return
  }
  const channel=this.latch>>1
  if(this.latch&1)this.volume[channel]=byte&15
  else if(channel===3)this.setNoise(byte&7)
  else this.period[channel]=(this.period[channel]&15)|((byte&0x3f)<<4)
 }
 setNoise(data){
  this.noise=data&7;this.lfsr=0x8000
  const rate=data&3
  this.period[3]=rate===3?0:0x10<<rate
 }
 /** Avança o chip por 1/sampleRate s; devolve a saída mono (cerca de 0..1 por canal). */
 sample(sampleRate){
  const ticks=this.clock/16/sampleRate
  let mix=0
  for(let channel=0;channel<4;channel++){
   const period=channel===3?Math.max(1,this.period[3]||this.period[2]):this.period[channel]
   // Período 0 ou 1 deixa a saída parada em 1 (era assim que se tocava PCM no PSG).
   if(channel<3&&period<=1){mix+=VOLUME[this.volume[channel]];continue}
   let high=0,remaining=ticks,counter=this.counter[channel]>0?this.counter[channel]:period
   while(remaining>0){
    const run=Math.min(remaining,counter)
    if(this.output[channel]>0)high+=run
    counter-=run;remaining-=run
    if(counter>0)continue
    counter=period
    this.output[channel]=-this.output[channel]
    // O LFSR anda na subida do divisor de ruído.
    if(channel===3&&this.output[3]>0){
     const bit=this.noise&4?(this.lfsr^(this.lfsr>>3))&1:this.lfsr&1
     this.lfsr=(this.lfsr>>1)|(bit<<15)
    }
   }
   this.counter[channel]=counter
   // Fração do tempo em nível alto: suaviza notas agudas sem custo de filtro.
   const level=channel<3?high/ticks:(this.lfsr&1)
   mix+=VOLUME[this.volume[channel]]*(level*2-1)
  }
  return mix
 }
}
