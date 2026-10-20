// #89: YM2612 (OPN2) emulado por registradores, para ouvir no editor o que vai para o VGM.
// Fiel no que importa para compor: 6 canais, 8 algoritmos, feedback, envelope ADSR com as taxas do
// chip, detune, multiplicador, key scaling, LFO (AM/PM), pan e DAC do canal 6. Fora: SSG-EG,
// modo especial do canal 3, timers e o "ladder effect" do DAC. Pura: roda no AudioWorklet e no Node.
export const YM2612_CLOCK_NTSC=7670453
export const YM2612_CLOCK_PAL=7600489
const SIN=new Float32Array(1024)
for(let index=0;index<1024;index++)SIN[index]=Math.sin((index+.5)*Math.PI/512)
// Atenuação em passos de 0,09375 dB (64 passos = 6 dB) → ganho linear.
const GAIN=new Float32Array(1024)
for(let index=0;index<1024;index++)GAIN[index]=2**(-index/64)
// Fração da nota (bits 10..7 do F-number) para o key code.
const FKT=[0,0,0,0,0,0,0,1,2,3,3,3,3,3,3,3]
const DETUNE=[
 new Array(32).fill(0),
 [0,0,0,0,1,1,1,1,1,1,1,1,2,2,2,2,2,3,3,3,4,4,4,5,5,6,6,7,8,8,8,8],
 [1,1,1,1,2,2,2,2,2,3,3,3,4,4,4,5,5,6,6,7,8,8,9,10,11,12,13,14,16,16,16,16],
 [2,2,2,2,2,3,3,3,4,4,4,5,5,6,6,7,8,8,9,10,11,12,13,14,16,17,19,20,22,22,22,22]
]
// Incrementos do envelope por taxa: 8 ciclos por linha (taxas < 48 usam as 4 primeiras).
const EG_INC=[
 [0,1,0,1,0,1,0,1],[0,1,0,1,1,1,0,1],[0,1,1,1,0,1,1,1],[0,1,1,1,1,1,1,1],
 [1,1,1,1,1,1,1,1],[1,1,1,2,1,1,1,2],[1,2,1,2,1,2,1,2],[1,2,2,2,1,2,2,2],
 [2,2,2,2,2,2,2,2],[2,2,2,4,2,2,2,4],[2,4,2,4,2,4,2,4],[2,4,4,4,2,4,4,4],
 [4,4,4,4,4,4,4,4],[4,4,4,8,4,4,4,8],[4,8,4,8,4,8,4,8],[4,8,8,8,4,8,8,8],[8,8,8,8,8,8,8,8]
]
const LFO_HZ=[3.98,5.56,6.02,6.37,6.88,9.63,48.1,72.2]
const AMS_DB=[0,1.4,5.9,11.8]
const PMS_CENTS=[0,3.4,6.7,10,14,20,40,80]
// Ordem dos operadores nos registradores: +0 S1, +4 S3, +8 S2, +C S4 (os arrays usam S1..S4).
const SLOT=[0,2,1,3]
const ATTACK=1,DECAY=2,SUSTAIN=3,RELEASE=4,OFF=0
const CARRIERS=[[3],[3],[3],[3],[1,3],[1,2,3],[1,2,3],[0,1,2,3]]

function createOperator(){
 return {dt:0,mul:1,tl:0,ks:0,ar:0,am:0,d1r:0,d2r:0,sl:0,rr:0,ssg:0,phase:0,inc:0,att:1023,state:OFF,out:0,ksr:0}
}
function createChannel(){
 return {ops:[createOperator(),createOperator(),createOperator(),createOperator()],fnum:0,block:0,latch:0,kc:0,
  alg:0,fb:0,left:true,right:true,ams:0,pms:0,fb0:0,fb1:0,out:0}
}

export class Ym2612{
 constructor(clock=YM2612_CLOCK_NTSC){
  this.clock=clock
  this.sampleRate=clock/144
  this.reset()
 }
 reset(){
  this.channels=Array.from({length:6},createChannel)
  this.lfoOn=false;this.lfoRate=0;this.lfoPhase=0
  this.dacOn=false;this.dac=0
  this.egTimer=0;this.egCounter=0
  this.left=0;this.right=0
  this.registers=[new Uint8Array(256),new Uint8Array(256)]
  for(let port=0;port<2;port++)for(let channel=0;channel<3;channel++)this.write(port,0xb4+channel,0xc0)
 }
 write(port,address,data){
  port&=1;address&=0xff;data&=0xff
  this.registers[port][address]=data
  if(port===0&&address<0x30){
   if(address===0x22){this.lfoOn=!!(data&8);this.lfoRate=data&7;if(!this.lfoOn)this.lfoPhase=0}
   else if(address===0x28){
    const low=data&7
    if((low&3)===3)return
    const channel=this.channels[(low&3)+(low&4?3:0)]
    // Bits 4..7 ligam S1, S2, S3, S4.
    for(let slot=0;slot<4;slot++)(data&(0x10<<slot))?this.keyOn(channel,channel.ops[slot]):this.keyOff(channel.ops[slot])
   }
   else if(address===0x2a)this.dac=data
   else if(address===0x2b)this.dacOn=!!(data&0x80)
   return
  }
  const index=address&3
  if(index===3||address<0x30)return
  const channel=this.channels[index+port*3]
  if(address<0xa0){
   const op=channel.ops[SLOT[(address>>2)&3]]
   switch(address&0xf0){
    case 0x30:op.dt=(data>>4)&7;op.mul=data&15;break
    case 0x40:op.tl=data&0x7f;break
    case 0x50:op.ks=data>>6;op.ar=data&31;break
    case 0x60:op.am=data>>7;op.d1r=data&31;break
    case 0x70:op.d2r=data&31;break
    case 0x80:op.sl=data>>4;op.rr=data&15;break
    case 0x90:op.ssg=data&15;break
   }
   this.updateChannel(channel)
   return
  }
  switch(address&0xfc){
   case 0xa4:channel.latch=data&0x3f;break
   case 0xa0:channel.fnum=((channel.latch&7)<<8)|data;channel.block=(channel.latch>>3)&7;this.updateChannel(channel);break
   case 0xb0:channel.fb=(data>>3)&7;channel.alg=data&7;break
   case 0xb4:channel.left=!!(data&0x80);channel.right=!!(data&0x40);channel.ams=(data>>4)&3;channel.pms=data&7;break
  }
 }
 updateChannel(channel){
  channel.kc=(channel.block<<2)|FKT[channel.fnum>>7]
  const base=(channel.fnum<<channel.block)>>1
  for(const op of channel.ops){
   const detune=DETUNE[op.dt&3][channel.kc]
   const fc=(base+(op.dt&4?-detune:detune))&0x1ffff
   op.inc=op.mul?fc*op.mul:fc>>1
   op.ksr=channel.kc>>(3-op.ks)
  }
 }
 keyOn(channel,op){
  if(op.state!==OFF&&op.state!==RELEASE)return
  op.phase=0;op.state=ATTACK
  if(this.rate(op,op.ar)>=62){op.att=0;op.state=DECAY}
 }
 keyOff(op){if(op.state!==OFF)op.state=RELEASE}
 rate(op,value){return value?Math.min(63,value*2+op.ksr):0}
 envelope(op){
  let rate
  switch(op.state){
   case ATTACK:rate=this.rate(op,op.ar);break
   case DECAY:rate=this.rate(op,op.d1r);break
   case SUSTAIN:rate=this.rate(op,op.d2r);break
   case RELEASE:rate=Math.min(63,op.rr*4+2+op.ksr);break
   default:return
  }
  if(rate<2)return
  const shift=rate<48?11-(rate>>2):0
  if(this.egCounter&((1<<shift)-1))return
  const increment=EG_INC[rate<48?rate&3:Math.min(16,rate-44)][(this.egCounter>>shift)&7]
  if(op.state===ATTACK){
   if(rate>=62)op.att=0
   else op.att+=(~op.att*increment)>>4
   if(op.att<=0){op.att=0;op.state=DECAY}
   return
  }
  op.att+=increment
  if(op.state===DECAY){const level=op.sl===15?1023:op.sl<<5;if(op.att>=level){op.att=level;op.state=SUSTAIN}}
  if(op.att>=1023){op.att=1023;if(op.state===RELEASE)op.state=OFF}
 }
 operator(op,modulation,am,pm){
  const attenuation=op.att+(op.tl<<3)+(op.am?am:0)
  const phase=op.phase
  op.phase=(phase+(pm===1?op.inc:Math.round(op.inc*pm)))&0xfffff
  if(attenuation>=1024)return op.out=0
  return op.out=SIN[((phase>>10)+((modulation*4096)|0))&1023]*GAIN[attenuation]
 }
 /** Um passo do chip (clock/144 Hz); deixa a saída em this.left/this.right (cerca de ±1 por canal). */
 step(){
  if(++this.egTimer>=3){
   this.egTimer=0;this.egCounter=(this.egCounter+1)&0xfff
   for(const channel of this.channels)for(const op of channel.ops)this.envelope(op)
  }
  let lfo=0,lfoSigned=0
  if(this.lfoOn){
   this.lfoPhase=(this.lfoPhase+LFO_HZ[this.lfoRate]/this.sampleRate)%1
   lfo=this.lfoPhase<.5?this.lfoPhase*2:2-this.lfoPhase*2
   lfoSigned=Math.sin(this.lfoPhase*2*Math.PI)
  }
  let left=0,right=0
  for(let index=0;index<6;index++){
   const channel=this.channels[index]
   let out
   if(index===5&&this.dacOn)out=(this.dac-128)/128
   else{
    const am=channel.ams?Math.round(lfo*AMS_DB[channel.ams]/.09375):0
    const pm=channel.pms&&this.lfoOn?2**(lfoSigned*PMS_CENTS[channel.pms]/1200):1
    out=this.algorithm(channel,am,pm)
   }
   channel.out=out=out>1?1:out<-1?-1:out
   if(channel.left)left+=out
   if(channel.right)right+=out
  }
  this.left=left;this.right=right
 }
 algorithm(channel,am,pm){
  const [s1,s2,s3,s4]=channel.ops
  // Feedback do S1: média das duas últimas saídas, 2^(fb+3) passos de fase por unidade.
  const feedback=channel.fb?(channel.fb0+channel.fb1)*(2**(channel.fb-9)):0
  channel.fb1=channel.fb0
  const o1=channel.fb0=this.operator(s1,feedback,am,pm)
  let o2,o3,o4
  switch(channel.alg){
   case 0:o2=this.operator(s2,o1,am,pm);o3=this.operator(s3,o2,am,pm);return this.operator(s4,o3,am,pm)
   case 1:o2=this.operator(s2,0,am,pm);o3=this.operator(s3,o1+o2,am,pm);return this.operator(s4,o3,am,pm)
   case 2:o2=this.operator(s2,0,am,pm);o3=this.operator(s3,o2,am,pm);return this.operator(s4,o1+o3,am,pm)
   case 3:o2=this.operator(s2,o1,am,pm);o3=this.operator(s3,0,am,pm);return this.operator(s4,o2+o3,am,pm)
   case 4:o2=this.operator(s2,o1,am,pm);o3=this.operator(s3,0,am,pm);o4=this.operator(s4,o3,am,pm);return o2+o4
   case 5:o2=this.operator(s2,o1,am,pm);o3=this.operator(s3,o1,am,pm);o4=this.operator(s4,o1,am,pm);return o2+o3+o4
   case 6:o2=this.operator(s2,o1,am,pm);o3=this.operator(s3,0,am,pm);o4=this.operator(s4,0,am,pm);return o2+o3+o4
   default:return o1+this.operator(s2,0,am,pm)+this.operator(s3,0,am,pm)+this.operator(s4,0,am,pm)
  }
 }
 /** Canais com algum operador soando (para a interface mostrar quem está ocupado). */
 activeChannels(){return this.channels.map(channel=>CARRIERS[channel.alg].some(slot=>channel.ops[slot].state!==OFF))}
}
