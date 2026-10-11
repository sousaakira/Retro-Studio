<script setup>
// #70: "Jogador e início". Escolhe o personagem do jogador e as animações de cada situação;
// ao exportar, a IDE gera em src/game/ o código que põe o jogador na sala inicial.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
const props = defineProps({ projectPath: { type: String, required: true } })
const emit = defineEmits(['close', 'open-world', 'open-characters'])
const ROLES = [['idle', 'Parado', 'Obrigatória. É usada também nas situações sem animação própria.'], ['walk', 'Andando', ''], ['jump', 'Pulando (subindo)', ''], ['fall', 'Caindo', '']]
// Nomes comuns de animação para preencher sozinho ao escolher o personagem.
const GUESS = { idle: /^(idle|parado|stand|espera)/i, walk: /^(walk|run|andar|andando|corrida|correr|corre)/i, jump: /^(jump|pulo|pular|salto)/i, fall: /^(fall|queda|cair|caindo)/i }
const dialogElement = ref(null), status = ref(null), config = ref(null), baseline = ref(''), loading = ref(false), saving = ref(false), error = ref(''), saved = ref(false), copied = ref(false)
let request = 0, disposed = false
const clone = value => JSON.parse(JSON.stringify(value))
const dirty = computed(() => !!config.value && JSON.stringify(config.value) !== baseline.value)
const character = computed(() => status.value?.characters.find(item => item.path === config.value?.player.character) || null)
const canExport = computed(() => !!status.value && !loading.value && !saving.value && !status.value.problems.length && !status.value.foreign && (dirty.value || !status.value.exported) && !status.value.conflicts.length)
const mainText = computed(() => ({
  template: 'O src/main.c ainda é o do modelo. Ao exportar, ele é trocado por um main.c curto que usa o jogo gerado; depois disso é seu, e a IDE não o reescreve.',
  missing: 'O projeto não tem src/main.c. Ao exportar, a IDE cria um main.c curto que usa o jogo gerado.',
  host: 'O src/main.c já usa o jogo gerado.',
  'custom-host': 'O seu src/main.c já chama o jogo gerado. A IDE não mexe nele.',
  custom: 'O seu src/main.c tem código próprio e não será alterado. Para usar o jogo gerado, acrescente nele:'
}[status.value?.main] || ''))
async function load(draft = null) {
  const id = ++request, projectPath = props.projectPath
  loading.value = true; error.value = ''
  try {
    const result = await window.retroStudio?.retro?.gameHost?.({ projectPath, config: draft ? clone(draft) : undefined })
    if (disposed || id !== request) return
    if (!result?.config) throw Error(result?.error || 'Não foi possível ler a configuração do jogo.')
    status.value = result
    if (!draft) { config.value = clone(result.config); baseline.value = JSON.stringify(result.config) }
  } catch (problem) { if (!disposed && id === request) error.value = problem.message }
  finally { if (!disposed && id === request) loading.value = false }
}
function chooseCharacter(path) {
  const item = status.value?.characters.find(entry => entry.path === path)
  config.value.player.character = path
  for (const [role] of ROLES) config.value.player.animations[role] = item?.animations.find(name => GUESS[role].test(name)) || ''
  if (item && !config.value.player.animations.idle && item.animations.length === 1) config.value.player.animations.idle = item.animations[0]
  changed()
}
function changed() { saved.value = false; void load(config.value) }
async function save(overwrite = false) {
  if (saving.value || !config.value) return
  const projectPath = props.projectPath
  saving.value = true; error.value = ''; saved.value = false
  try {
    const result = await window.retroStudio.retro.saveGameHost({ projectPath, config: clone(config.value), revision: status.value.revision, overwrite })
    if (disposed || props.projectPath !== projectPath) return
    if (!result?.config) throw Error(result?.error || 'Não foi possível exportar o jogo.')
    status.value = result; config.value = clone(result.config); baseline.value = JSON.stringify(result.config); saved.value = true
    window.dispatchEvent(new CustomEvent('retroStudio:resources-changed', { detail: { projectPath } }))
  } catch (problem) { if (!disposed) error.value = problem.message }
  finally { saving.value = false }
}
async function copySnippet() {
  try { await navigator.clipboard.writeText(status.value.snippet); copied.value = true; setTimeout(() => { copied.value = false }, 1800) } catch { /* sem área de transferência */ }
}
function close() {
  if (saving.value) return
  if (dirty.value && !window.confirm('Há escolhas ainda não exportadas. Fechar e descartar?')) return
  emit('close')
}
watch(() => props.projectPath, () => { status.value = null; config.value = null; void load() })
onMounted(() => { dialogElement.value?.showModal?.(); void load() })
onBeforeUnmount(() => { disposed = true; request++ })
defineExpose({ canClose: () => !saving.value && !dirty.value })
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialogElement" class="game-start" aria-labelledby="game-start-title" @cancel.prevent="close">
      <header><div><small>RETRO STUDIO · JOGO</small><h2 id="game-start-title">Jogador e início</h2></div><button type="button" :disabled="saving" @click="close">{{ dirty ? 'Descartar e fechar' : 'Fechar' }}</button></header>
      <div class="body">
        <p class="lead">Escolha quem é o jogador e onde o jogo começa. Ao exportar, a IDE gera o código que põe o personagem na sala inicial, com movimento, colisão, câmera e troca de sala. Você não precisa programar para jogar — e pode programar por cima quando quiser.</p>
        <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
        <p v-if="loading && !status" role="status" class="notice">Lendo o projeto…</p>
        <template v-if="status && config">
          <p v-if="status.foreign" role="alert" class="notice problem">Existe um game/game.json de outra ferramenta neste projeto. Ele foi preservado e o jogo não pode ser gerado aqui.</p>
          <section aria-labelledby="game-start-room">
            <h3 id="game-start-room">1. Onde o jogo começa</h3>
            <dl v-if="status.start.room">
              <dt>Sala inicial</dt><dd>{{ status.start.roomName }}</dd>
              <dt>Mapa</dt><dd>{{ status.start.map }}</dd>
              <dt>Ponto de entrada</dt><dd>{{ status.start.entry }} (x {{ status.start.x }}, y {{ status.start.y }})</dd>
            </dl>
            <p v-else class="notice">Nenhuma sala inicial ainda.</p>
            <button type="button" :disabled="saving" @click="emit('open-world')">Abrir Salas e conexões…</button>
          </section>
          <section aria-labelledby="game-start-player">
            <h3 id="game-start-player">2. Quem é o jogador</h3>
            <p v-if="!status.characters.length" class="notice">O projeto ainda não tem personagens. Crie um no modo Personagens e exporte.</p>
            <label class="field"><span>Personagem</span>
              <select id="game-start-character" :value="config.player.character" :disabled="saving || !status.characters.length" @change="chooseCharacter($event.target.value)">
                <option value="">Escolha um personagem…</option>
                <option v-for="item in status.characters" :key="item.path" :value="item.path">{{ item.name }} · {{ item.animations.length }} {{ item.animations.length === 1 ? 'animação' : 'animações' }}{{ item.exported ? '' : ' · ainda não exportado' }}</option>
              </select></label>
            <template v-if="character">
              <label v-for="[role, label, help] in ROLES" :key="role" class="field"><span>{{ label }}<small v-if="help">{{ help }}</small></span>
                <select :id="'game-start-' + role" v-model="config.player.animations[role]" :disabled="saving" @change="changed">
                  <option value="">{{ role === 'idle' ? 'Escolha a animação…' : '— usar a de parado —' }}</option>
                  <option v-for="name in character.animations" :key="name" :value="name">{{ name }}</option>
                </select></label>
            </template>
            <button type="button" :disabled="saving" @click="emit('open-characters')">Abrir Personagens…</button>
          </section>
          <section aria-labelledby="game-start-code">
            <h3 id="game-start-code">3. O código</h3>
            <p class="help">A IDE escreve só em <code>src/game/</code> (arquivos pequenos, um por assunto: jogador, salas, câmera, áudio). O seu código fica em <code>src/main.c</code> e em arquivos seus.</p>
            <p class="notice">{{ mainText }}</p>
            <template v-if="status.main === 'custom'"><pre>{{ status.snippet }}</pre><button type="button" @click="copySnippet">{{ copied ? 'Copiado' : 'Copiar' }}</button></template>
            <div v-if="status.conflicts.length" role="alert" class="notice problem">
              <p>Estes arquivos gerados foram alterados fora da IDE e estão preservados; a IDE não os atualiza mais:</p>
              <ul><li v-for="file in status.conflicts" :key="file"><code>{{ file }}</code></li></ul>
              <button type="button" :disabled="saving || !!status.problems.length" @click="save(true)">Gerar por cima (descarta essas alterações)</button>
            </div>
          </section>
          <ul v-if="status.problems.length" class="list" role="alert" aria-label="O que falta para exportar"><li v-for="text in status.problems" :key="text" class="problem">{{ text }}</li></ul>
          <ul v-if="status.warnings.length" class="list" aria-label="Avisos"><li v-for="text in status.warnings" :key="text" class="warn">{{ text }}</li></ul>
        </template>
      </div>
      <footer><small role="status">{{ saving ? 'Exportando…' : saved ? 'Jogo exportado. Construa e jogue.' : dirty ? 'Escolhas ainda não exportadas.' : status?.exported ? 'Exportado e em dia.' : status?.configured ? 'O que está no projeto não corresponde a estas escolhas: exporte de novo.' : 'Ainda não exportado.' }}</small>
        <button type="button" class="primary" :disabled="!canExport" @click="save(false)">{{ saving ? 'Exportando…' : 'Exportar' }}</button></footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.game-start{box-sizing:border-box;display:flex;flex-direction:column;width:min(760px,96vw);max-height:92vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.game-start:not([open]){display:none}.game-start::backdrop{background:rgba(0,0,0,.55)}
header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;flex-shrink:0}header{border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d)}
h2{margin:2px 0 0;font-size:17px}h3{margin:18px 0 8px;font-size:13px}small,.help,dt{color:var(--muted,#a7b2b9)}
.body{flex:1;min-height:0;overflow:auto;padding:4px 16px 16px}.lead{margin:10px 0 0;line-height:1.5}.help{margin:0 0 8px;line-height:1.5}
dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:0 0 10px}dd{margin:0;overflow-wrap:anywhere}
.field{display:grid;grid-template-columns:190px minmax(0,1fr);align-items:center;gap:10px;margin:0 0 8px}.field span{display:grid;gap:2px}.field small{line-height:1.3}
select,button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px 10px}
button{cursor:pointer}button:disabled,select:disabled{opacity:.55;cursor:default}button:focus-visible,select:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}.primary{border-color:var(--accent,#5bbda5)}
.notice{margin:8px 0;padding:8px 10px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.45;overflow-wrap:anywhere}.notice p{margin:0 0 6px}.notice ul{margin:0 0 8px;padding-left:18px}
.problem{border-color:#e38269;color:#f0b3a3}.warn{color:#e5c07b}
.list{margin:14px 0 0;padding-left:18px;display:grid;gap:6px;line-height:1.45}.list .problem{border:0}
pre{margin:0 0 8px;padding:10px;border:1px solid var(--border,#41464d);border-radius:3px;background:var(--bg,#171c21);overflow:auto;font-size:11px;line-height:1.5}code{font-size:11px}
@media (max-width:560px){.field{grid-template-columns:1fr}}
</style>
