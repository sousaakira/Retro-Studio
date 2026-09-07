import { createI18n } from 'vue-i18n'
import ptBR from '../locales/pt-BR.json'
import en from '../locales/en.json'
import es from '../locales/es.json'
import ja from '../locales/ja.json'

const STORAGE_KEY = 'retro-studio-locale'
const SUPPORTED = ['pt-BR', 'en', 'es', 'ja']

function getInitialLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && SUPPORTED.includes(stored)) return stored
  } catch (_) {}
  return 'pt-BR'
}

export const i18n = createI18n({
  legacy: false,
  locale: getInitialLocale(),
  fallbackLocale: 'pt-BR',
  messages: { 'pt-BR': ptBR, en, es, ja },
  globalInjection: true
})

export function setAppLocale(code) {
  if (!SUPPORTED.includes(code)) return
  i18n.global.locale.value = code
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch (_) {}
}

export { SUPPORTED as SUPPORTED_LOCALES }
