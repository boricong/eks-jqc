<script setup lang="ts">
import { courseCategoryLabels } from '@eks/contracts';
defineProps<{ course: { category?: 'common' | 'specialized'; teamModified?: boolean } }>();
</script>
<template>
  <span class="course-category" :class="{ 'is-common': course.category === 'common' }"
    >{{ courseCategoryLabels[course.category || 'specialized']
    }}<span v-if="course.category === 'common' && course.teamModified"> · 팀 수정</span></span
  >
</template>
<style scoped>
.course-category {
  display: inline-block;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary, #273951);
  background: var(--surface-subtle, #f6f9fc);
  padding: 2px 6px;
  border: 1px solid var(--border, #e3e8ee);
  border-radius: 4px;
  white-space: nowrap;
}
.is-common {
  color: var(--primary, #4434d4);
  background: var(--primary-bg, #eef0ff);
}
</style>
