import { createApp } from 'vue'
import App from './App.vue'
import store from './vuex/store';

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
