<!-- Modal.vue -->
<template>
  <div v-if="showModal" class="modal" :style="{ top: modalTop + 'px', left: modalLeft + 'px', width: w }">
    <div class="modal-content"  :style="{ width: w, height: h }">
      <div class="header" @mousedown.prevent="startDrag">
        <div class="title">{{ title }}</div>
        <button class="close-button" @click="closeModal"><i class="fa fa-close"></i></button>
      </div>
      <!-- Seu conteúdo do modal aqui -->
      <div class="content">
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
  h: String
});

const openModal = () => {
  title.value = props.title
  w.value = props.w
  h.value = props.h
  showModal.value = true;
  centerModal();
};

defineExpose({
  openModal,
  title,
});

const closeModal = () => {
  showModal.value = false;
};

const startDrag = (event) => {
  // Verifica se o clique foi no título antes de iniciar o arraste
  if (event.target.classList.contains("title")) {
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
  const modalContent = document.querySelector('.modal-content');
  if (modalContent) {
    const modalWidth = modalContent.offsetWidth;
    const modalHeight = modalContent.offsetHeight;

    modalTop.value = (window.innerHeight - modalHeight) / 2;
    modalLeft.value = (window.innerWidth - modalWidth) / 2;
  }
};

onMounted(() => {
  window.addEventListener('resize', centerModal);
});

</script>

<style scoped>
/* Adicione estilos CSS para o modal aqui */
.modal {
  position: fixed;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  /* background-color: rgba(0, 0, 0, 0.5); */
  z-index: 9999;
}

.modal-content {
  background-color: rgba(0, 0, 0, 0.966);
  padding: 10px;
  border-radius: 3px;
  position: relative;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: grab;
  /* Adiciona o estilo de cursor apenas ao cabeçalho */
}

.title {
  text-align: center;
  flex-grow: 1;
}

.close-button {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  color: #fff;
}

.content {
  margin-top: 10px;
  color: #fff;
}
</style>
