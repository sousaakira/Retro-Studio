<script setup>
defineProps({
  isOpen: Boolean,
  filePath: { type: String, default: '' },
  staged: { type: Boolean, default: false },
  parsedDiff: { type: Array, default: () => [] }
})
defineEmits(['close'])
</script>

<template>
  <div v-if="isOpen" class="dialog-overlay" @click="$emit('close')">
    <div class="dialog" @click.stop style="max-width: 90vw; width: 1000px; max-height: 90vh;">
      <div class="dialog-header">
        <h3 style="margin: 0; font-size: 14px;">
          Diff: {{ filePath }}
          <span style="margin-left: 8px; font-size: 11px; color: var(--muted);">
            ({{ staged ? 'staged' : 'unstaged' }})
          </span>
        </h3>
        <button class="dialog-close" @click="$emit('close')" title="Close">×</button>
      </div>
      <div class="dialog-body" style="padding: 0; overflow: auto;">
        <div class="diff-viewer">
          <div
            v-for="(line, idx) in parsedDiff"
            :key="idx"
            :class="['diff-line', 'diff-line-' + line.type]"
          >
            <pre style="margin: 0; padding: 4px 8px; font-size: 12px; font-family: 'Courier New', monospace; white-space: pre-wrap; word-wrap: break-word;">{{ line.text }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
