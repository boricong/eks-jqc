<script setup lang="ts">
import PageHeading from '../components/PageHeading.vue';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import CredentialLifecycle from '../components/CredentialLifecycle.vue';
import { kindLabels } from '@eks/contracts';
const store = useDemo(),
  route = useRoute();
const a = computed(() => {
  const a = store.assignment(String(route.params.id));
  return a?.certifiedAt &&
    (store.hasRole('system_operator') || store.hasRole('admin') || a.learnerId === store.actorId)
    ? a
    : undefined;
});
const back = computed(() =>
  store.canEnterManagement && route.query.lv1OrganizationId
    ? store.managementLink('/admin/results')
    : store.hasRole('system_operator')
      ? '/system/overview'
      : store.hasRole('admin')
        ? '/admin/results'
        : '/qualifications?filter=certified',
);
</script>
<template>
  <div v-if="a" class="container page">
    <RouterLink :to="back" class="back-link"><AppIcon name="back" :size="16" />목록으로</RouterLink>
    <PageHeading class="page-heading">
      <h1>자격 인증서 · 검증용</h1>
      <StatusBadge :status="a.excludedReason ? 'excluded' : 'certified'" />
    </PageHeading>
    <div class="cert-header">
      <span class="result-symbol"><AppIcon name="award" :size="36" /></span>
      <div>
        <span class="small-label">{{
          a.certification?.snapshot?.learnerName || store.username(a.learnerId)
        }}</span>
        <h2>
          {{
            a.certification?.snapshot?.title ||
            store.qualification(a.qualificationId, a.qualificationMetadata).title
          }}
        </h2>
        <p class="muted">
          v{{
            a.certification?.snapshot?.version ||
            store.qualification(a.qualificationId, a.qualificationMetadata).version
          }}
          · 취득일
          {{ new Date(a.certifiedAt!).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) }}
        </p>
      </div>
      <span class="cert-number"
        >{{ store.completedCount(a) }} / {{ a.enrollments.length
        }}<small>필수 인증Set 수료</small></span
      >
    </div>
    <p class="muted">
      {{
        (a.certification?.snapshot?.organizationPath || a.organizationPath)
          .map((o) => o.name)
          .join(' › ')
      }}
      ·
      {{
        a.certification?.snapshot?.source === 'issued' ? '발급 당시 표기' : '이관 시 확보한 표기'
      }}
    </p>
    <p class="small-label">인증 {{ a.certification?.id }}</p>
    <p
      v-if="
        store
          .qualification(a.qualificationId, a.qualificationMetadata)
          .description.includes('프로세스 검증용')
      "
      class="test-data-disclaimer"
    >
      프로세스 검증용 가상 기준으로 발급된 시험 인증입니다. 실제 사내 직무 자격으로 사용하지
      않습니다.
    </p>
    <CredentialLifecycle v-if="a.certification" :certification="a.certification" />
    <p v-if="a.excludedReason" class="error-message">검증 제외 · {{ a.excludedReason }}</p>
    <section class="panel evidence-panel">
      <div class="section-heading"><h2>수료 근거</h2></div>
      <details v-for="e in a.enrollments" :key="e.courseId" class="evidence-course">
        <summary>
          <span>{{ store.course(e.courseId).title }}</span
          ><StatusBadge status="complete" /><StatusBadge
            v-if="store.course(e.courseId).operationalStatus === 'retired'"
            status="retired"
          /><AppIcon name="down" :size="16" />
        </summary>
        <div
          v-for="kind in store.requiredKinds(store.course(e.courseId))"
          :key="kind"
          class="history-row"
        >
          <span
            >{{ kindLabels[kind] }} · 자동 채점<br />{{
              e.history.find(
                (h) => h.id === e.completion?.evidence.find((ev) => ev.kind === kind)?.attemptId,
              )?.earned
            }}
            /
            {{
              e.history.find(
                (h) => h.id === e.completion?.evidence.find((ev) => ev.kind === kind)?.attemptId,
              )?.total
            }}점</span
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
            ).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
          }}</span>
        </div>
        <RouterLink
          v-if="e.completion"
          class="text-link"
          :to="{
            path: `/completions/${e.completion.id}`,
            query: route.query.lv1OrganizationId
              ? { lv1OrganizationId: route.query.lv1OrganizationId }
              : {},
          }"
          >인증Set 수료증 보기 →</RouterLink
        >
      </details>
    </section>
  </div>
  <div v-else class="container page empty-state">
    <h1>인증을 찾을 수 없습니다.</h1>
    <RouterLink to="/" class="button secondary">홈으로</RouterLink>
  </div>
</template>
