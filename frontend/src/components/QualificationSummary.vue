<script setup lang="ts">
import PropertyList from './PropertyList.vue';
import { credentialCurrent } from '@eks/contracts';
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount, useId } from 'vue';
import { kstDate, type Assignment, type Qualification } from '@eks/contracts';
import StatusBadge from './StatusBadge.vue';
import ValidityBadge from './ValidityBadge.vue';
const props = defineProps<{
  qualification: Qualification;
  assignment: Assignment;
  completed: number;
  passed: number;
  assessments: number;
  targetOn?: string;
}>();
const descriptionId = useId(),
  description = ref<HTMLElement>(),
  expanded = ref(false),
  hasMore = ref(false);
const progress = computed(() =>
  props.assessments ? Math.round((props.passed / props.assessments) * 100) : 0,
);
const validity = computed(() => {
  const policy = props.qualification.validity;
  if (policy.type === 'unlimited') return '무기한';
  if (policy.type === 'months' && policy.months)
    return `취득 후 ${policy.months % 12 === 0 ? `${policy.months / 12}년` : `${policy.months}개월`}`;
  return '미설정';
});
function measure() {
  if (description.value) {
    const line = parseFloat(getComputedStyle(description.value).lineHeight);
    hasMore.value = description.value.scrollHeight > line * 3 + 2;
  }
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (description.value) observer.observe(description.value);
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => props.qualification.description,
  async () => {
    expanded.value = false;
    await nextTick();
    measure();
  },
);
</script>
<template>
  <section class="panel qualification-summary" aria-label="자격 요약">
    <div class="qualification-summary-heading">
      <div>
        <div class="heading-meta">
          <span>v{{ qualification.version }}</span
          ><span>필수 {{ assignment.enrollments.length }}인증Set</span>
        </div>
        <h2>{{ qualification.title }}</h2>
        <p v-if="qualification.englishName" class="muted">{{ qualification.englishName }}</p>
      </div>
      <StatusBadge
        :status="
          assignment.excludedReason ? 'excluded' : assignment.certifiedAt ? 'certified' : 'ready'
        "
        :label="
          assignment.excludedReason ? '검증 제외' : assignment.certifiedAt ? '인증 취득' : '진행 중'
        "
      />
    </div>
    <div class="qualification-description">
      <h3>자격 설명</h3>
      <p
        :id="descriptionId"
        ref="description"
        class="prose-text"
        :class="{ 'is-clamped': !expanded }"
      >
        {{ qualification.description || '등록된 자격 설명이 없습니다.' }}
      </p>
      <button
        v-if="hasMore"
        class="text-link"
        :aria-expanded="expanded"
        :aria-controls="descriptionId"
        @click="expanded = !expanded"
      >
        {{ expanded ? '설명 접기' : '전체 설명 보기' }}
      </button>
    </div>
    <div class="qualification-conditions">
      <h3>취득 조건</h3>
      <p>필수 인증Set 전체 수료 · 각 인증Set에 설정된 평가 유형별 통과</p>
    </div>
    <PropertyList class="qualification-facts">
      <div>
        <dt>수료 인증Set</dt>
        <dd>{{ completed }} / {{ assignment.enrollments.length }}</dd>
      </div>
      <div>
        <dt>평가 통과</dt>
        <dd>{{ passed }} / {{ assessments }}</dd>
      </div>
      <div>
        <dt>목표 인증일</dt>
        <dd>
          <time v-if="targetOn" :datetime="targetOn">{{ targetOn }}</time
          ><span v-else>미설정</span>
        </dd>
      </div>
      <div>
        <dt>취득 후 인증기간</dt>
        <dd>{{ validity }}</dd>
      </div>
    </PropertyList>
    <div
      class="qualification-progress"
      role="progressbar"
      aria-label="자격 평가 통과율"
      :aria-valuenow="progress"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuetext="`평가 ${passed} / ${assessments} 통과`"
    >
      <span :style="{ width: `${progress}%` }"></span>
    </div>
    <div v-if="assignment.certification" class="qualification-award">
      <div>
        <span>취득 {{ assignment.certifiedAt ? kstDate(assignment.certifiedAt) : '미설정' }}</span
        ><ValidityBadge :certification="assignment.certification" /><span
          v-if="credentialCurrent(assignment.certification).expiresOn"
          >만료 {{ credentialCurrent(assignment.certification).expiresOn }}</span
        >
      </div>
      <RouterLink :to="`/certifications/${assignment.id}`" class="button primary"
        >인증서 보기</RouterLink
      >
    </div>
  </section>
</template>
