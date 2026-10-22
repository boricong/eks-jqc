<script setup lang="ts">
import PageHeading from '../components/PageHeading.vue';
import PropertyList from '../components/PropertyList.vue';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import LearnerNav from '../components/LearnerNav.vue';
import CourseMaterials from '../components/CourseMaterials.vue';
import QualificationSummary from '../components/QualificationSummary.vue';
import QualificationCourseNav from '../components/QualificationCourseNav.vue';
import {
  kindLabels,
  assessmentPrerequisite,
  learningTypeLabels,
  kstDate,
  type Kind,
  type Enrollment,
} from '@eks/contracts';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const assignment = computed(() => {
  const value = store.assignment(String(route.params.id));
  return value?.learnerId === store.actorId ? value : undefined;
});
const qualification = computed(
  () =>
    assignment.value &&
    store.qualification(assignment.value.qualificationId, assignment.value.qualificationMetadata),
);
const plan = computed(() => store.data.plans.find((p) => p.id === assignment.value?.planId));
const selected = computed(
  () =>
    assignment.value?.enrollments.find((e) => e.courseId === route.query.course) ||
    assignment.value?.enrollments.find((e) =>
      store.requiredKinds(store.course(e.courseId)).some((kind) => e[kind] === 'draft'),
    ) ||
    assignment.value?.enrollments.find((e) => !store.complete(e)) ||
    assignment.value?.enrollments[0],
);
const course = computed(() => selected.value && store.course(selected.value.courseId));
const schedule = computed(() => plan.value?.schedules.find((s) => s.courseId === course.value?.id));
const showAssessments = computed(() => route.query.stage === 'assessment');
const previousCriteria = computed(
  () =>
    !store.data.requiredQualifications?.items.some(
      (i) => i.qualificationId === assignment.value?.qualificationId,
    ),
);
function courseStatus(enrollment: Enrollment) {
  if (store.complete(enrollment)) return '수료';
  const kinds = store.requiredKinds(store.course(enrollment.courseId));
  if (kinds.some((kind) => enrollment[kind] === 'draft')) return '평가 중';
  if (kinds.some((kind) => enrollment[kind] === 'passed'))
    return kinds.some((kind) => enrollment[kind] === 'failed')
      ? '일부 통과 · 재응시 필요'
      : '일부 통과';
  return kinds.some((kind) => enrollment[kind] === 'failed') ? '재응시 필요' : '평가 전';
}
const courses = computed(
  () =>
    assignment.value?.enrollments.map((e) => ({
      id: e.courseId,
      title: store.course(e.courseId).title,
      status: courseStatus(e),
      passed: store.requiredKinds(store.course(e.courseId)).filter((kind) => e[kind] === 'passed')
        .length,
      total: store.requiredKinds(store.course(e.courseId)).length,
      completed: store.complete(e),
    })) || [],
);
const kinds = computed(() =>
  course.value
    ? [...store.requiredKinds(course.value)].sort(
        (a, b) => (a === 'objective' ? 0 : 1) - (b === 'objective' ? 0 : 1),
      )
    : [],
);
function prerequisite(kind: Kind) {
  return (
    course.value &&
    assessmentPrerequisite(course.value, kind, selected.value?.objective === 'passed')
  );
}
const recommended = computed(
  () =>
    kinds.value.find((kind) => !prerequisite(kind) && selected.value?.[kind] === 'draft') ||
    kinds.value.find((kind) => !prerequisite(kind) && selected.value?.[kind] !== 'passed'),
);
function action(kind: Kind) {
  return selected.value?.[kind] === 'draft'
    ? '답안 이어 쓰기'
    : selected.value?.[kind] === 'failed'
      ? '다시 응시'
      : '응시하기';
}
function assessmentPath(kind: Kind) {
  return `/qualifications/${assignment.value!.id}/courses/${course.value!.id}/${kind}`;
}
function count(kind: Kind) {
  return kind === 'objective'
    ? course.value!.questions.length
    : course.value!.practicalQuestions.length;
}
function threshold(kind: Kind) {
  return kind === 'objective' ? course.value!.passScore : course.value!.practicalPassScore;
}
function chooseCourse(id: string) {
  void router.replace({ query: { course: id } });
}
</script>
<template>
  <div
    v-if="assignment && qualification && selected && course"
    class="container page qualification-detail"
  >
    <LearnerNav />
    <nav class="qualification-breadcrumb" aria-label="현재 위치">
      <RouterLink to="/">홈</RouterLink><span aria-hidden="true">›</span
      ><RouterLink to="/qualifications">자격 취득</RouterLink><span aria-hidden="true">›</span
      ><span aria-current="page">자격 상세</span>
    </nav>
    <PageHeading class="page-heading">
      <h1>자격 상세</h1>
      <RouterLink v-if="assignment.planId" :to="`/plans/${assignment.planId}`" class="text-link"
        >인증 계획 · 일정·목표 확인<AppIcon name="chevron" :size="16"
      /></RouterLink>
    </PageHeading>
    <QualificationSummary
      :key="assignment.id"
      :qualification="qualification"
      :assignment="assignment"
      :completed="store.completedCount(assignment)"
      :passed="store.passedCount(assignment)"
      :assessments="store.assessmentCount(assignment)"
      :target-on="plan?.targetOn"
    />
    <p v-if="assignment.excludedReason" class="error-message qualification-context-note">
      검증 제외 · {{ assignment.excludedReason }}
    </p>
    <p v-else-if="previousCriteria" class="notice-body qualification-context-note">
      이전 기준으로 진행 중 · 확정 당시 자격·인증Set 버전을 유지합니다.
    </p>
    <div class="qualification-workspace">
      <QualificationCourseNav
        :courses="courses"
        :selected="selected.courseId"
        @select="chooseCourse"
      />
      <div class="course-workspace qualification-course-content">
        <div class="section-heading qualification-course-heading">
          <div>
            <span class="small-label">선택 인증Set · v{{ course.version }}</span>
            <h2>{{ course.title }}</h2>
          </div>
          <StatusBadge v-if="store.complete(selected)" status="complete" /><span
            v-else
            class="status"
            >{{ courseStatus(selected) }}</span
          >
        </div>
        <p v-if="course.operationalStatus === 'retired'" class="notice-body">
          <StatusBadge status="retired" /> 확정된 배정은 계속 진행할 수 있습니다.
        </p>
        <section
          v-show="!showAssessments"
          class="panel learning-guide qualification-learning"
          aria-label="학습 안내"
        >
          <section class="course-goals text-stack" aria-label="내 학습 목표와 일정">
            <div class="text-stack">
              <h3>내 학습 목표</h3>
              <p class="prose-text">{{ schedule?.goal || '작성된 학습 목표가 없습니다.' }}</p>
            </div>
            <PropertyList class="information-grid">
              <div>
                <dt>학습 시작 예정일</dt>
                <dd>{{ schedule?.learningStart || '미설정' }}</dd>
              </div>
              <div>
                <dt>학습 완료 예정일</dt>
                <dd>{{ schedule?.learningEnd || '미설정' }}</dd>
              </div>
              <div>
                <dt>평가 예정일</dt>
                <dd>{{ schedule?.assessmentOn || '미설정' }}</dd>
              </div>
            </PropertyList>
          </section>
          <section
            class="qualification-learning-scope text-stack"
            aria-label="이 인증Set의 학습 범위"
          >
            <h3>이 인증Set의 학습 범위</h3>
            <ol v-if="course.learningItems.length" class="learning-scope">
              <li v-for="item in course.learningItems" :key="item.id">
                <strong>{{ item.title }}</strong
                ><span
                  >{{ learningTypeLabels[item.type] }} ·
                  {{ item.required ? '필수 학습 범위' : '선택 학습 범위' }}</span
                >
              </li>
            </ol>
            <p v-else class="muted">등록된 학습 항목이 없습니다.</p>
          </section>
          <CourseMaterials
            :materials="course.materials"
            :context-key="`${store.actorId}:${assignment.id}:${course.id}`"
          />
          <section class="qualification-assessment-summary text-stack" aria-label="평가 현황">
            <h3>평가 현황</h3>
            <ul>
              <li v-for="kind in kinds" :key="kind">
                <div>
                  <strong>{{ kindLabels[kind] }}</strong
                  ><small>{{ count(kind) }}문항 · {{ threshold(kind) }}% 이상 통과</small>
                </div>
                <StatusBadge
                  :status="selected[kind]"
                  :label="selected[kind] === 'ready' ? '미응시' : undefined"
                />
              </li>
            </ul>
            <p class="muted">
              내용을 학습한 뒤 평가하기로 이동해 주세요. 필수 평가를 모두 통과하면 인증Set이
              수료됩니다.
            </p>
            <RouterLink
              v-if="!assignment.excludedReason"
              :to="{ query: { course: course.id, stage: 'assessment' } }"
              class="button primary"
              >평가하기<AppIcon name="arrow" :size="18" /></RouterLink
            ><button v-else class="button primary" disabled>평가하기</button>
          </section>
        </section>
        <template v-if="showAssessments">
          <div class="qualification-assessment-heading">
            <h3>평가 유형 선택</h3>
            <RouterLink :to="{ query: { course: course.id } }" class="button secondary"
              >학습자료로 돌아가기</RouterLink
            >
          </div>
          <div class="assessment-grid">
            <section
              v-for="kind in kinds"
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
              <h3>{{ kindLabels[kind] }}</h3>
              <p class="assessment-metadata">
                {{ count(kind) }}문항 · {{ threshold(kind) }}% 이상 통과
              </p>
              <div class="assessment-action">
                <span v-if="assignment.excludedReason" class="muted">검증 제외</span
                ><span v-else-if="selected[kind] === 'passed'" class="passed-caption"
                  ><AppIcon name="check" :size="16" />통과 유지</span
                >
                <div v-else-if="prerequisite(kind)" class="assessment-locked">
                  <p><AppIcon name="lock" :size="16" />지식 평가를 먼저 통과해 주세요</p>
                  <RouterLink :to="assessmentPath('objective')" class="button secondary"
                    >지식 평가로 이동</RouterLink
                  >
                </div>
                <RouterLink
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
        </template>
        <section v-if="selected.completion" class="panel qualification-completion">
          <div>
            <StatusBadge status="complete" />
            <p>수료일 {{ kstDate(selected.completion.date) }}</p>
          </div>
          <RouterLink class="button secondary" :to="`/completions/${selected.completion.id}`"
            >인증Set 수료증 보기</RouterLink
          >
        </section>
        <details :key="selected.id" class="history qualification-history">
          <summary>
            평가 이력 <span>{{ selected.history.length }}건</span><AppIcon name="down" :size="16" />
          </summary>
          <div v-if="!selected.history.length" class="empty-inline">평가 이력이 없습니다.</div>
          <ol v-else>
            <li v-for="h in [...selected.history].reverse()" :key="h.id" class="history-row">
              <span>{{ kindLabels[h.kind] }} · {{ h.round }}회</span
              ><StatusBadge :status="h.result" /><time>{{ kstDate(h.date) }}</time
              ><span class="muted">자동 채점 · {{ h.earned }} / {{ h.total }}점</span>
            </li>
          </ol>
        </details>
      </div>
    </div>
  </div>
  <div v-else class="container page empty-state">
    <h1>자격 상세</h1>
    <p>자격을 찾을 수 없습니다.</p>
    <RouterLink class="button secondary" to="/qualifications">목록으로</RouterLink>
  </div>
</template>
