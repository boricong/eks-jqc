<script setup lang="ts">
import PropertyList from './PropertyList.vue';
import { credentialCurrent, kstDate, type Assignment, type Qualification } from '@eks/contracts';
import { computed, ref, useId } from 'vue';
import StatusBadge from './StatusBadge.vue';
import ValidityBadge from './ValidityBadge.vue';
import AppIcon from './AppIcon.vue';
const props = defineProps<{
  qualification: Qualification;
  assignment: Assignment;
  completed: number;
  passed: number;
  assessments: number;
  targetOn?: string;
}>();
const infoOpen = ref(false),
  infoId = useId();
const validity = computed(() => {
  const policy = props.qualification.validity;
  if (policy.type === 'unlimited') return '무기한';
  if (policy.type === 'months' && policy.months)
    return `취득 후 ${policy.months % 12 === 0 ? `${policy.months / 12}년` : `${policy.months}개월`}`;
  return '미설정';
});
</script>
<template>
  <section class="qualification-summary learning-hero" aria-label="자격 요약">
    <div class="learning-hero-main">
      <div class="learning-hero-title">
        <h1>{{ qualification.title }}</h1>
        <div class="learning-hero-meta">
          <span class="small-label">v{{ qualification.version }}</span>
          <StatusBadge
            v-if="assignment.excludedReason || assignment.certifiedAt"
            :status="assignment.excludedReason ? 'excluded' : 'certified'"
            :label="assignment.excludedReason ? '검증 제외' : '인증 취득'"
          />
          <span v-else class="status learning-progress-status"
            ><span class="learning-progress-dot" aria-hidden="true"></span>진행 중</span
          >
        </div>
      </div>
      <div class="learning-hero-actions">
        <button
          type="button"
          class="text-link"
          :aria-expanded="infoOpen"
          :aria-controls="infoId"
          @click="infoOpen = !infoOpen"
        >
          자격 정보<AppIcon name="down" :size="16" :class="{ 'is-open': infoOpen }" />
        </button>
      </div>
    </div>
    <div class="learning-hero-progress">
      <PropertyList class="qualification-facts">
        <div>
          <dt>수료 인증Set</dt>
          <dd>
            <strong>{{ completed }}</strong> / {{ assignment.enrollments.length }}
          </dd>
        </div>
        <div v-if="qualification.qualificationType !== 'auditor'">
          <dt>평가 통과</dt>
          <dd>
            <strong>{{ passed }}</strong> / {{ assessments }}
          </dd>
        </div>
        <div>
          <dt>목표 인증일</dt>
          <dd>
            <time v-if="targetOn" :datetime="targetOn">{{ targetOn }}</time
            ><span v-else>미설정</span>
          </dd>
        </div>
      </PropertyList>
      <RouterLink v-if="assignment.planId" :to="`/plans/${assignment.planId}`" class="text-link"
        >인증 계획 보기</RouterLink
      >
    </div>
    <div v-if="assignment.certification" class="learning-hero-award">
      <ValidityBadge :certification="assignment.certification" />
      <span>취득 {{ assignment.certifiedAt ? kstDate(assignment.certifiedAt) : '미설정' }}</span>
      <span v-if="credentialCurrent(assignment.certification).expiresOn"
        >만료 {{ credentialCurrent(assignment.certification).expiresOn }}</span
      >
      <RouterLink :to="`/certifications/${assignment.id}`" class="text-link"
        >인증서 보기</RouterLink
      >
    </div>
    <section
      v-show="infoOpen"
      :id="infoId"
      class="learning-hero-details"
      aria-label="자격 상세 정보"
    >
      <p v-if="qualification.description" class="prose-text">{{ qualification.description }}</p>
      <p v-if="qualification.englishName">{{ qualification.englishName }}</p>
      <p>인증기간 · {{ validity }}</p>
      <p>
        취득 조건 ·
        {{
          qualification.qualificationType === 'auditor'
            ? '필수 학습항목 본인 확인 및 필수 인증Set 전체 수료'
            : '필수 인증Set 전체 수료 및 설정된 평가 유형별 통과'
        }}
      </p>
    </section>
  </section>
</template>
