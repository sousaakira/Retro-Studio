import { createApp } from 'vue'
import App from './App.vue'
import store from './vuex/store';

// Suprimir erro irritante do ResizeObserver loop limit exceeded
window.addEventListener('error', (e) => {
  if (e.message === 'ResizeObserver loop limit exceeded' || e.message === 'ResizeObserver loop completed with undelivered notifications.') {
    const resizeObserverErrDiv = document.getElementById('webpack-dev-server-client-overlay-div')
    const resizeObserverErr = document.getElementById('webpack-dev-server-client-overlay')
    if (resizeObserverErr) resizeObserverErr.setAttribute('style', 'display: none')
    if (resizeObserverErrDiv) resizeObserverErrDiv.setAttribute('style', 'display: none')
    e.stopImmediatePropagation()
  }
})

import './gobal.css'
import './assets/tree.css'
import './assets/interface.css'
import './assets/icons.css'

// define fonts icons
import '@fortawesome/fontawesome-free/css/all.css'
import { aliases, fa } from 'vuetify/iconsets/fa'

// Vuetify
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'dark'
  },
  icons: {
    defaultSet: 'fa',
    aliases,
    sets: {
      fa,
    },
  },
})

// createApp(App).mount('#app')
createApp(App).use(vuetify).use(store).mount('#app')
