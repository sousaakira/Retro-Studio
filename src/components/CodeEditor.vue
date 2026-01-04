<template>
  <div class="code-editor-wrapper">
    <div ref="editor" class="monaco-editor-container"></div>
  </div>
</template>

<script setup>
  import * as monaco from 'monaco-editor'
  import { sgdkCompletionProvider, sgdkSignatureProvider } from '@/utils/sgdkAutocomplete'
  import { registerSGDKSnippets } from '@/utils/sgdkSnippets'
  import { expandSGDKDocumentation, createSGDKHoverProvider } from '@/utils/sgdkHoverProvider'
  import { formatCode } from '@/utils/codeFormatter'
  import { createSGDKGoToDefinitionProvider, createSGDKFindReferencesProvider, createSGDKRenameProvider, createSGDKCodeActionsProvider, createSGDKInlineDiagnosticsProvider, createSGDKDocumentSymbolProvider } from '@/utils/sgdkLSPProviders'
  import { ref, onMounted, defineProps, defineExpose, watch, computed } from 'vue'
  import { useStore } from 'vuex'
  const editor = ref()
  const code = ref('')
  const fileModify = ref(false)
  // const codEditor = ref()

  const props = defineProps({
    msg: String
  });
  const store = useStore()
  const toolkitPath = computed(() => store.state.uiSettings?.toolkitPath || '')
  
  let initCode = null
  let colorDecorations = []

  const updateColorDecorations = () => {
    if (!initCode) return
    const model = initCode.getModel()
    if (!model) return
    
    const content = model.getValue()
    const newDecorations = []
    
    // Identificar se é arquivo de paleta pelo path ou pelo conteúdo (JASC-PAL)
    const isPalFile = (props.msg && props.msg.toLowerCase().endsWith('.pal')) || content.includes('JASC-PAL')
    
    console.log('[CodeEditor] Atualizando cores. isPalFile:', isPalFile, 'Path:', props.msg)
    
    // 1. Hex Colors (#RRGGBB)
    const hexRegex = /#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})/g
    let match
    while ((match = hexRegex.exec(content)) !== null) {
      const color = match[0]
      const hexPart = match[1]
      const hexKey = (hexPart.length === 3 
        ? hexPart[0]+hexPart[0]+hexPart[1]+hexPart[1]+hexPart[2]+hexPart[2] 
        : hexPart).toUpperCase()
      
      const startPos = model.getPositionAt(match.index)
      const endPos = model.getPositionAt(match.index + match[0].length)
      
      newDecorations.push({
        range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
        options: {
          before: {
            content: '\u00a0', // Usar espaço real para forçar renderização
            inlineClassName: `inline-color-box color-box-${hexKey}`,
            inlineClassNameAffectsLetterSpacing: true
          }
        }
      })
      
      const styleId = `monaco-color-${hexKey}`
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style')
        style.id = styleId
        style.innerHTML = `.color-box-${hexKey} { background-color: ${color} !important; }`
        document.head.appendChild(style)
      }
    }
    
    // 2. RGB Colors em arquivos .pal (ex: "255 0 128")
    if (isPalFile) {
      // Regex mais robusta para RGB: ignora espaços no início/fim e aceita \r opcional
      const rgbRegex = /^[ \t]*(\d{1,3})[ \t]+(\d{1,3})[ \t]+(\d{1,3})[ \t\r]*$/gm
      let rgbCount = 0
      while ((match = rgbRegex.exec(content)) !== null) {
        const r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3])
        
        // Validar se são cores válidas (0-255)
        if (r <= 255 && g <= 255 && b <= 255) {
          rgbCount++
          const hex = `${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`.toUpperCase()
          const startPos = model.getPositionAt(match.index)
          const endPos = model.getPositionAt(match.index + match[0].length)
          
          newDecorations.push({
            range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
            options: {
              before: {
                content: '\u00a0', // Usar espaço real para forçar renderização
                inlineClassName: `inline-color-box color-box-rgb-${hex}`,
                inlineClassNameAffectsLetterSpacing: true
              }
            }
          })
          
          const styleId = `monaco-color-rgb-${hex}`
          if (!document.getElementById(styleId)) {
            const style = document.createElement('style')
            style.id = styleId
            style.innerHTML = `.color-box-rgb-${hex} { background-color: rgb(${r},${g},${b}) !important; }`
            document.head.appendChild(style)
          }
        }
      }
      console.log(`[CodeEditor] Encontradas ${rgbCount} cores RGB`)
    }
    
    colorDecorations = initCode.deltaDecorations(colorDecorations, newDecorations)
  }

  onMounted(() => {
    initCode = monaco.editor.create(editor.value, {
      value: code.value,
      language: 'c',
      theme: 'vs-dark',
      fontSize: 19,
      fontFamily: ['Courier New', 'Courier', 'monospace'],
      automaticLayout: true,
      verticalHasArrows: true,
      wordWrap: store?.state?.uiSettings?.editorWordWrap || 'off',
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnCommitCharacter: true,
      multiCursorModifier: 'ctrlCmd', // Permite que Alt+Click seja usado para Go to Definition
      links: true,
      mouseWheelZoom: true
    })

    // Registrar completion provider para SGDK
    monaco.languages.registerCompletionItemProvider('c', sgdkCompletionProvider)
    
    // Registrar signature help para SGDK
    monaco.languages.registerSignatureHelpProvider('c', sgdkSignatureProvider, {
      triggerCharacters: ['(']
    })
    
    // Registrar snippets do SGDK
    registerSGDKSnippets(monaco)
    
    // Registrar hover provider para SGDK (documentação ao passar mouse)
    expandSGDKDocumentation()
    const hoverProvider = createSGDKHoverProvider(monaco)
    monaco.languages.registerHoverProvider('c', hoverProvider)

    // LSP Providers
    console.log('[CodeEditor] Registrando LSP providers...')
    monaco.languages.registerDefinitionProvider('c', createSGDKGoToDefinitionProvider())
    monaco.languages.registerReferenceProvider('c', createSGDKFindReferencesProvider())
    monaco.languages.registerRenameProvider('c', createSGDKRenameProvider())
    monaco.languages.registerCodeActionProvider('c', createSGDKCodeActionsProvider())
    monaco.languages.registerDocumentSymbolProvider('c', createSGDKDocumentSymbolProvider())
    
    // Diagnostics em tempo real
    const inlineDiags = createSGDKInlineDiagnosticsProvider(initCode)
    initCode.getModel().onDidChangeContent(() => {
      inlineDiags.updateDiagnostics()
      updateColorDecorations()
    })
    inlineDiags.updateDiagnostics()
    updateColorDecorations()
    console.log('[CodeEditor] LSP providers e Color Decorators registrados!')

    // Interceptar navegação para outros arquivos (Go to Definition)
    const editorService = initCode._codeEditorService;
    const originalOpenEditor = editorService.openCodeEditor.bind(editorService);
    editorService.openCodeEditor = async (input, source, sideBySide) => {
      const resource = input.resource;
      
      // Validar se é uma URI de arquivo
      if (resource.scheme !== 'file') {
        return originalOpenEditor(input, source, sideBySide);
      }

      const path = resource.fsPath || resource.path;
      
      // Se for o mesmo arquivo que já está aberto, use o comportamento padrão
      if (path === props.msg) {
        return originalOpenEditor(input, source, sideBySide);
      }

      // Se for um arquivo diferente, abrir via aplicação
      if (path && path !== 'debug:window') {
        console.log('[CodeEditor] Redirecionando abertura de arquivo:', path);
        store.dispatch('updateFileRequest', { 
          node: { path: path, tipo: 'arquivo' },
          line: input.options?.selection?.startLineNumber || 1,
          column: input.options?.selection?.startColumn || 1
        });
        
        // Retornar o editor atual. Monaco chamará getModel() nele.
        // Como o modelo vai mudar em breve (via updateFileRequest), 
        // ele pode reclamar, mas é a melhor forma de manter o fluxo.
        return initCode;
      }
      
      return originalOpenEditor(input, source, sideBySide);
    };

    // Forçar layout inicial após um pequeno delay para garantir que o container está pronto
    setTimeout(() => {
      initCode.layout()
    }, 100)

    initCode.addCommand(monaco.KeyCode.F5, () => {
      const project = JSON.parse(localStorage.getItem('project'))
      if (toolkitPath.value) {
        project.toolkitPath = toolkitPath.value
      }
      window.ipc.send('run-game', project)
    })

    // Atalho para formatação: Ctrl+Shift+F
    initCode.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
      formatCodeAction()
    })

    initCode.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      save()
    })

    initCode.getModel().onDidChangeContent(() => {
      // A lógica que você deseja executar quando o conteúdo do modelo é alterado
      console.log('Conteúdo do modelo foi alterado:');
      fileModify.value = true
    });

  })
  
  watch(() => props.msg, (newMsg) => {
    console.log('[CodeEditor] Arquivo alterado:', newMsg)
    if (initCode) {
      updateColorDecorations()
    }
  })

  watch(() => store.state.uiSettings.editorWordWrap, (mode) => {
    if (initCode) {
      initCode.updateOptions({ wordWrap: mode || 'off' })
    }
  })
  
  // eslint-disable-next-line no-unused-vars
  const getCodFile = async (codeFile) => {
    try {
      const content = codeFile || ''
      if (typeof content !== 'string') {
        console.error('[CodeEditor] setCodFile: conteúdo inválido')
        return
      }
      await initCode.setValue(content)
    } catch (error) {
      console.error('[CodeEditor] Erro ao definir conteúdo:', error)
    }
  }
    
  const playApp = () => {
    const project = JSON.parse(localStorage.getItem('project'))
    if (toolkitPath.value) {
      project.toolkitPath = toolkitPath.value
    }
    window.ipc.send('run-game', project)
  }

  const save = () => {
    const cod = initCode.getValue()
    console.log('Salvando', cod)
    // console.log('Salvando length', cod.length)
    // console.log('Salvando', props.msg)
    if(cod.length > 0){
      if(props.msg != undefined && props.msg != ''){
        return window.ipc.send('save-file',{cod, path: props.msg})
      }
      fileModify.value = false
      // alert('Empty file')
    }
    console.log('Não savar conteudo vazio')
  }

  const sendSave = () => {
    console.log('Send Save: ')
    save()
  }
  
  const formatCodeAction = () => {
    if (!initCode) return
    
    const currentCode = initCode.getValue()
    const formatterOptions = {
      indentStyle: store?.state?.uiSettings?.formatterIndentStyle || 'space',
      indentSize: store?.state?.uiSettings?.formatterIndentSize || 2
    }
    
    const formatted = formatCode(currentCode, formatterOptions)
    initCode.setValue(formatted)
    
    console.log('[CodeEditor] Código formatado com sucesso')
  }
  
  const goToLine = (lineNumber, columnNumber = 1) => {
    if (!initCode) return
    
    try {
      // Validar lineNumber
      const totalLines = initCode.getModel().getLineCount()
      let validLine = Math.max(1, Math.min(Math.floor(Number(lineNumber)) || 1, totalLines))
      let validColumn = Math.max(1, Math.floor(Number(columnNumber)) || 1)
      
      console.log(`[CodeEditor] Going to line ${validLine}, column ${validColumn}`)
      
      // Ir para a linha e coluna especificada
      initCode.setPosition({ lineNumber: validLine, column: validColumn })
      
      // Centralizar na viewport
      initCode.revealLine(validLine)
      
      // Destacar a linha (selecionar)
      const lineContent = initCode.getModel().getLineContent(validLine)
      initCode.setSelection(
        new monaco.Selection(
          validLine,
          validColumn,
          validLine,
          Math.max(validColumn, lineContent.length + 1)
        )
      )
    } catch (error) {
      console.error('[CodeEditor] Erro ao navegar para linha:', error)
    }
  }
  
  defineExpose({
    getCodFile,
    playApp,
    sendSave,
    goToLine,
    formatCodeAction
  })
</script>

<style scoped>
.code-editor-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  position: relative;
  z-index: 1;
}

.monaco-editor-container {
  width: 100%;
  height: 100%;
  border: none;
  overflow: hidden;
}
</style>

<style>
/* Garantir que hover aparece acima de tudo */
.monaco-editor .monaco-hover {
  z-index: 10000 !important;
  background: #252526 !important;
  border: 1px solid #464647 !important;
  color: #cccccc !important;
}

.monaco-editor .monaco-hover-row {
  padding: 4px 8px !important;
}

.monaco-editor .monaco-hover-contents {
  padding: 4px !important;
}

/* LSP Diagnostics Styling */
.squiggly-error {
  border-bottom: 2px wavy #f44747 !important;
}

.squiggly-warning {
  border-bottom: 2px wavy #dcdcaa !important;
}

.glyph-error {
  background: #f44747 !important;
  border-radius: 50%;
  width: 12px !important;
  height: 12px !important;
}

.glyph-warning {
  background: #dcdcaa !important;
  border-radius: 50%;
  width: 12px !important;
  height: 12px !important;
  border-radius: 50%;
  width: 12px !important;
  height: 12px !important;
}

/* Color Decorators */
.inline-color-box {
  display: inline-block !important;
  width: 12px !important;
  height: 12px !important;
  border: 1px solid #eee !important;
  margin-right: 4px !important;
  margin-left: 2px !important;
  vertical-align: middle !important;
  border-radius: 2px !important;
  cursor: pointer !important;
}
</style>
