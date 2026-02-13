import { createApp, h } from 'vue'
import TilemapEditor from './components/retro/TilemapEditor.vue'
import Toast from './components/Toast.vue'
import './styles.css'

function showBootError(msg) {
  const el = document.getElementById('boot-msg')
  if (el) {
    el.innerHTML = '<span style="color:#f14c4c">' + msg + '</span>'
    el.style.display = 'block'
  }
}

try {
  const app = createApp({
    render() {
      return h('div', { class: 'tilemap-editor-root' }, [
        h(TilemapEditor, {
          asset: this.asset,
          projectPath: this.projectPath,
          assets: this.assets,
          onClose: this.handleClose
        }),
        h(Toast)
      ])
    },
    data() {
      return {
        asset: null,
        projectPath: '',
        assets: []
      }
    },
    async mounted() {
      try {
        if (!window.monarco?.getTilemapEditorData) {
          showBootError('API monarco não disponível. Verifique o preload.')
          return
        }
        const data = await window.monarco.getTilemapEditorData()
        if (data) {
          this.asset = data.asset
          this.projectPath = data.projectPath || ''
          this.assets = data.assets || []
        }
      } catch (e) {
        console.error('[TilemapEditor] Erro ao carregar dados:', e)
        showBootError('Erro: ' + (e?.message || String(e)))
      }
    },
    methods: {
      handleClose() {
        window.monarco?.closeTilemapWindow?.()
      }
    }
  })

  app.mount('#root')
  const bootEl = document.getElementById('boot-msg')
  if (bootEl) bootEl.style.display = 'none'
} catch (e) {
  console.error('[TilemapEditor] Erro ao iniciar:', e)
  showBootError('Erro ao iniciar: ' + (e?.message || String(e)))
}
