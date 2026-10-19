<script setup lang="ts">
import { computed } from 'vue';
import { certificationStatus, kstDate } from '@eks/contracts';
import { useDemo } from '../stores/demo';
const store = useDemo();
const plans = computed(() =>
  store.data.plans.filter((p) => p.learnerId === store.actorId && p.status === 'draft'),
);
const requests = computed(() =>
  store.data.planningRequests.filter(
    (r) => r.learnerId === store.actorId && !store.data.plans.some((p) => p.requestId === r.id),
  ),
);
const expiring = computed(() =>
  store.myAssignments.filter(
    (a) =>
      a.certification && ['expiring', 'expired'].includes(certificationStatus(a.certification)),
  ),
);
const alerts = computed(() =>
  store.data.notifications
    .filter((n) => !n.readAt)
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
        ><strong>개인 인증 계획 작성 요청</strong
        ><small
          >계획 작성 기한 {{ r.dueOn }}{{ r.dueOn < kstDate() ? ' · 기한 경과' : '' }} ·
          {{ r.message }}</small
        ></span
      ><span>계획 시작 →</span></RouterLink
    >
    <RouterLink v-for="p in plans" :key="p.id" :to="`/plans/${p.id}`" class="simple-row"
      ><span
        ><strong>{{ store.qualification(p.qualificationId).title }}</strong
        ><small>계획 작성 중</small></span
      ><span>계획 이어 쓰기 →</span></RouterLink
    >
    <RouterLink v-for="a in expiring" :key="a.id" :to="`/certifications/${a.id}`" class="simple-row"
      ><span
        ><strong>{{ store.qualification(a.qualificationId).title }}</strong
        ><small
          >{{
            certificationStatus(a.certification!) === 'expired' ? '유효기간 만료' : '만료 예정'
          }}
          · {{ a.certification?.expiresOn }}</small
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
