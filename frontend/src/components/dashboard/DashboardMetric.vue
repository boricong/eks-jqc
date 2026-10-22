<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
  unit?: string;
  note?: string;
  disabled?: boolean;
  warning?: boolean;
}>();
defineEmits<{ select: [] }>();
</script>
<template>
  <button
    type="button"
    class="dashboard-metric"
    :class="{ 'is-warning': warning }"
    :aria-label="`${label} ${value}${unit || ''} 명세 보기`"
    :disabled="disabled"
    @click="$emit('select')"
  >
    <span class="dashboard-metric-label">{{ label }}</span>
    <span class="dashboard-metric-value"
      >{{ typeof value === 'number' ? value.toLocaleString('ko-KR') : value
      }}<small v-if="unit">{{ unit }}</small></span
    >
    <span v-if="note" class="dashboard-metric-note">{{ note }}</span>
  </button>
</template>
