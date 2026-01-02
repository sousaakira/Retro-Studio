// Crie um arquivo chamado v-height.js (ou outro nome que preferir)
import { onMounted, onUnmounted } from 'vue';

export default {
  mounted(el) {
    el.style.height = window.innerHeight - el.offsetTop + 'px';

    const onResize = () => {
      el.style.height = window.innerHeight - el.offsetTop + 'px';
    };

    window.addEventListener('resize', onResize);

    onMounted(() => {
      onResize();
    });

    onUnmounted(() => {
      window.removeEventListener('resize', onResize);
    });
  }
}
