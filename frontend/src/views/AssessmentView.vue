<script setup lang="ts">
import { releaseVersionLabel } from '@eks/contracts';
import CourseCategory from '../components/CourseCategory.vue';
import PropertyList from '../components/PropertyList.vue';
import ActionBar from '../components/ActionBar.vue';
import SaveFeedback from '../components/SaveFeedback.vue';
import { confirmAction } from '../composables/useConfirmation';
import { useProcessContext } from '../composables/useProcessContext';
import { computed, ref, watch, nextTick, useId, onBeforeUnmount } from 'vue';
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { useAttemptDraft } from '../composables/useAttemptDraft';
import { useDemo } from '../stores/demo';
import { kindLabels, assessmentPrerequisite, type Kind } from '@eks/contracts';
import { ApiError } from '../api';
import CompactTabs from '../components/CompactTabs.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
import AppIcon from '../components/AppIcon.vue';
import LearnerNav from '../components/LearnerNav.vue';
import { qualificationLocation } from '../learner-navigation';
import { useLearnerMemory } from '../composables/useLearnerMemory';
const store = useDemo(),
  route = useRoute(),
  uid = useId();
const kind = computed(() => route.params.kind as Kind);
const a = computed(() => {
  const v = store.assignment(String(route.params.id));
  return v?.learnerId === store.actorId && !v.excludedReason ? v : undefined;
});
const e = computed(() => a.value?.enrollments.find((v) => v.courseId === route.params.courseId));
const c = computed(() => e.value && store.course(e.value.courseId));
const valid = computed(() => c.value?.assessmentKinds.includes(kind.value));
const questions = computed(() =>
  c.value ? (kind.value === 'objective' ? c.value.questions : c.value.practicalQuestions) : [],
);
const selected = ref(''),
  stage = ref<'edit' | 'review' | 'result'>('edit'),
  busy = ref(false),
  error = ref(''),
  tabs = ref<InstanceType<typeof CompactTabs>>();
const noticeOpen = ref(false),
  noticeType = ref<'last' | 'missing'>('last'),
  missingIds = ref<string[]>([]),
  reviewPage = ref(1);
const infoOpen = ref(false),
  questionNavOpen = ref(false),
  root = ref<HTMLElement>(),
  submitbar = ref<InstanceType<typeof ActionBar>>(),
  barHeight = ref(0);
let barObserver: ResizeObserver | undefined;
watch(
  () => submitbar.value?.$el,
  (element) => {
    barObserver?.disconnect();
    barHeight.value = 0;
    if (!(element instanceof HTMLElement)) return;
    barObserver = new ResizeObserver(() => {
      barHeight.value = element.getBoundingClientRect().height;
    });
    barObserver.observe(element);
  },
  { flush: 'post' },
);
onBeforeUnmount(() => barObserver?.disconnect());
const reviewReturn = ref<{
  attemptId: string;
  page: number;
  questionId: string;
  offset: number;
} | null>(null);
const {
  attempt,
  draft,
  status: saveStatus,
  error: saveError,
  conflict,
  load,
  flush,
  changed,
  canLeave,
} = useAttemptDraft(() => store.actorId);
const memory = useLearnerMemory();
const current = computed(() => questions.value.find((q) => q.id === selected.value)),
  position = computed(() => questions.value.findIndex((q) => q.id === selected.value));
const missing = computed(() =>
  questions.value.filter(
    (q) =>
      !Number.isInteger(draft.value.answers[q.id]) ||
      draft.value.answers[q.id]! < 0 ||
      draft.value.answers[q.id]! >= q.choices.length,
  ),
);
const answered = computed(() => questions.value.length - missing.value.length);
const missingSet = computed(() => new Set(missing.value.map((q) => q.id)));
const options = computed(() =>
  questions.value.map((q, i) => ({
    id: q.id,
    label: `${i + 1}번 ${q.prompt} · ${missingSet.value.has(q.id) ? '미응답' : '응답 완료'}`,
    invalid: !!error.value && missingSet.value.has(q.id),
  })),
);
const returnPath = computed(() =>
  a.value?.renewalBatchId
    ? `/renewals/${a.value.renewalBatchId}`
    : qualificationLocation('assessment', a.value?.id, c.value?.id),
);
const learningPath = computed(() => qualificationLocation('learning', a.value?.id, c.value?.id));
const qualificationTitle = computed(
  () =>
    a.value && store.qualification(a.value.qualificationId, a.value.qualificationMetadata).title,
);
const knowledgePath = computed(
  () => `/qualifications/${a.value?.id}/courses/${c.value?.id}/objective`,
);
const result = computed(() => e.value?.[kind.value]);
const isResult = computed(() => stage.value === 'result' || result.value === 'passed');
const held = computed(
  () => store.actor.certificationEligibility === 'hold' || store.actor.workStatus === 'deactive',
);
const title = computed(() =>
  isResult.value
    ? '평가 결과'
    : stage.value === 'review'
      ? '제출 전 답안 확인'
      : kind.value === 'objective'
        ? '지식 평가'
        : '상황 대응 평가',
);
const passScore = computed(() =>
  kind.value === 'objective' ? c.value?.passScore : c.value?.practicalPassScore,
);
const prerequisite = computed(() =>
  c.value && result.value !== 'passed'
    ? assessmentPrerequisite(c.value, kind.value, e.value?.objective === 'passed')
    : undefined,
);
const practicalNext = computed(
  () =>
    kind.value === 'objective' &&
    result.value === 'passed' &&
    c.value?.assessmentKinds.includes('practical') &&
    e.value?.practical !== 'passed',
);
const last = computed(() => e.value?.history.filter((h) => h.kind === kind.value).at(-1));
const reviewPages = computed(() => Math.max(1, Math.ceil(questions.value.length / 20)));
const reviewQuestions = computed(() =>
  questions.value
    .map((question, index) => ({ question, index }))
    .slice((reviewPage.value - 1) * 20, reviewPage.value * 20),
);
const missingNumbers = computed(() =>
  missingIds.value
    .map((id) => questions.value.findIndex((q) => q.id === id) + 1)
    .filter((n) => n > 0),
);
useProcessContext(() => `assessment-${isResult.value ? 'result' : stage.value}`);
let generation = 0;
async function prepare() {
  const seq = ++generation;
  busy.value = true;
  error.value = '';
  stage.value = 'edit';
  noticeOpen.value = false;
  reviewPage.value = 1;
  reviewReturn.value = null;
  infoOpen.value = false;
  questionNavOpen.value = false;
  load(null);
  try {
    if (!valid.value || !a.value || !c.value || !e.value) return;
    selected.value = questions.value[0]?.id || '';
    if (prerequisite.value) {
      load(e.value.activeAttempts[kind.value] || null);
      return;
    }
    if (result.value !== 'passed') {
      const value = await store.startAttempt(a.value.id, c.value.id, kind.value);
      if (seq === generation) {
        load(value);
        const remembered = memory.attempt(value.id).question;
        if (questions.value.some((q) => q.id === remembered)) selected.value = remembered;
      }
    }
  } catch (err) {
    if (seq === generation) error.value = (err as Error).message;
  } finally {
    if (seq === generation) busy.value = false;
  }
}
function answer(id: string, value: number) {
  draft.value.answers[id] = value;
  changed();
  error.value = '';
}
async function chooseQuestion(id: string) {
  selected.value = id;
  if (questionNavOpen.value && window.matchMedia('(max-width: 768px)').matches) {
    questionNavOpen.value = false;
    await focusAnswer();
  }
}
async function focusAnswer() {
  await nextTick();
  const input =
    root.value?.querySelector<HTMLElement>('.answer-panel input:checked') ||
    root.value?.querySelector<HTMLElement>('.answer-panel input');
  focusVisible(input);
}
function focusVisible(element?: HTMLElement | null) {
  if (!element) return;
  element.focus({ preventScroll: true });
  const rect = element.getBoundingClientRect(),
    bottom = innerHeight - barHeight.value - 16;
  if (rect.top < 80) window.scrollBy(0, rect.top - 80);
  else if (rect.bottom > bottom) window.scrollBy(0, rect.bottom - bottom);
}
function reviewRow(id: string) {
  return [...(root.value?.querySelectorAll<HTMLElement>('[data-review-question]') || [])].find(
    (el) => el.dataset.reviewQuestion === id,
  );
}
function showMissing(ids = missing.value.map((q) => q.id)) {
  missingIds.value = ids;
  error.value = '모든 문항에 답해야 제출할 수 있습니다.';
  noticeType.value = 'missing';
  noticeOpen.value = true;
}
async function noticeClosed() {
  if (noticeType.value === 'missing' && missingIds.value.length) {
    stage.value = 'edit';
    selected.value = missingIds.value[0]!;
    await focusAnswer();
  }
}
async function review() {
  if (busy.value || prerequisite.value || held.value) return;
  if (missing.value.length) {
    showMissing();
    return;
  }
  const seq = generation;
  busy.value = true;
  try {
    await flush();
    if (seq === generation) {
      if (reviewReturn.value && reviewReturn.value.attemptId === attempt.value?.id)
        reviewPage.value = Math.min(reviewReturn.value!.page, reviewPages.value);
      stage.value = 'review';
      error.value = '';
      busy.value = false;
      await nextTick();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (seq !== generation || busy.value || stage.value !== 'review') return;
      const resume = reviewReturn.value;
      const row =
        resume && resume.attemptId === attempt.value?.id ? reviewRow(resume.questionId) : undefined;
      if (resume && row) {
        window.scrollBy(0, row.getBoundingClientRect().top - resume.offset);
        focusVisible(row.querySelector<HTMLElement>('.review-edit'));
      } else {
        focusVisible(root.value?.querySelector<HTMLElement>('.assessment-stage-title'));
      }
    }
  } catch {
    /* The autosave component retains the answer and error. */
  } finally {
    if (seq === generation) busy.value = false;
  }
}
async function submit() {
  if (busy.value || !attempt.value || prerequisite.value || held.value) return;
  if (missing.value.length) {
    showMissing();
    return;
  }
  const seq = generation;
  busy.value = true;
  error.value = '';
  try {
    await flush();
    if (seq !== generation || !attempt.value) return;
    await store.command(`/attempts/${attempt.value.id}/submit`, {
      revision: attempt.value.revision,
    });
    if (seq === generation) {
      load(null);
      stage.value = 'result';
      await nextTick();
      focusVisible(root.value?.querySelector<HTMLElement>('.assessment-outcome h2'));
    }
  } catch (err) {
    if (seq !== generation) return;
    error.value = (err as Error).message;
    if (err instanceof ApiError && err.code === 'ASSESSMENT_INCOMPLETE')
      showMissing((err.details?.missingQuestionIds as string[]) || missing.value.map((q) => q.id));
    else {
      await nextTick();
      root.value
        ?.querySelector<HTMLElement>('.assessment-submit-error')
        ?.focus({ preventScroll: true });
    }
  } finally {
    if (seq === generation) busy.value = false;
  }
}
async function retrySave() {
  try {
    await flush();
  } catch {}
}
async function reload() {
  if (!(await confirmAction('현재 입력을 서버에 저장된 답안으로 바꿀까요?', '답안 다시 불러오기')))
    return;
  const actor = store.actorId,
    path = route.fullPath,
    attemptId = attempt.value?.id;
  const previous = {
    selected: selected.value,
    page: reviewPage.value,
    resume: reviewReturn.value,
    info: infoOpen.value,
    stage: stage.value,
  };
  await store.refresh();
  if (actor !== store.actorId || path !== route.fullPath) return;
  await prepare();
  if (actor !== store.actorId || path !== route.fullPath || attemptId !== attempt.value?.id) return;
  if (questions.value.some((q) => q.id === previous.selected)) selected.value = previous.selected;
  reviewPage.value = Math.min(previous.page, reviewPages.value);
  reviewReturn.value = previous.resume;
  infoOpen.value = previous.info;
  if (previous.stage === 'review' && !missing.value.length) await review();
  else await focusAnswer();
}
function navigate(d: number) {
  if (d > 0 && position.value === questions.value.length - 1) {
    noticeType.value = 'last';
    noticeOpen.value = true;
    return;
  }
  selected.value = questions.value[position.value + d]?.id || selected.value;
}
async function editQuestion(id: string) {
  if (busy.value) return;
  const row =
    reviewRow(id) ||
    [...(root.value?.querySelectorAll<HTMLElement>('[data-review-question]') || [])].find(
      (el) => el.getBoundingClientRect().bottom > 80,
    );
  if (attempt.value && row)
    reviewReturn.value = {
      attemptId: attempt.value.id,
      page: reviewPage.value,
      questionId: row.dataset.reviewQuestion!,
      offset: row.getBoundingClientRect().top,
    };
  selected.value = id;
  stage.value = 'edit';
  await focusAnswer();
}
async function changeReviewPage(page: number) {
  if (busy.value) return;
  reviewPage.value = Math.max(1, Math.min(page, reviewPages.value));
  reviewReturn.value = null;
  await nextTick();
  const row = root.value?.querySelector<HTMLElement>('[data-review-question]');
  row?.focus({ preventScroll: true });
  if (row) window.scrollBy(0, row.getBoundingClientRect().top - 80);
}
watch(selected, (value) => {
  if (!busy.value && attempt.value) memory.attempt(attempt.value.id).question = value;
});
watch(() => [route.fullPath, store.actorId], prepare, { immediate: true });
watch(
  () => prerequisite.value?.code,
  (value, previous) => {
    if (previous && !value && !isResult.value && !busy.value) void prepare();
  },
);
async function leave() {
  if (busy.value) return false;
  return canLeave();
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <div
    v-if="valid && a && e && c"
    ref="root"
    class="container page assessment-page"
    :class="{
      'is-assessment-result': isResult,
      'is-assessment-review': stage === 'review' && !isResult,
    }"
    :style="{ '--assessment-bar-height': `${barHeight}px` }"
  >
    <LearnerNav :assignment-id="a.id" :course-id="c.id" />
    <header class="assessment-task-header">
      <div class="assessment-stage-heading">
        <h1 class="assessment-stage-title" tabindex="-1">{{ title }}</h1>
        <button
          type="button"
          class="text-link assessment-info-toggle"
          :aria-expanded="infoOpen"
          :aria-controls="uid + '-info'"
          @click="infoOpen = !infoOpen"
        >
          평가 정보<AppIcon name="down" :size="16" :class="{ 'is-open': infoOpen }" />
        </button>
      </div>
      <p class="assessment-context">
        <CourseCategory :course="c" /><strong>{{ c.title }}</strong
        ><span>{{ releaseVersionLabel(c) }} · {{ kindLabels[kind] }}</span>
      </p>
      <section v-show="infoOpen" :id="uid + '-info'" class="assessment-info" aria-label="평가 정보">
        <PropertyList>
          <div>
            <dt>자격</dt>
            <dd>{{ qualificationTitle }}</dd>
          </div>
          <div>
            <dt>응시 회차</dt>
            <dd>
              {{
                (isResult ? last?.round : attempt?.round)
                  ? `${isResult ? last?.round : attempt?.round}회`
                  : '확인할 수 없음'
              }}
            </dd>
          </div>
          <div v-if="isResult && last?.date">
            <dt>확정 일시 · KST</dt>
            <dd>{{ new Date(last.date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) }}</dd>
          </div>
        </PropertyList>
      </section>
    </header>
    <p v-if="held" class="assessment-restriction" role="status">
      {{ store.actor.workStatus === 'deactive' ? 'deactive' : '취득 대상자 Hold' }} · 새 응시와
      제출은 중단됩니다. 저장된 답안과 결과는 확인할 수 있습니다.
    </p>
    <section
      v-if="isResult"
      class="panel result-panel assessment-outcome"
      :class="result === 'passed' ? 'outcome-passed' : 'outcome-failed'"
      aria-label="평가 결과 요약"
    >
      <div class="outcome-content">
        <div class="outcome-summary">
          <div class="outcome-status">
            <div class="outcome-icon">
              <AppIcon :name="result === 'passed' ? 'check' : 'alert'" :size="24" />
            </div>
            <h2 tabindex="-1">{{ result === 'passed' ? '평가 통과' : '미통과 · 재응시 가능' }}</h2>
          </div>
          <PropertyList class="outcome-facts">
            <div>
              <dt>평가 점수</dt>
              <dd>
                <template v-if="last?.earned !== undefined && last?.total !== undefined"
                  ><strong>{{ last.earned }}</strong> / {{ last.total }}점</template
                ><span v-else>확인할 수 없음</span>
              </dd>
            </div>
            <div>
              <dt>합격 기준</dt>
              <dd>{{ passScore == null ? '미설정' : `${passScore}% 이상` }}</dd>
            </div>
          </PropertyList>
        </div>
        <p class="outcome-description">
          {{
            result === 'passed'
              ? a.renewalBatchId
                ? '객관식 재인증 평가를 통과했습니다. 대상별 갱신 결과를 확인해 주세요.'
                : a.certifiedAt
                  ? '모든 필수 인증Set을 수료하여 자격을 취득했습니다.'
                  : store.complete(e)
                    ? '인증Set을 수료했습니다. 남은 인증Set의 평가를 확인해 주세요.'
                    : practicalNext
                      ? '지식 평가를 통과했습니다. 상황 대응 평가를 이어서 진행해 주세요.'
                      : '통과한 평가를 확인하고 남은 평가를 진행해 주세요.'
              : '합격 기준에 도달하지 못했습니다. 학습자료를 확인하거나 다시 응시해 주세요.'
          }}
        </p>
        <div class="result-assessments">
          <span v-for="k in c.assessmentKinds" :key="k"
            >{{ kindLabels[k] }} <StatusBadge :status="e[k]"
          /></span>
          <span v-if="e.completion" class="outcome-award">인증Set 수료</span
          ><span v-if="a.certifiedAt" class="outcome-award">자격 취득</span>
        </div>
        <div class="actions outcome-actions">
          <button
            v-if="result === 'failed'"
            class="button primary"
            :disabled="busy || held"
            @click="prepare"
          >
            다시 응시
          </button>
          <template v-else-if="practicalNext"
            ><RouterLink
              v-if="!held"
              :to="`/qualifications/${a.id}/courses/${c.id}/practical`"
              class="button primary"
              >상황 대응 평가 시작</RouterLink
            ><button v-else class="button primary" disabled>상황 대응 평가 시작</button></template
          >
          <RouterLink
            v-else-if="a.certifiedAt"
            :to="`/certifications/${a.id}`"
            class="button primary"
            >인증서 보기</RouterLink
          >
          <RouterLink v-else :to="returnPath" class="button primary">{{
            a.renewalBatchId ? '재인증 결과 확인' : '평가 선택으로'
          }}</RouterLink>
          <RouterLink :to="learningPath" class="button secondary">{{
            result === 'failed' ? '학습자료 확인' : '학습으로 이동'
          }}</RouterLink>
          <RouterLink
            v-if="e.completion"
            :to="{ path: `/completions/${e.completion.id}`, query: { stage: 'assessment' } }"
            class="button secondary"
            >인증Set 수료증 보기</RouterLink
          >
          <RouterLink
            v-if="result === 'failed' || practicalNext || a.certifiedAt"
            :to="returnPath"
            class="text-link"
            >평가 선택으로</RouterLink
          >
        </div>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      </div>
    </section>
    <template v-else>
      <section v-if="prerequisite" class="assessment-prerequisite panel" role="status">
        <AppIcon name="lock" />
        <div>
          <h2>지식 평가를 먼저 통과해 주세요</h2>
          <p>저장된 상황 대응 답안은 보존됩니다. 지식 평가를 통과하면 이어서 응시할 수 있습니다.</p>
          <RouterLink :to="knowledgePath" class="button primary">지식 평가로 이동</RouterLink>
        </div>
      </section>
      <div v-if="stage === 'edit'" class="assessment-progress" aria-label="응시 현황">
        <span>{{ answered }} / {{ questions.length }} 응답</span
        ><span
          >미응답 <strong>{{ missing.length }}</strong></span
        ><span>합격 기준 {{ passScore == null ? '미설정' : `${passScore}%` }}</span>
      </div>
      <div v-if="stage === 'edit'" class="number-editor panel">
        <button
          type="button"
          class="button secondary question-index-toggle"
          :aria-expanded="questionNavOpen"
          :aria-controls="uid + '-questions'"
          @click="questionNavOpen = !questionNavOpen"
        >
          문항 선택 · {{ position + 1 }} / {{ questions.length }}<AppIcon name="down" :size="16" />
        </button>
        <CompactTabs
          :id="uid + '-questions'"
          ref="tabs"
          :model-value="selected"
          @update:model-value="chooseQuestion"
          :class="{ 'question-index-open': questionNavOpen }"
          :items="options"
          vertical
          numbered
          number-suffix="번"
          label="응시 문항"
          :panel-id="uid + '-answer'"
        />
        <fieldset
          v-if="current"
          :id="uid + '-answer'"
          role="tabpanel"
          :aria-labelledby="tabs?.tabId(current.id)"
          class="answer-panel"
          :disabled="busy || !attempt || conflict || !!prerequisite || held"
        >
          <legend class="sr-only">{{ position + 1 }}번 문항</legend>
          <section v-if="'scenario' in current" class="scenario-context">
            <h3>상황</h3>
            <p>{{ current.scenario }}</p>
          </section>
          <p class="assessment-content-label">문항</p>
          <h3 class="assessment-question-prompt">{{ current.prompt }}</h3>
          <p :id="uid + '-choices-label'" class="assessment-content-label assessment-choices-label">
            보기
          </p>
          <div class="choices" role="group" :aria-labelledby="uid + '-choices-label'">
            <label
              v-for="(option, i) in current.choices"
              :key="i"
              class="choice"
              :class="{ chosen: draft.answers[current.id] === i }"
              ><input
                type="radio"
                :aria-label="`${i + 1}번 : ${option}`"
                :name="current.id"
                :checked="draft.answers[current.id] === i"
                @change="answer(current.id, i)"
              /><span class="choice-number">{{ i + 1 }}번 :</span
              ><span class="choice-text">{{ option }}</span></label
            >
          </div>
          <div class="actions question-actions">
            <button class="button secondary" :disabled="position === 0" @click="navigate(-1)">
              이전 문항</button
            ><button class="button secondary" @click="navigate(1)">다음 문항</button>
          </div>
        </fieldset>
      </div>
      <section v-else class="panel review-panel assessment-review" aria-label="제출 전 답안 확인">
        <header class="review-heading">
          <span class="review-count">{{ answered }} / {{ questions.length }} 응답 완료</span
          ><span class="review-range"
            >{{ (reviewPage - 1) * 20 + 1 }}–{{ Math.min(reviewPage * 20, questions.length) }}번 ·
            총 {{ questions.length }}문항</span
          >
          <nav v-if="reviewPages > 1" class="review-pagination" aria-label="답안 확인 페이지">
            <button
              class="button secondary"
              :disabled="reviewPage === 1 || busy"
              @click="changeReviewPage(reviewPage - 1)"
            >
              이전 페이지</button
            ><span>{{ reviewPage }} / {{ reviewPages }}</span
            ><button
              class="button secondary"
              :disabled="reviewPage === reviewPages || busy"
              @click="changeReviewPage(reviewPage + 1)"
            >
              다음 페이지
            </button>
          </nav>
        </header>
        <div class="review-list">
          <article
            v-for="{ question: q, index: i } in reviewQuestions"
            :key="q.id"
            class="review-row review-question"
            :data-review-question="q.id"
            tabindex="-1"
            :aria-label="`${i + 1}번 답안`"
          >
            <div class="review-question-body">
              <span class="review-number">{{ i + 1 }}</span>
              <section v-if="'scenario' in q" class="review-scenario">
                <h4>상황</h4>
                <p>{{ q.scenario }}</p>
              </section>
              <h3>{{ q.prompt }}</h3>
              <div class="review-selected">
                <span>선택 답안 · {{ (draft.answers[q.id] ?? -1) + 1 }}번</span>
                <p>{{ q.choices[draft.answers[q.id]!] }}</p>
                <button
                  class="button secondary review-edit"
                  :aria-label="`${i + 1}번 답안 수정`"
                  :disabled="busy"
                  @click="editQuestion(q.id)"
                >
                  답안 수정
                </button>
              </div>
            </div>
          </article>
        </div>
        <nav
          v-if="reviewPages > 1"
          class="review-pagination review-pagination-bottom"
          aria-label="답안 확인 하단 페이지"
        >
          <button
            class="button secondary"
            :disabled="reviewPage === 1 || busy"
            @click="changeReviewPage(reviewPage - 1)"
          >
            이전 페이지</button
          ><span>{{ reviewPage }} / {{ reviewPages }}</span
          ><button
            class="button secondary"
            :disabled="reviewPage === reviewPages || busy"
            @click="changeReviewPage(reviewPage + 1)"
          >
            다음 페이지
          </button>
        </nav>
      </section>
      <ActionBar ref="submitbar" class="actionbar assessment-submitbar">
        <div class="assessment-save-area">
          <SaveFeedback
            :status="
              { saved: '저장됨', saving: '저장 중', dirty: '저장 대기', error: '저장 실패' }[
                saveStatus
              ]
            "
            :error="saveError"
            :conflict="conflict"
            :busy="busy"
            @retry="retrySave"
            @reload="reload"
          />
          <p v-if="error" class="error-message assessment-submit-error" role="alert" tabindex="-1">
            {{ error }}
          </p>
        </div>
        <div class="assessment-submit-actions">
          <p
            v-if="
              stage === 'review' &&
              c.subjectiveEnabled &&
              !e.completion &&
              e.subjective?.status !== 'submitted' &&
              c.assessmentKinds.every((k) => k === kind || e?.[k] === 'passed')
            "
            class="submission-warning"
          >
            이 평가를 통과하면 인증Set이 수료되어 미제출 주관식 답변을 더 이상 작성·제출할 수
            없습니다. 주관식 미제출은 수료에 영향을 주지 않습니다.
          </p>
          <p v-if="stage === 'review'" class="submission-warning">
            <AppIcon name="lock" :size="16" />최종 제출 후에는 답안을 수정할 수 없습니다.
          </p>
          <div class="actions">
            <button
              v-if="stage === 'review'"
              class="button secondary"
              :disabled="busy"
              @click="editQuestion(selected)"
            >
              계속 풀기
            </button>
            <div v-else class="assessment-secondary-links">
              <RouterLink :to="returnPath" class="text-link">평가 선택으로</RouterLink
              ><RouterLink :to="learningPath" class="text-link">학습으로 이동</RouterLink>
            </div>
            <button
              class="button primary"
              :disabled="busy || !attempt || conflict || !!prerequisite || held"
              @click="stage === 'review' ? submit() : review()"
            >
              {{
                stage === 'review'
                  ? '최종 제출'
                  : reviewReturn
                    ? '답안 확인으로 돌아가기'
                    : '답안 확인'
              }}
            </button>
          </div>
        </div>
      </ActionBar>
    </template>
    <AppDialog
      v-model:open="noticeOpen"
      :title="noticeType === 'last' ? '마지막 문항입니다' : '모든 문항에 답해야 제출할 수 있습니다'"
      @closed="noticeClosed"
      ><p v-if="noticeType === 'last'">
        마지막 문항입니다. 답안 확인을 선택하면 선택한 답안을 검토한 뒤 최종 제출할 수 있습니다.
      </p>
      <template v-else
        ><p>
          미응답 {{ missingNumbers.length }}문항이 있습니다. 모든 문항에 답해야 제출할 수 있습니다.
        </p>
        <p class="missing-number-list">
          미응답: {{ missingNumbers.slice(0, 30).join(', ') }}번{{
            missingNumbers.length > 30 ? ' 외 ' + (missingNumbers.length - 30) + '문항' : ''
          }}
        </p>
        <p>확인을 누르면 첫 미응답 문항으로 이동합니다.</p></template
      ><template #footer
        ><button class="button primary" @click="noticeOpen = false">확인</button></template
      ></AppDialog
    >
  </div>
  <div v-else class="container page empty-state">
    <h1>평가를 찾을 수 없습니다.</h1>
    <RouterLink to="/">홈으로</RouterLink>
  </div>
</template>
