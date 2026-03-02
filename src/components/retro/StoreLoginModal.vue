<template>
  <Teleport to="body">
    <Transition name="store-login-modal">
      <div v-if="isOpen" class="store-login-overlay">
        <div class="store-login-panel">
          <div class="store-login-header">
            <h2>Minha Conta</h2>
            <button class="store-login-close" @click="$emit('close')" title="Fechar">
              <span class="icon-xmark"></span>
            </button>
          </div>
          <div class="store-login-body">
            <p class="store-login-hint">Faça login para acessar seu perfil, compras e configurações.</p>
            <div class="form-field">
              <label>URL da API</label>
              <input v-model="apiUrl" type="text" placeholder="https://api.retrostudio.dev" class="form-input" />
            </div>
            <template v-if="!storeUser">
              <div class="form-field">
                <label>Email</label>
                <input v-model="email" type="email" placeholder="seu@email.com" class="form-input" autocomplete="email" />
              </div>
              <div class="form-field">
                <label>Senha</label>
                <input v-model="password" type="password" placeholder="••••••••" class="form-input" autocomplete="current-password" @keyup.enter="doLogin" />
              </div>
              <button class="btn-login" :disabled="loggingIn || !email.trim() || !password" @click="doLogin">
                {{ loggingIn ? 'Entrando…' : 'Entrar' }}
              </button>
              <p v-if="loginError" class="form-error">{{ loginError }}</p>
            </template>
            <template v-else>
              <div class="store-login-user">
                <span class="user-badge">{{ storeUser.name || storeUser.email }}</span>
                <p class="user-email">{{ storeUser.email }}</p>
              </div>
              <button class="btn-logout" @click="doLogout" :disabled="loggingOut">
                {{ loggingOut ? 'Saindo…' : 'Sair' }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  storeUser: { type: Object, default: null }
})

const emit = defineEmits(['close', 'logged-in', 'logged-out'])

const apiUrl = ref('https://api.retrostudio.dev')
const email = ref('')
const password = ref('')
const loggingIn = ref(false)
const loggingOut = ref(false)
const loginError = ref('')

watch(() => props.isOpen, async (open) => {
  if (open) {
    loginError.value = ''
    try {
      const s = await window.retroStudio?.settings?.load?.()
      apiUrl.value = s?.store?.apiUrl || 'https://api.retrostudio.dev'
    } catch (_) {}
  }
})

async function doLogin() {
  if (!email.value.trim() || !password.value || loggingIn.value) return
  loginError.value = ''
  loggingIn.value = true
  try {
    const url = (apiUrl.value || '').trim() || 'https://api.retrostudio.dev'
    console.log('doLogin', url, email.value.trim(), password.value)
    const r = await window.retroStudio?.store?.login?.(url, email.value.trim(), password.value)
    if (r?.success) {
      emit('logged-in', r.user)
      password.value = ''
      emit('close')
      window.retroStudioToast?.success?.('Login realizado!')
    } else {
      loginError.value = r?.error || 'Falha no login'
    }
  } catch (e) {
    loginError.value = e?.message || 'Erro ao conectar'
  } finally {
    loggingIn.value = false
  }
}

async function doLogout() {
  loggingOut.value = true
  try {
    await window.retroStudio?.store?.logout?.()
    emit('logged-out')
    emit('close')
    window.retroStudioToast?.info?.('Sessão encerrada')
  } finally {
    loggingOut.value = false
  }
}
</script>

<style scoped>
.store-login-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.store-login-panel {
  width: 360px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.store-login-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
}

.store-login-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.store-login-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
}

.store-login-close:hover {
  background: var(--hover);
  color: var(--text);
}

.store-login-body {
  padding: 20px;
}

.store-login-hint {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--muted);
}

.form-field {
  margin-bottom: 14px;
}

.form-field label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--muted);
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
}

.form-input:focus {
  outline: none;
  border-color: var(--accent);
}

.btn-login,
.btn-logout {
  width: 100%;
  padding: 10px 16px;
  margin-top: 8px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  border: none;
}

.btn-login {
  background: var(--accent);
  color: white;
}

.btn-login:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-login:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-logout {
  background: var(--tab);
  color: var(--text);
  margin-top: 16px;
}

.btn-logout:hover:not(:disabled) {
  background: var(--hover);
}

.form-error {
  margin-top: 10px;
  font-size: 12px;
  color: var(--danger);
}

.store-login-user {
  padding: 12px 0;
}

.user-badge {
  display: block;
  font-weight: 600;
  font-size: 14px;
}

.user-email {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.store-login-modal-enter-active,
.store-login-modal-leave-active {
  transition: opacity 0.2s ease;
}

.store-login-modal-enter-from,
.store-login-modal-leave-to {
  opacity: 0;
}
</style>
