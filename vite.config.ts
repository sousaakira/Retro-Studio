import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

// Plugin Monaco com type workaround
const monacoPlugin = (monacoEditorPlugin as any).default || monacoEditorPlugin

export default defineConfig({
  plugins: [
    vue(),
    monacoPlugin({
      languageWorkers: ['editorWorkerService', 'css', 'html', 'json', 'typescript']
    })
  ],
  server: {
    port: 5175,
    strictPort: true
  },
  build: {
    outDir: 'dist'
  }
})
