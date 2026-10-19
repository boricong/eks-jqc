<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
import LearnerNav from '../components/LearnerNav.vue';
import LearningPanel from '../components/LearningPanel.vue';
import { kindLabels } from '@eks/contracts';
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
      store
        .requiredKinds(store.course(e.courseId))
        .some((kind) => !['passed', 'waiting'].includes(e[kind])),
    ) ||
    assignment.value?.enrollments.find((e) => !store.complete(e)) ||
    assignment.value?.enrollments[0],
);
const course = computed(() => selected.value && store.course(selected.value.courseId));
const materialOpen = ref(false);
const recommended = computed(
  () =>
    course.value &&
    selected.value &&
    store
      .requiredKinds(course.value)
      .find((k) => !['passed', 'waiting'].includes(selected.value![k])),
);
const labels = kindLabels;
function action(kind: Kind) {
  const state = selected.value![kind];
  return kind !== 'practical'
    ? state === 'draft'
      ? '답안 이어 쓰기'
      : state === 'waiting'
        ? '제출 답안 확인'
        : state === 'failed'
          ? '다시 응시'
          : '응시하기'
    : state === 'waiting'
      ? '요청 확인'
      : state === 'failed'
        ? '다시 요청'
        : '평가 요청';
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
        <button
          class="material-row"
          :disabled="!course.material && !course.materialUrl"
          @click="materialOpen = true"
        >
          <span class="material-icon"><AppIcon name="file" /></span><span>학습자료</span
          ><span class="muted">{{
            course.material || course.materialUrl ? '자료 보기' : '등록된 자료 없음'
          }}</span
          ><AppIcon name="diagonal" :size="18" />
        </button>
        <LearningPanel
          v-if="assignment.planId"
          :key="selected.id"
          :course="course"
          :enrollment="selected"
          :disabled="!!assignment.excludedReason"
        />
        <p v-if="!selected.learningComplete" class="notice-body">
          필수 학습 완료 기록을 남기면 이 과정의 평가를 진행할 수 있습니다.
        </p>
        <p
          v-else-if="!assignment.ftId && course.assessmentKinds.some((k) => k !== 'objective')"
          class="notice-body"
        >
          FT 배정 대기 · 조직 관리자가 FT를 지정하면 주관식 제출과 실기 요청이 가능합니다.
          학습·객관식·주관식 답안 작성은 계속할 수 있습니다.
        </p>
        <RouterLink
          v-if="selected.completion"
          class="button secondary"
          :to="`/completions/${selected.completion.id}`"
          >과정 수료증 보기</RouterLink
        >
        <div class="assessment-grid">
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
                :label="
                  selected[kind] === 'ready'
                    ? kind === 'objective'
                      ? '미응시'
                      : '요청 전'
                    : selected[kind] === 'waiting'
                      ? kind === 'subjective'
                        ? 'FT 채점 대기'
                        : 'FT 평가 대기'
                      : undefined
                "
              />
            </div>
            <h3>{{ labels[kind] }}</h3>
            <p class="assessment-metadata">
              {{
                kind === 'objective'
                  ? `${course.questions.length}문항 · ${course.passScore}% 이상 통과`
                  : kind === 'subjective'
                    ? `${course.subjectiveQuestions.length}문항 · ${course.subjectivePassScore}% 이상 통과 · FT ${store.username(assignment.ftId)}`
                    : `${course.practicalItems.filter((i) => i.mandatory).length}개 필수 항목 · FT ${store.username(assignment.ftId)}`
              }}
            </p>
            <div class="assessment-action">
              <span v-if="assignment.excludedReason" class="muted">검증 제외</span
              ><span v-else-if="selected[kind] === 'passed'" class="passed-caption"
                ><AppIcon name="check" :size="16" />통과 유지</span
              ><span v-else-if="!selected.learningComplete" class="muted">필수 학습 기록 대기</span
              ><span v-else-if="kind === 'practical' && !assignment.ftId" class="muted"
                >FT 배정 대기</span
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
            <span v-if="h.feedback" class="muted">{{ h.feedback }}</span>
          </div>
        </details>
      </div>
    </div>
    <AppDialog v-model:open="materialOpen" :title="`${course.title} · 학습자료`"
      ><div class="material-content">{{ course.material }}</div>
      <a
        v-if="course.materialUrl"
        :href="course.materialUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="button secondary"
        >자료 열기<AppIcon name="diagonal" :size="16" /></a
    ></AppDialog>
  </div>
  <div v-else class="container page empty-state">
    <h1>자격을 찾을 수 없습니다.</h1>
    <RouterLink class="button secondary" to="/qualifications">목록으로</RouterLink>
  </div>
</template>
