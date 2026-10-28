<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { releaseVersionLabel } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import { useRequirementMapping } from '../composables/useRequirementMapping';
import { confirmAction } from '../composables/useConfirmation';
import PolicyOrganizationTree from '../components/PolicyOrganizationTree.vue';
import AppDialog from '../components/AppDialog.vue';

const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const {
  data,
  exclusions,
  excluded,
  canExclude,
  setRule,
  mergeConflicts,
  resolveConflict,
  draft,
  entries,
  effective,
  changedOrganizations,
  changes,
  dirty,
  busy,
  locked,
  error,
  conflict,
  revoked,
  preview,
  pending,
  rebased,
  load,
  toggle,
  discard,
  review,
  save,
} = useRequirementMapping();
type RuleMode = 'inherit' | 'direct' | 'exclude';
const ruleLabels = { inherit: '상위 설정 따름', direct: '직접 지정', exclude: '상속 제외' };
const reasonOpen = ref(false),
  reasonText = ref(''),
  reasonTarget = ref<{ org: string; id: string; mode: RuleMode }>();
const conflictReason = ref<Record<string, string>>({});
function localRule(org: string, id: string): RuleMode {
  return exclusions.value[org]?.some((e) => e.entityId === id)
    ? 'exclude'
    : draft.value[org]?.includes(id)
      ? 'direct'
      : 'inherit';
}
function changeRule(org: string, id: string, mode: RuleMode) {
  if (mode === 'exclude' || localRule(org, id) === 'exclude') {
    reasonTarget.value = { org, id, mode };
    reasonText.value =
      mode === 'exclude' ? exclusions.value[org]?.find((e) => e.entityId === id)?.reason || '' : '';
    reasonOpen.value = true;
  } else setRule(org, id, mode);
}
function selectRule(event: Event, org: string) {
  const input = event.target as HTMLSelectElement,
    value = input.value as RuleMode;
  input.value = localRule(org, selectedQualification.value);
  changeRule(org, selectedQualification.value, value);
}
function applyReason() {
  if (reasonTarget.value && reasonText.value.trim()) {
    const t = reasonTarget.value;
    setRule(t.org, t.id, t.mode, reasonText.value);
    reasonOpen.value = false;
  }
}
const selectedId = ref(''),
  selectedQualification = ref(''),
  mode = ref<'organization' | 'qualification'>('organization');
const addOpen = ref(false),
  search = ref(''),
  picked = ref<string[]>([]);
const selected = computed(() => entries.value.find((e) => e.id === selectedId.value));
const qualifications = computed(() => data.value?.qualifications || []);
const qualified = (id: string) => qualifications.value.find((q) => q.entityId === id);
const title = (id: string) =>
  qualified(id)?.title ||
  entries.value.flatMap((e) => e.effective).find((q) => q.entityId === id)?.title ||
  '확인할 수 없는 자격';
const sources = (org: string, id: string) => effective.value.get(org)?.get(id) || [];
const direct = (org: string, id: string) => !!draft.value[org]?.includes(id);
const inherited = (org: string, id: string) => sources(org, id).some((s) => s.id !== org);
const status = (org: string, id: string) =>
  direct(org, id)
    ? inherited(org, id)
      ? '직접 · 상속'
      : '직접'
    : inherited(org, id)
      ? '상속'
      : excluded.value.get(org)?.has(id)
        ? '제외'
        : '미적용';
const issues = (id: string) => qualified(id)?.issues || ['현재 사용할 팀 자격이 없습니다.'];
const canAdd = (org: string, id: string) =>
  !!entries.value.find((e) => e.id === org && e.effectiveActive && e.editable) &&
  !!qualified(id) &&
  !issues(id).length;
const applied = computed(() =>
  [...(effective.value.get(selectedId.value)?.keys() || [])].sort(
    (a, b) =>
      Number(direct(selectedId.value, b)) - Number(direct(selectedId.value, a)) ||
      title(a).localeCompare(title(b), 'ko'),
  ),
);
const shown = computed(() =>
  mode.value === 'qualification'
    ? selectedQualification.value
      ? excluded.value.get(selectedId.value)?.has(selectedQualification.value)
        ? []
        : [selectedQualification.value]
      : []
    : applied.value,
);
const excludedRows = computed(() =>
  [...(excluded.value.get(selectedId.value)?.values() || [])].filter(
    (e) => mode.value === 'organization' || e.entityId === selectedQualification.value,
  ),
);
const inheritedCount = computed(
  () => applied.value.filter((id) => inherited(selectedId.value, id)).length,
);
const candidates = computed(() =>
  qualifications.value.filter(
    (q) =>
      !applied.value.includes(q.entityId) &&
      !excluded.value.get(selectedId.value)?.has(q.entityId) &&
      q.title.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()),
  ),
);
const rowProblems = (id: string) =>
  [...(effective.value.get(id)?.keys() || [])].some((q) => issues(q).length);
function readSelection() {
  if (!data.value) return;
  const org = typeof route.query.organizationId === 'string' ? route.query.organizationId : '';
  const entity = typeof route.query.entityId === 'string' ? route.query.entityId : '';
  selectedId.value =
    entries.value.find((e) => e.id === org)?.id ||
    entries.value.find((e) => e.id === selectedId.value)?.id ||
    entries.value[0]?.id ||
    '';
  selectedQualification.value =
    qualifications.value.find((q) => q.entityId === entity)?.entityId ||
    qualifications.value.find((q) => q.entityId === selectedQualification.value)?.entityId ||
    qualifications.value[0]?.entityId ||
    '';
  mode.value =
    store.fullManagement && route.query.view === 'qualification' ? 'qualification' : 'organization';
}
watch([data, () => route.fullPath], readSelection);
watch(
  () => `${store.actorId}:${store.managementLv1}`,
  () => {
    selectedId.value = '';
    selectedQualification.value = '';
    addOpen.value = false;
    picked.value = [];
    search.value = '';
    reasonOpen.value = false;
    conflictReason.value = {};
  },
);
function navigate(org = selectedId.value, view = mode.value, entity = selectedQualification.value) {
  if (busy.value) return;
  void router.replace({
    path: route.path,
    query: {
      ...store.managementLink(route.path).query,
      view,
      organizationId: org,
      ...(view === 'qualification' && entity ? { entityId: entity } : {}),
    },
  });
}
function openAdd() {
  search.value = '';
  picked.value = [];
  addOpen.value = true;
}
function addPicked() {
  for (const id of picked.value)
    if (canAdd(selectedId.value, id)) toggle(selectedId.value, id, true);
  addOpen.value = false;
}
async function cancel() {
  if (!locked.value && (await confirmAction('모든 미저장 변경을 취소할까요?', '변경 취소')))
    discard();
}
async function leave() {
  if (busy.value) return false;
  return (
    !(dirty.value || pending.value || reasonOpen.value) ||
    (await confirmAction('저장하지 않은 필요자격 변경이 있습니다. 이동할까요?', '변경 버리고 이동'))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate((to) => {
  const nextTeam =
    typeof to.query.lv1OrganizationId === 'string'
      ? to.query.lv1OrganizationId
      : store.hasRole('system_operator')
        ? ''
        : store.actor.lv1OrganizationId;
  return nextTeam !== store.managementLv1 ? leave() : !busy.value;
});
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value || busy.value || pending.value || reasonOpen.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
const reviewOpen = computed({
  get: () => !!preview.value,
  set: (v) => {
    if (!v && !busy.value && !pending.value) preview.value = undefined;
  },
});
const orgName = (id: string) =>
  entries.value.find((e) => e.id === id)?.name || '확인할 수 없는 조직';
const names = (ids: string[]) => ids.map(title).join(', ');
const oldDirect = (id: string) => entries.value.find((e) => e.id === id)?.directEntityIds || [];
</script>
<template>
  <section class="requirement-workspace">
    <header class="requirement-heading">
      <h1>조직 필요자격</h1>
      <div
        v-if="store.fullManagement"
        class="requirement-modes"
        role="group"
        aria-label="매핑 보기"
      >
        <button
          class="button secondary"
          :aria-pressed="mode === 'organization'"
          :disabled="busy"
          @click="navigate(selectedId, 'organization')"
        >
          조직별
        </button>
        <button
          class="button secondary"
          :aria-pressed="mode === 'qualification'"
          :disabled="busy"
          @click="navigate(selectedId, 'qualification')"
        >
          자격별
        </button>
      </div>
    </header>
    <p v-if="!store.managementReady" class="empty-state">관리할 팀을 선택해 주세요.</p>
    <p v-else-if="busy && !data" role="status">불러오는 중</p>
    <div v-if="error && !preview" role="alert" class="error-message requirement-error">
      <p>{{ error }}</p>
      <button v-if="pending" class="button secondary" :disabled="busy" @click="save">
        저장 재시도
      </button>
      <button
        v-else-if="conflict || (data && dirty)"
        class="button secondary"
        :disabled="busy"
        @click="load(true)"
      >
        입력 유지하고 최신 기준 비교
      </button>
      <button v-else class="button secondary" :disabled="busy" @click="load()">
        다시 불러오기
      </button>
    </div>
    <p v-if="rebased" class="notice-body" role="status">
      최신 기준에 변경을 다시 적용했습니다. 변경 확인이 필요합니다.
    </p>
    <section v-if="mergeConflicts.length" class="mapping-conflicts" aria-label="동시 변경 비교">
      <h2>동시 변경 확인</h2>
      <div
        v-for="(c, index) in mergeConflicts"
        :key="`${c.organizationId}:${c.entityId}`"
        class="mapping-review-row"
      >
        <strong>{{ orgName(c.organizationId) }} · {{ title(c.entityId) }}</strong>
        <p>내 변경 · {{ ruleLabels[c.mine.mode] }} {{ c.mine.reason }}</p>
        <p>최신 설정 · {{ ruleLabels[c.latest.mode] }} {{ c.latest.reason }}</p>
        <label
          v-if="c.latest.mode === 'exclude' && c.mine.mode !== 'exclude' && !c.removalReason"
          class="field"
          >예외 해제 사유<textarea
            v-model="conflictReason[`${c.organizationId}:${c.entityId}`]"
            maxlength="500"
          />
        </label>
        <button
          class="button secondary"
          :disabled="
            c.latest.mode === 'exclude' &&
            c.mine.mode !== 'exclude' &&
            !c.removalReason &&
            !conflictReason[`${c.organizationId}:${c.entityId}`]?.trim()
          "
          @click="resolveConflict(index, true, conflictReason[`${c.organizationId}:${c.entityId}`])"
        >
          내 변경 사용
        </button>
        <button class="button secondary" @click="resolveConflict(index, false)">
          최신 설정 사용
        </button>
      </div>
    </section>
    <template v-if="data">
      <label v-if="mode === 'qualification'" class="field requirement-picker"
        ><span>매핑할 자격</span>
        <select
          :value="selectedQualification"
          :disabled="busy"
          @change="navigate(selectedId, mode, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="q in qualifications" :key="q.entityId" :value="q.entityId">
            {{ q.title }} · {{ releaseVersionLabel(q) }}
          </option>
        </select>
      </label>
      <div class="requirement-layout">
        <PolicyOrganizationTree
          :entries="entries"
          :selected="selectedId"
          :disabled="busy"
          :searchable="false"
          @select="navigate($event)"
        >
          <template #status="{ entry }">
            <span class="mapping-tree-status">
              <span>{{
                mode === 'qualification'
                  ? status(entry.id, selectedQualification)
                  : `적용 ${effective.get(entry.id)?.size || 0}`
              }}</span>
              <span v-if="changedOrganizations.has(entry.id)" class="mapping-change">변경</span>
              <span v-if="!entries.find((e) => e.id === entry.id)?.effectiveActive" class="muted"
                >사용 중지</span
              >
              <span v-if="rowProblems(entry.id)" class="mapping-problem" aria-label="운영 준비 필요"
                >!</span
              >
            </span>
          </template>
          <template #action="{ entry }">
            <select
              v-if="mode === 'qualification' && selectedQualification"
              class="mapping-rule-select"
              :aria-label="`${entry.path.map((o) => o.name).join(' › ')} 적용 규칙`"
              :value="localRule(entry.id, selectedQualification)"
              :disabled="locked"
              @change="selectRule($event, entry.id)"
            >
              <option value="inherit">상위 설정 따름</option>
              <option
                value="direct"
                :disabled="
                  !direct(entry.id, selectedQualification) &&
                  !canAdd(entry.id, selectedQualification)
                "
              >
                직접 지정
              </option>
              <option
                v-if="entry.parentId"
                value="exclude"
                :disabled="
                  localRule(entry.id, selectedQualification) !== 'exclude' &&
                  !canExclude(entry.id, selectedQualification)
                "
              >
                상속 제외
              </option>
            </select>
          </template>
        </PolicyOrganizationTree>
        <section v-if="selected" class="requirement-detail" aria-label="선택 조직 필요자격">
          <header class="requirement-heading">
            <div>
              <h2>{{ selected.name }}</h2>
              <p class="muted requirement-path">
                {{
                  selected.path
                    .slice(0, -1)
                    .map((o) => o.name)
                    .join(' › ')
                }}
              </p>
            </div>
            <button
              v-if="mode === 'organization'"
              class="button secondary"
              :disabled="locked || !selected.effectiveActive"
              @click="openAdd"
            >
              자격 추가
            </button>
          </header>
          <section
            class="mapping-applied"
            :aria-label="
              mode === 'organization' ? '이 조직의 필요자격 목록' : '선택 자격 적용 설정'
            "
          >
            <h3 v-if="mode === 'organization'">이 조직의 필요자격 목록</h3>
            <p v-if="mode === 'organization'" class="requirement-counts">
              직접 {{ draft[selectedId]?.length || 0 }} · 상속 {{ inheritedCount }} · 적용
              {{ applied.length }}
            </p>
            <p v-if="!shown.length && !excludedRows.length" class="empty-state">
              {{ mode === 'organization' ? '필요자격 없음' : '등록된 자격 없음' }}
            </p>
            <ul class="mapping-list">
              <li
                v-for="id in shown"
                :key="id"
                class="mapping-row"
                :aria-labelledby="`mapping-title-${id}`"
              >
                <div class="mapping-row-main">
                  <strong :id="`mapping-title-${id}`" class="mapping-title">{{ title(id) }}</strong
                  ><small class="muted">{{ releaseVersionLabel(qualified(id)) }}</small>
                  <div class="mapping-badges">
                    <span v-if="direct(selectedId, id)" class="mapping-badge">직접</span>
                    <details v-if="inherited(selectedId, id)" class="mapping-source">
                      <summary class="mapping-badge inherited">상속</summary>
                      <ul>
                        <li
                          v-for="source in sources(selectedId, id).filter(
                            (o) => o.id !== selectedId,
                          )"
                          :key="source.id"
                        >
                          <button
                            v-if="entries.some((e) => e.id === source.id && e.editable)"
                            class="text-link"
                            :disabled="busy"
                            @click="navigate(source.id)"
                          >
                            {{ source.name }}
                          </button>
                          <span v-else>{{ source.name }}</span>
                        </li>
                      </ul>
                    </details>
                    <span v-if="!sources(selectedId, id).length" class="muted">미적용</span>
                  </div>
                  <details v-if="issues(id).length" class="mapping-issues">
                    <summary>요청 보류</summary>
                    <ul>
                      <li v-for="issue in issues(id)" :key="issue">{{ issue }}</li>
                    </ul>
                  </details>
                </div>
                <div class="mapping-row-actions">
                  <button
                    v-if="direct(selectedId, id)"
                    class="text-link"
                    :disabled="locked"
                    :aria-label="`${title(id)} 직접 지정 해제`"
                    @click="toggle(selectedId, id, false)"
                  >
                    직접 지정 해제
                  </button>
                  <button
                    v-else
                    class="text-link"
                    :disabled="locked || !canAdd(selectedId, id)"
                    @click="toggle(selectedId, id, true)"
                  >
                    {{ inherited(selectedId, id) ? '이 조직에도 직접 지정' : '직접 지정' }}
                  </button>
                  <button
                    v-if="canExclude(selectedId, id)"
                    class="text-link"
                    :disabled="locked"
                    :aria-label="`${title(id)} 상속 제외`"
                    @click="changeRule(selectedId, id, 'exclude')"
                  >
                    상속 제외
                  </button>
                </div>
              </li>
            </ul>
          </section>
          <details v-if="excludedRows.length" class="mapping-excluded" open>
            <summary>상속 제외 {{ excludedRows.length }}</summary>
            <ul class="mapping-list">
              <li v-for="e in excludedRows" :key="e.entityId" class="mapping-row">
                <div class="mapping-row-main">
                  <strong class="mapping-title">{{ title(e.entityId) }}</strong>
                  <div class="mapping-badges">
                    <span class="mapping-badge">{{
                      e.organization.id === selectedId ? '이 조직에서 제외' : '상위 조직에서 제외'
                    }}</span
                    ><span v-if="!e.hasInherited" class="muted">현재 상속 없음</span>
                  </div>
                  <details class="mapping-source">
                    <summary>제외 근거</summary>
                    <button
                      v-if="entries.some((o) => o.id === e.organization.id && o.editable)"
                      class="text-link"
                      :disabled="busy"
                      @click="navigate(e.organization.id)"
                    >
                      {{ e.organization.name }}</button
                    ><span v-else>{{ e.organization.name }}</span>
                    <p v-if="e.sourceOrganizations.length">
                      지정 · {{ e.sourceOrganizations.map((o) => o.name).join(', ') }}
                    </p>
                    <p class="mapping-reason">{{ e.reason }}</p>
                  </details>
                </div>
                <div class="mapping-exception-actions">
                  <button
                    v-if="e.organization.id === selectedId"
                    class="text-link"
                    :disabled="locked"
                    @click="changeRule(selectedId, e.entityId, 'inherit')"
                  >
                    예외 해제
                  </button>
                  <button
                    v-if="e.organization.id === selectedId"
                    class="text-link"
                    :disabled="locked"
                    @click="changeRule(selectedId, e.entityId, 'exclude')"
                  >
                    사유 수정
                  </button>
                  <button
                    class="text-link"
                    :disabled="locked || !canAdd(selectedId, e.entityId)"
                    @click="changeRule(selectedId, e.entityId, 'direct')"
                  >
                    직접 지정
                  </button>
                </div>
              </li>
            </ul>
          </details>
        </section>
      </div>
      <footer class="mapping-toolbar">
        <span role="status">{{ dirty ? `변경 ${changes.length}개 조직` : '저장됨' }}</span>
        <div>
          <button class="button secondary" :disabled="locked || !dirty" @click="cancel">
            변경 취소
          </button>
          <button v-if="pending" class="button primary" :disabled="busy" @click="save">
            저장 재시도
          </button>
          <button
            v-else
            class="button primary"
            :disabled="locked || conflict || !dirty"
            @click="review"
          >
            변경 확인
          </button>
        </div>
      </footer>
    </template>
    <AppDialog
      v-model:open="reasonOpen"
      :title="reasonTarget?.mode === 'exclude' ? '상속 제외 사유' : '예외 해제 사유'"
    >
      <p v-if="reasonTarget">{{ orgName(reasonTarget.org) }} · {{ title(reasonTarget.id) }}</p>
      <p class="muted">하위 조직에도 적용됩니다.</p>
      <label class="field"
        >변경 사유<textarea v-model="reasonText" maxlength="500" rows="3" required />
      </label>
      <template #footer
        ><button class="button secondary" @click="reasonOpen = false">취소</button
        ><button
          class="button primary"
          :disabled="locked || !reasonText.trim()"
          @click="applyReason"
        >
          변경 적용
        </button></template
      >
    </AppDialog>
    <AppDialog v-model:open="addOpen" title="자격 추가">
      <label class="field">자격 검색<input v-model="search" placeholder="자격명" /></label>
      <p v-if="!candidates.length" class="empty-state">추가할 자격이 없습니다.</p>
      <div class="mapping-candidates">
        <div v-for="q in candidates" :key="q.entityId" class="mapping-candidate">
          <label
            ><input
              v-model="picked"
              type="checkbox"
              :value="q.entityId"
              :disabled="locked || !canAdd(selectedId, q.entityId)"
            /><span>{{ q.title }} · {{ releaseVersionLabel(q) }}</span></label
          >
          <details v-if="q.issues.length">
            <summary>운영 준비 필요</summary>
            <ul>
              <li v-for="issue in q.issues" :key="issue">{{ issue }}</li>
            </ul>
          </details>
        </div>
      </div>
      <template #footer
        ><button class="button secondary" @click="addOpen = false">취소</button
        ><button class="button primary" :disabled="locked || !picked.length" @click="addPicked">
          선택 추가{{ picked.length ? ` (${picked.length})` : '' }}
        </button></template
      >
    </AppDialog>
    <AppDialog v-model:open="reviewOpen" title="필요자격 변경 확인">
      <template v-if="preview">
        <p class="mapping-impact">
          적용 변경 {{ preview.summary.membershipChangedOrganizations }}개 조직 · 구성원
          {{ preview.summary.affectedMembers }}명<br />출처만 변경
          {{ preview.summary.sourceOnlyOrganizations }}개 조직 · 예외만 변경
          {{ preview.summary.exceptionOnlyOrganizations }}개 조직
        </p>
        <h3>지정·예외 변경</h3>
        <div v-for="c in preview.changes" :key="c.organizationId" class="mapping-review-row">
          <strong>{{ orgName(c.organizationId) }}</strong>
          <p v-if="c.entityIds.some((id) => !oldDirect(c.organizationId).includes(id))">
            추가 ·
            {{ names(c.entityIds.filter((id) => !oldDirect(c.organizationId).includes(id))) }}
          </p>
          <p v-if="oldDirect(c.organizationId).some((id) => !c.entityIds.includes(id))">
            해제 ·
            {{ names(oldDirect(c.organizationId).filter((id) => !c.entityIds.includes(id))) }}
          </p>
        </div>
        <div
          v-for="e in preview.exceptionChanges"
          :key="`${e.organizationId}:${e.entityId}`"
          class="mapping-review-row"
        >
          <strong>{{ orgName(e.organizationId) }} · {{ title(e.entityId) }}</strong>
          <p>
            {{
              e.action === 'exclude'
                ? '상속 제외'
                : e.action === 'restore'
                  ? '예외 해제'
                  : '제외 사유 변경'
            }}
            · {{ e.reason }}
          </p>
        </div>
        <h3>적용 결과</h3>
        <div v-for="e in preview.affected" :key="e.organizationId" class="mapping-review-row">
          <strong>{{ e.name }}</strong>
          <p v-if="e.added.length">추가 · {{ names(e.added) }}</p>
          <p v-if="e.removed.length">해제 · {{ names(e.removed) }}</p>
          <p v-for="change in e.sourceChanged" :key="change.entityId">
            {{ title(change.entityId) }} · 적용 유지<br />{{
              change.before.map((o) => o.name).join(', ')
            }}
            → {{ change.after.map((o) => o.name).join(', ') }}
          </p>
          <p v-if="e.exclusionChanged.length">예외 적용 변경 · {{ names(e.exclusionChanged) }}</p>
          <p v-if="e.issues.length" class="error-message">{{ e.issues.join(' · ') }}</p>
        </div>
        <p class="muted">새 계획 요청부터 적용됩니다.</p>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      </template>
      <template #footer
        ><button class="button secondary" :disabled="busy || !!pending" @click="reviewOpen = false">
          취소</button
        ><button class="button primary" :disabled="busy || revoked" @click="save">
          {{ pending ? '저장 재시도' : '전체 변경 저장' }}
        </button></template
      >
    </AppDialog>
  </section>
</template>
<style scoped>
.mapping-rule-select {
  width: 140px;
  flex-shrink: 0;
  min-height: 40px;
  font-size: 13px;
  padding: 6px;
}
.mapping-excluded {
  margin-top: 24px;
  border-top: 1px solid var(--line);
  padding-top: 16px;
}
.mapping-excluded > summary {
  cursor: pointer;
  font-weight: 600;
}
.mapping-reason {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mapping-source {
  margin-top: 8px;
}
.mapping-exception-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.mapping-conflicts {
  border-block: 1px solid var(--line);
  padding: 16px 0;
}
.requirement-layout :deep(.policy-tree-item) {
  flex-wrap: wrap;
}
@media (max-width: 600px) {
  .mapping-rule-select {
    width: 140px;
    margin-left: auto;
  }
}

.requirement-workspace,
.requirement-detail {
  min-width: 0;
}
.requirement-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.requirement-heading h1,
.requirement-heading h2 {
  margin: 0;
}
.requirement-modes {
  display: flex;
  gap: 8px;
}
.requirement-modes [aria-pressed='true'] {
  background: var(--brand, #533afd);
  color: white;
}
.requirement-picker {
  margin-top: 24px;
  max-width: 720px;
}
.requirement-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(0, 1.6fr);
  gap: 24px;
  margin-top: 24px;
}
.requirement-layout :deep(.policy-tree-panel) {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--control-border);
  align-self: start;
}
.requirement-layout :deep(.policy-org-row) {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.requirement-layout :deep(.policy-tree-name) {
  flex: 1;
}
.requirement-path {
  margin: 8px 0 0;
  overflow-wrap: anywhere;
}
.requirement-counts {
  margin: 8px 0 16px;
  font-size: var(--text-caption);
  color: var(--ink-muted);
}
.mapping-applied {
  margin-top: 24px;
  border-top: 1px solid var(--line);
  padding-top: 20px;
}
.mapping-tree-status {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: var(--ink-muted);
  flex-shrink: 0;
  white-space: nowrap;
}
.mapping-change {
  color: var(--primary, #533afd);
  font-weight: 600;
}
.mapping-problem,
.mapping-issues {
  color: var(--danger, #ae2035);
}
.mapping-tree-check {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  min-width: 44px;
}
.mapping-list {
  display: grid;
  gap: 16px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.mapping-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--control-border);
  background: var(--surface);
}
.mapping-title {
  display: block;
  font-size: var(--text-title);
  font-weight: var(--weight-heading);
  line-height: 1.5;
}
.mapping-row-actions,
.mapping-row > .mapping-exception-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.mapping-row-actions > button {
  min-height: 40px;
}
.mapping-row-main {
  min-width: 0;
  overflow-wrap: anywhere;
}
.mapping-row-main > small {
  display: block;
  margin-top: 4px;
}
.mapping-row > button {
  flex-shrink: 0;
}
.mapping-badges {
  display: flex;
  gap: 8px;
  align-items: start;
  margin-top: 8px;
}
.mapping-badge {
  display: inline-block;
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 12px;
  background: var(--canvas-soft, #f6f9fc);
}
.mapping-badge.inherited {
  border-style: dashed;
  cursor: pointer;
}
.mapping-source ul,
.mapping-issues ul {
  margin: 8px 0;
  padding-left: 20px;
}
.mapping-issues {
  margin-top: 8px;
  font-size: 14px;
}
.mapping-issues summary {
  cursor: pointer;
}
.mapping-toolbar {
  position: sticky;
  bottom: 0;
  z-index: 2;
  background: white;
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 0;
  margin-top: 24px;
}
.mapping-toolbar > div {
  display: flex;
  gap: 8px;
}
.mapping-candidates {
  max-height: min(55vh, 480px);
  overflow: auto;
  border-block: 1px solid var(--line);
}
.mapping-candidate {
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}
.mapping-candidate label {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 44px;
  overflow-wrap: anywhere;
}
.mapping-candidate details {
  margin-left: 28px;
  font-size: 14px;
}
.mapping-review-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}
.mapping-review-row p {
  margin: 8px 0 0;
}
.mapping-impact {
  font-weight: 600;
  line-height: 1.8;
}
.requirement-error {
  margin-top: 16px;
}
@media (max-width: 1023px) {
  .requirement-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .mapping-row {
    flex-direction: column;
    gap: 8px;
  }
  .mapping-toolbar {
    flex-wrap: wrap;
  }
  .mapping-toolbar > div {
    margin-left: auto;
  }
}
</style>
