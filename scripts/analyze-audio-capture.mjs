// Developer tool: level and tone of each marked step in a raw emulator capture
// (SDL disk audio driver: signed 16-bit little-endian stereo).
// node scripts/analyze-audio-capture.mjs <audio.raw> <marks.txt> [--rate 44100] [--tones 251,502,880,1200]
import fs from 'node:fs'
const [rawFile,marksFile]=process.argv.slice(2)
if(!rawFile||!marksFile){console.error('usage: analyze-audio-capture.mjs <audio.raw> <marks.txt> [--rate hz] [--tones a,b,c]');process.exit(2)}
const option=(name,fallback)=>{const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1]}
const rate=Number(option('--rate',44100)),tones=String(option('--tones','251,502,880,1200')).split(',').map(Number)
const raw=fs.readFileSync(rawFile),frames=raw.length>>2,mono=new Float32Array(frames)
for(let i=0;i<frames;i++)mono[i]=(raw.readInt16LE(i*4)+raw.readInt16LE(i*4+2))/65536
const marks=fs.readFileSync(marksFile,'utf8').trim().split('\n').map(line=>{const [name,time]=line.split(' ');return {name,time:Number(time)}})
// The capture stops at the last mark; earlier marks are placed by their distance to it.
// --tail: seconds the emulator kept recording after the last mark (clean quit).
const end=marks.at(-1).time,duration=frames/rate,tail=Number(option('--tail',0.3))
// Mean amplitude over 100 ms blocks: wide enough bins for slightly detuned FM notes.
function goertzel(from,to,hz){
 const c=2*Math.cos(2*Math.PI*hz/rate),block=Math.round(rate/10);let total=0,count=0
 for(let start=from;start+block<=to;start+=block){
  let a=0,b=0
  for(let i=start;i<start+block;i++){const s=mono[i]+c*a-b;b=a;a=s}
  total+=Math.sqrt(Math.max(0,a*a+b*b-c*a*b))/block*2;count++
 }
 return count?total/count:0
}
const rows=[]
for(let i=0;i<marks.length-1;i++){
 // Skip the first 0.35 s (key press and driver latency) and stay inside the step.
 const start=duration-tail-(end-marks[i].time)+0.35,stop=Math.min(duration-tail-(end-marks[i+1].time),start+1.2)
 const from=Math.max(0,Math.round(start*rate)),to=Math.min(frames,Math.round(stop*rate))
 let sum=0;for(let j=from;j<to;j++)sum+=mono[j]*mono[j]
 rows.push({step:marks[i].name,seconds:+(to-from>0?(to-from)/rate:0).toFixed(2),rms:+Math.sqrt(sum/Math.max(1,to-from)).toFixed(4),
  tones:Object.fromEntries(tones.map(hz=>[hz,+goertzel(from,to,hz).toFixed(4)]))})
}
console.log(JSON.stringify({seconds:+duration.toFixed(2),rate,rows},null,1))
