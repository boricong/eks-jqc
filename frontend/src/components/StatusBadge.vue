<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
const props = defineProps<{ status: string; label?: string }>();
const names: Record<string, string> = {
  Ready: 'Ready · 대기',
  active: '운영 중',
  ready: '미시작',
  retired: '운영 종료',
  draft: '작성 중',
  passed: '통과',
  failed: '미통과',
  complete: '수료',
  published: '사용 중',
  catalogDraft: '초안',
  excluded: '검증 제외',
  certified: '인증 완료',
};
const icon = computed(() =>
  ['passed', 'complete', 'certified'].includes(props.status)
    ? 'check'
    : props.status === 'failed'
      ? 'retry'
      : props.status === 'excluded'
        ? 'alert'
        : 'circle',
);
</script>
<template>
  <span class="status" :class="`status-${status}`"
    ><AppIcon :name="icon" :size="14" />{{ label || names[status] || status }}</span
  >
</template>
