<script setup lang="ts">
import { releaseVersionLabel } from '@eks/contracts';
import PreviousPlanSchedule from './PreviousPlanSchedule.vue';
import { api, ApiError } from '../api';
import StatusBadge from './StatusBadge.vue';
import type { PlanningRequestPreview, PlanningRequest } from '@eks/contracts';
import { confirmAction } from '../composables/useConfirmation';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { kstDate, defaultPlanningDueOn, type Enrollment } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import CompactTabs from './CompactTabs.vue';
import AppDialog from './AppDialog.vue';
import '../styles/planning.css';
const store = useDemo(),
  open = ref(false),
  busy = ref(false),
  error = ref(''),
  filter = ref('all'),
  search = ref(''),
  dueEdited = ref(false),
  detailsOpen = ref(false),
  detailId = ref('');
const requestPreview = ref<PlanningRequestPreview>(),
  replaceIds = ref<string[]>([]),
  closeTarget = ref<PlanningRequest>(),
  closeReason = ref('');
const selectedType = ref<'auditee' | 'auditor'>('auditee');
const form = ref({ learnerIds: [] as string[], dueOn: '', message: '' });
const context = computed(() => `${store.actorId}:${store.managementLv1}:${store.fullManagement}`);
let disposed = false;
let detailFocus: HTMLElement | null = null;
let detailScroll = 0;
let detailContext = '';
const readiness = (id: string) =>
  store.data.planningReadiness.find(
    (r) => r.learnerId === id && r.qualificationType === selectedType.value,
  );
const learners = computed(() =>
  store.data.users.filter(
    (u) =>
      u.lv1OrganizationId === store.managementLv1 &&
      (u.roles.includes(selectedType.value === 'auditor' ? 'evaluator' : 'learner') ||
        (selectedType.value === 'auditor' &&
          store.data.planningRequests.some(
            (r) => r.learnerId === u.id && r.qualificationType === 'auditor',
          ))),
  ),
);
type Learner = (typeof learners.value)[number];
const organizationName = (u: Learner) => u.organizationPath.at(-1)?.name || '소속 미정';
const organizationPath = (u: Learner) => u.organizationPath.map((o) => o.name).join(' › ');
function requestLabel(u: Learner) {
  if (readiness(u.id)?.canRequest) return '요청 가능';
  if (!u.organizationActive) return '소속 중지';
  if (u.certificationEligibility === 'hold') return '대상자 Hold';
  return '확인 필요';
}
const visibleLearners = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('ko-KR');
  return learners.value.filter((u) =>
    `${u.name} ${organizationPath(u)}`.toLocaleLowerCase('ko-KR').includes(query),
  );
});
const ready = computed(() => learners.value.some((u) => readiness(u.id)?.canRequest));
function phase(e: Enrollment) {
  if (selectedType.value === 'auditor')
    return e.completion ? '수료' : e.checklist?.items.length ? '학습 확인 중' : '학습 미확인';
  return e.completion
    ? '수료'
    : [e.objective, e.practical].includes('passed')
      ? '일부 통과'
      : e.history.length || Object.keys(e.activeAttempts).length
        ? '평가 중'
        : '평가 전';
}
const allRows = computed(() =>
  learners.value.map((user) => {
    const requests = store.data.planningRequests
      .filter((r) => r.learnerId === user.id && r.qualificationType === selectedType.value)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const summaries = store.data.requestProgress.filter(
      (p) => p.learnerId === user.id && requests.some((r) => r.id === p.id),
    );
    const plans = store.data.plans.filter(
      (p) =>
        p.learnerId === user.id &&
        store.qualification(p.qualificationId).qualificationType === selectedType.value,
    );
    const assignments = store.data.assignments.filter(
      (a) =>
        !a.renewalBatchId &&
        a.learnerId === user.id &&
        store.qualification(a.qualificationId).qualificationType === selectedType.value &&
        !a.excludedReason,
    );
    const stage = summaries.find((p) => p.id === requests[0]?.id)?.stage || '미발송';
    const unfinished = requests.filter(
      (r) =>
        !r.closed &&
        !['계획 완료', '추가 계획 대상 없음'].includes(
          summaries.find((p) => p.id === r.id)?.stage || '',
        ),
    );
    const late =
      unfinished.some((r) => r.dueOn < kstDate()) ||
      plans.some(
        (p) =>
          !(p.status === 'draft' && requests.find((r) => r.id === p.requestId)?.closed) &&
          p.endOn &&
          p.endOn < kstDate() &&
          (!p.assignmentId || assignments.some((a) => a.id === p.assignmentId && !a.certifiedAt)),
      );
    return {
      user,
      requests,
      summaries,
      plans,
      assignments,
      stage,
      late,
      unfinished: unfinished.length,
    };
  }),
);
const rows = computed(() =>
  allRows.value.filter(
    (r) =>
      filter.value === 'all' ||
      filter.value === r.stage ||
      (filter.value === 'late' && r.late) ||
      r.assignments.some((a) => a.enrollments.some((e) => phase(e) === filter.value)),
  ),
);
const detail = computed(() => allRows.value.find((r) => r.user.id === detailId.value));
function showDetail(id: string, event: MouseEvent) {
  if (open.value) return;
  detailFocus = event.currentTarget as HTMLElement;
  detailScroll = window.scrollY;
  detailContext = context.value;
  detailId.value = id;
  detailsOpen.value = true;
}
function restoreDetailFocus() {
  if (disposed || detailContext !== context.value) return;
  window.scrollTo({ top: detailScroll });
  if (detailFocus?.isConnected) detailFocus.focus({ preventScroll: true });
  detailId.value = '';
}
watch(detail, (value) => {
  if (!value) detailsOpen.value = false;
});
watch(selectedType, () => {
  form.value.learnerIds = [];
  search.value = '';
  error.value = '';
  filter.value = 'all';
  detailsOpen.value = false;
});
watch(context, () => {
  closeTarget.value = undefined;
  closeReason.value = '';
  requestPreview.value = undefined;
  replaceIds.value = [];
  detailFocus = null;
  detailId.value = '';
  detailsOpen.value = false;
  open.value = false;
  search.value = '';
  error.value = '';
  filter.value = 'all';
  form.value = { learnerIds: [], dueOn: '', message: '' };
});
onBeforeUnmount(() => {
  disposed = true;
});
function startRequest() {
  if (busy.value || detailsOpen.value) return;
  requestPreview.value = undefined;
  replaceIds.value = [];
  form.value = {
    learnerIds: [],
    dueOn: defaultPlanningDueOn(store.data.serverDate + 'T00:00:00+09:00'),
    message: '',
  };
  search.value = '';
  dueEdited.value = false;
  error.value = '';
  open.value = true;
}
async function send() {
  if (busy.value || !form.value.learnerIds.length) return;
  if (!form.value.dueOn) {
    error.value = '계획 작성 기한을 입력해 주세요.';
    return;
  }
  const scope = context.value;
  busy.value = true;
  error.value = '';
  try {
    if (!requestPreview.value) {
      const result = await api<PlanningRequestPreview>(
        store.managementPath('/planning-requests/preview'),
        { method: 'POST', body: JSON.stringify({ learnerIds: [...form.value.learnerIds] }) },
      );
      if (!disposed && scope === context.value) requestPreview.value = result;
      return;
    }
    if (requestPreview.value.rows.some((r) => r.status !== 'ready')) {
      error.value = '보류·제외 대상자를 선택 해제하고 다시 확인해 주세요.';
      return;
    }
    await store.command('/planning-requests', {
      stateRevision: requestPreview.value.stateRevision,
      organizationRevision: requestPreview.value.organizationRevision,
      replaceRequestIds: replaceIds.value,
      qualificationType: selectedType.value,
      ...form.value,
      learnerIds: [...form.value.learnerIds],
      ...(dueEdited.value ? {} : { dueOn: undefined }),
    });
    if (disposed || scope !== context.value) return;
    open.value = false;
    store.notify('대상자별 계획 수립 요청을 저장했습니다.');
  } catch (e) {
    if (!disposed && scope === context.value) {
      error.value = (e as Error).message;
      if (e instanceof ApiError && e.status === 409) requestPreview.value = undefined;
    }
  } finally {
    busy.value = false;
  }
}
watch(
  () => form.value.learnerIds.slice(),
  () => {
    requestPreview.value = undefined;
    replaceIds.value = [];
  },
);
async function closeRequest() {
  if (!closeTarget.value || busy.value || !closeReason.value.trim()) return;
  const scope = context.value;
  busy.value = true;
  error.value = '';
  try {
    await store.command(store.managementPath(`/planning-requests/${closeTarget.value.id}/close`), {
      revision: closeTarget.value.revision,
      reason: closeReason.value,
    });
    if (disposed || scope !== context.value) return;
    closeTarget.value = undefined;
    closeReason.value = '';
  } catch (e) {
    if (!disposed && scope === context.value) error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function leave() {
  return (
    !busy.value &&
    ((!(open.value && form.value.learnerIds.length) &&
      !(closeTarget.value && closeReason.value.trim())) ||
      (await confirmAction('작성 중인 요청을 취소하고 이동할까요?', '변경 버리고 이동')))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <section
    id="planning-type-panel"
    class="panel planning-panel"
    aria-labelledby="planning-requests-heading"
  >
    <div class="planning-toolbar">
      <h2 id="planning-requests-heading">계획 요청 현황</h2>
      <label class="planning-filter"
        >계획·진행 필터<select v-model="filter" aria-label="요청 현황 필터">
          <option value="all">전체 대상자</option>
          <option
            v-for="state in [
              '미발송',
              '미착수',
              '자격 준비 대기',
              '확인 필요',
              '추가 계획 대상 없음',
              '작성 중',
              '계획 완료',
              '요청 종료',
              '평가 전',
              '평가 중',
              '일부 통과',
              '수료',
            ]"
            :key="state"
          >
            {{ state }}
          </option>
          <option value="late">목표일·기한 경과</option>
        </select></label
      >
      <button class="button primary" :disabled="busy || !ready" @click="startRequest">
        계획 수립 요청
      </button>
    </div>
    <p v-if="!ready" class="notice-body">
      요청할 대상이 없습니다. 아래 대상자의 소속·취득 대상자 상태를 확인해 주세요.
    </p>
    <div class="table-panel planning-target-table">
      <table aria-label="계획 요청 대상자 현황">
        <colgroup>
          <col class="planning-name-col" />
          <col class="planning-org-col" />
          <col class="planning-ready-col" />
          <col />
          <col class="planning-date-col" />
          <col class="planning-detail-col" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">이름</th>
            <th scope="col">소속</th>
            <th scope="col">요청 가능</th>
            <th scope="col">최근 요청 상태</th>
            <th scope="col">최근 요청 기한</th>
            <th scope="col">상세</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.user.id">
            <td>
              <span class="planning-ellipsis" :title="row.user.name">{{ row.user.name }}</span>
            </td>
            <td>
              <span
                class="planning-ellipsis"
                :title="organizationPath(row.user)"
                :aria-label="organizationPath(row.user)"
                >{{ organizationName(row.user) }}</span
              >
            </td>
            <td>
              <span :class="{ 'planning-unavailable': !readiness(row.user.id)?.canRequest }">{{
                requestLabel(row.user)
              }}</span>
            </td>
            <td>
              <div class="planning-row-status">
                <span>{{ row.stage }}</span
                ><span v-if="row.requests.length > 1 && row.unfinished" class="planning-meta"
                  >미완료 {{ row.unfinished }}건</span
                ><span v-if="row.late" class="planning-late" title="목표일 또는 요청 기한 경과"
                  >기한 경과</span
                >
              </div>
            </td>
            <td>{{ row.requests[0]?.dueOn || '—' }}</td>
            <td>
              <button
                class="button ghost small"
                :aria-label="`${row.user.name} · ${organizationPath(row.user)} 계획 요청 상세`"
                @click="showDetail(row.user.id, $event)"
              >
                상세
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="empty-state">해당 대상자가 없습니다.</p>
    </div>
  </section>
  <AppDialog
    v-model:open="detailsOpen"
    :title="`${detail?.user.name || '대상자'} · 계획 요청 상세`"
    class="planning-detail-dialog"
    @closed="restoreDetailFocus"
  >
    <template v-if="detail">
      <p class="planning-detail-org">{{ organizationPath(detail.user) }}</p>
      <dl class="planning-detail-facts">
        <div>
          <dt>요청 가능 상태</dt>
          <dd>{{ readiness(detail.user.id)?.reason || '확인 필요' }}</dd>
        </div>

        <div>
          <dt>새로 계획 가능</dt>
          <dd>{{ readiness(detail.user.id)?.count || 0 }}개</dd>
        </div>
        <div>
          <dt>작성 중 계획</dt>
          <dd>{{ readiness(detail.user.id)?.draftCount || 0 }}개</dd>
        </div>
      </dl>
      <section class="planning-detail-section" aria-label="요청 이력">
        <h3>요청 이력 {{ detail.requests.length }}건</h3>
        <section v-for="r in detail.requests" :key="r.id" class="planning-history-item">
          <h4>
            {{ r.dueOn }} 기한 ·
            {{ detail.summaries.find((s) => s.id === r.id)?.stage || '확인 필요' }}
          </h4>
          <p
            v-for="s in detail.summaries.filter((s) => s.id === r.id)"
            :key="s.id"
            class="planning-meta"
          >
            대상 {{ s.total }}개 · 계획 확정 {{ s.planned }}개 · 유효 인증 {{ s.valid }}개
          </p>
          <p v-if="r.message" class="preserve-lines">{{ r.message }}</p>
          <p v-if="r.closed" class="muted">요청 종료 · {{ r.closed.reason }}</p>
          <button
            v-if="!r.closed && !r.completion && r.qualificationType === 'auditee'"
            class="button secondary"
            :disabled="busy"
            @click="
              closeTarget = r;
              closeReason = '';
            "
          >
            요청 종료
          </button>
          <p v-if="r.source === 'migration'" class="planning-meta">
            이관 시 확보한 소속·계획 대상입니다. 당시 원본에 없는 요청 범위를 추정하지 않았습니다.
          </p>
          <ul>
            <li v-for="target in r.selections" :key="target.entityId">
              {{ target.title }} · 요청 당시 {{ releaseVersionLabel(target) }}
            </li>
          </ul>
        </section>
        <p v-if="!detail.requests.length" class="planning-meta">발송한 요청이 없습니다.</p>
      </section>
      <section class="planning-detail-section" aria-label="개인 계획">
        <h3>개인 계획 {{ detail.plans.length }}건</h3>
        <section v-for="p in detail.plans" :key="p.id" class="planning-history-item">
          <h4>{{ store.qualification(p.qualificationId, p.qualificationMetadata).title }}</h4>
          <p>시작일 {{ p.startOn || '미정' }} · 종료일 {{ p.endOn || '미정' }}</p>
          <p v-if="p.goal" class="preserve-lines">학습 목표 · {{ p.goal }}</p>
          <PreviousPlanSchedule :plan="p" />
        </section>
        <p v-if="!detail.plans.length" class="planning-meta">작성한 계획이 없습니다.</p>
      </section>
    </template>
    <template #footer
      ><button class="button secondary" @click="detailsOpen = false">닫기</button></template
    >
  </AppDialog>
  <AppDialog
    :open="!!closeTarget"
    title="미완료 요청 종료"
    @update:open="
      (v) => {
        if (!v && !busy) closeTarget = undefined;
      }
    "
    ><p>
      요청을 미완료 집계에서 제외하고 초안을 읽기 전용으로 보존합니다. 확정 계획과 학습은
      유지됩니다.
    </p>
    <label class="field"
      >종료 사유<textarea v-model="closeReason" maxlength="2000" :disabled="busy" />
    </label>
    <p v-if="error" role="alert">{{ error }}</p>
    <button class="button primary" :disabled="busy || !closeReason.trim()" @click="closeRequest">
      요청 종료 확정
    </button></AppDialog
  >
  <AppDialog
    :open="open"
    title="계획 수립 요청"
    class="planning-request-dialog"
    @update:open="
      (value) => {
        if (!busy) open = value;
      }
    "
  >
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <div class="planning-request-layout">
      <fieldset class="planning-request-targets">
        <legend>{{ selectedType === 'auditor' ? '대상 평가자' : '대상 학습자' }}</legend>
        <div class="planning-target-tools">
          <label class="field"
            >이름·조직 검색<input
              v-model="search"
              type="search"
              :disabled="busy"
              autocomplete="off"
          /></label>
          <p class="planning-selection-count" role="status">
            선택 {{ form.learnerIds.length }}명 <span>· 조회 {{ visibleLearners.length }}명</span>
          </p>
        </div>
        <div class="planning-target-options">
          <label
            v-for="u in visibleLearners"
            :key="u.id"
            class="planning-target-option"
            :class="{ 'is-unavailable': !readiness(u.id)?.canRequest }"
          >
            <input
              v-model="form.learnerIds"
              :aria-label="u.name"
              :aria-describedby="`planning-target-${u.id}`"
              :value="u.id"
              type="checkbox"
              :disabled="busy || !readiness(u.id)?.canRequest"
            />
            <span class="planning-option-person">
              <span class="planning-ellipsis planning-option-name" :title="u.name">{{
                u.name
              }}</span>
              <span class="planning-option-status">{{ requestLabel(u) }}</span>
            </span>
            <span class="planning-ellipsis planning-option-org" :title="organizationPath(u)">{{
              organizationName(u)
            }}</span>
            <span :id="`planning-target-${u.id}`" class="sr-only"
              >{{ organizationPath(u) }} · {{ readiness(u.id)?.reason || '확인 필요' }}</span
            >
          </label>
          <p v-if="!visibleLearners.length" class="empty-state">검색 결과가 없습니다.</p>
        </div>
      </fieldset>
      <div class="planning-request-fields">
        <p class="planning-request-team">{{ store.managementOrganization?.name }}</p>
        <label class="field"
          >계획 작성 기한<input
            v-model="form.dueOn"
            @input="dueEdited = true"
            type="date"
            :disabled="busy"
          /><span v-if="dueEdited && !form.dueOn" class="field-error"
            >계획 작성 기한을 입력해 주세요.</span
          ></label
        >
        <label class="field"
          >안내문<textarea v-model="form.message" rows="5" maxlength="2000" :disabled="busy" />
        </label>
        <p class="planning-meta">
          현재 소속에 지정·상속된 필요자격 전체를 요청합니다. 필요자격이 없거나 운영 준비가 부족하면
          발송하지 않습니다.
        </p>
      </div>
    </div>
    <section v-if="requestPreview" class="planning-preview" aria-label="요청 대상 검토 결과">
      <section v-for="r in requestPreview.rows" :key="r.learnerId" class="planning-preview-person">
        <header class="planning-preview-heading">
          <h3>{{ r.name }}</h3>
          <StatusBadge
            :status="
              r.status === 'ready' ? 'active' : r.status === 'excluded' ? 'excluded' : 'draft'
            "
            :label="
              r.status === 'ready'
                ? '발송 가능'
                : r.status === 'excluded'
                  ? '대상 제외'
                  : '발송 보류'
            "
          />
        </header>
        <p class="planning-preview-path">{{ r.organizationPath.map((o) => o.name).join(' › ') }}</p>
        <p v-if="r.reasons.length" class="error-message">{{ r.reasons.join(' · ') }}</p>
        <ul class="planning-preview-requirements">
          <li v-for="q in r.requirements" :key="q.entityId">
            <span
              ><strong>{{ q.title }}</strong
              ><small>{{ q.sourceOrganizations.map((o) => o.name).join(', ') }} 지정</small></span
            >
            <span class="planning-preview-state">{{
              r.coveredEntityIds.includes(q.entityId) ? '보유·진행 중' : '계획 필요'
            }}</span>
          </li>
        </ul>
        <label v-for="id in r.existingRequestIds" :key="id" class="planning-replace-request"
          ><input v-model="replaceIds" type="checkbox" :value="id" :disabled="busy" /> 이전 요청
          교체 종료 · {{ store.data.planningRequests.find((p) => p.id === id)?.dueOn }} ·
          {{
            store.data.planningRequests.find((p) => p.id === id)?.message || '계획 수립 요청'
          }}</label
        >
      </section>
    </section>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="open = false">취소</button
      ><button
        class="button primary"
        :disabled="busy || !form.learnerIds.length || !form.dueOn"
        @click="send"
      >
        {{ requestPreview ? '대상자에게 요청' : '요청 대상 확인' }}
      </button></template
    >
  </AppDialog>
</template>
