<script setup>
// #100: versões de ROM para teste. Build limpo de release, cópia numerada em releases/<versão>/
// e registro do que mudou (releases.json e CHANGELOG.md), que a IA também lê. compact: a janela do
// botão Construir (só o formulário e a última versão); o modo Rodar mostra a lista inteira.
import {ref,computed,watch,onBeforeUnmount} from 'vue'
import {useI18n} from 'vue-i18n'
import {releaseMarkdown,validVersion,parseChanges} from '../../../shared/retro/romReleases.js'
const {t,locale}=useI18n()
const props=defineProps({projectPath:{type:String,default:''},active:Boolean,busy:Boolean,compact:Boolean})
const emit=defineEmits(['built','building'])
const status=ref(null),version=ref(''),title=ref(''),changes=ref(''),notes=ref(''),creating=ref(false),progress=ref(''),error=ref(''),done=ref(null),copied=ref('')
let request=0,disposed=false,unsubscribe=null
const releases=computed(()=>status.value?.releases||[])
const shown=computed(()=>props.compact?releases.value.slice(0,1):releases.value)
const versionProblem=computed(()=>{
 const value=version.value.trim()
 if(!value)return ''
 if(!validVersion(value))return t('romReleases.badVersion')
 return releases.value.some(item=>item.version===value)?t('romReleases.exists'):''
})
const canCreate=computed(()=>!!props.projectPath&&!props.busy&&!creating.value&&validVersion(version.value.trim())&&!versionProblem.value&&(parseChanges(changes.value).length>0||!!notes.value.trim()))
const size=bytes=>bytes>=1048576?(bytes/1048576).toFixed(2)+' MiB':Math.ceil((bytes||0)/1024)+' KiB'
const when=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString(locale.value)}
const areas=release=>Object.entries(release.files?.summary||{}).map(([area,count])=>area+': '+count).join(' · ')
async function load(){
 if(!props.projectPath){status.value=null;return}
 const id=++request
 const result=await window.retroStudio?.retro?.releasesStatus?.({projectPath:props.projectPath})
 if(disposed||id!==request)return
 if(!result?.success){error.value=result?.error||t('romReleases.loadFailed');return}
 status.value=result
 if(!version.value||releases.value.some(item=>item.version===version.value.trim()))version.value=result.next
 if(!title.value)title.value=result.title||''
 // Sugestão: os commits desde a última versão (a pessoa revisa antes de gerar).
 if(!changes.value.trim()&&result.pending?.length)changes.value=result.pending.join('\n')
}
async function create(){
 if(!canCreate.value)return
 creating.value=true;emit('building',true);error.value='';done.value=null;progress.value=t('romReleases.starting')
 try{
  const result=await window.retroStudio.retro.createRelease({projectPath:props.projectPath,version:version.value.trim(),title:title.value,changes:changes.value,notes:notes.value})
  if(!result?.success)throw Error(result?.error||t('romReleases.failed'))
  done.value=result.release;changes.value='';notes.value='';version.value=''
  await load()
 }catch(e){error.value=e.message}
 finally{creating.value=false;progress.value='';emit('building',false);emit('built')}
}
async function show(release){const result=await window.retroStudio?.retro?.showRelease?.({projectPath:props.projectPath,version:release.version});if(result&&!result.success)error.value=result.error}
async function copy(release){
 try{await navigator.clipboard.writeText(releaseMarkdown(release,{heading:'',forTesters:true}).trim());copied.value=release.version;setTimeout(()=>{if(copied.value===release.version)copied.value=''},2000)}
 catch{error.value=t('romReleases.copyFailed')}
}
unsubscribe=window.retroStudio?.retro?.onReleaseProgress?.(payload=>{if(creating.value)progress.value=payload?.text||''})
watch(()=>[props.projectPath,props.active],()=>{if(props.active)void load()},{immediate:true})
onBeforeUnmount(()=>{disposed=true;request++;unsubscribe?.()})
defineExpose({load})
</script>
<template>
 <section :aria-labelledby="compact?undefined:'run-releases'" class="releases">
  <h3 v-if="!compact" id="run-releases">{{ t('romReleases.title') }}</h3>
  <p class="help">{{ t('romReleases.help') }}</p>
  <p v-if="status?.problem" role="alert" class="notice problem">{{ status.problem }}</p>
  <form class="form" @submit.prevent="create">
   <label>{{ t('romReleases.version') }}<input v-model="version" :placeholder="status?.next||'0.1.0'" :aria-invalid="!!versionProblem" spellcheck="false" /></label>
   <label>{{ t('romReleases.headerTitle') }}<input v-model="title" maxlength="48" :placeholder="status?.game||''" /></label>
   <label class="wide">{{ t('romReleases.changes') }}<textarea v-model="changes" :rows="compact?6:4" :placeholder="t('romReleases.changesPlaceholder')" /></label>
   <label class="wide">{{ t('romReleases.notes') }}<textarea v-model="notes" rows="2" :placeholder="t('romReleases.notesPlaceholder')" /></label>
   <p v-if="versionProblem" class="notice problem wide">{{ versionProblem }}</p>
   <div class="wide row">
    <button type="submit" class="primary" :disabled="!canCreate">{{ creating ? t('romReleases.creating') : t('romReleases.create') }}</button>
    <span v-if="creating" role="status" class="help">{{ progress }}</span>
   </div>
  </form>
  <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
  <p v-if="done" role="status" class="notice ok">{{ t('romReleases.done',{version:done.version,file:done.rom.file}) }} <button type="button" @click="show(done)">{{ t('romReleases.showFile') }}</button></p>
  <p v-if="!releases.length" class="help">{{ t('romReleases.empty') }}</p>
  <p v-else-if="compact" class="help">{{ t('romReleases.last') }}</p>
  <ul v-if="shown.length" class="rows">
   <li v-for="release in shown" :key="release.version">
    <div class="head"><strong>{{ release.version }}</strong><span class="help">{{ when(release.createdAt) }} · {{ size(release.rom?.size) }}<template v-if="release.git?.commit"> · {{ release.git.commit.slice(0,7) }}<template v-if="release.git.dirty">{{ ' '+t('romReleases.dirty') }}</template></template></span></div>
    <ul v-if="release.changes?.length" class="changes"><li v-for="(change,index) in release.changes.slice(0,6)" :key="index">{{ change }}</li><li v-if="release.changes.length>6" class="help">{{ t('romReleases.moreChanges',{count:release.changes.length-6}) }}</li></ul>
    <p v-if="areas(release)" class="help">{{ t('romReleases.files') }} {{ areas(release) }}<template v-if="release.git?.commits?.length"> · {{ t('romReleases.commits',{count:release.git.commits.length}) }}</template></p>
    <div class="row"><button type="button" @click="show(release)">{{ t('romReleases.showFile') }}</button><button type="button" @click="copy(release)">{{ copied===release.version ? t('romReleases.copied') : t('romReleases.copyNotes') }}</button></div>
   </li>
  </ul>
  <p v-if="!compact" class="help">{{ t('romReleases.inGame') }} <code>#include "generated/game_version.h"</code> → <code>GAME_VERSION</code></p>
 </section>
</template>
<style scoped>
.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:8px 0}
.form label{display:flex;flex-direction:column;gap:4px;color:var(--muted,#a7b2b9)}.wide{grid-column:1/-1}
input,textarea{box-sizing:border-box;width:100%;font:inherit;color:var(--text,#ddd);background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px}
textarea{resize:vertical;line-height:1.4}input[aria-invalid="true"]{border-color:#e38269}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.head{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.changes{margin:6px 0;padding-left:18px;line-height:1.45}.rows .row{margin-top:6px}code{font-size:11px}
.releases button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:5px 10px;cursor:pointer}
.releases button:disabled{opacity:.55;cursor:default}.releases .primary{border-color:var(--accent,#5bbda5)}
.rows{list-style:none;margin:0;padding:0;display:grid;gap:8px}.rows>li{padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;overflow-wrap:anywhere}
.help{color:var(--muted,#a7b2b9)}.notice{margin:8px 0;padding:8px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.4;overflow-wrap:anywhere}
.problem{border-color:#e38269;color:#f0b3a3}.ok{border-color:var(--accent,#5bbda5)}
</style>
