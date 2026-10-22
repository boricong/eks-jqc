<script setup lang="ts">
import { useProcessContext } from '../composables/useProcessContext';
import { computed, ref, watch, nextTick, useId } from 'vue';
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { useAttemptDraft } from '../composables/useAttemptDraft';
import { useDemo } from '../stores/demo';
import { kindLabels, assessmentPrerequisite, type Kind } from '@eks/contracts';
import { ApiError } from '../api';
import CompactTabs from '../components/CompactTabs.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
import AppIcon from '../components/AppIcon.vue';
import CourseMaterials from '../components/CourseMaterials.vue';
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
  materialOpen = ref(false),
  tabs = ref<InstanceType<typeof CompactTabs>>();
const noticeOpen = ref(false),
  noticeType = ref<'last' | 'missing'>('last'),
  missingIds = ref<string[]>([]),
  reviewPage = ref(1);
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
const returnPath = computed(() => `/qualifications/${a.value?.id}?course=${c.value?.id}`);
const knowledgePath = computed(
  () => `/qualifications/${a.value?.id}/courses/${c.value?.id}/objective`,
);
const result = computed(() => e.value?.[kind.value]);
const isResult = computed(() => stage.value === 'result' || result.value === 'passed');
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
      if (seq === generation) load(value);
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
async function focusAnswer() {
  await nextTick();
  document.querySelector<HTMLElement>('.answer-panel input')?.focus();
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
  if (busy.value || prerequisite.value) return;
  if (missing.value.length) {
    showMissing();
    return;
  }
  const seq = generation;
  busy.value = true;
  try {
    await flush();
    if (seq === generation) {
      stage.value = 'review';
      await nextTick();
      document.querySelector<HTMLElement>('.assessment-review h2')?.focus();
    }
  } catch {
    /* The autosave component retains the answer and error. */
  } finally {
    if (seq === generation) busy.value = false;
  }
}
async function submit() {
  if (busy.value || !attempt.value || prerequisite.value) return;
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
      document.querySelector<HTMLElement>('.assessment-outcome h2')?.focus();
    }
  } catch (err) {
    if (seq !== generation) return;
    error.value = (err as Error).message;
    if (err instanceof ApiError && err.code === 'ASSESSMENT_INCOMPLETE')
      showMissing((err.details?.missingQuestionIds as string[]) || missing.value.map((q) => q.id));
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
  if (!window.confirm('현재 입력을 서버에 저장된 답안으로 바꿀까요?')) return;
  await store.refresh();
  await prepare();
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
  selected.value = id;
  stage.value = 'edit';
  await focusAnswer();
}
async function changeReviewPage(page: number) {
  reviewPage.value = page;
  await nextTick();
  document.querySelector<HTMLElement>('.assessment-review h2')?.focus();
}
watch(() => [route.fullPath, store.actorId], prepare, { immediate: true });
watch(
  () => prerequisite.value?.code,
  (value, previous) => {
    if (previous && !value && !isResult.value && !busy.value) void prepare();
  },
);
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
</script>
<template>
  <div
    v-if="valid && a && e && c"
    class="container page assessment-page"
    :class="{ 'is-assessment-result': isResult }"
  >
    <RouterLink :to="returnPath" class="back-link">← 자격 상세 · {{ c.title }}</RouterLink>
    <div class="page-heading">
      <div>
        <h1>{{ isResult ? '평가 결과' : kindLabels[kind] }}</h1>
        <p>
          {{ c.title }} ·
          {{
            kind === 'practical'
              ? '가상 상황의 대응 선택을 평가합니다.'
              : '개념과 기준의 이해를 평가합니다.'
          }}
        </p>
      </div>
      <button v-if="c.materials.length" class="button secondary" @click="materialOpen = true">
        학습자료
      </button>
    </div>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <section
      v-if="isResult"
      class="panel result-panel assessment-outcome"
      :class="result === 'passed' ? 'outcome-passed' : 'outcome-failed'"
      aria-label="평가 결과 요약"
    >
      <div class="outcome-content">
        <div class="outcome-icon">
          <AppIcon :name="result === 'passed' ? 'check' : 'alert'" :size="32" />
        </div>
        <p class="outcome-eyebrow">{{ kindLabels[kind] }} · {{ last?.round }}회 · 자동 채점</p>
        <h2 tabindex="-1">{{ result === 'passed' ? '평가 통과' : '미통과 · 재응시 가능' }}</h2>
        <p class="outcome-description">
          {{
            result === 'passed'
              ? store.complete(e)
                ? '필수 평가를 모두 통과하여 인증Set을 수료했습니다.'
                : kind === 'objective'
                  ? '지식 평가를 통과했습니다. 상황 대응 평가를 이어서 진행해 주세요.'
                  : '상황 대응 평가를 통과했습니다. 남은 필수 평가를 확인해 주세요.'
              : '합격 기준에 도달하지 못했습니다. 학습자료를 확인한 뒤 다시 응시할 수 있습니다.'
          }}
        </p>
        <dl class="outcome-facts">
          <div>
            <dt>평가 점수</dt>
            <dd>
              <strong>{{ last?.earned }}</strong> / {{ last?.total }}점
            </dd>
          </div>
          <div>
            <dt>합격 기준</dt>
            <dd>{{ kind === 'objective' ? c.passScore : c.practicalPassScore }}% 이상</dd>
          </div>
          <div v-if="last?.date">
            <dt>확정 일시 · KST</dt>
            <dd>{{ new Date(last.date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) }}</dd>
          </div>
        </dl>
        <div class="result-assessments">
          <span v-for="k in c.assessmentKinds" :key="k"
            >{{ kindLabels[k] }} <StatusBadge :status="e[k]"
          /></span>
        </div>
        <div class="actions outcome-actions">
          <RouterLink
            v-if="practicalNext"
            :to="`/qualifications/${a.id}/courses/${c.id}/practical`"
            class="button primary"
            >상황 대응 평가 시작</RouterLink
          >
          <button
            v-if="result === 'failed'"
            class="button primary"
            :disabled="busy"
            @click="prepare"
          >
            다시 응시
          </button>
          <button
            v-if="result === 'failed' && c.materials.length"
            class="button secondary"
            @click="materialOpen = true"
          >
            학습자료 확인
          </button>
          <RouterLink
            v-if="e.completion"
            :to="`/completions/${e.completion.id}`"
            class="button secondary"
            >인증Set 수료증 보기</RouterLink
          >
          <RouterLink v-if="a.certifiedAt" :to="`/certifications/${a.id}`" class="button primary"
            >인증서 보기</RouterLink
          >
          <RouterLink :to="returnPath" class="button secondary">자격 상세로</RouterLink>
        </div>
        <p class="outcome-credit">
          배경:
          <a href="https://heropatterns.com/" target="_blank" rel="noopener noreferrer"
            >Topography · Steve Schoger</a
          >
          ·
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            >CC BY 4.0</a
          >
          · 색상·불투명도 조정
        </p>
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
      <div v-if="saveError" class="error-message save-error" role="alert">
        <span>{{ saveError }}</span
        ><button v-if="!conflict" class="button secondary" @click="retrySave">저장 재시도</button
        ><button class="button secondary" @click="reload">다시 불러오기</button>
      </div>
      <p class="assessment-progress">
        {{ answered }} / {{ questions.length }} 응답 · 합격 기준
        {{ kind === 'objective' ? c.passScore : c.practicalPassScore }}%
      </p>
      <div v-if="stage === 'edit'" class="number-editor panel">
        <CompactTabs
          ref="tabs"
          v-model="selected"
          :items="options"
          vertical
          label="응시 문항"
          :panel-id="uid + '-answer'"
        />
        <fieldset
          v-if="current"
          :id="uid + '-answer'"
          role="tabpanel"
          :aria-labelledby="tabs?.tabId(current.id)"
          class="answer-panel"
          :disabled="busy || !attempt || conflict || !!prerequisite"
        >
          <legend class="sr-only">{{ position + 1 }}번 문항</legend>
          <h2>{{ position + 1 }}번</h2>
          <section v-if="'scenario' in current" class="scenario-context">
            <h3>상황</h3>
            <p>{{ current.scenario }}</p>
          </section>
          <h3>{{ current.prompt }}</h3>
          <div class="choices">
            <label
              v-for="(option, i) in current.choices"
              :key="i"
              class="choice"
              :class="{ chosen: draft.answers[current.id] === i }"
              ><input
                type="radio"
                :aria-label="option"
                :name="current.id"
                :checked="draft.answers[current.id] === i"
                @change="answer(current.id, i)"
              /><span>{{ i + 1 }}. {{ option }}</span></label
            >
          </div>
          <div class="actions">
            <button class="button secondary" :disabled="position === 0" @click="navigate(-1)">
              이전 문항</button
            ><button class="button secondary" @click="navigate(1)">다음 문항</button>
          </div>
        </fieldset>
      </div>
      <section v-else class="panel review-panel assessment-review" aria-label="제출 전 답안 확인">
        <header class="review-heading">
          <div>
            <p class="review-eyebrow">최종 제출 전 마지막 확인</p>
            <h2 tabindex="-1">제출 전 답안 확인</h2>
            <p>{{ c.title }} · {{ kindLabels[kind] }}</p>
          </div>
          <span class="review-count">{{ answered }} / {{ questions.length }} 응답 완료</span>
        </header>
        <div class="review-list">
          <article
            v-for="{ question: q, index: i } in reviewQuestions"
            :key="q.id"
            class="review-row review-question"
          >
            <span class="review-number">{{ i + 1 }}</span>
            <div class="review-question-body">
              <h3>{{ q.prompt }}</h3>
              <section v-if="'scenario' in q" class="review-scenario">
                <h4>제시된 상황</h4>
                <p>{{ q.scenario }}</p>
              </section>
              <div class="review-selected">
                <span>내가 선택한 답</span>
                <p>
                  <strong>{{ (draft.answers[q.id] ?? -1) + 1 }}번</strong>
                  {{ q.choices[draft.answers[q.id]!] }}
                </p>
              </div>
            </div>
            <button
              class="button secondary review-edit"
              :aria-label="`${i + 1}번 답안 수정`"
              @click="editQuestion(q.id)"
            >
              수정
            </button>
          </article>
        </div>
        <nav v-if="reviewPages > 1" class="review-pagination" aria-label="답안 확인 페이지">
          <button
            class="button secondary"
            :disabled="reviewPage === 1"
            @click="changeReviewPage(reviewPage - 1)"
          >
            이전 페이지</button
          ><span>{{ reviewPage }} / {{ reviewPages }} 페이지 · 총 {{ questions.length }}문항</span
          ><button
            class="button secondary"
            :disabled="reviewPage === reviewPages"
            @click="changeReviewPage(reviewPage + 1)"
          >
            다음 페이지
          </button>
        </nav>
      </section>
      <div class="actionbar assessment-submitbar">
        <span class="save-status" role="status">{{
          { saved: '저장됨', saving: '저장 중', dirty: '저장 대기', error: '저장 실패' }[saveStatus]
        }}</span>
        <div class="assessment-submit-actions">
          <p v-if="stage === 'review'" class="submission-warning">
            <AppIcon name="lock" :size="16" />최종 제출 후에는 답안을 수정할 수 없습니다.
          </p>
          <div class="actions">
            <button
              v-if="stage === 'review'"
              class="button secondary"
              :disabled="busy"
              @click="stage = 'edit'"
            >
              계속 풀기</button
            ><RouterLink v-else :to="returnPath" class="button secondary">자격 상세로</RouterLink
            ><button
              class="button primary"
              :disabled="busy || !attempt || conflict || !!prerequisite"
              @click="stage === 'review' ? submit() : review()"
            >
              {{ stage === 'review' ? '최종 제출' : '제출' }}
            </button>
          </div>
        </div>
      </div>
    </template>
    <AppDialog v-model:open="materialOpen" :title="`${c.title} · 학습자료`"
      ><CourseMaterials :materials="c.materials" :context-key="`${store.actorId}:${a.id}:${c.id}`"
    /></AppDialog>
    <AppDialog
      v-model:open="noticeOpen"
      :title="noticeType === 'last' ? '마지막 문항입니다' : '모든 문항에 답해야 제출할 수 있습니다'"
      @closed="noticeClosed"
      ><p v-if="noticeType === 'last'">
        마지막 문항입니다. 제출을 선택하면 답안을 확인한 뒤 최종 제출할 수 있습니다.
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
