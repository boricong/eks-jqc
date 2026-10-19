<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import { type Draft, type AssessmentAttempt } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import { useSavedDraft } from '../composables/useSavedDraft';
import StatusBadge from '../components/StatusBadge.vue';
const store = useDemo(),
  route = useRoute(),
  busy = ref(false),
  error = ref(''),
  review = ref(false),
  savedAttempt = ref<AssessmentAttempt | null>(null);
const isFT = computed(() => route.name === 'subjective-evaluation');
const a = computed(() => {
  const a = store.assignment(String(route.params.id));
  return a &&
    !a.excludedReason &&
    (isFT.value
      ? a.ftId === store.actorId && a.learnerId !== store.actorId
      : a.learnerId === store.actorId)
    ? a
    : undefined;
});
const e = computed(() => a.value?.enrollments.find((e) => e.courseId === route.params.courseId));
const c = computed(() => e.value && store.course(e.value.courseId));
const valid = computed(() => c.value?.assessmentKinds.includes('subjective'));
const state = computed(() => e.value?.subjective);
const last = computed(() => e.value?.history.filter((h) => h.kind === 'subjective').at(-1));
const planGoal = computed(
  () =>
    store.data.plans
      .find((p) => p.id === a.value?.planId)
      ?.schedules.find((s) => s.courseId === c.value?.id)?.goal,
);
const back = computed(() =>
  isFT.value ? '/evaluations' : `/qualifications/${a.value?.id}?course=${c.value?.id}`,
);
type Fields = {
  subjectiveAnswers: Record<string, string>;
  grades: NonNullable<Draft['grades']>;
  feedback: string;
};
const draft = useSavedDraft<Fields>((value, revision) =>
  store.command(
    `/attempts/${savedAttempt.value!.id}/${isFT.value ? 'grading' : 'draft'}`,
    isFT.value
      ? { revision, grades: value.grades, feedback: value.feedback }
      : { revision, answers: {}, verdicts: {}, subjectiveAnswers: value.subjectiveAnswers },
    'PUT',
  ),
);
const form = draft.value;
function loadAttempt(t: AssessmentAttempt) {
  savedAttempt.value = JSON.parse(JSON.stringify(t));
  draft.load(
    {
      subjectiveAnswers: t.subjectiveAnswers || {},
      grades: t.grades || {},
      feedback: t.feedback || '',
    },
    t.revision,
  );
}
let preparation = 0;
onBeforeUnmount(() => {
  preparation++;
});
async function prepare(start = false) {
  const token = ++preparation;
  savedAttempt.value = null;
  draft.clear();
  busy.value = true;
  error.value = '';
  review.value = false;
  try {
    if (!a.value || !e.value || !c.value || !valid.value) return;
    const t = e.value.activeAttempts.subjective;
    if (t) loadAttempt(t);
    else if (!isFT.value && e.value.learningComplete && (start || state.value === 'ready')) {
      const result = await store.startAttempt(a.value.id, c.value.id, 'subjective');
      if (token === preparation) loadAttempt(result);
    }
  } catch (err) {
    if (token === preparation) error.value = (err as Error).message;
  } finally {
    if (token === preparation) busy.value = false;
  }
}
function grade(id: string, points?: number, reason?: string) {
  if (!form.value) return;
  const old = form.value.grades[id];
  form.value.grades[id] = {
    points: points ?? old?.points ?? 0,
    reason: reason ?? old?.reason ?? '',
  };
  draft.changed();
}
function validate() {
  if (!form.value || !c.value) return ['평가를 다시 불러와 주세요.'];
  if (isFT.value) {
    const errors = c.value.subjectiveQuestions
      .filter(
        (q) =>
          !form.value!.grades[q.id]?.reason.trim() ||
          form.value!.grades[q.id]!.points > q.points ||
          !Number.isInteger(form.value!.grades[q.id]!.points) ||
          form.value!.grades[q.id]!.points < 0,
      )
      .map((_, i) => `${i + 1}번째 미완료 문항의 점수·채점 근거를 확인해 주세요.`);
    return errors;
  }
  return c.value.subjectiveQuestions
    .filter((q) => !form.value!.subjectiveAnswers[q.id]?.trim())
    .map((_, i) => `${i + 1}번째 미응답 문항을 확인해 주세요.`);
}
function confirm() {
  error.value = validate().join('\n');
  if (!error.value) {
    review.value = true;
    window.scrollTo({ top: 0 });
  }
}
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const errors = validate();
    if (errors.length) throw new Error(errors.join('\n'));
    await draft.flush();
    await store.command(
      `/attempts/${savedAttempt.value!.id}/${isFT.value ? 'grading/finalize' : 'submit'}`,
      {
        revision: draft.revision.value,
        ...(isFT.value ? { grades: form.value!.grades, feedback: form.value!.feedback } : {}),
      },
    );
    review.value = false;
    store.notify(
      isFT.value
        ? `${store.username(a.value!.learnerId)} 님의 주관식 채점을 확정했습니다.`
        : '답안을 제출했습니다. FT 채점을 기다려 주세요.',
    );
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
async function reload() {
  if (!window.confirm('입력을 서버의 내용으로 다시 불러올까요?')) return;
  await store.refresh();
  await prepare();
}
watch(
  () => `${store.actorId}:${route.fullPath}`,
  () => void prepare(),
  { immediate: true },
);
const leave = () => (busy.value ? false : draft.canLeave());
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <div v-if="a && e && c && valid" class="container page assessment-page">
    <RouterLink :to="back" class="back-link">{{ isFT ? 'FT 평가로' : '학습·평가로' }}</RouterLink>
    <div class="page-heading">
      <div>
        <h1>{{ isFT ? '주관식 채점' : '주관식 평가' }}</h1>
        <p>
          {{ c.title }} · v{{ c.version
          }}<span v-if="isFT"> · 학습자 {{ store.username(a.learnerId) }}</span>
        </p>
      </div>
      <StatusBadge :status="state!" />
    </div>
    <p v-if="planGoal" class="panel goal-note"><strong>학습 목표</strong> {{ planGoal }}</p>
    <p v-if="error || draft.error.value" class="error-message preserve-lines" role="alert">
      {{ error || draft.error.value }}
    </p>
    <div v-if="draft.error.value || (error && form)" class="actions">
      <button class="button secondary" @click="draft.flush().catch(() => {})">저장 다시 시도</button
      ><button class="button secondary" @click="reload">다시 불러오기</button>
    </div>
    <section v-if="state === 'passed' || state === 'failed'" class="panel editor-panel">
      <h2>
        {{
          isFT
            ? `${store.username(a.learnerId)} 님의 주관식 평가 결과`
            : state === 'passed'
              ? '주관식 평가를 통과했습니다.'
              : '주관식 평가에 다시 응시할 수 있습니다.'
        }}
      </h2>
      <p v-if="e.completion">
        {{
          isFT
            ? `${store.username(a.learnerId)} 님이 해당 과정을 수료했습니다.`
            : '이 과정의 필수 평가를 모두 통과하여 수료했습니다.'
        }}
      </p>
      <p v-else>
        {{
          c.assessmentKinds
            .filter((k) => e![k] !== 'passed')
            .map((k) => ({ objective: '객관식', subjective: '주관식', practical: '실기' })[k])
            .join(' · ')
        }}
        평가가 남아 있습니다.
      </p>
      <p v-if="last?.feedback" class="preserve-lines">{{ last.feedback }}</p>
      <button
        v-if="!isFT && state === 'failed'"
        class="button primary"
        :disabled="busy"
        @click="prepare(true)"
      >
        주관식 다시 응시
      </button>
      <RouterLink
        v-if="e.completion"
        :to="`/completions/${e.completion.id}`"
        class="button secondary"
        >수료증 보기</RouterLink
      >
      <details v-if="isFT && last?.grades">
        <summary>확정 채점 근거</summary>
        <div v-for="q in c.subjectiveQuestions" :key="q.id">
          <h3>{{ q.prompt }}</h3>
          <p class="preserve-lines">답안: {{ last.subjectiveAnswers?.[q.id] }}</p>
          <p>{{ last.grades[q.id]?.points }} / {{ q.points }}점</p>
          <p class="preserve-lines">{{ last.grades[q.id]?.reason }}</p>
        </div>
      </details>
    </section>
    <section v-else-if="state === 'waiting' && !isFT" class="panel editor-panel">
      <h2>FT 채점 대기</h2>
      <p>
        답안을 제출했습니다. 담당 FT {{ store.username(a.ftId) }} 님의 채점을 기다리고 있습니다.
      </p>
      <details>
        <summary>제출 답안 확인</summary>
        <div v-for="q in c.subjectiveQuestions" :key="q.id">
          <h3>{{ q.prompt }}</h3>
          <p class="preserve-lines">{{ e.activeAttempts.subjective?.subjectiveAnswers?.[q.id] }}</p>
        </div>
      </details>
      <RouterLink :to="back" class="button primary">다른 학습·평가 진행</RouterLink>
    </section>
    <section v-else-if="!e.learningComplete" class="panel empty-state">
      <h2>필수 학습 완료 기록이 필요합니다.</h2>
      <RouterLink :to="back" class="button primary">학습 기록으로</RouterLink>
    </section>
    <section v-else-if="isFT && state !== 'waiting'" class="panel empty-state">
      <h2>학습자의 주관식 답안 제출을 기다리고 있습니다.</h2>
    </section>
    <template v-else-if="form && savedAttempt">
      <div class="section-heading">
        <h2>
          {{ review ? (isFT ? '채점 확인' : '답안 확인') : isFT ? '문항별 채점' : '답안 작성' }}
        </h2>
        <span role="status">{{ draft.status.value }}</span>
      </div>
      <p>주관식 합격 기준 {{ c.subjectivePassScore }}% · 담당 FT {{ store.username(a.ftId) }}</p>
      <section
        v-for="(q, index) in c.subjectiveQuestions"
        :key="q.id"
        class="panel editor-panel subjective-question"
      >
        <h2>{{ index + 1 }}. {{ q.prompt }}</h2>
        <template v-if="isFT"
          ><p class="preserve-lines learner-answer">{{ form.subjectiveAnswers[q.id] }}</p>
          <details>
            <summary>채점 기준·모범답안</summary>
            <p class="preserve-lines">{{ q.rubric }}</p>
            <p v-if="q.modelAnswer" class="preserve-lines">{{ q.modelAnswer }}</p>
          </details>
          <label class="field"
            ><span>점수 · {{ q.points }}점 만점</span
            ><input
              :value="form.grades[q.id]?.points"
              :disabled="busy || review"
              type="number"
              min="0"
              :max="q.points"
              @input="grade(q.id, Number(($event.target as HTMLInputElement).value))" /></label
          ><label class="field"
            ><span>채점 근거 · 학습자에게 비공개</span
            ><textarea
              :value="form.grades[q.id]?.reason || ''"
              :disabled="busy || review"
              rows="3"
              @input="grade(q.id, undefined, ($event.target as HTMLTextAreaElement).value)"
            /></label
        ></template>
        <label v-else class="field"
          ><span>{{ index + 1 }}번 답안</span
          ><textarea
            v-model="form.subjectiveAnswers[q.id]"
            :readonly="review"
            :disabled="busy"
            rows="6"
            maxlength="20000"
            @input="draft.changed"
          />
        </label>
      </section>
      <label v-if="isFT" class="field panel editor-panel"
        ><span>공개 피드백 · 미통과 시 필수</span
        ><textarea
          v-model="form.feedback"
          :disabled="busy || review"
          rows="3"
          @input="draft.changed"
        />
      </label>
      <p v-if="!isFT && !a.ftId" class="muted">
        FT 미배정 · 답안은 저장할 수 있으며 제출은 조직 관리자가 FT를 지정한 뒤 가능합니다.
      </p>
      <div class="actionbar">
        <span class="muted">{{
          review
            ? isFT
              ? '확정 후 판정과 근거는 보존됩니다.'
              : '제출 후 답안은 수정할 수 없습니다.'
            : '입력 내용은 자동 저장됩니다.'
        }}</span>
        <div class="actions">
          <button v-if="review" class="button secondary" :disabled="busy" @click="review = false">
            수정하기</button
          ><button
            class="button primary"
            :disabled="busy || draft.conflict.value || (!isFT && !a.ftId)"
            @click="review ? submit() : confirm()"
          >
            {{ review ? (isFT ? '채점 확정' : '답안 제출') : isFT ? '채점 확인' : '답안 확인' }}
          </button>
        </div>
      </div>
    </template>
  </div>
  <div v-else class="container page empty-state">
    <h1>평가를 찾을 수 없습니다.</h1>
    <RouterLink to="/">홈으로</RouterLink>
  </div>
</template>
