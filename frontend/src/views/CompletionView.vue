<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { kindLabels } from '@eks/contracts';
import { useDemo } from '../stores/demo';
const store = useDemo(),
  route = useRoute();
const a = computed(() =>
  store.data.assignments.find((a) =>
    a.enrollments.some((e) => e.completion?.id === route.params.id),
  ),
);
const e = computed(() => a.value?.enrollments.find((e) => e.completion?.id === route.params.id));
const record = computed(() => e.value?.completion);
const back = computed(() =>
  route.query.lv1OrganizationId && store.canEnterManagement
    ? store.managementLink('/admin/results')
    : a.value?.learnerId === store.actorId
      ? `/qualifications/${a.value?.id}?course=${e.value?.courseId}`
      : store.hasRole('system_operator')
        ? '/system/overview'
        : store.hasRole('admin')
          ? '/admin/results'
          : '/evaluations',
);
</script>
<template>
  <div v-if="a && e && record" class="container page">
    <RouterLink :to="back" class="back-link">목록으로</RouterLink>
    <div class="page-heading">
      <h1>검증용 과정 수료증</h1>
      <span>과정 수료</span>
    </div>
    <section class="panel award-document">
      <p>{{ record.snapshot?.learnerName || store.username(a.learnerId) }}</p>
      <h2>{{ record.snapshot?.title || store.course(record.courseId).title }}</h2>
      <p>v{{ record.snapshot?.version || store.course(record.courseId).version }}</p>
      <p>
        {{
          (record.snapshot?.organizationPath || a.organizationPath).map((p) => p.name).join(' › ')
        }}
      </p>
      <p>
        수료일 {{ new Date(record.date).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) }}
      </p>
      <p class="small-label">발급번호 {{ record.id }}</p>
      <p v-if="record.snapshot?.source === 'migration'" class="muted">
        표기 정보는 이관 시 확보한 정보입니다.
      </p>
    </section>
    <section class="panel editor-panel">
      <h2>수료 근거</h2>
      <p v-for="item in record.evidence" :key="item.kind">
        {{ kindLabels[item.kind] }} 통과 ·
        {{ e.history.find((h) => h.id === item.attemptId)?.round }}회 ·
        {{
          new Date(e.history.find((h) => h.id === item.attemptId)!.date).toLocaleDateString(
            'ko-KR',
            { timeZone: 'Asia/Seoul' },
          )
        }}
      </p>
      <p v-if="store.course(record.courseId).operationalStatus === 'retired'" class="muted">
        현재 운영 종료된 과정입니다. 수료 기록과 평가 근거는 유지됩니다.
      </p>
      <RouterLink
        v-if="a.certification"
        :to="
          store.canEnterManagement && route.query.lv1OrganizationId
            ? store.managementLink(`/certifications/${a.id}`)
            : `/certifications/${a.id}`
        "
        class="button secondary"
        >자격 인증서 보기</RouterLink
      >
    </section>
  </div>
  <div v-else class="container page empty-state">
    <h1>수료증을 찾을 수 없습니다.</h1>
    <RouterLink to="/">홈으로</RouterLink>
  </div>
</template>
