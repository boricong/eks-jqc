<script setup lang="ts">
import type { PersonalPlan } from '@eks/contracts';
import { useDemo } from '../stores/demo';
defineProps<{ plan: PersonalPlan }>();
const store = useDemo();
</script>
<template>
  <details v-if="plan.previousSchedule" class="previous-plan">
    <summary>이전 계획 이력</summary>
    <p class="muted">변경 전 원본입니다. 현재 일정과 기한 경과 판단에는 사용하지 않습니다.</p>
    <p v-if="plan.previousSchedule.goalNeedsReview && !plan.goal" class="notice-body">
      이전 학습 목표가 2,000자를 넘어 통합하지 않았습니다. 원문을 참고해 자격 학습 목표를 정리할 수
      있습니다.
    </p>
    <p>이전 목표 인증일 {{ plan.previousSchedule.targetOn || '미정' }}</p>
    <section v-for="s in plan.previousSchedule.schedules" :key="s.courseId">
      <h4>{{ store.course(s.courseId).title }}</h4>
      <p>
        이전 학습 기간 {{ s.learningStart || '미정' }} ~ {{ s.learningEnd || '미정' }} · 이전 평가
        예정 {{ s.assessmentOn || '미정' }}
      </p>
      <p v-if="s.goal" class="preserve-lines">{{ s.goal }}</p>
    </section>
  </details>
</template>
<style scoped>
.previous-plan {
  margin-top: 24px;
  padding: 16px 0;
  border-top: 1px solid var(--line, #e3e8ee);
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
}
section {
  padding-top: 16px;
}
</style>
