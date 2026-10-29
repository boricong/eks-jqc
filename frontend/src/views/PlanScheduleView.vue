<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import {
  releaseVersionLabel,
  scheduleFieldErrors,
  type PlanningSchedule,
  type ScheduleRow,
  type ScheduleRowInput,
  type ScheduleSaveInput,
} from '@eks/contracts';
import { useDemo } from '../stores/demo';
import { api, ApiError } from '../api';
import { DATASET_EVENT, getDataEpoch } from '../data-generation';
import { confirmAction } from '../composables/useConfirmation';
import { useProcessContext } from '../composables/useProcessContext';
import PlansView from './PlansView.vue';
import LearnerNav from '../components/LearnerNav.vue';
import PageHeading from '../components/PageHeading.vue';
import ActionBar from '../components/ActionBar.vue';
import StatusBadge from '../components/StatusBadge.vue';
import PreviousPlanSchedule from '../components/PreviousPlanSchedule.vue';
import '../styles/plan-schedule.css';

const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const requests = computed(() =>
  store.data.planningRequests
    .filter((r) => r.learnerId === store.actorId && r.qualificationType === 'auditee')
    .slice()
    .reverse()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);
const requestId = computed(() =>
  typeof route.query.request === 'string' ? route.query.request : requests.value[0]?.id || '',
);
const request = computed(() => requests.value.find((r) => r.id === requestId.value));
const record = computed(() => !!route.params.id);
const view = ref<PlanningSchedule>();
const values = ref<Record<string, ScheduleRowInput>>({});
const selected = ref<string[]>([]),
  saved = ref<Record<string, string>>({});
const loading = ref(false),
  saving = ref(false),
  busy = ref(false),
  error = ref(''),
  conflict = ref(false),
  review = ref<PlanningSchedule>();
const fieldErrors = ref<Record<string, Record<string, string>>>({});
const bulk = ref({ startOn: '', endOn: '' });
const saveStatus = ref('입력 대기');
useProcessContext(() =>
  record.value ? '' : view.value?.readOnly ? 'plan-completed' : review.value ? 'plan-3' : 'plan-2',
);
let generation = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
let flight: Promise<void> | undefined;
let pendingSave: ScheduleSaveInput | undefined;
let pendingComplete:
  { requestRevision: number; reviewToken: string; confirmNoAdditional: boolean } | undefined;
const signature = (v: ScheduleRowInput) =>
  JSON.stringify({
    qualificationId: v.qualificationId,
    startOn: v.startOn,
    endOn: v.endOn,
    goal: v.goal,
  });
const rows = computed(
  () =>
    view.value?.rows.filter(
      (r) => selected.value.includes(r.entityId) || (view.value?.readOnly && r.selected),
    ) || [],
);
const extras = computed(
  () => view.value?.rows.filter((r) => !selected.value.includes(r.entityId) && r.editable) || [],
);
const dirty = computed(() =>
  rows.value.some(
    (r) =>
      values.value[r.entityId] && signature(values.value[r.entityId]!) !== saved.value[r.entityId],
  ),
);
const locked = computed(() => loading.value || busy.value || !!pendingComplete);
const context = () => `${store.actorId}:${requestId.value}:${getDataEpoch()}:${generation}`;
const inputFor = (r: ScheduleRow): ScheduleRowInput => ({
  entityId: r.entityId,
  qualificationId: r.plan?.qualificationId || r.qualificationId,
  ...(r.plan ? { planId: r.plan.id, revision: r.plan.revision } : {}),
  startOn: r.startOn,
  endOn: r.endOn,
  goal: r.goal,
});
function merge(next: PlanningSchedule, preserve = true) {
  const old = values.value,
    nextValues: Record<string, ScheduleRowInput> = {};
  for (const r of next.rows) {
    const v = inputFor(r),
      local = old[r.entityId];
    nextValues[r.entityId] = preserve && local ? local : v;
    if (!preserve || !local) saved.value[r.entityId] = signature(v);
  }
  values.value = nextValues;
  selected.value = [
    ...new Set([
      ...next.rows.filter((r) => r.selected).map((r) => r.entityId),
      ...(preserve
        ? selected.value.filter((id) => next.rows.some((r) => r.entityId === id && r.editable))
        : []),
    ]),
  ];
  view.value = next;
}
async function fetchView() {
  return api<PlanningSchedule>(`/planning-requests/${requestId.value}/schedule`);
}
async function load() {
  generation++;
  busy.value = false;
  saving.value = false;
  loading.value = false;
  clearTimeout(timer);
  pendingSave = undefined;
  pendingComplete = undefined;
  values.value = {};
  saved.value = {};
  selected.value = [];
  view.value = undefined;
  review.value = undefined;
  error.value = '';
  conflict.value = false;
  fieldErrors.value = {};
  bulk.value = { startOn: '', endOn: '' };
  if (!request.value || record.value) return;
  const key = context();
  loading.value = true;
  try {
    const next = await fetchView();
    if (key === context()) {
      merge(next, false);
      saveStatus.value = '저장됨';
      await nextTick();
      const focus =
        typeof route.query.qualification === 'string'
          ? next.rows.find(
              (r) =>
                r.qualificationId === route.query.qualification ||
                r.entityId === route.query.qualification,
            )?.entityId
          : undefined;
      if (focus)
        document.getElementById(`request-schedule-${focus}`)?.scrollIntoView({ block: 'center' });
    }
  } catch (e) {
    if (key === context()) error.value = (e as Error).message;
  } finally {
    if (key === context()) loading.value = false;
  }
}
watch(() => `${store.actorId}:${requestId.value}:${route.params.id || ''}`, load, {
  immediate: true,
});
function changed(id: string) {
  review.value = undefined;
  fieldErrors.value[id] = {};
  error.value = '';
  saveStatus.value = '저장 대기';
  clearTimeout(timer);
  if (!conflict.value) timer = setTimeout(() => void flush().catch(() => {}), 500);
}
async function flush(all = false) {
  clearTimeout(timer);
  if (flight) await flight;
  if (conflict.value) throw new Error('변경된 저장 내용을 확인해 주세요. 현재 입력은 유지됩니다.');
  if (!view.value || view.value.readOnly) return;
  const key = context();
  flight = (async () => {
    const changedRows = rows.value.filter(
      (r) =>
        r.editable &&
        (signature(values.value[r.entityId]!) !== saved.value[r.entityId] ||
          (all && !values.value[r.entityId]!.planId)),
    );
    if (!pendingSave && !changedRows.length) return;
    const payload = pendingSave || {
      requestRevision: view.value!.requestRevision,
      rows: changedRows.map((r) => JSON.parse(JSON.stringify(values.value[r.entityId]!))),
    };
    pendingSave = payload;
    saving.value = true;
    saveStatus.value = '저장 중';
    try {
      await store.command(`/planning-requests/${requestId.value}/schedule`, payload, 'PUT');
      const next = await fetchView();
      if (key !== context()) return;
      for (const sent of payload.rows) {
        const row = next.rows.find((r) => r.entityId === sent.entityId),
          local = values.value[sent.entityId];
        if (!row || !local) continue;
        local.planId = row.plan?.id;
        local.revision = row.plan?.revision;
        if (local.qualificationId === sent.qualificationId) delete local.reviewedCriteriaToken;
        saved.value[sent.entityId] = signature(sent);
      }
      merge(next);
      pendingSave = undefined;
      error.value = '';
      saveStatus.value = '저장됨';
    } catch (e) {
      if (key === context()) {
        error.value = (e as Error).message;
        saveStatus.value = '저장 실패';
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          pendingSave = undefined;
          conflict.value = true;
        }
      }
      throw e;
    } finally {
      if (key === context()) saving.value = false;
    }
  })();
  try {
    await flight;
  } finally {
    flight = undefined;
  }
  if (
    all &&
    key === context() &&
    !conflict.value &&
    rows.value.some(
      (r) =>
        r.editable &&
        (!values.value[r.entityId]!.planId ||
          signature(values.value[r.entityId]!) !== saved.value[r.entityId]),
    )
  )
    return flush(true);
  if (key === context() && dirty.value && !conflict.value)
    timer = setTimeout(() => void flush().catch(() => {}), 500);
}
async function recover() {
  if (locked.value || saving.value) return;
  const key = context();
  busy.value = true;
  try {
    const next = await fetchView();
    if (key !== context()) return;
    const summary = next.rows
      .filter((r) => selected.value.includes(r.entityId))
      .map(
        (r) =>
          `${r.title}: 서버 ${r.startOn || '미정'} ~ ${r.endOn || '미정'} / 내 입력 ${values.value[r.entityId]?.startOn || '미정'} ~ ${values.value[r.entityId]?.endOn || '미정'}`,
      )
      .join('\n');
    if (
      !(await confirmAction(
        `${summary}\n\n서버의 최신 상태를 확인했습니다. 내 일정·목표 입력을 유지하고 다시 검토할까요?`,
        '내 입력 유지하고 재검토',
      )) ||
      key !== context()
    )
      return;
    for (const r of next.rows) {
      const v = values.value[r.entityId];
      if (!v) continue;
      v.planId = r.plan?.id;
      v.revision = r.plan?.revision;
      if (r.plan) v.qualificationId = r.plan.qualificationId;
      delete v.reviewedCriteriaToken;
    }
    merge(next);
    conflict.value = false;
    pendingSave = undefined;
    review.value = undefined;
    error.value = '';
  } catch (e) {
    if (key === context()) error.value = (e as Error).message;
  } finally {
    if (key === context()) busy.value = false;
  }
}
function focusField(id: string, field: string) {
  const el =
    document.getElementById(`request-schedule-${id}-${field}`) ||
    document.getElementById(`request-schedule-${id}`);
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: 'center' });
}
async function focusError() {
  await nextTick();
  for (const r of rows.value)
    for (const field of Object.keys(fieldErrors.value[r.entityId] || {})) {
      const el =
        document.getElementById(`request-schedule-${r.entityId}-${field}`) ||
        document.getElementById(`request-schedule-${r.entityId}`);
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'center' });
        return;
      }
    }
  document.getElementById('request-schedule-error')?.focus();
}
async function applyBulk() {
  if (locked.value || saving.value || conflict.value) return;
  const targets = rows.value.filter((r) => r.editable);
  const problems = targets
    .map((r) => ({ row: r, errors: scheduleFieldErrors(bulk.value, r.window?.deadlineOn) }))
    .filter((r) => Object.keys(r.errors).length);
  if (problems.length) {
    const earliest = targets
      .map((r) => r.window?.deadlineOn)
      .filter((d): d is string => !!d)
      .sort()[0];
    error.value = `일괄 적용하지 않았습니다. ${problems.map((p) => `${p.row.title}: ${Object.values(p.errors).join(' ')}`).join('\n')}${earliest ? `\n가장 빠른 허용 완료일: ${earliest}` : ''}`;
    await nextTick();
    document.getElementById('request-schedule-error')?.focus();
    return;
  }
  if (!targets.length) return;
  const key = context();
  busy.value = true;
  try {
    if (
      targets.some((r) => values.value[r.entityId]!.startOn || values.value[r.entityId]!.endOn) &&
      !(await confirmAction(
        `${targets.length}개 자격의 시작일·완료일을 ${bulk.value.startOn} ~ ${bulk.value.endOn}으로 변경할까요? 개별 입력한 일정도 바뀝니다.`,
        '전체 적용',
      ))
    )
      return;
    if (key !== context()) return;
    for (const r of targets) {
      Object.assign(values.value[r.entityId]!, bulk.value);
      changed(r.entityId);
    }
  } finally {
    if (key === context()) busy.value = false;
  }
}
async function acceptCriteria(row: ScheduleRow) {
  const old = row.previousQualification,
    next = row.qualification;
  if (!next || locked.value || saving.value) return;
  const key = context();
  busy.value = true;
  try {
    if (
      !(await confirmAction(
        `${old?.title || row.title} ${releaseVersionLabel(old)} → ${next.title} ${releaseVersionLabel(next)}\n최대 완료 개월: ${old?.planningDeadlineMonths ?? '미설정'} → ${next.planningDeadlineMonths ?? '미설정'}\n포함 인증Set: ${row.courseTitles.join(', ')}\n일정·목표를 유지하고 최신 기준으로 다시 검토할까요?`,
        '최신 기준 반영',
      )) ||
      key !== context()
    )
      return;
    values.value[row.entityId]!.qualificationId = next.id;
    values.value[row.entityId]!.reviewedCriteriaToken = row.criteriaToken;
    changed(row.entityId);
  } finally {
    if (key === context()) busy.value = false;
  }
}
function add(row: ScheduleRow) {
  selected.value.push(row.entityId);
  saved.value[row.entityId] = '';
  changed(row.entityId);
}
async function remove(row: ScheduleRow) {
  if (locked.value || saving.value || row.required) return;
  clearTimeout(timer);
  const key = context();
  busy.value = true;
  try {
    if (
      !(await confirmAction(
        `${row.title}의 미확정 계획과 이번 요청의 추가 선택을 제외할까요?`,
        '계획 제외',
      )) ||
      key !== context()
    )
      return;
    if (row.plan)
      await store.command(`/plans/${row.plan.id}`, { revision: row.plan.revision }, 'DELETE');
    else if (row.selected)
      await store.command(
        `/planning-requests/${requestId.value}/selection`,
        {
          revision: view.value!.requestRevision,
          entityIds: view
            .value!.rows.filter((r) => r.selected && r.entityId !== row.entityId)
            .map((r) => r.entityId),
        },
        'PUT',
      );
    if (key !== context()) return;
    selected.value = selected.value.filter((id) => id !== row.entityId);
    delete values.value[row.entityId];
    delete saved.value[row.entityId];
    merge(await fetchView());
    review.value = undefined;
  } catch (e) {
    if (key === context()) error.value = (e as Error).message;
  } finally {
    if (key === context()) {
      busy.value = false;
      if (dirty.value && !conflict.value)
        timer = setTimeout(() => void flush().catch(() => {}), 500);
    }
  }
}
async function refreshVisible() {
  if (
    !view.value ||
    record.value ||
    locked.value ||
    saving.value ||
    dirty.value ||
    pendingSave ||
    review.value
  )
    return;
  const key = context();
  try {
    const next = await fetchView();
    if (key === context() && !dirty.value && !saving.value && !busy.value && !review.value)
      merge(next, false);
  } catch {
    /* Keep the current inputs until a deliberate save or retry. */
  }
}
async function editReview() {
  review.value = undefined;
  await nextTick();
  document.querySelector<HTMLInputElement>('.request-schedule-row input')?.focus();
}
async function preview() {
  if (locked.value || saving.value) return;
  const key = context();
  busy.value = true;
  error.value = '';
  fieldErrors.value = {};
  try {
    await flush(true);
    const next = await api<PlanningSchedule>(
      `/planning-requests/${requestId.value}/schedule/preview`,
      { method: 'POST', body: '{}' },
    );
    if (key !== context()) return;
    merge(next);
    if (!next.canComplete) {
      fieldErrors.value = Object.fromEntries(
        next.rows.filter((r) => r.selected).map((r) => [r.entityId, r.errors]),
      );
      error.value = next.errors.join('\n') || '자격별 보완 항목을 확인해 주세요.';
      busy.value = false;
      await focusError();
      return;
    }
    review.value = next;
    await nextTick();
    document.getElementById('request-schedule-review-title')?.focus();
  } catch (e) {
    if (key === context()) {
      error.value = (e as Error).message;
      await focusError();
    }
  } finally {
    if (key === context()) busy.value = false;
  }
}
async function complete() {
  if (busy.value || saving.value || (!review.value?.reviewToken && !pendingComplete)) return;
  const key = context();
  busy.value = true;
  error.value = '';
  pendingComplete ||= {
    requestRevision: review.value!.requestRevision,
    reviewToken: review.value!.reviewToken!,
    confirmNoAdditional: review.value!.noAdditional,
  };
  try {
    await store.command(`/planning-requests/${requestId.value}/schedule/complete`, pendingComplete);
    if (key !== context()) return;
    pendingComplete = undefined;
    review.value = undefined;
    merge(await fetchView(), false);
    saveStatus.value = '전체 계획 확정 완료';
    await nextTick();
    document.getElementById('request-schedule-completed')?.focus();
  } catch (e) {
    if (key !== context()) return;
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
      pendingComplete = undefined;
      review.value = undefined;
      merge(await fetchView());
    }
  } finally {
    if (key === context()) busy.value = false;
  }
}
async function leave() {
  if (record.value) return true;
  if (busy.value || saving.value || pendingComplete) return false;
  try {
    await flush();
    return true;
  } catch {
    return confirmAction(
      '저장하지 못한 입력이 있습니다. 변경을 버리고 이동할까요?',
      '변경 버리고 이동',
    );
  }
}
async function selectRequest(event: Event) {
  const el = event.target as HTMLSelectElement,
    id = el.value;
  el.value = requestId.value;
  await router.push({ path: '/plans', query: { request: id } });
}
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value || pendingSave || pendingComplete) {
    e.preventDefault();
    e.returnValue = '';
  }
}
function datasetChanged() {
  generation++;
  clearTimeout(timer);
  pendingSave = undefined;
  pendingComplete = undefined;
  values.value = {};
  view.value = undefined;
}
window.addEventListener('beforeunload', beforeUnload);
window.addEventListener(DATASET_EVENT, datasetChanged);
window.addEventListener('focus', refreshVisible);
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
onBeforeUnmount(() => {
  generation++;
  clearTimeout(timer);
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener(DATASET_EVENT, datasetChanged);
  window.removeEventListener('focus', refreshVisible);
});
</script>

<template>
  <PlansView v-if="record" />
  <main v-else class="container page request-schedule-page" id="personal-content">
    <LearnerNav />
    <PageHeading
      ><h1>자격 일정 수립</h1>
      <span>{{ store.actor.name }}</span></PageHeading
    >
    <label v-if="requests.length" class="field request-schedule-request"
      ><span>계획 수립 요청</span
      ><select :value="requestId" @change="selectRequest" :disabled="busy || saving">
        <option v-for="r in requests" :key="r.id" :value="r.id">
          {{ r.dueOn }}까지 ·
          {{ r.completion ? '계획 완료' : r.closed ? '요청 종료' : '작성 중' }} ·
          {{ r.message || '개인 인증 계획' }}
        </option>
      </select></label
    >
    <p v-else class="panel empty-state">계획 수립 요청을 기다리고 있습니다.</p>
    <p v-if="loading" role="status">계획을 불러오고 있습니다.</p>
    <div
      v-if="error"
      id="request-schedule-error"
      class="error-message preserve-lines"
      role="alert"
      tabindex="-1"
    >
      {{ error }}
      <ul
        v-if="rows.some((r) => Object.keys(fieldErrors[r.entityId] || {}).length)"
        class="request-schedule-error-links"
      >
        <template v-for="row in rows" :key="row.entityId">
          <li v-for="(message, field) in fieldErrors[row.entityId] || {}" :key="field">
            <button
              type="button"
              class="button subtle"
              @click="focusField(row.entityId, String(field))"
            >
              {{ row.title }}: {{ message }}
            </button>
          </li>
        </template>
      </ul>
    </div>
    <button v-if="request && !view && !loading" class="button secondary" @click="load">
      다시 불러오기
    </button>
    <template v-if="view && request">
      <section class="request-schedule-context" aria-label="조직 관리자 안내문">
        <h2>조직 관리자 안내문</h2>
        <p class="preserve-lines">{{ request.message || '필요한 자격의 일정을 작성해 주세요.' }}</p>
        <p class="muted">작성 기한 {{ request.dueOn }} · 계획 대상 {{ rows.length }}개</p>
      </section>
      <p v-if="view.errors.length" class="error-message preserve-lines">
        {{ view.errors.join('\n') }}
      </p>
      <section v-if="view.readOnly" class="request-schedule-completed" aria-label="확정된 계획">
        <h2 id="request-schedule-completed" tabindex="-1">
          {{ request.closed ? '종료된 요청' : '전체 계획 확정 완료' }}
        </h2>
        <p>당시 확정한 자격 기준과 일정을 유지합니다.</p>
        <article v-for="row in rows" :key="row.entityId" class="request-schedule-read-row">
          <strong>{{ row.title }}</strong
          ><span>{{
            releaseVersionLabel(row.plan?.qualificationPolicySnapshot || row.qualification)
          }}</span
          ><span
            >{{ row.startOn || '기존 진행 근거'
            }}<template v-if="row.endOn"> ~ {{ row.endOn }}</template></span
          ><RouterLink
            v-if="row.plan?.assignmentId || row.assignmentId"
            :to="`/qualifications/${row.plan?.assignmentId || row.assignmentId}`"
            >학습·평가로 이동</RouterLink
          ><RouterLink v-if="row.plan" :to="`/plans/${row.plan.id}`">계획 상세</RouterLink>
        </article>
      </section>
      <template v-else-if="review">
        <section class="request-schedule-review" aria-label="전체 계획 최종 확인">
          <h2 id="request-schedule-review-title" tabindex="-1">전체 계획 최종 확인</h2>
          <p>
            {{
              review.noAdditional
                ? '모든 대상이 취득 또는 진행 중입니다. 추가 계획 대상 없이 완료합니다.'
                : '아래 일정을 한 번에 확정하고 학습·평가를 시작합니다.'
            }}
          </p>
          <p class="muted">
            확정 기준일 {{ review.serverDate }} · 자격별 버전과 기한을 함께 보존합니다.
          </p>
          <article
            v-for="row in review.rows.filter((r) => r.selected || review?.noAdditional)"
            :key="row.entityId"
            class="request-schedule-read-row"
          >
            <strong>{{ row.title }} {{ releaseVersionLabel(row.qualification) }}</strong
            ><span>{{ row.startOn }} ~ {{ row.endOn }}</span
            ><span v-if="row.window"
              >확정 후 {{ row.window.months }}개월 · {{ row.window.deadlineOn }} 이내</span
            ><span v-else>{{ row.reason }}</span>
            <p v-if="row.goal" class="preserve-lines">{{ row.goal }}</p>
          </article>
        </section>
        <ActionBar
          ><button
            class="button secondary"
            :disabled="busy || !!pendingComplete"
            @click="editReview"
          >
            일정 수정</button
          ><button class="button primary" :disabled="busy" @click="complete">
            {{
              pendingComplete
                ? '전체 확정 재시도'
                : review.noAdditional
                  ? '추가 계획 대상 없음 확인'
                  : '전체 계획 확정'
            }}
          </button></ActionBar
        >
      </template>
      <template v-else>
        <section class="request-schedule-bulk" aria-label="전체 일정 설정">
          <h2>전체 일정 설정</h2>
          <p class="muted">
            편집 가능한 자격에만 적용합니다. 자격별 완료 기한을 넘으면 일괄 적용하지 않습니다.
          </p>
          <div class="request-schedule-bulk-fields">
            <label class="field"
              ><span>일괄 시작일</span
              ><input v-model="bulk.startOn" type="date" :disabled="locked || saving" /></label
            ><label class="field"
              ><span>일괄 완료일</span
              ><input v-model="bulk.endOn" type="date" :disabled="locked || saving" /></label
            ><button
              class="button secondary"
              :disabled="locked || saving || conflict || !rows.some((r) => r.editable)"
              @click="applyBulk"
            >
              전체 적용
            </button>
          </div>
        </section>
        <section aria-label="자격별 일정" class="request-schedule-rows">
          <article
            v-for="row in rows"
            :key="row.entityId"
            :id="`request-schedule-${row.entityId}`"
            class="request-schedule-row"
            tabindex="-1"
            :aria-label="`${row.title} 일정`"
          >
            <header>
              <div>
                <h2>{{ row.title }}</h2>
                <span class="muted"
                  >{{ releaseVersionLabel(row.previousQualification || row.qualification) }} ·
                  {{ row.required ? '필요자격' : '추가 자격' }}</span
                >
              </div>
              <StatusBadge
                :status="
                  row.status === 'blocked'
                    ? '확인 필요'
                    : row.status === 'valid'
                      ? '유효 인증'
                      : row.status === 'planned'
                        ? '계획 확정'
                        : row.plan
                          ? '작성 중'
                          : '계획 미작성'
                "
              />
            </header>
            <p v-if="!row.editable" :class="row.status === 'blocked' ? 'error-message' : 'muted'">
              {{ row.reason }}
            </p>
            <template v-if="row.editable && values[row.entityId]">
              <p v-if="row.window" class="request-schedule-window">
                확정 후 최대 <strong>{{ row.window.months }}개월</strong> · 오늘 확정하면
                <strong>{{ row.window.deadlineOn }}</strong
                >까지 완료
              </p>
              <div v-if="row.criteriaChanged" class="request-schedule-criteria">
                <p>
                  자격 기준이 {{ releaseVersionLabel(row.previousQualification) }}에서
                  {{ releaseVersionLabel(row.qualification) }}으로 변경되었습니다. 일정·목표는
                  유지됩니다.
                </p>
                <button
                  :id="`request-schedule-${row.entityId}-criteria`"
                  class="button secondary"
                  :disabled="locked || saving"
                  @click="acceptCriteria(row)"
                >
                  최신 기준 확인
                </button>
              </div>
              <div class="request-schedule-dates">
                <label class="field"
                  ><span>시작일</span
                  ><input
                    aria-label="시작일"
                    :id="`request-schedule-${row.entityId}-startOn`"
                    v-model="values[row.entityId]!.startOn"
                    type="date"
                    :disabled="locked"
                    :aria-invalid="!!fieldErrors[row.entityId]?.startOn"
                    :aria-describedby="`request-schedule-${row.entityId}-start-error`"
                    @input="changed(row.entityId)"
                  /><span
                    :id="`request-schedule-${row.entityId}-start-error`"
                    class="field-error"
                    >{{ fieldErrors[row.entityId]?.startOn }}</span
                  ></label
                ><label class="field"
                  ><span>완료일</span
                  ><input
                    aria-label="완료일"
                    :id="`request-schedule-${row.entityId}-endOn`"
                    v-model="values[row.entityId]!.endOn"
                    type="date"
                    :max="row.window?.deadlineOn"
                    :disabled="locked"
                    :aria-invalid="!!fieldErrors[row.entityId]?.endOn"
                    :aria-describedby="`request-schedule-${row.entityId}-end-error`"
                    @input="changed(row.entityId)"
                  /><span :id="`request-schedule-${row.entityId}-end-error`" class="field-error">{{
                    fieldErrors[row.entityId]?.endOn
                  }}</span></label
                >
              </div>
              <details>
                <summary>목표 및 포함 인증Set {{ row.courseTitles.length }}개</summary>
                <label class="field"
                  ><span>학습 목표(선택)</span
                  ><textarea
                    v-model="values[row.entityId]!.goal"
                    maxlength="2000"
                    rows="2"
                    :disabled="locked"
                    @input="changed(row.entityId)"
                  />
                </label>
                <ul>
                  <li v-for="(title, i) in row.courseTitles" :key="i">{{ title }}</li>
                </ul>
              </details>
              <button
                v-if="!row.required"
                class="button subtle"
                :disabled="locked || saving"
                @click="remove(row)"
              >
                추가 계획 제외
              </button>
            </template>
            <p v-if="fieldErrors[row.entityId]?.criteria" class="field-error">
              {{ fieldErrors[row.entityId]?.criteria }}
            </p>
            <PreviousPlanSchedule v-if="row.plan?.previousSchedule" :plan="row.plan" />
            <RouterLink v-if="row.plan?.status === 'completed'" :to="`/plans/${row.plan.id}`"
              >확정 계획 보기</RouterLink
            >
          </article>
        </section>
        <section
          v-if="extras.length"
          class="request-schedule-extras"
          aria-label="추가할 수 있는 자격"
        >
          <h2>추가할 수 있는 자격</h2>
          <div v-for="row in extras" :key="row.entityId">
            <span>{{ row.title }} {{ releaseVersionLabel(row.qualification) }}</span
            ><button class="button secondary" :disabled="locked || saving" @click="add(row)">
              계획에 추가
            </button>
          </div>
        </section>
        <ActionBar
          ><span role="status">{{ saving ? '저장 중' : saveStatus }}</span
          ><button
            v-if="conflict"
            class="button secondary"
            :disabled="busy || saving"
            @click="recover"
          >
            변경된 저장 내용 확인</button
          ><button
            v-else-if="error && pendingSave"
            class="button secondary"
            :disabled="busy || saving"
            @click="flush().catch(() => {})"
          >
            저장 재시도</button
          ><button class="button primary" :disabled="locked || saving || conflict" @click="preview">
            전체 계획 확인
          </button></ActionBar
        >
      </template>
    </template>
  </main>
</template>
