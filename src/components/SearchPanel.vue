<script setup>
defineProps({
  query: { type: String, default: '' },
  results: { type: Array, default: () => [] },
  isSearching: { type: Boolean, default: false },
  searchInContent: { type: Boolean, default: false },
  searchCaseSensitive: { type: Boolean, default: false },
  searchUseRegex: { type: Boolean, default: false }
})
defineEmits(['update:query', 'update:searchInContent', 'update:searchCaseSensitive', 'update:searchUseRegex', 'search', 'open-result'])
</script>

<template>
  <div class="search-panel">
    <div class="search-input-container">
      <input
        :value="query"
        type="text"
        placeholder="Search in workspace..."
        class="search-input"
        @input="$emit('update:query', $event.target.value)"
        @keyup.enter="$emit('search')"
      />
      <button
        class="search-btn"
        title="Search"
        :disabled="!query.trim() || isSearching"
        @click="$emit('search')"
      >
        <span v-if="isSearching">⏳</span>
        <span v-else class="icon-magnifying-glass"></span>
      </button>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; padding: 0 4px;">
      <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px;">
        <input
          :checked="searchInContent"
          type="checkbox"
          style="cursor: pointer;"
          @change="$emit('update:searchInContent', $event.target.checked)"
        />
        <span>Buscar no conteúdo dos arquivos</span>
      </label>
      <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px;">
        <input
          :checked="searchCaseSensitive"
          type="checkbox"
          style="cursor: pointer;"
          @change="$emit('update:searchCaseSensitive', $event.target.checked)"
        />
        <span>Maiúsculas/minúsculas (Aa)</span>
      </label>
      <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px;">
        <input
          :checked="searchUseRegex"
          type="checkbox"
          style="cursor: pointer;"
          @change="$emit('update:searchUseRegex', $event.target.checked)"
        />
        <span>Usar expressão regular (.*)</span>
      </label>
    </div>

    <div v-if="isSearching" class="emptyState" style="padding: 20px; text-align: center;">
      Buscando...
    </div>
    <div v-else-if="results.length === 0 && query" class="emptyState" style="padding: 20px; text-align: center;">
      Nenhum resultado
    </div>
    <div v-else-if="results.length > 0" class="search-results">
      <div class="search-result-header">
        {{ results.length }} resultado{{ results.length > 1 ? 's' : '' }}
      </div>
      <div
        v-for="(result, idx) in results"
        :key="idx"
        class="search-result-item"
        @click="$emit('open-result', result)"
      >
        <div class="search-result-icon">
          <span v-if="result.type === 'directory'" style="color: var(--accent);">📁</span>
          <span v-else-if="result.type === 'file'" style="color: var(--text);">📄</span>
          <span v-else style="color: var(--muted);">📝</span>
        </div>
        <div class="search-result-content">
          <div class="search-result-path">{{ result.path }}</div>
          <div v-if="result.type === 'match'" class="search-result-match">
            <span class="search-result-line">Linha {{ result.line }}:</span>
            <span class="search-result-text" v-html="result.highlightedText || result.text"></span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="emptyState" style="padding: 20px; text-align: center;">
      Digite para buscar no workspace
    </div>
  </div>
</template>
