<script setup lang="ts">
import { releaseVersionLabel } from '@eks/contracts';
import CourseCategory from '../components/CourseCategory.vue';
import AuditorChecklist from '../components/AuditorChecklist.vue';
import PageHeading from '../components/PageHeading.vue';
import { computed, ref, useId } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import LearnerNav from '../components/LearnerNav.vue';
import LearningMaterialReader from '../components/LearningMaterialReader.vue';
import CompactTabs from '../components/CompactTabs.vue';
import { useLearnerMemory } from '../composables/useLearnerMemory';
import { learningStage, qualificationLocation } from '../learner-navigation';
import '../learning-workspace.css';
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
const qualification = computed(() => assignment.value && store.qualificationFor(assignment.value));
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

const auditor = computed(() => qualification.value?.qualificationType === 'auditor');
const showAssessments = computed(() => !auditor.value && learningStage(route) === 'assessment');
const memory = useLearnerMemory();
const contextKey = computed(() => `${store.actorId}:${assignment.value?.id}:${course.value?.id}`);
const reading = computed(() => memory.reading(contextKey.value));
const contentId = useId();
const contentTabs = ref<InstanceType<typeof CompactTabs>>();
const contentItems = computed(() => [
  { id: 'scope', label: `학습범위 ${course.value?.learningItems.length || 0}개` },
  { id: 'materials', label: `학습자료 ${course.value?.materials.length || 0}개` },
]);
const blocked = computed(
  () =>
    !!assignment.value?.excludedReason ||
    !!assignment.value?.acquisitionClosedAt ||
    store.actor.certificationEligibility === 'hold' ||
    (!auditor.value && store.actor.workStatus === 'deactive'),
);
function courseStatus(enrollment: Enrollment) {
  if (store.complete(enrollment)) return '수료';
  if (auditor.value) return enrollment.checklist?.items.length ? '학습 확인 중' : '학습 미확인';
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
      category: store.course(e.courseId).category,
      title: store.course(e.courseId).title,
      required: qualification.value?.courseIds.includes(e.courseId) === true,
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
  void router.replace(
    qualificationLocation(
      showAssessments.value ? 'assessment' : 'learning',
      assignment.value?.id,
      id,
      qualification.value?.qualificationType,
    ),
  );
}
</script>
<template>
  <div
    v-if="assignment && qualification"
    class="container page qualification-detail"
    :class="{ 'is-learning': !showAssessments, 'is-assessment-selection': showAssessments }"
  >
    <LearnerNav :assignment-id="assignment.id" :course-id="selected?.courseId" />
    <nav v-if="showAssessments" class="qualification-breadcrumb" aria-label="현재 위치">
      <RouterLink to="/">홈</RouterLink><span aria-hidden="true">›</span>
      <RouterLink :to="qualificationLocation(showAssessments ? 'assessment' : 'learning')">{{
        showAssessments ? '평가 목록' : '학습 목록'
      }}</RouterLink
      ><span aria-hidden="true">›</span
      ><span aria-current="page">{{ showAssessments ? '자격 평가' : '자격 학습' }}</span>
    </nav>
    <PageHeading v-if="showAssessments" class="qualification-evaluation-title"
      ><div>
        <span class="small-label">자격 평가</span>
        <h1>{{ qualification.title }}</h1>
      </div></PageHeading
    >
    <QualificationSummary
      v-else
      :key="`${store.actorId}:${assignment.id}`"
      :qualification="qualification"
      :assignment="assignment"
      :completed="store.completedCount(assignment)"
      :passed="store.passedCount(assignment)"
      :assessments="store.assessmentCount(assignment)"
      :end-on="auditor ? undefined : plan?.endOn"
    />
    <p v-if="assignment.excludedReason" class="error-message qualification-context-note">
      검증 제외 · {{ assignment.excludedReason }}
    </p>
    <p
      v-if="store.actor.certificationEligibility === 'hold'"
      class="error-message qualification-context-note"
    >
      취득 대상자 Hold · 새 취득·평가는 중단됩니다. 기록과 학습자료는 확인할 수 있습니다.
    </p>
    <div v-if="selected && course" class="qualification-workspace">
      <QualificationCourseNav
        :courses="courses"
        :selected="selected.courseId"
        @select="chooseCourse"
      />
      <div class="course-workspace qualification-course-content">
        <section
          :class="{ 'learning-course-hero': !showAssessments }"
          :aria-label="!showAssessments ? '인증Set 요약' : undefined"
        >
          <div class="section-heading qualification-course-heading">
            <div :class="{ 'learning-course-title': !showAssessments }">
              <span v-if="showAssessments" class="small-label">선택 인증Set</span>
              <h2>{{ course.title }}</h2>
              <CourseCategory :course="course" />
              <template v-if="!showAssessments">
                <StatusBadge v-if="store.complete(selected)" status="complete" />
                <span v-else class="status">{{ courseStatus(selected) }}</span>
              </template>
            </div>
            <div class="learning-course-actions">
              <template v-if="showAssessments">
                <StatusBadge v-if="store.complete(selected)" status="complete" />
                <span v-else class="status">{{ courseStatus(selected) }}</span>
              </template>
              <RouterLink
                v-if="!auditor && !showAssessments && !blocked"
                :to="qualificationLocation('assessment', assignment.id, course.id)"
                class="button primary learning-assessment-start"
                >평가 시작<AppIcon name="arrow" :size="16"
              /></RouterLink>
            </div>
          </div>
          <p v-if="course.operationalStatus === 'retired'" class="notice-body">
            <StatusBadge status="retired" /> 확정된 배정은 계속 진행할 수 있습니다.
          </p>
          <section
            v-if="!showAssessments && !auditor"
            aria-label="내 학습 일정"
            class="learning-course-plan"
          >
            <dl class="learning-dates">
              <div>
                <dt>자격 계획 기간</dt>
                <dd>
                  <time v-if="plan?.startOn" :datetime="plan.startOn">{{ plan.startOn }}</time
                  ><span v-else class="date-empty">미설정</span>
                  <span aria-hidden="true">–</span>
                  <time v-if="plan?.endOn" :datetime="plan.endOn">{{ plan.endOn }}</time
                  ><span v-else class="date-empty">미설정</span>
                </dd>
              </div>
            </dl>
            <p v-if="plan?.goal" class="preserve-lines">학습 목표 · {{ plan.goal }}</p>
          </section>
        </section>
        <section
          v-if="!showAssessments"
          class="qualification-learning course-learning-tabs"
          aria-label="학습 안내"
        >
          <CompactTabs
            ref="contentTabs"
            :model-value="reading.contentTab"
            @update:model-value="
              reading.contentTab = $event === 'materials' ? 'materials' : 'scope'
            "
            :items="contentItems"
            label="인증Set 학습 내용"
            :panel-id="contentId"
          />
          <div
            :id="contentId"
            role="tabpanel"
            :aria-labelledby="contentTabs?.tabId(reading.contentTab)"
            class="learning-content-panel"
            tabindex="0"
          >
            <section
              v-if="reading.contentTab === 'scope'"
              aria-label="이 인증Set의 학습 범위"
              class="learning-scope-brief"
            >
              <AuditorChecklist
                v-if="auditor"
                :key="selected.id"
                :course="course"
                :enrollment="selected"
                :blocked="blocked"
              />
              <ul
                v-else-if="course.learningItems.length"
                class="learning-scope-rows"
                :class="{ 'is-expanded': reading.scopeExpanded }"
                :tabindex="reading.scopeExpanded ? 0 : undefined"
                :id="`learning-scope-${selected.id}`"
              >
                <li
                  v-for="item in reading.scopeExpanded
                    ? course.learningItems
                    : course.learningItems.slice(0, 3)"
                  :key="item.id"
                >
                  <span>{{ learningTypeLabels[item.type] }}</span
                  ><strong>{{ item.title }}</strong
                  ><span>{{ item.required ? '필수' : '선택' }}</span>
                </li>
              </ul>
              <p v-else class="muted">등록된 학습 항목이 없습니다.</p>
              <button
                v-if="!auditor && course.learningItems.length > 3"
                type="button"
                class="text-link"
                :aria-expanded="reading.scopeExpanded"
                :aria-controls="`learning-scope-${selected.id}`"
                @click="reading.scopeExpanded = !reading.scopeExpanded"
              >
                {{
                  reading.scopeExpanded
                    ? '학습 항목 접기'
                    : `전체 학습 항목 보기 · ${course.learningItems.length}개`
                }}
              </button>
            </section>
            <LearningMaterialReader
              v-else
              :key="contextKey"
              :materials="course.materials"
              :context-key="contextKey"
            />
          </div>
        </section>
        <template v-else>
          <div class="qualification-assessment-heading">
            <h3>평가 유형 선택</h3>
            <span class="muted"
              >{{ kinds.filter((k) => selected?.[k] === 'passed').length }} /
              {{ kinds.length }} 통과</span
            >
          </div>
          <div class="assessment-grid">
            <div v-if="kinds.length" class="assessment-list-heading" aria-hidden="true">
              <span>평가 유형</span><span>문항 수</span><span>합격 기준</span><span>상태</span
              ><span>평가 진행</span>
            </div>
            <section
              v-for="kind in kinds"
              :key="kind"
              class="assessment-card"
              :class="{ recommended: recommended === kind }"
              :aria-label="kindLabels[kind]"
            >
              <h3 class="assessment-type">{{ kindLabels[kind] }}</h3>
              <p class="assessment-count">
                <span class="assessment-cell-label">문항 수</span>{{ count(kind) }}문항
              </p>
              <p class="assessment-threshold">
                <span class="assessment-cell-label">합격 기준</span
                >{{ threshold(kind) == null ? '미설정' : `${threshold(kind)}% 이상 통과` }}
              </p>
              <div class="assessment-state">
                <span class="sr-only">상태</span>
                <StatusBadge
                  :status="selected[kind]"
                  :label="selected[kind] === 'ready' ? '미응시' : undefined"
                />
              </div>
              <div class="assessment-action">
                <span v-if="blocked" class="muted">응시 제한</span>
                <RouterLink
                  v-else-if="selected[kind] === 'passed'"
                  :to="assessmentPath(kind)"
                  class="button secondary"
                  >결과 보기</RouterLink
                >
                <template v-else-if="prerequisite(kind)">
                  <RouterLink :to="assessmentPath('objective')" class="button secondary"
                    >지식 평가로 이동</RouterLink
                  >
                </template>
                <RouterLink
                  v-else
                  :to="assessmentPath(kind)"
                  class="button"
                  :class="recommended === kind ? 'primary' : 'secondary'"
                  >{{ action(kind)
                  }}<AppIcon :name="selected[kind] === 'failed' ? 'retry' : 'arrow'" :size="18"
                /></RouterLink>
              </div>
              <p v-if="blocked || prerequisite(kind)" class="assessment-row-notice">
                <AppIcon name="lock" :size="16" />
                {{
                  blocked
                    ? assignment.excludedReason
                      ? '검증 제외로 평가를 진행할 수 없습니다.'
                      : '취득 대상자 Hold로 평가를 진행할 수 없습니다.'
                    : '지식 평가를 먼저 통과해 주세요'
                }}
              </p>
            </section>
          </div>
          <section
            v-if="course.subjectiveEnabled && !auditor"
            class="panel"
            aria-label="주관식 평가"
          >
            <h3>주관식 평가 · 수료에 영향 없음</h3>
            <p>
              {{ course.subjectiveQuestions.length }}문항 ·
              {{
                selected.subjective?.status === 'submitted'
                  ? '답변 제출 완료'
                  : selected.completion
                    ? '수료로 작성 종료'
                    : selected.subjective?.status === 'draft'
                      ? '작성 중'
                      : '미작성'
              }}
            </p>
            <p class="muted">
              인증Set 수료 전까지만 작성·제출할 수 있습니다. {{ selected.subjective?.reason }}
            </p>
            <RouterLink
              class="button secondary"
              :to="`/qualifications/${assignment.id}/courses/${course.id}/subjective-response`"
              >주관식 답변 보기</RouterLink
            >
          </section>
          <p v-if="!kinds.length" class="muted">
            등록된 평가 유형이 없습니다. 관리자에게 확인해 주세요.
          </p>
          <section v-if="selected.completion" class="qualification-completion">
            <div>
              <StatusBadge status="complete" />
              <p>수료일 {{ kstDate(selected.completion.date) }}</p>
            </div>
            <RouterLink
              class="button secondary"
              :to="{
                path: `/completions/${selected.completion.id}`,
                query: { stage: 'assessment' },
              }"
              >인증Set 수료증 보기</RouterLink
            >
          </section>
          <details :key="selected.id" class="history qualification-history">
            <summary>
              평가 이력 <span>{{ selected.history.length }}건</span
              ><AppIcon name="down" :size="16" />
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
        </template>
        <p class="release-footer">인증Set {{ releaseVersionLabel(course) }}</p>
      </div>
    </div>
    <p v-else class="empty-inline">등록된 인증Set이 없습니다.</p>
    <p v-if="showAssessments" class="release-footer">
      자격 {{ releaseVersionLabel(qualification) }}
    </p>
  </div>
  <div v-else class="container page empty-state">
    <h1>자격을 찾을 수 없습니다.</h1>
    <RouterLink
      class="button secondary"
      :to="qualificationLocation(showAssessments ? 'assessment' : 'learning')"
      >목록으로</RouterLink
    >
  </div>
</template>
