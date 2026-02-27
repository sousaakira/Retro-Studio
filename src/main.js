import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import loader from '@monaco-editor/loader'

console.log('🚀 [Vue] Iniciando aplicação Monarco')

// Monaco workers (Vite) - Configuração completa de todos os workers
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

console.log('📦 [Vue] Workers do Monaco importados')

// Configura o ambiente Monaco com todos os workers
self.MonacoEnvironment = {
  getWorker(_, label) {
    console.log('🔧 [Monaco] Solicitando worker para:', label)
    if (label === 'json') {
      return new JsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new CssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new HtmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') {
      return new TsWorker()
    }
    return new EditorWorker()
  }
}
console.log('✅ [Monaco] MonacoEnvironment configurado')

// Configura o loader do Monaco
loader.config({ monaco: () => import('monaco-editor') })
console.log('✅ [Monaco] Loader configurado')

try {
  const app = createApp(App)
  console.log('✅ [Vue] Aplicação Vue criada')

  app.mount('#root')
  console.log('✅ [Vue] Aplicação montada em #root')
} catch (err) {
  console.error('❌ [Vue] Erro ao montar aplicação:', err)
  console.error('Stack:', err.stack)
}

// Inicializa o Monaco
