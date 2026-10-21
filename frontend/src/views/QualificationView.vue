<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
import LearnerNav from '../components/LearnerNav.vue';
import CourseMaterials from '../components/CourseMaterials.vue';

import { kindLabels, learningTypeLabels } from '@eks/contracts';
import type { Kind } from '../types';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const assignment = computed(() => {
  const a = store.assignment(String(route.params.id));
  return a?.learnerId === store.actorId ? a : undefined;
});
const selected = computed(
  () =>
    assignment.value?.enrollments.find((e) => e.courseId === route.query.course) ||
    assignment.value?.enrollments.find((e) =>
      store.requiredKinds(store.course(e.courseId)).some((kind) => !['passed'].includes(e[kind])),
    ) ||
    assignment.value?.enrollments.find((e) => !store.complete(e)) ||
    assignment.value?.enrollments[0],
);
const course = computed(() => selected.value && store.course(selected.value.courseId));
const showAssessments = computed(() => route.query.stage === 'assessment');
const schedule = computed(() =>
  store.data.plans
    .find((p) => p.id === assignment.value?.planId)
    ?.schedules.find((s) => s.courseId === course.value?.id),
);
const previousCriteria = computed(
  () =>
    !store.data.requiredQualifications?.items.some(
      (i) => i.qualificationId === assignment.value?.qualificationId,
    ),
);
const recommended = computed(
  () =>
    course.value &&
    selected.value &&
    store.requiredKinds(course.value).find((k) => !['passed'].includes(selected.value![k])),
);
const labels = kindLabels;
function action(kind: Kind) {
  const state = selected.value![kind];
  return state === 'draft' ? '답안 이어 쓰기' : state === 'failed' ? '다시 응시' : '응시하기';
}
function assessmentPath(kind: Kind) {
  return `/qualifications/${assignment.value!.id}/courses/${course.value!.id}/${kind}`;
}
</script>
<template>
  <div v-if="assignment && selected && course" class="container page process-page">
    <LearnerNav />
    <RouterLink to="/qualifications" class="back-link"
      ><AppIcon name="back" :size="16" />자격 취득</RouterLink
    >
    <div class="page-heading">
      <div>
        <h1>{{ store.qualification(assignment.qualificationId).title }}</h1>
        <div class="heading-meta">
          <span>v{{ store.qualification(assignment.qualificationId).version }}</span
          ><span>필수 {{ assignment.enrollments.length }}과정</span>
        </div>
      </div>
      <RouterLink
        v-if="assignment.certifiedAt"
        :to="`/certifications/${assignment.id}`"
        class="button primary"
        ><AppIcon name="award" :size="18" />인증 보기</RouterLink
      ><span v-else class="progress-count"
        ><strong>{{ store.completedCount(assignment) }}</strong> /
        {{ assignment.enrollments.length }} 과정 수료</span
      >
    </div>
    <p v-if="assignment.excludedReason" class="error-message">
      검증 제외 · {{ assignment.excludedReason }}
    </p>
    <p v-if="assignment.planId" class="muted">
      <RouterLink :to="`/plans/${assignment.planId}`" class="text-link"
        >인증 계획 · 일정·목표 확인</RouterLink
      >
    </p>
    <div class="workspace-grid">
      <aside class="course-sidebar">
        <h2 class="small-heading">과정</h2>
        <nav aria-label="필수 과정">
          <button
            v-for="(e, index) in assignment.enrollments"
            :key="e.courseId"
            class="course-nav"
            :class="{ selected: selected.courseId === e.courseId }"
            :aria-current="selected.courseId === e.courseId ? 'step' : undefined"
            @click="router.replace({ query: { course: e.courseId } })"
          >
            <span class="course-number"
              ><AppIcon v-if="store.complete(e)" name="check" :size="16" /><template v-else>{{
                String(index + 1).padStart(2, '0')
              }}</template></span
            ><span
              ><strong>{{ store.course(e.courseId).title }}</strong
              ><small>{{
                store.complete(e)
                  ? '수료'
                  : `${store.requiredKinds(store.course(e.courseId)).filter((k) => e[k] === 'passed').length} / ${store.requiredKinds(store.course(e.courseId)).length} 평가 통과`
              }}</small></span
            >
          </button>
        </nav>
        <div class="sidebar-summary">
          <span>평가 통과</span
          ><strong
            >{{ store.passedCount(assignment) }} / {{ store.assessmentCount(assignment) }}</strong
          >
          <div class="progress-track">
            <span
              :style="{
                width: `${(store.passedCount(assignment) / store.assessmentCount(assignment)) * 100}%`,
              }"
            ></span>
          </div>
        </div>
      </aside>
      <div class="course-workspace">
        <div class="section-heading">
          <h2>{{ course.title }}</h2>
          <StatusBadge v-if="course.operationalStatus === 'retired'" status="retired" />
          <StatusBadge v-if="store.complete(selected)" status="complete" /><span
            v-else
            class="small-label"
            >필수</span
          >
        </div>
        <p v-if="previousCriteria" class="notice-body">
          이전 기준으로 진행 중 · 확정 당시 자격·과정 버전을 유지합니다.
        </p>
        <section
          v-if="!showAssessments"
          class="panel editor-panel learning-guide"
          aria-label="학습 안내"
        >
          <section class="text-stack qualification-overview" aria-label="자격 개요와 학습 목표">
            <h3>자격 개요와 학습 목표</h3>
            <div class="text-stack">
              <h4>자격 설명</h4>
              <p class="prose-text">
                {{ store.qualification(assignment.qualificationId).description }}
              </p>
            </div>
            <div v-if="schedule" class="text-stack">
              <h4>개인 학습 목표</h4>
              <p class="prose-text">{{ schedule.goal || '작성된 학습 목표가 없습니다.' }}</p>
            </div>
            <dl v-if="assignment.planId || schedule" class="information-grid">
              <div v-if="assignment.planId">
                <dt>목표 인증일</dt>
                <dd>
                  {{
                    store.data.plans.find((p) => p.id === assignment?.planId)?.targetOn || '미설정'
                  }}
                </dd>
              </div>
              <template v-if="schedule"
                ><div>
                  <dt>학습 시작 예정일</dt>
                  <dd>{{ schedule.learningStart || '미설정' }}</dd>
                </div>
                <div>
                  <dt>학습 완료 예정일</dt>
                  <dd>{{ schedule.learningEnd || '미설정' }}</dd>
                </div>
                <div>
                  <dt>평가 예정일</dt>
                  <dd>{{ schedule.assessmentOn || '미설정' }}</dd>
                </div></template
              >
            </dl>
          </section>
          <h3>이 과정의 학습 범위</h3>
          <ol class="learning-scope">
            <li v-for="item in course.learningItems" :key="item.id">
              <strong>{{ item.title }}</strong
              ><span
                >{{ learningTypeLabels[item.type] }} ·
                {{ item.required ? '필수 학습 범위' : '선택 학습 범위' }}</span
              >
            </li>
          </ol>
          <h3>학습자료</h3>
          <CourseMaterials :materials="course.materials" />
          <p class="muted">
            내용을 학습한 뒤 평가하기로 이동해 주세요. 별도 완료 기록은 작성하지 않습니다.
          </p>
          <RouterLink
            :to="{ query: { course: course.id, stage: 'assessment' } }"
            class="button primary"
            :aria-disabled="!!assignment.excludedReason"
            >평가하기</RouterLink
          >
        </section>
        <RouterLink v-else :to="{ query: { course: course.id } }" class="button secondary"
          >학습 안내로 돌아가기</RouterLink
        >
        <RouterLink
          v-if="selected.completion"
          class="button secondary"
          :to="`/completions/${selected.completion.id}`"
          >과정 수료증 보기</RouterLink
        >
        <div v-if="showAssessments" class="assessment-grid">
          <section
            v-for="kind in store.requiredKinds(course)"
            :key="kind"
            class="assessment-card"
            :class="{ recommended: recommended === kind }"
          >
            <div class="section-heading">
              <span class="assessment-icon"
                ><AppIcon :name="kind === 'objective' ? 'clipboard' : 'users'" :size="24" /></span
              ><StatusBadge
                :status="selected[kind]"
                :label="selected[kind] === 'ready' ? '미응시' : undefined"
              />
            </div>
            <h3>{{ labels[kind] }}</h3>
            <p class="assessment-metadata">
              {{
                kind === 'objective'
                  ? `${course.questions.length}문항 · ${course.passScore}% 이상 통과`
                  : `${course.practicalQuestions.length}문항 · ${course.practicalPassScore}% 이상 통과`
              }}
            </p>
            <div class="assessment-action">
              <span v-if="assignment.excludedReason" class="muted">검증 제외</span
              ><span v-else-if="selected[kind] === 'passed'" class="passed-caption"
                ><AppIcon name="check" :size="16" />통과 유지</span
              ><RouterLink
                v-else
                :to="assessmentPath(kind)"
                class="button"
                :class="recommended === kind ? 'primary' : 'secondary'"
                >{{ action(kind)
                }}<AppIcon :name="selected[kind] === 'failed' ? 'retry' : 'arrow'" :size="18"
              /></RouterLink>
            </div>
          </section>
        </div>
        <details class="history">
          <summary>
            평가 이력 <span>{{ selected.history.length }}</span
            ><AppIcon name="down" :size="16" />
          </summary>
          <div v-if="!selected.history.length" class="empty-inline">평가 이력이 없습니다.</div>
          <div v-for="h in [...selected.history].reverse()" :key="h.id" class="history-row">
            <span
              >{{ labels[h.kind] }} <span class="muted">{{ h.round }}회</span></span
            ><StatusBadge :status="h.result" /><time>{{
              new Date(h.date).toLocaleDateString('ko-KR')
            }}</time>
            <span class="muted">자동 채점 · {{ h.earned }} / {{ h.total }}점</span>
          </div>
        </details>
      </div>
    </div>
  </div>
  <div v-else class="container page empty-state">
    <h1>자격을 찾을 수 없습니다.</h1>
    <RouterLink class="button secondary" to="/qualifications">목록으로</RouterLink>
  </div>
</template>
