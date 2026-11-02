<script setup lang="ts">
import { ref, watch, nextTick, useId } from 'vue';
import AppIcon from './AppIcon.vue';
const props = defineProps<{
  open: boolean;
  title: string;
  descriptionId?: string;
  busy?: boolean;
  scrollBody?: boolean;
}>();
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
  if (!props.busy) emit('update:open', false);
}
</script>
<template>
  <dialog
    ref="dialog"
    class="dialog"
    :class="{ 'dialog-scroll-body': scrollBody }"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
    :aria-busy="busy || undefined"
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
      <button type="button" class="icon-button" aria-label="닫기" :disabled="busy" @click="close">
        <AppIcon name="close" />
      </button>
    </div>
    <div class="dialog-body"><slot /></div>
    <div v-if="$slots.footer" class="dialog-footer"><slot name="footer" /></div>
  </dialog>
</template>
<style scoped>
.dialog-scroll-body[open] {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dialog-scroll-body > .dialog-head,
.dialog-scroll-body > .dialog-footer {
  flex-shrink: 0;
}
.dialog-scroll-body > .dialog-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
</style>
