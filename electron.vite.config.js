import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    // Main process entry point
    build: {
      lib: {
        entry: 'electron/main.js',
        formats: ['cjs']
      },
      // Don't externalize dependencies for Electron main process
      externalizeDeps: {
        exclude: [
          'node-pty', // Terminal emulation library
          'fs-extra', // File system utilities
          'marked'    // Markdown parser
        ]
      }
    }
  },
  preload: {
    // Preload script configuration
    build: {
      lib: {
        entry: 'electron/preload.js',
        formats: ['cjs']
      },
      // Preload scripts should bundle all dependencies
      externalizeDeps: true
    }
  },
  renderer: {
    // Renderer process configuration (Vue app)
    root: '.',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          tilemapEditor: path.resolve(__dirname, 'tilemap-editor.html')
        }
      }
    },
    plugins: [
      vue(),
      viteStaticCopy({
        targets: [
          {
            src: 'assets/icons/*',
            dest: 'icons'
          }
        ]
      })
    ],
    server: {
      port: 5175,
      strictPort: true
    }
  }
})
