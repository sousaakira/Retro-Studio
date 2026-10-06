<template>
  <svg :viewBox="viewBox" xmlns="http://www.w3.org/2000/svg" style="image-rendering:pixelated; overflow:hidden">
    <defs><clipPath :id="clipId" clipPathUnits="userSpaceOnUse"><rect :x="bounds[0]" :y="bounds[1]" :width="bounds[2]" :height="bounds[3]" /></clipPath></defs>
    <image :href="href" :width="imageWidth" :height="imageHeight" :clip-path="`url(#${clipId})`" />
  </svg>
</template>
<script setup>
import { computed, useId } from 'vue'
const props = defineProps({ viewBox: { type: String, required: true }, href: String, imageWidth: Number, imageHeight: Number })
const clipId = `sprite-frame-${useId()}`
const bounds = computed(() => props.viewBox.trim().split(/\s+/).map(Number))
</script>
