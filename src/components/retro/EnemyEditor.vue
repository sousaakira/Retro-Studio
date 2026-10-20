<script setup>
// Jogo → Inimigos: tipos de inimigo (definições reutilizáveis) feitos a partir dos personagens do
// Charset Maker. As instâncias ficam nos mapas (objetos "enemy"); este editor mostra onde estão.
// Ao exportar, a IDE gera src/generated/enemy_data.h para o runtime de inimigos (docs/ENEMY_RUNTIME.md).
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ENEMY_ROLES, ENEMY_ROLE_LABELS, ENEMY_BEHAVIORS, ENEMY_POOL_MAX, ENEMY_RESPAWN_LABELS, createEnemyDefinition } from '../../../shared/retro/enemies.js'
const props = defineProps({ projectPath: { type: String, required: true } })
const emit = defineEmits(['close'])
const GUESS = { idle: /^(idle|parado|stand|espera)/i, walk: /^(walk|run|andar|andando|corrida|correr)/i, attack: /^(attack|ataque|golpe|hit)$/i, hurt: /^(hurt|dano|damage|ferido)/i, death: /^(death|morte|die|morrer)/i }
const FALLBACK_TEXT = { idle: 'Parado', hurt: 'Dano', none: 'nenhuma' }
const dialogElement = ref(null), status = ref(null), config = ref(null), baseline = ref(''), selected = ref(''), saved = ref(false)
const loading = ref(false), saving = ref(false), error = ref('')
let request = 0, disposed = false, timer = 0
const clone = value => JSON.parse(JSON.stringify(value))
const dirty = computed(() => !!config.value && JSON.stringify(config.value) !== baseline.value)
// IDs já salvos são a referência estável das instâncias nos mapas: não mudam depois de salvos.
const savedIds = computed(() => new Set((JSON.parse(baseline.value || '{}').definitions || []).map(d => d.id)))
const definition = computed(() => config.value?.definitions.find(d => d.id === selected.value) || null)
const character = computed(() => status.value?.characters.find(c => c.path === definition.value?.character) || null)
const exportedCharacters = computed(() => status.value?.characters || [])
const instancesOf = id => (status.value?.summary?.rooms || []).flatMap(room => room.spawns.filter(s => s.enemy === id).map(s => ({ ...s, room: room.name })))
const canSave = computed(() => !!config.value && !saving.value && !loading.value && (dirty.value || !status.value?.upToDate))
async function load(draft = null) {
  const id = ++request, projectPath = props.projectPath
  loading.value = true
  try {
    const result = await window.retroStudio?.retro?.enemyConfiguration?.({ projectPath, config: draft ? clone(draft) : undefined })
    if (disposed || id !== request) return
    if (!result?.config) throw Error(result?.error || 'Não foi possível ler os inimigos.')
    status.value = result
    if (!draft) {
      config.value = clone(result.config); baseline.value = JSON.stringify(result.config)
      if (!definition.value) selected.value = config.value.definitions[0]?.id || ''
    }
    error.value = ''
  } catch (problem) { if (!disposed && id === request) error.value = problem.message }
  finally { if (!disposed && id === request) loading.value = false }
}
// Confere o rascunho pouco depois de cada mudança (problemas e fallbacks ao vivo).
function changed() { saved.value = false; clearTimeout(timer); timer = setTimeout(() => load(config.value), 250) }
function uniqueId(base) {
  const ids = new Set(config.value.definitions.map(d => d.id))
  let id = base, n = 2
  while (ids.has(id)) id = base.slice(0, 36) + '_' + n++
  return id
}
function addDefinition() {
  const d = createEnemyDefinition(uniqueId('inimigo'), 'Novo inimigo')
  config.value.definitions.push(d); selected.value = d.id; changed()
}
function duplicate() {
  const d = clone(definition.value); d.id = uniqueId(d.id); d.name = d.name.slice(0, 52) + ' (cópia)'
  config.value.definitions.push(d); selected.value = d.id; changed()
}
function remove() {
  const used = instancesOf(selected.value)
  if (!window.confirm(used.length ? `"${definition.value.name}" está em ${used.length} lugar(es) dos mapas; essas instâncias vão aparecer como erro até você trocá-las. Remover mesmo assim?` : `Remover "${definition.value.name}"?`)) return
  config.value.definitions = config.value.definitions.filter(d => d.id !== selected.value)
  selected.value = config.value.definitions[0]?.id || ''; changed()
}
function renameId(value) {
  const id = String(value).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 40)
  if (!id || config.value.definitions.some(d => d !== definition.value && d.id === id)) return
  definition.value.id = id; selected.value = id; changed()
}
function chooseCharacter(path) {
  const item = status.value?.characters.find(c => c.path === path)
  definition.value.character = path
  for (const role of ENEMY_ROLES) definition.value.animations[role] = item?.animations.find(name => GUESS[role].test(name)) || ''
  changed()
}
function toggleBox(key, custom) { definition.value[key] = custom ? { x: -8, y: -32, width: 16, height: 32 } : null; changed() }
function toggleAttackBox(custom) { definition.value.attack.box = custom ? { x: 4, y: -28, width: 24, height: 16 } : null; changed() }
const fallbackText = role => {
  const target = status.value?.fallbacks?.[definition.value?.id]?.[role]
  return target ? (target === 'none' ? (role === 'death' ? 'sem animação: pisca e some' : 'nenhuma') : 'usa ' + FALLBACK_TEXT[target]) : ''
}
const paletteText = computed(() => {
  const p = status.value?.palette
  if (!p) return ''
  const rooms = p.roomSlots.length ? 'As salas carregam as linhas ' + p.roomSlots.join(', ') + '.' : 'Nenhuma sala exportada carrega paleta ainda.'
  return rooms
})
async function save() {
  if (!canSave.value) return
  const projectPath = props.projectPath
  saving.value = true; error.value = ''; saved.value = false
  try {
    const result = await window.retroStudio.retro.saveEnemyConfiguration({ projectPath, config: clone(config.value), revision: status.value.revision })
    if (disposed || props.projectPath !== projectPath) return
    if (!result?.config) throw Error(result?.error || 'Não foi possível salvar os inimigos.')
    status.value = result; config.value = clone(result.config); baseline.value = JSON.stringify(result.config); saved.value = true
    window.dispatchEvent(new CustomEvent('retroStudio:resources-changed', { detail: { projectPath } }))
  } catch (problem) { if (!disposed) error.value = problem.message }
  finally { saving.value = false }
}
function close() {
  if (saving.value) return
  if (dirty.value && !window.confirm('Há mudanças nos inimigos ainda não salvas. Fechar e descartar?')) return
  emit('close')
}
watch(() => props.projectPath, () => { status.value = null; config.value = null; void load() })
onMounted(() => { dialogElement.value?.showModal?.(); void load() })
onBeforeUnmount(() => { disposed = true; request++; clearTimeout(timer) })
defineExpose({ canClose: () => !saving.value && !dirty.value })
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialogElement" class="enemies" aria-labelledby="enemies-title" @cancel.prevent="close">
      <header><div><small>RETRO STUDIO · JOGO</small><h2 id="enemies-title">Inimigos</h2></div><button type="button" :disabled="saving" @click="close">{{ dirty ? 'Descartar e fechar' : 'Fechar' }}</button></header>
      <div class="body">
        <p class="lead">Cada inimigo aqui é um <strong>tipo</strong>, feito com um personagem do Charset Maker: animações, vida, velocidade, caixas e comportamento. Para colocá-lo no jogo, abra um mapa, ponha um objeto <strong>Enemy</strong> e escolha este tipo no painel do objeto. Cada objeto no mapa é uma <strong>instância</strong>, com posição, orientação, patrulha e reaparecimento próprios.</p>
        <p v-if="error" role="alert" class="notice problem">{{ error }}</p>
        <p v-if="loading && !status" role="status" class="notice">Lendo o projeto…</p>
        <template v-if="status && config">
          <div class="columns">
            <nav class="list-column" aria-label="Tipos de inimigo">
              <ul>
                <li v-for="d in config.definitions" :key="d.id"><button type="button" :aria-pressed="d.id === selected" @click="selected = d.id"><strong>{{ d.name }}</strong><small>{{ d.id }} · {{ instancesOf(d.id).length }} no(s) mapa(s)</small></button></li>
              </ul>
              <p v-if="!config.definitions.length" class="help">Nenhum tipo ainda.</p>
              <button type="button" class="primary" :disabled="saving || config.definitions.length >= 64" @click="addDefinition">Novo inimigo</button>
            </nav>
            <div class="detail">
              <template v-if="definition">
                <section aria-labelledby="enemy-identity">
                  <h3 id="enemy-identity">Identidade</h3>
                  <label class="field"><span>Nome</span><input v-model="definition.name" maxlength="60" :disabled="saving" @input="changed"></label>
                  <label class="field"><span>ID<small>{{ savedIds.has(definition.id) ? 'Fixo: os mapas usam este ID.' : 'Referência gravada nos mapas; fica fixo ao salvar.' }}</small></span>
                    <input :value="definition.id" maxlength="40" :disabled="saving || savedIds.has(definition.id)" @change="renameId($event.target.value)"></label>
                  <label class="field"><span>Personagem</span>
                    <select :value="definition.character" :disabled="saving" @change="chooseCharacter($event.target.value)">
                      <option value="">Escolha um personagem…</option>
                      <option v-for="c in exportedCharacters" :key="c.path" :value="c.path">{{ c.name }} · {{ c.animations.length }} animações{{ c.exported ? '' : ' · ainda não exportado' }}</option>
                    </select></label>
                </section>
                <section aria-labelledby="enemy-animations">
                  <h3 id="enemy-animations">Animações por função</h3>
                  <p class="help">Só "Parado" é obrigatória. As que faltam usam outra no lugar (indicado ao lado).</p>
                  <label v-for="role in ENEMY_ROLES" :key="role" class="field"><span>{{ ENEMY_ROLE_LABELS[role] }}<small v-if="!definition.animations[role] && role !== 'idle'">{{ fallbackText(role) }}</small></span>
                    <select v-model="definition.animations[role]" :disabled="saving || !character" @change="changed">
                      <option value="">{{ role === 'idle' ? 'Escolha a animação…' : '— nenhuma (usar fallback) —' }}</option>
                      <option v-for="name in character?.animations || []" :key="name" :value="name">{{ name }}</option>
                    </select></label>
                </section>
                <section aria-labelledby="enemy-stats">
                  <h3 id="enemy-stats">Atributos</h3>
                  <div class="grid">
                    <label><span>Vida</span><input v-model.number="definition.health" type="number" min="1" max="999" :disabled="saving" @input="changed"></label>
                    <label><span>Velocidade (px/s)</span><input v-model.number="definition.speed" type="number" min="0" max="600" :disabled="saving" @input="changed"></label>
                    <label><span>Dano de contato</span><input v-model.number="definition.contactDamage" type="number" min="0" max="99" :disabled="saving" @input="changed"></label>
                    <label><span>Alcance de detecção (px)</span><input v-model.number="definition.detectionRange" type="number" min="0" max="512" :disabled="saving" @input="changed"></label>
                    <label><span>Invulnerável após dano (ms)</span><input v-model.number="definition.invulnerableMs" type="number" min="0" max="10000" :disabled="saving" @input="changed"></label>
                    <label><span>Tempo de dano (ms)<small>vazio = duração da animação</small></span><input :value="definition.hurtMs ?? ''" type="number" min="0" max="10000" :disabled="saving" @input="definition.hurtMs = $event.target.value === '' ? null : Number($event.target.value); changed()"></label>
                  </div>
                </section>
                <section aria-labelledby="enemy-boxes">
                  <h3 id="enemy-boxes">Caixas (relativas aos pés, olhando para a direita)</h3>
                  <div v-for="[key, label] in [['body', 'Corpo de colisão'], ['hurt', 'Área vulnerável']]" :key="key" class="box">
                    <label class="check"><input type="checkbox" :checked="definition[key] !== null" :disabled="saving" @change="toggleBox(key, $event.target.checked)"> {{ label }}: {{ definition[key] === null ? 'a do personagem (Charset Maker)' : 'personalizada' }}</label>
                    <div v-if="definition[key]" class="grid four">
                      <label v-for="k in ['x', 'y', 'width', 'height']" :key="k"><span>{{ { x: 'X', y: 'Y', width: 'Largura', height: 'Altura' }[k] }}</span><input v-model.number="definition[key][k]" type="number" min="-256" max="256" :disabled="saving" @input="changed"></label>
                    </div>
                  </div>
                </section>
                <section aria-labelledby="enemy-attack">
                  <h3 id="enemy-attack">Ataque</h3>
                  <label class="check"><input v-model="definition.attack.enabled" type="checkbox" :disabled="saving" @change="changed"> Ataca quando vê o jogador à frente (dentro do alcance de detecção)</label>
                  <template v-if="definition.attack.enabled">
                    <div class="grid">
                      <label><span>Dano do golpe</span><input v-model.number="definition.attack.damage" type="number" min="0" max="99" :disabled="saving" @input="changed"></label>
                      <label><span>Preparação (ms)</span><input v-model.number="definition.attack.windupMs" type="number" min="0" max="10000" :disabled="saving" @input="changed"></label>
                      <label><span>Golpe ativo (ms)</span><input v-model.number="definition.attack.strikeMs" type="number" min="0" max="10000" :disabled="saving" @input="changed"></label>
                      <label><span>Recuperação (ms)</span><input v-model.number="definition.attack.recoveryMs" type="number" min="0" max="10000" :disabled="saving" @input="changed"></label>
                    </div>
                    <label class="check"><input type="checkbox" :checked="definition.attack.box !== null" :disabled="saving" @change="toggleAttackBox($event.target.checked)"> Área de ataque: {{ definition.attack.box === null ? 'a marcada na animação de ataque (Charset Maker)' : 'personalizada' }}</label>
                    <div v-if="definition.attack.box" class="grid four">
                      <label v-for="k in ['x', 'y', 'width', 'height']" :key="k"><span>{{ { x: 'X', y: 'Y', width: 'Largura', height: 'Altura' }[k] }}</span><input v-model.number="definition.attack.box[k]" type="number" min="-256" max="256" :disabled="saving" @input="changed"></label>
                    </div>
                  </template>
                </section>
                <section aria-labelledby="enemy-behavior">
                  <h3 id="enemy-behavior">Comportamento</h3>
                  <label class="field"><span>Tipo</span>
                    <select v-model="definition.behavior.type" :disabled="saving" @change="changed"><option v-for="(b, id) in ENEMY_BEHAVIORS" :key="id" :value="id">{{ b.label }}</option></select></label>
                  <p class="help">{{ ENEMY_BEHAVIORS[definition.behavior.type]?.description }}</p>
                  <template v-if="definition.behavior.type === 'ground-patrol'">
                    <label class="check"><input v-model="definition.behavior.turnAtWalls" type="checkbox" :disabled="saving" @change="changed"> Vira ao encostar numa parede</label>
                    <label class="check"><input v-model="definition.behavior.turnAtEdges" type="checkbox" :disabled="saving" @change="changed"> Vira antes de cair de uma borda</label>
                    <label class="field"><span>Pausa ao virar (ms)</span><input v-model.number="definition.behavior.pauseMs" type="number" min="0" max="10000" :disabled="saving" @input="changed"></label>
                  </template>
                </section>
                <section aria-labelledby="enemy-placed">
                  <h3 id="enemy-placed">Nos mapas</h3>
                  <p v-if="!instancesOf(definition.id).length" class="help">Ainda não colocado. Num mapa de sala, ponha um objeto Enemy e escolha "{{ definition.name }}".</p>
                  <ul v-else class="placed"><li v-for="s in instancesOf(definition.id)" :key="s.room + s.objectId">{{ s.room }} · objeto #{{ s.objectId }}{{ s.name ? ' (' + s.name + ')' : '' }} · x {{ s.x }}, y {{ s.y }} · {{ ENEMY_RESPAWN_LABELS[s.respawn] }}</li></ul>
                </section>
                <div class="row-actions"><button type="button" :disabled="saving" @click="duplicate">Duplicar</button><button type="button" :disabled="saving" @click="remove">Remover…</button></div>
              </template>
              <p v-else class="notice">Crie um inimigo para começar.</p>
            </div>
          </div>
          <section aria-labelledby="enemy-settings">
            <h3 id="enemy-settings">Ajustes gerais</h3>
            <div class="grid">
              <label><span>Ativos ao mesmo tempo<small>Cada um usa um sprite e VRAM</small></span><input v-model.number="config.settings.maxActive" type="number" min="1" :max="ENEMY_POOL_MAX" :disabled="saving" @input="changed"></label>
              <label><span>Ativar a (px da tela)<small>Padrão das instâncias</small></span><input v-model.number="config.settings.activationMargin" type="number" min="0" max="512" :disabled="saving" @input="changed"></label>
              <label><span>Gravidade (px/s²)</span><input v-model.number="config.settings.gravity" type="number" min="0" max="4000" :disabled="saving" @input="changed"></label>
              <label><span>Queda máxima (px/s)</span><input v-model.number="config.settings.maxFall" type="number" min="0" max="960" :disabled="saving" @input="changed"></label>
            </div>
            <label class="field"><span>Paleta<small>{{ paletteText }}</small></span>
              <select v-model="config.settings.palette.mode" :disabled="saving" @change="changed">
                <option value="shared">Compartilhada: usar as cores já carregadas por outro personagem</option>
                <option value="own">Própria: carregar a paleta dos inimigos numa linha livre</option>
              </select></label>
            <label class="field"><span>Linha da paleta</span>
              <select v-model.number="config.settings.palette.slot" :disabled="saving" @change="changed"><option v-for="n in 4" :key="n" :value="n - 1">PAL{{ n - 1 }}{{ status.palette?.roomSlots.includes(n - 1) ? ' (usada pelas salas)' : '' }}</option></select></label>
            <label v-if="config.settings.palette.mode === 'shared'" class="field"><span>Cores de<small>Personagem cuja paleta o jogo já carrega nessa linha</small></span>
              <select v-model="config.settings.palette.from" :disabled="saving" @change="changed">
                <option value="">Escolha (normalmente o jogador)…</option>
                <option v-for="c in exportedCharacters.filter(c => c.exported)" :key="c.path" :value="c.path">{{ c.name }}</option>
              </select></label>
            <ul v-if="status.palette?.characters.length" class="list"><li v-for="c in status.palette.characters" :key="c.character">{{ c.character }}: {{ c.exact && !c.generated ? 'cores compatíveis, usa o sprite exportado' : c.exact ? 'mesmas cores, índices reorganizados numa cópia' : c.changed + ' cor(es) aproximada(s) numa cópia (o sprite original não muda)' }}</li></ul>
          </section>
          <ul v-if="status.problems.length" class="list" role="alert" aria-label="O que falta para exportar"><li v-for="text in status.problems" :key="text" class="problem">{{ text }}</li></ul>
          <ul v-if="status.warnings.length" class="list" aria-label="Avisos"><li v-for="text in status.warnings" :key="text" class="warn">{{ text }}</li></ul>
          <p v-if="status.generatedConflicts?.length" role="alert" class="notice problem">Arquivos gerados alterados fora da IDE (preservados): {{ status.generatedConflicts.join(', ') }}</p>
        </template>
      </div>
      <footer><small role="status">{{ saving ? 'Salvando…' : saved && status?.upToDate ? 'Inimigos exportados. Construa e jogue.' : saved ? 'Salvo, mas não exportado: corrija os itens em vermelho.' : dirty ? 'Mudanças ainda não salvas.' : status?.upToDate ? 'Exportado e em dia.' : status?.configured ? 'Os mapas ou personagens mudaram: exporte de novo.' : 'Ainda não exportado.' }}</small>
        <button type="button" class="primary" :disabled="!canSave" @click="save">{{ saving ? 'Salvando…' : 'Salvar e exportar' }}</button></footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.enemies{box-sizing:border-box;display:flex;flex-direction:column;width:min(1040px,96vw);max-height:94vh;padding:0;border:1px solid var(--border,#41464d);border-radius:6px;background:var(--panel,#20252a);color:var(--text,#ddd);font-size:12px}
.enemies:not([open]){display:none}.enemies::backdrop{background:rgba(0,0,0,.55)}
header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;flex-shrink:0}header{border-bottom:1px solid var(--border,#41464d)}footer{border-top:1px solid var(--border,#41464d)}
h2{margin:2px 0 0;font-size:17px}h3{margin:18px 0 8px;font-size:13px}small,.help{color:var(--muted,#a7b2b9)}
.body{flex:1;min-height:0;overflow:auto;padding:4px 16px 16px}.lead{margin:10px 0 0;line-height:1.5}.help{margin:0 0 8px;line-height:1.5}
.columns{display:grid;grid-template-columns:240px minmax(0,1fr);gap:20px;margin-top:12px}
.list-column ul{list-style:none;margin:0 0 10px;padding:0;display:grid;gap:4px}
.list-column li button{display:grid;gap:2px;width:100%;text-align:left}.list-column li button[aria-pressed="true"]{border-color:var(--accent,#5bbda5)}
.field{display:grid;grid-template-columns:200px minmax(0,1fr);align-items:center;gap:10px;margin:0 0 8px}.field span,.grid span{display:grid;gap:2px}.field small,.grid small{line-height:1.3}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 12px;margin:0 0 8px}.grid label{display:grid;gap:4px}.grid.four{grid-template-columns:repeat(4,minmax(70px,1fr))}
.check{display:flex;align-items:center;gap:8px;margin:6px 0}.box{margin-bottom:6px}
input,select,button{box-sizing:border-box;font:inherit;color:inherit;background:var(--bg,#171c21);border:1px solid var(--border,#41464d);border-radius:3px;padding:6px 8px}
input[type="checkbox"]{padding:0}
button{cursor:pointer}button:disabled,select:disabled,input:disabled{opacity:.55;cursor:default}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent,#5bbda5);outline-offset:2px}.primary{border-color:var(--accent,#5bbda5)}
.notice{margin:8px 0;padding:8px 10px;border:1px solid var(--border,#41464d);border-radius:3px;line-height:1.45;overflow-wrap:anywhere}
.problem{border-color:#e38269;color:#f0b3a3}.warn{color:#e5c07b}
.list,.placed{margin:10px 0 0;padding-left:18px;display:grid;gap:6px;line-height:1.45}.list .problem{border:0}
.row-actions{display:flex;gap:8px;margin-top:16px}
@media (max-width:760px){.columns{grid-template-columns:1fr}.field{grid-template-columns:1fr}}
</style>
