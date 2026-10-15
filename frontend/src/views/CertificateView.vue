<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
const store = useDemo(),
  route = useRoute();
const a = computed(() => {
  const a = store.assignment(String(route.params.id));
  return a?.certifiedAt &&
    (store.hasRole('admin') || a.learnerId === store.actorId || a.ftId === store.actorId)
    ? a
    : undefined;
});
const back = computed(() =>
  store.hasRole('admin')
    ? '/admin/results'
    : store.hasRole('ft')
      ? '/evaluations'
      : '/qualifications?filter=certified',
);
</script>
<template>
  <div v-if="a" class="container page">
    <RouterLink :to="back" class="back-link"><AppIcon name="back" :size="16" />목록으로</RouterLink>
    <div class="page-heading">
      <h1>검증용 인증</h1>
      <StatusBadge :status="a.excludedReason ? 'excluded' : 'certified'" />
    </div>
    <div class="cert-header">
      <span class="result-symbol"><AppIcon name="award" :size="36" /></span>
      <div>
        <span class="small-label">{{ store.username(a.learnerId) }}</span>
        <h2>{{ store.qualification(a.qualificationId).title }}</h2>
        <p class="muted">
          v{{ store.qualification(a.qualificationId).version }} ·
          {{ new Date(a.certifiedAt!).toLocaleDateString('ko-KR') }}
        </p>
      </div>
      <span class="cert-number"
        >{{ store.completedCount(a) }} / {{ a.enrollments.length
        }}<small>필수 과정 수료</small></span
      >
    </div>
    <p class="small-label">인증 {{ a.certification?.id }}</p>
    <p v-if="a.excludedReason" class="error-message">검증 제외 · {{ a.excludedReason }}</p>
    <section class="panel evidence-panel">
      <div class="section-heading"><h2>수료 근거</h2></div>
      <details v-for="e in a.enrollments" :key="e.courseId" class="evidence-course">
        <summary>
          <span>{{ store.course(e.courseId).title }}</span
          ><StatusBadge status="complete" /><AppIcon name="down" :size="16" />
        </summary>
        <div
          v-for="kind in store.requiredKinds(store.course(e.courseId))"
          :key="kind"
          class="history-row"
        >
          <span>{{ kind === 'objective' ? '객관식' : '실기' }}</span
          ><StatusBadge status="passed" /><span
            >{{
              e.history.find(
                (h) => h.id === e.completion?.evidence.find((ev) => ev.kind === kind)?.attemptId,
              )?.round
            }}회</span
          ><span class="muted">{{
            new Date(
              e.history.find(
                (h) => h.id === e.completion?.evidence.find((ev) => ev.kind === kind)?.attemptId,
              )!.date,
            ).toLocaleDateString('ko-KR')
          }}</span>
        </div>
      </details>
    </section>
  </div>
  <div v-else class="container page empty-state">
    <h1>인증을 찾을 수 없습니다.</h1>
    <RouterLink to="/" class="button secondary">홈으로</RouterLink>
  </div>
</template>
