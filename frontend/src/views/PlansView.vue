<script setup lang="ts">
import RequestPlanning from '../components/RequestPlanning.vue';
import PageHeading from '../components/PageHeading.vue';
import PropertyList from '../components/PropertyList.vue';
import CollapsibleSection from '../components/CollapsibleSection.vue';
import ActionBar from '../components/ActionBar.vue';
import SaveFeedback from '../components/SaveFeedback.vue';
import { confirmAction } from '../composables/useConfirmation';
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { planErrors, kstDate, type PersonalPlan, type PlanStartInput } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import { useSavedDraft } from '../composables/useSavedDraft';
import LearnerNav from '../components/LearnerNav.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { ApiError } from '../api';
import { useProcessContext } from '../composables/useProcessContext';
import '../plan-review.css';
const store = useDemo(),
  route = useRoute(),
  router = useRouter(),
  busy = ref(false),
  error = ref(''),
  step = ref(1),
  fieldErrors = ref<Record<string, string>>({}),
  reason = ref('');
const initializing = ref(false),
  deleting = ref<PersonalPlan | null>(null),
  deleteDialog = ref<HTMLDialogElement | null>(null),
  activePlanId = ref('');
let loadGeneration = 0;
const plans = computed(() => store.data.plans.filter((p) => p.learnerId === store.actorId));
const requests = computed(() =>
  store.data.planningRequests
    .filter((r) => r.learnerId === store.actorId)
    .slice()
    .reverse(),
);
const requestId = computed(() =>
  typeof route.query.request === 'string' ? route.query.request : requests.value[0]?.id,
);
const request = computed(() => requests.value.find((r) => r.id === requestId.value));
const current = computed(() => plans.value.find((p) => p.id === route.params.id));
const reviewQualification = computed(() =>
  current.value
    ? store.qualification(current.value.qualificationId, current.value.qualificationMetadata)
    : undefined,
);
const planRequest = computed(() => requests.value.find((r) => r.id === current.value?.requestId));
const reviewOpen = ref<Record<string, boolean>>({});
const reviewRequestOpen = ref(false);
watch(
  () => `${store.actorId}:${route.params.id || ''}`,
  () => {
    reviewOpen.value = {};
    reviewRequestOpen.value = false;
  },
);
useProcessContext(() =>
  current.value?.status === 'completed'
    ? 'plan-completed'
    : route.params.id
      ? `plan-${step.value}`
      : 'plan-1',
);
const requestView = computed(() =>
  store.data.planningOptions.find((v) => v.requestId === requestId.value),
);
const eligible = computed(() =>
  store.data.qualifications.filter((q) =>
    requestView.value?.candidates.some((c) => c.qualificationId === q.id && c.canStart),
  ),
);
const policyErrors = computed(
  () => store.data.planEligibility.find((p) => p.planId === current.value?.id)?.reasons || [],
);
const selection = ref('');
const requestBusy = ref(false);
const pendingStart = ref<PlanStartInput | null>(null);
const startConflict = ref(false);
watch(
  () => `${store.actorId}:${requestId.value || ''}`,
  () => {
    selection.value =
      typeof route.query.qualification === 'string' ? route.query.qualification : '';
    pendingStart.value = null;
    startConflict.value = false;
    error.value = '';
  },
);
watch(
  () => route.query.qualification,
  (value) => {
    if (typeof value === 'string') selection.value = value;
  },
  { immediate: true },
);
type Fields = Pick<PersonalPlan, 'targetOn' | 'schedules'>;
const draft = useSavedDraft<Fields>((value, revision) =>
  store.command(
    `/plans/${activePlanId.value}`,
    {
      ...value,
      revision,
      ...(current.value?.status === 'completed' ? { reason: reason.value } : {}),
    },
    'PUT',
  ),
);
const form = draft.value;
watch(
  () => form.value?.schedules.map((s) => s.courseId),
  (ids) => {
    for (const id of ids || []) reviewOpen.value[id] ??= true;
  },
  { immediate: true },
);
function reviewDate(value?: string) {
  return value ? value.replaceAll('-', '.') : '미정';
}
async function editReviewField(target: 2 | 3, key: string) {
  if (busy.value || initializing.value || draft.terminal.value) return;
  const planId = current.value?.id;
  await moveTo(target);
  await nextTick();
  if (step.value !== target || current.value?.id !== planId) return;
  const input = [...document.querySelectorAll<HTMLElement>('[data-plan-field]')].find(
    (element) => element.dataset.planField === key,
  );
  input?.focus({ preventScroll: true });
  input?.scrollIntoView({ block: 'center' });
}
async function load() {
  const generation = ++loadGeneration;
  draft.clear();
  activePlanId.value = current.value?.id || '';
  initializing.value = false;
  error.value = '';
  fieldErrors.value = {};
  reason.value = '';
  if (current.value?.status === 'draft' && !current.value.scheduleDefaultsAppliedAt) {
    initializing.value = true;
    try {
      await store.command(`/plans/${current.value.id}/schedule-defaults`, {
        revision: current.value.revision,
      });
    } catch (err) {
      if (generation === loadGeneration) handleError(err);
      return;
    } finally {
      if (generation === loadGeneration) initializing.value = false;
    }
  }
  if (generation !== loadGeneration) return;
  if (current.value && !draft.terminal.value)
    draft.load(
      { targetOn: current.value.targetOn, schedules: current.value.schedules },
      current.value.revision,
    );
  step.value = current.value?.status === 'completed' ? 4 : 2;
}
watch(() => `${store.actorId}:${route.params.id || ''}`, load, { immediate: true });
watch(current, (value, previous) => {
  if (!value && previous?.id === route.params.id && activePlanId.value === previous.id)
    draft.stop('삭제된 계획입니다. 내 계획에서 다시 작성해 주세요.');
});
function handleError(err: unknown) {
  if (err instanceof ApiError && err.code === 'PLAN_DELETED') draft.stop(err.message);
  else error.value = (err as Error).message;
  if (step.value === 4)
    void nextTick(() => {
      const message = document.querySelector<HTMLElement>('.plan-review-submit-error');
      message?.focus({ preventScroll: true });
      message?.scrollIntoView({ block: 'center' });
    });
}
async function askDelete(plan: PersonalPlan) {
  deleting.value = plan;
  error.value = '';
  await nextTick();
  deleteDialog.value?.showModal();
}
async function deletePlan() {
  const plan = deleting.value;
  if (!plan || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await store.command(`/plans/${plan.id}`, { revision: plan.revision }, 'DELETE');
    deleteDialog.value?.close();
    deleting.value = null;
    store.notify('미확정 계획을 삭제했습니다. 자격을 다시 선택해 작성할 수 있습니다.');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
function changed() {
  if (current.value?.status === 'draft') draft.changed();
}
function clearField(key: string) {
  if (fieldErrors.value[key]) {
    const next = { ...fieldErrors.value };
    delete next[key];
    fieldErrors.value = next;
  }
  error.value = '';
  changed();
}
function scheduleErrors(): Record<string, string> {
  const fields = form.value;
  const result: Record<string, string> = {};
  if (!fields?.targetOn) result.targetOn = '목표 인증일을 입력해 주세요.';
  fields?.schedules.forEach((s) => {
    const title = store.course(s.courseId).title;
    if (!s.learningStart)
      result[`${s.courseId}.learningStart`] = `${title}: 학습 시작 예정일을 입력해 주세요.`;
    if (!s.learningEnd)
      result[`${s.courseId}.learningEnd`] = `${title}: 학습 완료 예정일을 입력해 주세요.`;
    if (!s.assessmentOn)
      result[`${s.courseId}.assessmentOn`] = `${title}: 평가 예정일을 입력해 주세요.`;
    if (s.learningStart && s.learningEnd && s.learningStart > s.learningEnd)
      result[`${s.courseId}.learningEnd`] = `${title}: 학습 완료 예정일은 시작일 이후여야 합니다.`;
    if (s.learningEnd && s.assessmentOn && s.learningEnd > s.assessmentOn)
      result[`${s.courseId}.assessmentOn`] =
        `${title}: 평가 예정일은 학습 완료 예정일 이후여야 합니다.`;
    if (fields.targetOn && s.assessmentOn && s.assessmentOn > fields.targetOn)
      result.targetOn = '목표 인증일은 모든 인증Set의 평가 예정일 이후여야 합니다.';
  });
  return result;
}
async function focusFirstError() {
  await nextTick();
  const key = Object.keys(fieldErrors.value)[0];
  const input = [...document.querySelectorAll<HTMLElement>('[data-plan-field]')].find(
    (value) => value.dataset.planField === key,
  );
  input?.focus();
  input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
async function moveTo(target: number) {
  if (busy.value || initializing.value || draft.terminal.value || target === step.value) return;
  if (target < step.value) {
    fieldErrors.value = {};
    error.value = '';
    step.value = target;
    return;
  }
  if (!current.value || !form.value) return;
  if (
    target > 1 &&
    !store.data.qualifications.some((q) => q.id === current.value!.qualificationId)
  ) {
    error.value = '선택한 자격을 확인할 수 없습니다. 계획을 다시 불러와 주세요.';
    return;
  }
  const schedules = target >= 3 ? scheduleErrors() : {};
  if (Object.keys(schedules).length) {
    step.value = 2;
    fieldErrors.value = schedules;
    error.value = '일정 단계의 필수 입력과 날짜 순서를 확인해 주세요.';
    await focusFirstError();
    return;
  }
  try {
    await draft.flush();
    if (draft.error.value || draft.conflict.value)
      throw new Error(draft.error.value || '계획 저장 충돌이 발생했습니다.');
    error.value = '';
    fieldErrors.value = {};
    step.value = target;
  } catch (err) {
    error.value = `저장되지 않아 다음 단계로 이동할 수 없습니다. ${(err as Error).message}`;
  }
}
async function create() {
  if (busy.value || requestBusy.value || startConflict.value) return;
  const actor = store.actorId,
    id = requestId.value;
  busy.value = true;
  error.value = '';
  try {
    if (!pendingStart.value) {
      if (!request.value || !eligible.value.some((q) => q.id === selection.value))
        throw new Error('취득할 자격을 선택해 주세요.');
      pendingStart.value = {
        requestId: request.value.id,
        requestRevision: request.value.revision,
        qualificationId: selection.value,
      };
    }
    // Keep this payload (and the store's idempotency key) after an uncertain response.
    const result = await store.command('/plans', pendingStart.value);
    if (actor !== store.actorId || id !== requestId.value) return;
    pendingStart.value = null;
    busy.value = false;
    await router.push({ path: `/plans/${result.id}`, query: { request: id } });
  } catch (err) {
    if (actor !== store.actorId || id !== requestId.value) return;
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      pendingStart.value = null;
      startConflict.value = true;
    }
    handleError(err);
  } finally {
    busy.value = false;
  }
}
async function reloadRequest() {
  if (busy.value || requestBusy.value) return;
  const actor = store.actorId,
    id = requestId.value;
  busy.value = true;
  try {
    await store.refresh();
    if (actor !== store.actorId || id !== requestId.value) return;
    startConflict.value = false;
    error.value = '';
  } catch (err) {
    if (actor === store.actorId && id === requestId.value) handleError(err);
  } finally {
    busy.value = false;
  }
}
async function complete() {
  busy.value = true;
  error.value = '';
  try {
    const errors = planErrors(form.value!);
    if (errors.length) {
      const schedules = scheduleErrors();
      step.value = 2;
      fieldErrors.value = schedules;
      await focusFirstError();
      throw new Error(errors.join('\n'));
    }
    await draft.flush();
    const result = await store.command(`/plans/${current.value!.id}/complete`, {
      revision: draft.revision.value,
    });
    store.notify('계획을 완료했습니다. 학습을 시작할 수 있습니다.');
    busy.value = false;
    await router.push(`/qualifications/${result.assignmentId}`);
  } catch (err) {
    handleError(err);
  } finally {
    busy.value = false;
  }
}
async function saveRevision() {
  busy.value = true;
  error.value = '';
  try {
    if (!reason.value.trim()) throw new Error('계획 변경 사유를 입력해 주세요.');
    await draft.flush();
    store.notify('계획 일정·목표를 수정했습니다.');
    reason.value = '';
  } catch (err) {
    handleError(err);
  } finally {
    busy.value = false;
  }
}
async function reload() {
  if (!(await confirmAction('현재 입력을 버리고 서버의 계획을 다시 불러올까요?', '다시 불러오기')))
    return;
  await store.refresh();
  load();
}
async function leave() {
  if (busy.value || requestBusy.value || initializing.value) return false;
  if (current.value?.status === 'completed' && draft.dirty.value)
    return await confirmAction('저장하지 않은 계획 변경을 버리고 이동할까요?', '변경 버리고 이동');
  return draft.canLeave();
}
function protectStart(event: BeforeUnloadEvent) {
  if (busy.value || requestBusy.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', protectStart));
onBeforeUnmount(() => window.removeEventListener('beforeunload', protectStart));
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <div class="container page plans-page" :class="{ 'is-plan-review': current && step === 4 }">
    <LearnerNav />
    <div v-if="current && policyErrors.length" class="error-message" role="alert">
      {{ policyErrors.join(' · ') }}<RouterLink to="/plans">내 계획에서 현재 요청 확인</RouterLink>
    </div>
    <PageHeading class="page-heading">
      <h1>{{ current ? '개인 인증 계획' : '내 계획' }}</h1>
      <span>{{ store.actor.name }}</span>
    </PageHeading>
    <p
      v-if="error && !(current && form && step === 4 && !draft.terminal.value)"
      class="error-message preserve-lines"
      role="alert"
    >
      {{ error }}
    </p>
    <section v-if="draft.terminal.value" class="panel empty-state" role="alert">
      <h2>삭제된 계획입니다</h2>
      <p>{{ draft.terminal.value }}</p>
      <RouterLink to="/plans" class="button primary">내 계획으로 이동</RouterLink>
    </section>
    <section v-else-if="initializing" class="panel empty-state" role="status">
      기본 일정을 준비하고 있습니다.
    </section>
    <section v-else-if="current && !form" class="panel empty-state">
      <p>{{ error || '계획을 불러오지 못했습니다.' }}</p>
      <button class="button secondary" @click="load">다시 불러오기</button>
    </section>
    <template v-else-if="current && form">
      <RouterLink :to="{ path: '/plans', query: { request: requestId } }" class="back-link"
        >내 계획으로</RouterLink
      >
      <div v-if="step !== 4" class="panel plan-context">
        <h2>
          {{ store.qualification(current.qualificationId, current.qualificationMetadata).title }}
        </h2>
        <p class="muted">
          v{{ store.qualification(current.qualificationId, current.qualificationMetadata).version }}
          · 계획 작성 기한
          {{ requests.find((r) => r.id === current!.requestId)?.dueOn }}
        </p>
        <p>
          {{
            store.qualification(current.qualificationId, current.qualificationMetadata).description
          }}
        </p>
      </div>
      <nav class="plan-steps" aria-label="계획 작성 단계">
        <button
          v-for="(label, i) in ['자격 선택', '일정 수립', '학습 목표(선택)', '최종 확인']"
          :key="label"
          :class="{ active: step === i + 1 }"
          :aria-current="step === i + 1 ? 'step' : undefined"
          @click="moveTo(i + 1)"
        >
          {{ i + 1 }}. {{ label }}
        </button>
      </nav>
      <section v-if="step === 1" class="panel editor-panel">
        <h2>선택한 자격</h2>
        <p>
          {{ store.qualification(current.qualificationId, current.qualificationMetadata).title }}
        </p>
        <p class="muted">
          필수 {{ form.schedules.length }}인증Set · 이 계획의 자격과 기준 버전은 고정됩니다.
        </p>
        <button class="button primary" @click="moveTo(2)">일정 수립</button>
      </section>
      <section v-else-if="step === 2" class="panel editor-panel plan-schedule-panel">
        <h2>일정 수립</h2>
        <label class="field"
          ><span>목표 인증일</span
          ><input
            v-model="form.targetOn"
            data-plan-field="targetOn"
            type="date"
            :disabled="busy"
            :aria-invalid="!!fieldErrors.targetOn"
            :aria-describedby="fieldErrors.targetOn ? 'plan-target-error' : undefined"
            @input="clearField('targetOn')"
          /><small
            v-if="fieldErrors.targetOn"
            id="plan-target-error"
            class="field-error"
            role="alert"
            >{{ fieldErrors.targetOn }}</small
          ></label
        >
        <div class="schedule-table">
          <div class="schedule-header" aria-hidden="true">
            <span>인증Set</span><span>학습 시작 예정일</span><span>학습 완료 예정일</span
            ><span>평가 예정일</span>
          </div>
          <div v-for="(s, index) in form.schedules" :key="s.courseId" class="schedule-row">
            <h3 :title="store.course(s.courseId).title">
              <span class="schedule-number">{{ index + 1 }}</span
              ><span>{{ store.course(s.courseId).title }}</span>
            </h3>
            <label class="field"
              ><span>학습 시작 예정일</span
              ><input
                v-model="s.learningStart"
                :data-plan-field="`${s.courseId}.learningStart`"
                type="date"
                :disabled="busy"
                :aria-invalid="!!fieldErrors[`${s.courseId}.learningStart`]"
                :aria-describedby="
                  fieldErrors[`${s.courseId}.learningStart`]
                    ? `plan-${s.courseId}-learningStart-error`
                    : undefined
                "
                @input="clearField(`${s.courseId}.learningStart`)"
              /><small
                v-if="fieldErrors[`${s.courseId}.learningStart`]"
                :id="`plan-${s.courseId}-learningStart-error`"
                class="field-error"
                role="alert"
                >{{ fieldErrors[`${s.courseId}.learningStart`] }}</small
              ></label
            ><label class="field"
              ><span>학습 완료 예정일</span
              ><input
                v-model="s.learningEnd"
                :data-plan-field="`${s.courseId}.learningEnd`"
                type="date"
                :disabled="busy"
                :aria-invalid="!!fieldErrors[`${s.courseId}.learningEnd`]"
                :aria-describedby="
                  fieldErrors[`${s.courseId}.learningEnd`]
                    ? `plan-${s.courseId}-learningEnd-error`
                    : undefined
                "
                @input="clearField(`${s.courseId}.learningEnd`)"
              /><small
                v-if="fieldErrors[`${s.courseId}.learningEnd`]"
                :id="`plan-${s.courseId}-learningEnd-error`"
                class="field-error"
                role="alert"
                >{{ fieldErrors[`${s.courseId}.learningEnd`] }}</small
              ></label
            ><label class="field"
              ><span>평가 예정일</span
              ><input
                v-model="s.assessmentOn"
                :data-plan-field="`${s.courseId}.assessmentOn`"
                type="date"
                :disabled="busy"
                :aria-invalid="!!fieldErrors[`${s.courseId}.assessmentOn`]"
                :aria-describedby="
                  fieldErrors[`${s.courseId}.assessmentOn`]
                    ? `plan-${s.courseId}-assessmentOn-error`
                    : undefined
                "
                @input="clearField(`${s.courseId}.assessmentOn`)"
              /><small
                v-if="fieldErrors[`${s.courseId}.assessmentOn`]"
                :id="`plan-${s.courseId}-assessmentOn-error`"
                class="field-error"
                role="alert"
                >{{ fieldErrors[`${s.courseId}.assessmentOn`] }}</small
              ></label
            >
          </div>
        </div>
        <p class="muted schedule-help">
          최초 일정은 오늘부터 1주 후 시작, 시작일부터 3주 후 완료·4주 후 평가로 채웁니다. 수정한
          날짜는 자동으로 바뀌지 않습니다. 예정일은 진행을 막지 않습니다.
        </p>
        <div class="actions">
          <button class="button primary" @click="moveTo(4)">최종 확인</button>
          <button class="button secondary" @click="moveTo(3)">학습 목표 입력(선택)</button>
        </div>
      </section>
      <section v-else-if="step === 3" class="panel editor-panel">
        <h2>학습 목표(선택)</h2>
        <p class="muted">필요한 경우에만 작성하세요. 입력하지 않아도 계획을 완료할 수 있습니다.</p>
        <label v-for="s in form.schedules" :key="s.courseId" class="field"
          ><span>{{ store.course(s.courseId).title }} · 학습 목표</span
          ><textarea
            v-model="s.goal"
            :data-plan-field="`${s.courseId}.goal`"
            rows="3"
            maxlength="2000"
            :disabled="busy"
            placeholder="교육을 통해 혼자 수행할 수 있어야 하는 내용을 작성해 주세요."
            :aria-invalid="!!fieldErrors[`${s.courseId}.goal`]"
            :aria-describedby="
              fieldErrors[`${s.courseId}.goal`] ? `plan-${s.courseId}-goal-error` : undefined
            "
            @input="clearField(`${s.courseId}.goal`)"
          /><small
            v-if="fieldErrors[`${s.courseId}.goal`]"
            :id="`plan-${s.courseId}-goal-error`"
            class="field-error"
            role="alert"
            >{{ fieldErrors[`${s.courseId}.goal`] }}</small
          ></label
        ><button class="button primary" @click="moveTo(4)">최종 확인</button>
      </section>
      <div v-else class="plan-review">
        <header class="plan-review-heading">
          <h2>{{ current.status === 'completed' ? '계획 내용' : '계획 최종 확인' }}</h2>
          <p>
            {{
              current.status === 'completed'
                ? '확정한 일정을 확인하세요. 일정이나 선택 입력한 목표를 변경하면 사유를 남겨 저장합니다.'
                : '목표 인증일과 인증Set별 일정을 확인한 뒤 계획을 완료해 주세요.'
            }}
          </p>
        </header>
        <section class="plan-review-summary" aria-labelledby="plan-review-summary-title">
          <h2 id="plan-review-summary-title">계획 요약</h2>
          <PropertyList class="plan-review-facts">
            <div class="plan-review-qualification">
              <dt>취득할 자격</dt>
              <dd>
                <span class="plan-review-name">{{ reviewQualification?.title }}</span
                ><span class="plan-review-version">v{{ reviewQualification?.version }}</span>
              </dd>
            </div>
            <div class="plan-review-target">
              <dt>목표 인증일</dt>
              <dd>
                <strong>{{ reviewDate(form.targetOn) }}</strong
                ><button
                  type="button"
                  class="button secondary small"
                  :disabled="busy"
                  @click="editReviewField(2, 'targetOn')"
                >
                  목표 인증일 수정
                </button>
              </dd>
            </div>
            <div>
              <dt>필수 인증Set</dt>
              <dd>{{ form.schedules.length }}개</dd>
            </div>
            <div>
              <dt>계획 작성 기한</dt>
              <dd>{{ reviewDate(planRequest?.dueOn) }}</dd>
            </div>
            <div class="plan-review-description">
              <dt>자격 설명</dt>
              <dd>{{ reviewQualification?.description || '등록된 자격 설명이 없습니다.' }}</dd>
            </div>
          </PropertyList>
        </section>
        <div
          v-if="
            current.status === 'draft' &&
            current.policyRevision !== undefined &&
            store.data.requiredQualifications &&
            current.policyRevision !== store.data.requiredQualifications.revision
          "
          class="plan-review-warning"
          role="status"
        >
          <strong>조직 기준 정보가 변경되었습니다.</strong>
          <p>
            현재 소속과 적용 버전을 다시 확인해 주세요. 이번 요청의 필수 기준과 입력한 일정·목표는
            유지됩니다.
          </p>
        </div>
        <div class="plan-review-courses">
          <CollapsibleSection
            v-for="(s, index) in form.schedules"
            :key="s.courseId"
            v-model:open="reviewOpen[s.courseId]"
            :title="`${index + 1}. ${store.course(s.courseId)?.title || '인증Set 정보 확인 필요'}`"
            class="plan-review-course"
            :data-review-course="s.courseId"
          >
            <template #summary
              ><span class="plan-review-course-meta"
                ><span>v{{ store.course(s.courseId)?.version ?? '확인 필요' }}</span
                ><span>평가 예정일 {{ reviewDate(s.assessmentOn) }}</span></span
              ></template
            >
            <PropertyList class="plan-review-schedule">
              <div>
                <dt>학습 시작 예정일</dt>
                <dd>{{ reviewDate(s.learningStart) }}</dd>
              </div>
              <div>
                <dt>학습 완료 예정일</dt>
                <dd>{{ reviewDate(s.learningEnd) }}</dd>
              </div>
              <div>
                <dt>평가 예정일</dt>
                <dd>{{ reviewDate(s.assessmentOn) }}</dd>
              </div>
            </PropertyList>
            <div v-if="s.goal.trim()" class="plan-review-goal">
              <h3>학습 목표</h3>
              <p>{{ s.goal }}</p>
            </div>
            <div class="plan-review-edit-actions">
              <button
                type="button"
                class="button secondary"
                :disabled="busy"
                @click="editReviewField(2, `${s.courseId}.learningStart`)"
              >
                일정 수정
              </button>
              <button
                type="button"
                class="button secondary"
                :disabled="busy"
                @click="editReviewField(3, `${s.courseId}.goal`)"
              >
                {{ s.goal.trim() ? '학습 목표 수정' : '학습 목표 추가(선택)' }}
              </button>
            </div>
          </CollapsibleSection>
          <p v-if="!form.schedules.length" class="plan-review-empty">
            등록된 인증Set 일정이 없습니다.
          </p>
        </div>
        <aside class="plan-review-completion" aria-labelledby="plan-review-completion-title">
          <h2 id="plan-review-completion-title">
            {{ current.status === 'draft' ? '계획 완료 안내' : '확정 계획 안내' }}
          </h2>
          <template v-if="current.status === 'draft'">
            <p>
              현재 운영정책에 따라 결재를 생략합니다. 이 자격의 계획을 완료하면 학습 화면으로
              이동합니다.
            </p>
            <p>요청 전체의 계획 수립 완료는 내 계획에서 별도로 진행해 주세요.</p>
          </template>
          <p v-else>
            자격과 인증Set의 기준 버전은 고정됩니다. 일정·학습 목표는 변경 사유를 남겨 수정할 수
            있습니다.
          </p>
          <ul
            v-if="planErrors(form).length"
            class="validation-list"
            aria-label="계획 확인 필요 항목"
          >
            <li v-for="message in planErrors(form)" :key="message">{{ message }}</li>
          </ul>
        </aside>
      </div>
      <section v-if="current.status === 'completed'" class="panel editor-panel">
        <label class="field"
          ><span>계획 변경 사유</span
          ><input v-model="reason" :disabled="busy" maxlength="2000" /></label
        ><button
          class="button primary"
          :disabled="busy || !draft.dirty.value || !reason.trim()"
          @click="saveRevision"
        >
          일정·목표 변경 저장
        </button>
      </section>
      <CollapsibleSection
        v-if="step === 4"
        v-model:open="reviewRequestOpen"
        title="요청 기준"
        class="plan-review-request"
      >
        <PropertyList class="plan-review-facts">
          <div>
            <dt>현재 소속</dt>
            <dd>
              {{
                (
                  store.data.requiredQualifications?.organizationPath ||
                  store.actor.organizationPath
                )
                  .map((p) => p.name)
                  .join(' › ') || '확인할 수 없음'
              }}
            </dd>
          </div>
          <div>
            <dt>요청 당시 필수 자격</dt>
            <dd>
              <ul v-if="planRequest?.targets?.length" class="plan-review-required">
                <li v-for="target in planRequest.targets" :key="target.qualificationId">
                  {{ target.title }} · v{{ target.version }}
                </li>
              </ul>
              <template v-else>{{
                planRequest ? '없음' : '요청 정보를 확인할 수 없습니다.'
              }}</template>
            </dd>
          </div>
        </PropertyList>
        <p class="plan-review-help">
          이번 계획은 요청 당시의 필수 기준과 선택한 자격 버전을 따릅니다.
        </p>
      </CollapsibleSection>
      <ActionBar class="actionbar" :class="{ 'plan-review-actionbar': step === 4 }">
        <div class="plan-action-feedback">
          <SaveFeedback
            :status="
              busy
                ? '저장 중'
                : current.status === 'completed' && !draft.dirty.value
                  ? '계획 완료'
                  : draft.status.value
            "
            :error="draft.error.value"
            :conflict="draft.conflict.value"
            :busy="busy"
            @retry="draft.flush().catch(() => {})"
            @reload="reload"
          />
          <p
            v-if="step === 4 && error"
            class="error-message preserve-lines plan-review-submit-error"
            role="alert"
            tabindex="-1"
          >
            {{ error }}
          </p>
        </div>
        <template v-if="step === 4">
          <button
            v-if="current.status === 'draft'"
            class="button primary"
            :disabled="
              busy || !!planErrors(form).length || !!policyErrors.length || draft.conflict.value
            "
            @click="complete"
          >
            계획 완료
          </button>
          <RouterLink
            v-else
            :to="`/qualifications/${current.assignmentId}`"
            class="button secondary"
            >학습으로 이동</RouterLink
          >
        </template>
      </ActionBar>
    </template>
    <p v-else-if="route.params.id" class="panel empty-state">계획을 찾을 수 없습니다.</p>
    <template v-else>
      <section v-if="request" class="panel editor-panel">
        <div class="section-heading">
          <h2>새 자격 계획</h2>
          <span>작성 기한 {{ request.dueOn }}</span>
        </div>
        <p>{{ request.message }}</p>
        <label v-if="requests.length > 1" class="field"
          ><span>계획 수립 요청</span
          ><select
            aria-label="계획 수립 요청"
            :value="requestId"
            :disabled="busy || requestBusy"
            @change="
              router.replace({ query: { request: ($event.target as HTMLSelectElement).value } })
            "
          >
            <option v-for="r in requests" :key="r.id" :value="r.id">
              작성 기한 {{ r.dueOn }} · {{ r.message || '개인 인증 계획 작성' }}
            </option>
          </select></label
        >
        <div v-if="!request.completion" class="inline-form">
          <label class="field"
            ><span>취득할 자격</span
            ><select
              aria-label="취득할 자격"
              v-model="selection"
              :disabled="busy || requestBusy || !!pendingStart"
            >
              <option value="">자격 선택</option>
              <option v-for="q in eligible" :key="q.id" :value="q.id">
                {{
                  requestView?.candidates.find((c) => c.qualificationId === q.id)?.required
                    ? '[필수] '
                    : ''
                }}{{ q.title }} · v{{ q.version }}
              </option>
            </select></label
          ><button
            class="button primary"
            :disabled="
              busy ||
              requestBusy ||
              startConflict ||
              (!pendingStart && !eligible.some((q) => q.id === selection))
            "
            @click="create"
          >
            {{ pendingStart ? '계획 시작 재시도' : '계획 시작' }}
          </button>
          <button
            v-if="error || pendingStart"
            class="button secondary"
            :disabled="busy || requestBusy"
            @click="reloadRequest"
          >
            다시 불러오기
          </button>
        </div>
        <p v-if="!request.completion && !eligible.length" class="muted">
          새로 계획할 수 있는 자격이 없습니다. 아래 요청 현황을 확인해 주세요.
        </p>
        <RequestPlanning
          v-if="requestView"
          :key="request.id"
          :request="request"
          :view="requestView"
          :disabled="busy || !!pendingStart"
          @busy="requestBusy = $event"
        />
      </section>
      <section v-else class="panel empty-state">
        <h2>계획 수립 요청을 기다리고 있습니다.</h2>
        <p>조직 관리자가 대상자를 확인하고 요청하면 자격을 선택할 수 있습니다.</p>
      </section>
      <div class="qualification-list">
        <div v-for="p in plans" :key="p.id" class="qualification-row plan-list-row">
          <RouterLink :to="`/plans/${p.id}`" class="plan-list-link"
            ><span class="qualification-info"
              ><strong>{{
                store.qualification(p.qualificationId, p.qualificationMetadata).title
              }}</strong
              ><small class="muted"
                >목표 인증일 {{ p.targetOn || '미정'
                }}{{
                  p.targetOn &&
                  p.targetOn < kstDate() &&
                  !store.assignment(p.assignmentId || '')?.certifiedAt
                    ? ' · 목표일 경과'
                    : ''
                }}</small
              ></span
            ><StatusBadge
              :status="p.status === 'draft' ? 'draft' : 'complete'"
              :label="p.status === 'draft' ? '작성 중' : '계획 완료'"
            /><span class="inline-action">{{
              p.status === 'draft' ? '계획 이어 쓰기' : '계획 보기'
            }}</span></RouterLink
          >
          <button
            v-if="p.status === 'draft'"
            class="button secondary small"
            :disabled="busy"
            :aria-label="`${store.qualification(p.qualificationId, p.qualificationMetadata).title} 계획 삭제`"
            @click="askDelete(p)"
          >
            계획 삭제
          </button>
        </div>
      </div>
    </template>
    <dialog
      ref="deleteDialog"
      class="dialog"
      aria-labelledby="delete-plan-title"
      @cancel="busy && $event.preventDefault()"
    >
      <div class="dialog-head"><h2 id="delete-plan-title">미확정 계획 삭제</h2></div>
      <div v-if="deleting" class="dialog-body">
        <p>
          <strong>{{
            store.qualification(deleting.qualificationId, deleting.qualificationMetadata).title
          }}</strong>
        </p>
        <p>
          이 계획의 일정과 학습 목표를 삭제합니다. 비필수 자격은 이 초안을 사용하는 미완료
          요청에서도 제외됩니다. 필수 자격은 남으며 다시 계획할 수 있습니다.
        </p>
        <p class="muted">
          {{ deleting.schedules.length }}개 인증Set의 일정·목표 · 목표 인증일
          {{ deleting.targetOn || '미입력' }}
        </p>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      </div>
      <div class="dialog-footer">
        <button class="button secondary" :disabled="busy" @click="deleteDialog?.close()">
          취소</button
        ><button class="button primary" :disabled="busy" @click="deletePlan">계획 삭제</button>
      </div>
    </dialog>
  </div>
</template>
