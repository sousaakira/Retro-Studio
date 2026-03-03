/**
 * Setup do Monaco Editor: providers, shortcuts, lifecycle
 */
import { watch, nextTick } from 'vue'
import * as monaco from 'monaco-editor'
import { registerSGDKProviders } from '../utils/retro/sgdkMonaco.js'
import { formatCode } from '../utils/retro/codeFormatter.js'

let wordCompletionDisposable = null
let autocompleteProviderDisposable = null

export function useMonacoEditor({
  monacoContainer,
  activeTab,
  activePath,
  editorOptions,
  projectPathGetter,
  autocompleteEnabled,
  isAutocompleteLoading,
  onEditorReady
}) {
  let monacoInstance = null

  function layoutMonaco() {
    if (monacoInstance) monacoInstance.layout()
  }

  function getMonacoInstance() {
    return monacoInstance
  }

  function registerWordBasedCompletionProvider() {
    if (wordCompletionDisposable) wordCompletionDisposable.dispose()
    const languages = ['javascript', 'typescript', 'c', 'html', 'css', 'json', 'markdown', 'plaintext']
    const disposables = languages.map((lang) =>
      monaco.languages.registerCompletionItemProvider(lang, {
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position)
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn
          }
          const text = model.getValue()
          const wordPattern = /\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g
          const wordsSet = new Set()
          let match
          while ((match = wordPattern.exec(text)) !== null) {
            if (match[0].toLowerCase() !== word.word.toLowerCase()) wordsSet.add(match[0])
          }
          const jsKeywords = [
            'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while',
            'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
            'async', 'await', 'class', 'extends', 'import', 'export', 'default', 'from',
            'new', 'this', 'super', 'static', 'get', 'set', 'typeof', 'instanceof',
            'true', 'false', 'null', 'undefined', 'console', 'document', 'window'
          ]
          jsKeywords.forEach((kw) => wordsSet.add(kw))
          const suggestions = Array.from(wordsSet).map((w) => ({
            label: w,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: w,
            range
          }))
          return { suggestions }
        }
      })
    )
    wordCompletionDisposable = { dispose: () => disposables.forEach((d) => d.dispose()) }
  }

  function registerInlineCompletionProvider() {
    if (autocompleteProviderDisposable) {
      autocompleteProviderDisposable.dispose()
    }
    autocompleteProviderDisposable = monaco.languages.registerInlineCompletionsProvider(
      { pattern: '**' },
      {
        provideInlineCompletions: async (model, position, context, token) => {
          if (!autocompleteEnabled.value) return { items: [] }
          const trigger = context.triggerKind
          const isExplicit = trigger === monaco.languages.InlineCompletionTriggerKind.Explicit
          const isAutomatic = trigger === monaco.languages.InlineCompletionTriggerKind.Automatic
          if (!isExplicit && !isAutomatic) return { items: [] }
          if (!window.retroStudio?.ai?.autocomplete?.complete) return { items: [] }
          const textBeforeCursor = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column
          })
          const textAfterCursor = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: model.getLineCount(),
            endColumn: model.getLineMaxColumn(model.getLineCount())
          })
          const minChars = isExplicit ? 3 : 6
          if (textBeforeCursor.trim().length < minChars) return { items: [] }
          const language = model.getLanguageId()
          const filePath = activePath.value || ''
          try {
            isAutocompleteLoading.value = true
            const result = await window.retroStudio.ai.autocomplete.complete({
              prefix: textBeforeCursor,
              suffix: textAfterCursor,
              language,
              filePath
            })
            if (token.isCancellationRequested || result.aborted) return { items: [] }
            if (result.insertText?.trim()) {
              return {
                items: [{
                  insertText: result.insertText,
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column
                  }
                }]
              }
            }
          } catch (e) {
            if (e.name !== 'AbortError') console.error('Autocomplete error:', e)
          } finally {
            isAutocompleteLoading.value = false
          }
          return { items: [] }
        },
        freeInlineCompletions: () => {}
      }
    )
  }

  function registerEditorShortcuts(editor) {
    const { KeyMod, KeyCode } = monaco
    const actions = [
      { id: 'duplicate-line', label: 'Duplicate Line', keys: KeyMod.CtrlCmd | KeyCode.KeyD, run: 'editor.action.copyLinesDownAction' },
      { id: 'toggle-comment', label: 'Toggle Line Comment', keys: KeyMod.CtrlCmd | KeyCode.Slash, run: 'editor.action.commentLine' },
      { id: 'move-line-up', label: 'Move Line Up', keys: KeyMod.Alt | KeyCode.UpArrow, run: 'editor.action.moveLinesUpAction' },
      { id: 'move-line-down', label: 'Move Line Down', keys: KeyMod.Alt | KeyCode.DownArrow, run: 'editor.action.moveLinesDownAction' },
      { id: 'delete-line', label: 'Delete Line', keys: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyK, run: 'editor.action.deleteLines' },
      { id: 'indent-line', label: 'Indent Line', keys: KeyMod.CtrlCmd | KeyCode.BracketRight, run: 'editor.action.indentLines' },
      { id: 'outdent-line', label: 'Outdent Line', keys: KeyMod.CtrlCmd | KeyCode.BracketLeft, run: 'editor.action.outdentLines' }
    ]
    actions.forEach(({ id, label, keys, run }) => {
      editor.addAction({ id, label, keybindings: [keys], run: (ed) => ed.trigger('keyboard', run, null) })
    })
    editor.addAction({
      id: 'duplicate-selection',
      label: 'Duplicate Selection',
      keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyD],
      run: (ed) => {
        const sel = ed.getSelection()
        const text = ed.getModel().getValueInRange(sel)
        ed.executeEdits('', [{ range: sel, text: text + text }])
      }
    })
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.Space, () => editor.trigger('keyboard', 'editor.action.triggerSuggest', null))
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyI, () => editor.trigger('keyboard', 'editor.action.triggerSuggest', null))
    editor.addAction({
      id: 'trigger-suggest',
      label: 'Trigger Suggest (Ctrl+Space ou Ctrl+I)',
      keybindings: [],
      run: (ed) => ed.trigger('keyboard', 'editor.action.triggerSuggest', null)
    })
    editor.addAction({
      id: 'format-document',
      label: 'Format Document',
      keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF],
      run: (ed) => {
        const model = ed.getModel()
        if (!model) return
        const lang = model.getLanguageId()
        const path = activePath.value || ''
        const isC = lang === 'c' || path.endsWith('.c') || path.endsWith('.h')
        if (isC) {
          const code = model.getValue()
          const formatted = formatCode(code)
          if (formatted !== code) {
            ed.executeEdits('', [{ range: model.getFullModelRange(), text: formatted }])
          }
        } else {
          ed.trigger('keyboard', 'editor.action.formatDocument', null)
        }
      }
    })
    editor.addAction({
      id: 'ai-inline-edit',
      label: 'AI: Edit Selection (Ctrl+K)',
      keybindings: [KeyMod.CtrlCmd | KeyCode.KeyK],
      run: (ed) => {
        const selection = ed.getSelection()
        const model = ed.getModel()
        if (!model) return
        let range = selection
        if (selection.isEmpty()) {
          const ln = selection.startLineNumber
          range = {
            startLineNumber: ln,
            startColumn: 1,
            endLineNumber: ln,
            endColumn: model.getLineMaxColumn(ln)
          }
          ed.setSelection(range)
        }
        const selectedText = model.getValueInRange(range)
        const position = ed.getPosition()
        window.dispatchEvent(new CustomEvent('retroStudio:ctrlk', {
          detail: {
            selection: range,
            text: selectedText,
            position,
            filePath: window.retroStudioEditor?.getCurrentFile?.() || ''
          }
        }))
      }
    })
    editor.addAction({
      id: 'toggle-ai-chat',
      label: 'Toggle AI Chat (Ctrl+L)',
      keybindings: [KeyMod.CtrlCmd | KeyCode.KeyL],
      run: () => window.dispatchEvent(new CustomEvent('retroStudio:toggle-ai-chat'))
    })
  }

  function handleEditorMount(editor) {
    monacoInstance = editor
    registerEditorShortcuts(editor)
    registerInlineCompletionProvider()
    registerWordBasedCompletionProvider()
    registerSGDKProviders(monaco, projectPathGetter)
    setTimeout(() => monacoInstance?.layout(), 100)
    onEditorReady?.(editor)
  }

  watch(activeTab, (newTab) => {
    if (!newTab) {
      if (monacoInstance) {
        monacoInstance.dispose()
        monacoInstance = null
      }
      return
    }
    nextTick(() => {
      if (!monacoContainer.value) return
      if (monacoInstance) monacoInstance.dispose()
      monacoInstance = monaco.editor.create(monacoContainer.value, {
        value: newTab.value || '',
        language: newTab.language || 'plaintext',
        theme: 'vs-dark',
        ...editorOptions.value
      })
      monacoInstance.onDidChangeModelContent(() => {
        if (newTab) {
          newTab.value = monacoInstance.getValue()
          newTab.dirty = true
        }
      })
      handleEditorMount(monacoInstance)
    })
  })

  function dispose() {
    if (autocompleteProviderDisposable) {
      autocompleteProviderDisposable.dispose()
      autocompleteProviderDisposable = null
    }
    if (wordCompletionDisposable) {
      wordCompletionDisposable.dispose()
      wordCompletionDisposable = null
    }
    if (monacoInstance) {
      monacoInstance.dispose()
      monacoInstance = null
    }
  }

  return {
    monacoInstance: () => monacoInstance,
    getMonacoInstance,
    layoutMonaco,
    handleEditorMount,
    dispose
  }
}
