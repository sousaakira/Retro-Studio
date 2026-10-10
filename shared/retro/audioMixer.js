// #50: preview port of runtime/audio/retro_audio.c (music ownership and effect
// channels). smoke-runtime-audio compares every decision with the native C module.
const NONE=0xFFFF
/** effects: rows from audioEffectRows ({priority,channel}); driver callbacks are optional. */
export function createAudioMixer({musicCount,effects,channels,driver={}}){
 if(!Number.isInteger(channels)||channels<1||channels>4||!Number.isInteger(musicCount)||musicCount<0||musicCount>=NONE||!Array.isArray(effects)||
  effects.some(e=>!Number.isInteger(e.priority)||e.priority<0||e.priority>15||!Number.isInteger(e.channel)||e.channel<0||e.channel>channels))throw Error('Invalid audio mixer setup.')
 let room=NONE,scripted=NONE,playing=NONE,overridden=false,paused=false,order=0
 const voices=Array.from({length:channels},()=>({effect:NONE,priority:0,order:0,pending:0}))
 const track=value=>value===NONE||(Number.isInteger(value)&&value>=0&&value<musicCount)
 // While paused nothing starts: the wanted track begins on resume.
 const apply=()=>{const wanted=overridden?scripted:room;if(paused||wanted===playing)return;playing=wanted;driver.music?.(wanted)}
 const busy=index=>voices[index].effect!==NONE&&(voices[index].pending>0||(driver.busy?!!driver.busy(index+1):true))
 return {
  roomMusic(value){if(!track(value))return false;room=value;apply();return true},
  scriptMusic(value){if(!track(value))return false;scripted=value;overridden=true;apply();return true},
  restoreMusic(){overridden=false;scripted=NONE;apply();return true},
  /** Once per video frame, as in the C module. */
  tick(){for(const voice of voices)if(voice.pending)voice.pending--},
  pause(value){
   value=!!value;if(value===paused)return true
   paused=value
   if(!value&&(overridden?scripted:room)!==playing)apply() // starting the new track also ends the pause
   else driver.pause?.(value)
   return true
  },
  playEffect(effect){
   const result={channel:0,interrupted:NONE}
   if(!Number.isInteger(effect)||effect<0||effect>=effects.length)return result
   const e=effects[effect];let chosen=-1,free=false
   if(e.channel)chosen=e.channel-1
   else{
    for(let i=0;i<channels&&chosen<0;i++)if(!busy(i)){chosen=i;free=true}
    if(chosen<0){chosen=0;for(let i=1;i<channels;i++)if(voices[i].priority<voices[chosen].priority||(voices[i].priority===voices[chosen].priority&&voices[i].order<voices[chosen].order))chosen=i}
   }
   const occupied=e.channel?busy(chosen):!free
   if(occupied&&e.priority<voices[chosen].priority)return result
   if(occupied)result.interrupted=voices[chosen].effect
   voices[chosen]={effect,priority:e.priority,order:++order,pending:2};result.channel=chosen+1
   driver.effect?.(effect,result.channel,e.priority);return result
  },
  state(){return {room,scripted,playing,overridden:overridden?1:0,paused:paused?1:0,voices:voices.map(v=>({...v}))}}
 }
}
export const AUDIO_NONE=NONE
