<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import type { SubjectiveResponseView } from '@eks/contracts';
import { api, mutate, ApiError } from '../api';
import { randomUUID } from '../uuid';
import { useDemo } from '../stores/demo';
import { useSubjectiveDraft } from '../composables/useSubjectiveDraft';
import { confirmAction } from '../composables/useConfirmation';
import LearnerNav from '../components/LearnerNav.vue';
import CompactTabs from '../components/CompactTabs.vue';
const store = useDemo(),
  route = useRoute(),
  view = ref<SubjectiveResponseView | null>(null),
  busy = ref(false),
  error = ref(''),
  selected = ref(''),
  review = ref(false),
  input = ref<HTMLTextAreaElement>();
const {
  attempt: response,
  draft,
  status,
  error: saveError,
  conflict,
  dirty,
  load,
  flush,
  changed,
  canLeave,
} = useSubjectiveDraft(() => store.actorId);
const assignment = computed(() => store.assignment(String(route.params.id)));
const enrollment = computed(() =>
  assignment.value?.enrollments.find((e) => e.courseId === route.params.courseId),
);
const course = computed(() => enrollment.value && store.course(enrollment.value.courseId));
const questions = computed(() => response.value?.questions || []);
const current = computed(() => questions.value.find((q) => q.id === selected.value));
const answered = computed(
  () => questions.value.filter((q) => draft.value.answers[q.id]?.trim()).length,
);
const readonly = computed(
  () =>
    !view.value?.canWrite ||
    !!enrollment.value?.completion ||
    response.value?.status === 'submitted',
);
const stateLabel = computed(() =>
  response.value?.status === 'submitted'
    ? '답변 제출 완료'
    : enrollment.value?.completion || view.value?.status === 'closed'
      ? '수료로 작성 종료'
      : response.value
        ? '작성 중'
        : '미작성',
);
const items = computed(() =>
  questions.value.map((q, i) => ({
    id: q.id,
    label: `${i + 1}번 · ${draft.value.answers[q.id]?.trim() ? '작성' : '미작성'}`,
  })),
);
let generation = 0;
const pendingSubmit = ref<{ id: string; revision: number; key: string } | null>(null);
async function fetchView() {
  if (!enrollment.value) return;
  const result = await api<SubjectiveResponseView>(
    `/enrollments/${enrollment.value.id}/subjective-response`,
  );
  return result;
}
async function prepare() {
  const seq = ++generation;
  load(null);
  view.value = null;
  selected.value = '';
  review.value = false;
  error.value = '';
  pendingSubmit.value = null;
  if (!enrollment.value || assignment.value?.learnerId !== store.actorId) return;
  busy.value = true;
  try {
    const result = await fetchView();
    if (seq !== generation || !result) return;
    view.value = result;
    load(result.response);
    selected.value = result.response?.questions[0]?.id || '';
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  } finally {
    if (seq === generation) busy.value = false;
  }
}
async function start() {
  if (busy.value || !enrollment.value) return;
  busy.value = true;
  error.value = '';
  try {
    await mutate(
      `/enrollments/${enrollment.value.id}/subjective-response`,
      {},
      'POST',
      store.actorId,
    );
    const result = await fetchView();
    if (result) {
      view.value = result;
      load(result.response);
      selected.value = result.response?.questions[0]?.id || '';
    }
    await nextTick();
    input.value?.focus();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function save() {
  try {
    await flush();
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function inspect() {
  if (readonly.value || busy.value) return;
  if (answered.value !== questions.value.length) {
    error.value = '모든 문항에 답변해 주세요.';
    selected.value = questions.value.find((q) => !draft.value.answers[q.id]?.trim())!.id;
    await nextTick();
    input.value?.focus();
    return;
  }
  busy.value = true;
  try {
    await flush();
    review.value = true;
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function submit() {
  if (busy.value || readonly.value || !response.value) return;
  busy.value = true;
  error.value = '';
  try {
    await flush();
    pendingSubmit.value ??= {
      id: response.value.id,
      revision: response.value.revision,
      key: randomUUID(),
    };
    const r = await mutate<{ id: string; revision: number }>(
      `/subjective-responses/${pendingSubmit.value.id}/submit`,
      { revision: pendingSubmit.value.revision },
      'POST',
      store.actorId,
      pendingSubmit.value.key,
    );
    response.value.status = 'submitted';
    response.value.revision = r.revision;
    view.value!.canWrite = false;
    view.value!.reason = '제출한 답변은 수정할 수 없습니다.';
    pendingSubmit.value = null;
    await store.refresh();
    const fresh = await fetchView();
    if (fresh) {
      view.value = fresh;
      load(fresh.response);
    }
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 409) {
      const fresh = await fetchView().catch(() => undefined);
      if (fresh) view.value = { ...fresh, response: view.value?.response || null };
    }
  } finally {
    busy.value = false;
  }
}
async function reload() {
  if (busy.value) return;
  if (
    dirty.value &&
    !(await confirmAction('현재 입력 대신 서버에 저장된 답변을 불러올까요?', '서버 답변 불러오기'))
  )
    return;
  await prepare();
}
async function leave() {
  return !busy.value && (await canLeave());
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
watch(() => [route.fullPath, store.actorId], prepare, { immediate: true });
</script>
<template>
  <main class="container page subjective-page">
    <template v-if="assignment && enrollment && course && assignment.learnerId === store.actorId">
      <LearnerNav :assignment-id="assignment.id" :course-id="course.id" />
      <h1>주관식 평가</h1>
      <p>{{ course.title }} · {{ stateLabel }}</p>
      <p class="muted">
        답변 수집 전용 · 수료에 영향 없음. 인증Set 수료 전까지만 작성·제출할 수 있으며 제출 후에는
        수정할 수 없습니다.
      </p>
      <p v-if="view?.reason || enrollment.completion" class="muted">
        {{
          enrollment.completion && response?.status !== 'submitted'
            ? '인증Set 수료로 주관식 작성이 종료되었습니다.'
            : view?.reason
        }}
      </p>
      <p v-if="error || saveError" role="alert" class="error-message">{{ error || saveError }}</p>
      <div class="inline-actions">
        <button
          v-if="!response && view?.canWrite"
          class="button primary"
          :disabled="busy"
          @click="start"
        >
          주관식 답변 시작</button
        ><button
          v-if="error || saveError || conflict"
          class="button secondary"
          :disabled="busy"
          @click="reload"
        >
          서버 답변 다시 확인
        </button>
      </div>
      <template v-if="response">
        <p role="status">
          {{ answered }} / {{ questions.length }}문항 작성 ·
          {{
            readonly
              ? '읽기 전용'
              : status === 'saving'
                ? '저장 중'
                : status === 'saved'
                  ? '저장됨'
                  : status === 'error'
                    ? '저장 실패'
                    : '저장 대기'
          }}
        </p>
        <template v-if="review || readonly">
          <h2>
            {{
              response.status === 'submitted'
                ? '제출한 답변'
                : readonly
                  ? '보존된 답변'
                  : '제출 전 답변 확인'
            }}
          </h2>
          <section v-for="(q, i) in questions" :key="q.id" class="subjective-answer">
            <h3>{{ i + 1 }}번 문제</h3>
            <p class="subjective-text">{{ q.prompt }}</p>
            <h4>답변</h4>
            <p class="subjective-text">{{ draft.answers[q.id] || '작성하지 않은 답변입니다.' }}</p>
          </section>
        </template>
        <template v-else>
          <CompactTabs
            v-model="selected"
            :items="items"
            label="주관식 답변 문항"
            panel-id="subjective-answer-panel"
          />
          <section v-if="current" id="subjective-answer-panel" class="subjective-answer">
            <h2>{{ questions.indexOf(current) + 1 }}번 문제</h2>
            <p class="subjective-text">{{ current.prompt }}</p>
            <label class="field"
              ><span>주관식 답변</span
              ><textarea
                ref="input"
                v-model="draft.answers[current.id]"
                maxlength="20000"
                rows="10"
                :disabled="busy || conflict || !!pendingSubmit"
                @input="changed"
              />
            </label>
            <p class="muted">
              {{ (draft.answers[current.id] || '').length.toLocaleString() }} / 20,000자
            </p>
          </section>
        </template>
        <div v-if="!readonly" class="actions">
          <button
            v-if="!review"
            class="button secondary"
            :disabled="busy || conflict"
            @click="save"
          >
            답변 저장</button
          ><button
            v-if="review"
            class="button secondary"
            :disabled="busy || !!pendingSubmit"
            @click="review = false"
          >
            답변 수정</button
          ><button
            class="button primary"
            :disabled="busy || conflict"
            @click="review ? submit() : inspect()"
          >
            {{ review ? '답변 최종 제출' : '제출 전 답변 확인' }}
          </button>
        </div>
      </template>
    </template>
    <p v-else role="alert">본인에게 배정된 인증Set을 확인해 주세요.</p>
  </main>
</template>
<style scoped>
.subjective-page {
  max-width: 1100px;
  min-width: 0;
}
.subjective-answer {
  padding: 20px 0;
  border-bottom: 1px solid var(--hairline, #e3e8ee);
  min-width: 0;
}
.subjective-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
textarea {
  width: 100%;
  resize: vertical;
  box-sizing: border-box;
}
.inline-actions,
.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 16px 0;
}
</style>
