<script setup lang="ts">
import CourseCategory from '../components/CourseCategory.vue';
import PreviousPlanSchedule from '../components/PreviousPlanSchedule.vue';
import PersonalTypeTabs from '../components/PersonalTypeTabs.vue';
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
import { ApiError, api } from '../api';
import { releaseVersionLabel } from '@eks/contracts';
import { useProcessContext } from '../composables/useProcessContext';
import '../plan-review.css';
const store = useDemo(),
  route = useRoute(),
  router = useRouter(),
  busy = ref(false),
  error = ref(''),
  step = ref(1),
  fieldErrors = ref<Record<string, string>>({});
const initializing = ref(false),
  deleting = ref<PersonalPlan | null>(null),
  deleteDialog = ref<HTMLDialogElement | null>(null),
  activePlanId = ref('');
let loadGeneration = 0;
const selectedType = computed(() => {
  const p = store.data.plans.find((p) => p.id === route.params.id),
    r = store.data.planningRequests.find((r) => r.id === route.query.request);
  return p
    ? store.qualification(p.qualificationId).qualificationType
    : r
      ? r.qualificationType
      : route.query.type === 'auditor' || !store.personalTypes.includes('auditee')
        ? 'auditor'
        : 'auditee';
});
const auditor = computed(() => selectedType.value === 'auditor');
const plans = computed(() =>
  store.data.plans.filter(
    (p) =>
      p.learnerId === store.actorId &&
      store.qualification(p.qualificationId).qualificationType === selectedType.value,
  ),
);
const requests = computed(() =>
  store.data.planningRequests
    .filter((r) => r.learnerId === store.actorId && r.qualificationType === selectedType.value)
    .slice()
    .reverse(),
);
const requestId = computed(() =>
  typeof route.query.request === 'string' ? route.query.request : requests.value[0]?.id,
);
const request = computed(() => requests.value.find((r) => r.id === requestId.value));
const current = computed(() => plans.value.find((p) => p.id === route.params.id));
const reviewQualification = computed(() =>
  current.value ? store.qualificationFor(current.value) : undefined,
);
const criteriaReview = ref<any>();
async function fetchCriteria() {
  const id = current.value?.id;
  if (!id) return;
  const result = await api<any>(`/plans/${id}/criteria`);
  if (current.value?.id === id) criteriaReview.value = result;
  return result;
}
watch([() => current.value?.id, step], () => {
  void fetchCriteria().catch((e) => {
    error.value = (e as Error).message;
  });
});
async function reviewLatestCriteria() {
  if (busy.value || !criteriaReview.value?.changed) return;
  busy.value = true;
  try {
    await draft.flush();
    await store.command(`/plans/${current.value!.id}/review-criteria`, {
      revision: draft.revision.value,
      qualificationId: criteriaReview.value.current.id,
      criteriaToken: criteriaReview.value.criteriaToken,
    });
    await load();
    await fetchCriteria();
    step.value = 3;
    error.value = '';
  } catch (e) {
    handleError(e);
    await fetchCriteria();
  } finally {
    busy.value = false;
  }
}
const planRequest = computed(() => requests.value.find((r) => r.id === current.value?.requestId));
const planReadOnly = computed(
  () => current.value?.status === 'completed' || !!planRequest.value?.closed,
);
const reviewRequestOpen = ref(false);
watch(
  () => `${store.actorId}:${route.params.id || ''}`,
  () => {
    reviewRequestOpen.value = false;
  },
);
useProcessContext(() =>
  planReadOnly.value ? 'plan-completed' : route.params.id ? `plan-${step.value}` : 'plan-1',
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
type Fields = Pick<PersonalPlan, 'startOn' | 'endOn' | 'goal'>;
const draft = useSavedDraft<Fields>(async (value, revision) => {
  if (
    planReadOnly.value ||
    current.value?.status !== 'draft' ||
    current.value.id !== activePlanId.value
  )
    throw new Error('완료된 계획은 이 화면에서 변경할 수 없습니다.');
  return store.command(`/plans/${activePlanId.value}`, { ...value, revision }, 'PUT');
});
const form = computed(() =>
  planReadOnly.value && current.value
    ? { startOn: current.value.startOn, endOn: current.value.endOn, goal: current.value.goal }
    : draft.value.value,
);
function reviewDate(value?: string) {
  return value ? value.replaceAll('-', '.') : '미정';
}
async function editReviewField(target: 2, key: string) {
  if (
    planReadOnly.value ||
    current.value?.status !== 'draft' ||
    busy.value ||
    initializing.value ||
    draft.terminal.value
  )
    return;
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
  if (
    !planReadOnly.value &&
    current.value?.status === 'draft' &&
    !current.value.scheduleDefaultsAppliedAt
  ) {
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
  if (!planReadOnly.value && current.value?.status === 'draft' && !draft.terminal.value)
    draft.load(
      { startOn: current.value.startOn, endOn: current.value.endOn, goal: current.value.goal },
      current.value.revision,
    );
  step.value = planReadOnly.value ? 3 : 2;
}
watch(() => `${store.actorId}:${route.params.id || ''}`, load, { immediate: true });
watch(current, (value, previous) => {
  if (!value && previous?.id === route.params.id && activePlanId.value === previous.id)
    draft.stop('삭제된 계획입니다. 내 계획에서 다시 작성해 주세요.');
  else if (value?.status === 'completed' || planRequest.value?.closed) {
    ++loadGeneration;
    draft.clear();
    initializing.value = false;
    fieldErrors.value = {};
    error.value = '';
    step.value = 3;
  }
});
function handleError(err: unknown) {
  if (err instanceof ApiError && err.code === 'PLAN_DELETED') draft.stop(err.message);
  else error.value = (err as Error).message;
  if (step.value === 3)
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
  if (!planReadOnly.value && current.value?.status === 'draft') draft.changed();
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
  const f = form.value,
    result: Record<string, string> = {};
  if (!f?.startOn) result.startOn = '시작일을 입력해 주세요.';
  if (!f?.endOn) result.endOn = '종료일을 입력해 주세요.';
  if (f?.startOn && f.endOn && f.startOn > f.endOn)
    result.endOn = '종료일은 시작일 이후여야 합니다.';
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
  if (
    planReadOnly.value ||
    current.value?.status !== 'draft' ||
    busy.value ||
    initializing.value ||
    draft.terminal.value ||
    target === step.value
  )
    return;
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
  if (planReadOnly.value || current.value?.status !== 'draft') return;
  busy.value = true;
  error.value = '';
  try {
    const errors = planErrors(form.value!, selectedType.value);
    if (errors.length) {
      const schedules = scheduleErrors();
      step.value = 2;
      fieldErrors.value = schedules;
      await focusFirstError();
      throw new Error(errors.join('\n'));
    }
    await draft.flush();
    const reviewed = await fetchCriteria();
    if (reviewed?.changed)
      throw new Error('기준이 변경되었습니다. 변경 내용을 확인하고 최신 기준을 적용해 주세요.');
    const result = await store.command(`/plans/${current.value!.id}/complete`, {
      criteriaToken: reviewed.criteriaToken,
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
async function reload() {
  if (!(await confirmAction('현재 입력을 버리고 서버의 계획을 다시 불러올까요?', '다시 불러오기')))
    return;
  await store.refresh();
  load();
}
async function leave() {
  if (busy.value || requestBusy.value || initializing.value) return false;
  if (planReadOnly.value) return true;
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
  <div
    id="personal-content"
    class="container page plans-page"
    :class="{ 'is-plan-review': current && step === 3 }"
  >
    <LearnerNav />
    <PersonalTypeTabs panel-id="personal-content" v-if="!route.params.id" />
    <div v-if="current && policyErrors.length" class="error-message" role="alert">
      {{ policyErrors.join(' · ')
      }}<RouterLink :to="auditor ? '/plans?type=auditor' : '/plans'"
        >내 계획에서 현재 요청 확인</RouterLink
      >
    </div>
    <PageHeading class="page-heading">
      <h1>{{ current ? '개인 인증 계획' : '내 계획' }}</h1>
      <span>{{ store.actor.name }}</span>
    </PageHeading>
    <p
      v-if="error && !(current && form && step === 3 && !draft.terminal.value)"
      class="error-message preserve-lines"
      role="alert"
    >
      {{ error }}
    </p>
    <section v-if="draft.terminal.value" class="panel empty-state" role="alert">
      <h2>삭제된 계획입니다</h2>
      <p>{{ draft.terminal.value }}</p>
      <RouterLink :to="auditor ? '/plans?type=auditor' : '/plans'" class="button primary"
        >내 계획으로 이동</RouterLink
      >
    </section>
    <section v-else-if="initializing" class="panel empty-state" role="status">
      기본 일정을 준비하고 있습니다.
    </section>
    <section v-else-if="current && !form" class="panel empty-state">
      <p>{{ error || '계획을 불러오지 못했습니다.' }}</p>
      <button class="button secondary" @click="load">다시 불러오기</button>
    </section>
    <template v-else-if="current && form">
      <RouterLink
        :to="{
          path: '/plans',
          query: { request: requestId, type: auditor ? 'auditor' : undefined },
        }"
        class="back-link"
        >내 계획으로</RouterLink
      >
      <div v-if="step !== 3" class="panel plan-context">
        <h2>
          {{ store.qualification(current.qualificationId, current.qualificationMetadata).title }}
        </h2>
        <p class="muted">
          {{
            releaseVersionLabel(
              store.qualification(current.qualificationId, current.qualificationMetadata),
            )
          }}
          · 계획 작성 기한
          {{ requests.find((r) => r.id === current!.requestId)?.dueOn }}
        </p>
        <p>
          {{
            store.qualification(current.qualificationId, current.qualificationMetadata).description
          }}
        </p>
      </div>
      <nav
        v-if="!planReadOnly && current.status === 'draft'"
        class="plan-steps"
        aria-label="계획 작성 단계"
      >
        <button
          v-for="(label, i) in ['자격 확인', '일정 수립', '최종 확인']"
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
          필수 {{ reviewQualification?.courseIds.length || 0 }}인증Set · 이 계획의 자격과 기준
          버전은 고정됩니다.
        </p>
        <button class="button primary" @click="moveTo(2)">일정 수립</button>
      </section>
      <section v-else-if="step === 2" class="panel editor-panel plan-schedule-panel">
        <h2>일정 수립</h2>
        <div class="qualification-plan-dates">
          <label v-for="field in ['startOn', 'endOn'] as const" :key="field" class="field">
            <span :id="`plan-${field}-label`">{{ field === 'startOn' ? '시작일' : '종료일' }}</span>
            <input
              v-model="form[field]"
              :data-plan-field="field"
              :aria-labelledby="`plan-${field}-label`"
              type="date"
              :disabled="busy"
              :aria-invalid="!!fieldErrors[field]"
              :aria-describedby="fieldErrors[field] ? `plan-${field}-error` : undefined"
              @input="clearField(field)"
            />
            <small
              v-if="fieldErrors[field]"
              :id="`plan-${field}-error`"
              class="field-error"
              role="alert"
              >{{ fieldErrors[field] }}</small
            >
          </label>
        </div>
        <label class="field"
          ><span>학습 목표(선택)</span>
          <textarea
            v-model="form.goal"
            data-plan-field="goal"
            rows="3"
            maxlength="2000"
            :disabled="busy"
            @input="clearField('goal')"
            placeholder="이 자격을 취득하며 달성할 목표를 작성해 주세요."
          />
        </label>
        <p class="muted schedule-help">
          최초 일정은 오늘부터 1주 후 시작, 시작일부터 3주 후 종료로 채웁니다. 예정일은 학습·평가
          진행을 막지 않습니다.
        </p>
        <button class="button primary" @click="moveTo(3)">최종 확인</button>
      </section>
      <div v-else class="plan-review">
        <header class="plan-review-heading">
          <h2>{{ planReadOnly ? '계획 내용' : '계획 최종 확인' }}</h2>
          <p>
            {{
              planReadOnly
                ? '확정한 일정과 선택 입력한 학습 목표를 확인하세요.'
                : '자격의 시작일·종료일과 학습 목표를 확인한 뒤 계획을 완료해 주세요.'
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
                ><span class="plan-review-version">{{
                  releaseVersionLabel(reviewQualification)
                }}</span>
              </dd>
            </div>
            <div v-for="field in ['startOn', 'endOn'] as const" :key="field">
              <dt>{{ field === 'startOn' ? '시작일' : '종료일' }}</dt>
              <dd>{{ reviewDate(form[field]) }}</dd>
            </div>
            <div class="plan-review-goal">
              <dt>학습 목표</dt>
              <dd class="preserve-lines">{{ form.goal || '미입력' }}</dd>
            </div>
            <div>
              <dt>필수 인증Set</dt>
              <dd>{{ reviewQualification?.courseIds.length || 0 }}개</dd>
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
        <div v-if="!planReadOnly && current.status === 'draft'" class="plan-review-edit-actions">
          <button class="button secondary" :disabled="busy" @click="editReviewField(2, 'startOn')">
            일정 수정
          </button>
          <button class="button secondary" :disabled="busy" @click="editReviewField(2, 'goal')">
            학습 목표 수정
          </button>
        </div>
        <section
          v-if="criteriaReview?.changed && !planReadOnly"
          class="panel"
          aria-label="기준 버전 변경"
        >
          <h2>기준 버전이 변경되었습니다</h2>
          <p>일정과 학습 목표는 유지됩니다. 다음 기준을 확인한 뒤 적용해 주세요.</p>
          <div
            v-for="(value, key) in { 이전: criteriaReview.previous, 최신: criteriaReview.current }"
            :key="key"
          >
            <h3>{{ key }} · {{ value.title }} {{ releaseVersionLabel(value) }}</h3>
            <p>{{ value.description }}</p>
            <p>
              인증기간:
              {{
                value.validity.type === 'months'
                  ? value.validity.months + '개월'
                  : value.validity.type === 'unlimited'
                    ? '무기한'
                    : '미정'
              }}
            </p>
            <p>
              재인증 시작 {{ value.renewalLeadMonths }}개월 전 · 알림
              {{ value.renewalNoticeDaysBefore }}일 전
            </p>
            <ul>
              <li v-for="c in value.courses" :key="c.id">
                {{ c.title }} {{ releaseVersionLabel(c) }}
              </li>
            </ul>
          </div>
          <button class="button primary" :disabled="busy" @click="reviewLatestCriteria">
            최신 기준 확인·적용
          </button>
        </section>
        <aside class="plan-review-completion" aria-labelledby="plan-review-completion-title">
          <h2 id="plan-review-completion-title">
            {{ !planReadOnly && current.status === 'draft' ? '계획 완료 안내' : '확정 계획 안내' }}
          </h2>
          <template v-if="!planReadOnly && current.status === 'draft'">
            <p>
              현재 운영정책에 따라 결재를 생략합니다. 이 자격의 계획을 완료하면 학습 화면으로
              이동합니다.
            </p>
            <p>요청 전체의 계획 수립 완료는 내 계획에서 별도로 진행해 주세요.</p>
          </template>
          <p v-else>완료된 계획은 이 화면에서 변경할 수 없습니다.</p>
          <ul
            v-if="
              !planReadOnly && current.status === 'draft' && planErrors(form, selectedType).length
            "
            class="validation-list"
            aria-label="계획 확인 필요 항목"
          >
            <li v-for="message in planErrors(form, selectedType)" :key="message">{{ message }}</li>
          </ul>
        </aside>
      </div>
      <section class="panel plan-course-reference" aria-label="포함된 인증Set">
        <h2>포함된 인증Set</h2>
        <ul>
          <li v-for="id in reviewQualification?.courseIds || []" :key="id">
            <CourseCategory :course="store.course(id)" /> {{ store.course(id).title }} ·
            {{ releaseVersionLabel(store.course(id)) }}
          </li>
        </ul>
      </section>
      <PreviousPlanSchedule :plan="current" />
      <CollapsibleSection
        v-if="step === 3"
        v-model:open="reviewRequestOpen"
        title="요청 기준"
        class="plan-review-request"
      >
        <PropertyList class="plan-review-facts">
          <div>
            <dt>현재 소속</dt>
            <dd>
              {{ store.actor.organizationPath.map((p) => p.name).join(' › ') || '확인할 수 없음' }}
            </dd>
          </div>
        </PropertyList>
        <p class="plan-review-help">이번 계획은 선택한 자격 버전을 따릅니다.</p>
      </CollapsibleSection>
      <ActionBar class="actionbar" :class="{ 'plan-review-actionbar': step === 3 }">
        <div class="plan-action-feedback">
          <SaveFeedback
            v-if="!planReadOnly && current.status === 'draft'"
            :status="busy ? '저장 중' : draft.status.value"
            :error="draft.error.value"
            :conflict="draft.conflict.value"
            :busy="busy"
            @retry="draft.flush().catch(() => {})"
            @reload="reload"
          />
          <span v-else class="save-status" role="status" aria-atomic="true">계획 완료</span>
          <p
            v-if="step === 3 && error"
            class="error-message preserve-lines plan-review-submit-error"
            role="alert"
            tabindex="-1"
          >
            {{ error }}
          </p>
        </div>
        <template v-if="step === 3">
          <button
            v-if="!planReadOnly && current.status === 'draft'"
            class="button primary"
            :disabled="
              busy ||
              !!planErrors(form, selectedType).length ||
              !!policyErrors.length ||
              draft.conflict.value
            "
            @click="complete"
          >
            계획 완료
          </button>
          <RouterLink
            v-else-if="current.assignmentId"
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
        <div v-if="!request.completion && !request.closed" class="inline-form">
          <label class="field"
            ><span>취득할 자격</span
            ><select
              aria-label="취득할 자격"
              v-model="selection"
              :disabled="busy || requestBusy || !!pendingStart"
            >
              <option value="">자격 선택</option>
              <option v-for="q in eligible" :key="q.id" :value="q.id">
                {{ q.title }} · {{ releaseVersionLabel(q) }}
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
        <p v-if="!request.completion && !request.closed && !eligible.length" class="muted">
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
                >시작일 {{ p.startOn || '미정' }} · 종료일 {{ p.endOn || '미정'
                }}{{
                  p.endOn &&
                  p.endOn < kstDate() &&
                  !store.assignment(p.assignmentId || '')?.certifiedAt
                    ? ' · 목표일 경과'
                    : ''
                }}</small
              ><small v-if="p.goal" class="muted plan-list-goal"
                >학습 목표 · {{ p.goal }}</small
              ></span
            ><StatusBadge
              :status="p.status === 'draft' ? 'draft' : 'complete'"
              :label="
                store.data.planningRequests.find((r) => r.id === p.requestId)?.closed
                  ? '요청 종료'
                  : p.status === 'draft'
                    ? '작성 중'
                    : '계획 완료'
              "
            /><span class="inline-action">{{
              p.status === 'draft' &&
              !store.data.planningRequests.find((r) => r.id === p.requestId)?.closed
                ? '계획 이어 쓰기'
                : '계획 보기'
            }}</span></RouterLink
          >
          <button
            v-if="
              p.status === 'draft' &&
              !store.data.planningRequests.find((r) => r.id === p.requestId)?.closed
            "
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
          이 계획의 일정과 학습 목표를 삭제합니다. 이 초안을 사용하는 미완료 요청의 선택 목록에서도
          해당 자격을 제외합니다. 필요하면 다시 선택해 계획할 수 있습니다.
        </p>
        <p class="muted">
          자격의 시작일·종료일·학습 목표 · {{ deleting.startOn || '미입력' }} ~
          {{ deleting.endOn || '미입력' }}
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

<style scoped>
.plan-list-goal {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.qualification-plan-dates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.plan-course-reference li {
  padding: 12px 0;
  border-bottom: 1px solid var(--line, #e3e8ee);
  overflow-wrap: anywhere;
}
.plan-course-reference ul {
  list-style: none;
  padding: 0;
}
@media (max-width: 600px) {
  .qualification-plan-dates {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
