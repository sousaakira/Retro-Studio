/**
 * Opções do Monaco Editor
 */
import { computed } from 'vue'

export function useEditorOptions(editorSettings) {
  const editorOptions = computed(() => ({
    fontSize: editorSettings.value.fontSize,
    wordWrap: editorSettings.value.wordWrap === 'on',
    tabSize: editorSettings.value.tabSize,
    minimap: { enabled: editorSettings.value.minimap !== false },
    lineNumbers: editorSettings.value.lineNumbers || 'on',
    stickyScroll: { enabled: false },
    suggestOnTriggerCharacters: true,
    inlineSuggest: { enabled: true },
    quickSuggestions: { other: true, comments: false, strings: true },
    wordBasedSuggestions: 'currentDocument',
    wordBasedSuggestionsOnlySameLanguage: true,
    formatOnPaste: true,
    formatOnType: true,
    autoClosingBrackets: 'always',
    autoClosingQuotes: 'always',
    autoSurround: 'languageDefined',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    smoothScrolling: true,
    mouseWheelZoom: true,
    multiCursorModifier: 'ctrlCmd',
    snippetSuggestions: 'top',
    suggest: {
      showKeywords: true,
      showSnippets: true,
      showClasses: true,
      showFunctions: true,
      showVariables: true,
      showModules: true,
      showProperties: true,
      showMethods: true,
      showWords: true,
      insertMode: 'insert',
      filterGraceful: true,
      localityBonus: true
    },
    acceptSuggestionOnEnter: 'on',
    tabCompletion: 'on',
    folding: true,
    foldingStrategy: 'indentation',
    showFoldingControls: 'always',
    unfoldOnClickAfterEndOfLine: true,
    matchBrackets: 'always',
    renderWhitespace: 'selection',
    renderLineHighlight: 'all',
    scrollBeyondLastLine: false,
    automaticLayout: true
  }))

  return { editorOptions }
}
