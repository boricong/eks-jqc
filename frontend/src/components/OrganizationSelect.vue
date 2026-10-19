<script setup lang="ts">
import { computed } from 'vue';
import type { OrganizationEntry } from '@eks/contracts';
const props = defineProps<{
  modelValue: string;
  entries: OrganizationEntry[];
  fixedLv1?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const path = computed(() => props.entries.find((e) => e.id === props.modelValue)?.path ?? []);
function options(level: number) {
  const parent = level === 1 ? null : path.value[level - 2]?.id;
  return props.entries.filter(
    (e) =>
      e.level === level &&
      e.parentId === parent &&
      (e.effectiveActive || path.value.some((p) => p.id === e.id)) &&
      (!props.fixedLv1 || e.lv1OrganizationId === props.fixedLv1),
  );
}
function select(level: number, event: Event) {
  emit(
    'update:modelValue',
    (event.target as HTMLSelectElement).value || path.value[level - 2]?.id || '',
  );
}
</script>
<template>
  <div class="organization-select">
    <label v-for="level in 4" :key="level" class="field">
      <span>Lv{{ level }} 조직</span>
      <select
        :aria-label="`Lv${level} 조직`"
        :value="path[level - 1]?.id || ''"
        :disabled="disabled || (level === 1 && !!fixedLv1) || (level > 1 && !path[level - 2])"
        @change="select(level, $event)"
      >
        <option value="">{{ level === 1 ? '조직 선택' : '상위 조직 직속' }}</option>
        <option v-for="entry in options(level)" :key="entry.id" :value="entry.id">
          {{ entry.name }}{{ entry.effectiveActive ? '' : ' · 사용 중지' }}
        </option>
      </select>
    </label>
  </div>
</template>
