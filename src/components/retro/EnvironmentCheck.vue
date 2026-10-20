<template>
  <component :is="automatic ? 'dialog' : 'section'" ref="panel" v-show="!automatic || visible" class="environment-check" :class="{ 'environment-dialog':automatic }" :aria-labelledby="titleId" @cancel.prevent="dismiss">
    <header><div><h2 :id="titleId">{{ t('environment.title') }}</h2><p>{{ t('environment.description') }}</p></div><button v-if="automatic" type="button" :disabled="busy" :aria-label="t('environment.later')" @click="dismiss">×</button></header>
    <p v-if="checking" role="status">{{ t('environment.checking') }}</p>
    <template v-if="status">
      <p class="environment-summary" :class="{ ready:status.ready }" role="status">{{ t(status.ready ? 'environment.ready' : 'environment.incomplete') }}</p>
      <ul><li v-for="item in status.items" :key="item.id"><span class="environment-state" :class="{ ready:item.ok }" aria-hidden="true">{{ item.ok ? '✓' : '!' }}</span><span><strong>{{ t('environment.tools.'+item.id) }}</strong><small>{{ item.version || t(item.ok ? 'environment.ok' : 'environment.missing') }}</small></span><span class="environment-result">{{ t(item.ok ? 'environment.ok' : 'environment.required') }}</span></li></ul>
      <template v-if="!status.ready">
        <p>{{ t(status.install?.supported ? (status.hostReady ? 'environment.downloadHint' : 'environment.installHint') : 'environment.manualHint') }}</p>
        <code v-if="status.install?.command" class="environment-command">{{ status.install.command }}</code>
      </template>
    </template>
    <p v-if="error" class="environment-error" role="alert">{{ t('environment.errors.'+(knownErrors.includes(error) ? error : 'environmentCheckFailed')) }}</p>
    <p v-if="installing" role="status">{{ t('environment.installing') }}</p>
    <footer><button type="button" :disabled="busy" @click="error=''; refresh()">{{ t('environment.recheck') }}</button><button v-if="status && !status.ready && status.install?.supported" type="button" class="environment-prepare" :disabled="busy" @click="prepare">{{ t('environment.prepare') }}</button><button v-if="automatic" type="button" :disabled="busy" @click="dismiss">{{ t(status?.ready ? 'environment.continue' : 'environment.later') }}</button></footer>
  </component>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, useId } from 'vue'
import { useI18n } from 'vue-i18n'
const props=defineProps({ automatic:Boolean })
const emit=defineEmits(['prepared'])
const {t}=useI18n(), titleId=useId(), panel=ref(null), visible=ref(false), status=ref(null), checking=ref(false), installing=ref(false), error=ref('')
const busy=computed(()=>checking.value||installing.value)
const knownErrors=['environmentBusy','environmentManual','environmentCancelled','environmentInstallFailed','environmentSender','environmentCheckFailed','environmentExistingFiles','environmentToolkitInvalid','environmentSettingsChanged']
async function refresh() {
  checking.value=true
  try { const result=await window.retroStudio?.retro?.environmentStatus?.(); if(result)status.value=result }
  catch { error.value='environmentCheckFailed' }
  finally { checking.value=false }
}
async function prepare() {
  if(busy.value)return
  installing.value=true;error.value=''
  try {
    const result=await window.retroStudio.retro.prepareEnvironment()
    if(result?.success)status.value=result
    else error.value=result?.error||'environmentInstallFailed'
  } catch { error.value='environmentInstallFailed' }
  finally {
    await refresh();installing.value=false
    if(status.value?.toolkitPath) {
      emit('prepared',status.value)
      window.dispatchEvent(new CustomEvent('retroStudio:environment-prepared',{detail:{toolkitPath:status.value.toolkitPath}}))
    }
  }
}
function dismiss() { if(busy.value)return;panel.value?.close?.();visible.value=false }
onMounted(async()=>{
  await refresh()
  if(props.automatic && ((status.value && !status.value.ready) || error.value)) {
    visible.value=true;await nextTick();panel.value?.showModal?.()
  }
})
</script>

<style scoped>
.environment-check{color:var(--text);font:12px/1.5 system-ui,sans-serif;padding:12px 0}.environment-dialog{width:min(560px,90vw);max-height:85vh;overflow:auto;box-sizing:border-box;padding:20px;background:var(--bg,#1e1e1e);border:1px solid var(--border,#444);border-radius:6px}.environment-dialog::backdrop{background:#0009}.environment-check header{display:flex;justify-content:space-between;gap:16px;align-items:start}.environment-check h2{font-size:16px;margin:0 0 6px}.environment-check p{color:var(--muted);margin:6px 0 12px}.environment-check ul{list-style:none;padding:0;margin:12px 0;border-top:1px solid var(--border)}.environment-check li{display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--border);padding:9px 0}.environment-check li>span:nth-child(2){flex:1;min-width:0}.environment-check strong{font-size:12px}.environment-check small{display:block;color:var(--muted);overflow-wrap:anywhere}.environment-state{font-size:16px;color:#dfac66;width:16px;text-align:center}.environment-check .ready{color:#68cbb2}.environment-result{font-size:10px;color:var(--muted)}.environment-check .environment-error{color:#ffa58f}.environment-command{display:block;user-select:text;overflow-wrap:anywhere;background:var(--panel,#252526);padding:10px;border:1px solid var(--border)}.environment-check footer{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.environment-check button{background:var(--panel,#252526);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:7px 10px;font:inherit;cursor:pointer}.environment-check button:disabled{opacity:.5;cursor:default}.environment-check button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.environment-check .environment-prepare{background:var(--accent);color:white;border-color:transparent}
</style>
