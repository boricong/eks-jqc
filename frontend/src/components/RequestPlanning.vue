<script setup lang="ts">
import { releaseVersionLabel } from '@eks/contracts';
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import type { PlanningRequest, PlanningRequestView, PlanningCandidate } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import { ApiError } from '../api';
import StatusBadge from './StatusBadge.vue';
import { confirmAction } from '../composables/useConfirmation';
const props = defineProps<{
  request: PlanningRequest;
  view: PlanningRequestView;
  disabled?: boolean;
}>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const store = useDemo(),
  busy = ref(false),
  error = ref('');
const pending = ref<{ path: string; body: Record<string, unknown>; method: string } | null>(null);
const locked = computed(() => busy.value || props.disabled);
const rows = computed(() => props.view.candidates.filter((c) => c.selected));
const otherStatus = computed(() =>
  props.view.candidates.filter(
    (c) => !c.selected && ['valid', 'planned', 'blocked'].includes(c.status),
  ),
);
const labels = {
  available: '계획 미작성',
  draft: '작성 중',
  planned: '계획 확정',
  valid: '유효 인증',
  blocked: '확인 필요',
};
watch(busy, (value) => emit('busy', value));
onBeforeUnmount(() => emit('busy', false));
watch(
  () => props.request.id,
  () => {
    error.value = '';
    pending.value = null;
  },
);
async function run() {
  if (locked.value || !pending.value) return;
  const actor = store.actorId,
    id = props.request.id;
  busy.value = true;
  error.value = '';
  try {
    const command = pending.value;
    await store.command(command.path, command.body, command.method);
    if (actor === store.actorId && id === props.request.id) pending.value = null;
  } catch (e) {
    if (actor === store.actorId && id === props.request.id) {
      error.value = (e as Error).message;
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.value = null;
    }
  } finally {
    busy.value = false;
  }
}
async function remove(c: PlanningCandidate) {
  if (locked.value || pending.value) return;
  const actor = store.actorId,
    id = props.request.id,
    revision = props.request.revision;
  if (!(await confirmAction(`${c.title}을 이번 요청에서 제외할까요?`, '요청에서 제외'))) return;
  if (actor !== store.actorId || id !== props.request.id || revision !== props.request.revision)
    return;
  pending.value = {
    path: `/planning-requests/${id}/selection`,
    method: 'PUT',
    body: {
      revision,
      entityIds: props.request.selections
        .filter((t) => t.entityId !== c.entityId)
        .map((t) => t.entityId),
    },
  };
  await run();
}
async function reload() {
  if (locked.value) return;
  const actor = store.actorId,
    id = props.request.id;
  busy.value = true;
  try {
    await store.refresh();
    if (actor === store.actorId && id === props.request.id) error.value = '';
  } catch (e) {
    if (actor === store.actorId && id === props.request.id) error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function complete() {
  if (locked.value || pending.value || !props.view.canComplete) return;
  const actor = store.actorId,
    id = props.request.id,
    revision = props.request.revision;
  if (
    !(await confirmAction(
      props.view.noAdditional
        ? '이번 요청의 모든 자격을 취득했거나 확정 계획으로 진행 중입니다. 추가 계획 대상 없이 완료할까요?'
        : '필수 및 선택 자격의 계획을 확인했습니다. 이번 요청의 계획 수립을 완료할까요?',
      '계획 수립 완료',
    ))
  )
    return;
  if (actor !== store.actorId || id !== props.request.id || revision !== props.request.revision)
    return;
  pending.value = {
    path: `/planning-requests/${id}/complete`,
    method: 'POST',
    body: { revision, confirmNoAdditional: props.view.noAdditional },
  };
  await run();
}
onBeforeRouteLeave(() => !busy.value);
onBeforeRouteUpdate(() => !busy.value);
</script>
<template>
  <section class="request-planning" aria-label="이번 요청의 계획 현황">
    <div class="section-heading">
      <h3>이번 요청의 계획 현황</h3>
      <StatusBadge
        :status="request.completion ? 'complete' : request.closed ? 'excluded' : 'draft'"
        :label="view.stage"
      />
      <span v-if="request.completion" class="muted"
        >완료
        {{
          new Date(request.completion.date).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
        }}</span
      >
    </div>
    <p v-if="request.mode === 'organization_required'" class="muted request-planning-intro">
      요청된 필요자격 전체의 계획을 수립해 주세요.
    </p>
    <p v-if="request.closed" class="muted">요청 종료 · {{ request.closed.reason }}</p>

    <p v-if="!rows.length" class="muted">
      {{
        request.completion ? '추가 계획 대상 없이 완료했습니다.' : '아직 시작한 계획이 없습니다.'
      }}
    </p>
    <template v-for="(group, index) in [rows, otherStatus]" :key="index">
      <h4 v-if="index && group.length">보유·진행 및 확인할 자격</h4>
      <div v-for="c in group" :key="c.entityId" class="planning-choice-row">
        <div class="planning-choice-title">
          <span>
            <strong>{{ c.title }}</strong
            ><span v-if="request.requirementSnapshot" class="muted planning-choice-source">
              {{
                request.requirementSnapshot.sources
                  .find((s) => s.entityId === c.entityId)
                  ?.organizations.map((o) => o.name)
                  .join(', ')
              }}
              지정</span
            >
            <small>{{ releaseVersionLabel(c) }}</small>
          </span>
        </div>
        <div class="planning-choice-state">
          <StatusBadge
            :status="
              c.status === 'valid'
                ? 'certified'
                : c.status === 'planned'
                  ? 'complete'
                  : c.status === 'blocked'
                    ? 'excluded'
                    : 'draft'
            "
            :label="labels[c.status]"
          />
          <p>
            {{ c.status === 'available' ? '취득할 자격에서 선택해 계획을 시작하세요.' : c.reason }}
          </p>
        </div>
        <RouterLink
          v-if="c.planId && (c.selected || c.status === 'planned')"
          :to="{ path: `/plans/${c.planId}`, query: { request: request.id } }"
          class="button secondary small"
          >{{
            ['planned', 'valid'].includes(c.status) ? '계획 보기' : '계획 이어 쓰기'
          }}</RouterLink
        >
        <RouterLink
          v-else-if="c.assignmentId && !c.certificationId"
          :to="`/qualifications/${c.assignmentId}`"
          class="button secondary small"
          >이어서 진행</RouterLink
        >
        <RouterLink
          v-else-if="c.certificationId"
          :to="`/certifications/${c.assignmentId || store.data.assignments.find((a) => a.certification?.id === c.certificationId)?.id}`"
          class="button secondary small"
          >인증서 보기</RouterLink
        >
        <button
          v-else-if="
            request.mode !== 'organization_required' &&
            c.selected &&
            !request.completion &&
            !request.closed &&
            !c.planId
          "
          class="button ghost small"
          :disabled="locked || !!pending"
          @click="remove(c)"
        >
          요청에서 제외
        </button>
      </div>
    </template>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>
    <ul
      v-if="!request.completion && !request.closed && view.errors.length"
      class="request-planning-help"
    >
      <li v-for="message in view.errors" :key="message">{{ message }}</li>
    </ul>
    <div class="request-planning-actions">
      <span v-if="busy" class="muted" role="status">저장 중</span>
      <button v-if="pending && !busy" class="button secondary" :disabled="locked" @click="run">
        다시 시도
      </button>
      <button v-if="error" class="button secondary" :disabled="locked" @click="reload">
        다시 불러오기
      </button>
      <button
        v-if="!request.completion && !request.closed"
        class="button primary"
        :disabled="locked || !!pending || !view.canComplete"
        @click="complete"
      >
        계획 수립 완료
      </button>
    </div>
  </section>
</template>
<style scoped>
.request-planning {
  margin: 24px 0;
  min-width: 0;
  border-top: 1px solid var(--line);
  padding-top: 24px;
}
.request-planning .section-heading {
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}
.request-planning .section-heading h3 {
  margin: 0 auto 0 0;
}
.request-planning-intro {
  font-size: var(--text-caption);
  margin: 0 0 16px;
}
.planning-choice-source {
  display: block;
  margin-top: 6px;
  font-size: var(--text-caption);
}
.planning-choice-state {
  display: grid;
  justify-items: start;
  gap: 8px;
  min-width: 0;
}
h3 {
  font-size: 18px;
}
h4 {
  font-size: 14px;
  font-weight: 600;
  margin: 24px 0 8px;
}
.planning-choice-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  border-block: 1px solid var(--line);
  padding: 16px 0;
}
.planning-choice-row + .planning-choice-row {
  border-top: 0;
}
.planning-choice-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  min-width: 0;
}
.planning-choice-title span {
  min-width: 0;
  overflow-wrap: anywhere;
}
strong {
  font-size: 14px;
  font-weight: 500;
}
small {
  display: block;
  font-size: 13px;
  color: var(--ink-secondary);
  margin-top: 6px;
}
.planning-choice-row p {
  font-size: 13px;
  margin: 0;
  overflow-wrap: anywhere;
}
.request-planning-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
  justify-content: flex-end;
}
.request-planning-help {
  font-size: 13px;
  margin: 12px 0;
  padding-left: 20px;
}
@media (max-width: 767px) {
  .planning-choice-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .planning-choice-row .button {
    justify-self: start;
  }
  .request-planning-actions .button {
    min-height: 44px;
  }
}
</style>
