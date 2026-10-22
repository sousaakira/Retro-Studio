<template>
  <section class="map-library">
    <input ref="rasterMapInput" class="raster-map-file-input" type="file" accept="image/png,.png" :multiple="!replacingRasterId" @change="onRasterMapsSelected" />
    <template v-if="shows('maps')">
    <div class="library-heading">
      <strong>{{ t('tilemap.pack.title') }}</strong>
      <div class="library-actions">
      <button type="button" @click="state.openMap()">{{ t('tilemap.openMap') }}</button>
      <button type="button" :disabled="!pack || state.saving.value" @click="state.createMap()">{{ t('tilemap.createMap') }}</button>
      <button type="button" :disabled="state.packLoading.value || state.packAuthor.exporting.value" @click="state.importAssetPack()">{{ t(state.packLoading.value ? 'tilemap.pack.loading' : 'tilemap.pack.import') }}</button>
      </div>
    </div>
    <section v-if="pack" class="kit-maps">
      <div class="recent-heading"><span>{{ t('tilemap.kitMaps') }}</span></div>
      <p v-if="!state.assetPackMaps.value.length" class="library-hint recent-empty">{{ t('tilemap.noKitMaps') }}</p>
      <div v-else class="recent-list">
        <div v-for="map in state.assetPackMaps.value" :key="map.path" class="kit-map-row">
          <button type="button" class="kit-map-open" :class="{ current: map.path === state.currentMapPath.value }" :title="map.path" @click="state.openRecentMap(map)">
            <span aria-hidden="true">▧</span>
            <span class="recent-info"><strong>{{ map.name }}</strong><small>{{ map.path }}</small></span>
          </button>
          <button type="button" class="recent-remove" :title="t('tilemap.deleteMap')" :aria-label="t('tilemap.deleteMap') + ': ' + map.name" @click="state.deleteKitMap(map)">×</button>
        </div>
      </div>
    </section>
    <section class="recent-maps" :aria-label="t('tilemap.recentKits')">
      <div class="recent-heading">
        <span>{{ t('tilemap.recentKits') }}</span>
        <button v-if="state.recentKits.value.length" type="button" class="clear-recent" @click="state.clearRecentKits()">
          {{ t('tilemap.clearRecentKits') }}
        </button>
      </div>
      <p v-if="!state.recentKits.value.length" class="library-hint recent-empty">{{ t('tilemap.noRecentKits') }}</p>
      <div v-else class="recent-list">
        <div v-for="kit in state.recentKits.value" :key="kit.path" class="recent-row">
          <button type="button" class="recent-open" :class="{ current: kit.path === state.assetPackPath.value }" :title="kit.path" @click="state.openRecentKit(kit)">
            <span aria-hidden="true">▦</span>
            <span class="recent-info"><strong>{{ kit.name }}</strong><small>{{ kit.path }}</small></span>
          </button>
          <button type="button" class="recent-remove" :title="t('tilemap.removeRecentKit')" :aria-label="t('tilemap.removeRecentKit') + ': ' + kit.name" @click="state.removeRecentKit(kit)">×</button>
        </div>
      </div>
    </section>
    <TilemapKitEditor :state="state" />
    <p v-if="!pack" class="library-hint">{{ t('tilemap.pack.hint') }}</p>
    </template>
    <template v-if="shows('layers')">
      <section class="placed-map-layers">
        <div class="recent-heading">{{ t('tilemap.layers.title') }}</div>
        <article v-for="(layer, order) in ['fg', 'bg', 'background']" :key="layer" class="layer-card" :class="{ empty: !layerPlaced(layer) }">
          <header>
            <span class="layer-order" aria-hidden="true">{{ 3 - order }}</span>
            <div class="recent-info"><strong>{{ t('tilemap.layers.' + layer) }}</strong>
              <small>{{ state.rasterBindings.value[layer]?.name || (layer === 'background' ? state.backgroundImage.value?.path?.split(/[\\/]/).pop() : '') || t(layerPlaced(layer) ? 'tilemap.layers.editable' : 'tilemap.layers.emptyLayer') }}</small>
            </div>
            <button v-if="layer === 'fg'" type="button" class="layer-icon" :title="t('tilemap.layers.paintFront')" :aria-label="t('tilemap.layers.paintFront')" @click="state.activeLayer.value = 'fg'; state.selectDrawTool('pencil')">✎</button>
            <button type="button" class="layer-icon danger" :disabled="state.rasterMapBusy.value || !layerPlaced(layer)" :title="t('tilemap.layers.clear')" :aria-label="t('tilemap.layers.clear') + ': ' + t('tilemap.layers.' + layer)" @click="state.clearMapLayer(layer)">×</button>
          </header>
          <div class="layer-position" role="group" :aria-label="t('tilemap.layers.position') + ': ' + t('tilemap.layers.' + layer)">
            <label v-for="axis in ['x', 'y']" :key="axis"><span>{{ axis.toUpperCase() }}</span>
              <input type="number" step="1" :aria-label="`${axis.toUpperCase()} (px): ${t('tilemap.layers.' + layer)}`" :disabled="state.rasterMapBusy.value || !layerPlaced(layer)" :value="layerDraft(layer)[axis]"
                @input="setLayerDraft(layer, axis, $event.target.value)" @keydown.enter.prevent="applyLayerPosition(layer)" />
            </label>
            <div class="layer-nudge">
              <button v-for="nudge in nudges" :key="nudge.label" type="button" :title="nudge.title" :aria-label="nudge.title + ': ' + t('tilemap.layers.' + layer)"
                :disabled="state.rasterMapBusy.value || !layerPlaced(layer)" @click="nudgeLayer(layer, nudge.x, nudge.y, $event)">{{ nudge.label }}</button>
            </div>
            <button v-if="layer !== 'background'" type="button" class="layer-apply" :disabled="state.rasterMapBusy.value || !layerMoved(layer)" @click="applyLayerPosition(layer)">{{ t('tilemap.layers.applyPosition') }}</button>
          </div>
        </article>
        <details class="library-help">
          <summary>{{ t('tilemap.layers.help') }}</summary>
          <p class="library-hint">{{ t('tilemap.layers.orderHint') }}</p>
          <p class="library-hint">{{ t('tilemap.layers.frontHint') }}</p>
          <p class="library-hint">{{ t('tilemap.layers.positionHint') }}</p>
        </details>
      </section>
    <section v-if="pack" class="kit-maps">
      <div class="recent-heading"><span>{{ t('tilemap.layers.kitImages') }}</span></div>
      <div class="raster-map-library">
        <button type="button" class="wide" :disabled="state.rasterMapBusy.value" @click="chooseRasterImage()">▧ {{ t('tilemap.pack.importAsepriteMap') }}</button>
        <p class="library-hint">{{ t('tilemap.pack.rasterMapLibraryHint') }}</p>
        <label class="map-layer-target">{{ t('tilemap.layers.destination') }}
          <select v-model="rasterDestination">
            <option value="background">{{ t('tilemap.layers.background') }}</option>
            <option value="bg">{{ t('tilemap.layers.bg') }}</option>
            <option value="fg">{{ t('tilemap.layers.fg') }}</option>
          </select>
        </label>
        <p class="library-hint">{{ t('tilemap.layers.insertHint') }}</p>
        <div v-if="pack.rasterMaps?.length" class="raster-map-assets">
          <div v-for="mapAsset in pack.rasterMaps" :key="mapAsset.id" class="raster-map-asset">
            <span aria-hidden="true">▧</span><span class="recent-info"><strong>{{ mapAsset.name }}</strong><small>PNG</small></span>
            <div class="raster-map-actions">
              <button type="button" :disabled="state.rasterMapBusy.value" @click="state.insertKitRasterMap(mapAsset, rasterDestination)">{{ t('tilemap.pack.insertMap') }}</button>
              <button type="button" :disabled="state.rasterMapBusy.value" :aria-label="t('tilemap.pack.replaceKitTileset') + ': ' + mapAsset.name" @click="chooseRasterImage(mapAsset.id)">{{ t('tilemap.pack.replaceKitTileset') }}</button>
              <button type="button" :disabled="state.rasterMapBusy.value" :aria-label="t('tilemap.pack.removeEntry') + ': ' + mapAsset.name" @click="state.removeKitRasterMap(mapAsset)">{{ t('tilemap.pack.removeEntry') }}</button>
            </div>
          </div>
        </div>
        <p v-else class="library-hint recent-empty">{{ t('tilemap.pack.noRasterMaps') }}</p>
      </div>
    </section>
    <p v-else class="library-hint">{{ t('tilemap.layers.needKit') }}</p>
    </template>
    <template v-if="shows('brushes')">
    <p v-if="!pack" class="library-hint">{{ t('tilemap.pack.hint') }}</p>
    <template v-else>
      <p class="library-hint">{{ pack.name }}</p>
      <label>{{ t('tilemap.pack.category') }}
        <select v-model="category"><option value="">{{ t('tilemap.pack.all') }}</option><option v-for="c in categories" :key="c">{{ c }}</option></select>
      </label>
      <div class="brush-grid">
        <button v-for="brush in brushes" :key="brush.id" type="button" class="brush" :class="{ selected: state.selectedPackBrush.value?.id === brush.id }" :aria-pressed="state.selectedPackBrush.value?.id === brush.id" @click="state.selectPackBrush(brush)">
          <TilemapObjectPreview :tileset="tileset(brush)" :visual="{ x: brush.x, y: brush.y, w: brush.w, h: brush.h }" region-only />
          <span>{{ brush.name }}</span>
        </button>
      </div>
      <p class="library-hint">{{ t('tilemap.pack.paintHint') }}</p>
    </template>
    </template>
    <template v-if="shows('objects')">
    <fieldset v-if="selected">
      <legend>{{ t('tilemap.pack.selected') }} #{{ selected.id }}</legend>
      <label v-for="field in ['name', 'type']" :key="field">{{ t(`tilemap.pack.${field}`) }}
        <input :value="selected[field]" @change="state.updateSelectedObject(field, $event.target.value)" />
      </label>
      <p v-if="isCollisionRectangle" class="library-hint">Medidas em pixels (passo de 1 px).</p>
      <div class="object-dimensions">
        <label v-for="field in ['x', 'y', 'width', 'height']" :key="field">{{ t(`tilemap.pack.${field}`) }}
          <input type="number" step="1" :min="field === 'width' || field === 'height' ? 1 : 0" :value="(selected[field] ?? 1) * (isCollisionRectangle ? 8 : 1)" @change="state.updateSelectedObject(field, Number($event.target.value) / (isCollisionRectangle ? 8 : 1))" />
        </label>
      </div>
      <fieldset v-if="isCollisionRectangle && selected.type !== 'collision_clear'">
        <legend>Grupo de colisão</legend>
        <input aria-label="Máscara do grupo de colisão" type="number" min="1" max="65535" step="1" :value="selected.properties?.collisionGroup ?? 1" @change="updateCollisionProperty('collisionGroup', $event.target.value)" />
      </fieldset>
      <fieldset v-if="selected.type === 'collision_slope'">
        <legend>Superfície da rampa (px)</legend>
        <div class="object-dimensions">
          <label v-for="key in ['leftHeight','rightHeight']" :key="key">{{ key === 'leftHeight' ? 'Altura à esquerda' : 'Altura à direita' }}
            <input type="number" min="0" :max="selected.height * 8" step="1" :value="selected.properties?.[key] ?? 0" @change="updateCollisionProperty(key, $event.target.value)" />
          </label>
        </div>
        <p class="library-hint">Zero é o topo do retângulo. A rampa é uma superfície de piso; use sólidos para teto e laterais.</p>
      </fieldset>
      <fieldset v-if="selected.type === 'scenery_drift'">
        <legend>Correnteza do cenário (BG_B)</legend>
        <div class="object-dimensions">
          <label>Velocidade (px/s)
            <input type="number" min="0.5" max="120" step="0.5" :value="selected.properties?.speed ?? 16" @change="updateDrift('speed', $event.target.value)" />
          </label>
          <label>Período (px)
            <input type="number" min="1" max="81" step="1" :value="selected.properties?.period ?? 40" @change="updateDrift('period', $event.target.value)" />
          </label>
          <label>Direção
            <select :value="selected.properties?.direction || 'right'" @change="updateDrift('direction', $event.target.value)"><option value="right">Para a direita</option><option value="left">Para a esquerda</option></select>
          </label>
        </div>
        <p class="library-hint">As linhas do cenário entre o topo e a base deste retângulo deslizam de lado no jogo, na largura inteira da sala; X e largura não importam. Período: a cada quantos pixels a arte da água se repete na horizontal. Faixas mais distantes costumam ser mais lentas. Precisa do runtime de cenário versão 3 e da chamada retroScenerySgdkTick no jogo.</p>
      </fieldset>
      <fieldset v-if="selected.type === 'player_spawn'">
        <legend>Caixa de colisão do personagem (px)</legend>
        <div class="object-dimensions">
          <label v-for="field in ['X','Y','W','H']" :key="field">{{ { X:'Deslocamento X', Y:'Deslocamento Y', W:'Largura', H:'Altura' }[field] }}
            <input type="number" step="1" :min="['W','H'].includes(field) ? 1 : 0" :value="selected.properties?.['hitbox'+field] ?? (['W','H'].includes(field) ? (field === 'W' ? selected.width : selected.height)*8 : 0)" @change="updateHitbox(field, $event.target.value)" />
          </label>
        </div>
        <p class="library-hint">Medidas relativas ao quadro do sprite, independentes do tamanho do marcador. No Tempo, pressione A para visualizar no jogo.</p>
      </fieldset>
      <div class="sprite-nudge" :aria-label="t('tilemap.pack.finePlacement')">
        <strong>{{ t('tilemap.pack.finePlacement') }}</strong>
        <button v-for="direction in spriteDirections" :key="direction.key" type="button" :title="t(`tilemap.pack.nudge_${direction.key}`)" :aria-label="t(`tilemap.pack.nudge_${direction.key}`)" @click="state.updateSelectedObject(direction.field, Number(selected.properties?.[direction.field] || 0) + direction.delta)">{{ direction.icon }}</button>
        <span>1 px</span>
      </div>
      <div class="object-dimensions sprite-offsets">
        <label>{{ t('tilemap.pack.spriteOffsetX') }}
          <input type="number" min="-32" max="32" step="1" :value="selected.properties?.spriteOffsetX ?? 0" @change="state.updateSelectedObject('spriteOffsetX', $event.target.value)" />
        </label>
        <label>{{ t('tilemap.pack.spriteOffsetY') }}
          <input type="number" min="-32" max="32" step="1" :value="selected.properties?.spriteOffsetY ?? 0" @change="state.updateSelectedObject('spriteOffsetY', $event.target.value)" />
        </label>
      </div>
      <div v-if="selected.visual" class="object-dimensions">
        <label v-for="axis in ['H','V']" :key="axis" class="trigger-check">
          <input type="checkbox" :checked="[true, 1, 'true', '1'].includes(selected.properties?.['flip'+axis])" @change="state.updateSelectedObject('properties', { ...(selected.properties || {}), ['flip'+axis]: $event.target.checked })" />
          {{ t('tilemap.pack.spriteFlip'+axis) }}
        </label>
      </div>
      <label>{{ t('tilemap.pack.drawPriority') }}
        <select :value="selected.properties?.priority ?? 1" @change="state.updateSelectedObject('properties', { ...(selected.properties || {}), priority: Number($event.target.value) })">
          <option value="0">{{ t('tilemap.pack.drawBehind') }}</option>
          <option value="1">{{ t('tilemap.pack.drawInFront') }}</option>
        </select>
      </label>
      <p class="library-hint">{{ t('tilemap.pack.drawPriorityHint') }}</p>
      <template v-if="selected.type === 'room_exit'">
        <h4>{{ t('tilemap.pack.exitSettings') }}</h4>
        <label>{{ t('tilemap.pack.exitTarget') }}
          <input :value="selected.properties?.target || ''" list="tilemap-exit-targets" :placeholder="t('tilemap.pack.exitTargetHint')" @change="updateExitProperty('target', $event.target.value)" />
          <datalist id="tilemap-exit-targets"><option v-for="map in knownMapIds" :key="map" :value="map" /></datalist>
        </label>
        <div class="object-dimensions">
          <label>{{ t('tilemap.pack.exitSpawnX') }}<input type="number" min="0" :value="selected.properties?.spawn_x ?? 0" @change="updateExitProperty('spawn_x', $event.target.value)" /></label>
          <label>{{ t('tilemap.pack.exitSpawnY') }}<input type="number" min="0" :value="selected.properties?.spawn_y ?? 0" @change="updateExitProperty('spawn_y', $event.target.value)" /></label>
        </div>
        <p class="library-hint">{{ t('tilemap.pack.exitSpawnHint') }}</p>
        <label>{{ t('tilemap.pack.exitTrigger') }}
          <select :value="selected.properties?.trigger || 'area'" @change="updateExitProperty('trigger', $event.target.value)">
            <option value="area">{{ t('tilemap.pack.exitTriggerArea') }}</option>
            <option value="edge">{{ t('tilemap.pack.exitTriggerEdge') }}</option>
          </select>
        </label>
        <label v-if="selected.properties?.trigger === 'edge'">{{ t('tilemap.pack.exitEdgeSide') }}
          <select :value="selected.properties?.edge_side || 'right'" @change="updateExitProperty('edge_side', $event.target.value)">
            <option value="left">{{ t('tilemap.pack.exitLeft') }}</option><option value="right">{{ t('tilemap.pack.exitRight') }}</option>
          </select>
        </label>
        <label>{{ t('tilemap.pack.exitArrivalFacing') }}
          <select :value="selected.properties?.arrival_facing || 'right'" @change="updateExitProperty('arrival_facing', $event.target.value)">
            <option value="left">{{ t('tilemap.pack.exitLeft') }}</option><option value="right">{{ t('tilemap.pack.exitRight') }}</option>
          </select>
        </label>
        <p class="library-hint">{{ t('tilemap.pack.exitAreaHint') }}</p>
      </template>
      <template v-if="selected.type === 'cutscene_trigger'">
        <h4>Gatilho de cena</h4>
        <label>Cena
          <select :value="selected.properties?.cutscene || ''" @change="updateTriggerProperty('cutscene', $event.target.value)">
            <option value="" disabled>Escolha uma cena</option>
            <option v-for="item in cutsceneOptions" :key="item.id" :value="item.id">{{ item.title }} ({{ item.id }})</option>
            <option v-if="selected.properties?.cutscene && !cutsceneOptions.some(item => item.id === selected.properties.cutscene)" :value="selected.properties.cutscene">{{ selected.properties.cutscene }} (não encontrada)</option>
          </select>
        </label>
        <label>Começa
          <select :value="selected.properties?.start || 'touch'" @change="updateTriggerProperty('start', $event.target.value)">
            <option value="touch">Ao tocar na área</option>
            <option value="interact">Ao interagir dentro da área</option>
            <option value="enter">Ao entrar na sala</option>
          </select>
        </label>
        <label class="trigger-check"><input type="checkbox" :checked="selected.properties?.once !== false" @change="updateTriggerProperty('once', $event.target.checked)" /> Executar só uma vez</label>
        <div class="object-dimensions">
          <label>Requer flag
            <select :value="selected.properties?.requires_flag || ''" @change="updateTriggerProperty('requires_flag', $event.target.value)">
              <option value="">(nenhuma)</option>
              <option v-for="flag in cutsceneFlags" :key="flag.id" :value="flag.id">{{ flag.id }}</option>
            </select>
          </label>
          <label>Exceto com flag
            <select :value="selected.properties?.unless_flag || ''" @change="updateTriggerProperty('unless_flag', $event.target.value)">
              <option value="">(nenhuma)</option>
              <option v-for="flag in cutsceneFlags" :key="flag.id" :value="flag.id">{{ flag.id }}</option>
            </select>
          </label>
        </div>
        <button type="button" class="wide" :disabled="!selected.properties?.cutscene" @click="openTriggerCutscene">🎬 Abrir esta cena no editor</button>
        <p class="library-hint">A área do objeto é a região do gatilho. Para “ao entrar na sala”, a área é ignorada.</p>
      </template>
      <template v-if="selected.type === 'enemy'">
        <!-- Instância de inimigo: a definição (tipo) é de Jogo → Inimigos; aqui ficam posição e regras desta cópia. -->
        <h4>Inimigo</h4>
        <label>Tipo de inimigo
          <select :value="enemyReference" @change="setEnemyType($event.target.value)">
            <option value="">Escolha o tipo…</option>
            <option v-for="item in enemyTypes" :key="item.id" :value="item.id">{{ item.name }} ({{ item.id }})</option>
            <option v-if="enemyReference && !enemyTypes.some(item => item.id === enemyReference)" :value="enemyReference">{{ enemyReference }} (não cadastrado)</option>
          </select>
        </label>
        <p v-if="enemyError" class="library-hint">{{ enemyError }}</p>
        <p v-else-if="!enemyTypes.length" class="library-hint">Nenhum tipo cadastrado ainda. Crie um em Jogo → Inimigos.</p>
        <p v-else-if="!enemyReference" class="library-hint warn-hint">Escolha o tipo: sem ele o inimigo não é exportado e o build fica barrado.</p>
        <label>Olhando para
          <select :value="selected.properties?.facing || 'right'" @change="updateEnemyProperty('facing', $event.target.value)">
            <option value="right">Direita</option><option value="left">Esquerda</option>
          </select>
        </label>
        <div class="object-dimensions">
          <label>Patrulha à esquerda (px)<input type="number" min="0" max="4096" :value="selected.properties?.patrolLeft ?? ''" placeholder="0" @change="updateEnemyProperty('patrolLeft', $event.target.value)" /></label>
          <label>Patrulha à direita (px)<input type="number" min="0" max="4096" :value="selected.properties?.patrolRight ?? ''" placeholder="0" @change="updateEnemyProperty('patrolRight', $event.target.value)" /></label>
        </div>
        <p class="library-hint">Distância a partir do ponto do objeto. As duas em 0: anda até parede ou borda.</p>
        <label>Ativar a quantos px da tela
          <input type="number" min="0" max="512" :value="selected.properties?.activation ?? ''" :placeholder="'padrão (' + enemyDefaultActivation + ')'" @change="updateEnemyProperty('activation', $event.target.value)" />
        </label>
        <label>Reaparece
          <select :value="selected.properties?.respawn || 'room'" @change="updateEnemyProperty('respawn', $event.target.value)">
            <option value="room">Ao voltar à sala</option>
            <option value="never">Nunca (fica derrotado)</option>
            <option value="delay">Após um tempo, fora da tela</option>
          </select>
        </label>
        <label v-if="selected.properties?.respawn === 'delay'">Tempo para reaparecer (ms)
          <input type="number" min="0" max="600000" :value="selected.properties?.respawnDelayMs ?? 3000" @change="updateEnemyProperty('respawnDelayMs', $event.target.value)" />
        </label>
        <button type="button" class="wide" @click="openEnemyTypes">Abrir Jogo → Inimigos…</button>
        <p class="library-hint">Os pés do inimigo ficam no centro da base do objeto. Ao salvar o mapa, os inimigos são exportados junto.</p>
      </template>
      <p class="library-hint">{{ t('tilemap.pack.spriteOffsetHint') }}</p>
      <label class="ai-request-label">{{ t('tilemap.pack.aiRequest') }}
        <textarea v-model="aiRequest" rows="3" :placeholder="t('tilemap.pack.aiRequestHint')" />
      </label>
      <button type="button" class="wide ai-context-button" @click="copySelectedObjectContext">{{ t('tilemap.pack.copyAiContext') }}</button>
      <p class="library-hint">{{ t('tilemap.pack.aiContextHint') }}</p>
      <label>{{ t('tilemap.pack.properties') }}
        <textarea :value="JSON.stringify(selected.properties || {}, null, 2)" rows="5" spellcheck="false" @change="state.updateSelectedObject('properties', $event.target.value)" />
      </label>
      <button type="button" class="wide" @click="state.deleteSelectedObject()">{{ t('tilemap.pack.deleteObject') }}</button>
    </fieldset>
    <h4>{{ t('tilemap.pack.objects') }}</h4>
    <div class="object-category-filter" :aria-label="t('tilemap.pack.objectCategory')">
      <button v-for="cat in objectCategories" :key="cat" type="button" :class="{ active: objectCategory === cat }" @click="objectCategory = cat">{{ t(`tilemap.pack.category_${cat}`) }}</button>
    </div>
    <div v-if="!visibleObjectTemplates.length" class="object-empty">{{ t('tilemap.pack.emptyCategory') }}</div>
    <div v-else class="object-template-grid">
      <button v-for="item in visibleObjectTemplates" :key="item.index" type="button" class="object-template" :class="{ selected: state.objectTemplateIndex.value === item.index }" :aria-pressed="state.objectTemplateIndex.value === item.index" @click="state.objectTemplateIndex.value = item.index">
        <span class="object-template-preview"><TilemapObjectPreview v-if="templatePreview(item.object)" :tileset="templatePreview(item.object).tileset" :visual="item.object.visual" :object-width="item.object.width" :object-height="item.object.height" /><span v-else aria-hidden="true">◇</span><i v-if="(item.object.visual?.frames || 1) > 1">↻</i></span>
        <span class="object-template-name">{{ item.object.name }}</span>
      </button>
    </div>
    <button type="button" class="wide" @click="state.selectDrawTool('object')">{{ t('tilemap.pack.placeObject') }}</button>
    <p class="library-hint">{{ t('tilemap.pack.objectHint') }}</p>
    <fieldset>
      <legend>Colisão precisa (pixels)</legend>
      <button type="button" class="wide" @click="state.addCollisionRectangle('collision_solid')">＋ Retângulo sólido</button>
      <button type="button" class="wide" @click="state.addCollisionRectangle('collision_clear')">＋ Recorte sem colisão</button>
      <button type="button" class="wide" @click="state.addCollisionRectangle('collision_platform')">＋ Plataforma atravessável</button>
      <button type="button" class="wide" @click="state.addCollisionRectangle('collision_slope')">＋ Rampa de piso</button>
      <p class="library-hint">O objeto aparece no centro da área visível do mapa, já selecionado: arraste-o para o lugar e ajuste X, Y, largura e altura em pixels no painel. Retângulos planos são aplicados na ordem de criação; o último vence. Rampas precisam do runtime atual. Para recortar uma rampa, ajuste ou remova o próprio objeto.</p>
    </fieldset>
    <fieldset>
      <legend>Animação do cenário</legend>
      <button type="button" class="wide" @click="state.addDriftBand()">＋ Faixa de correnteza (água no cenário)</button>
      <p class="library-hint">Marca linhas do cenário (BG_B) que deslizam de lado no jogo, como a correnteza de um lago. Ajuste o topo e a altura da faixa, a velocidade, o período em que a arte se repete e a direção no painel do objeto.</p>
    </fieldset>
    </template>
  </section>
</template>
<script setup>
import TilemapKitEditor from './TilemapKitEditor.vue'
import TilemapObjectPreview from './TilemapObjectPreview.vue'
import { computed, ref, nextTick, watch } from 'vue'
import { setEnemyInstanceType, setEnemyInstanceProperty } from '../../../../shared/retro/enemies.js'
import { useI18n } from 'vue-i18n'
// `view` mostra uma parte da biblioteca por aba da barra lateral; 'all' mantém tudo junto.
const props = defineProps({ state: { type: Object, required: true }, view: { type: String, default: 'all' } })
const shows = part => props.view === 'all' || props.view === part
const { t } = useI18n()

// Posição das camadas do mapa: o rascunho só vale depois de aplicado, porque mover BG/FG
// por menos de 8 px redesenha os tiles da camada. O fundo visual é barato e aplica na hora.
const layerDrafts = ref({})
const nudges = [
  { label: '←', x: -1, y: 0, title: 'Mover 1 px para a esquerda (Shift: 8 px)' },
  { label: '→', x: 1, y: 0, title: 'Mover 1 px para a direita (Shift: 8 px)' },
  { label: '↑', x: 0, y: -1, title: 'Mover 1 px para cima (Shift: 8 px)' },
  { label: '↓', x: 0, y: 1, title: 'Mover 1 px para baixo (Shift: 8 px)' }
]
const placedLayers = computed(() => ({
  background: !!props.state.backgroundImage.value,
  bg: (props.state.tiles.value || []).some(tile => tile > 0),
  fg: (props.state.tiles2.value || []).some(tile => tile > 0)
}))
function layerPlaced(layer) { return placedLayers.value[layer] }
function layerDraft(layer) { return layerDrafts.value[layer] || props.state.mapLayerPosition(layer) }
function layerMoved(layer) {
  const draft = layerDrafts.value[layer], current = props.state.mapLayerPosition(layer)
  return !!draft && layerPlaced(layer) && (draft.x !== current.x || draft.y !== current.y)
}
function setLayerDraft(layer, axis, value) {
  const pixels = Math.round(Number(value))
  layerDrafts.value = { ...layerDrafts.value, [layer]: { ...layerDraft(layer), [axis]: Number.isFinite(pixels) ? pixels : 0 } }
  if (layer === 'background') void applyLayerPosition(layer)
}
function nudgeLayer(layer, x, y, event) {
  const step = event?.shiftKey ? 8 : 1, draft = layerDraft(layer)
  layerDrafts.value = { ...layerDrafts.value, [layer]: { x: draft.x + x * step, y: draft.y + y * step } }
  if (layer === 'background') void applyLayerPosition(layer)
}
async function applyLayerPosition(layer) {
  const draft = layerDrafts.value[layer]
  if (!draft) return
  await props.state.positionMapLayer(layer, draft)
  // Depois de aplicar (ou de recusar), os campos voltam a mostrar a posição real da camada.
  const { [layer]: _applied, ...rest } = layerDrafts.value
  layerDrafts.value = rest
}
const category = ref('')
const objectCategory = ref('scenery')
const aiRequest = ref('')
const rasterDestination = ref('bg')
const rasterMapInput = ref(null)
const replacingRasterId = ref(null)
async function chooseRasterImage(id = null) {
  replacingRasterId.value = id
  await nextTick()
  rasterMapInput.value?.click()
}
const objectCategories = ['scenery', 'item', 'enemy', 'interaction', 'marker']
const cutsceneOptions = computed(() => Object.values(props.state.cutscenes.sceneSummaries.value || {}).filter(item => item.id).map(item => ({ id: item.id, title: item.title || item.id })))
const cutsceneFlags = computed(() => props.state.cutscenes.config.value.flags || [])
async function onRasterMapsSelected(event) {
  const files = [...(event.target?.files || [])]
  event.target.value = ''
  if (files.length) await props.state.importRasterMapToKit(files, replacingRasterId.value)
  replacingRasterId.value = null
}
function updateTriggerProperty(key, value) {
  const properties = { ...(props.state.selectedObject.value?.properties || {}) }
  if (value === '' || value === undefined) delete properties[key]
  else properties[key] = value
  props.state.updateSelectedObject('properties', properties)
}
async function openTriggerCutscene() {
  const id = props.state.selectedObject.value?.properties?.cutscene
  const cutscenes = props.state.cutscenes
  await cutscenes.openEditor()
  const path = Object.entries(cutscenes.sceneSummaries.value).find(([, item]) => item.id === id)?.[0]
  if (path) await cutscenes.openScene(path)
}
const pack = computed(() => props.state.assetPack.value)
const categories = computed(() => [...new Set((pack.value?.brushes || []).map(b => b.category || ''))])
const brushes = computed(() => (pack.value?.brushes || []).filter(b => !category.value || b.category === category.value))
const visibleObjectTemplates = computed(() => (props.state.objectTemplates.value || []).map((object, index) => ({ object, index })).filter(item => (item.object.category || 'marker') === objectCategory.value))
const spriteDirections = [
  { key: 'left', icon: '←', field: 'spriteOffsetX', delta: -1 },
  { key: 'up', icon: '↑', field: 'spriteOffsetY', delta: -1 },
  { key: 'down', icon: '↓', field: 'spriteOffsetY', delta: 1 },
  { key: 'right', icon: '→', field: 'spriteOffsetX', delta: 1 }
]
const selected = computed(() => props.state.selectedObject.value)
const isCollisionRectangle = computed(() => ['collision_solid','collision_clear','collision_platform','collision_slope'].includes(selected.value?.type))
function updateCollisionProperty(key, value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return
  const maximum = key === 'collisionGroup' ? 65535 : Math.round((selected.value?.height || 1) * 8)
  const parsed = Math.max(key === 'collisionGroup' ? 1 : 0, Math.min(maximum, Math.round(number)))
  props.state.updateSelectedObject('properties', { ...(selected.value?.properties || {}), [key]: parsed })
}
function updateDrift(key, value) {
  let parsed = value
  if (key === 'speed') { parsed = Math.round(Number(value) * 2) / 2; if (!(parsed > 0)) return; parsed = Math.min(120, parsed) }
  if (key === 'period') { parsed = Math.round(Number(value)); if (!(parsed >= 1)) return; parsed = Math.min(81, parsed) }
  if (key === 'direction' && !['right', 'left'].includes(value)) return
  props.state.updateSelectedObject('properties', { ...(selected.value?.properties || {}), [key]: parsed })
}
function updateHitbox(field, value) {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return
  const object = selected.value
  const properties = { hitboxX: 0, hitboxY: 0, hitboxW: object.width*8, hitboxH: object.height*8, ...object.properties }
  properties['hitbox'+field] = Math.max(['W','H'].includes(field) ? 1 : 0, parsed)
  props.state.updateSelectedObject('properties', properties)
}
const knownMapIds = computed(() => [...new Set((props.state.assetPackMaps.value || []).map(map => String(map.name || map.path || '').split(/[\\/]/).pop().replace(/\.tmx$/i, '')))])
// Tipos de inimigo (Jogo → Inimigos), lidos ao selecionar um objeto Enemy.
const enemyTypes = ref([]), enemyError = ref(''), enemyDefaultActivation = ref(32)
const enemyReference = computed(() => String(selected.value?.properties?.enemy || selected.value?.properties?.kind || ''))
let enemyRequest = 0
async function loadEnemyTypes() {
  const projectPath = props.state.projectPath?.value, id = ++enemyRequest
  if (!projectPath || !window.retroStudio?.retro?.enemyConfiguration) return
  try {
    const result = await window.retroStudio.retro.enemyConfiguration({ projectPath })
    if (id !== enemyRequest) return
    enemyTypes.value = (result?.config?.definitions || []).map(d => ({ id: d.id, name: d.name }))
    enemyDefaultActivation.value = result?.config?.settings?.activationMargin ?? 32
    enemyError.value = result?.configError || ''
  } catch (error) { if (id === enemyRequest) enemyError.value = error.message }
}
// Objeto Enemy recém-colocado sem tipo e só um tipo cadastrado: já recebe esse tipo (dá para trocar).
async function selectEnemy(id) {
  if (id === null) return
  await loadEnemyTypes()
  if (selected.value?.type === 'enemy' && selected.value.id === id && !enemyReference.value && enemyTypes.value.length === 1) setEnemyType(enemyTypes.value[0].id)
}
watch(() => selected.value?.type === 'enemy' ? selected.value.id : null, id => { void selectEnemy(id) }, { immediate: true })
function updateEnemyProperty(key, value) {
  props.state.updateSelectedObject('properties', setEnemyInstanceProperty(selected.value?.properties, key, value))
}
// "enemy" é a referência estável; "kind" acompanha para projetos e scripts antigos que o leem.
function setEnemyType(id) {
  props.state.updateSelectedObject('properties', setEnemyInstanceType(selected.value?.properties, id))
  const type = enemyTypes.value.find(item => item.id === id)
  if (type && (!selected.value.name || /^(enemy|inimigo)$/i.test(selected.value.name))) props.state.updateSelectedObject('name', type.name)
}
function openEnemyTypes() {
  window.dispatchEvent(new CustomEvent('retroStudio:open-game', { detail: { projectPath: props.state.projectPath?.value, system: 'enemies' } }))
}
function updateExitProperty(name, value) {
  const parsed = ['spawn_x', 'spawn_y'].includes(name) ? Math.max(0, Math.round(Number(value) || 0)) : value
  props.state.updateSelectedObject('properties', { ...(selected.value?.properties || {}), [name]: parsed })
}
async function copySelectedObjectContext() {
  if (!selected.value) return
  const object = selected.value
  const tileSize = Number(props.state.TILE_SIZE_CONST) || 8
  const centerX = object.x + (object.width || 1) / 2
  const centerY = object.y + (object.height || 1) / 2
  const mapWidth = props.state.mapWidth.value
  const mapHeight = props.state.mapHeight.value
  const region = {
    x: Math.max(0, Math.floor(object.x) - 6),
    y: Math.max(0, Math.floor(object.y) - 6),
    right: Math.min(mapWidth - 1, Math.ceil(object.x + (object.width || 1) - 1) + 6),
    bottom: Math.min(mapHeight - 1, Math.ceil(object.y + (object.height || 1) - 1) + 6)
  }
  const tileGrid = plane => Array.from({ length: region.bottom - region.y + 1 }, (_, row) =>
    Array.from({ length: region.right - region.x + 1 }, (_, column) => plane[(region.y + row) * mapWidth + region.x + column] ?? 0))
  const nearbyObjects = (props.state.objects.value || [])
    .filter(item => item.id !== object.id && Math.max(Math.abs(item.x + (item.width || 1) / 2 - centerX), Math.abs(item.y + (item.height || 1) / 2 - centerY)) <= 12)
    .sort((a, b) => Math.hypot(a.x - object.x, a.y - object.y) - Math.hypot(b.x - object.x, b.y - object.y))
    .slice(0, 20)
    .map(({ animationStart, ...item }) => item)
  const { animationStart, ...selectedObject } = object
  const context = {
    map: {
      name: props.state.currentMapName.value,
      sizeTiles: { width: props.state.mapWidth.value, height: props.state.mapHeight.value },
      sizePixels: { width: props.state.mapWidth.value * tileSize, height: props.state.mapHeight.value * tileSize },
      tileSizePx: tileSize,
      tilesets: (props.state.userTilesets.value || []).map(({ name, firstgid, columns, tilecount }) => ({ name, firstgid, columns, tilecount }))
    },
    mapAreaAroundSelection: {
      originTile: { x: region.x, y: region.y },
      sizeTiles: { width: region.right - region.x + 1, height: region.bottom - region.y + 1 },
      backgroundTileIds: tileGrid(props.state.tiles.value || []),
      foregroundTileIds: tileGrid(props.state.tiles2.value || []),
      collisionValues: tileGrid(props.state.collisionMap.value || [])
    },
    selectedObject: {
      ...selectedObject,
      positionPixels: { x: object.x * tileSize, y: object.y * tileSize },
      sizePixels: { width: (object.width || 1) * tileSize, height: (object.height || 1) * tileSize }
    },
    nearbyObjects,
    nearbyObjectsRadiusTiles: 12,
    request: aiRequest.value.trim() || undefined
  }
  const text = `${t('tilemap.pack.aiContextIntro')}\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``
  try {
    await navigator.clipboard.writeText(text)
    window.retroStudioToast?.success?.(t('tilemap.pack.aiContextCopied'))
  } catch {
    window.retroStudioToast?.error?.(t('tilemap.pack.aiContextCopyError'))
  }
}
function tileset(b) { return props.state.userTilesets.value.find(ts => ts.path === props.state.assetPackTilesets.value[b.tileset]) }
function templatePreview(object) {
  const visual = object?.visual
  if (!visual?.tileset || !pack.value) return null
  const source = props.state.assetPackTilesets.value[visual.tileset]
  const ts = props.state.userTilesets.value.find(item => item.path === source)
  if (!ts?.preview) return null
  return { tileset: ts }
}
</script>
<style scoped>
.trigger-check { flex-direction:row; align-items:center; gap:6px; }
.sprite-nudge { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:14px; font-size:11px; }
.ai-request-label { margin-top:14px; }
.ai-context-button { border-color:var(--accent, #7fa9cb); }
.sprite-nudge strong { flex-basis:100%; font-weight:500; margin-bottom:3px; }
.sprite-nudge button { min-width:34px; min-height:30px; font-size:17px; }
.map-library { padding: 12px; border-bottom: 1px solid var(--border); color: var(--text); font-size: 12px; }
.raster-map-file-input { display:none; }
.raster-map-library { margin:9px 0; padding:8px; border:1px solid var(--border); border-radius:5px; background:rgb(0 0 0 / 8%); }
.raster-map-assets { display:flex; flex-direction:column; gap:5px; margin-top:7px; }
.raster-map-asset { display:flex; flex-wrap:wrap; align-items:center; gap:7px; min-width:0; padding:6px; border:1px solid var(--border); border-radius:4px; }
.raster-map-asset .recent-info { flex:1; }
.map-layer-target { display:flex; flex-direction:column; gap:5px; }
.placed-map-layers { margin-top:12px; padding-top:10px; border-top:1px solid var(--border); }
.layer-card { margin:6px 0; padding:7px; border:1px solid var(--border); border-radius:5px; background:rgba(0,0,0,.14); }
.layer-card.empty { opacity:.72; }
.layer-card header { display:flex; align-items:center; gap:7px; min-width:0; }
.layer-card .recent-info { flex:1; min-width:0; }
.layer-order { flex:none; width:18px; height:18px; display:grid; place-items:center; border-radius:50%; background:rgba(255,255,255,.1); color:var(--muted); font-size:10px; }
.layer-icon { flex:none; width:24px; height:24px; padding:0; display:grid; place-items:center; }
.layer-icon.danger:hover:not(:disabled) { border-color:#b45252; }
.layer-position { display:flex; flex-wrap:wrap; align-items:center; gap:5px; margin-top:7px; }
.layer-position label { display:flex; flex-direction:row; align-items:center; gap:4px; margin:0; flex:1 1 62px; min-width:0; }
.layer-position label span { color:var(--muted); font-size:10px; }
.layer-position input { width:100%; min-width:0; box-sizing:border-box; padding:3px 5px; }
.layer-nudge { display:flex; gap:2px; }
.layer-nudge button { width:22px; height:24px; padding:0; }
.layer-apply { flex:none; padding:3px 8px; }
.library-help { margin:6px 0; font-size:11px; }
.library-help summary { cursor:pointer; color:var(--muted); }
.library-help summary:hover { color:var(--text); }
.raster-map-actions { display:flex; flex-wrap:wrap; gap:5px; width:100%; }
.raster-map-asset button { flex:none; padding:5px 7px; }
.library-heading { display:flex; flex-direction:column; align-items:stretch; gap:8px; }
.library-actions { display:flex; flex-wrap:wrap; gap:6px; }
.library-actions button { flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.recent-maps { margin:10px 0 12px; }
.recent-heading { display:flex; align-items:center; justify-content:space-between; gap:6px; font-weight:600; }
.clear-recent, .recent-remove { flex:none; padding:3px 7px; font-size:11px; }
.recent-list { display:flex; flex-direction:column; gap:4px; margin-top:6px; max-height:156px; overflow:auto; }
.recent-row { display:flex; align-items:stretch; gap:4px; min-width:0; }
.recent-open { display:flex; flex:1; align-items:center; gap:8px; min-width:0; text-align:left; }
.recent-open.current { border-color:var(--accent, #7fa9cb); }
.recent-info { display:flex; flex-direction:column; min-width:0; line-height:1.25; }
.recent-info strong, .recent-info small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.recent-info small { opacity:.65; font-size:10px; }
.recent-empty { margin:5px 0; }
.kit-maps { margin:10px 0 12px; padding-top:8px; border-top:1px solid var(--border); }
.kit-map-open { display:flex; width:100%; align-items:center; gap:8px; min-width:0; margin-top:4px; text-align:left; }
.kit-map-row { display:flex; align-items:stretch; gap:4px; min-width:0; }
.kit-map-row .kit-map-open { flex:1; }
.kit-map-open.current { border-color:var(--accent, #7fa9cb); }
.library-hint { opacity:.75; line-height:1.45; margin:8px 0; }
.library-hint.warn-hint { opacity:1; color:#e5c07b; }
label { display:flex; flex-direction:column; gap:4px; margin:8px 0; }
button, input, select, textarea { font:inherit; color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:4px; padding:6px; min-width:0; }
button { cursor:pointer; } button:disabled { opacity:.6; cursor:wait; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline:2px solid var(--accent, #7fa9cb); outline-offset:2px; }
.brush-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:6px; margin:10px 0; max-height:300px; overflow:auto; }
.brush { display:flex; flex-direction:column; align-items:center; gap:4px; }
.brush.selected { border-color:var(--accent, #7fa9cb); box-shadow:inset 0 0 0 1px var(--accent, #7fa9cb); }
.brush > canvas { width:100%; height:60px; image-rendering:pixelated; background:#172329; }
.brush span { line-height:1.3; }
.object-dimensions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 8px; }
.object-category-filter { display:flex; flex-wrap:wrap; gap:3px; margin:7px 0; }
.object-category-filter button { padding:4px 6px; font-size:10px; }
.object-category-filter button.active { border-color:var(--accent, #7fa9cb); color:var(--text); background:rgba(68,145,194,.16); }
.object-template-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; max-height:190px; overflow:auto; }
.object-template { display:flex; min-width:0; flex-direction:column; align-items:center; gap:4px; padding:4px; border:1px solid var(--border); border-radius:4px; color:var(--text); background:var(--bg); cursor:pointer; }
.object-template.selected { border-color:var(--accent, #7fa9cb); box-shadow:inset 0 0 0 1px var(--accent, #7fa9cb); }
.object-template-preview { position:relative; display:grid; place-items:center; width:100%; height:42px; overflow:hidden; color:#86bfdf; background:#172329; image-rendering:pixelated; }
.object-template-preview > svg { width:100%; height:100%; image-rendering:pixelated; }
.object-template-preview i { position:absolute; top:1px; right:3px; color:#fff; font-size:12px; font-style:normal; text-shadow:0 1px 2px #000; }
.object-template-name { width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
.object-empty { padding:10px; color:var(--muted, #999); font-size:11px; line-height:1.4; }
fieldset { border:1px solid var(--border); padding:8px; margin:10px 0 0; min-width:0; }
textarea { resize:vertical; font-family:monospace; } .wide { width:100%; } h4 { margin:16px 0 8px; }
</style>
