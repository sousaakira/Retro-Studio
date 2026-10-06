<template>
  <div class="cutscene-launcher">
    <button type="button" class="wide open-cutscenes" :aria-expanded="c.open.value" @click="c.openEditor()">
      <span aria-hidden="true">🎬</span> Editor de cenas
    </button>
    <label class="overlay-toggle"><input type="checkbox" v-model="c.showOverlay.value" /> Mostrar caminhos da cena no mapa</label>
    <p v-if="c.scene.value" class="launcher-hint">
      Cena aberta: <strong>{{ c.scene.value.title || c.scene.value.id }}</strong> · {{ c.triggersForScene.value.length }} gatilho(s) neste mapa
    </p>
    <p v-else class="launcher-hint">Crie cenas programadas (falas, movimentos, escolhas) e ligue-as a um gatilho no mapa.</p>
  </div>

  <Teleport to="body">
    <div v-if="c.open.value" v-show="!c.picking.value" class="cs-backdrop" :class="{ expanded }" @click.self="requestClose" @keydown.esc.stop.prevent="requestClose">
      <section class="cs-dialog" :class="{ expanded }" role="dialog" aria-modal="true" aria-label="Editor de cenas">
        <header class="cs-header">
          <div class="cs-heading">
            <span class="cs-mark" aria-hidden="true">🎬</span>
            <div>
              <small>Editor de cenas · {{ c.scenePath.value || 'nenhuma cena aberta' }}</small>
              <h2>{{ c.scene.value?.title || c.scene.value?.id || 'Cenas programadas' }} <span v-if="c.dirty.value" class="dirty-badge">não salvo</span></h2>
            </div>
          </div>
          <div class="cs-header-actions">
            <button type="button" class="primary-action" :disabled="!c.scene.value || c.busy.value" @click="c.saveScene()">Salvar cena</button>
            <button type="button" class="icon-button" :title="expanded ? 'Restaurar' : 'Expandir'" :aria-pressed="expanded" @click="expanded = !expanded">⤢</button>
            <button ref="closeButton" type="button" class="icon-button" aria-label="Fechar" @click="requestClose">×</button>
          </div>
        </header>

        <nav class="cs-tabs" role="tablist" aria-label="Seções do editor de cenas">
          <button v-for="item in tabs" :key="item.id" type="button" role="tab" :aria-selected="tab === item.id" :class="{ active: tab === item.id }" @click="setTab(item.id)">
            {{ item.label }}<span v-if="item.id === 'runtime' && runtimeWarning" class="tab-dot" aria-label="atenção">●</span>
          </button>
        </nav>

        <div class="cs-body">
          <!-- ROTEIRO -->
          <div v-if="tab === 'script'" class="script-layout">
            <aside class="scene-list" aria-label="Cenas do projeto">
              <h3>Cenas</h3>
              <button v-for="path in c.files.value" :key="path" type="button" class="scene-item" :class="{ active: path === c.scenePath.value }" @click="c.openScene(path)">
                <strong>{{ c.sceneSummaries.value[path]?.title || path }}</strong>
                <small>{{ c.sceneSummaries.value[path]?.id || path }}</small>
                <small v-if="c.sceneSummaries.value[path]?.map && c.sceneSummaries.value[path].map !== c.mapRelativePath.value" class="other-map">outro mapa</small>
              </button>
              <p v-if="!c.files.value.length" class="muted">Nenhuma cena ainda.</p>
              <form class="new-scene" @submit.prevent="createScene">
                <strong>Nova cena</strong>
                <label>Título<input v-model="newTitle" maxlength="60" placeholder="Encontro com o gato" @input="syncNewId" /></label>
                <label>Id (arquivo e C)<input v-model="newId" maxlength="40" placeholder="encontro_gato" pattern="[a-z][a-z0-9_]*" /></label>
                <button type="submit" class="quiet-action" :disabled="!newId">＋ Criar</button>
              </form>
            </aside>

            <section class="step-pane" aria-label="Roteiro">
              <template v-if="c.scene.value">
                <details class="scene-meta">
                  <summary>Dados da cena e intenção para a IA</summary>
                  <label>Título<input :value="c.scene.value.title" @input="c.scene.value.title = $event.target.value" /></label>
                  <label>Descrição / intenção da cena
                    <textarea rows="3" :value="c.scene.value.description" placeholder="O que esta cena deve transmitir. Não vai para a ROM; ajuda pessoas e IAs." @input="c.scene.value.description = $event.target.value" />
                  </label>
                  <label>Mapa usado como palco<input :value="c.scene.value.map" @input="c.scene.value.map = $event.target.value" /></label>
                  <button v-if="c.scene.value.map !== c.mapRelativePath.value" type="button" class="quiet-action" @click="c.scene.value.map = c.mapRelativePath.value">Usar o mapa aberto ({{ c.mapRelativePath.value || 'sem caminho' }})</button>
                </details>

                <div class="step-palette" role="toolbar" aria-label="Adicionar comando">
                  <span class="palette-label">{{ insertList ? 'Adicionar no ramo:' : 'Adicionar após o selecionado:' }}</span>
                  <button v-for="(def, type) in STEP_TYPES" :key="type" type="button" :title="def.label" @click="addStep(type)"><span aria-hidden="true">{{ def.icon }}</span> {{ def.label }}</button>
                </div>

                <ol class="step-rows">
                  <li v-if="!rows.length" class="empty-steps">Roteiro vazio. Use os botões acima para adicionar o primeiro comando.</li>
                  <li v-for="row in rows" :key="row.kind + row.path" :style="{ '--depth': row.depth }">
                    <button v-if="row.kind === 'step'" type="button" class="step-row" :class="[`type-${row.step.type}`, { selected: row.path === c.selectedPath.value, playing: row.path === playingPath }]" @click="selectStep(row.path)">
                      <span class="step-number">{{ row.number }}</span>
                      <span class="step-icon" aria-hidden="true">{{ STEP_TYPES[row.step.type]?.icon || '?' }}</span>
                      <span class="step-text"><strong>{{ STEP_TYPES[row.step.type]?.label || row.step.type }}</strong> {{ summary(row.step) }}</span>
                      <span v-if="row.step.note" class="step-note" :title="row.step.note">✎</span>
                    </button>
                    <button v-else type="button" class="branch-row" :class="{ selected: insertList === row.path }" @click="selectBranch(row.path)">
                      <span aria-hidden="true">↳</span> {{ row.label }} <small>({{ row.count }})</small>
                    </button>
                  </li>
                </ol>
              </template>
              <div v-else class="empty-state">
                <h3>Nenhuma cena aberta</h3>
                <p>Crie uma cena na coluna da esquerda. Ela é salva em <code>cutscenes/&lt;id&gt;.cutscene.json</code>, um arquivo legível para pessoas e IAs.</p>
              </div>
            </section>

            <aside class="inspector" aria-label="Propriedades do comando">
              <template v-if="step">
                <div class="inspector-head">
                  <h3>{{ STEP_TYPES[step.type]?.icon }} {{ STEP_TYPES[step.type]?.label || step.type }}</h3>
                  <div class="inspector-tools">
                    <button type="button" title="Mover para cima" @click="c.moveStep(c.selectedPath.value, -1)">↑</button>
                    <button type="button" title="Mover para baixo" @click="c.moveStep(c.selectedPath.value, 1)">↓</button>
                    <button type="button" title="Duplicar" @click="c.duplicateStep(c.selectedPath.value)">⧉</button>
                    <button type="button" class="danger" title="Remover" @click="c.removeStep(c.selectedPath.value)">🗑</button>
                  </div>
                </div>

                <template v-for="field in STEP_TYPES[step.type]?.fields || []" :key="field">
                  <label v-if="field === 'actor' || field === 'target'">{{ field === 'target' ? 'Olhar para' : 'Ator' }}
                    <select :value="step[field] || ''" @change="set(field, $event.target.value)">
                      <option v-if="step.type === 'say'" value="">(narrador / nenhum)</option>
                      <option v-for="actor in c.actors.value" :key="actor.id" :value="actor.id">{{ actor.name || actor.id }}</option>
                    </select>
                  </label>
                  <label v-else-if="field === 'speaker'">Nome exibido
                    <input :value="step.speaker || ''" :placeholder="actorName(step.actor) || 'sem nome'" @input="set('speaker', $event.target.value)" />
                  </label>
                  <div v-else-if="field === 'portrait'" class="portrait-field">
                    <label>Retrato
                      <select :value="step.portrait || ''" @change="set('portrait', $event.target.value)">
                        <option value="">(sem retrato)</option>
                        <option v-for="portrait in c.config.value.portraits || []" :key="portrait.id" :value="portrait.id">{{ portrait.name || portrait.id }}</option>
                      </select>
                    </label>
                    <img v-if="step.portrait && c.portraitPreviews.value[step.portrait]" :src="c.portraitPreviews.value[step.portrait]" alt="" class="portrait-thumb" />
                  </div>
                  <label v-else-if="field === 'side'">Lado do retrato
                    <select :value="step.side || 'left'" @change="set('side', $event.target.value)"><option value="left">Esquerda</option><option value="right">Direita</option></select>
                  </label>
                  <div v-else-if="field === 'text'" class="text-field">
                    <label>Texto
                      <textarea rows="4" :value="step.text || ''" placeholder="O que o personagem diz. Quebras e páginas são automáticas." @input="set('text', $event.target.value)" />
                    </label>
                    <div class="page-preview" aria-label="Páginas como aparecem no jogo">
                      <div v-for="(page, index) in pages" :key="index" class="page"><small>Página {{ index + 1 }}</small><pre>{{ page.join('\n') }}</pre></div>
                    </div>
                  </div>
                  <label v-else-if="field === 'prompt'">Pergunta (opcional)<input :value="step.prompt || ''" @input="set('prompt', $event.target.value)" /></label>
                  <label v-else-if="field === 'default'">Opção padrão (ao pular a cena)
                    <select :value="step.default || 0" @change="set('default', Number($event.target.value))">
                      <option v-for="(option, index) in step.options || []" :key="index" :value="index">{{ index + 1 }}. {{ option.text }}</option>
                    </select>
                  </label>
                  <div v-else-if="field === 'options'" class="options-field">
                    <strong>Opções (até 4)</strong>
                    <div v-for="(option, index) in step.options || []" :key="index" class="option-row">
                      <input :value="option.text" :aria-label="`Opção ${index + 1}`" @input="option.text = $event.target.value" />
                      <button type="button" title="Remover opção" :disabled="step.options.length <= 1" @click="step.options.splice(index, 1)">×</button>
                    </div>
                    <button type="button" class="quiet-action" :disabled="(step.options || []).length >= 4" @click="step.options.push({ text: `Opção ${step.options.length + 1}`, steps: [] })">＋ Opção</button>
                    <p class="muted">Cada opção tem um ramo próprio no roteiro (↳). Selecione o ramo e adicione comandos.</p>
                  </div>
                  <div v-else-if="field === 'x'" class="xy-field">
                    <div class="xy-row">
                      <label>{{ step.type === 'move' && step.relative ? 'Δx (px)' : 'x (px)' }}<input type="number" :value="step.x ?? 0" @change="set('x', Number($event.target.value))" /></label>
                      <label v-if="step.type !== 'camera'">{{ step.type === 'move' && step.relative ? 'Δy (px)' : 'y (px)' }}
                        <input type="number" :value="step.y ?? ''" placeholder="manter" @change="set('y', $event.target.value === '' ? '' : Number($event.target.value))" />
                      </label>
                    </div>
                    <button v-if="step.type !== 'camera' || step.mode === 'x'" type="button" class="quiet-action pick-button" @click="c.startPick(c.selectedPath.value)">📍 Escolher no mapa</button>
                    <p v-if="step.type !== 'camera'" class="muted">y vazio mantém a altura atual (andar no chão). Coordenadas em pixels do mapa; x é o centro do ator e y os pés.</p>
                  </div>
                  <template v-else-if="field === 'y'" />
                  <label v-else-if="['relative', 'wait', 'visible', 'value'].includes(field)" class="check">
                    <input type="checkbox" :checked="checkValue(field)" @change="set(field, $event.target.checked)" />
                    {{ checkLabel(field) }}
                  </label>
                  <label v-else-if="field === 'speed'">Velocidade (px por quadro{{ step.type === 'camera' ? '; 0 = corte' : '' }})
                    <input type="number" min="0" max="64" step="0.25" :value="step.speed ?? (step.type === 'camera' ? 2 : 1)" @change="set('speed', Number($event.target.value))" />
                  </label>
                  <label v-else-if="field === 'direction'">Direção
                    <select :value="step.direction || (step.type === 'fade' ? 'out' : 'right')" @change="set('direction', $event.target.value)">
                      <template v-if="step.type === 'fade'"><option value="out">Escurecer</option><option value="in">Clarear</option></template>
                      <template v-else><option value="right">Direita</option><option value="left">Esquerda</option><option value="actor">Para outro ator</option></template>
                    </select>
                  </label>
                  <label v-else-if="field === 'animation'">Animação
                    <select :value="step.animation || 'auto'" @change="set('animation', $event.target.value)">
                      <option value="auto">Automática (controle do jogo)</option>
                      <option v-for="item in c.config.value.animations || []" :key="item.id" :value="item.id">{{ item.name || item.id }}</option>
                    </select>
                  </label>
                  <label v-else-if="field === 'frames'">Duração (quadros)
                    <input type="number" min="0" max="65535" :value="step.frames ?? 30" @change="set('frames', Number($event.target.value))" />
                    <small class="muted">≈ {{ ((step.frames ?? 30) / 60).toFixed(2) }} s em NTSC</small>
                  </label>
                  <label v-else-if="field === 'mode'">Modo
                    <select :value="step.mode || 'actor'" @change="set('mode', $event.target.value)"><option value="actor">Focar um ator</option><option value="x">Posição x</option><option value="follow">Voltar a seguir o jogador</option></select>
                  </label>
                  <label v-else-if="vocabulary[field]">{{ vocabulary[field].label }}
                    <select :value="step[field] || ''" @change="set(field, $event.target.value)">
                      <option v-if="field === 'music'" value="room">Música da sala</option>
                      <option v-for="item in c.config.value[vocabulary[field].key] || []" :key="item.id" :value="item.id">{{ item.name || item.id }}{{ item.description ? ` — ${item.description}` : '' }}</option>
                    </select>
                    <small v-if="!(c.config.value[vocabulary[field].key] || []).length" class="muted">Nenhum item em “{{ vocabulary[field].key }}”. Cadastre na aba Vocabulário.</small>
                  </label>
                  <label v-else-if="field === 'arg'">Argumento<input type="number" :value="step.arg ?? 0" @change="set('arg', Number($event.target.value))" /></label>
                  <p v-else-if="field === 'then' || field === 'else'" class="muted">{{ field === 'then' ? 'Ramo “Então”: executa se a flag tiver o valor marcado.' : 'Ramo “Senão”: executa caso contrário.' }}</p>
                </template>
                <label class="note-field">Nota / intenção (não vai para a ROM)
                  <textarea rows="2" :value="step.note || ''" placeholder="Ex.: Alice hesita antes de se aproximar" @input="set('note', $event.target.value)" />
                </label>
              </template>
              <div v-else class="muted inspector-empty">Selecione um comando para editar.</div>

              <section v-if="c.scene.value" class="trigger-box">
                <h4>Gatilhos neste mapa</h4>
                <p v-if="!c.triggersForScene.value.length" class="muted">Nenhum objeto <code>cutscene_trigger</code> aponta para esta cena.</p>
                <button v-for="object in c.triggersForScene.value" :key="object.id" type="button" class="trigger-item" @click="selectTrigger(object)">
                  #{{ object.id }} · {{ startLabels[object.properties?.start || 'touch'] }}{{ object.properties?.once === false ? '' : ' · uma vez' }}
                </button>
                <div class="trigger-add">
                  <select v-model="newTriggerStart" aria-label="Como a cena começa">
                    <option value="touch">Ao tocar na área</option>
                    <option value="interact">Ao interagir (botão)</option>
                    <option value="enter">Ao entrar na sala</option>
                  </select>
                  <button type="button" class="quiet-action" @click="addTrigger">＋ Gatilho no mapa</button>
                </div>
                <p class="muted">O gatilho é um objeto do mapa: mova e redimensione a área no editor e salve o mapa.</p>
              </section>
            </aside>
          </div>

          <!-- PRÉVIA -->
          <div v-else-if="tab === 'preview'" class="preview-layout">
            <div class="preview-stage" tabindex="0" @keydown="onPreviewKey">
              <canvas ref="previewCanvas" width="320" height="224" aria-label="Prévia da cena" />
              <p class="muted">Teclado (com o foco aqui): Enter/Espaço = confirmar · ↑/↓ = escolher · S = pular.</p>
            </div>
            <div class="preview-side">
              <div class="preview-controls">
                <button type="button" class="primary-action" @click="togglePlay">{{ playing ? '⏸ Pausar' : (sim?.done ? '⟲ Repetir' : '▶ Reproduzir') }}</button>
                <button type="button" class="quiet-action" @click="restartPreview">⟲ Reiniciar</button>
                <button type="button" class="quiet-action" :disabled="!sim || sim.done" @click="pressInput('confirm')">A · Confirmar</button>
                <button type="button" class="quiet-action" :disabled="!sim?.choice" @click="pressInput('up')">↑</button>
                <button type="button" class="quiet-action" :disabled="!sim?.choice" @click="pressInput('down')">↓</button>
                <button type="button" class="quiet-action" :disabled="!sim || sim.done" @click="pressInput('skip')">Pular cena</button>
                <label class="speed">Velocidade
                  <select v-model.number="previewSpeed"><option :value="0.5">0,5×</option><option :value="1">1×</option><option :value="2">2×</option></select>
                </label>
              </div>
              <dl class="preview-state">
                <dt>Quadro</dt><dd>{{ sim?.frame || 0 }} ({{ ((sim?.frame || 0) / 60).toFixed(1) }} s)</dd>
                <dt>Comando</dt><dd>{{ playingNumber || '—' }}</dd>
                <dt>Flags</dt><dd>{{ sim && sim.flags.size ? [...sim.flags].join(', ') : 'nenhuma' }}</dd>
              </dl>
              <h4>Eventos</h4>
              <ol class="preview-log">
                <li v-for="(entry, index) in (sim?.log || []).slice().reverse()" :key="index"><small>{{ entry.frame }}</small> {{ entry.text }}</li>
              </ol>
              <p class="muted">A prévia usa o cenário do editor e os marcadores dos objetos do mapa como posição inicial dos atores. O jogo aplica física e animações próprias.</p>
            </div>
          </div>

          <!-- VOCABULÁRIO -->
          <div v-else-if="tab === 'vocabulary'" class="vocabulary-layout">
            <section>
              <div class="panel-intro">
                <h3>Vocabulário do projeto</h3>
                <p>Atores, animações, retratos, sons, músicas, habilidades, eventos e flags que as cenas podem usar. O <code>value</code> de cada item é escrito no C como está (número ou constante, ex.: <code>SFX_PICKUP</code>). Arquivo: <code>cutscenes/cutscene-config.json</code>.</p>
              </div>
              <div class="vocab-summary">
                <div v-for="(meta, key) in vocabularyLists" :key="key" class="vocab-card">
                  <strong>{{ meta }}</strong>
                  <span>{{ (c.config.value[key] || []).map(item => item.id).join(', ') || '—' }}</span>
                </div>
              </div>
              <form class="quick-flag" @submit.prevent="addFlag">
                <strong>Nova flag</strong>
                <input v-model="newFlagId" placeholder="id (ex.: met_cat)" pattern="[a-z][a-z0-9_]*" aria-label="Id da flag" />
                <input v-model="newFlagDescription" placeholder="descrição" aria-label="Descrição da flag" />
                <button type="submit" class="quiet-action" :disabled="!newFlagId">＋ Adicionar</button>
              </form>
            </section>
            <section class="config-editor">
              <label>JSON da configuração
                <textarea v-model="configText" rows="24" spellcheck="false" />
              </label>
              <div class="config-actions">
                <button type="button" class="primary-action" @click="saveConfigText">Salvar configuração</button>
                <button type="button" class="quiet-action" @click="resetConfigText">Descartar edição</button>
              </div>
              <ul v-if="c.configErrors.value.length" class="error-list"><li v-for="error in c.configErrors.value" :key="error">{{ error }}</li></ul>
            </section>
          </div>

          <!-- RUNTIME -->
          <div v-else class="runtime-layout">
            <div class="panel-intro">
              <h3>Runtime de cenas no jogo</h3>
              <p>O intérprete <code>src/retrostudio/cutscene_runner.c</code> é igual em todos os jogos do Retro Studio. Ao salvar uma cena, o editor gera <code>{{ c.config.value.output?.ids || 'src/cutscene_ids.h' }}</code> e <code>{{ c.config.value.output?.data || 'src/cutscene_data.h' }}</code>. Para ligar o runtime ao jogo (sprites, texto, som), siga <code>docs/CUTSCENES.md</code> — uma IA consegue fazer essa integração lendo esse guia.</p>
            </div>
            <p v-if="c.status.value?.available === false" class="error-list">Runtime não encontrado nesta instalação do Retro Studio.</p>
            <template v-else-if="c.status.value">
              <p :class="c.status.value.installed && c.status.value.upToDate ? 'ok-line' : 'warn-line'">
                {{ !c.status.value.installed ? 'O runtime ainda não está instalado neste projeto.' : c.status.value.upToDate ? `Runtime v${c.status.value.version} instalado e atualizado.` : 'Há arquivos do runtime diferentes da versão do Retro Studio.' }}
              </p>
              <ul class="runtime-files">
                <li v-for="file in c.status.value.files" :key="file.target"><span>{{ file.exists ? (file.current ? '✓' : '≠') : '—' }}</span> <code>{{ file.target }}</code> <small v-if="file.mode === 'keep'">(do projeto; nunca é sobrescrito)</small></li>
              </ul>
              <button type="button" class="primary-action" :disabled="c.busy.value" @click="c.installRuntime()">{{ c.status.value.installed ? 'Atualizar runtime' : 'Instalar runtime no projeto' }}</button>
              <p class="muted">Arquivos da biblioteca alterados no projeto recebem uma cópia <code>.bak-*</code> antes de serem substituídos.</p>
            </template>
            <button type="button" class="quiet-action" :disabled="c.busy.value" @click="recompile">Recompilar todas as cenas</button>
          </div>
        </div>

        <footer class="cs-footer" :class="{ bad: problems.length }">
          <template v-if="problems.length">
            <strong>{{ problems.length }} problema(s)</strong>
            <ul><li v-for="problem in problems.slice(0, 6)" :key="problem">{{ problem }}</li></ul>
          </template>
          <span v-else-if="c.scene.value">✓ Cena válida · {{ c.compiled.value.ops.length }} comandos compilados</span>
        </footer>
      </section>
    </div>
    <div v-if="c.picking.value" class="cs-pick-banner" role="status">
      📍 Clique no mapa para escolher a posição.
      <button type="button" @click="c.cancelPick()">Cancelar</button>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { STEP_TYPES, dialoguePages, stepBranches } from '../../../../assets/toolkit/lib/cutscene/tools/cutscene-compiler.mjs'
import { createPreview, previewStep, previewCameraX } from '@/utils/retro/cutscenePreview.js'

const props = defineProps({ state: { type: Object, required: true } })
const c = props.state.cutscenes

const tabs = [
  { id: 'script', label: 'Roteiro' },
  { id: 'preview', label: 'Prévia' },
  { id: 'vocabulary', label: 'Vocabulário' },
  { id: 'runtime', label: 'Runtime' }
]
const vocabulary = {
  sound: { key: 'sounds', label: 'Som' },
  music: { key: 'music', label: 'Música' },
  ability: { key: 'abilities', label: 'Habilidade' },
  event: { key: 'events', label: 'Evento do jogo' },
  flag: { key: 'flags', label: 'Flag' }
}
const vocabularyLists = { actors: 'Atores', animations: 'Animações', portraits: 'Retratos', sounds: 'Sons', music: 'Músicas', abilities: 'Habilidades', events: 'Eventos', flags: 'Flags' }
const startLabels = { touch: 'ao tocar', interact: 'ao interagir', enter: 'ao entrar na sala' }

const tab = ref('script')
const expanded = ref(false)
const closeButton = ref(null)
const insertList = ref('')
const newTitle = ref('')
const newId = ref('')
const newTriggerStart = ref('touch')
const newFlagId = ref('')
const newFlagDescription = ref('')
const configText = ref('')

const step = computed(() => c.selectedStep.value)
const runtimeWarning = computed(() => c.status.value && (!c.status.value.installed || !c.status.value.upToDate))
const problems = computed(() => [...new Set([...(c.compiled.value.errors || []), ...c.projectErrors.value])])
const pages = computed(() => step.value?.type === 'say' ? dialoguePages(step.value.text, c.config.value, !!step.value.portrait) : [])

const rows = computed(() => {
  const out = []
  let number = 0
  const walk = (steps, listPath, depth) => (steps || []).forEach((item, index) => {
    const path = `${listPath}.${index}`
    out.push({ kind: 'step', path, step: item, depth, number: ++number })
    for (const branch of stepBranches(item)) {
      const branchPath = `${path}.${branch.key}`
      out.push({ kind: 'branch', path: branchPath, label: branch.label, depth: depth + 1, count: branch.steps.length })
      walk(branch.steps, branchPath, depth + 2)
    }
  })
  walk(c.scene.value?.steps, 'steps', 0)
  return out
})

function actorName(id) { return c.actors.value.find(actor => actor.id === id)?.name || '' }
function shorten(text, size = 48) { text = String(text || '').replace(/\s+/g, ' '); return text.length > size ? `${text.slice(0, size - 1)}…` : text }
function summary(item) {
  switch (item.type) {
    case 'say': return `${item.speaker || actorName(item.actor) || 'Narrador'}: “${shorten(item.text)}”`
    case 'choice': return `${item.prompt ? `${shorten(item.prompt, 24)} — ` : ''}${(item.options || []).map(option => option.text).join(' / ')}`
    case 'move': return `${actorName(item.actor) || item.actor} ${item.relative ? `${item.x >= 0 ? '+' : ''}${item.x || 0}px` : `→ x ${item.x}`}${item.y !== undefined && item.y !== '' ? `, y ${item.y}` : ''}${item.wait === false ? ' (paralelo)' : ''}`
    case 'place': return `${actorName(item.actor) || item.actor} em x ${item.x}${item.y !== undefined && item.y !== '' ? `, y ${item.y}` : ''}`
    case 'face': return `${actorName(item.actor) || item.actor} ${item.direction === 'actor' ? `→ ${actorName(item.target) || item.target}` : item.direction === 'left' ? '← esquerda' : '→ direita'}`
    case 'animate': return `${actorName(item.actor) || item.actor}: ${item.animation || 'auto'}`
    case 'show': return `${actorName(item.actor) || item.actor} ${item.visible === false ? 'oculto' : 'visível'}`
    case 'wait': return `${item.frames ?? 30} quadros`
    case 'camera': return item.mode === 'follow' ? 'seguir jogador' : item.mode === 'x' ? `x ${item.x}` : `foco em ${actorName(item.actor) || item.actor}`
    case 'fade': return `${item.direction === 'in' ? 'clarear' : 'escurecer'} em ${item.frames ?? 20} quadros`
    case 'sound': return item.sound
    case 'music': return item.music || 'room'
    case 'set_flag': return `${item.flag} = ${item.value !== false}`
    case 'if_flag': return `${item.flag} = ${item.value !== false}?`
    case 'ability': return item.ability
    case 'event': return `${item.event}(${item.arg || 0})`
    default: return ''
  }
}
function checkValue(field) {
  if (field === 'relative') return !!step.value.relative
  return step.value[field] !== false
}
function checkLabel(field) {
  return { relative: 'Relativo à posição atual', wait: 'Esperar terminar', visible: 'Visível', value: step.value?.type === 'if_flag' ? 'Testar flag ligada' : 'Ligar flag' }[field]
}
function set(field, value) { c.updateStep(c.selectedPath.value, field, value) }
function selectStep(path) { c.selectedPath.value = path; insertList.value = '' }
function selectBranch(path) { insertList.value = path; c.selectedPath.value = '' }
function addStep(type) {
  if (insertList.value) {
    const list = insertList.value
    const parentPath = list.split('.').slice(0, -1).join('.')
    const key = list.split('.').pop()
    const parent = parentPath.split('.').reduce((node, part) => node?.[part], c.scene.value)
    if (parent && !Array.isArray(parent[key])) parent[key] = []
    c.insertStep(list, (c.listAt(list) || []).length, type)
    insertList.value = ''
  } else c.addAfterSelected(type)
}
function syncNewId() {
  newId.value = newTitle.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'cena_$1').slice(0, 40)
}
async function createScene() {
  if (await c.createScene(newId.value, newTitle.value)) { newId.value = ''; newTitle.value = '' }
}
function addTrigger() {
  if (!c.scene.value) return
  props.state.addCutsceneTrigger(c.scene.value.id, newTriggerStart.value)
  window.retroStudioToast?.success?.('Gatilho adicionado ao mapa. Ajuste a área e salve o mapa.')
}
function selectTrigger(object) {
  props.state.selectedObjectId.value = object.id
  c.close()
}
function requestClose() {
  if (c.dirty.value && !window.confirm('A cena tem alterações não salvas. Fechar mesmo assim? (As alterações continuam abertas no editor até você trocar de cena.)')) return
  stopPreview()
  c.close()
}
function setTab(id) {
  tab.value = id
  if (id === 'vocabulary') resetConfigText()
}

// Vocabulary
function resetConfigText() { configText.value = JSON.stringify(c.config.value, null, 2) }
async function saveConfigText() {
  let next
  try { next = JSON.parse(configText.value) } catch (error) { window.retroStudioToast?.error?.(`JSON inválido: ${error.message}`); return }
  if (await c.saveConfig(next)) window.retroStudioToast?.success?.('Configuração salva.')
}
async function addFlag() {
  const id = newFlagId.value.trim()
  if (!/^[a-z][a-z0-9_]*$/.test(id)) { window.retroStudioToast?.error?.('Id de flag inválido.'); return }
  if ((c.config.value.flags || []).some(flag => flag.id === id)) { window.retroStudioToast?.error?.('Essa flag já existe.'); return }
  const next = JSON.parse(JSON.stringify(c.config.value))
  next.flags = [...(next.flags || []), { id, description: newFlagDescription.value.trim() }]
  if (await c.saveConfig(next)) { newFlagId.value = ''; newFlagDescription.value = ''; resetConfigText() }
}
async function recompile() {
  await c.loadList()
  const ok = await c.compileAll()
  window.retroStudioToast?.[ok ? 'success' : 'warning']?.(ok ? 'Cabeçalhos C atualizados.' : 'Há erros; veja o rodapé.')
}

// Preview
const previewCanvas = ref(null)
const sim = ref(null)
const playing = ref(false)
const previewSpeed = ref(1)
const pendingInput = {}
const imageCache = new Map()
let frameHandle = 0
let lastTime = 0
let accumulator = 0

const playingPath = computed(() => tab.value === 'preview' && sim.value ? sim.value.currentPath : '')
const playingNumber = computed(() => rows.value.find(row => row.path === playingPath.value)?.number || 0)

function restartPreview() {
  const compiled = c.compiled.value
  const preview = createPreview(compiled, c.scene.value || { steps: [] }, c.config.value, c.positionsBefore('__start__'))
  preview.mapWidth = (props.state.mapWidth.value || 40) * 8
  sim.value = preview
  accumulator = 0
  render()
}
function togglePlay() {
  if (!sim.value || sim.value.done) restartPreview()
  playing.value = !playing.value || sim.value.frame === 0
  if (playing.value) loop()
}
function stopPreview() { playing.value = false; cancelAnimationFrame(frameHandle) }
function pressInput(name) {
  pendingInput[name] = true
  if (!playing.value && sim.value && !sim.value.done) { playing.value = true; loop() }
}
function onPreviewKey(event) {
  const map = { Enter: 'confirm', ' ': 'confirm', z: 'confirm', ArrowUp: 'up', ArrowDown: 'down', s: 'skip', S: 'skip' }
  const name = map[event.key]
  if (!name) return
  event.preventDefault()
  pressInput(name)
}
function loop() {
  cancelAnimationFrame(frameHandle)
  lastTime = performance.now()
  const tick = now => {
    if (!playing.value || !sim.value) return
    accumulator += (now - lastTime) * previewSpeed.value
    lastTime = now
    let steps = 0
    while (accumulator >= 1000 / 60 && steps < 8) {
      const input = { ...pendingInput }
      for (const key of Object.keys(pendingInput)) delete pendingInput[key]
      previewStep(sim.value, input)
      accumulator -= 1000 / 60
      steps++
    }
    render()
    if (sim.value.done) { playing.value = false; return }
    frameHandle = requestAnimationFrame(tick)
  }
  frameHandle = requestAnimationFrame(tick)
}

function tilesetImage(ts) {
  if (!ts?.preview) return null
  let image = imageCache.get(ts.preview)
  if (!image) { image = new Image(); image.src = ts.preview; imageCache.set(ts.preview, image) }
  return image.complete && image.naturalWidth ? image : null
}
function drawActorSprite(ctx, actor, camX, camY) {
  const config = c.actors.value.find(item => item.id === actor.id)
  const object = (props.state.objects.value || []).find(item => item.type === config?.mapObjectType)
  const visual = object?.visual
  if (visual?.gid) {
    const ts = (props.state.userTilesets.value || []).find(item => visual.gid >= (item.firstgid || 1) && visual.gid < (item.firstgid || 1) + (item.tilecount || 65536))
    const image = tilesetImage(ts)
    if (image) {
      const columns = ts.columns || Math.floor(image.naturalWidth / 8) || 16
      const frames = Math.max(1, visual.frames || 1)
      const frame = frames > 1 ? Math.floor(sim.value.frame / (60 / (visual.fps || 4))) % frames : 0
      const local = visual.gid - (ts.firstgid || 1) + frame * (visual.width || 1)
      const w = visual.displayWidth || (object.width || 1) * 8
      const h = visual.displayHeight || (object.height || 1) * 8
      const x = Math.round(actor.x - camX - w / 2 + Number(object.properties?.spriteOffsetX || 0))
      const y = Math.round(actor.y - camY - h + Number(object.properties?.spriteOffsetY || 0))
      ctx.save()
      if (actor.left) { ctx.translate(x * 2 + w, 0); ctx.scale(-1, 1) }
      ctx.drawImage(image, (local % columns) * 8, Math.floor(local / columns) * 8, (visual.width || 1) * 8, (visual.height || 1) * 8, x, y, w, h)
      ctx.restore()
      return
    }
  }
  const x = Math.round(actor.x - camX)
  const y = Math.round(actor.y - camY)
  ctx.fillStyle = actor.color
  ctx.fillRect(x - 6, y - 32, 12, 32)
  ctx.fillStyle = '#000'
  ctx.fillRect(actor.left ? x - 5 : x + 1, y - 27, 4, 3)
}
function drawText(ctx, text, x, y, color) {
  ctx.fillStyle = color
  for (let i = 0; i < text.length; i++) ctx.fillText(text[i], x + i * 8 + 4, y + 4)
}
function render() {
  const canvas = previewCanvas.value
  if (!canvas || !sim.value) return
  const ctx = canvas.getContext('2d')
  const preview = sim.value
  const { width, height } = preview.screen
  canvas.width = width
  canvas.height = height
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  const camX = previewCameraX(preview)
  const mapHeight = (props.state.mapHeight.value || 28) * 8
  const player = Object.values(preview.actors)[0]
  const camY = Math.max(0, Math.min(Math.max(0, mapHeight - height), Math.round((player?.y || 0) - height * 0.75)))
  const source = props.state.mapCanvas.value
  const zoom = Number(props.state.zoom.value) || 1
  if (source?.width) ctx.drawImage(source, camX * zoom, camY * zoom, width * zoom, height * zoom, 0, 0, width, height)
  for (const actor of Object.values(preview.actors)) if (actor.visible) drawActorSprite(ctx, actor, camX, camY)

  ctx.font = 'bold 8px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const box = preview.dialogue || preview.choice
  if (box) {
    const left = 16, top = 136, boxWidth = width - 32, boxHeight = 72
    ctx.fillStyle = 'rgba(16, 16, 48, 0.96)'
    ctx.fillRect(left, top, boxWidth, boxHeight)
    ctx.strokeStyle = '#e8a33a'
    ctx.lineWidth = 2
    ctx.strokeRect(left + 1, top + 1, boxWidth - 2, boxHeight - 2)
    if (preview.dialogue) {
      const d = preview.dialogue
      const portrait = d.portrait && c.portraitPreviews.value[d.portrait]
      let textX = 32
      if (portrait) {
        let image = imageCache.get(portrait)
        if (!image) { image = new Image(); image.src = portrait; imageCache.set(portrait, image) }
        const px = d.side === 'right' ? left + boxWidth - 44 : left + 8
        if (image.complete) ctx.drawImage(image, px, top + 8, 32, 32)
        else { ctx.strokeStyle = '#e8a33a'; ctx.strokeRect(px, top + 8, 32, 32) }
        if (d.side !== 'right') textX = 64
      }
      if (d.speaker) drawText(ctx, d.speaker, textX, 144, '#ffd27a')
      d.lines.forEach((line, index) => drawText(ctx, line, textX, 160 + index * 16, '#eeeeee'))
      if (Math.floor(preview.frame / 20) % 2) drawText(ctx, 'A', width - 40, 192, '#ffd27a')
    } else {
      const choice = preview.choice
      if (choice.prompt) drawText(ctx, choice.prompt, 32, 144, '#ffd27a')
      choice.options.forEach((option, index) => drawText(ctx, `${index === choice.cursor ? '>' : ' '} ${option}`, 32, 160 + index * 12, index === choice.cursor ? '#ffffff' : '#9aa3b5'))
    }
  }
  if (preview.fade.value > 0) { ctx.fillStyle = `rgba(0,0,0,${preview.fade.value})`; ctx.fillRect(0, 0, width, height) }
  if (preview.done) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 96, width, 32); drawText(ctx, 'FIM DA CENA', width / 2 - 44, 108, '#fff') }
}

watch(tab, async value => {
  c.previewing.value = value === 'preview'
  if (value === 'preview') {
    await nextTick()
    // Let the map canvas redraw without editor overlays before sampling it.
    requestAnimationFrame(() => restartPreview())
  } else stopPreview()
})
watch(() => c.open.value, async value => {
  if (!value) { stopPreview(); c.previewing.value = false; return }
  await nextTick()
  closeButton.value?.focus()
})
watch(() => c.scenePath.value, () => { if (tab.value === 'preview') restartPreview() })
onBeforeUnmount(() => { stopPreview(); c.previewing.value = false })
</script>

<style scoped>
.cutscene-launcher { padding: 4px 0; font-size: 12px; }
.open-cutscenes { width: 100%; min-height: 34px; border: 1px solid #c58b2c; color: var(--text); background: color-mix(in srgb, #c58b2c 14%, var(--bg)); border-radius: 5px; cursor: pointer; font: inherit; font-weight: 600; }
.overlay-toggle { display: flex; align-items: center; gap: 6px; margin: 8px 0 4px; font-size: 11px; }
.launcher-hint { margin: 6px 0 0; color: var(--muted, #a8b0b8); font-size: 11px; line-height: 1.45; }
.cs-backdrop { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 3vh 3vw; background: rgb(5 8 12 / 78%); }
.cs-backdrop.expanded { padding: 0; }
.cs-dialog { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; width: min(1320px, 95vw); height: min(900px, 93vh); color: var(--text, #e6eaf0); background: var(--panel, #20252b); border: 1px solid var(--border, #3a4148); border-radius: 9px; box-shadow: 0 22px 80px rgb(0 0 0 / 60%); overflow: hidden; font-size: 12px; }
.cs-dialog.expanded { width: 100vw; height: 100dvh; border-radius: 0; }
.cs-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 20px; border-bottom: 1px solid var(--border, #3a4148); background: linear-gradient(110deg, rgb(197 139 44 / 14%), transparent 45%); }
.cs-heading { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cs-mark { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid rgb(232 163 58 / 50%); background: #3a2a12; border-radius: 7px; font-size: 20px; }
.cs-heading small { color: var(--muted, #a8b0b8); font-size: 10px; letter-spacing: .06em; }
.cs-heading h2 { margin: 2px 0 0; font-size: 17px; }
.dirty-badge { margin-left: 8px; padding: 2px 7px; border-radius: 10px; color: #ffe1a6; background: #5a3d10; font-size: 10px; font-weight: 500; vertical-align: middle; }
.cs-header-actions { display: flex; align-items: center; gap: 8px; }
.icon-button { width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 5px; color: var(--text); background: transparent; font-size: 18px; cursor: pointer; }
.cs-tabs { display: flex; gap: 4px; padding: 0 16px; border-bottom: 1px solid var(--border); background: rgb(0 0 0 / 10%); }
.cs-tabs button { position: relative; padding: 11px 15px; border: 0; color: var(--muted, #a8b0b8); background: transparent; font: inherit; cursor: pointer; }
.cs-tabs button.active { color: var(--text); }
.cs-tabs button.active::after { position: absolute; right: 10px; bottom: -1px; left: 10px; height: 2px; content: ""; background: #e8a33a; }
.tab-dot { margin-left: 5px; color: #f5b04a; font-size: 9px; }
.cs-body { min-height: 0; overflow: hidden; }
.cs-footer { display: flex; align-items: flex-start; gap: 12px; min-height: 22px; padding: 9px 20px; border-top: 1px solid var(--border); color: #9fd8a8; background: rgb(0 0 0 / 14%); }
.cs-footer.bad { color: #ffb4a8; }
.cs-footer ul { margin: 0; padding-left: 16px; max-height: 64px; overflow: auto; }
.script-layout { display: grid; grid-template-columns: 210px minmax(0, 1fr) 340px; height: 100%; }
.scene-list, .inspector { min-height: 0; overflow: auto; padding: 14px; background: rgb(0 0 0 / 8%); }
.scene-list { border-right: 1px solid var(--border); }
.inspector { border-left: 1px solid var(--border); }
.scene-list h3, .inspector h3 { margin: 0 0 10px; font-size: 13px; }
.scene-item { display: flex; width: 100%; flex-direction: column; align-items: flex-start; gap: 2px; margin-bottom: 5px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 5px; color: var(--text); background: var(--bg); text-align: left; cursor: pointer; }
.scene-item.active { border-color: #e8a33a; box-shadow: inset 3px 0 0 #e8a33a; }
.scene-item small { color: var(--muted); font-size: 10px; }
.scene-item .other-map { color: #f5b04a; }
.new-scene { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
.step-pane { min-height: 0; overflow: auto; padding: 14px 16px; }
.scene-meta { margin-bottom: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: rgb(0 0 0 / 10%); }
.scene-meta summary { cursor: pointer; font-weight: 600; }
.step-palette { position: sticky; top: -14px; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0 -16px 10px; padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--panel, #20252b); }
.palette-label { width: 100%; color: var(--muted); font-size: 10px; }
.step-palette button { padding: 4px 7px; border: 1px solid var(--border); border-radius: 12px; color: var(--text); background: var(--bg); font: inherit; font-size: 11px; cursor: pointer; }
.step-palette button:hover { border-color: #e8a33a; }
.step-rows { margin: 0; padding: 0; list-style: none; }
.step-rows li { padding-left: calc(var(--depth) * 18px); }
.step-row, .branch-row { display: flex; width: 100%; align-items: center; gap: 8px; margin: 2px 0; padding: 6px 9px; border: 1px solid transparent; border-radius: 5px; color: var(--text); background: rgb(255 255 255 / 3%); font: inherit; text-align: left; cursor: pointer; }
.step-row:hover, .branch-row:hover { border-color: var(--border); }
.step-row.selected { border-color: #e8a33a; background: rgb(232 163 58 / 12%); }
.step-row.playing { box-shadow: inset 3px 0 0 #7dd3fc; }
.branch-row { color: #b9c7d3; background: transparent; font-size: 11px; }
.branch-row.selected { border-color: #7dd3fc; background: rgb(125 211 252 / 10%); }
.step-number { min-width: 22px; color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
.step-icon { width: 18px; text-align: center; }
.step-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step-note { color: #f5b04a; }
.type-say .step-icon, .type-choice .step-icon { color: #ffd27a; }
.empty-steps, .empty-state { padding: 18px; color: var(--muted); }
.inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.inspector-tools { display: flex; gap: 4px; }
.inspector-tools button { min-width: 28px; padding: 4px 6px; }
.inspector-tools .danger { border-color: #8a3b3b; }
label { display: flex; flex-direction: column; gap: 5px; margin: 9px 0; font-size: 12px; }
label.check { flex-direction: row; align-items: center; gap: 7px; }
input, select, textarea, button { font: inherit; color: var(--text); background: var(--bg, #191d22); border: 1px solid var(--border, #3a4148); border-radius: 5px; padding: 6px 8px; min-width: 0; }
button { cursor: pointer; }
button:disabled { opacity: .55; cursor: default; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, .preview-stage:focus-visible { outline: 2px solid #f5b04a; outline-offset: 2px; }
textarea { resize: vertical; }
.primary-action { border-color: #c58b2c; background: #5a3d10; font-weight: 600; }
.quiet-action { margin: 4px 0; }
.muted { color: var(--muted, #a8b0b8); font-size: 11px; line-height: 1.45; }
.portrait-field { display: flex; align-items: flex-end; gap: 10px; }
.portrait-field label { flex: 1; }
.portrait-thumb { width: 48px; height: 48px; margin-bottom: 9px; border: 1px solid #e8a33a; image-rendering: pixelated; background: #101030; }
.page-preview { display: flex; flex-wrap: wrap; gap: 6px; }
.page { padding: 6px 8px; border: 1px solid #5a4a2a; border-radius: 4px; background: #101030; }
.page small { color: #ffd27a; font-size: 9px; }
.page pre { margin: 3px 0 0; color: #eee; font: 11px/1.4 monospace; white-space: pre; }
.options-field, .xy-field { margin: 9px 0; }
.option-row { display: flex; gap: 5px; margin: 5px 0; }
.option-row input { flex: 1; }
.xy-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pick-button { width: 100%; }
.note-field { margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--border); }
.trigger-box { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--border); }
.trigger-box h4 { margin: 0 0 8px; }
.trigger-item { display: block; width: 100%; margin: 3px 0; text-align: left; border-color: #8a6a2a; }
.trigger-add { display: flex; gap: 6px; margin-top: 8px; }
.trigger-add select { flex: 1; }
.preview-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; height: 100%; padding: 18px; overflow: auto; }
.preview-stage { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.preview-stage canvas { width: min(100%, 960px); aspect-ratio: 320 / 224; border: 1px solid #5a4a2a; background: #000; image-rendering: pixelated; }
.preview-controls { display: flex; flex-wrap: wrap; gap: 6px; }
.speed { flex-direction: row; align-items: center; margin: 4px 0; }
.preview-state { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 12px 0; }
.preview-state dt { color: var(--muted); }
.preview-state dd { margin: 0; }
.preview-log { max-height: 260px; margin: 0; padding-left: 18px; overflow: auto; font-size: 11px; }
.preview-log small { color: var(--muted); }
.vocabulary-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 20px; height: 100%; padding: 18px; overflow: auto; }
.panel-intro h3 { margin: 0 0 6px; font-size: 16px; }
.panel-intro p { margin: 0 0 12px; color: var(--muted); line-height: 1.5; }
.vocab-summary { display: grid; gap: 6px; }
.vocab-card { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 5px; background: rgb(0 0 0 / 10%); }
.vocab-card span { color: var(--muted); font-family: monospace; font-size: 11px; word-break: break-word; }
.quick-flag { display: grid; grid-template-columns: 1fr 1.4fr auto; gap: 6px; align-items: center; margin-top: 14px; }
.quick-flag strong { grid-column: 1 / -1; }
.config-editor textarea { font: 11px/1.45 monospace; }
.config-actions { display: flex; gap: 8px; }
.error-list { color: #ffb4a8; }
.runtime-layout { max-width: 780px; height: 100%; margin: 0 auto; padding: 22px; overflow: auto; }
.runtime-files { padding-left: 0; list-style: none; }
.runtime-files li { margin: 4px 0; }
.ok-line { color: #9fd8a8; }
.warn-line { color: #f5b04a; }
.cs-pick-banner { position: fixed; top: 14px; left: 50%; z-index: 10001; display: flex; align-items: center; gap: 12px; padding: 10px 14px; transform: translateX(-50%); border: 1px solid #e8a33a; border-radius: 6px; color: #fff; background: #2b2010; box-shadow: 0 8px 30px rgb(0 0 0 / 50%); font-size: 13px; }
@media (max-width: 1100px) { .script-layout { grid-template-columns: 180px minmax(0, 1fr) 290px; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
