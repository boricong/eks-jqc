<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue';
const props = defineProps<{
  items: { id: string; label: string; ariaLabel?: string; invalid?: boolean }[];
  modelValue: string;
  label: string;
  panelId: string;
  vertical?: boolean;
  numbered?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
const host = ref<HTMLElement>();
const prefix = useId();
const tabId = (id: string) => `${prefix}-${id}`;
watch(
  () => props.modelValue,
  async () => {
    await nextTick();
    const tab = host.value?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!tab || !host.value) return;
    const parent = host.value;
    if (props.vertical) {
      const offset =
        tab.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop;
      if (offset < parent.scrollTop) parent.scrollTop = offset;
      else if (offset + tab.offsetHeight > parent.scrollTop + parent.clientHeight)
        parent.scrollTop = offset + tab.offsetHeight - parent.clientHeight;
    } else {
      const offset =
        tab.getBoundingClientRect().left - parent.getBoundingClientRect().left + parent.scrollLeft;
      if (offset < parent.scrollLeft) parent.scrollLeft = offset;
      else if (offset + tab.offsetWidth > parent.scrollLeft + parent.clientWidth)
        parent.scrollLeft = offset + tab.offsetWidth - parent.clientWidth;
    }
  },
);
async function move(event: KeyboardEvent) {
  if (
    ![
      ...(props.vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']),
      'Home',
      'End',
    ].includes(event.key)
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  const tabs = [...host.value!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const current = tabs.indexOf(event.target as HTMLButtonElement);
  const target =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[target]?.click();
  await nextTick();
  tabs[target]?.focus();
  tabs[target]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
defineExpose({ tabId });
</script>
<template>
  <div
    ref="host"
    class="compact-tabs"
    :class="{ 'vertical-tabs': vertical, 'number-tabs': numbered }"
    role="tablist"
    :aria-orientation="vertical ? 'vertical' : 'horizontal'"
    :aria-label="label"
    @keydown="move"
  >
    <button
      v-for="(item, index) in items"
      :key="item.id"
      type="button"
      role="tab"
      :id="tabId(item.id)"
      :title="item.ariaLabel || item.label"
      :aria-label="`${item.ariaLabel || item.label}${item.invalid ? ' · 보완 필요' : ''}`"
      :aria-controls="modelValue === item.id ? panelId : undefined"
      :aria-selected="modelValue === item.id"
      :tabindex="modelValue === item.id ? 0 : -1"
      @click="emit('update:modelValue', item.id)"
    >
      <span>{{ numbered ? index + 1 : item.label }}</span
      ><span v-if="item.invalid" class="tab-warning" aria-hidden="true">!</span>
    </button>
  </div>
</template>
