<script setup>
defineProps({
  isOpen: Boolean,
  modelValue: { type: String, default: '' }
})
defineEmits(['update:modelValue', 'create', 'close'])
</script>

<template>
  <div v-if="isOpen" class="dialog-overlay" @click="$emit('close')">
    <div class="dialog" @click.stop style="max-width: 400px;">
      <div class="dialog-header">
        <h3 style="margin: 0; font-size: 14px;">Create New Branch</h3>
        <button class="dialog-close" @click="$emit('close')" title="Close">×</button>
      </div>
      <div class="dialog-body" style="padding: 16px;">
        <label style="display: block; margin-bottom: 8px; font-size: 12px; font-weight: 500;">Branch name:</label>
        <input
          :value="modelValue"
          type="text"
          placeholder="e.g., feature/new-feature"
          @input="$emit('update:modelValue', $event.target.value)"
          @keyup.enter="$emit('create')"
          @keyup.esc="$emit('close')"
          style="width: 100%; padding: 8px; font-size: 13px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px;"
          autofocus
        />
      </div>
      <div class="dialog-footer" style="display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid var(--border);">
        <button @click="$emit('close')" style="padding: 6px 12px; font-size: 12px;">Cancel</button>
        <button
          @click="$emit('create')"
          :disabled="!modelValue.trim()"
          style="padding: 6px 12px; font-size: 12px; background: var(--accent); color: white;"
        >
          Create
        </button>
      </div>
    </div>
  </div>
</template>
