import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import { builtinModules } from 'module'

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        // Processo Principal
        entry: 'src/background.js',
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            rollupOptions: {
              external: ['electron', 'node-pty', ...builtinModules],
            },
          },
        },
      },
      {
        // Script de Preload
        entry: 'public/preload.js',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            rollupOptions: {
              external: ['electron', ...builtinModules],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(path.dirname(import.meta.url).replace('file://', ''), './src'),
    },
  },
  build: {
    emptyOutDir: true,
  }
})
