<script setup lang="ts">
import { useProcessContext } from '../composables/useProcessContext';
import { computed, ref, watch, nextTick, useId } from 'vue';
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { useAttemptDraft } from '../composables/useAttemptDraft';
import { useDemo } from '../stores/demo';
import { kindLabels, type Kind } from '@eks/contracts';
import CompactTabs from '../components/CompactTabs.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
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
const answered = computed(
  () => questions.value.filter((q) => draft.value.answers[q.id] !== undefined).length,
);
const options = computed(() =>
  questions.value.map((q, i) => ({
    id: q.id,
    label: `${i + 1}번 ${q.prompt} · ${draft.value.answers[q.id] === undefined ? '미응답' : '응답 완료'}`,
    invalid: !!error.value && draft.value.answers[q.id] === undefined,
  })),
);
const returnPath = computed(() => `/qualifications/${a.value?.id}?course=${c.value?.id}`);
const result = computed(() => e.value?.[kind.value]);
const isResult = computed(() => stage.value === 'result' || result.value === 'passed');
useProcessContext(() => `assessment-${isResult.value ? 'result' : stage.value}`);
const last = computed(() => e.value?.history.filter((h) => h.kind === kind.value).at(-1));
let generation = 0;
async function prepare() {
  const seq = ++generation;
  busy.value = true;
  error.value = '';
  stage.value = 'edit';
  load(null);
  try {
    if (!valid.value || !a.value || !c.value || !e.value) return;
    selected.value = questions.value[0]?.id || '';
    if (result.value !== 'passed') {
      const v = await store.startAttempt(a.value.id, c.value.id, kind.value);
      if (seq === generation) load(v);
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
async function review() {
  if (answered.value !== questions.value.length) {
    error.value = '모든 문항에 응답해 주세요.';
    selected.value = questions.value.find((q) => draft.value.answers[q.id] === undefined)!.id;
    await nextTick();
    document.querySelector<HTMLElement>('.answer-panel input')?.focus();
    return;
  }
  try {
    await flush();
    stage.value = 'review';
  } catch {
    /* preserve input and show save error */
  }
}
async function submit() {
  if (busy.value || !attempt.value) return;
  busy.value = true;
  error.value = '';
  try {
    await flush();
    await store.command(`/attempts/${attempt.value.id}/submit`, {
      revision: attempt.value.revision,
    });
    load(null);
    stage.value = 'result';
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
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
  selected.value = questions.value[position.value + d]?.id || selected.value;
}
watch(() => route.fullPath, prepare, { immediate: true });
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
</script>
<template>
  <div v-if="valid && a && e && c" class="container page assessment-page">
    <RouterLink :to="returnPath" class="back-link">← {{ c.title }}</RouterLink>
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
    <div v-if="isResult" class="panel result-panel">
      <StatusBadge :status="result || 'ready'" />
      <h2>
        {{
          result === 'passed'
            ? store.complete(e)
              ? '과정을 수료했습니다.'
              : '평가를 통과했습니다.'
            : '다시 응시할 수 있습니다.'
        }}
      </h2>
      <p>
        {{ kindLabels[kind] }} · 자동 채점 · {{ last?.earned }} / {{ last?.total }}점 ·
        {{ last?.round }}회
      </p>
      <p v-if="last?.date" class="muted">
        확정 {{ new Date(last.date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) }}
      </p>
      <div class="result-assessments">
        <span v-for="k in c.assessmentKinds" :key="k"
          >{{ kindLabels[k] }} <StatusBadge :status="e[k]"
        /></span>
      </div>
      <div class="actions">
        <RouterLink :to="returnPath" class="button secondary">과정으로</RouterLink
        ><button v-if="result === 'failed'" class="button primary" @click="prepare">
          다시 응시</button
        ><RouterLink v-if="a.certifiedAt" :to="`/certifications/${a.id}`" class="button primary"
          >인증서 보기</RouterLink
        >
      </div>
    </div>
    <template v-else
      ><div v-if="saveError" class="error-message save-error" role="alert">
        <span>{{ saveError }}</span
        ><button v-if="!conflict" class="button secondary" @click="retrySave">저장 재시도</button
        ><button class="button secondary" @click="reload">다시 불러오기</button>
      </div>
      <p class="muted">
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
          :disabled="busy || !attempt || conflict"
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
            ><button
              class="button secondary"
              :disabled="position === questions.length - 1"
              @click="navigate(1)"
            >
              다음 문항
            </button>
          </div>
        </fieldset>
      </div>
      <div v-else class="panel review-panel">
        <h2>제출 전 답안 확인</h2>
        <div v-for="(q, i) in questions" :key="q.id" class="review-row">
          <span>{{ i + 1 }}</span>
          <div>
            <h3>{{ q.prompt }}</h3>
            <p>{{ q.choices[draft.answers[q.id]!] }}</p>
          </div>
          <button
            class="text-link"
            @click="
              selected = q.id;
              stage = 'edit';
            "
          >
            수정
          </button>
        </div>
        <p>제출 후 답안은 수정할 수 없습니다.</p>
      </div>
      <div class="actionbar">
        <span class="save-status" role="status">{{
          { saved: '저장됨', saving: '저장 중', dirty: '저장 대기', error: '저장 실패' }[saveStatus]
        }}</span>
        <div class="actions">
          <RouterLink :to="returnPath" class="button secondary">과정으로</RouterLink
          ><button
            v-if="stage === 'review'"
            class="button primary"
            :disabled="busy || conflict"
            @click="submit"
          >
            제출</button
          ><button
            v-else
            class="button primary"
            :disabled="busy || !attempt || conflict"
            @click="review"
          >
            답안 확인
          </button>
        </div>
      </div></template
    ><AppDialog v-model:open="materialOpen" :title="`${c.title} · 학습자료`"
      ><CourseMaterials :materials="c.materials"
    /></AppDialog>
  </div>
  <div v-else class="container page empty-state">
    <h1>평가를 찾을 수 없습니다.</h1>
    <RouterLink to="/">홈으로</RouterLink>
  </div>
</template>
