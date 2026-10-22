<script setup lang="ts">
import { computed } from 'vue';
import { useDemo } from '../stores/demo';
const store = useDemo(),
  view = computed(() => store.data.requiredQualifications);
const labels = {
  fulfilled: '필수 충족',
  expired: '만료',
  unknown: '효력 확인 필요',
  draft: '작성 중',
  progress: '진행 중',
  ready: '계획 시작 가능',
  waiting: '요청 대기',
  blocked: '신규 계획 불가',
};
</script>
<template>
  <section
    v-if="view"
    class="panel editor-panel required-qualifications"
    aria-label="내 소속 필수 자격"
  >
    <div class="section-heading">
      <h2>내 소속 필수 자격</h2>
      <span v-if="store.actor.certificationEligibility === 'hold'"
        >대상자 Hold · 충족 통계에서 제외</span
      >
      <span v-else-if="view.configured"
        >{{ view.items.filter((i) => i.status === 'fulfilled').length }} /
        {{ view.items.length }} 유효 인증 보유</span
      >
    </div>
    <p class="organization-path">{{ view.organizationPath.map((p) => p.name).join(' › ') }}</p>
    <p v-if="view.description">{{ view.description }}</p>
    <p v-if="view.duties">담당 업무 · {{ view.duties }}</p>
    <p v-if="!view.configured" class="notice-body">
      조직 기준 미설정 · 관리자가 필수 자격을 설정한 뒤 계획 요청을 보내면 시작할 수 있습니다.
    </p>
    <p v-else-if="!view.items.length" class="muted">
      관리자가 이 조직에 필수 자격이 없음을 확인했습니다.
    </p>
    <div v-for="item in view.items" :key="item.entityId" class="required-row">
      <div>
        <strong>{{ item.title }}</strong
        ><span class="small-label">v{{ item.version }} · {{ labels[item.status] }}</span>
        <p>{{ item.reason }}</p>
        <p v-if="item.requestedVersion && item.requestedVersion !== item.version" class="muted">
          요청 당시 v{{ item.requestedVersion }} → 현재 팀 적용 v{{ item.version }}
        </p>
      </div>
      <RouterLink
        v-if="item.status === 'fulfilled' && item.assignmentId"
        :to="`/certifications/${item.assignmentId}`"
        class="button secondary"
        >인증서 보기</RouterLink
      >
      <RouterLink
        v-else-if="['expired', 'unknown'].includes(item.status) && item.assignmentId"
        :to="`/certifications/${item.assignmentId}`"
        class="button secondary"
        >유효기간 확인</RouterLink
      >
      <RouterLink
        v-else-if="item.assignmentId && !['expired', 'unknown'].includes(item.status)"
        :to="`/qualifications/${item.assignmentId}`"
        class="button secondary"
        >학습·평가 이어서 진행</RouterLink
      >
      <RouterLink v-else-if="item.planId" :to="`/plans/${item.planId}`" class="button secondary"
        >계획 이어 쓰기</RouterLink
      >
      <RouterLink
        v-else-if="item.canStart"
        :to="{
          path: '/plans',
          query: { request: item.requestId, qualification: item.qualificationId },
        }"
        class="button primary"
        >계획 시작</RouterLink
      >
    </div>
  </section>
</template>
