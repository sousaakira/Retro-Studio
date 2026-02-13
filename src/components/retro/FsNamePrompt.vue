<template>
  <Teleport to="body">
    <div v-if="show" class="prompt-overlay" @click.self="$emit('cancel')">
      <div class="prompt-dialog">
        <h3>{{ title }}</h3>
        <input
          ref="inputRef"
          v-model="localValue"
          type="text"
          :placeholder="placeholder"
          class="prompt-input"
          @keydown.enter="$emit('confirm', localValue)"
          @keydown.escape="$emit('cancel')"
        />
        <div class="prompt-actions">
          <button @click="$emit('cancel')">Cancelar</button>
          <button class="primary" @click="$emit('confirm', localValue)">OK</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  show: Boolean,
  title: { type: String, default: 'Nome' },
  placeholder: { type: String, default: '' }
})

defineEmits(['confirm', 'cancel'])

const localValue = ref('')
const inputRef = ref(null)

watch(
  () => props.show,
  (v) => {
    if (v) {
      localValue.value = ''
      setTimeout(() => inputRef.value?.focus(), 50)
    }
  }
)
</script>

<style scoped>
.prompt-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.prompt-dialog {
  background: var(--panel);
  padding: 20px;
  border-radius: 8px;
  min-width: 300px;
}
.prompt-dialog h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
}
.prompt-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  margin-bottom: 12px;
}
.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.prompt-actions button {
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.prompt-actions button.primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
</style>
