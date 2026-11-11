<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import {
  mentorStatusLabels,
  releaseVersionLabel,
  type MentorPracticalView,
  type MentorPracticalList,
  type MentorPreview,
} from '@eks/contracts';
import { api, mutate, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
import AppDialog from '../components/AppDialog.vue';
const store = useDemo(),
  route = useRoute();
const management = computed(() => route.path.startsWith('/admin/'));
const id = computed(() => String(route.params.id || ''));
const list = ref<MentorPracticalList>(),
  view = ref<MentorPracticalView>();
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  conflict = ref(false),
  search = ref('');
const mentorId = ref(''),
  reason = ref('');
const answers = ref<Record<string, string>>({}),
  scores = ref<Record<string, number | string>>({}),
  feedback = ref<Record<string, string>>({}),
  comment = ref('');
const baseline = ref(''),
  assignmentBaseline = ref('');
const current = computed(() => view.value?.attempts.at(-1));
const editAnswers = computed(() => !!view.value?.canWrite && current.value?.status === 'draft');
const editGrades = computed(() => !!view.value?.canGrade && current.value?.status === 'submitted');
const content = () =>
  JSON.stringify({
    answers: answers.value,
    scores: scores.value,
    feedback: feedback.value,
    comment: comment.value,
  });
const dirty = computed(
  () =>
    !!view.value &&
    (content() !== baseline.value ||
      JSON.stringify([mentorId.value, reason.value]) !== assignmentBaseline.value),
);
const reviewButton = ref<HTMLButtonElement>();
async function restoreReviewFocus() {
  await nextTick();
  reviewButton.value?.focus();
}
const review = ref<MentorPreview>(),
  reviewOpen = ref(false);
const rows = computed(
  () =>
    list.value?.rows.filter((r) =>
      `${r.learnerName} ${r.courseTitle} ${r.progress?.mentorName || ''}`.includes(search.value),
    ) || [],
);
const mentors = computed(
  () =>
    list.value?.mentors.filter(
      (m) =>
        m.id !== store.data.assignments.find((a) => a.id === view.value?.assignmentId)?.learnerId,
    ) || [],
);
const link = (enrollmentId = '') =>
  management.value
    ? store.managementLink(`/admin/mentor-practicals${enrollmentId ? '/' + enrollmentId : ''}`)
    : `/mentoring${enrollmentId ? '/' + enrollmentId : ''}`;
let sequence = 0;
async function load(keepBusy = false) {
  const seq = ++sequence,
    enrollmentId = id.value;
  busy.value = true;
  error.value = '';
  try {
    const queue =
      management.value || !enrollmentId
        ? await api<MentorPracticalList>(
            `/mentor-practicals${management.value ? '?' + new URLSearchParams({ management: 'true', lv1OrganizationId: store.managementLv1 }) : ''}`,
          )
        : undefined;
    const detail = enrollmentId
      ? await api<MentorPracticalView>(`/mentor-practicals/${encodeURIComponent(enrollmentId)}`)
      : undefined;
    if (seq !== sequence) return;
    list.value = queue;
    view.value = detail;
    reviewOpen.value = false;
    review.value = undefined;
    conflict.value = false;
    const t = detail?.attempts.at(-1);
    answers.value = { ...t?.answers };
    scores.value = { ...t?.grading?.scores };
    feedback.value = { ...t?.grading?.feedback };
    comment.value = t?.grading?.comment || '';
    mentorId.value = detail?.assignment?.mentorId || '';
    reason.value = '';
    baseline.value = content();
    assignmentBaseline.value = JSON.stringify([mentorId.value, reason.value]);
  } catch (e) {
    if (seq === sequence) error.value = (e as Error).message;
  } finally {
    if (seq === sequence && !keepBusy) busy.value = false;
  }
}
async function canLeave() {
  return (
    !busy.value &&
    (!dirty.value ||
      (await confirmAction(
        '저장하지 않은 입력이 있습니다. 입력을 버리고 이동할까요?',
        '입력 확인',
      )))
  );
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value || busy.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => {
  sequence++;
  window.removeEventListener('beforeunload', beforeUnload);
});
watch(
  () => `${store.actorId}:${store.managementLv1}:${route.path}`,
  () => {
    view.value = undefined;
    list.value = undefined;
    notice.value = '';
    void load();
  },
  { immediate: true },
);
async function perform(action: string, body: unknown, message: string) {
  if (busy.value || conflict.value) return false;
  busy.value = true;
  error.value = '';
  notice.value = '';
  const actorId = store.actorId,
    enrollmentId = id.value;
  const assignmentDraft =
    action !== 'assign' &&
    JSON.stringify([mentorId.value, reason.value]) !== assignmentBaseline.value
      ? {
          mentorId: mentorId.value,
          reason: reason.value,
          revision: view.value?.assignment?.revision,
          baseline: assignmentBaseline.value,
        }
      : undefined;
  try {
    await mutate(
      `/mentor-practicals/${encodeURIComponent(id.value)}/${action}`,
      body,
      'POST',
      store.actorId,
    );
    if (actorId !== store.actorId || enrollmentId !== id.value) return false;
    await load(true);
    if (assignmentDraft && view.value?.assignment?.revision === assignmentDraft.revision) {
      mentorId.value = assignmentDraft.mentorId;
      reason.value = assignmentDraft.reason;
      assignmentBaseline.value = assignmentDraft.baseline;
    }
    await store.refresh();
    notice.value = message;
    return !error.value;
  } catch (e) {
    error.value = (e as Error).message;
    conflict.value = e instanceof ApiError && e.code === 'REVISION_CONFLICT';
    return false;
  } finally {
    busy.value = false;
  }
}
async function saveAnswers() {
  return perform(
    'save',
    { attemptId: current.value?.id, revision: current.value?.revision, answers: answers.value },
    '수행 답변을 저장했습니다.',
  );
}
function gradeBody() {
  return {
    attemptId: current.value?.id,
    revision: current.value?.revision,
    scores: Object.fromEntries(
      Object.entries(scores.value)
        .filter(([, v]) => v !== '')
        .map(([id, v]) => [id, Number(v)]),
    ),
    feedback: feedback.value,
    comment: comment.value,
  };
}
async function saveGrades() {
  return perform(
    'grade',
    gradeBody(),
    '임시 채점을 저장했습니다. 확정 전에는 학습자에게 공개되지 않습니다.',
  );
}
async function submit() {
  if (!(await saveAnswers())) return;
  if (
    await confirmAction(
      '제출 후 답변을 수정할 수 없습니다. 담당 FT 멘토에게 제출할까요?',
      '실기 답변 제출',
    )
  )
    await perform(
      'submit',
      { attemptId: current.value?.id, revision: current.value?.revision },
      '실기 답변을 제출했습니다.',
    );
}
async function preview() {
  if (!(await saveGrades())) return;
  busy.value = true;
  error.value = '';
  try {
    review.value = await api<MentorPreview>(
      `/mentor-practicals/${encodeURIComponent(id.value)}/preview`,
      { method: 'POST', body: '{}' },
    );
    reviewOpen.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function finalize() {
  if (review.value)
    await perform(
      'finalize',
      {
        attemptId: current.value?.id,
        revision: current.value?.revision,
        reviewToken: review.value.token,
      },
      '실기 평가를 확정했습니다.',
    );
}
async function assign() {
  if (
    content() !== baseline.value &&
    !(await confirmAction(
      '멘토를 변경하면 저장하지 않은 채점 입력이 사라집니다. 변경할까요?',
      '멘토 변경 확인',
    ))
  )
    return;
  await perform(
    'assign',
    {
      mentorId: mentorId.value,
      revision: view.value?.assignment?.revision || 0,
      reason: reason.value,
    },
    '담당 FT 멘토를 지정했습니다.',
  );
}
async function reload() {
  if (
    !dirty.value ||
    (await confirmAction(
      '현재 입력을 버리고 서버에 저장된 내용을 다시 불러올까요?',
      '최신 내용 불러오기',
    ))
  )
    await load();
}
const numberDate = (value: string) =>
  new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
</script>
<template>
  <div class="container page mentor-page" :aria-busy="busy">
    <RouterLink v-if="id && (management || !view?.owner)" :to="link()" class="back-link"
      >실기 목록으로</RouterLink
    >
    <RouterLink
      v-else-if="view?.owner"
      :to="`/qualifications/${view.assignmentId}?stage=assessment&course=${view.course.id}`"
      class="back-link"
      >인증Set 평가로</RouterLink
    >
    <header class="page-heading">
      <div>
        <h1>{{ management ? '실기 멘토 배정' : '실기(주관식) 평가' }}</h1>
        <p class="muted">
          {{
            management
              ? '개인 수강별 담당 FT 멘토를 지정하고 평가 진행을 확인합니다.'
              : '문항별 수행 답변과 배점을 기준으로 평가합니다.'
          }}
        </p>
      </div>
    </header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div v-if="conflict" class="panel">
      <p>입력은 화면에 유지했습니다. 다른 창에서 변경된 내용을 확인한 후 다시 작성해 주세요.</p>
      <button class="button secondary" :disabled="busy" @click="reload">
        최신 내용 다시 불러오기
      </button>
    </div>
    <p v-if="busy && !view && !list" role="status">불러오는 중입니다.</p>
    <template v-if="!id && list">
      <p v-if="!list.enabled" class="muted">
        FT 멘토 실기 기능의 데이터 이관이 필요합니다. 시스템 운영자에게 문의해 주세요.
      </p>
      <label class="field"
        >실기 검색<input v-model="search" type="search" placeholder="학습자, 인증Set, 멘토 이름"
      /></label>
      <p>{{ rows.length }}건 · 배정된 실기 평가의 진행 상태입니다.</p>
      <div class="mentor-list">
        <article v-for="row in rows" :key="row.enrollmentId" class="panel">
          <h2>
            <RouterLink :to="link(row.enrollmentId)"
              >{{ row.courseTitle }} · {{ row.learnerName }}</RouterLink
            >
          </h2>
          <p>
            v{{ row.courseVersion }} · 담당 {{ row.progress?.mentorName || '미지정' }} ·
            {{ row.progress ? mentorStatusLabels[row.progress.status] : '수행 전' }}
          </p>
          <p v-if="row.progress?.earned !== undefined">
            {{ row.progress.earned }} / {{ row.progress.total }}점<span v-if="row.completed">
              · 인증Set 수료</span
            >
          </p>
        </article>
        <p v-if="!rows.length" class="muted">
          {{
            management
              ? '실기(주관식)가 포함된 개인 수강이 없습니다. 인증Set 설정과 개인 배정을 확인해 주세요.'
              : '현재 담당하는 실기 평가가 없습니다.'
          }}
        </p>
      </div>
    </template>
    <template v-if="view">
      <section class="panel">
        <h2>{{ view.course.title }} · {{ view.learnerName }}</h2>
        <p>
          {{ releaseVersionLabel(view.course) }} · 담당 FT 멘토 {{ view.mentorName || '미지정' }} ·
          {{ view.course.mentorPractical?.questions.length }}문항 · 합격 기준
          {{ view.course.mentorPractical?.passScore }}%
        </p>
        <p>
          문항별 점수 합계 ÷ 총 배점 × 100이 합격 기준 이상이면 실기 합격입니다. 다른 필수 평가도
          통과해야 인증Set이 수료됩니다.
        </p>
        <p v-if="view.blockers.length" role="status">{{ view.blockers.join(' ') }}</p>
        <p v-if="view.completed"><strong>인증Set 수료 완료</strong></p>
      </section>
      <section
        v-if="view.manager && !view.attempts.some((t) => t.result === 'passed')"
        class="panel"
      >
        <h2>담당 FT 멘토 지정</h2>
        <form @submit.prevent="assign">
          <label class="field"
            >FT 멘토<select
              aria-label="FT 멘토"
              v-model="mentorId"
              required
              :disabled="busy || conflict"
            >
              <option value="" disabled>담당 멘토 선택</option>
              <option v-for="m in mentors" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select></label
          >
          <label v-if="view.assignment" class="field"
            >멘토 변경 사유<textarea
              v-model="reason"
              required
              maxlength="2000"
              rows="2"
              :disabled="busy || conflict"
            />
          </label>
          <p class="muted">
            같은 팀의 활성 FT 멘토를 지정합니다. 멘토 변경 시 임시 채점은 이력으로 보관되고 새
            멘토가 다시 채점합니다.
          </p>
          <p v-if="!mentors.length" class="muted">
            팀 사용자 관리에서 FT 멘토 역할을 먼저 지정해 주세요.
          </p>
          <button class="button primary" :disabled="busy || conflict || !mentorId">
            {{ view.assignment ? '멘토 변경' : '멘토 지정' }}
          </button>
        </form>
      </section>
      <section
        v-if="view.owner && view.canWrite && (!current || current.result === 'failed')"
        class="panel"
      >
        <h2>{{ current ? '실기 재응시' : '실기 수행 답변' }}</h2>
        <p>모든 실기 문항을 수행한 내용을 작성해 멘토에게 제출해 주세요.</p>
        <button
          class="button primary"
          :disabled="busy || conflict"
          @click="perform('start', {}, '실기 답변 작성을 시작했습니다.')"
        >
          {{ current ? '실기 재응시 시작' : '실기 답변 작성 시작' }}
        </button>
      </section>
      <section v-if="current && current.status !== 'graded'" class="panel">
        <h2>
          {{ current.round }}차 실기 ·
          {{ current.status === 'draft' ? '작성 중' : '제출 완료 · 채점 대기' }}
        </h2>
        <p v-if="current.status === 'draft' && !view.owner" class="muted">
          학습자가 제출한 후 수행 답변을 확인할 수 있습니다.
        </p>
        <p v-if="current.status === 'submitted' && !editGrades" class="muted">
          담당 멘토가 평가를 확정하면 점수와 피드백이 공개됩니다.
        </p>
        <form @submit.prevent="editAnswers ? submit() : preview()">
          <fieldset v-for="(q, i) in current.questions" :key="q.id" :disabled="busy || conflict">
            <legend>실기 문항 {{ i + 1 }} · {{ q.points }}점</legend>
            <p class="preserve">{{ q.prompt }}</p>
            <label v-if="editAnswers" class="field"
              >수행 내용·답변<textarea v-model="answers[q.id]" rows="5" maxlength="20000" />
            </label>
            <p v-else-if="view.owner || current.status !== 'draft'" class="preserve">
              <strong>수행 답변</strong><br />{{ current.answers[q.id] || '미작성' }}
            </p>
            <template v-if="editGrades">
              <label class="field"
                >문항 {{ i + 1 }} 점수 (0~{{ q.points }}점)<input
                  v-model="scores[q.id]"
                  type="number"
                  min="0"
                  :max="q.points"
                  step="0.01"
              /></label>
              <label class="field"
                >문항 {{ i + 1 }} 피드백<textarea
                  v-model="feedback[q.id]"
                  rows="2"
                  maxlength="2000"
                />
              </label>
            </template>
          </fieldset>
          <label v-if="editGrades" class="field"
            >종합 평가 의견<textarea
              v-model="comment"
              rows="3"
              maxlength="4000"
              :disabled="busy || conflict"
            />
          </label>
          <div v-if="editAnswers || editGrades" class="mentor-actions">
            <button
              class="button secondary"
              type="button"
              :disabled="busy || conflict"
              @click="editAnswers ? saveAnswers() : saveGrades()"
            >
              {{ editAnswers ? '답변 저장' : '임시 채점 저장' }}
            </button>
            <button ref="reviewButton" class="button primary" :disabled="busy || conflict">
              {{ editAnswers ? '답변 제출' : '평가 결과 검토' }}
            </button>
            <span class="muted" role="status">{{
              dirty ? '저장하지 않은 입력이 있습니다.' : '저장된 상태입니다.'
            }}</span>
          </div>
        </form>
      </section>
      <section
        v-for="t in view.attempts
          .filter((t) => t.status === 'graded')
          .slice()
          .reverse()"
        :key="t.id"
        class="panel"
      >
        <h2>{{ t.round }}차 평가 결과 · {{ t.result === 'passed' ? '합격' : '불합격' }}</h2>
        <p>
          <strong>{{ t.earned }} / {{ t.total }}점</strong> · 합격 기준 {{ t.passScore }}% · FT 멘토
          {{ store.username(t.gradedBy) }} · {{ numberDate(t.gradedAt!) }}
        </p>
        <details>
          <summary>문항별 답변·점수·피드백</summary>
          <article v-for="(q, i) in t.questions" :key="q.id" class="mentor-result">
            <h3>실기 문항 {{ i + 1 }} · {{ t.grading?.scores[q.id] }} / {{ q.points }}점</h3>
            <p class="preserve">{{ q.prompt }}</p>
            <p class="preserve">수행 답변: {{ t.answers[q.id] }}</p>
            <p v-if="t.grading?.feedback[q.id]" class="preserve">
              피드백: {{ t.grading.feedback[q.id] }}
            </p>
          </article>
        </details>
        <p v-if="t.grading?.comment" class="preserve">종합 의견: {{ t.grading.comment }}</p>
      </section>
      <details v-if="view.assignment?.history.length" class="panel">
        <summary>멘토 변경 이력</summary>
        <p v-for="(h, i) in view.assignment.history" :key="i">
          {{ numberDate(h.changedAt) }} · 이전 멘토 {{ store.username(h.mentorId) }} ·
          {{ h.reason }}
        </p>
      </details>
    </template>
    <button v-if="error && !conflict" class="button secondary" :disabled="busy" @click="reload">
      다시 불러오기
    </button>
    <AppDialog
      v-model:open="reviewOpen"
      title="실기 평가 결과 검토"
      :busy="busy"
      @closed="restoreReviewFocus"
    >
      <template v-if="review"
        ><p role="status">{{ review.blockers.join(' ') }}</p>
        <p>
          <strong
            >{{ review.earned }} / {{ review.total }}점 ·
            {{ review.result === 'passed' ? '합격' : '불합격' }}</strong
          >
          (기준 {{ review.passScore }}%)
        </p>
        <p>
          {{
            review.wouldComplete
              ? '인증Set 수료가 함께 처리됩니다.'
              : '이 결과만으로 인증Set이 수료되지는 않습니다.'
          }}
        </p>
        <p v-if="review.wouldCertify">자격 인증 발급도 함께 처리됩니다.</p>
        <p>확정한 점수와 답변은 수정할 수 없습니다. 결과와 피드백이 학습자에게 공개됩니다.</p>
        <p v-if="error" role="alert">{{ error }}</p></template
      >
      <template #footer
        ><button class="button secondary" :disabled="busy" @click="reviewOpen = false">
          채점으로 돌아가기</button
        ><button
          class="button primary"
          :disabled="busy || conflict || !review || !!review.blockers.length"
          @click="finalize"
        >
          평가 확정
        </button></template
      >
    </AppDialog>
  </div>
</template>
<style scoped>
.mentor-page {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.mentor-list {
  display: grid;
  gap: 16px;
}
.mentor-page .panel {
  min-width: 0;
}
.mentor-page h2 {
  font-size: 20px;
}
.mentor-page p {
  overflow-wrap: anywhere;
}
.mentor-page form {
  display: grid;
  gap: 16px;
}
.mentor-page fieldset {
  min-width: 0;
  border: 1px solid var(--control-border);
  border-radius: 8px;
  padding: 20px;
  display: grid;
  gap: 12px;
}
.mentor-page input[type='number'] {
  max-width: 180px;
}
.mentor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.preserve {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mentor-result {
  border-top: 1px solid var(--control-border);
  padding-top: 16px;
  margin-top: 16px;
}
summary {
  cursor: pointer;
  padding: 8px 0;
}
.error {
  color: var(--danger, #b42318);
}
@media (max-width: 600px) {
  .mentor-page fieldset {
    padding: 12px;
  }
  .mentor-actions .button {
    width: 100%;
  }
}
</style>
