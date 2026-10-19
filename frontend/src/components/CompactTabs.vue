<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';
defineProps<{
  items: { id: string; label: string; invalid?: boolean }[];
  modelValue: string;
  label: string;
  panelId: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
const host = ref<HTMLElement>();
const prefix = useId();
const tabId = (id: string) => `${prefix}-${id}`;
async function move(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const tabs = [...host.value!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const current = tabs.indexOf(event.target as HTMLButtonElement);
  const target =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[target]?.click();
  await nextTick();
  tabs[target]?.focus();
  tabs[target]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
defineExpose({ tabId });
</script>
<template>
  <div ref="host" class="compact-tabs" role="tablist" :aria-label="label" @keydown="move">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      role="tab"
      :id="tabId(item.id)"
      :title="item.label"
      :aria-label="`${item.label}${item.invalid ? ' · 보완 필요' : ''}`"
      :aria-controls="modelValue === item.id ? panelId : undefined"
      :aria-selected="modelValue === item.id"
      :tabindex="modelValue === item.id ? 0 : -1"
      @click="emit('update:modelValue', item.id)"
    >
      <span>{{ item.label }}</span
      ><span v-if="item.invalid" class="tab-warning" aria-hidden="true">!</span>
    </button>
  </div>
</template>
