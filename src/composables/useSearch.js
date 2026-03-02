/**
 * Busca no workspace
 */
import { ref } from 'vue'
import { escapeRegExp } from '../utils/editorUtils.js'

export function useSearch(openFile, getMonacoInstance, workspacePath, lastError, nextTick) {
  const searchQuery = ref('')
  const searchResults = ref([])
  const isSearching = ref(false)
  const searchInContent = ref(false)
  const searchCaseSensitive = ref(false)
  const searchUseRegex = ref(false)

  async function performSearch() {
    if (!searchQuery.value.trim()) {
      searchResults.value = []
      return
    }
    isSearching.value = true
    try {
      const results = await window.retroStudio.searchFiles(searchQuery.value, {
        searchContent: searchInContent.value,
        caseSensitive: searchCaseSensitive.value,
        useRegex: searchUseRegex.value,
        maxResults: 500
      })
      searchResults.value = results.map(result => {
        if (result.type === 'match' && result.text) {
          const query = searchQuery.value
          let highlightedText = result.text
          if (!searchUseRegex.value) {
            const flags = searchCaseSensitive.value ? 'g' : 'gi'
            const regex = new RegExp(escapeRegExp(query), flags)
            highlightedText = result.text.replace(regex, match => `<mark>${match}</mark>`)
          }
          return { ...result, highlightedText }
        }
        return result
      })
      if (results.length > 0) {
        window.retroStudioToast?.success(`${results.length} resultado${results.length > 1 ? 's' : ''} encontrado${results.length > 1 ? 's' : ''}`, { duration: 2000 })
      } else {
        window.retroStudioToast?.info('Nenhum resultado encontrado')
      }
    } catch (e) {
      console.error('Search failed', e)
      lastError.value = e.message
      window.retroStudioToast?.error('Erro na busca', { description: e.message })
    } finally {
      isSearching.value = false
    }
  }

  function openSearchResult(result, activePath) {
    if (result.type === 'directory') return
    openFile(result.fullPath)
    if (result.line) {
      const monaco = getMonacoInstance()
      if (monaco) {
        nextTick(() => {
          try {
            monaco.revealLineInCenter(result.line)
            monaco.setPosition({ lineNumber: result.line, column: 1 })
            monaco.focus()
          } catch (e) {
            console.error('Failed to position cursor:', e)
          }
        })
      }
    }
  }

  return {
    searchQuery,
    searchResults,
    isSearching,
    searchInContent,
    searchCaseSensitive,
    searchUseRegex,
    performSearch,
    openSearchResult
  }
}
