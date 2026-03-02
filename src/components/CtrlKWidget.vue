<script setup>
import { ref, nextTick } from 'vue'

const inputRef = ref(null)
defineExpose({ focusInput: () => nextTick(() => inputRef.value?.focus()) })

defineProps({
  isOpen: Boolean,
  input: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  showPreview: { type: Boolean, default: false },
  inlineMode: { type: Boolean, default: true },
  widgetPosition: { type: Object, default: () => ({ top: 0, left: 0 }) },
  suggestions: { type: Array, default: () => [] },
  selectedText: { type: String, default: '' },
  previewCode: { type: String, default: '' }
})
defineEmits(['update:input', 'submit', 'cancel', 'accept', 'reject', 'use-suggestion'])
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="ctrlk-overlay"
      :class="{ 'ctrlk-overlay-inline': inlineMode }"
      @click="$emit('cancel')"
    >
      <div
        class="ctrlk-popup"
        :class="{
          'ctrlk-expanded': showPreview,
          'ctrlk-inline-widget': inlineMode
        }"
        :style="inlineMode ? {
          position: 'fixed',
          top: widgetPosition.top + 'px',
          left: widgetPosition.left + 'px',
          transform: 'none'
        } : {}"
        @click.stop
      >
        <div class="ctrlk-header">
          <span class="ctrlk-icon">✨</span>
          <span class="ctrlk-title">{{ showPreview ? 'Preview' : 'AI Edit' }}</span>
          <span class="ctrlk-hint">{{ showPreview ? 'Enter → Aceitar' : 'Enter → Gerar' }}</span>
          <button class="ctrlk-close" @click="$emit('cancel')">×</button>
        </div>

        <template v-if="!showPreview">
          <div class="ctrlk-input-area">
            <input
              ref="inputRef"
              :value="input"
              type="text"
              class="ctrlk-input"
              placeholder="O que você quer fazer?"
              :disabled="loading"
              @input="$emit('update:input', $event.target.value)"
              @keydown.enter="$emit('submit')"
              @keydown.esc="$emit('cancel')"
            />
            <button
              class="ctrlk-submit"
              :disabled="!input.trim() || loading"
              @click="$emit('submit')"
            >
              <span v-if="loading" class="ctrlk-loading"></span>
              <span v-else>↑</span>
            </button>
          </div>

          <div v-if="!loading && !input" class="ctrlk-suggestions">
            <button
              v-for="(suggestion, idx) in suggestions.slice(0, 3)"
              :key="idx"
              class="ctrlk-suggestion"
              @click="$emit('use-suggestion', suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>

          <div v-if="selectedText" class="ctrlk-selection-info">
            <span class="icon-code"></span>
            {{ selectedText.split('\n').length }} linhas selecionadas
          </div>
        </template>

        <template v-else>
          <div class="ctrlk-diff-preview">
            <div class="ctrlk-diff-header">
              <span class="ctrlk-diff-instruction">"​{{ input }}"</span>
            </div>
            <div class="ctrlk-diff-content">
              <div class="ctrlk-diff-side ctrlk-diff-original">
                <div class="ctrlk-diff-side-label">Original</div>
                <pre>{{ selectedText }}</pre>
              </div>
              <div class="ctrlk-diff-side ctrlk-diff-new">
                <div class="ctrlk-diff-side-label">Novo</div>
                <pre>{{ previewCode }}</pre>
              </div>
            </div>
          </div>
          <div class="ctrlk-actions">
            <button class="ctrlk-action-btn ctrlk-reject" @click="$emit('reject')">
              <span class="icon-xmark"></span> Voltar
            </button>
            <button class="ctrlk-action-btn ctrlk-accept" @click="$emit('accept')">
              <span class="icon-check"></span> Aceitar
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
