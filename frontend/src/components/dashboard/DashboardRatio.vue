<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ fulfilled: number; total: number }>();
const percent = computed(() =>
  props.total ? Math.min(100, (props.fulfilled / props.total) * 100) : 0,
);
</script>
<template>
  <span v-if="!total" class="dashboard-meta">필수 자격 없음</span>
  <span v-else class="dashboard-ratio">
    <span class="dashboard-ratio-track" aria-hidden="true"
      ><span :style="{ width: `${percent}%` }"></span
    ></span>
    <span
      >{{ fulfilled }} / {{ total }} <small>({{ percent.toFixed(1) }}%)</small></span
    >
  </span>
</template>
