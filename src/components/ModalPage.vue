<!-- Modal.vue -->
<template>
  <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
    <div class="modal" :style="{ width: w, height: h }">
      <div class="modal-header" @mousedown.prevent="startDrag">
        <div class="modal-title">
          <i v-if="icon" :class="icon"></i>
          {{ title }}
        </div>
        <button class="close-button" @click="closeModal" title="Close (Esc)">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="modal-content">
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, defineExpose, defineProps } from 'vue';

const showModal = ref(false);
const title = ref("Titulo");
const modalTop = ref(0);
const modalLeft = ref(0);
const mouseX = ref(0);
const mouseY = ref(0);
const isDragging = ref(false);

const w = ref()
const h = ref()

const props = defineProps({
  title: String,
  w: String,
  h: String,
  icon: String
});

const openModal = () => {
  title.value = props.title
  w.value = props.w
  h.value = props.h
  showModal.value = true;
  centerModal();
  
  // Add escape key listener
  document.addEventListener('keydown', handleEscape)
};

defineExpose({
  openModal,
  title,
});

const closeModal = () => {
  showModal.value = false;
  document.removeEventListener('keydown', handleEscape)
};

const handleEscape = (e) => {
  if (e.key === 'Escape' && showModal.value) {
    closeModal()
  }
};

const startDrag = (event) => {
  // Verifica se o clique foi no header antes de iniciar o arraste
  if (event.target.closest('.modal-header') && !event.target.closest('.close-button')) {
    isDragging.value = true;
    mouseX.value = event.clientX;
    mouseY.value = event.clientY;

    // Adiciona o listener global para acompanhar o movimento do mouse
    window.addEventListener("mousemove", handleDrag);
    window.addEventListener("mouseup", stopDrag);
  }
};

const handleDrag = (event) => {
  if (isDragging.value) {
    const deltaX = event.clientX - mouseX.value;
    const deltaY = event.clientY - mouseY.value;

    modalTop.value += deltaY;
    modalLeft.value += deltaX;

    mouseX.value = event.clientX;
    mouseY.value = event.clientY;
  }
};

const stopDrag = () => {
  isDragging.value = false;

  // Remove os listeners globais após soltar o mouse
  window.removeEventListener("mousemove", handleDrag);
  window.removeEventListener("mouseup", stopDrag);
};

const centerModal = () => {
  // Modal is centered via CSS, but we can adjust if needed
  modalTop.value = 0
  modalLeft.value = 0
};

onMounted(() => {
  window.addEventListener('resize', centerModal);
});

</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10000;
  backdrop-filter: blur(2px);
}

.modal {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-width: 95vw;
  max-height: 95vh;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #252525;
  border-bottom: 1px solid #333;
  cursor: grab;
  user-select: none;
}

.modal-header:active {
  cursor: grabbing;
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ccc;
  font-size: 16px;
  font-weight: 500;
  flex: 1;
}

.modal-title i {
  color: #0066cc;
}

.close-button {
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  font-size: 16px;
}

.close-button:hover {
  background: #333;
  color: #fff;
}

.modal-content {
  flex: 1;
  overflow: auto;
  color: #ccc;
  padding: 0;
}
</style>
