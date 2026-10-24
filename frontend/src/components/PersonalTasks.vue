<script setup lang="ts">
import { computed } from 'vue';
import { certificationStatus, kstDate, credentialCurrent, renewalPhase } from '@eks/contracts';
import { useDemo } from '../stores/demo';
const store = useDemo();
const plans = computed(() =>
  store.actor.certificationEligibility === 'hold'
    ? []
    : store.data.plans.filter((p) => p.learnerId === store.actorId && p.status === 'draft'),
);
const requests = computed(() =>
  store.actor.certificationEligibility === 'hold'
    ? []
    : store.data.planningRequests.filter(
        (r) =>
          r.learnerId === store.actorId &&
          !r.completion &&
          r.organizationId === store.actor.organizationId,
      ),
);
const expiring = computed(() =>
  store.actor.certificationEligibility === 'hold'
    ? []
    : store.myAssignments.filter(
        (a) =>
          a.certification &&
          (['upcoming', 'open'].includes(renewalPhase(a.certification)?.state || '') ||
            certificationStatus(a.certification) === 'revoked'),
      ),
);
const alerts = computed(() =>
  store.data.notifications
    .filter((n) => !n.readAt && !n.resolvedAt)
    .slice(-3)
    .reverse(),
);
</script>
<template>
  <section
    v-if="plans.length || requests.length || expiring.length || alerts.length"
    class="panel editor-panel personal-tasks"
  >
    <div class="section-heading">
      <h2>다음 할 일과 알림</h2>
      <RouterLink to="/notifications" class="text-link">알림함</RouterLink>
    </div>
    <RouterLink v-for="r in requests" :key="r.id" :to="`/plans?request=${r.id}`" class="simple-row"
      ><span
        ><strong>{{
          store.data.planningOptions.find((v) => v.requestId === r.id)?.canComplete
            ? '요청 전체 완료 확인'
            : '개인 인증 계획 작성 요청'
        }}</strong
        ><small
          >계획 작성 기한 {{ r.dueOn }}{{ r.dueOn < kstDate() ? ' · 기한 경과' : '' }} ·
          {{ r.message }}</small
        ></span
      ><span>{{
        store.data.planningOptions.find((v) => v.requestId === r.id)?.canComplete
          ? '완료 확인 →'
          : '요청 확인 →'
      }}</span></RouterLink
    >
    <RouterLink v-for="p in plans" :key="p.id" :to="`/plans/${p.id}`" class="simple-row"
      ><span
        ><strong>{{ store.qualification(p.qualificationId, p.qualificationMetadata).title }}</strong
        ><small>계획 작성 중</small></span
      ><span>계획 이어 쓰기 →</span></RouterLink
    >
    <RouterLink v-for="a in expiring" :key="a.id" :to="`/certifications/${a.id}`" class="simple-row"
      ><span
        ><strong>{{ store.qualification(a.qualificationId, a.qualificationMetadata).title }}</strong
        ><small
          >{{
            certificationStatus(a.certification!) === 'revoked'
              ? '자격 폐기 · 이력 확인'
              : renewalPhase(a.certification!)?.state === 'open'
                ? '재인증 가능'
                : '재인증 예정'
          }}
          · {{ a.certification && credentialCurrent(a.certification).expiresOn }}</small
        ></span
      ><span>유효기간 확인 →</span></RouterLink
    >
    <RouterLink v-for="n in alerts" :key="n.id" :to="n.href" class="simple-row"
      ><span
        ><strong>{{ n.title }}</strong
        ><small>{{ n.body }}</small></span
      ><span>확인 →</span></RouterLink
    >
  </section>
</template>
