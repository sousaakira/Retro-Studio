<script setup>
// Progresso do build sem travar a IDE: barra fina sob a barra de título e um cartão no canto com
// a etapa, o arquivo atual, a porcentagem e o botão de parar.
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const props = defineProps({ progress: { type: Object, default: null }, building: Boolean, playing: Boolean })
const emit = defineEmits(['stop', 'done'])
const STAGES = ['start', 'export', 'resources', 'compile', 'link', 'rom', 'done']
const finished = ref(false), title = ref('')
let timer = 0
const working = computed(() => props.building || props.playing)
const visible = computed(() => !!props.progress && (working.value || finished.value))
// 'done' só vira texto depois que o build realmente terminou (finished); até lá a última etapa é a ROM.
const stage = computed(() => props.progress?.stage === 'done' ? 'rom' : STAGES.includes(props.progress?.stage) ? props.progress.stage : 'start')
const percent = computed(() => finished.value ? 100 : Math.max(0, Math.min(99, Math.round(props.progress?.percent || 0))))
// Antes da primeira etapa reconhecida não há o que medir: a barra só indica atividade.
const waiting = computed(() => !finished.value && percent.value === 0)
const file = computed(() => String(props.progress?.detail || '').split('/').pop())
watch(working, (now, before) => {
  clearTimeout(timer)
  if (now) { finished.value = false; title.value = props.playing ? t('buildProgress.titlePlay') : t('buildProgress.titleBuild'); return }
  if (!before || !props.progress) return
  // Terminou bem: mostra 100% por um instante. Falhou ou foi parado: some na hora (o erro aparece no lugar dele).
  if (props.progress.stage === 'done') { finished.value = true; timer = setTimeout(() => { finished.value = false; emit('done') }, 1400) }
  else emit('done')
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template>
  <Teleport to="body">
    <div v-if="visible" class="build-progress" :class="{ waiting, finished }">
      <div class="strip" aria-hidden="true"><span :style="{ width: (waiting ? 100 : percent) + '%' }"></span></div>
      <section class="card" role="status" :aria-label="t('buildProgress.aria')">
        <header><strong>{{ finished ? t('buildProgress.done') : title }}</strong><span class="percent">{{ waiting ? '' : percent + '%' }}</span></header>
        <div class="track" role="progressbar" :aria-label="t('buildProgress.aria')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="waiting ? undefined : percent"><span :style="{ width: (waiting ? 100 : percent) + '%' }"></span></div>
        <footer><span class="stage">{{ finished ? '' : t('buildProgress.' + stage) }}<template v-if="!finished && file"> · {{ file }}</template></span>
          <button v-if="!finished" type="button" @click="emit('stop')">{{ t('buildProgress.stop') }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.build-progress{position:fixed;inset:0;z-index:8000;pointer-events:none;font-size:12px;color:var(--text,#ddd)}
.strip{position:absolute;top:36px;left:0;right:0;height:3px;background:rgba(255,255,255,.06)}
.strip span,.track span{display:block;height:100%;background:var(--accent,#5bbda5);transition:width .25s ease}
.card{position:absolute;right:16px;bottom:38px;width:320px;max-width:calc(100vw - 32px);padding:12px 14px;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);box-shadow:0 6px 20px rgba(0,0,0,.45);pointer-events:auto}
header,footer{display:flex;align-items:center;justify-content:space-between;gap:10px}
header strong{font-size:13px}.percent{font-variant-numeric:tabular-nums;color:var(--accent,#5bbda5);font-weight:600}
.track{height:6px;margin:9px 0 8px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}.track span{border-radius:3px}
.stage{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted,#a7b2b9)}
button{flex-shrink:0;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:3px 10px;cursor:pointer}
button:hover{border-color:#f48771;color:#f48771}button:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}
/* Sem porcentagem ainda: faixa andando para mostrar que está trabalhando. */
.waiting .strip span,.waiting .track span{background:linear-gradient(90deg,transparent 0,var(--accent,#5bbda5) 50%,transparent 100%);background-size:40% 100%;background-repeat:no-repeat;animation:build-progress-slide 1.2s linear infinite}
@keyframes build-progress-slide{from{background-position:-40% 0}to{background-position:140% 0}}
@media (prefers-reduced-motion: reduce){.strip span,.track span{transition:none}.waiting .strip span,.waiting .track span{animation:none;background:var(--accent,#5bbda5);opacity:.45}}
</style>
