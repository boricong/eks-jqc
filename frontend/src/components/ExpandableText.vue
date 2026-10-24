<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
const props = withDefaults(defineProps<{ text: string; subject: string; lines?: number }>(), {
  lines: 3,
});
const collapsedLines = computed(() => Math.max(1, Math.floor(props.lines)));
const expanded = defineModel<boolean>('expanded', { default: false });
const element = ref<HTMLElement>();
const more = ref(false),
  id = useId();
let observer: ResizeObserver | undefined;
function measure() {
  if (element.value)
    more.value =
      element.value.scrollHeight >
      parseFloat(getComputedStyle(element.value).lineHeight) * collapsedLines.value + 2;
}
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (element.value) observer.observe(element.value);
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => props.text,
  async () => {
    expanded.value = false;
    await nextTick();
    measure();
  },
);
watch(collapsedLines, async () => {
  await nextTick();
  measure();
});
</script>
<template>
  <div class="learning-expandable" :style="{ '--collapsed-lines': collapsedLines }">
    <p ref="element" :id="id" class="prose-text" :class="{ 'is-clamped': !expanded }">{{ text }}</p>
    <button
      v-if="more"
      type="button"
      class="text-link"
      :aria-expanded="expanded"
      :aria-controls="id"
      @click="expanded = !expanded"
    >
      {{ expanded ? `${subject} 접기` : `전체 ${subject} 보기` }}
    </button>
  </div>
</template>
