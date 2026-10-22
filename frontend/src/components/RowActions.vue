<script setup lang="ts">
import { ref, nextTick, onBeforeUnmount, useId } from 'vue';
defineProps<{ label: string; disabled?: boolean; actions: { id: string; label: string }[] }>();
const emit = defineEmits<{ action: [id: string] }>();
const trigger = ref<HTMLButtonElement>(),
  panel = ref<HTMLElement>();
const open = ref(false),
  left = ref(0),
  top = ref(0),
  id = useId();
defineExpose({ focus: () => trigger.value?.focus() });
function close(restore = false) {
  open.value = false;
  window.removeEventListener('scroll', dismiss, true);
  window.removeEventListener('resize', dismiss);
  document.removeEventListener('pointerdown', outside);
  if (restore) trigger.value?.focus();
}
function dismiss() {
  close();
}
function outside(event: PointerEvent) {
  if (
    !panel.value?.contains(event.target as Node) &&
    !trigger.value?.contains(event.target as Node)
  )
    close();
}
async function toggle() {
  if (open.value) return close(true);
  const bounds = trigger.value!.getBoundingClientRect();
  left.value = Math.max(16, Math.min(bounds.right - 200, innerWidth - 216));
  top.value = bounds.bottom + 4;
  open.value = true;
  await nextTick();
  if (panel.value && top.value + panel.value.offsetHeight > innerHeight - 16)
    top.value = Math.max(16, bounds.top - panel.value.offsetHeight - 4);
  panel.value?.querySelector('button')?.focus();
  window.addEventListener('scroll', dismiss, true);
  window.addEventListener('resize', dismiss);
  document.addEventListener('pointerdown', outside);
}
function choose(value: string) {
  close(true);
  emit('action', value);
}
function onFocusOut() {
  queueMicrotask(() => {
    if (open.value && !panel.value?.contains(document.activeElement)) close();
  });
}
onBeforeUnmount(() => close());
</script>
<template>
  <button
    ref="trigger"
    class="icon-button row-action-trigger"
    :aria-label="label"
    :aria-expanded="open"
    :aria-controls="open ? id : undefined"
    :disabled="disabled"
    @click="toggle"
  >
    ⋯
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      :id="id"
      ref="panel"
      class="row-action-popover"
      :style="{ left: `${left}px`, top: `${top}px` }"
      @keydown.esc.stop.prevent="close(true)"
      @focusout="onFocusOut"
    >
      <button v-for="item in actions" :key="item.id" @click="choose(item.id)">
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>
