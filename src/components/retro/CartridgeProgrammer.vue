<template>
  <div class="cartridge-programmer">
    <div class="cp-header">
      <h3>Cartridge Programmer</h3>
      <button @click="$emit('close')" class="close-btn">×</button>
    </div>
    <div class="cp-section">
      <label>Dispositivo</label>
      <div class="device-status" :class="{ connected: isConnected }">
        {{ isConnected ? 'Conectado' : 'Não conectado' }}
      </div>
      <button @click="detectDevice" :disabled="isDetecting">Detectar</button>
      <template v-if="devicePath">
        <button v-if="!isConnected" @click="connect" :disabled="isConnecting">Conectar</button>
        <button v-else @click="disconnect">Desconectar</button>
      </template>
    </div>
    <div class="cp-section">
      <label>ROM</label>
      <button @click="useCurrentRom" :disabled="!projectPath">Usar ROM do projeto</button>
      <input
        ref="fileInput"
        type="file"
        accept=".bin,.md,.smd"
        style="display:none"
        @change="onFileSelect"
      />
      <button @click="fileInput?.click()">Selecionar arquivo</button>
      <div v-if="romPath" class="rom-info">{{ romPath }}</div>
    </div>
    <div class="cp-section">
      <label>Serial</label>
      <div class="serial-output">
        <div v-for="(m, i) in serialMessages" :key="i" class="serial-line">{{ m }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  projectPath: { type: String, default: '' },
  show: { type: Boolean, default: true }
})

defineEmits(['close'])

const isConnected = ref(false)
const isDetecting = ref(false)
const isConnecting = ref(false)
const devicePath = ref(null)
const romPath = ref(null)
const serialMessages = ref([])
const fileInput = ref(null)

let unsubSerial = null
let unsubError = null

async function detectDevice() {
  isDetecting.value = true
  try {
    const r = await window.monarco?.retro?.detectCartridgeDevice?.()
    if (r?.devicePath) devicePath.value = r.devicePath
    else devicePath.value = null
  } finally {
    isDetecting.value = false
  }
}

async function connect() {
  if (!devicePath.value) return
  isConnecting.value = true
  try {
    const r = await window.monarco?.retro?.connectSerial?.(devicePath.value)
    isConnected.value = r?.success ?? false
  } finally {
    isConnecting.value = false
  }
}

async function disconnect() {
  if (!devicePath.value) return
  await window.monarco?.retro?.disconnectSerial?.(devicePath.value)
  isConnected.value = false
}

async function useCurrentRom() {
  const path = props.projectPath
  const r = await window.monarco?.retro?.getCurrentRomInfo?.(path)
  if (r?.success) romPath.value = r.path
}

function onFileSelect(e) {
  const f = e.target?.files?.[0]
  if (f) romPath.value = f.path || f.name
}

onMounted(() => {
  unsubSerial = window.monarco?.retro?.onSerialData?.((d) => {
    serialMessages.value.push(d?.data || '')
    if (serialMessages.value.length > 50) serialMessages.value.shift()
  })
  unsubError = window.monarco?.retro?.onSerialError?.((d) => {
    serialMessages.value.push(`[ERRO] ${d?.error || ''}`)
  })
  detectDevice()
})

onUnmounted(() => {
  unsubSerial?.()
  unsubError?.()
})
</script>

<style scoped>
.cartridge-programmer {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--muted);
}
.cp-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-section label {
  font-size: 12px;
  font-weight: 600;
}
.device-status.connected {
  color: var(--success, green);
}
.serial-output {
  height: 120px;
  overflow-y: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  font-family: monospace;
  font-size: 11px;
}
.serial-line {
  margin-bottom: 2px;
}
.rom-info {
  font-size: 11px;
  color: var(--muted);
}
button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  align-self: flex-start;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
