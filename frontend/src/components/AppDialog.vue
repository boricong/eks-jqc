<script setup lang="ts">
import { ref, watch, nextTick, useId } from 'vue';
import AppIcon from './AppIcon.vue';
const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; closed: [] }>();
const dialog = ref<HTMLDialogElement>();
const titleId = useId();
watch(
  () => props.open,
  async (value) => {
    await nextTick();
    if (value && !dialog.value?.open) dialog.value?.showModal();
    else if (!value) dialog.value?.close();
  },
  { immediate: true },
);
function close() {
  emit('update:open', false);
}
</script>
<template>
  <dialog
    ref="dialog"
    class="dialog"
    :aria-labelledby="titleId"
    @close="emit('closed')"
    @cancel.prevent="close"
    @click="
      (event) => {
        if (event.target === dialog) close();
      }
    "
  >
    <div class="dialog-head">
      <h2 :id="titleId">{{ title }}</h2>
      <button class="icon-button" aria-label="닫기" @click="close"><AppIcon name="close" /></button>
    </div>
    <div class="dialog-body"><slot /></div>
    <div v-if="$slots.footer" class="dialog-footer"><slot name="footer" /></div>
  </dialog>
</template>
