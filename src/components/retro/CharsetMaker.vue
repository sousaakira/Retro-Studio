<template>
  <Teleport to="body" :disabled="embedded">
    <div class="charset-backdrop" :class="{ 'is-embedded': embedded }" @click.self="!embedded && requestClose()">
      <section class="charset-window" :inert="leaving" :aria-busy="leaving || exporting || busy" :role="embedded ? 'region' : 'dialog'" :aria-modal="embedded ? undefined : true" aria-labelledby="charset-title" @keydown="onHistoryKey">
        <header class="charset-header">
          <div>
            <p class="charset-kicker">RETRO STUDIO · SGDK <span v-if="sourceFile">· {{ projectSaveStatus }}</span></p>
            <h2 id="charset-title">Charset Maker</h2>
          </div>
          <label class="character-name">Personagem
            <input v-model.trim="characterName" maxlength="40" placeholder="henzo" :disabled="busy || exporting" />
          </label>
          <span class="history-buttons" role="group" aria-label="Histórico de edição">
            <button class="cm-button" type="button" :disabled="!canUndo || busy || exporting" title="Desfazer (Ctrl+Z)" @click="undo">Desfazer</button>
            <button class="cm-button" type="button" :disabled="!canRedo || busy || exporting" title="Refazer (Ctrl+Shift+Z)" @click="redo">Refazer</button>
          </span>
          <button class="charset-close" type="button" aria-label="Fechar Charset Maker" @click="requestClose" :disabled="busy || exporting"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </header>

        <div class="character-library">
          <label>Personagens do projeto
            <select :value="getCharsetProjectFilePath()" :disabled="busy || exporting" @change="openLibraryCharacter">
              <option value="">Selecione um personagem…</option>
              <option v-for="item in characterLibrary" :key="item.path" :value="item.path">{{ item.name }} · {{ item.data.animations.length }} animações</option>
            </select>
          </label>
          <button class="cm-button" :disabled="busy || exporting" @click="newCharacter"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Novo personagem</button>
          <button class="cm-button" :disabled="busy || exporting || !sheetImage" @click="duplicateCharacter"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>Duplicar</button>
          <button class="cm-button" :disabled="busy || exporting" @click="refreshCharacterLibrary"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></svg>Atualizar lista</button>
          <span v-if="libraryError" role="alert" class="inline-error">{{ libraryError }}</span>
        </div>
        <main class="charset-layout" :inert="busy || exporting">
          <aside class="movements-panel" aria-label="Movimentos do personagem">
            <div class="movements-heading">
              <span>MOVIMENTOS</span><small>{{ animations.length }}</small>
              <button class="cm-icon-button" type="button" aria-label="Criar movimento" title="Novo movimento" @click="beginNewAnimation"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
            </div>
            <input ref="movementSearch" v-model="movementFilter" class="movement-search" type="search" placeholder="Buscar movimento…" aria-label="Buscar movimento" />
            <div class="movements-list">
              <p v-if="!animations.length" class="animation-empty">Crie seu primeiro movimento selecionando quadros na folha.</p>
              <p v-else-if="!visibleAnimations.length" class="animation-empty">Nenhum movimento encontrado.</p>
              <div v-for="{ animation, index } in visibleAnimations" :key="animation.id" class="movement-entry" :class="{ selected: selectedAnimationId === animation.id }">
                <button class="movement-select" type="button" :aria-pressed="selectedAnimationId === animation.id" :title="animation.name" @click="selectAnimation(animation)">
                  <span class="animation-index">{{ String(index).padStart(2, '0') }}</span>
                  <span class="animation-copy"><strong>{{ animation.name }}</strong><small>{{ animation.frameCount }} quadros · {{ animation.frames ? 'Livre' : 'Grid' }}</small></span>
                </button>
                <button class="animation-remove" type="button" :aria-label="'Remover ' + animation.name" :title="'Remover ' + animation.name" @click="removeAnimation(animation.id)"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
              </div>
            </div>
            <div v-if="selectedAnimation" class="movement-properties">
              <label>Nome do movimento<input :value="selectedAnimation.name" maxlength="40" @change="renameAnimation" /></label>
              <div class="crop-actions">
                <button class="cm-button" @click="duplicateAnimation"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>Duplicar</button>
                <button class="cm-icon-button" :disabled="animations[0]?.id === selectedAnimationId" aria-label="Mover para cima" @click="moveAnimation(-1)"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>
                <button class="cm-icon-button" :disabled="animations[animations.length - 1]?.id === selectedAnimationId" aria-label="Mover para baixo" @click="moveAnimation(1)"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button>
              </div>
              <small>{{ selectedAnimation.frameWidth }}×{{ selectedAnimation.frameHeight }} px · {{ selectedAnimation.fps }} FPS</small>
            </div>
          </aside>
          <section class="sheet-panel" aria-label="Folha de sprites">
            <div class="sheet-toolbar">
              <button class="cm-button primary" type="button" @click="openCharsetDialog(false)"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 8"/></svg>{{ sheetImage ? 'Trocar charset' : 'Abrir charset' }}</button>
              <span class="sheet-filename" :title="sourceFileName">{{ sourceFileName || 'PNG, GIF ou JPG' }}</span>
              <details ref="recentMenu" class="recent-charsets">
                <summary>Recentes <span>{{ recentFiles.length }}</span></summary>
                <div class="recent-charsets-menu">
                  <p v-if="!recentFiles.length">Nenhuma folha aberta recentemente.</p>
                  <div v-for="item in recentFiles" :key="item.path" class="recent-charset-item">
                    <button type="button" :title="item.path" @click="openRecentCharset(item)">{{ item.name }}</button>
                    <button type="button" :aria-label="`Remover ${item.name} dos recentes`" title="Remover dos recentes" @click="removeRecentCharset(item.path)"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
                  </div>
                </div>
              </details>
              <div class="background-control" aria-label="Fundo apenas para visualização" title="Fundo de prévia; não será exportado">
                <button class="checker-button" :class="{ active: checkerBackground }" type="button" :aria-pressed="checkerBackground" title="Alternar fundo quadriculado" aria-label="Alternar fundo quadriculado" @click="checkerBackground = !checkerBackground"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg></button>
                <label class="background-color-label" title="Cor de fundo da visualização">Fundo<input v-model="viewBackground" type="color" aria-label="Cor de fundo da visualização" @input="checkerBackground = false" /></label>
              </div>
              <label class="zoom-control" title="Ctrl/Cmd + roda: zoom · Shift ou Alt + roda: rolagem horizontal">Zoom <input v-model.number="zoom" type="range" min="0.2" max="6" step="0.1" /> {{ Math.round(zoom * 100) }}%</label>
            </div>

            <div ref="sheetViewport" class="sheet-viewport" @pointerup="finishSelection" @wheel="onSheetWheel">
              <div v-if="!sheetImage" class="sheet-empty">
                <span class="empty-glyph">▦</span>
                <strong>Abra uma folha de sprites</strong>
                <p>Arraste sobre uma faixa de quadros para marcar uma animação.</p>
              </div>
              <div v-else class="sheet-stage" :style="sheetStageStyle">
                <canvas ref="sheetCanvas" class="sheet-image" @pointerdown="startSelection" @pointermove="moveSelection" />
                <div v-if="selectionRect" class="selection-rect" :style="selectionStyle" aria-hidden="true" />
                <div v-if="selectionRect && selectionGrid.count" class="frame-guides" aria-hidden="true">
                  <span v-for="frame in visibleFrameGuides" :key="frame.index" class="frame-guide" :class="{ first: frame.index === 0 }" :style="frame.style">{{ frame.index + 1 }}</span>
                </div>
              </div>
            </div>

            <div class="sheet-footnote" v-if="sheetImage">
              <span>{{ sheetImage.naturalWidth }} × {{ sheetImage.naturalHeight }} px</span>
              <span v-if="selectionRect">Seleção {{ selectionRect.width }} × {{ selectionRect.height }} px · {{ captureMode === 'free' ? 'recorte livre' : selectionGrid.count + ' quadros' }}</span>
              <span v-else>Arraste para selecionar os quadros de uma animação</span>
            </div>
            <!-- #45: with the bottom dock on its "Linha do tempo" tab, the timeline lives there. -->
            <Teleport defer to="#workspace-dock-timeline" :disabled="!timelineDock">
            <section v-if="selectedAnimation" class="animation-timeline" :class="{ docked: timelineDock }" aria-label="Sequência de quadros">
              <div class="timeline-preview">
                <div class="preview-stage" :style="previewStageStyle">
                  <canvas ref="previewCanvas" class="frame-preview" :class="{ 'marking-anchor': markingAnchor }" :style="[previewStyle, { transform: previewFlip ? 'scaleX(-1)' : '' }]" @pointerdown="setAnchorFromPreview" />
                </div>
                <label><input v-model="previewFlip" type="checkbox" /> Flip na prévia</label>
                <button class="cm-button" :aria-pressed="markingAnchor" @click="markingAnchor = !markingAnchor">{{ markingAnchor ? 'Clique nos pés' : 'Marcar pés' }}</button>
              </div>
              <div class="timeline-heading">
                <strong>{{ selectedAnimation.name }}</strong>
                <span>{{ selectedAnimation.frameCount }} quadros · {{ animationSeconds.toFixed(2) }} s</span>
                <label>Vídeo <select v-model.number="previewHz"><option :value="60">NTSC · 60 Hz</option><option :value="50">PAL · 50 Hz</option></select></label>
              </div>
              <div class="timeline-strip">
                <button v-for="(frame, index) in timelineFrames" :key="index" type="button" class="timeline-frame" :class="{ selected: selectedFrame === index }" :aria-pressed="selectedFrame === index" :aria-label="'Quadro ' + (index + 1)" draggable="true" @click="selectTimelineFrame(index)" @dragstart="dragTimelineFrame($event, index)" @dragover.prevent @drop.prevent="dropTimelineFrame(index)" @dragend="draggedFrame = null">
                  <span class="timeline-thumbnail"><span class="timeline-crop" :style="timelineFrameStyle(frame)"><img :src="sheetImage.src" alt="" draggable="false" /></span></span>
                  <span class="timeline-frame-info"><b>{{ index + 1 }}</b><small>{{ charsetFrameTicks(selectedAnimation, index) }} ticks</small></span>
                </button>
              </div>
              <div class="timeline-actions">
                <button class="cm-icon-button" aria-label="Quadro anterior" @click="stepFrame(-1)"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button>
                <button class="cm-button" :disabled="reducedMotion" @click="togglePlayback"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-if="isPlaying" d="M8 5v14M16 5v14"/><path v-else d="m8 5 11 7-11 7Z"/></svg>{{ isPlaying ? 'Pausar' : 'Reproduzir' }}</button>
                <button class="cm-icon-button" aria-label="Próximo quadro" @click="stepFrame(1)"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg></button>
                <button class="cm-button" :disabled="selectedAnimation.frameCount >= 255" @click="duplicateTimelineFrame"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>Duplicar quadro</button>
                <button class="cm-button" :disabled="selectedAnimation.frameCount <= 1" @click="removeTimelineFrame"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>Remover</button>
                <button class="cm-icon-button" title="Mover quadro para a esquerda" aria-label="Mover quadro para a esquerda" :disabled="selectedFrame === 0" @click="moveTimelineFrame(-1)"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg></button>
                <button class="cm-icon-button" title="Mover quadro para a direita" aria-label="Mover quadro para a direita" :disabled="selectedFrame === selectedAnimation.frameCount - 1" @click="moveTimelineFrame(1)"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button>
                <label>FPS <input v-model.number="selectedAnimation.fps" type="number" min="1" max="60" @change="clampFps(selectedAnimation)" /></label>
                <label><input v-model="selectedAnimation.loop" type="checkbox" /> Loop</label>
                <label>Tempo <input type="number" min="1" max="255" :value="charsetFrameTicks(selectedAnimation, selectedFrame)" @change="setFrameTicks" /> ticks</label>
                <button class="cm-button" @click="resetFrameTicks">Usar FPS</button>
              </div>
              <p class="helper-text">Arraste para ordenar. 1 tick = 1 quadro de vídeo. Tempos individuais são exportados para o SGDK.</p>
            </section>
            </Teleport>
          </section>

          <aside class="animation-panel" aria-label="Controles de recorte e grid">
            <div class="inspector-heading"><strong>{{ selectedAnimation?.name || 'Novo movimento' }}</strong><small>Propriedades</small></div>
            <div class="inspector-tabs" role="tablist" aria-label="Propriedades do personagem">
              <button v-for="tab in [{ id: 'crop', name: 'Recorte' }, { id: 'body', name: 'Corpo' }, { id: 'attack', name: 'Ataque' }, { id: 'behavior', name: 'Comportamento' }, { id: 'export', name: 'Exportar' }]" :id="'cm-tab-' + tab.id" :key="tab.id" role="tab" type="button" :aria-selected="inspectorTab === tab.id" :aria-controls="'cm-panel-' + tab.id" :class="{ active: inspectorTab === tab.id }" @click="inspectorTab = tab.id">{{ tab.name }}</button>
            </div>
            <div ref="inspectorContent" class="inspector-content">

            <section v-show="inspectorTab === 'crop'" id="cm-panel-crop" role="tabpanel" aria-labelledby="cm-tab-crop" class="frame-settings">
              <div class="panel-heading"><span>RECORTE</span><small>Recorte por animação</small></div>
              <div class="capture-mode-field">
                <span class="capture-mode-label">Modo de seleção</span>
                <div class="capture-mode-buttons" role="group" aria-label="Modo de seleção">
                  <button type="button" :class="{ active: captureMode === 'grid' }" :aria-pressed="captureMode === 'grid'" title="Grid regular: quadros com o mesmo tamanho e espaçamento" @click="captureMode = 'grid'">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                    </svg>
                    <span>Grid regular</span>
                  </button>
                  <button type="button" :class="{ active: captureMode === 'free' }" :aria-pressed="captureMode === 'free'" title="Quadros livres: recortar cada pose com tamanho próprio" @click="captureMode = 'free'">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" /><rect x="7" y="7" width="10" height="10" rx="2" />
                    </svg>
                    <span>Quadros livres</span>
                  </button>
                </div>
              </div>
              <p class="helper-text">Grid para faixas regulares; livre para poses de espada.</p>
              <div class="dimension-row">
                <label>Largura <span>px</span><input v-model.number="frameWidth" type="number" min="1" max="248" step="1" @change="normalizeDimension('width')" /></label>
                <label>Altura <span>px</span><input v-model.number="frameHeight" type="number" min="1" max="248" step="1" @change="normalizeDimension('height')" /></label>
              </div>
              <div v-if="captureMode === 'grid'" class="dimension-row spacing-row">
                <label>Espaço X <span>px</span><input v-model.number="spacingX" type="number" min="0" max="128" step="1" /></label>
                <label>Espaço Y <span>px</span><input v-model.number="spacingY" type="number" min="0" max="128" step="1" /></label>
              </div>
              <div class="dimension-row">
                <label>Apoio X <span>px no recorte</span><input v-model.number="anchorX" type="number" min="0" :max="frameWidth" @change="normalizeGeometry" /></label>
                <label>Apoio Y <span>px no recorte</span><input v-model.number="anchorY" type="number" min="0" :max="frameHeight" @change="normalizeGeometry" /></label>
              </div>
              <details class="crop-help"><summary>Ajuda de recorte e alinhamento</summary><p>O recorte aceita medidas exatas em pixels. Só a célula exportada é arredondada para múltiplos de 8. Marque o mesmo ponto dos pés para alinhar as poses. Mudanças afetam a faixa ao aplicar.</p></details>
              <div v-if="selectionRect" class="selection-coordinates">
                <label v-for="key in ['x', 'y', 'width', 'height']" :key="key">{{ { x: 'Origem X', y: 'Origem Y', width: 'Seleção L', height: 'Seleção A' }[key] }}
                  <input type="number" :value="selectionRect[key]" :min="key === 'x' || key === 'y' ? 0 : 1" @change="editSelection(key, $event)" />
                </label>
              </div>
              <div class="crop-actions">
                <button class="cm-button" @click="freshSelection">Limpar seleção</button>
                <button class="cm-button" @click="beginNewAnimation"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Nova animação</button>
              </div>
              <button v-if="captureMode === 'grid'" class="cm-button" :disabled="!selectedAnimation || !!selectedAnimation.frames || !selectionGrid.count || selectionGrid.count > 255" @click="updateSelectedAnimation">Aplicar grid à faixa selecionada</button>
              <div v-if="captureMode === 'grid' || !selectedAnimation" class="new-animation-row">
                <input v-model.trim="animationName" aria-label="Nome da animação" placeholder="idle, correr, pular…" @keydown.enter.prevent="captureMode === 'free' ? addManualFrame() : addAnimation()" />
                <button v-if="captureMode === 'grid'" class="cm-button add-button" type="button" :disabled="!canAddAnimation" @click="addAnimation">Adicionar faixa</button>
              </div>
              <div v-if="captureMode === 'free'" class="crop-actions">
                <button class="cm-button primary" :disabled="!canCaptureFrame || (!selectedAnimation && !animationName)" @click="addManualFrame">{{ selectedAnimation ? 'Adicionar quadro à animação' : 'Criar animação com este quadro' }}</button>
                <button v-if="selectedAnimation?.frames" class="cm-button" :disabled="!validFreeSelection" @click="replaceManualFrame">Substituir quadro {{ selectedFrame + 1 }}</button>
              </div>
              <p v-if="captureMode === 'free' && selectionRect && (selectionRect.width > 248 || selectionRect.height > 248)" class="inline-error">Este recorte excede 248 px. Reduza a seleção.</p>
              <p v-if="captureMode === 'grid' && selectionRect && !selectionGrid.count" class="inline-error">A seleção é menor que um quadro {{ frameWidth }} × {{ frameHeight }}.</p>
              <p v-else-if="captureMode === 'grid' && selectionRect && selectionGrid.count > 255" class="inline-error">Cada animação SGDK aceita até 255 quadros.</p>
            </section>



            <section v-show="inspectorTab === 'body'" id="cm-panel-body" role="tabpanel" aria-labelledby="cm-tab-body" class="frame-settings">
              <div class="panel-heading"><span>COLISÃO DO CORPO</span><small>Independente da espada</small></div>
              <p class="helper-text">Coordenadas relativas aos pés. X negativo fica à esquerda; Y negativo, acima. Verde na prévia.</p>
              <div class="dimension-row">
                <label>X<input v-model.number="bodyBox.x" type="number" min="-248" max="248" @change="normalizeGeometry" /></label>
                <label>Y<input v-model.number="bodyBox.y" type="number" min="-248" max="248" @change="normalizeGeometry" /></label>
              </div>
              <div class="dimension-row">
                <label>Largura<input v-model.number="bodyBox.width" type="number" min="1" max="248" @change="normalizeGeometry" /></label>
                <label>Altura<input v-model.number="bodyBox.height" type="number" min="1" max="248" @change="normalizeGeometry" /></label>
              </div>
              <div class="panel-heading"><span>ÁREA QUE RECEBE DANO</span><small>Hurtbox</small></div>
              <label class="loop-toggle"><input v-model="hurtBox.custom" type="checkbox" /> Usar uma caixa independente do corpo</label>
              <p class="helper-text">{{ hurtBox.custom ? 'Roxo tracejado na prévia. Coordenadas relativas aos pés.' : 'A área de dano acompanha a caixa do corpo, inclusive quando você a ajusta.' }}</p>
              <template v-if="hurtBox.custom">
                <div v-for="pair in [['x', 'y'], ['width', 'height']]" :key="'hurt-' + pair[0]" class="dimension-row">
                  <label v-for="key in pair" :key="key">{{ { x: 'X', y: 'Y', width: 'Largura', height: 'Altura' }[key] }}
                    <input v-model.number="hurtBox[key]" type="number" :min="key === 'x' || key === 'y' ? -248 : 1" max="248" @change="normalizeGeometry" />
                  </label>
                </div>
                <button type="button" @click="copyBodyToHurtBox">Copiar caixa do corpo</button>
              </template>
            </section>
            <section v-if="selectedAnimation" v-show="inspectorTab === 'attack'" id="cm-panel-attack" role="tabpanel" aria-labelledby="cm-tab-attack" class="frame-settings">
              <label class="loop-toggle"><input v-model="selectedAnimation.attack.enabled" type="checkbox" /> Área de ataque desta animação</label>
              <template v-if="selectedAnimation.attack.enabled">
                <p class="helper-text">Laranja na prévia. Posição relativa aos pés; quadros numerados a partir de 0.</p>
                <div class="dimension-row" v-for="pair in [['x', 'y'], ['width', 'height'], ['firstFrame', 'lastFrame']]" :key="pair[0]">
                  <label v-for="key in pair" :key="key">{{ { x: 'X', y: 'Y', width: 'Largura', height: 'Altura', firstFrame: 'Quadro inicial', lastFrame: 'Quadro final' }[key] }}
                    <input v-model.number="selectedAnimation.attack[key]" type="number" @change="normalizeGeometry" />
                  </label>
                </div>
              </template>
              <p class="helper-text">As caixas são exportadas no cabeçalho C. O jogo deve usá-las na sua lógica de colisão e dano.</p>
            </section>

            <section v-if="selectedAnimation?.controller" v-show="inspectorTab === 'behavior'" id="cm-panel-behavior" role="tabpanel" aria-labelledby="cm-tab-behavior" class="frame-settings behavior-settings">
              <div class="panel-heading"><span>COMPORTAMENTO</span><small>{{ selectedAnimation.name }}</small></div>
              <div class="behavior-preview">
                <canvas ref="behaviorCanvas" :style="previewStageStyle" aria-label="Prévia das transições do personagem" />
                <p v-if="behaviorState" class="helper-text">{{ animations.find(a => a.id === behaviorState.animationId)?.name }} · quadro {{ behaviorState.frame + 1 }} · {{ behaviorState.ticks }} ticks</p>
                <div class="crop-actions"><button class="cm-button" :disabled="!!controllerError" @click="resetBehaviorPreview">Reiniciar</button><button class="cm-button" :disabled="!!controllerError" @click="stepBehaviorPreview">1 tick</button><button class="cm-button" :disabled="reducedMotion || !!controllerError" @click="toggleBehaviorPreview">{{ behaviorPlaying ? 'Pausar' : 'Simular' }}</button></div>
                <details><summary>Condições da simulação</summary><label v-for="condition in CHARACTER_CONDITIONS" :key="condition.bit" class="loop-toggle"><input type="checkbox" :checked="!!(behaviorConditions & condition.bit)" @change="behaviorConditions = $event.target.checked ? (behaviorConditions | condition.bit) >>> 0 : (behaviorConditions & ~condition.bit) >>> 0" />{{ condition.label }}</label><label>Predicados ativos<input v-model="behaviorPredicates" type="text" placeholder="IDs: 10, 20" /></label></details>
                <details v-if="behaviorState?.events.length"><summary>Eventos da simulação ({{ behaviorState.events.length }})</summary><ol class="behavior-event-log"><li v-for="(event, index) in behaviorState.events" :key="index">{{ event.tick }} · {{ event.animationName }} · {{ CHARACTER_EVENT_TYPES.find(type => type.id === event.type)?.label || event.type }} · {{ event.argument }}</li></ol></details>
                <p class="helper-text">A simulação não altera os quadros selecionados nem executa sons, ataques ou código do jogo.</p>
                <p v-if="behaviorError" class="inline-error" role="alert">{{ behaviorError }}</p>
              </div>
              <label class="loop-toggle"><input v-model="selectedAnimation.controller.interruptible" type="checkbox" /> Permitir interrupção antes do fim</label>
              <p class="helper-text">O jogo informa as condições. Maior prioridade vence; empates seguem a ordem da lista.</p>
              <p v-if="!selectedAnimation.controller.interruptible && selectedAnimation.loop" class="inline-error">Um movimento em loop sem interrupção só sai por comando do jogo.</p>
              <div class="panel-heading"><span>TRANSIÇÕES</span><button class="cm-button" :disabled="animations.length < 2 || selectedAnimation.controller.transitions.length >= 512" @click="addCharacterTransition">Adicionar</button></div>
              <p v-if="!selectedAnimation.controller.transitions.length" class="helper-text">Adicione um movimento de destino para trocar de animação.</p>
              <details v-for="(transition, index) in selectedAnimation.controller.transitions" :key="index" class="behavior-entry" open>
                <summary>→ {{ animations.find(a => a.id === transition.target)?.name || 'Destino removido' }}</summary>
                <label>Movimento de destino<select v-model="transition.target"><option v-for="animation in animations.filter(a => a.id !== selectedAnimation.id)" :key="animation.id" :value="animation.id">{{ animation.name }}</option></select></label>
                <div class="dimension-row"><label>Prioridade<input v-model.number="transition.priority" type="number" min="-32768" max="32767" /></label><label>Espera mínima <span>ticks</span><input v-model.number="transition.minimumTicks" type="number" min="0" max="65535" /></label></div>
                <label class="loop-toggle"><input v-model="transition.finished" type="checkbox" /> Esperar a animação terminar</label>
                <p v-if="transition.finished && selectedAnimation.loop" class="inline-error">Uma animação em loop não termina. Desative o loop ou a espera pelo término.</p>
                <label v-for="condition in CHARACTER_CONDITIONS" :key="condition.bit" class="behavior-condition">{{ condition.label }}<select :value="transition.requireAll & condition.bit ? 'all' : transition.requireNone & condition.bit ? 'none' : 'any'" @change="setTransitionCondition(transition, condition.bit, $event.target.value)"><option value="any">Indiferente</option><option value="all">Necessária</option><option value="none">Ausente</option></select></label>
                <details><summary>Condição do jogo</summary><label>ID do predicado<input v-model.number="transition.predicate" type="number" min="0" max="65535" /></label><p class="helper-text">65535 desativa o predicado. Outros IDs chamam a condição customizada do jogo.</p></details>
                <button class="cm-button" @click="selectedAnimation.controller.transitions.splice(index, 1)">Remover transição</button>
              </details>
              <div class="panel-heading"><span>EVENTOS · QUADRO {{ selectedFrame + 1 }}</span><button class="cm-button" :disabled="selectedAnimation.controller.events.length >= 2048" @click="addCharacterEvent">Adicionar</button></div>
              <p v-if="!frameCharacterEvents.length" class="helper-text">Selecione um quadro na sequência e adicione um som, ataque ou transformação.</p>
              <div v-for="entry in frameCharacterEvents" :key="entry.index" class="behavior-entry">
                <label>Evento<select v-model.number="entry.event.type"><option v-for="type in CHARACTER_EVENT_TYPES" :key="type.id" :value="type.id">{{ type.label }}</option><option v-if="!CHARACTER_EVENT_TYPES.some(type => type.id === entry.event.type)" :value="entry.event.type">Tipo {{ entry.event.type }}</option></select></label>
                <label>ID / argumento<input v-model.number="entry.event.argument" type="number" min="0" max="65535" /></label>
                <button class="cm-button" @click="selectedAnimation.controller.events.splice(entry.index, 1)">Remover evento</button>
              </div>
              <p class="helper-text">Eventos acompanham seus quadros ao reorganizar a sequência. O jogo executa cada evento uma vez por passagem.</p>
              <p v-if="controllerError" class="inline-error" role="alert">{{ controllerError }}</p>
            </section>

            <section v-show="inspectorTab === 'export'" id="cm-panel-export" role="tabpanel" aria-labelledby="cm-tab-export" class="frame-settings">
              <div class="panel-heading"><span>EXPORTAÇÃO SGDK</span></div>
              <label class="export-filename">Símbolo do sprite<input v-model.trim="spriteName" type="text" maxlength="40" placeholder="SPR_HENZO" /></label>
              <label class="export-filename">Arquivo PNG<input v-model.trim="exportFileName" type="text" maxlength="100" placeholder="personagem_sprites.png" /></label>
              <p class="helper-text">O atlas é exportado para res/, com paleta indexada de até 15 cores opacas e transparência. Os nomes dos movimentos são exportados no cabeçalho C.</p>
              <p v-if="animations.length" class="helper-text">Célula final: {{ exportFrameWidth }}×{{ exportFrameHeight }} px. A reserva real de VRAM depende da otimização do SGDK.</p>
            </section>
            </div>
          </aside>
        </main>

        <footer class="charset-footer">
          <div class="export-summary" v-if="animations.length">
            <span>{{ exportFrameWidth }} × {{ exportFrameHeight }} px · até {{ exportFrameWidth / 8 * exportFrameHeight / 8 }} tiles / {{ exportFrameWidth / 8 * exportFrameHeight / 8 * 32 }} bytes por célula antes da otimização</span>
            <span>{{ totalFrames }} quadros · {{ animations.length }} animações</span>
            <span v-if="exportFrameWidth > 248 || exportFrameHeight > 248" class="limit-warning">Quadros acima do limite SGDK de 248 px</span>
          </div>
          <div class="footer-actions">
            <button class="cm-button" type="button" @click="requestClose" :disabled="busy || exporting">Fechar</button>
            <button class="cm-button primary export-button" type="button" :disabled="!canExport || exporting || busy || restoringProject" @click="exportCharacter"><svg class="cm-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/></svg>{{ exporting ? 'Exportando…' : 'Exportar para SGDK' }}</button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createCharacterPreview } from '@/utils/retro/characterPreview.js'
import { CHARACTER_CONDITIONS, CHARACTER_EVENT_TYPES, normalizeCharacterController, validateCharacterControllers, remapCharacterEvents, setTransitionCondition } from '@/utils/retro/characterController.js'
import { charsetFrameTicks, charsetFrames, charsetFrameAnchor, charsetAnchor, charsetLayout, charsetGeometryHeader, buildSgdkAnimationHeader, buildSgdkSpriteResource, encodeSgdkIndexedPng, getCharsetFrameGrid, SGDK_SPRITE_FRAME_LIMIT, SGDK_SPRITE_TILE_LIMIT } from '@/utils/retro/charsetMaker.js'
import { forgetRecentCharset, readRecentCharsets, rememberRecentCharset } from '@/utils/retro/recentCharsets.js'
import { toPortablePath, portableCandidates, samePortablePath } from '../../../shared/retro/portablePath.js'
import { createDocumentHistory } from '../../../shared/retro/documentHistory.js'

const props = defineProps({ projectPath: { type: String, default: '' }, embedded: Boolean, active: { type: Boolean, default: true }, timelineDock: Boolean })
const emit = defineEmits(['close', 'exported'])
let preparedForLeave = false
const leaving = ref(false)
const recentMenu = ref(null)
const sheetCanvas = ref(null)
const previewCanvas = ref(null)
const sheetViewport = ref(null)
const sheetImage = ref(null)
const sourceFile = ref(null)
const characterName = ref('')
const spriteName = ref('')
const exportFileName = ref('')
const exportedFileName = ref('')
const exportedResourceName = ref('')
const exportedHeaderName = ref('')
let migrationBackup = null
const recentFiles = ref(readRecentCharsets())
const projectSaveStatus = ref('')
const restoringProject = ref(false)
const legacySessionPath = ref('')
const activeProjectPath = ref('')
const characterLibrary = ref([])
const libraryError = ref('')
const busy = ref(false)
const anchorX = ref(16)
const anchorY = ref(48)
const bodyBox = ref({ x: -8, y: -32, width: 16, height: 32 })
const hurtBox = ref({ custom: false, x: -8, y: -32, width: 16, height: 32 })
let saveQueue = Promise.resolve()
const frameWidth = ref(32)
const frameHeight = ref(48)
const spacingX = ref(0)
const spacingY = ref(0)
const zoom = ref(1)
const viewBackground = ref('#263640')
const checkerBackground = ref(true)
const stageWidth = ref(800)
const animations = ref([])
const animationName = ref('idle')
const selectedAnimationId = ref('')
const selectedFrame = ref(0)
const isPlaying = ref(false)
const exporting = ref(false)
const dragOrigin = ref(null)
const dragRect = ref(null)
const savedSelection = ref(null)
const dragMode = ref('new')
const captureMode = ref('grid')
const inspectorTab = ref('crop')
const behaviorCanvas = ref(null)
const behaviorState = ref(null)
const behaviorPlaying = ref(false)
const behaviorConditions = ref(0)
const behaviorPredicates = ref('')
const behaviorError = ref('')
let behaviorEngine = null
let behaviorTimer = null
let behaviorTicket = 0
const inspectorContent = ref(null)
const movementFilter = ref('')
const visibleAnimations = computed(() => animations.value.map((animation, index) => ({ animation, index })).filter(({ animation }) => animation.name.toLocaleLowerCase().includes(movementFilter.value.trim().toLocaleLowerCase())))
const markingAnchor = ref(false)
const previewFlip = ref(false)
const previewHz = ref(60)
const draggedFrame = ref(null)
const reducedMotion = ref(false)
let resizeObserver
let playbackTimer
let motionQuery
let projectSaveTimer
// #52: estado do histórico de desfazer/refazer (funções mais abaixo, junto da restauração).
// Fora da chave (não criam passo): seleção; os ajustes da ferramenta de recorte, que mudam ao
// selecionar um movimento; e o registro do que já foi exportado, que pertence à exportação.
const HISTORY_VIEW_FIELDS = ['selectedAnimationId', 'selectedFrame', 'activeSelection', 'cropWidth', 'cropHeight', 'frameWidth', 'frameHeight', 'anchorX', 'anchorY', 'exportAnchor', 'spacingX', 'spacingY', 'captureMode', 'exportedFileName', 'exportedResourceName', 'exportedHeaderName']
const documentHistory = createDocumentHistory({ limit: 100, key: data => JSON.stringify({ ...data, ...Object.fromEntries(HISTORY_VIEW_FIELDS.map(field => [field, undefined])) }) })
let historyShape = ''
const canUndo = ref(false), canRedo = ref(false)
let applyingHistory = false

const sourceFileName = computed(() => sourceFile.value?.name || '')
const displayWidth = computed(() => sheetImage.value ? Math.max(1, Math.min(sheetImage.value.naturalWidth, stageWidth.value - 24) * zoom.value) : 0)
const displayHeight = computed(() => sheetImage.value ? displayWidth.value * sheetImage.value.naturalHeight / sheetImage.value.naturalWidth : 0)
const sheetStageStyle = computed(() => ({
  width: `${displayWidth.value}px`,
  height: `${displayHeight.value}px`,
  backgroundColor: checkerBackground.value ? 'transparent' : viewBackground.value
}))
const previewStageStyle = computed(() => ({
  backgroundColor: viewBackground.value,
  backgroundImage: checkerBackground.value ? '' : 'none'
}))
const selectionRect = computed(() => dragRect.value || savedSelection.value)
const selectionStyle = computed(() => {
  const r = selectionRect.value
  if (!r || !sheetImage.value) return {}
  const sx = displayWidth.value / sheetImage.value.naturalWidth
  return { left: `${r.x * sx}px`, top: `${r.y * sx}px`, width: `${r.width * sx}px`, height: `${r.height * sx}px` }
})
const selectionGrid = computed(() => selectionRect.value
  ? getCharsetFrameGrid(selectionRect.value, frameWidth.value, frameHeight.value, spacingX.value, spacingY.value)
  : { columns: 0, rows: 0, count: 0 })
const visibleFrameGuides = computed(() => {
  if (!selectionRect.value || !sheetImage.value || captureMode.value === 'free') return []
  const region = selectionRect.value
  const grid = selectionGrid.value
  const scale = displayWidth.value / sheetImage.value.naturalWidth
  return Array.from({ length: Math.min(grid.count, SGDK_SPRITE_FRAME_LIMIT) }, (_, index) => {
    const column = index % grid.columns
    const row = Math.floor(index / grid.columns)
    return {
      index,
      style: {
        left: `${(region.x + column * grid.stepX) * scale}px`,
        top: `${(region.y + row * grid.stepY) * scale}px`,
        width: `${frameWidth.value * scale}px`,
        height: `${frameHeight.value * scale}px`
      }
    }
  })
})
const selectedAnimation = computed(() => animations.value.find(animation => animation.id === selectedAnimationId.value) || null)
const timelineFrames = computed(() => selectedAnimation.value ? charsetFrames(selectedAnimation.value) : [])
const animationSeconds = computed(() => selectedAnimation.value ? timelineFrames.value.reduce((sum, frame, index) => sum + charsetFrameTicks(selectedAnimation.value, index), 0) / previewHz.value : 0)
const frameCounter = computed(() => selectedAnimation.value ? `${selectedFrame.value + 1} / ${selectedAnimation.value.frameCount}` : '')
const exportLayout = computed(() => charsetLayout(animations.value))
const exportFrameWidth = computed(() => exportLayout.value.width)
const exportFrameHeight = computed(() => exportLayout.value.height)
const totalFrames = computed(() => animations.value.reduce((sum, animation) => sum + animation.frameCount, 0))
const previewStyle = computed(() => ({ imageRendering: 'pixelated', width: `${Math.min(192, exportFrameWidth.value * 2)}px` }))
const canAddAnimation = computed(() => captureMode.value === 'grid' && !!sheetImage.value && !!animationName.value && selectionGrid.value.count > 0 && selectionGrid.value.count <= SGDK_SPRITE_FRAME_LIMIT)
const validFreeSelection = computed(() => !!sheetImage.value && !!selectionRect.value && selectionRect.value.width > 0 && selectionRect.value.height > 0 && selectionRect.value.width <= 248 && selectionRect.value.height <= 248)
const canCaptureFrame = computed(() => validFreeSelection.value && (!selectedAnimation.value || selectedAnimation.value.frameCount < SGDK_SPRITE_FRAME_LIMIT))
const canExport = computed(() => !!props.projectPath && !!sheetImage.value && animations.value.length > 0 && characterName.value && normalizeResourceName(spriteName.value) && exportFrameWidth.value <= SGDK_SPRITE_TILE_LIMIT * 8 && exportFrameHeight.value <= SGDK_SPRITE_TILE_LIMIT * 8 && animations.value.every(animation => animation.frameCount <= SGDK_SPRITE_FRAME_LIMIT))

watch(selectedAnimation, animation => {
  if (animation && !animation.controller) animation.controller = normalizeCharacterController(null)
}, { immediate: true, flush: 'sync' })
const frameCharacterEvents = computed(() => (selectedAnimation.value?.controller?.events || []).map((event,index) => ({event,index})).filter(entry => entry.event.frame === selectedFrame.value))
const controllerError = computed(() => { try { validateCharacterControllers(animations.value); return '' } catch (error) { return error.message } })
function stopBehaviorPreview() {
  behaviorTicket++
  behaviorPlaying.value = false
  if (behaviorTimer) clearTimeout(behaviorTimer)
  behaviorTimer = null
}
function drawBehaviorPreview() {
  const canvas = behaviorCanvas.value, state = behaviorState.value
  const animation = animations.value.find(a => a.id === state?.animationId)
  if (!canvas || !animation || !sheetImage.value) return
  canvas.width = exportFrameWidth.value; canvas.height = exportFrameHeight.value
  const frame = charsetFrames(animation)[state.frame]
  if (!frame) return
  const anchor = charsetFrameAnchor(frame)
  canvas.getContext('2d')?.drawImage(sheetImage.value, frame.x, frame.y, frame.width, frame.height,
    exportLayout.value.anchorX - anchor.x, exportLayout.value.anchorY - anchor.y, frame.width, frame.height)
}
function resetBehaviorPreview() {
  stopBehaviorPreview()
  behaviorEngine = null; behaviorState.value = null; behaviorError.value = ''
  const canvas = behaviorCanvas.value
  if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  if (!selectedAnimation.value || inspectorTab.value !== 'behavior' || !props.active) return
  try {
    behaviorEngine = createCharacterPreview(animations.value, selectedAnimationId.value)
    behaviorState.value = behaviorEngine.snapshot()
    void nextTick(drawBehaviorPreview)
  } catch (error) { behaviorError.value = error.message }
}
function stepBehaviorPreview() {
  if (!props.active || inspectorTab.value !== 'behavior') return
  if (!behaviorEngine) resetBehaviorPreview()
  if (!behaviorEngine) return
  try {
    const tokens = behaviorPredicates.value.trim() ? behaviorPredicates.value.split(',') : []
    if (tokens.some(value => !value.trim())) throw new Error('Informe um ID em cada posição da lista de predicados.')
    const predicates = tokens.map(value => Number(value.trim()))
    if (predicates.some(id => !Number.isInteger(id) || id < 0 || id >= 65535)) throw new Error('Use IDs de predicado de 0 a 65534, separados por vírgula.')
    behaviorState.value = behaviorEngine.tick(behaviorConditions.value, id => predicates.includes(id))
    behaviorError.value = ''
    void nextTick(drawBehaviorPreview)
  } catch (error) { behaviorError.value = error.message; stopBehaviorPreview() }
}
function scheduleBehaviorPreview() {
  const ticket = ++behaviorTicket
  if (behaviorTimer) clearTimeout(behaviorTimer)
  behaviorTimer = null
  if (!behaviorPlaying.value || !props.active || reducedMotion.value || inspectorTab.value !== 'behavior') return
  behaviorTimer = setTimeout(() => {
    if (ticket !== behaviorTicket || !behaviorPlaying.value || !props.active || reducedMotion.value || inspectorTab.value !== 'behavior') return
    stepBehaviorPreview(); scheduleBehaviorPreview()
  }, 1000 / previewHz.value)
}
function toggleBehaviorPreview() {
  if (behaviorPlaying.value) return stopBehaviorPreview()
  if (!props.active || reducedMotion.value) return
  if (!behaviorEngine) resetBehaviorPreview()
  if (!behaviorEngine) return
  stopPlayback()
  behaviorPlaying.value = true; scheduleBehaviorPreview()
}
watch([animations, selectedAnimationId, inspectorTab], resetBehaviorPreview, { deep: true })
watch(() => props.active, active => { if (!active) stopBehaviorPreview(); else resetBehaviorPreview() })
watch(reducedMotion, value => { if (value) stopBehaviorPreview() })
watch(previewHz, scheduleBehaviorPreview)

function addCharacterTransition() {
  const animation = selectedAnimation.value
  const target = animations.value.find(a => a.id !== animation?.id)
  if (!animation?.controller || !target || animation.controller.transitions.length >= 512) return
  animation.controller.transitions.push({target:target.id,requireAll:0,requireNone:0,finished:!animation.loop,minimumTicks:0,priority:0,predicate:65535})
}
function addCharacterEvent() {
  const animation = selectedAnimation.value
  if (!animation?.controller || animation.controller.events.length >= 2048) return
  stopPlayback()
  animation.controller.events.push({frame:selectedFrame.value,type:1,argument:0})
}

watch([sheetImage, displayWidth], async () => {
  await nextTick()
  if (!sheetImage.value || !sheetCanvas.value) return
  const canvas = sheetCanvas.value
  canvas.width = sheetImage.value.naturalWidth
  canvas.height = sheetImage.value.naturalHeight
  canvas.getContext('2d')?.drawImage(sheetImage.value, 0, 0)
})

watch([selectedAnimationId, selectedFrame, sheetImage, exportLayout, animations, bodyBox, hurtBox], async () => {
  await nextTick()
  drawPreviewFrame()
}, { deep: true })

watch([selectedAnimationId, isPlaying, previewHz], () => startPlaybackTimer())
watch(() => props.active, active => { if (!active) stopPlayback() })

onMounted(() => {
  void refreshCharacterLibrary()
  if (sheetViewport.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(([entry]) => { stageWidth.value = entry.contentRect.width })
    resizeObserver.observe(sheetViewport.value)
    stageWidth.value = sheetViewport.value.clientWidth
  }
  motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  reducedMotion.value = !!motionQuery?.matches
  motionQuery?.addEventListener?.('change', onMotionPreferenceChange)
})

onBeforeUnmount(() => {
  stopPlayback()
  clearTimeout(projectSaveTimer)
  if (!preparedForLeave && sourceFile.value?.path && !restoringProject.value && !exporting.value) void saveCharsetProject()
  resizeObserver?.disconnect()
  motionQuery?.removeEventListener?.('change', onMotionPreferenceChange)
})

async function requestClose() {
  if (busy.value || exporting.value) return
  if (await flushCharsetProjectSave()) emit('close')
}
async function prepareLeave() {
  if (leaving.value || busy.value || exporting.value || restoringProject.value) return false
  leaving.value = true
  stopPlayback()
  try {
    const saved = await flushCharsetProjectSave()
    preparedForLeave = saved
    if (!saved) leaving.value = false
    return saved
  } catch (error) { leaving.value = false; throw error }
}
function resumeEditing() { leaving.value = false; preparedForLeave = false }
async function saveCurrentProject() {
  if (leaving.value) return false
  try { return await prepareLeave() } finally { resumeEditing() }
}
const movementSearch = ref(null)
function focusSearch() { if (!leaving.value) movementSearch.value?.focus() }
defineExpose({ prepareLeave, resumeEditing, save: saveCurrentProject, focusSearch, undo, redo, openProjectFile })

function onMotionPreferenceChange(event) {
  reducedMotion.value = event.matches
  if (event.matches) stopPlayback()
}


function normalizeBox(box = {}) {
  const value = (key, fallback, min, max) => Math.max(min, Math.min(max, Math.round(Number(box[key]) || fallback)))
  return { x: value('x', 0, -248, 248), y: value('y', 0, -248, 248), width: value('width', 16, 1, 248), height: value('height', 32, 1, 248) }
}

function normalizeAttack(attack, count) {
  const data = attack || {}
  const firstFrame = Math.max(0, Math.min(count - 1, Math.round(Number(data.firstFrame) || 0)))
  return { ...normalizeBox(data), enabled: data.enabled === true, firstFrame,
    lastFrame: Math.max(firstFrame, Math.min(count - 1, Math.round(Number(data.lastFrame) || 0))) }
}

function normalizeGeometry() {
  const anchor = charsetAnchor({ frameWidth: frameWidth.value, frameHeight: frameHeight.value, anchorX: anchorX.value, anchorY: anchorY.value })
  anchorX.value = anchor.x; anchorY.value = anchor.y
  bodyBox.value = normalizeBox(bodyBox.value)
  hurtBox.value = { ...normalizeBox(hurtBox.value), custom: hurtBox.value.custom === true }
  if (selectedAnimation.value) selectedAnimation.value.attack = normalizeAttack(selectedAnimation.value.attack, selectedAnimation.value.frameCount)
}

function copyBodyToHurtBox() {
  hurtBox.value = { ...normalizeBox(bodyBox.value), custom: true }
}

function updateSelectedAnimation() {
  if (!selectedAnimation.value || !selectionRect.value) return
  const grid = selectionGrid.value
  if (!grid.count || grid.count > SGDK_SPRITE_FRAME_LIMIT) return
  if (selectedAnimation.value.frames) {
    window.retroStudioToast?.error?.('Esta animação usa quadros livres. Use Substituir quadro para alterar seu recorte.')
    return
  }
  normalizeGeometry()
  Object.assign(selectedAnimation.value, {
    region: { ...selectionRect.value }, frameWidth: frameWidth.value, frameHeight: frameHeight.value,
    spacingX: spacingX.value, spacingY: spacingY.value, anchorX: anchorX.value, anchorY: anchorY.value,
    columns: grid.columns, rows: grid.rows, frameCount: grid.count,
    attack: normalizeAttack(selectedAnimation.value.attack, grid.count)
  })
  remapCharacterEvents(selectedAnimation.value, frame => frame < grid.count ? frame : null)
  selectedFrame.value = 0
}

function upsertLibraryEntry(path, data) {
  const entry = { path, name: data.characterName || data.name || path.split('/').pop(), data }
  characterLibrary.value = [...characterLibrary.value.filter(item => item.path !== path), entry]
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function refreshCharacterLibrary() {
  libraryError.value = ''
  try {
    const tree = await window.retroStudio.listWorkspaceTree()
    const directory = `${props.projectPath}/charsets`.replace(/\\/g, '/')
    const find = node => node?.path?.replace(/\\/g, '/') === directory ? node
      : (node?.children || []).map(find).find(Boolean)
    const folder = find(tree)
    const entries = []
    for (const file of folder?.children || []) {
      if (file.kind !== 'file' || !file.name.endsWith('.charset.json')) continue
      try {
        const data = JSON.parse(await window.retroStudio.readTextFileOptional(file.path))
        if (!data || !Array.isArray(data.animations)) continue
        entries.push({ path: file.path, name: data.characterName || data.name || file.name, data })
      } catch {
        throw new Error(`Não foi possível ler ${file.name}. Corrija o arquivo antes de exportar.`)
      }
    }
    characterLibrary.value = entries.sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    libraryError.value = error.message || 'Não foi possível carregar os personagens.'
  }
}

function applyUniqueCharacterName(base) {
  const used = new Set(characterLibrary.value.map(item => normalizeName(item.data.characterName || item.name)))
  let name = normalizeName(base), index = 2
  while (used.has(name)) name = `${normalizeName(base).slice(0, 32)}_${index++}`
  characterName.value = name
  spriteName.value = `SPR_${name.toUpperCase()}`
  exportFileName.value = `${name}_sprites.png`
}

function newProjectPath() {
  return `${props.projectPath}/charsets/character_${crypto.randomUUID()}.charset.json`.replace(/\\/g, '/')
}

async function newCharacter() {
  if (leaving.value || busy.value || exporting.value || !await flushCharsetProjectSave() || leaving.value) return
  if (!sheetImage.value) {
    await openCharsetDialog(true)
    return
  }
  await refreshCharacterLibrary()
  if (leaving.value) return
  await loadSheetImage(sourceFile.value.name, sourceFile.value.path, sourceFile.value.size, sheetImage.value.src, newProjectPath(), true)
}

async function duplicateCharacter() {
  if (leaving.value || busy.value || exporting.value || !sheetImage.value || !await flushCharsetProjectSave() || leaving.value) return
  busy.value = true
  try {
    await refreshCharacterLibrary()
    restoringProject.value = true
    activeProjectPath.value = newProjectPath()
    applyUniqueCharacterName(characterName.value)
    exportedFileName.value = ''; exportedResourceName.value = ''; exportedHeaderName.value = ''
    animations.value = JSON.parse(JSON.stringify(animations.value))
    await nextTick()
    restoringProject.value = false
    resetHistory()
    if (!await saveCharsetProject()) throw new Error('Não foi possível salvar a cópia.')
  } catch (error) {
    window.retroStudioToast?.error?.(error.message)
  } finally {
    busy.value = false
  }
}

// Clique em um .charset.json no explorador: abre esse personagem aqui (como o .tmx abre no editor de mapas).
async function openProjectFile(path) {
  const same = value => String(value || '').replace(/\\/g, '/')
  await refreshCharacterLibrary()
  const item = characterLibrary.value.find(entry => same(entry.path) === same(path))
  if (!item) return false
  if (same(getCharsetProjectFilePath()) !== same(item.path)) await openLibraryCharacter({ target: { value: item.path } })
  return same(getCharsetProjectFilePath()) === same(item.path)
}
async function openLibraryCharacter(event) {
  const path = event.target.value
  const item = characterLibrary.value.find(entry => entry.path === path)
  if (!item || leaving.value || busy.value || exporting.value) return
  if (!await flushCharsetProjectSave()) { event.target.value = getCharsetProjectFilePath(); return }
  if (leaving.value) return
  const source = item.data.source
  if (!source?.path) {
    window.retroStudioToast?.error?.('Este projeto antigo não informa o caminho da folha. Abra a imagem original para restaurá-lo.')
    return
  }
  // #42: a folha é guardada relativa ao projeto; projetos antigos ainda trazem o caminho absoluto.
  // Projeto antigo copiado de outra máquina: tenta também o final do caminho dentro deste projeto.
  let sheetPath = '', result = null
  for (const candidate of portableCandidates(props.projectPath, source.path).slice(0, 12)) {
    result = await window.retroStudio.retro.readImageFile(candidate)
    if (result?.success) { sheetPath = candidate; break }
  }
  if (!result?.success) {
    window.retroStudioToast?.error?.(result?.error || 'A folha original não foi encontrada.')
    event.target.value = getCharsetProjectFilePath()
    return
  }
  await loadSheetImage(result.name || source.name, sheetPath, result.size, `data:${result.mime};base64,${result.base64}`, path)
}


function normalizeName(value) {
  const clean = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'character'
  return /^[a-z_]/i.test(clean) ? clean : `character_${clean}`
}

function normalizeResourceName(value) {
  const clean = String(value || '').trim().replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
  if (!clean) return ''
  return /^[A-Z_]/.test(clean) ? clean : `SPR_${clean}`
}

function normalizeExportFileName(value, fallback) {
  const leaf = String(value || '').trim().split(/[\\/]/).pop() || ''
  const stem = leaf.replace(/\.png$/i, '').replace(/\.+$/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '')
  return `${stem || fallback}.png`
}

function normalizeDimension(axis) {
  const value = Number({ width: frameWidth.value, height: frameHeight.value }[axis]) || 8
  const normalized = Math.max(1, Math.min(248, Math.round(value)))
  if (axis === 'width') { frameWidth.value = normalized; anchorX.value = Math.floor(normalized / 2) }
  else { frameHeight.value = normalized; anchorY.value = normalized }
  if (captureMode.value === 'free' && savedSelection.value) {
    const key = axis === 'width' ? 'width' : 'height'
    editSelection(key, { target: { value: normalized } })
  }
}

async function openCharsetDialog(fresh = false) {
  if (leaving.value || busy.value || exporting.value || !await flushCharsetProjectSave() || leaving.value) return
  const selected = await window.retroStudio?.retro?.selectFile?.({
    context: 'charset-maker',
    title: 'Abrir folha de sprites',
    filters: [{ name: 'Imagens', extensions: ['png', 'gif', 'jpg', 'jpeg', 'bmp'] }]
  })
  if (!selected?.success || !selected.path) return
  const result = await window.retroStudio?.retro?.readImageFile?.(selected.path)
  if (!result?.success) {
    window.retroStudioToast?.error?.(result?.error || 'Não foi possível abrir esta folha de sprites.')
    return
  }
  await refreshCharacterLibrary()
  const existing = characterLibrary.value.find(item => samePortablePath(props.projectPath, item.data.source?.path, selected.path))
  await loadSheetImage(result.name, selected.path, result.size, `data:${result.mime};base64,${result.base64}`, fresh === true ? newProjectPath() : existing?.path || '', fresh === true)
}

async function loadSheetImage(name, path, size, src, projectPath = '', fresh = false) {
  if (leaving.value) return
  if (busy.value) return
  const state = [sheetImage, sourceFile, activeProjectPath, legacySessionPath, exportedFileName, exportedResourceName, exportedHeaderName,
    frameWidth, frameHeight, anchorX, anchorY, spacingX, spacingY, bodyBox, hurtBox, characterName, spriteName, exportFileName,
    animations, selectedAnimationId, selectedFrame, savedSelection, dragRect, animationName, projectSaveStatus, captureMode]
  const previous = state.map(item => item.value)
  const previousRestoring = restoringProject.value
  const previousBackup = migrationBackup
  busy.value = true
  stopPlayback()
  try {
    // Decode before replacing the current project, so an unreadable image loses no work.
    const image = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Não foi possível abrir esta folha de sprites.'))
      image.src = src
    })
    restoringProject.value = true
    sheetImage.value = markRaw(image)
    sourceFile.value = { name, path, size }
    activeProjectPath.value = projectPath
    legacySessionPath.value = ''
    exportedFileName.value = ''
    exportedResourceName.value = ''
    exportedHeaderName.value = ''
    migrationBackup = null
    frameWidth.value = 32; frameHeight.value = 48
    anchorX.value = 16; anchorY.value = 48
    spacingX.value = 0; spacingY.value = 0
    bodyBox.value = { x: -8, y: -32, width: 16, height: 32 }
    hurtBox.value = { custom: false, ...bodyBox.value }
    characterName.value = normalizeName(name.replace(/\.[^.]+$/, ''))
    spriteName.value = `SPR_${characterName.value.toUpperCase()}`
    exportFileName.value = `${characterName.value}_sprites.png`
    animations.value = []
    selectedAnimationId.value = ''
    selectedFrame.value = 0
    savedSelection.value = null
    dragRect.value = null
    captureMode.value = 'grid'; markingAnchor.value = false
    animationName.value = 'idle'
    if (path) recentFiles.value = rememberRecentCharset(path, name)
    projectSaveStatus.value = 'Carregando projeto…'
    const restored = fresh ? false : await restoreCharsetProject()
    if (fresh) applyUniqueCharacterName(characterName.value)
    await nextTick()
    restoringProject.value = false
    resetHistory()
    projectSaveStatus.value = restored ? 'Projeto restaurado' : 'Novo projeto'
    if (!await saveCharsetProject()) throw new Error('Não foi possível salvar o personagem.')
    await refreshCharacterLibrary()
  } catch (error) {
    window.retroStudioToast?.error?.(error.message)
    // Roll back in memory; keep the previous character and the invalid file untouched.
    restoringProject.value = true
    state.forEach((item, index) => { item.value = previous[index] })
    migrationBackup = previousBackup
    await nextTick()
    restoringProject.value = previousRestoring
    resetHistory()
  } finally {
    busy.value = false
  }
}

async function openRecentCharset(item) {
  if (busy.value || exporting.value || !await flushCharsetProjectSave()) return
  recentMenu.value.open = false
  const result = await window.retroStudio?.retro?.readImageFile?.(item.path)
  if (!result?.success) {
    recentFiles.value = forgetRecentCharset(item.path)
    window.retroStudioToast?.error?.(result?.error || `Não foi possível abrir ${item.name}.`)
    return
  }
  await refreshCharacterLibrary()
  const existing = characterLibrary.value.find(entry => samePortablePath(props.projectPath, entry.data.source?.path, item.path))
  await loadSheetImage(result.name || item.name, item.path, result.size, `data:${result.mime};base64,${result.base64}`, existing?.path || '')
}

function removeRecentCharset(path) {
  recentFiles.value = forgetRecentCharset(path)
}

function getCharsetProjectFilePath() {
  if (activeProjectPath.value) return activeProjectPath.value
  const sourcePath = sourceFile.value?.path
  if (!sourcePath || !props.projectPath) return ''
  const normalizedPath = sourcePath.replace(/\\/g, '/')
  let hash = 2166136261
  for (let index = 0; index < normalizedPath.length; index++) hash = Math.imul(hash ^ normalizedPath.charCodeAt(index), 16777619)
  const sourceStem = normalizeName(sourceFile.value.name.replace(/\.[^.]+$/, ''))
  const fileName = `${sourceStem}_${(hash >>> 0).toString(16)}.charset.json`
  return `${props.projectPath}/charsets/${fileName}`.replace(/\\/g, '/')
}

function getLegacyCharsetProjectFilePath() {
  const sourcePath = sourceFile.value?.path
  if (!sourcePath || !props.projectPath) return ''
  const normalizedPath = sourcePath.replace(/\\/g, '/')
  let hash = 2166136261
  for (let index = 0; index < normalizedPath.length; index++) hash = Math.imul(hash ^ normalizedPath.charCodeAt(index), 16777619)
  const sourceStem = normalizeName(sourceFile.value.name.replace(/\.[^.]+$/, ''))
  const fileName = `${sourceStem}_${(hash >>> 0).toString(16)}.charset.json`
  return `${props.projectPath}/res/charsets/${fileName}`.replace(/\\/g, '/')
}

function createCharsetProjectData() {
  return {
    format: 'retro-studio-charset-project',
    version: 6,
    source: { path: toPortablePath(props.projectPath, sourceFile.value?.path || ''), name: sourceFileName.value },
    characterName: characterName.value,
    spriteName: spriteName.value,
    exportFileName: exportFileName.value,
    exportedFileName: exportedFileName.value,
    exportedResourceName: exportedResourceName.value,
    exportedHeaderName: exportedHeaderName.value,
    frameWidth: exportFrameWidth.value,
    frameHeight: exportFrameHeight.value,
    cropWidth: Number(frameWidth.value),
    cropHeight: Number(frameHeight.value),
    anchorX: Number(anchorX.value),
    anchorY: Number(anchorY.value),
    exportAnchor: { x: exportLayout.value.anchorX, y: exportLayout.value.anchorY },
    bodyBox: { ...bodyBox.value },
    hurtBox: { ...hurtBox.value },
    spacingX: Number(spacingX.value),
    spacingY: Number(spacingY.value),
    captureMode: captureMode.value,
    animations: animations.value,
    selectedAnimationId: selectedAnimationId.value,
    selectedFrame: selectedFrame.value,
    activeSelection: savedSelection.value
  }
}

async function restoreCharsetProject() {
  const projectFilePath = getCharsetProjectFilePath()
  if (!projectFilePath || !window.retroStudio?.readTextFileOptional) return false
  let raw = await window.retroStudio.readTextFileOptional(projectFilePath)
  if (!raw && !activeProjectPath.value) {
    const legacyPath = getLegacyCharsetProjectFilePath()
    raw = await window.retroStudio.readTextFileOptional(legacyPath)
    if (raw) legacySessionPath.value = legacyPath
  }
  if (!raw && !activeProjectPath.value) {
    const legacyPath = `${props.projectPath}/res/${normalizeName(sourceFileName.value.replace(/\.[^.]+$/, ''))}.charset.json`.replace(/\\/g, '/')
    raw = await window.retroStudio.readTextFileOptional(legacyPath)
  }
  if (!raw) {
    if (activeProjectPath.value) throw new Error('Projeto de personagem não encontrado.')
    return false
  }
  try {
    const data = JSON.parse(raw)
    applyCharsetProjectData(data)
    if (!data.version || data.version < 6) migrationBackup = { path: projectFilePath, raw, version: data.version || 1 }
    return true
  } catch (error) {
    throw new Error(`Projeto de personagem inválido: ${error.message}`)
  }
}

// Leva um documento (lido do disco ou um passo do histórico) para o estado do editor.
function applyCharsetProjectData(data) {
  {
    if (data.version > 6) throw new Error('Versão de projeto mais recente que este editor.')
    const sourcePath = data.source?.path
    const sourceName = typeof data.source === 'string' ? data.source : data.source?.name
    if (sourcePath && !samePortablePath(props.projectPath, sourcePath, sourceFile.value.path)) throw new Error('A folha não corresponde ao projeto salvo.')
    if (sourceName && sourceName !== sourceFileName.value) throw new Error('O nome da folha não corresponde ao projeto salvo.')
    const validDimension = (value, fallback) => {
      const dimension = Math.round(Number(value))
      return Number.isFinite(dimension) ? Math.max(1, Math.min(248, dimension)) : fallback
    }
    frameWidth.value = validDimension(data.cropWidth ?? data.frameWidth, 32)
    frameHeight.value = validDimension(data.cropHeight ?? data.frameHeight, 48)
    anchorX.value = Number(data.anchorX ?? frameWidth.value / 2)
    anchorY.value = Number(data.anchorY ?? frameHeight.value)
    captureMode.value = data.captureMode === 'free' ? 'free' : 'grid'
    bodyBox.value = normalizeBox(data.bodyBox || { x: -8, y: -32, width: 16, height: 32 })
    hurtBox.value = { ...normalizeBox(data.hurtBox || bodyBox.value), custom: data.hurtBox?.custom === true }
    spacingX.value = Math.max(0, Math.min(128, Math.round(Number(data.spacingX) || 0)))
    spacingY.value = Math.max(0, Math.min(128, Math.round(Number(data.spacingY) || 0)))
    characterName.value = String(data.characterName || data.name || characterName.value).slice(0, 40)
    spriteName.value = String(data.spriteName || `SPR_${normalizeName(data.characterName || data.name || characterName.value).toUpperCase()}`).slice(0, 40)
    exportFileName.value = String(data.exportFileName || `${data.image?.replace(/\.png$/i, '') || characterName.value + '_sprites'}.png`).slice(0, 100)
    exportedFileName.value = String(Object.hasOwn(data, 'exportedFileName') ? data.exportedFileName : (data.exportFileName || '')).slice(0, 100)
    exportedResourceName.value = String(data.exportedResourceName || '').slice(0, 48)
    exportedHeaderName.value = String(data.exportedHeaderName || (exportedFileName.value ? `${normalizeName(data.characterName || data.name)}_animations.h` : ''))
    if (!Array.isArray(data.animations)) throw new Error('Lista de animações inválida.')
    const candidates = data.animations
    animations.value = candidates.flatMap((entry, index) => {
      const region = entry?.region
      const width = validDimension(entry?.frameWidth, frameWidth.value)
      const height = validDimension(entry?.frameHeight, frameHeight.value)
      if (!region || ![region.x, region.y, region.width, region.height].every(value => Number.isFinite(Number(value)))) throw new Error(`Recorte inválido: ${entry?.name || index}`)
      const normalizedRegion = {
        x: Math.max(0, Math.round(region.x)),
        y: Math.max(0, Math.round(region.y)),
        width: Math.max(1, Math.round(region.width)),
        height: Math.max(1, Math.round(region.height))
      }
      if (normalizedRegion.x + normalizedRegion.width > sheetImage.value.naturalWidth || normalizedRegion.y + normalizedRegion.height > sheetImage.value.naturalHeight) throw new Error(`Recorte fora da folha: ${entry.name}`)
      const clipSpacingX = Math.max(0, Math.min(128, Math.round(Number(entry.spacingX) || 0)))
      const clipSpacingY = Math.max(0, Math.min(128, Math.round(Number(entry.spacingY) || 0)))
      const grid = getCharsetFrameGrid(normalizedRegion, width, height, clipSpacingX, clipSpacingY)
      const frames = Array.isArray(entry.frames) ? entry.frames.map(frame => {
        if (![frame.x, frame.y, frame.width, frame.height].every(value => Number.isInteger(value)) ||
          frame.x < 0 || frame.y < 0 || frame.width < 1 || frame.height < 1 || frame.width > 248 || frame.height > 248 ||
          frame.x + frame.width > sheetImage.value.naturalWidth || frame.y + frame.height > sheetImage.value.naturalHeight)
          throw new Error(`Quadro livre inválido: ${entry.name}`)
        const anchor = charsetFrameAnchor(frame)
        return { ...frame, anchorX: anchor.x, anchorY: anchor.y,
          ...(frame.durationTicks == null ? {} : { durationTicks: Math.max(1, Math.min(255, Math.round(Number(frame.durationTicks) || 1))) }) }
      }) : null
      const count = frames ? frames.length : grid.count
      if (!count || count > SGDK_SPRITE_FRAME_LIMIT) throw new Error(`Quantidade de quadros inválida: ${entry.name}`)
      return [{
        ...entry,
        id: String(entry.id || `restored-${index}`),
        name: String(entry.name || `animacao_${index + 1}`).slice(0, 40),
        region: normalizedRegion,
        columns: grid.columns,
        rows: grid.rows,
        frameCount: count,
        ...(frames ? { frames } : {}),
        frameWidth: width,
        frameHeight: height,
        ...(() => { const a = charsetAnchor({ ...entry, frameWidth: width, frameHeight: height }); return { anchorX: a.x, anchorY: a.y } })(),
        attack: normalizeAttack(entry.attack, count),
        controller: normalizeCharacterController(entry.controller),
        spacingX: clipSpacingX,
        spacingY: clipSpacingY,
        fps: Math.max(1, Math.min(60, Math.round(Number(entry.fps) || 8))),
        loop: entry.loop !== false
      }]
    })
    validateCharacterControllers(animations.value)
    const selected = animations.value.find(animation => animation.id === data.selectedAnimationId) || animations.value[0]
    selectedAnimationId.value = selected?.id || ''
    selectedFrame.value = selected ? Math.max(0, Math.min(selected.frameCount - 1, Math.round(Number(data.selectedFrame) || 0))) : 0
    savedSelection.value = data.activeSelection || (selected ? { ...selected.region } : null)
    animationName.value = selected ? `${selected.name}_2` : 'idle'
  }
}

// #52: desfazer/refazer do personagem aberto. Cada passo é o documento inteiro (recortes, ordem
// e tempos dos quadros, caixas, propriedades, movimentos removidos). A seleção não cria passo.
// Carregar, trocar de personagem ou falhar ao abrir começa um histórico novo; salvar não o altera.
function syncHistory() { canUndo.value = documentHistory.canUndo(); canRedo.value = documentHistory.canRedo() }
function resetHistory() { if (sourceFile.value?.path) documentHistory.reset(createCharsetProjectData()); syncHistory() }
function recordHistory() {
  if (applyingHistory || restoringProject.value || exporting.value || !sourceFile.value?.path || !sheetImage.value) return
  // Mudança de estrutura (movimento ou quadro criado/removido/reordenado) é sempre um passo próprio,
  // mesmo logo depois de digitar em um campo.
  const shape = animations.value.map(animation => animation.id + ':' + animation.frameCount + ':' + (animation.frames || []).map(frame => frame.id || frame.x + ',' + frame.y).join('|')).join(';')
  documentHistory.record(createCharsetProjectData(), { merge: shape === historyShape }); historyShape = shape; syncHistory()
}
async function applyHistory(step) {
  const data = step === 'undo' ? documentHistory.undo() : documentHistory.redo()
  if (!data) return false
  applyingHistory = true
  // O que já foi exportado não volta atrás com o desfazer: os arquivos exportados continuam
  // pertencendo a este personagem (senão a próxima exportação seria recusada como "de outro").
  Object.assign(data, { exportedFileName: exportedFileName.value, exportedResourceName: exportedResourceName.value, exportedHeaderName: exportedHeaderName.value })
  try { stopPlayback(); stopBehaviorPreview(); dragOrigin.value = null; dragRect.value = null; draggedFrame.value = null; applyCharsetProjectData(data) }
  catch (error) { window.retroStudioToast?.error?.(`Não foi possível ${step === 'undo' ? 'desfazer' : 'refazer'}: ${error.message}`) }
  await nextTick()
  applyingHistory = false
  syncHistory()
  scheduleCharsetProjectSave() // o estado restaurado é gravado como qualquer edição; gravar não cria passo
  return true
}
function historyBlocked() { return busy.value || exporting.value || leaving.value || restoringProject.value || !sheetImage.value || !!dragOrigin.value || draggedFrame.value !== null }
function undo() { return historyBlocked() ? false : applyHistory('undo') }
function redo() { return historyBlocked() ? false : applyHistory('redo') }
function onHistoryKey(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  const key = String(event.key || '').toLowerCase()
  if (key !== 'z' && key !== 'y') return
  // Campos de texto mantêm o desfazer do próprio campo.
  const target = event.target, tag = String(target?.tagName || '').toLowerCase()
  if (tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'range', 'color', 'button', 'number'].includes(String(target.type || 'text').toLowerCase()))) return
  event.preventDefault()
  void (key === 'y' || event.shiftKey ? redo() : undo())
}

function scheduleCharsetProjectSave() {
  preparedForLeave = false
  if (exporting.value || restoringProject.value || !sourceFile.value?.path || !props.projectPath) return
  clearTimeout(projectSaveTimer)
  projectSaveStatus.value = 'Salvando…'
  projectSaveTimer = setTimeout(() => { void saveCharsetProject() }, 350)
}

async function saveCharsetProject() {
  clearTimeout(projectSaveTimer)
  projectSaveTimer = null
  const projectFilePath = getCharsetProjectFilePath()
  if (restoringProject.value || !projectFilePath || !window.retroStudio?.writeTextFile) return false
  try {
    validateCharacterControllers(animations.value)
    const contents = `${JSON.stringify(createCharsetProjectData(), null, 2)}\n`
    const backup = migrationBackup
    const pending = saveQueue.then(async () => {
      if (backup && !await window.retroStudio.readTextFileOptional(`${backup.path}.v${backup.version}.bak`))
        await window.retroStudio.writeTextFile(`${backup.path}.v${backup.version}.bak`, backup.raw)
      await window.retroStudio.writeTextFile(projectFilePath, contents)
    })
    saveQueue = pending.catch(() => {})
    await pending
    if (migrationBackup === backup) migrationBackup = null
    upsertLibraryEntry(projectFilePath, JSON.parse(contents))
    projectSaveStatus.value = 'Projeto salvo'
    return true
  } catch (error) {
    projectSaveStatus.value = 'Falha ao salvar'
    console.warn('[CharsetMaker] falha ao salvar projeto:', error)
    return false
  }
}

async function flushCharsetProjectSave() {
  clearTimeout(projectSaveTimer)
  projectSaveTimer = null
  if (!sourceFile.value || restoringProject.value) return true
  const saved = await saveCharsetProject()
  if (!saved) window.retroStudioToast?.error?.('Não foi possível salvar. O personagem atual foi mantido.')
  return saved
}

watch([characterName, spriteName, exportFileName, frameWidth, frameHeight, spacingX, spacingY, anchorX, anchorY, captureMode, bodyBox, hurtBox, animations, selectedAnimationId, savedSelection], () => { recordHistory(); scheduleCharsetProjectSave() }, { deep: true })

async function onSheetWheel(event) {
  const viewport = sheetViewport.value
  if (!viewport) return
  if (event.ctrlKey || event.metaKey) {
    if (!sheetImage.value || !sheetCanvas.value) return
    event.preventDefault()
    const oldZoom = zoom.value
    const nextZoom = Math.max(0.2, Math.min(6, oldZoom * Math.exp(-event.deltaY * 0.0015)))
    if (nextZoom === oldZoom) return
    const viewportRect = viewport.getBoundingClientRect()
    const canvasRect = sheetCanvas.value.getBoundingClientRect()
    const oldScrollLeft = viewport.scrollLeft
    const oldScrollTop = viewport.scrollTop
    const pointerX = event.clientX - viewportRect.left
    const pointerY = event.clientY - viewportRect.top
    const imageX = (event.clientX - canvasRect.left) * sheetImage.value.naturalWidth / canvasRect.width
    const imageY = (event.clientY - canvasRect.top) * sheetImage.value.naturalHeight / canvasRect.height
    zoom.value = nextZoom
    await nextTick()
    const nextRect = sheetCanvas.value?.getBoundingClientRect()
    if (!nextRect) return
    const scaleX = nextRect.width / sheetImage.value.naturalWidth
    const scaleY = nextRect.height / sheetImage.value.naturalHeight
    viewport.scrollLeft = oldScrollLeft + (nextRect.left - viewportRect.left + oldScrollLeft + imageX * scaleX - oldScrollLeft - pointerX)
    viewport.scrollTop = oldScrollTop + (nextRect.top - viewportRect.top + oldScrollTop + imageY * scaleY - oldScrollTop - pointerY)
  } else if (event.shiftKey || event.altKey) {
    event.preventDefault()
    viewport.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  }
}


function editSelection(key, event) {
  if (!sheetImage.value) return
  const region = { ...(savedSelection.value || { x: 0, y: 0, width: frameWidth.value, height: frameHeight.value }) }
  region[key] = Math.round(Number(event.target.value) || 0)
  region.x = Math.max(0, Math.min(sheetImage.value.naturalWidth - 1, region.x))
  region.y = Math.max(0, Math.min(sheetImage.value.naturalHeight - 1, region.y))
  region.width = Math.max(1, Math.min(sheetImage.value.naturalWidth - region.x, region.width))
  region.height = Math.max(1, Math.min(sheetImage.value.naturalHeight - region.y, region.height))
  savedSelection.value = region
  if (captureMode.value === 'free') {
    frameWidth.value = Math.min(248, region.width); frameHeight.value = Math.min(248, region.height)
    anchorX.value = Math.min(anchorX.value, frameWidth.value); anchorY.value = Math.min(anchorY.value, frameHeight.value)
  }
}

function freshSelection() {
  stopPlayback()
  savedSelection.value = null; dragRect.value = null
  dragOrigin.value = null
}

function selectManualFrame(index) {
  const animation = selectedAnimation.value
  if (!animation?.frames?.[index]) return
  stopPlayback()
  selectedFrame.value = index
  const frame = animation.frames[index]
  savedSelection.value = { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
  frameWidth.value = frame.width; frameHeight.value = frame.height
  anchorX.value = frame.anchorX; anchorY.value = frame.anchorY
  captureMode.value = 'free'
}

function syncManualAnimation(animation) {
  const frames = animation.frames
  animation.frameCount = frames.length
  animation.frameWidth = Math.max(...frames.map(frame => frame.width))
  animation.frameHeight = Math.max(...frames.map(frame => frame.height))
  animation.region = { x: frames[0].x, y: frames[0].y, width: frames[0].width, height: frames[0].height }
  animation.columns = frames.length; animation.rows = 1
  animation.attack = normalizeAttack(animation.attack, frames.length)
}

function draftFrame() {
  const region = selectionRect.value
  if (!region || region.width > 248 || region.height > 248) return null
  const anchor = charsetFrameAnchor({ ...region, anchorX: anchorX.value, anchorY: anchorY.value })
  return { ...region, anchorX: anchor.x, anchorY: anchor.y }
}

function addManualFrame() {
  const frame = draftFrame()
  if (!frame) return
  let animation = selectedAnimation.value
  if (!animation) {
    const name = animationName.value.trim()
    if (!name || animations.value.some(item => item.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_') === name.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))) {
      window.retroStudioToast?.error?.('Escolha um nome exclusivo para a animação.')
      return
    }
    animation = { id: `anim-${crypto.randomUUID()}`, name, frames: [], frameCount: 0, fps: 8, loop: true, spacingX: 0, spacingY: 0, anchorX: frame.anchorX, anchorY: frame.anchorY }
    animations.value.push(animation)
    selectedAnimationId.value = animation.id
    animation = selectedAnimation.value
  }
  const frames = charsetFrames(animation)
  // A newly created animation has no region yet.
  if (frames.length >= SGDK_SPRITE_FRAME_LIMIT) return
  animation.frames = [...frames, frame]
  syncManualAnimation(animation)
  selectManualFrame(animation.frames.length - 1)
}

function replaceManualFrame() {
  stopPlayback()
  const animation = selectedAnimation.value
  const frame = draftFrame()
  if (!animation?.frames || !frame) return
  animation.frames[selectedFrame.value] = { ...animation.frames[selectedFrame.value], ...frame }
  syncManualAnimation(animation)
}

function removeManualFrame() {
  const animation = selectedAnimation.value
  if (!animation?.frames || animation.frames.length <= 1) return
  remapCharacterEvents(animation, frame => frame === selectedFrame.value ? null : frame > selectedFrame.value ? frame - 1 : frame)
  animation.frames.splice(selectedFrame.value, 1)
  syncManualAnimation(animation)
  selectManualFrame(Math.min(selectedFrame.value, animation.frames.length - 1))
}

function moveManualFrame(delta) {
  stopPlayback()
  const animation = selectedAnimation.value
  const index = selectedFrame.value, next = index + delta
  if (!animation?.frames || next < 0 || next >= animation.frames.length) return
  remapCharacterEvents(animation, frame => frame === index ? next : frame === next ? index : frame)
  ;[animation.frames[index], animation.frames[next]] = [animation.frames[next], animation.frames[index]]
  selectManualFrame(next)
}



function timelineFrameStyle(frame) {
  const sx = Math.min(52 / frame.width, 52 / frame.height)
  return {
    width: `${frame.width * sx}px`, height: `${frame.height * sx}px`,
    '--sheet-width': `${sheetImage.value?.naturalWidth * sx}px`,
    '--sheet-height': `${sheetImage.value?.naturalHeight * sx}px`,
    '--source-x': `-${frame.x * sx}px`, '--source-y': `-${frame.y * sx}px`
  }
}

function selectTimelineFrame(index) {
  stopPlayback()
  if (selectedAnimation.value?.frames) selectManualFrame(index)
  else selectedFrame.value = index
}

function ensureEditableFrames() {
  const animation = selectedAnimation.value
  if (!animation) return null
  if (!animation.frames) {
    animation.frames = charsetFrames(animation).map(frame => ({ ...frame }))
    syncManualAnimation(animation)
    captureMode.value = 'free'
  }
  return animation
}

function setFrameTicks(event) {
  const animation = ensureEditableFrames()
  if (!animation) return
  stopPlayback()
  animation.frames[selectedFrame.value].durationTicks = Math.max(1, Math.min(255, Math.round(Number(event.target.value) || 1)))
}

function resetFrameTicks() {
  const animation = selectedAnimation.value
  if (animation?.frames) delete animation.frames[selectedFrame.value].durationTicks
}

function duplicateTimelineFrame() {
  stopPlayback()
  const animation = ensureEditableFrames()
  if (!animation || animation.frames.length >= SGDK_SPRITE_FRAME_LIMIT) return
  remapCharacterEvents(animation, frame => frame > selectedFrame.value ? frame + 1 : frame)
  animation.frames.splice(selectedFrame.value + 1, 0, { ...animation.frames[selectedFrame.value] })
  syncManualAnimation(animation)
  selectManualFrame(selectedFrame.value + 1)
}

function removeTimelineFrame() {
  ensureEditableFrames()
  removeManualFrame()
}

function moveTimelineFrame(delta) {
  ensureEditableFrames()
  moveManualFrame(delta)
}

function dragTimelineFrame(event, index) {
  stopPlayback()
  draggedFrame.value = index
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
}

function dropTimelineFrame(index) {
  const from = draggedFrame.value
  draggedFrame.value = null
  if (from == null || from === index) return
  const animation = ensureEditableFrames()
  if (!animation || from < 0 || from >= animation.frames.length) return
  remapCharacterEvents(animation, frame => frame === from ? index : from < index && frame > from && frame <= index ? frame - 1 : from > index && frame >= index && frame < from ? frame + 1 : frame)
  const [frame] = animation.frames.splice(from, 1)
  animation.frames.splice(index, 0, frame)
  syncManualAnimation(animation)
  selectManualFrame(index)
}

function renameAnimation(event) {
  const animation = selectedAnimation.value
  if (!animation) return
  const name = String(event.target.value || '').trim().slice(0, 40)
  const id = name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (!name || animations.value.some(a => a.id !== animation.id && a.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_') === id)) {
    event.target.value = animation.name
    window.retroStudioToast?.error?.('Escolha um nome exclusivo para esta animação.')
    return
  }
  animation.name = name
}

function duplicateAnimation() {
  const original = selectedAnimation.value
  if (!original) return
  let name = original.name + '_2', n = 2
  const exists = value => animations.value.some(a => a.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_') === value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
  while (exists(name)) name = original.name.slice(0, 30) + '_' + ++n
  const copy = { ...JSON.parse(JSON.stringify(original)), id: `anim-${crypto.randomUUID()}`, name }
  animations.value.splice(animations.value.indexOf(original) + 1, 0, copy)
  selectAnimation(copy)
}

function moveAnimation(delta) {
  const index = animations.value.findIndex(a => a.id === selectedAnimationId.value)
  const target = index + delta
  if (index < 0 || target < 0 || target >= animations.value.length) return
  const [animation] = animations.value.splice(index, 1)
  animations.value.splice(target, 0, animation)
}


function beginNewAnimation() {
  inspectorTab.value = 'crop'
  void nextTick(() => { if (inspectorContent.value) inspectorContent.value.scrollTop = 0 })
  stopPlayback()
  selectedAnimationId.value = ''
  selectedFrame.value = 0
  animationName.value = ''
  freshSelection()
}

function setAnchorFromPreview(event) {
  if (!markingAnchor.value || !selectedAnimation.value) return
  const animation = selectedAnimation.value
  const frame = charsetFrames(animation)[selectedFrame.value]
  const anchor = charsetFrameAnchor(frame)
  const bounds = previewCanvas.value.getBoundingClientRect()
  const rawX = (event.clientX - bounds.left) * exportFrameWidth.value / bounds.width
  const pointX = previewFlip.value ? exportFrameWidth.value - rawX : rawX
  const pointY = (event.clientY - bounds.top) * exportFrameHeight.value / bounds.height
  const nextAnchor = charsetFrameAnchor({
    ...frame,
    anchorX: pointX - (exportLayout.value.anchorX - anchor.x),
    anchorY: pointY - (exportLayout.value.anchorY - anchor.y)
  })
  if (animation.frames) Object.assign(animation.frames[selectedFrame.value], { anchorX: nextAnchor.x, anchorY: nextAnchor.y })
  else Object.assign(animation, { anchorX: nextAnchor.x, anchorY: nextAnchor.y })
  anchorX.value = nextAnchor.x; anchorY.value = nextAnchor.y
  markingAnchor.value = false
}


function pointOnSheet(event) {
  if (!sheetCanvas.value || !sheetImage.value) return null
  const bounds = sheetCanvas.value.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(sheetImage.value.naturalWidth, Math.round((event.clientX - bounds.left) * sheetImage.value.naturalWidth / bounds.width))),
    y: Math.max(0, Math.min(sheetImage.value.naturalHeight, Math.round((event.clientY - bounds.top) * sheetImage.value.naturalHeight / bounds.height)))
  }
}

function startSelection(event) {
  if (event.button !== 0) return
  const point = pointOnSheet(event)
  if (!point) return
  event.preventDefault()
  event.currentTarget.setPointerCapture(event.pointerId)
  dragOrigin.value = point
  const current = savedSelection.value
  if (current && point.x >= current.x && point.x <= current.x + current.width && point.y >= current.y && point.y <= current.y + current.height) {
    dragMode.value = 'move'
    dragRect.value = { ...current }
  } else {
    dragMode.value = 'new'
    savedSelection.value = null
    dragRect.value = { x: point.x, y: point.y, width: 1, height: 1 }
  }
}

function moveSelection(event) {
  if (!dragOrigin.value) return
  const point = pointOnSheet(event)
  if (!point) return
  if (dragMode.value === 'move') {
    const region = savedSelection.value
    const x = Math.max(0, Math.min(sheetImage.value.naturalWidth - region.width, region.x + point.x - dragOrigin.value.x))
    const y = Math.max(0, Math.min(sheetImage.value.naturalHeight - region.height, region.y + point.y - dragOrigin.value.y))
    dragRect.value = { ...region, x, y }
    return
  }
  const x = Math.min(point.x, dragOrigin.value.x)
  const y = Math.min(point.y, dragOrigin.value.y)
  dragRect.value = { x, y, width: Math.max(1, Math.abs(point.x - dragOrigin.value.x)), height: Math.max(1, Math.abs(point.y - dragOrigin.value.y)) }
}

function finishSelection() {
  if (!dragOrigin.value) return
  savedSelection.value = dragRect.value
  dragRect.value = null
  dragOrigin.value = null
  dragMode.value = 'new'
  if (captureMode.value === 'free' && savedSelection.value) {
    frameWidth.value = Math.min(248, savedSelection.value.width)
    frameHeight.value = Math.min(248, savedSelection.value.height)
    anchorX.value = Math.floor(frameWidth.value / 2); anchorY.value = frameHeight.value
  }
}

function addAnimation() {
  normalizeGeometry()
  const region = selectionRect.value
  const grid = region && getCharsetFrameGrid(region, frameWidth.value, frameHeight.value, spacingX.value, spacingY.value)
  if (!grid?.count || grid.count > SGDK_SPRITE_FRAME_LIMIT) return
  const name = animationName.value.trim()
  if (!name) return
  if (animations.value.some(animation => animation.name.toLowerCase() === name.toLowerCase())) {
    window.retroStudioToast?.error?.('Já existe uma animação com esse nome.')
    return
  }
  const animationId = name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (animations.value.some(animation => animation.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_') === animationId)) {
    window.retroStudioToast?.error?.('Este nome gera o mesmo identificador C de outra animação.')
    return
  }
  const animation = {
    id: `anim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    region: { ...region },
    columns: grid.columns,
    rows: grid.rows,
    frameCount: grid.count,
    frameWidth: Number(frameWidth.value),
    frameHeight: Number(frameHeight.value),
    spacingX: Number(spacingX.value),
    spacingY: Number(spacingY.value),
    anchorX: Number(anchorX.value),
    anchorY: Number(anchorY.value),
    attack: normalizeAttack(null, grid.count),
    fps: 8,
    loop: true
  }
  animations.value = [...animations.value, animation]
  selectAnimation(animation)
  animationName.value = ''
}

function selectAnimation(animation) {
  if (inspectorTab.value !== 'behavior') inspectorTab.value = 'crop'
  void nextTick(() => { if (inspectorContent.value) inspectorContent.value.scrollTop = 0 })
  stopPlayback()
  selectedAnimationId.value = animation.id
  selectedFrame.value = 0
  frameWidth.value = animation.frameWidth
  frameHeight.value = animation.frameHeight
  spacingX.value = animation.spacingX
  spacingY.value = animation.spacingY
  const anchor = charsetAnchor(animation)
  anchorX.value = anchor.x; anchorY.value = anchor.y
  captureMode.value = animation.frames ? 'free' : 'grid'
  if (animation.frames) selectManualFrame(0)
  else savedSelection.value = { ...animation.region }
  animationName.value = `${animation.name}_2`
}

function removeAnimation(id) {
  stopPlayback()
  animations.value.forEach(animation => { if (animation.controller) animation.controller.transitions = animation.controller.transitions.filter(t => t.target !== id) })
  animations.value = animations.value.filter(animation => animation.id !== id)
  if (selectedAnimationId.value === id) {
    if (animations.value[0]) selectAnimation(animations.value[0])
    else { selectedAnimationId.value = ''; selectedFrame.value = 0; savedSelection.value = null }
  }
}

function getFrameSource(animation, frameIndex) {
  const frame = charsetFrames(animation)[frameIndex]
  return { sx: frame.x, sy: frame.y, sw: frame.width, sh: frame.height }
}

function drawPreviewFrame() {
  const canvas = previewCanvas.value
  const animation = selectedAnimation.value
  if (!canvas || !animation || !sheetImage.value) return
  canvas.width = exportFrameWidth.value
  canvas.height = exportFrameHeight.value
  const source = getFrameSource(animation, Math.min(selectedFrame.value, animation.frameCount - 1))
  const ctx = canvas.getContext('2d')
  const anchor = charsetFrameAnchor(charsetFrames(animation)[selectedFrame.value])
  const layout = exportLayout.value
  ctx.drawImage(sheetImage.value, source.sx, source.sy, source.sw, source.sh, layout.anchorX - anchor.x, layout.anchorY - anchor.y, source.sw, source.sh)
  ctx.strokeStyle = '#70d9bf'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(layout.anchorX - 3, layout.anchorY - 1); ctx.lineTo(layout.anchorX + 3, layout.anchorY - 1); ctx.stroke()
  ctx.strokeRect(layout.anchorX + bodyBox.value.x + 0.5, layout.anchorY + bodyBox.value.y + 0.5, bodyBox.value.width, bodyBox.value.height)
  if (hurtBox.value.custom) {
    ctx.save(); ctx.strokeStyle = '#c7a1ff'; ctx.setLineDash([3, 2])
    ctx.strokeRect(layout.anchorX + hurtBox.value.x + 0.5, layout.anchorY + hurtBox.value.y + 0.5, hurtBox.value.width, hurtBox.value.height)
    ctx.restore()
  }
  const attack = animation.attack
  if (attack?.enabled && selectedFrame.value >= attack.firstFrame && selectedFrame.value <= attack.lastFrame) {
    ctx.strokeStyle = '#ffab62'
    ctx.strokeRect(layout.anchorX + attack.x + 0.5, layout.anchorY + attack.y + 0.5, attack.width, attack.height)
  }
}

function stepFrame(delta) {
  const animation = selectedAnimation.value
  if (!animation) return
  selectedFrame.value = (selectedFrame.value + delta + animation.frameCount) % animation.frameCount
}

function togglePlayback() {
  stopBehaviorPreview()
  if (reducedMotion.value) return
  if (!isPlaying.value && selectedAnimation.value && selectedFrame.value >= selectedAnimation.value.frameCount - 1) selectedFrame.value = 0
  isPlaying.value = !isPlaying.value
}

function stopPlayback() {
  stopBehaviorPreview()
  isPlaying.value = false
  if (playbackTimer) clearInterval(playbackTimer)
  playbackTimer = null
}

function startPlaybackTimer() {
  if (playbackTimer) clearTimeout(playbackTimer)
  playbackTimer = null
  if (!props.active || !isPlaying.value || reducedMotion.value || !selectedAnimation.value) return
  playbackTimer = setTimeout(() => {
    const animation = selectedAnimation.value
    if (!animation) return stopPlayback()
    if (selectedFrame.value >= animation.frameCount - 1 && !animation.loop) return stopPlayback()
    selectedFrame.value = (selectedFrame.value + 1) % animation.frameCount
    startPlaybackTimer()
  }, charsetFrameTicks(selectedAnimation.value, selectedFrame.value) * 1000 / previewHz.value)
}

function clampFps(animation) {
  animation.fps = Math.max(1, Math.min(60, Math.round(Number(animation.fps) || 8)))
  if (isPlaying.value) startPlaybackTimer()
}

function createAtlas() {
  const maxFrames = Math.max(...animations.value.map(animation => animation.frameCount))
  const width = maxFrames * exportFrameWidth.value
  const height = animations.value.length * exportFrameHeight.value
  if (width > 16384 || height > 16384 || width * height > 16777216)
    throw new Error('Atlas muito grande. Divida as animações entre personagens ou reduza os recortes.')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  animations.value.forEach((animation, animationIndex) => {
    for (let frame = 0; frame < animation.frameCount; frame++) {
      const src = getFrameSource(animation, frame)
      const anchor = charsetFrameAnchor(charsetFrames(animation)[frame])
      ctx.drawImage(sheetImage.value, src.sx, src.sy, src.sw, src.sh,
        frame * exportFrameWidth.value + exportLayout.value.anchorX - anchor.x,
        animationIndex * exportFrameHeight.value + exportLayout.value.anchorY - anchor.y, src.sw, src.sh)
    }
  })
  return canvas
}

async function exportCharacter() {
  if (leaving.value || !canExport.value || exporting.value || busy.value || restoringProject.value) return
  exporting.value = true
  try {
    if (!await flushCharsetProjectSave()) return
    await refreshCharacterLibrary()
    if (libraryError.value) throw new Error(libraryError.value)
    const name = normalizeName(characterName.value)
    const resourceName = normalizeResourceName(spriteName.value)
    const imageName = normalizeExportFileName(exportFileName.value, `${name}_sprites`)
    // Diz qual nome bateu e em qual projeto, para dar para resolver sem adivinhar.
    const clash = item => normalizeName(item.data.characterName || item.name) === name || item.data.exportedHeaderName === `${name}_animations.h` ? `o nome de personagem "${name}"`
      : normalizeResourceName(item.data.spriteName) === resourceName || normalizeResourceName(item.data.exportedResourceName) === resourceName ? `o símbolo "${resourceName}"`
      : [item.data.exportFileName, item.data.exportedFileName].filter(Boolean).some(file => file.toLowerCase() === imageName.toLowerCase()) ? `o PNG "${imageName}"` : ''
    const other = characterLibrary.value.find(item => item.path !== getCharsetProjectFilePath() && clash(item))
    if (other) {
      const what = clash(other), file = String(other.path).split(/[\\/]/).pop()
      const fix = what.startsWith('o nome') ? 'Troque o nome no campo "Personagem", no topo desta tela' : what.startsWith('o símbolo') ? 'Troque o nome do sprite nas opções de exportação' : 'Troque o nome do arquivo PNG nas opções de exportação'
      throw new Error(`Não exportei: outro personagem deste projeto (${file}) já usa ${what}. ${fix}, e exporte de novo.`)
    }
    exportFileName.value = imageName
    if (!await saveCharsetProject()) throw new Error('Falha ao salvar o projeto antes da exportação.')
    if (!window.retroStudio?.readTextFileOptional) throw new Error('A leitura de arquivos do projeto não está disponível.')
    clearTimeout(projectSaveTimer)
    projectSaveTimer = null
    await saveQueue
    const projectFilePath = getCharsetProjectFilePath()
    const savedProjectRaw = projectFilePath ? await window.retroStudio.readTextFileOptional(projectFilePath) : null
    let savedProject = null
    try { savedProject = savedProjectRaw ? JSON.parse(savedProjectRaw) : null } catch {}
    const sameSource = samePortablePath(props.projectPath, savedProject?.source?.path, sourceFile.value?.path)
    const ownsOutputImage = sameSource && normalizeExportFileName(exportedFileName.value, '') === imageName
    const existingImage = await window.retroStudio?.retro?.getAssetPreview?.(props.projectPath, `${props.projectPath}/res/${imageName}`)
    if (existingImage?.success && !ownsOutputImage) throw new Error(`${imageName} já existe em res/ e não pertence a este projeto de charset. Escolha outro nome.`)
    const resourcesPath = `${props.projectPath}/res/resources.res`.replace(/\\/g, '/')
    const existingResourcesRaw = await window.retroStudio.readTextFileOptional(resourcesPath)
    const existingResources = existingResourcesRaw || ''
    const spriteEntryPattern = new RegExp(`^\\s*SPRITE\\s+${resourceName}\\b.*$`, 'mi')
    let resourcesForUpdate = existingResources
    const previousResourceName = normalizeResourceName(exportedResourceName.value)
    const previousImageName = normalizeExportFileName(exportedFileName.value, '')
    if (sameSource) {
      resourcesForUpdate = resourcesForUpdate.split(/\r?\n/).filter(line => {
        const entry = line.match(/^\s*SPRITE\s+([A-Z0-9_]+)\s+"([^"]+)"/i)
        if (!entry || entry[1].toUpperCase() === resourceName) return true
        return !(entry[1].toUpperCase() === previousResourceName || (previousImageName && entry[2] === previousImageName))
      }).join('\n')
    }
    const hasExistingSpriteEntry = spriteEntryPattern.test(resourcesForUpdate)
    if (hasExistingSpriteEntry) {
      const currentEntry = resourcesForUpdate.split(/\r?\n/).find(line => new RegExp(`^\\s*SPRITE\\s+${resourceName}\\b`, 'i').test(line))
      const currentEntryImage = currentEntry?.match(/^\s*SPRITE\s+[A-Z0-9_]+\s+"([^"]+)"/i)?.[1]
      const ownsCurrentEntry = sameSource && (previousResourceName === resourceName || (!!previousImageName && currentEntryImage === previousImageName))
      if (!ownsCurrentEntry) throw new Error(`${resourceName} já está declarado em res/resources.res. Escolha outro nome para o sprite.`)
    }

    const headerName = `${name}_animations.h`
    const headerPath = `${props.projectPath}/src/${headerName}`.replace(/\\/g, '/')
    const existingHeader = await window.retroStudio.readTextFileOptional(headerPath)
    if (existingHeader && exportedHeaderName.value !== headerName)
      throw new Error(`${headerName} já existe e não pertence a este personagem. Escolha outro nome.`)

    const atlas = createAtlas()
    const { blob, sourceColorCount, exportedColorCount } = await encodeSgdkIndexedPng(
      atlas.getContext('2d').getImageData(0, 0, atlas.width, atlas.height)
    )

    const resource = buildSgdkSpriteResource({ resourceName, imageName, frameWidth: exportFrameWidth.value, frameHeight: exportFrameHeight.value, animations: animations.value })
    const updatedResources = hasExistingSpriteEntry
      ? resourcesForUpdate.replace(spriteEntryPattern, resource)
      : `${resourcesForUpdate.trimEnd()}${resourcesForUpdate.trim() ? '\n' : ''}${resource}\n`
    if (!window.retroStudio.retro.exportCharacter) throw new Error('Reinicie a IDE para habilitar a exportação com recuperação.')
    const projectData = { ...createCharsetProjectData(), exportedResourceName: resourceName,
      exportedFileName: imageName, exportedHeaderName: headerName }
    const normalizedRoot = props.projectPath.replace(/\\/g, '/').replace(/\/$/, '')
    const normalizedProjectFile = projectFilePath.replace(/\\/g, '/')
    if (!normalizedProjectFile.startsWith(normalizedRoot + '/')) throw new Error('Projeto de personagem fora do workspace.')
    const exported = await window.retroStudio.retro.exportCharacter({
      projectPath: props.projectPath, characterName: name, imageName,
      projectFile: normalizedProjectFile.slice(normalizedRoot.length + 1),
      png: Array.from(new Uint8Array(await blob.arrayBuffer())),
      resources: updatedResources,
      header: buildSgdkAnimationHeader(name, animations.value).replace(/\n#endif\s*$/, `\n${charsetGeometryHeader(name, animations.value, bodyBox.value, hurtBox.value)}\n#endif\n`),
      characterProject: `${JSON.stringify(projectData, null, 2)}\n`,
      expectedResources: existingResourcesRaw ?? null,
      expectedHeader: existingHeader ?? null,
      expectedProject: savedProjectRaw ?? null
    })
    if (!exported?.success) throw new Error(exported?.error || 'Não foi possível publicar os recursos do personagem.')
    exportedResourceName.value = resourceName
    exportedFileName.value = imageName
    exportedHeaderName.value = headerName
    upsertLibraryEntry(projectFilePath, projectData)
    projectSaveStatus.value = 'Projeto salvo'
    const paletteMessage = sourceColorCount > exportedColorCount
      ? ` Paleta reduzida de ${sourceColorCount} para ${exportedColorCount} cores opacas.`
      : ` PNG indexado com ${exportedColorCount} cores opacas.`
    window.retroStudioToast?.success?.(`Charset exportado: ${resourceName} e ${animations.value.length} animações.${paletteMessage}`)
    emit('exported')
  } catch (error) {
    window.retroStudioToast?.error?.(error?.message || 'Falha ao exportar o personagem.')
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
/* #45: embutido no workspace, o editor usa o tema da IDE; como janela própria mantém as cores originais. */
.charset-backdrop.is-embedded,.animation-timeline.docked { --cm-accent:var(--accent,#68cbb2); --cm-muted:var(--muted,#9aabb7); --cm-text:var(--text,#dfe7ef); --cm-border:var(--border,#2d3c47); --cm-panel:var(--panel,#17242e); --cm-deep:var(--panel-2,#0c151c); }


.animation-timeline { display:grid; grid-template-columns:156px minmax(0,1fr); grid-template-rows:auto auto auto auto; gap:8px 12px; padding:12px; border-top:1px solid var(--border,#344651); background:var(--bg-secondary,#14212a); min-width:0; }
.timeline-preview { grid-row:1 / 5; display:flex; flex-direction:column; gap:6px; }
.animation-timeline.docked { border-top:0; height:100%; box-sizing:border-box; overflow:auto; color:var(--text,#e8f0f5); background:var(--panel,#20252a); }
.animation-timeline.docked .timeline-heading strong { color:var(--accent,#78dcc3); }
.animation-timeline.docked .timeline-frame.selected { border-color:var(--accent,#78dcc3); }
.timeline-preview .preview-stage { height:110px; }
.timeline-preview .frame-preview { max-height:104px; }
.timeline-preview label { font-size:11px; color:var(--text-secondary,#9aabb7); }
.timeline-heading { display:flex; align-items:center; flex-wrap:wrap; gap:8px; min-width:0; }
.timeline-heading strong { color:var(--cm-accent,#78dcc3); }
.timeline-heading span { color:var(--text-secondary,#9aabb7); font-size:11px; }
.timeline-heading label { margin-left:auto; color:var(--text-secondary,#9aabb7); font-size:11px; }
.timeline-strip { display:flex; gap:6px; min-width:0; overflow:auto; padding:2px 1px 7px; }
.timeline-frame { flex:0 0 74px; padding:4px; color:var(--text-secondary,#9aabb7); background:var(--input-bg,#0c151c); border:1px solid var(--border,#354654); border-radius:5px; cursor:grab; }
.timeline-frame.selected { border-color:var(--cm-accent,#68cbb2); color:var(--cm-accent,#78dcc3); background:#68cbb214; }
.timeline-frame:focus-visible { outline:2px solid var(--cm-accent,#70d9bf); outline-offset:1px; }
.timeline-thumbnail { display:flex; align-items:center; justify-content:center; height:56px; overflow:hidden; background-color:#17222b; background-image:linear-gradient(45deg,#23323b 25%,transparent 25%),linear-gradient(-45deg,#23323b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#23323b 75%),linear-gradient(-45deg,transparent 75%,#23323b 75%); background-size:12px 12px; background-position:0 0,0 6px,6px -6px,-6px 0; }
.timeline-crop { position:relative; display:block; overflow:hidden; }
.timeline-crop img { position:absolute; left:var(--source-x); top:var(--source-y); width:var(--sheet-width); height:var(--sheet-height); max-width:none; image-rendering:pixelated; pointer-events:none; }
.timeline-frame-info { display:flex; justify-content:space-between; align-items:center; gap:4px; margin-top:4px; }
.timeline-frame-info small { font:10px ui-monospace,monospace; }
.timeline-actions { display:flex; align-items:center; flex-wrap:wrap; gap:5px; }
.timeline-actions label { display:flex; align-items:center; gap:4px; color:var(--text-secondary,#9aabb7); font-size:11px; }
.timeline-actions input[type=number] { width:43px; padding:4px; }
.timeline-actions input, .timeline-heading select, .animation-edit input { color:var(--text,#dfe7ef); background:var(--input-bg,#0c151c); border:1px solid var(--border,#354654); border-radius:4px; }
.animation-edit label { display:flex; flex-direction:column; gap:5px; color:var(--text-secondary,#9aabb7); font-size:11px; }
.animation-edit input { padding:7px; }
.animation-timeline > .helper-text { margin:0; }
@media(max-width:680px) { .animation-timeline { grid-template-columns:100px minmax(0,1fr); padding:8px; gap:6px; } .timeline-actions { max-height:85px; overflow:auto; } }


.capture-mode-field { display:flex; flex-direction:column; gap:7px; margin:12px 0 0; }
.capture-mode-label { color:var(--text-secondary,#9aabb7); font-size:11px; }
.capture-mode-buttons { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
.capture-mode-buttons button { display:flex; align-items:center; justify-content:center; gap:7px; min-width:0; min-height:34px; padding:7px 6px; border:1px solid var(--border,#354654); border-radius:5px; background:var(--input-bg,#0c151c); color:var(--text-secondary,#9aabb7); font-family:inherit; font-size:11px; font-weight:500; line-height:1.3; cursor:pointer; }
.capture-mode-buttons button svg { width:16px; height:16px; flex:none; }
.capture-mode-buttons button span { white-space:nowrap; }
.capture-mode-buttons button:hover { color:var(--text,#dfe7ef); border-color:#607982; }
.capture-mode-buttons button.active { color:var(--cm-accent,#78dcc3); background:#68cbb218; border-color:var(--cm-accent,#68cbb2); }
.capture-mode-buttons button:focus-visible { outline:2px solid var(--cm-accent,#70d9bf); outline-offset:2px; }

.selection-coordinates { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:10px 0; }
.selection-coordinates label { display:flex; flex-direction:column; gap:4px; color:var(--cm-muted,#9aabb7); }
.selection-coordinates input, .export-filename select { min-width:0; width:100%; box-sizing:border-box; padding:7px; color:var(--text,#dfe7ef); background:var(--input-bg,#0c151c); border:1px solid var(--border,#354654); border-radius:4px; }
.export-filename select option { color:var(--text,#dfe7ef); background:var(--bg-secondary,#17242e); }
.crop-actions { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.manual-frame-list { display:flex; flex-wrap:wrap; gap:5px; max-height:160px; overflow:auto; }
.manual-frame-list .active { border-color:var(--cm-accent,#70d9bf); color:var(--cm-accent,#70d9bf); }
.marking-anchor { cursor:crosshair; }

.character-library { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:8px 18px; background:var(--bg-secondary, var(--cm-panel,#17242e)); border-bottom:1px solid var(--border, var(--cm-border,#344651)); }
.character-library label { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.character-library select { max-width:320px; padding:7px; color:var(--text, var(--cm-text,#dfe7ef)); background:var(--input-bg, var(--cm-deep,#0c151c)); border:1px solid var(--border, var(--cm-border,#354654)); border-radius:4px; }
.character-library option { color:var(--text, var(--cm-text,#dfe7ef)); background:var(--bg-secondary, var(--cm-panel,#17242e)); }

.charset-backdrop { position:fixed; inset:0; z-index:12000; display:grid; place-items:center; padding:2vh 2vw; background:rgb(4 8 13 / 78%); }
.charset-window { display:grid; grid-template-rows:auto auto minmax(0,1fr) auto; width:min(1500px,96vw); height:min(940px,96vh); overflow:hidden; color:var(--text,#dfe7ef); background:var(--cm-panel,#111a22); border:1px solid var(--cm-border,#354654); border-radius:8px; box-shadow:0 24px 80px #000b; font:12px/1.45 Inter,system-ui,sans-serif; }
.charset-backdrop.is-embedded { position:static; inset:auto; z-index:auto; padding:0; background:transparent; display:flex; width:100%; height:100%; min-width:0; min-height:0; container-type:inline-size; }
.is-embedded .charset-window { width:100%; height:100%; min-width:0; border:0; border-radius:0; box-shadow:none; background:var(--panel,#111a22); }
.is-embedded .charset-header { gap:12px; padding:8px 12px; }
.is-embedded .charset-layout { grid-template-rows:minmax(0,1fr); }
.is-embedded .movements-panel { grid-column:1; grid-row:1; }
.is-embedded .sheet-panel { grid-column:2; grid-row:1; }
.is-embedded .animation-panel { grid-column:3; grid-row:1; }
@container (max-width: 900px) {
  .is-embedded .charset-layout { grid-template-columns:150px minmax(0,1fr) 240px; }
  .is-embedded .character-library { padding:6px 10px; gap:5px; }
  .is-embedded .character-library select { max-width:220px; }
}
.charset-header { display:flex; align-items:center; gap:24px; padding:12px 18px; background:var(--cm-panel,#17242e); border-bottom:1px solid var(--cm-border,#344651); }
.charset-kicker { margin:0 0 2px; color:var(--cm-accent,#68cbb2); font:600 9px/1.2 ui-monospace,monospace; letter-spacing:.14em; }
.charset-header h2 { margin:0; color:#f1f5f7; font:600 17px/1.2 ui-monospace,monospace; letter-spacing:.01em; }
.character-name { display:flex; align-items:center; gap:9px; color:var(--cm-muted,#9aabb7); }
.character-name input,.new-animation-row input,.dimension-row input,.preview-controls input[type=number] { min-width:0; padding:7px 9px; color:var(--cm-text,#e7f0f4); background:var(--cm-deep,#0d151c); border:1px solid #354651; border-radius:4px; outline:none; }
.character-name input { width:180px; }
.character-name input:focus,.new-animation-row input:focus,.dimension-row input:focus { border-color:#55c9ae; box-shadow:0 0 0 2px #55c9ae24; }
.charset-close { width:30px; height:30px; margin-left:auto; color:var(--cm-muted,#9aabb7); background:transparent; border:0; border-radius:4px; font-size:22px; cursor:pointer; }
.charset-close:hover { color:white; background:#263640; }
.charset-layout { display:grid; grid-template-columns:minmax(0,1fr) 340px; min-height:0; }
.sheet-panel { display:grid; grid-template-rows:auto minmax(0,1fr) auto auto; min-width:0; min-height:0; border-right:1px solid var(--cm-border,#2d3c47); }
.sheet-toolbar { position:relative; z-index:3; display:flex; align-items:center; gap:10px; min-height:46px; padding:7px 12px; background:var(--cm-panel,#14212a); border-bottom:1px solid var(--cm-border,#2d3c47); }
.visually-hidden { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; clip-path:inset(50%); }
.cm-button { min-height:30px; padding:0 11px; color:#c5d2db; background:var(--cm-panel,#1b2a34); border:1px solid var(--cm-border,#40515d); border-radius:4px; font:600 11px/1 ui-monospace,monospace; cursor:pointer; transition:background-color 140ms cubic-bezier(.2,.8,.2,1),border-color 140ms cubic-bezier(.2,.8,.2,1),color 140ms cubic-bezier(.2,.8,.2,1); }
.cm-button:hover:not(:disabled) { color:#fff; background:#263943; border-color:#628092; }
.cm-button:active:not(:disabled) { transform:translateY(1px); }
.cm-button:disabled { opacity:.4; cursor:not-allowed; }
.cm-button.primary { color:#08221c; background:var(--cm-accent,#68cbb2); border-color:var(--cm-accent,#68cbb2); }
.cm-button.primary:hover:not(:disabled) { background:#7bd9c1; border-color:#7bd9c1; }
.sheet-filename { min-width:0; max-width:330px; overflow:hidden; color:#8295a2; text-overflow:ellipsis; white-space:nowrap; }
.recent-charsets { position:relative; flex:none; color:#a8b7c0; font-size:10px; }
.recent-charsets summary { padding:6px 7px; background:var(--cm-panel,#1b2a34); border:1px solid var(--cm-border,#40515d); border-radius:4px; cursor:pointer; list-style:none; white-space:nowrap; }
.recent-charsets summary::-webkit-details-marker { display:none; }
.recent-charsets summary span { margin-left:3px; color:#6fd2b7; }
.recent-charsets-menu { position:absolute; z-index:10; top:calc(100% + 5px); left:0; width:250px; max-height:260px; overflow:auto; padding:5px; background:var(--cm-panel,#17242d); border:1px solid var(--cm-border,#40515d); border-radius:5px; box-shadow:0 12px 30px #0009; }
.recent-charsets-menu > p { margin:8px; color:#81939f; }
.recent-charset-item { display:flex; gap:4px; }
.recent-charset-item button { min-width:0; padding:7px; color:#cbd7de; background:transparent; border:0; border-radius:3px; text-align:left; cursor:pointer; }
.recent-charset-item button:first-child { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.recent-charset-item button:last-child { color:#8295a2; font-size:15px; }
.recent-charset-item button:hover { color:#fff; background:#263943; }
.background-control { display:flex; align-items:center; gap:5px; color:var(--cm-muted,#9aabb7); font-size:10px; white-space:nowrap; }
.checker-button { display:grid; place-items:center; width:27px; height:27px; padding:0; color:#9fb1bc; background-color:var(--cm-panel,#111a22); background-image:linear-gradient(45deg,#30414b 25%,transparent 25%),linear-gradient(-45deg,#30414b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#30414b 75%),linear-gradient(-45deg,transparent 75%,#30414b 75%); background-size:10px 10px; background-position:0 0,0 5px,5px -5px,-5px 0; border:1px solid var(--cm-border,#40515d); border-radius:4px; cursor:pointer; }
.checker-button.active { border-color:var(--cm-accent,#68cbb2); box-shadow:0 0 0 1px #68cbb244; }
.checker-button span { text-shadow:0 1px 3px #000; }
.background-color-label { display:flex; align-items:center; gap:4px; }
.background-color-label input { width:27px; height:25px; padding:2px; background:var(--cm-deep,#0d151c); border:1px solid var(--cm-border,#40515d); border-radius:4px; cursor:pointer; }
.zoom-control { display:flex; align-items:center; gap:6px; margin-left:auto; color:var(--cm-muted,#9aabb7); font-size:10px; white-space:nowrap; }
.zoom-control input { width:84px; accent-color:var(--cm-accent,#68cbb2); }
.sheet-viewport { position:relative; min-height:0; overflow:auto; background-color:var(--cm-deep,#0d151c); background-image:linear-gradient(45deg,#15222b 25%,transparent 25%),linear-gradient(-45deg,#15222b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#15222b 75%),linear-gradient(-45deg,transparent 75%,#15222b 75%); background-size:18px 18px; background-position:0 0,0 9px,9px -9px,-9px 0; }
.sheet-stage { position:relative; margin:16px auto; touch-action:none; }
.sheet-image { display:block; width:100%; height:100%; image-rendering:pixelated; cursor:crosshair; touch-action:none; }
.selection-rect { position:absolute; z-index:1; border:1px solid #68e3c3; background:#39c5a11c; box-shadow:0 0 0 1px #081410,0 0 16px #4bdbb944; pointer-events:none; }
.frame-guides { position:absolute; z-index:2; inset:0; pointer-events:none; }
.frame-guide { position:absolute; box-sizing:border-box; border:1px solid #ffe27a; background:#ffe27a12; color:#fff1af; text-shadow:0 1px 3px #000; font:700 9px/1 ui-monospace,monospace; padding:2px; }
.frame-guide.first { border-color:#6effce; background:#34e9b51c; color:#c4ffed; }
.sheet-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:260px; height:100%; color:#8498a5; text-align:center; }
.sheet-empty strong { margin-top:12px; color:#d0dbe1; font:600 13px ui-monospace,monospace; }
.sheet-empty p { max-width:260px; margin:7px 0 0; font-size:11px; }
.empty-glyph { color:var(--cm-accent,#68cbb2); font:48px/1 ui-monospace,monospace; }
.sheet-footnote { display:flex; justify-content:space-between; gap:12px; min-height:31px; padding:7px 12px; color:#8394a0; background:var(--cm-panel,#14212a); border-top:1px solid var(--cm-border,#2d3c47); font:10px ui-monospace,monospace; }
.animation-panel { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:auto; background:#121d25; }
.frame-settings,.animation-list-section,.preview-section { padding:13px; border-bottom:1px solid var(--cm-border,#2d3c47); }
.panel-heading { display:flex; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom:10px; }
.panel-heading > span { color:#73d0b6; font:700 9px ui-monospace,monospace; letter-spacing:.13em; }
.panel-heading small { color:#8496a3; font-size:10px; }
.dimension-row { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.dimension-row label { display:grid; grid-template-columns:1fr auto; align-items:center; gap:5px; margin-bottom:8px; color:#aebcc5; font-size:10px; }
.dimension-row label span { color:#617784; font:10px ui-monospace,monospace; }
.dimension-row input { grid-column:1 / -1; width:100%; height:30px; box-sizing:border-box; font:12px ui-monospace,monospace; }
.export-filename { display:grid; grid-template-columns:1fr auto; gap:5px; margin:0 0 9px; color:#aebcc5; font-size:10px; }
.export-filename span { color:#617784; }
.export-filename input { grid-column:1 / -1; width:100%; height:30px; box-sizing:border-box; padding:6px 8px; color:var(--cm-text,#e7f0f4); background:var(--cm-deep,#0d151c); border:1px solid #354651; border-radius:4px; outline:none; font:11px ui-monospace,monospace; }
.export-filename input:focus { border-color:#55c9ae; box-shadow:0 0 0 2px #55c9ae24; }
.spacing-row input { height:26px; }
.helper-text { margin:3px 0 10px; color:#81939f; font-size:10px; }
.new-animation-row { display:flex; gap:6px; }
.new-animation-row input { flex:1; width:0; font:11px ui-monospace,monospace; }
.add-button { white-space:nowrap; }
.inline-error { margin:7px 0 0; color:#f0a574; font-size:10px; }
.animation-list-section { flex:1 0 auto; }
.animation-empty { padding:15px 10px; color:#718591; border:1px dashed #344650; border-radius:4px; font-size:10px; text-align:center; }
.animation-row { display:flex; align-items:center; gap:9px; width:100%; margin:4px 0; padding:8px; color:#c9d5dc; background:var(--cm-panel,#17242d); border:1px solid transparent; border-radius:4px; text-align:left; cursor:pointer; }
.animation-row:hover { background:#1c2c36; }
.animation-row.selected { background:#1b302f; border-color:#3e907f; }
.animation-index { color:#60b99f; font:10px ui-monospace,monospace; }
.animation-copy { display:flex; flex:1; flex-direction:column; min-width:0; gap:2px; }
.animation-copy strong { overflow:hidden; color:#e1e9ee; font:600 11px ui-monospace,monospace; text-overflow:ellipsis; white-space:nowrap; }
.animation-copy small { color:#8598a4; font-size:9px; }
.animation-remove { padding:0 3px; color:#788a95; font-size:16px; }
.animation-remove:hover { color:#ff9289; }
.preview-stage { display:grid; place-items:center; height:155px; overflow:hidden; background-color:#0c141a; background-image:linear-gradient(45deg,#17242c 25%,transparent 25%),linear-gradient(-45deg,#17242c 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#17242c 75%),linear-gradient(-45deg,transparent 75%,#17242c 75%); background-size:16px 16px; background-position:0 0,0 8px,8px -8px,-8px 0; border:1px solid #2e3d47; border-radius:4px; }
.frame-preview { max-width:100%; max-height:144px; image-rendering:pixelated; }
.preview-controls { display:flex; align-items:center; gap:6px; margin-top:8px; }
.cm-icon-button { width:28px; height:28px; color:#d0dbe1; background:var(--cm-panel,#1b2a34); border:1px solid var(--cm-border,#40515d); border-radius:4px; font-size:18px; cursor:pointer; }
.play-button { flex:1; }
.preview-controls label { display:flex; align-items:center; gap:4px; color:#a3b1bb; font-size:10px; white-space:nowrap; }
.preview-controls input[type=number] { width:42px; height:26px; padding:3px; box-sizing:border-box; font:11px ui-monospace,monospace; }
.preview-controls .loop-toggle { gap:3px; }
.loop-toggle input { accent-color:var(--cm-accent,#68cbb2); }
.reduced-note { margin:7px 0 0; }
.charset-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:55px; padding:9px 14px; background:var(--cm-panel,#17242e); border-top:1px solid var(--cm-border,#344651); }
.export-summary { display:flex; flex-wrap:wrap; gap:14px; color:#a4b4be; font:10px ui-monospace,monospace; }
.limit-warning { color:#f0a574; }
.footer-actions { display:flex; gap:8px; margin-left:auto; }
.export-button { min-width:150px; }
.cm-button:focus-visible,.cm-icon-button:focus-visible,.charset-close:focus-visible,.animation-row:focus-visible { outline:2px solid var(--cm-accent,#70d9bf); outline-offset:2px; }
@media(max-width:900px) { .charset-layout { grid-template-columns:minmax(0,1fr) 300px; } .charset-header { gap:12px; } .sheet-footnote span:last-child { display:none; } }
@media(max-width:680px) { .charset-backdrop { padding:0; } .charset-window { width:100vw; height:100dvh; border-radius:0; } .charset-layout { grid-template-columns:1fr; grid-template-rows:minmax(220px,1fr) 45vh; } .sheet-panel { border-right:0; border-bottom:1px solid var(--cm-border,#2d3c47); } .charset-header { padding:9px; } .charset-header h2 { font-size:14px; } .character-name { margin-left:auto; font-size:0; } .character-name input { width:104px; } .charset-footer { align-items:flex-start; } .export-summary { flex-direction:column; gap:2px; } .export-button { min-width:124px; } }
@media(prefers-reduced-motion:reduce) { .cm-button { transition:none; } }

/* Three persistent work areas: movement library, sheet/timeline, inspector. */
.charset-layout { grid-template-columns:206px minmax(0,1fr) 310px; overflow:hidden; }
.movements-panel { display:grid; grid-template-rows:auto auto minmax(0,1fr) auto; min-width:0; min-height:0; background:var(--bg-secondary,#121d25); border-right:1px solid var(--border,#2d3c47); }
.movements-heading { display:flex; align-items:center; gap:8px; padding:10px 12px; color:var(--cm-accent,#78dcc3); font:600 10px ui-monospace,monospace; letter-spacing:.08em; }
.movements-heading small { color:var(--text-secondary,#9aabb7); }
.movements-heading button { margin-left:auto; }
.movement-search { min-width:0; margin:0 10px 8px; padding:7px 9px; color:var(--text,#dfe7ef); background:var(--input-bg,#0c151c); border:1px solid var(--border,#354654); border-radius:4px; font-family:inherit; font-size:11px; }
.movements-list { overflow:auto; min-height:0; padding:0 7px 8px; }
.movement-entry { display:flex; align-items:center; min-width:0; margin:4px 0; border:1px solid transparent; border-radius:4px; background:var(--cm-panel,#17242d); }
.movement-entry.selected { border-color:#3e907f; background:#1b302f; }
.movement-select { display:flex; flex:1; min-width:0; gap:8px; align-items:center; padding:9px 7px; color:var(--text,#dfe7ef); border:0; border-radius:3px; background:transparent; text-align:left; cursor:pointer; }
.movement-entry .animation-remove { flex:none; padding:5px 7px; background:transparent; border:0; cursor:pointer; }
.movement-select:focus-visible, .inspector-tabs button:focus-visible { outline:2px solid var(--cm-accent,#70d9bf); outline-offset:-2px; }
.movement-properties { border-top:1px solid var(--border,#2d3c47); padding:10px; }
.movement-properties label { display:flex; flex-direction:column; gap:5px; font-size:10px; color:var(--text-secondary,#9aabb7); }
.movement-properties input { min-width:0; padding:7px; color:var(--text,#dfe7ef); background:var(--input-bg,#0c151c); border:1px solid var(--border,#354654); border-radius:4px; }
.movement-properties small { color:var(--text-secondary,#9aabb7); font:10px ui-monospace,monospace; }
.animation-panel { display:grid; grid-template-rows:auto auto minmax(0,1fr); overflow:hidden; }
.inspector-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:11px 12px; border-bottom:1px solid var(--border,#2d3c47); min-width:0; }
.inspector-heading strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 12px ui-monospace,monospace; color:var(--cm-accent,#78dcc3); }
.inspector-heading small { color:var(--text-secondary,#9aabb7); font-size:10px; }
.inspector-tabs { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); border-bottom:1px solid var(--border,#2d3c47); }
.inspector-tabs button { min-width:0; padding:9px 3px; border:0; border-bottom:2px solid transparent; color:var(--text-secondary,#9aabb7); background:transparent; font:inherit; font-size:11px; cursor:pointer; }
.inspector-tabs button.active { color:var(--cm-accent,#78dcc3); border-bottom-color:var(--cm-accent,#68cbb2); background:#68cbb20c; }
.inspector-content { min-height:0; overflow:auto; }
.inspector-content .frame-settings { padding:10px 12px; }
.inspector-content .dimension-row { gap:7px; margin-bottom:7px; }
.inspector-content .dimension-row label { font-size:10px; }
.inspector-content .dimension-row input { padding:6px 8px; }
.inspector-content .capture-mode-field { margin-top:0; }
.inspector-content .selection-coordinates { margin:8px 0; }
.crop-help { margin:7px 0; color:var(--text-secondary,#9aabb7); font-size:10px; }
.crop-help summary { cursor:pointer; }
.sheet-toolbar { flex-wrap:wrap; gap:6px; }
.sheet-toolbar .sheet-filename { max-width:145px; }
.sheet-toolbar .zoom-control { margin-left:0; }
.animation-timeline { grid-template-columns:126px minmax(0,1fr); padding:9px; }
.timeline-preview .preview-stage { height:102px; }
.timeline-actions .cm-button { padding:5px 7px; font-size:10px; }
@media(max-width:1100px) { .charset-layout { grid-template-columns:172px minmax(0,1fr) 280px; } .timeline-preview { grid-row:1 / 5; } .animation-timeline { grid-template-columns:106px minmax(0,1fr); gap:6px; } }
@media(max-width:820px) { .charset-layout { grid-template-columns:160px minmax(0,1fr); grid-template-rows:minmax(250px,1fr) minmax(170px,.6fr); } .animation-panel { grid-column:1 / -1; } .sheet-panel { min-height:0; } .timeline-actions { max-height:68px; overflow:auto; } .charset-footer .export-summary { max-width:50%; font-size:9px; } }


/* Button icons use explicit geometry instead of font glyphs. */
.cm-action-icon { display:block; width:16px; height:16px; flex:0 0 16px; pointer-events:none; }
.cm-button { display:inline-flex; align-items:center; justify-content:center; gap:6px; }
.cm-icon-button,.charset-close { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; padding:0; line-height:1; }
.cm-icon-button { min-width:28px; min-height:28px; box-sizing:border-box; }
.cm-icon-button:disabled { opacity:.4; cursor:not-allowed; }
.cm-icon-button:hover:not(:disabled) { color:var(--cm-accent,#78dcc3); border-color:#628092; }
.movements-heading .cm-icon-button { width:28px; height:28px; letter-spacing:normal; }
.movement-entry .animation-remove,.recent-charset-item button:last-child { display:inline-flex; align-items:center; justify-content:center; flex:0 0 26px; width:26px; height:26px; padding:0; color:var(--cm-muted,#9aabb7); }
.animation-remove .cm-action-icon,.recent-charset-item .cm-action-icon { width:14px; height:14px; flex-basis:14px; }
.checker-button { background-image:none; }
.checker-button .cm-action-icon { width:15px; height:15px; flex-basis:15px; }

.behavior-entry { padding:10px 0; border-bottom:1px solid var(--border,#2d3c47); display:grid; gap:8px; }
.behavior-entry label { display:grid; gap:5px; color:var(--text-secondary,#9aabb7); font-size:11px; }
.behavior-entry select { width:100%; min-width:0; background:var(--input-bg,#101d24); color:var(--text-primary,#d8e5ea); border:1px solid var(--border,#2d3c47); border-radius:3px; padding:6px; }
.behavior-entry .behavior-condition { grid-template-columns:1fr 115px; align-items:center; }
.behavior-entry summary { cursor:pointer; color:var(--text-primary,#d8e5ea); font-size:12px; }
.behavior-settings .panel-heading { flex-wrap:wrap; gap:6px; }
.behavior-preview { display:grid; gap:8px; padding-bottom:12px; border-bottom:1px solid var(--border,#2d3c47); }
.behavior-preview canvas { width:100%; height:auto; image-rendering:pixelated; background-image:repeating-conic-gradient(#17252c 0% 25%,#101a21 0% 50%); background-size:16px 16px; }
.behavior-preview summary { cursor:pointer; font-size:12px; color:var(--text-secondary,#9aabb7); }
.behavior-preview input[type="text"] { width:100%; box-sizing:border-box; }
.behavior-event-log { padding-left:20px; margin:8px 0; font-size:11px; max-height:130px; overflow:auto; }
.history-buttons { display:inline-flex; gap:6px; }
</style>
