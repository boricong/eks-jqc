<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { planErrors, kstDate, type PersonalPlan } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import { useSavedDraft } from '../composables/useSavedDraft';
import LearnerNav from '../components/LearnerNav.vue';
import RequiredQualifications from '../components/RequiredQualifications.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { ApiError } from '../api';
import { useProcessContext } from '../composables/useProcessContext';
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
useProcessContext(() =>
  current.value?.status === 'completed'
    ? 'plan-completed'
    : route.params.id
      ? `plan-${step.value}`
      : 'plan-1',
);
const eligible = computed(() =>
  store.data.qualifications.filter(
    (q) =>
      store.data.requiredQualifications?.items.some(
        (i) => i.qualificationId === q.id && i.canStart,
      ) &&
      request.value?.organizationId === store.actor.organizationId &&
      request.value.targets?.some((t) => t.entityId === q.entityId),
  ),
);
const policyErrors = computed(
  () => store.data.planEligibility.find((p) => p.planId === current.value?.id)?.reasons || [],
);
const selection = ref('');
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
      result.targetOn = '목표 인증일은 모든 과정의 평가 예정일 이후여야 합니다.';
  });
  return result;
}
function goalErrors(): Record<string, string> {
  const result: Record<string, string> = {};
  form.value?.schedules.forEach((s) => {
    if (!s.goal.trim())
      result[`${s.courseId}.goal`] =
        `${store.course(s.courseId).title}: 학습 목표를 입력해 주세요.`;
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
  const goals = target >= 4 ? goalErrors() : {};
  if (Object.keys(goals).length) {
    step.value = 3;
    fieldErrors.value = goals;
    error.value = '모든 과정의 학습 목표를 입력해 주세요.';
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
  busy.value = true;
  error.value = '';
  try {
    if (!request.value || !eligible.value.some((q) => q.id === selection.value))
      throw new Error('취득할 자격을 선택해 주세요.');
    const result = await store.command('/plans', {
      requestId: request.value!.id,
      qualificationId: selection.value,
    });
    busy.value = false;
    await router.push(`/plans/${result.id}`);
  } catch (err) {
    handleError(err);
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
      step.value = Object.keys(schedules).length ? 2 : 3;
      fieldErrors.value = Object.keys(schedules).length ? schedules : goalErrors();
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
  if (!window.confirm('현재 입력을 버리고 서버의 계획을 다시 불러올까요?')) return;
  await store.refresh();
  load();
}
async function leave() {
  if (busy.value || initializing.value) return false;
  if (current.value?.status === 'completed' && draft.dirty.value)
    return window.confirm('저장하지 않은 계획 변경을 버리고 이동할까요?');
  return draft.canLeave();
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <div class="container page">
    <LearnerNav />
    <RequiredQualifications v-if="!current" />
    <div v-if="current && policyErrors.length" class="error-message" role="alert">
      {{ policyErrors.join(' · ') }}<RouterLink to="/plans">내 계획에서 현재 요청 확인</RouterLink>
    </div>
    <div class="page-heading">
      <h1>{{ current ? '개인 인증 계획' : '내 계획' }}</h1>
      <span>{{ store.actor.name }}</span>
    </div>
    <p v-if="error || draft.error.value" class="error-message preserve-lines" role="alert">
      {{ error || draft.error.value }}
    </p>
    <div v-if="!draft.terminal.value && (draft.error.value || (error && form))" class="actions">
      <button class="button secondary" @click="draft.flush().catch(() => {})">저장 다시 시도</button
      ><button class="button secondary" @click="reload">다시 불러오기</button>
    </div>
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
      <RouterLink to="/plans" class="back-link">내 계획으로</RouterLink>
      <div class="panel plan-context">
        <h2>{{ store.qualification(current.qualificationId).title }}</h2>
        <p class="muted">
          v{{ store.qualification(current.qualificationId).version }} · 계획 작성 기한
          {{ requests.find((r) => r.id === current!.requestId)?.dueOn }} ·
          {{ current.status === 'completed' ? '계획 완료' : draft.status.value }}
        </p>
        <p>{{ store.qualification(current.qualificationId).description }}</p>
      </div>
      <nav class="plan-steps" aria-label="계획 작성 단계">
        <button
          v-for="(label, i) in ['자격 선택', '일정 수립', '학습 목표', '최종 확인']"
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
        <p>{{ store.qualification(current.qualificationId).title }}</p>
        <p class="muted">
          필수 {{ form.schedules.length }}과정 · 이 계획의 자격과 기준 버전은 고정됩니다.
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
            @input="clearField('targetOn')"
          /><small v-if="fieldErrors.targetOn" class="field-error" role="alert">{{
            fieldErrors.targetOn
          }}</small></label
        >
        <div class="schedule-table">
          <div class="schedule-header" aria-hidden="true">
            <span>과정</span><span>학습 시작 예정일</span><span>학습 완료 예정일</span
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
                @input="clearField(`${s.courseId}.learningStart`)"
              /><small
                v-if="fieldErrors[`${s.courseId}.learningStart`]"
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
                @input="clearField(`${s.courseId}.learningEnd`)"
              /><small
                v-if="fieldErrors[`${s.courseId}.learningEnd`]"
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
                @input="clearField(`${s.courseId}.assessmentOn`)"
              /><small
                v-if="fieldErrors[`${s.courseId}.assessmentOn`]"
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
        <button class="button primary" @click="moveTo(3)">학습 목표 설정</button>
      </section>
      <section v-else-if="step === 3" class="panel editor-panel">
        <h2>학습 목표 설정</h2>
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
            @input="clearField(`${s.courseId}.goal`)"
          /><small v-if="fieldErrors[`${s.courseId}.goal`]" class="field-error" role="alert">{{
            fieldErrors[`${s.courseId}.goal`]
          }}</small></label
        ><button class="button primary" @click="moveTo(4)">최종 확인</button>
      </section>
      <section v-else class="panel editor-panel">
        <h2>{{ current.status === 'completed' ? '계획 내용' : '계획 최종 확인' }}</h2>
        <div
          v-if="current.status === 'draft' && store.data.requiredQualifications"
          class="notice-body"
        >
          <p
            v-if="
              current.policyRevision &&
              current.policyRevision !== store.data.requiredQualifications.revision
            "
          >
            작성 이후 조직 기준 정보가 변경되었습니다. 아래의 현재 소속·필수 자격과 적용 버전을 다시
            확인해 주세요. 입력한 일정과 목표는 보존됩니다.
          </p>
          <p>
            현재 소속 ·
            {{ store.data.requiredQualifications.organizationPath.map((p) => p.name).join(' › ') }}
          </p>
          <p>
            현재 필수 자격 ·
            {{
              store.data.requiredQualifications.items
                .map((i) => `${i.title} v${i.version}`)
                .join(' · ') || '없음 또는 미설정'
            }}
          </p>
          <p>
            이 계획 · {{ store.qualification(current.qualificationId).title }} v{{
              store.qualification(current.qualificationId).version
            }}
          </p>
        </div>
        <p>목표 인증일 {{ form.targetOn || '미정' }}</p>
        <div v-for="s in form.schedules" :key="s.courseId" class="plan-course">
          <h3>{{ store.course(s.courseId).title }}</h3>
          <p>
            학습 {{ s.learningStart || '미정' }} ~ {{ s.learningEnd || '미정' }} · 평가
            {{ s.assessmentOn || '미정' }}
          </p>
          <p class="preserve-lines">{{ s.goal || '학습 목표를 입력해 주세요.' }}</p>
        </div>
        <p class="muted">현재 운영정책에 따라 결재를 생략하고 계획을 완료합니다.</p>
        <ul v-if="planErrors(form).length" class="validation-list">
          <li v-for="message in planErrors(form)" :key="message">{{ message }}</li>
        </ul>
        <button
          v-if="current.status === 'draft'"
          class="button primary"
          :disabled="
            busy || !!planErrors(form).length || !!policyErrors.length || draft.conflict.value
          "
          @click="complete"
        >
          계획 완료</button
        ><RouterLink v-else :to="`/qualifications/${current.assignmentId}`" class="button secondary"
          >학습·평가로 이동</RouterLink
        >
      </section>
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
            :disabled="busy"
            @change="
              router.replace({ query: { request: ($event.target as HTMLSelectElement).value } })
            "
          >
            <option v-for="r in requests" :key="r.id" :value="r.id">
              작성 기한 {{ r.dueOn }} · {{ r.message || '개인 인증 계획 작성' }}
            </option>
          </select></label
        >
        <div class="inline-form">
          <label class="field"
            ><span>취득할 자격</span
            ><select aria-label="취득할 자격" v-model="selection" :disabled="busy">
              <option value="">자격 선택</option>
              <option v-for="q in eligible" :key="q.id" :value="q.id">
                {{ q.title }} · v{{ q.version }}
              </option>
            </select></label
          ><button
            class="button primary"
            :disabled="busy || !eligible.some((q) => q.id === selection)"
            @click="create"
          >
            계획 시작
          </button>
        </div>
        <p v-if="!eligible.length" class="muted">
          새로 계획할 수 있는 자격이 없습니다. 아래의 기존 계획을 이어 쓰거나 조직 관리자에게 추가
          기준을 확인해 주세요.
        </p>
      </section>
      <section v-else class="panel empty-state">
        <h2>계획 수립 요청을 기다리고 있습니다.</h2>
        <p>조직 관리자가 대상자를 확인하고 요청하면 자격을 선택할 수 있습니다.</p>
      </section>
      <div class="qualification-list">
        <div v-for="p in plans" :key="p.id" class="qualification-row plan-list-row">
          <RouterLink :to="`/plans/${p.id}`" class="plan-list-link"
            ><span class="qualification-info"
              ><strong>{{ store.qualification(p.qualificationId).title }}</strong
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
            :aria-label="`${store.qualification(p.qualificationId).title} 계획 삭제`"
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
          <strong>{{ store.qualification(deleting.qualificationId).title }}</strong>
        </p>
        <p>
          이 계획의 일정과 학습 목표를 업무 목록에서 삭제합니다. 기존 계획 수립 요청은 유지되며
          자격을 다시 선택해 계획을 작성할 수 있습니다.
        </p>
        <p class="muted">
          {{ deleting.schedules.length }}개 과정의 일정·목표 · 목표 인증일
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
