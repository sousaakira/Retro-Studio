<template>
  <section class="map-notes" aria-label="Notas para a IA">
    <header class="te-panel-head">
      <h3>Notas para a IA</h3>
      <p>Marque no mapa onde algo acontece e escreva o que a IA deve fazer ali. As notas não entram no jogo.</p>
    </header>
    <div class="notes-actions">
      <button type="button" class="te-btn-add" :class="{ active: state.drawTool.value === 'note' }" :aria-pressed="state.drawTool.value === 'note'" @click="state.selectDrawTool('note')">✱ Marcar no mapa (N)</button>
      <label class="notes-toggle"><input v-model="notes.visible.value" type="checkbox" /> Mostrar no mapa</label>
    </div>
    <p v-if="!state.currentMapPath.value" class="notes-hint">Mapa ainda não salvo: as notas ficam guardadas quando você salvar o mapa.</p>
    <p v-if="notes.problem.value" class="notes-error" role="alert">{{ notes.problem.value }}</p>
    <p v-if="notes.saveError.value" class="notes-error" role="alert">{{ notes.saveError.value }}</p>

    <div v-if="note" class="note-editor">
      <div class="note-editor-head">
        <strong>Nota #{{ note.id }}</strong>
        <span>{{ note.width / tile }}×{{ note.height / tile }} tiles · px {{ note.x }}, {{ note.y }}</span>
      </div>
      <label>O que a IA deve saber ou fazer
        <textarea ref="textArea" :value="note.text" rows="5" maxlength="2000" placeholder="Ex.: ao subir esta rampa a gravidade muda e o personagem flutua; manter a mesma gravidade do chão." @input="update({ text: $event.target.value })" />
      </label>
      <div class="note-fields">
        <label>Tipo
          <select :value="note.kind" @change="update({ kind: $event.target.value })"><option value="problem">Problema</option><option value="task">Tarefa</option><option value="info">Informação</option></select>
        </label>
        <label>Camada
          <select :value="note.layer" @change="update({ layer: $event.target.value })"><option value="any">Qualquer</option><option value="fg">Frente (FG)</option><option value="bg">Cenário (BG)</option><option value="background">Fundo visual</option><option value="objects">Objetos</option><option value="collision">Colisão</option></select>
        </label>
      </div>
      <div class="note-fields">
        <label>X (tile)<input type="number" min="0" :value="note.x / tile" @change="update({ x: Number($event.target.value) * tile })" /></label>
        <label>Y (tile)<input type="number" min="0" :value="note.y / tile" @change="update({ y: Number($event.target.value) * tile })" /></label>
        <label>Largura<input type="number" min="1" :value="note.width / tile" @change="update({ width: Number($event.target.value) * tile })" /></label>
        <label>Altura<input type="number" min="1" :value="note.height / tile" @change="update({ height: Number($event.target.value) * tile })" /></label>
      </div>
      <label class="notes-toggle"><input type="checkbox" :checked="note.status === 'done'" @change="update({ status: $event.target.checked ? 'done' : 'open' })" /> Resolvida</label>
      <div v-if="note.reply" class="note-reply"><span>Resposta da IA</span><p>{{ note.reply }}</p></div>
      <div class="note-buttons">
        <button type="button" @click="notes.focus(note.id)">Ir até</button>
        <button type="button" @click="notes.selectedId.value = null">Fechar</button>
        <button type="button" class="danger" @click="notes.remove(note.id)">Apagar</button>
      </div>
    </div>

    <p v-if="!notes.notes.value.length" class="notes-hint">Nenhuma nota neste mapa. Escolha <strong>Marcar no mapa</strong> e arraste sobre a área (um clique marca um tile).</p>
    <ol v-else class="notes-list">
      <li v-for="item in notes.notes.value" :key="item.id">
        <button type="button" :class="['note-row', item.kind, { selected: item.id === notes.selectedId.value, done: item.status === 'done' }]" @click="select(item.id)">
          <span class="note-dot" aria-hidden="true" />
          <span class="note-row-text"><strong>#{{ item.id }} {{ kindLabel(item.kind) }}{{ item.status === 'done' ? ' · resolvida' : '' }}</strong><small>{{ item.text.trim() || '(sem texto)' }}</small></span>
        </button>
      </li>
    </ol>
    <p class="notes-hint">A IA lê as notas com o comando <code>map_notes</code> do Retro Studio e pode marcá-las como resolvidas com uma resposta. Peça, por exemplo: "veja as notas do mapa e corrija o problema #1".</p>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { noteKindLabel } from '../../../../shared/retro/mapNotes.js'

const props = defineProps({ state: { type: Object, required: true } })
const notes = props.state.mapNotes
const tile = props.state.TILE_SIZE_CONST || 8
const note = computed(() => notes.selected.value)
const textArea = ref(null)
const kindLabel = kind => { const label = noteKindLabel(kind); return label.charAt(0).toUpperCase() + label.slice(1) }

function update(patch) { if (note.value) notes.update(note.value.id, patch) }
function select(id) { notes.focus(id) }
// Nota nova (texto vazio) já abre com o cursor no campo de texto.
watch(() => note.value?.id, async id => {
  if (id == null || note.value.text) return
  await nextTick()
  textArea.value?.focus()
})
</script>

<style scoped>
.map-notes { display:flex; flex-direction:column; gap:10px; min-width:0; font-size:11px; color:var(--text,#ddd); }
.notes-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.notes-actions .te-btn-add.active { border-color:var(--accent,#4fc3f7); color:var(--accent,#4fc3f7); }
.notes-toggle { display:flex; align-items:center; gap:5px; }
.notes-hint { margin:0; color:var(--muted,#aaa); line-height:1.5; }
.notes-error { margin:0; color:#f87171; line-height:1.5; }
.note-editor { display:flex; flex-direction:column; gap:8px; padding:9px; border:1px solid var(--border,#444); border-radius:4px; background:rgba(0,0,0,.15); }
.note-editor-head { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px; }
.note-editor-head span { color:var(--muted,#aaa); }
.note-editor label { display:flex; flex-direction:column; gap:4px; min-width:0; }
.note-editor .notes-toggle { flex-direction:row; }
.note-editor textarea, .note-editor select, .note-editor input[type=number] { width:100%; box-sizing:border-box; padding:6px; color:inherit; background:var(--input-bg,#1e1e1e); border:1px solid var(--border,#444); border-radius:3px; font:inherit; }
.note-editor textarea { resize:vertical; min-height:72px; line-height:1.45; }
.note-fields { display:grid; grid-template-columns:repeat(auto-fit, minmax(64px, 1fr)); gap:6px; }
.note-reply { padding:7px; border-left:3px solid var(--accent,#4fc3f7); background:rgba(79,195,247,.08); }
.note-reply span { font-weight:600; }
.note-reply p { margin:4px 0 0; white-space:pre-wrap; line-height:1.45; }
.note-buttons { display:flex; gap:6px; }
.note-buttons button { flex:1; padding:6px; font:inherit; color:inherit; background:var(--panel,#252526); border:1px solid var(--border,#444); border-radius:3px; cursor:pointer; }
.note-buttons .danger { color:#f87171; }
.notes-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px; }
.note-row { width:100%; display:flex; gap:8px; align-items:flex-start; padding:7px; text-align:left; font:inherit; color:inherit; background:var(--panel,#252526); border:1px solid var(--border,#444); border-radius:3px; cursor:pointer; }
.note-row.selected { border-color:var(--accent,#4fc3f7); }
.note-row.done { opacity:.6; }
.note-dot { flex:none; width:9px; height:9px; margin-top:3px; border-radius:50%; background:#f87171; }
.note-row.task .note-dot { background:#60a5fa; }
.note-row.info .note-dot { background:#a3e635; }
.note-row.done .note-dot { background:#94a3b8; }
.note-row-text { min-width:0; display:flex; flex-direction:column; gap:2px; }
.note-row-text small { color:var(--muted,#aaa); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
code { font-size:10px; }
</style>
