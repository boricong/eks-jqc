<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import { api, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
import {
  roleLabels,
  workStatusLabels,
  teamEditableRoles,
  type Role,
  type UserView,
  type OrganizationView,
  type TeamUsersView,
  type TeamUserView,
} from '@eks/contracts';
import OrganizationSelect from './OrganizationSelect.vue';
import WorkStatusDialog from './WorkStatusDialog.vue';
import PolicyOrganizationTree from './PolicyOrganizationTree.vue';
import AppDialog from './AppDialog.vue';
import ListControls from './ListControls.vue';
import { useListView } from '../composables/useListView';
const props = withDefaults(defineProps<{ mode?: 'system' | 'team' }>(), { mode: 'system' });
const route = useRoute(),
  store = useDemo(),
  labels = roleLabels;
const isTeam = computed(() => props.mode === 'team');
const canAccess = computed(() =>
  isTeam.value ? store.fullManagement && store.managementReady : store.hasRole('system_operator'),
);
const roleOptions = computed(() =>
  Object.entries(roleLabels)
    .filter(
      ([value]) =>
        value !== 'evaluator' &&
        (value !== 'ft' || !!store.data.mentorPracticalEnabled) &&
        (isTeam.value
          ? teamEditableRoles.some((r) => r === value)
          : value !== 'organization_admin'),
    )
    .map(([value, label]) => ({ value: value as Role, label })),
);
type ListedUser = UserView &
  Partial<Pick<TeamUserView, 'canEdit' | 'editBlockedReason' | 'workStatusInfo'>>;
const workUser = ref<ListedUser | null>(null),
  workFilter = ref('');
const users = ref<ListedUser[]>([]),
  doc = shallowRef<Pick<OrganizationView, 'revision' | 'entries'> | null>(null);
const query = ref(''),
  orgFilter = ref(''),
  selected = ref<ListedUser | null>(null);
const editing = ref(false),
  busy = ref(false),
  error = ref(''),
  conflict = ref(false);
const comparison = ref<ListedUser | null>(null),
  draftOrganizationRevision = ref(0);
const form = ref({ name: '', organizationId: '', roles: ['learner'] as Role[] });
const baseline = ref('');
const dirty = computed(() => editing.value && JSON.stringify(form.value) !== baseline.value);
function workBlocked(user: ListedUser, inEditor = false) {
  if (inEditor && dirty.value) return '사용자 정보를 먼저 저장하거나 취소해 주세요.';
  if (!user.workStatusInfo) return '업무 상태를 불러온 뒤 다시 확인해 주세요.';
  return user.workStatusInfo.blockedReason || '';
}
async function workSaved() {
  if (!(await load())) return;
  if (editing.value && selected.value && !dirty.value) {
    const latest = users.value.find((u) => u.id === selected.value!.id);
    if (latest) edit(latest);
  }
}
const teamOrganizations = computed(() =>
  (doc.value?.entries || []).filter((e) => e.lv1OrganizationId === store.managementLv1),
);
const selectableOrganizations = computed(() =>
  teamOrganizations.value
    .filter((e) => e.effectiveActive || e.id === selected.value?.organizationId)
    .map((e) => e.id),
);
const organizationIssue = computed(() => {
  if (!isTeam.value || !editing.value || !doc.value) return '';
  const entry = teamOrganizations.value.find((e) => e.id === form.value.organizationId);
  if (!entry)
    return '선택한 조직을 더 이상 사용할 수 없습니다. 관리 가능한 조직을 다시 선택해 주세요.';
  if (!selectableOrganizations.value.includes(entry.id))
    return '선택한 조직이 사용 중지되었습니다. 사용할 소속 조직을 다시 선택해 주세요.';
  return '';
});
function selectOrganization(id: string) {
  if (!busy.value && selectableOrganizations.value.includes(id)) form.value.organizationId = id;
}
const preferencesKey = [props.mode, store.actorId, isTeam.value ? store.managementLv1 : 'all'].join(
  ':',
);
const listed = computed(() =>
  users.value.filter(
    (u) =>
      (!orgFilter.value || u.organizationPath.some((p) => p.id === orgFilter.value)) &&
      (!workFilter.value || (u.workStatus || 'active') === workFilter.value) &&
      [u.name, ...u.organizationPath.map((p) => p.name)]
        .join(' ')
        .toLowerCase()
        .includes(query.value.toLowerCase()),
  ),
);
const list = useListView(listed, 'users:' + preferencesKey, (u) => u.name);
try {
  const saved = JSON.parse(localStorage.getItem('eks-users-filter:' + preferencesKey) || '{}');
  query.value = saved.query || '';
  orgFilter.value = saved.organization || '';
} catch {}
watch([query, orgFilter], () => {
  list.page = 1;
  try {
    localStorage.setItem(
      'eks-users-filter:' + preferencesKey,
      JSON.stringify({ query: query.value, organization: orgFilter.value }),
    );
  } catch {}
});
let generation = 0;
function clearPrivateState() {
  workUser.value = null;
  users.value = [];
  doc.value = null;
  selected.value = null;
  editing.value = false;
  comparison.value = null;
}
async function load() {
  const seq = ++generation;
  if (!canAccess.value) {
    clearPrivateState();
    return false;
  }
  try {
    if (isTeam.value) {
      const result = await api<TeamUsersView>(store.managementPath('/team-users'));
      if (seq !== generation) return false;
      users.value = result.users;
      doc.value = result.organizations;
    } else {
      const [people, organizations] = await Promise.all([
        api<UserView[]>('/system/users'),
        api<OrganizationView>('/system/organizations'),
      ]);
      if (seq !== generation) return false;
      users.value = people;
      doc.value = organizations;
    }
    if (orgFilter.value && !doc.value.entries.some((e) => e.id === orgFilter.value))
      orgFilter.value = '';
    return true;
  } catch (e) {
    if (seq === generation) {
      error.value = (e as Error).message;
      if (e instanceof ApiError && e.status === 403) clearPrivateState();
    }
    return false;
  }
}
function edit(user?: ListedUser) {
  if (!canAccess.value || (isTeam.value && user && !user.canEdit)) return;
  selected.value = user ? structuredClone(JSON.parse(JSON.stringify(user))) : null;
  form.value = {
    name: user?.name ?? '',
    organizationId: user?.organizationId ?? (isTeam.value ? store.managementLv1 : ''),
    roles: user
      ? user.roles.filter((r) =>
          isTeam.value ? teamEditableRoles.some((v) => v === r) : r !== 'organization_admin',
        )
      : ['learner'],
  };
  draftOrganizationRevision.value = doc.value?.revision ?? 0;
  baseline.value = JSON.stringify(form.value);
  comparison.value = null;
  conflict.value = false;
  editing.value = true;
  error.value = '';
}
async function leave() {
  return (
    !busy.value &&
    (!dirty.value ||
      (await confirmAction(
        '저장하지 않은 사용자 정보가 있습니다. 이동할까요?',
        '변경 버리고 이동',
      )))
  );
}
async function close() {
  if (await leave()) editing.value = false;
}
async function reload() {
  if (await leave()) {
    editing.value = false;
    error.value = '';
    await load();
  }
}
async function compareLatest() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (!(await load())) return;
    const latest = selected.value
      ? users.value.find((u) => u.id === selected.value!.id)
      : undefined;
    if (selected.value && (!latest || !latest.canEdit)) {
      editing.value = false;
      error.value = '더 이상 이 사용자를 수정할 수 없습니다.';
      return;
    }
    comparison.value = latest ?? null;
    conflict.value = true;
  } finally {
    busy.value = false;
  }
}
function rebase() {
  if (selected.value && comparison.value)
    selected.value = structuredClone(JSON.parse(JSON.stringify(comparison.value)));
  draftOrganizationRevision.value = doc.value!.revision;
  comparison.value = null;
  conflict.value = false;
  error.value = '';
}
async function save() {
  if (busy.value || !canAccess.value || organizationIssue.value) return;
  const seq = generation;
  busy.value = true;
  error.value = '';
  try {
    await store.command(
      (isTeam.value ? '/team-users' : '/system/users') +
        (selected.value ? '/' + selected.value.id : ''),
      {
        ...form.value,
        ...(selected.value ? { revision: selected.value.revision } : {}),
        ...(isTeam.value ? { organizationRevision: draftOrganizationRevision.value } : {}),
      },
      selected.value ? 'PATCH' : 'POST',
    );
    if (seq !== generation) return;
    editing.value = false;
    await load();
    store.notify('사용자 정보를 저장했습니다.');
  } catch (e) {
    if (seq === generation) {
      error.value = (e as Error).message;
      if (isTeam.value && e instanceof ApiError && e.status === 409) conflict.value = true;
      if (e instanceof ApiError && e.status === 403) clearPrivateState();
    }
  } finally {
    busy.value = false;
  }
}
watch(
  [() => store.actorId, () => (isTeam.value ? store.managementLv1 : ''), canAccess],
  async () => {
    generation++;
    clearPrivateState();
    busy.value = false;
    error.value = '';
    if (!(await load())) return;
    if (route.query.create === '1') {
      edit();
      const id = String(route.query.organizationId || '');
      if (doc.value?.entries.some((e) => e.id === id && e.effectiveActive)) {
        form.value.organizationId = id;
        orgFilter.value = id;
        baseline.value = JSON.stringify(form.value);
      }
    }
  },
  { immediate: true },
);
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
onBeforeUnmount(() => {
  generation++;
});
</script>
<template>
  <div class="section-heading">
    <h1>{{ isTeam ? '팀 사용자 관리' : '사용자 관리' }}</h1>
    <div class="actions">
      <button class="button secondary" :disabled="busy || !canAccess" @click="reload">
        다시 불러오기</button
      ><button class="button primary" :disabled="busy || !canAccess" @click="edit()">
        사용자 추가
      </button>
    </div>
  </div>
  <p v-if="error && !editing" class="error-message" role="alert">{{ error }}</p>
  <AppDialog
    :open="editing && !!doc"
    :title="selected ? `${selected.name} 정보 수정` : '사용자 추가'"
    class="user-drawer"
    @update:open="
      (value) => {
        if (!value) void close();
      }
    "
  >
    <section v-if="editing && doc" class="user-editor">
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <section v-if="isTeam && conflict" aria-label="최신 사용자 정보 비교">
        <button type="button" class="button secondary" :disabled="busy" @click="compareLatest">
          최신 정보 비교
        </button>
        <template v-if="comparison">
          <p>
            현재 저장된 정보: {{ comparison.name }} ·
            {{ comparison.organizationPath.map((p) => p.name).join(' › ') }} ·
            {{ comparison.roles.map((r) => labels[r]).join(' · ') }}
          </p>
        </template>
        <button
          v-if="
            comparison ||
            (conflict && !selected && doc && doc.revision !== draftOrganizationRevision)
          "
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="rebase"
        >
          입력 유지하고 저장 기준 갱신
        </button>
      </section>
      <p v-if="selected" class="muted">
        {{ selected.organizationPath.map((p) => p.name).join(' › ') }}
      </p>
      <section class="user-work-status" aria-label="업무 상태">
        <div class="actions">
          <strong>업무 상태</strong>
          <span
            class="status"
            :class="selected?.workStatus === 'deactive' ? 'status-waiting' : 'status-certified'"
            >{{ selected?.workStatus || 'active' }}</span
          >
          <button
            type="button"
            class="button secondary"
            :disabled="busy || !selected || !!workBlocked(selected, true)"
            aria-describedby="user-work-status-reason"
            @click="selected && (workUser = selected)"
          >
            업무 상태 변경
          </button>
        </div>
        <p
          id="user-work-status-reason"
          class="muted"
          v-if="!selected || workBlocked(selected, true)"
        >
          {{
            selected
              ? workBlocked(selected, true)
              : '사용자 저장 후 업무 상태를 변경할 수 있습니다.'
          }}
        </p>
      </section>
      <form @submit.prevent="save">
        <label class="field"
          ><span>이름</span><input v-model="form.name" required maxlength="100" :disabled="busy"
        /></label>
        <PolicyOrganizationTree
          v-if="isTeam"
          :entries="teamOrganizations"
          :selected="form.organizationId"
          :selectable-ids="selectableOrganizations"
          :disabled="busy"
          embedded
          searchable
          label="변경할 소속 조직"
          @select="selectOrganization"
        >
          <template #status="{ entry }">
            <span
              v-if="!teamOrganizations.find((e) => e.id === entry.id)?.effectiveActive"
              class="muted"
            >
              {{
                entry.id === selected?.organizationId
                  ? '사용 중지 · 현재 소속 유지 가능'
                  : '사용 중지'
              }}
            </span>
          </template>
        </PolicyOrganizationTree>
        <p v-if="organizationIssue" role="alert" class="error-message">{{ organizationIssue }}</p>
        <OrganizationSelect
          v-if="!isTeam"
          v-model="form.organizationId"
          :entries="doc.entries"
          :fixed-lv1="isTeam ? store.managementLv1 : selected?.lv1OrganizationId"
          :disabled="busy"
        />
        <fieldset class="role-choices">
          <legend>역할</legend>
          <label v-for="option in roleOptions" :key="option.value" class="checkbox-field"
            ><input v-model="form.roles" :value="option.value" type="checkbox" :disabled="busy" />{{
              option.label
            }}</label
          >
        </fieldset>
        <p v-if="isTeam && selected?.roles.includes('admin')" class="notice-body">
          팀 조직 관리자 · 지정 유지. 관리자 역할은 시스템 운영에서 관리합니다.
        </p>
        <p v-if="selected?.organizationAdministration" class="notice-body">
          세부 조직 관리자 지정은 조직 정보·필요자격에서 관리합니다. 소속 조직을 변경하면 현재
          지정이 해제되며 새 소속에서 다시 지정해야 합니다.
        </p>
        <p v-if="selected" class="muted">
          같은 Lv1 안에서 소속을 변경할 수 있습니다. 기존 기록의 배정 당시 소속은 유지됩니다.
        </p>
        <div class="actions">
          <button
            class="button primary"
            :disabled="
              busy ||
              !canAccess ||
              !form.name.trim() ||
              !form.organizationId ||
              !!organizationIssue ||
              (!form.roles.length && !(isTeam && selected?.roles.includes('admin')))
            "
          >
            사용자 저장</button
          ><button type="button" class="button secondary" :disabled="busy" @click="close">
            취소
          </button>
        </div>
      </form>
    </section>
  </AppDialog>
  <div class="list-toolbar system-filters">
    <label v-if="isTeam" class="field"
      ><span>업무 상태 필터</span
      ><select aria-label="업무 상태 필터" v-model="workFilter" @change="list.page = 1">
        <option value="">전체 상태</option>
        <option value="active">active</option>
        <option value="deactive">deactive</option>
      </select></label
    >
    <label class="field"
      ><span>사용자 검색</span><input v-model="query" placeholder="이름 또는 조직 경로"
    /></label>
    <label class="field"
      ><span>소속 조직 필터</span
      ><select aria-label="소속 조직 필터" v-model="orgFilter">
        <option value="">전체 조직</option>
        <option v-for="entry in doc?.entries" :key="entry.id" :value="entry.id">
          {{ '　'.repeat(entry.level - 1) }}{{ entry.name }}
        </option>
      </select></label
    >
  </div>

  <div class="table-wrap">
    <table class="work-users-table">
      <thead>
        <tr>
          <th>이름</th>
          <th>역할</th>
          <th>소속 조직</th>
          <th>업무 상태</th>
          <th>관리</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in list.rows" :key="user.id">
          <td data-label="이름">{{ user.name }}</td>
          <td data-label="역할">
            {{
              user.roles
                .filter((r) => r !== 'evaluator')
                .map((r) => labels[r])
                .join(' · ') || '사용자'
            }}
          </td>
          <td
            class="organization-path"
            data-label="소속 조직"
            :title="user.organizationPath.map((p) => p.name).join(' › ')"
          >
            {{
              [
                user.organizationPath[0]?.name.split('(')[0],
                ...(user.organizationPath.length > 1 ? [user.organizationPath.at(-1)?.name] : []),
              ].join(' › ')
            }}<span v-if="!user.organizationActive" class="small-label"> · 사용 중지 조직</span>
          </td>
          <td data-label="업무 상태">
            <span
              class="status"
              :class="user.workStatus === 'deactive' ? 'status-waiting' : 'status-certified'"
              >{{ workStatusLabels[user.workStatus || 'active'] }}</span
            >
            <small v-if="user.workDeactivation" class="muted"
              >{{ user.workDeactivation.startedOn }}부터 · 말소 기준
              {{ user.workDeactivation.revokesOn }}</small
            >
            <small v-if="user.workStatusInfo?.reacquisitionRequired" class="muted"
              >복귀 후 재취득 필요</small
            >
          </td>
          <td data-label="관리">
            <template v-if="user.workStatusInfo">
              <span
                class="work-status-control"
                :title="user.workStatusInfo.blockedReason"
                :tabindex="user.workStatusInfo.blockedReason ? 0 : undefined"
              >
                <button
                  type="button"
                  class="text-link"
                  :disabled="
                    busy ||
                    !user.workStatusInfo.canChange ||
                    (user.workStatus !== 'deactive' && !user.workStatusInfo.canDeactivate)
                  "
                  :title="user.workStatusInfo.blockedReason"
                  :aria-label="`${user.name} 업무 상태 변경`"
                  @click="workUser = user"
                >
                  업무 상태 변경
                </button>
              </span>
              <small v-if="workBlocked(user)" class="muted">{{ workBlocked(user) }}</small>
            </template>
            <button
              class="text-link"
              v-if="!isTeam || user.canEdit"
              :disabled="busy"
              :aria-label="`${user.name} 수정`"
              @click="edit(user)"
            >
              수정
            </button>
            <span v-else class="muted">{{ user.editBlockedReason }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <ListControls
    :count="list.count"
    :pages="list.pages"
    v-model:page="list.page"
    v-model:size="list.size"
    v-model:sort="list.sort"
  />
  <p v-if="!listed.length" class="empty-state">해당하는 사용자가 없습니다.</p>
  <WorkStatusDialog
    v-if="workUser && doc"
    :user="workUser"
    :organization-revision="doc.revision"
    @close="workUser = null"
    @saved="workSaved"
  />
</template>

<style scoped>
.user-work-status {
  padding: 1rem 0;
  border-block: 1px solid var(--hairline);
  margin-bottom: 1rem;
}
.user-work-status .actions {
  flex-wrap: wrap;
  justify-content: flex-start;
}
.user-work-status .actions button {
  margin-left: auto;
}
.user-work-status p.muted {
  margin: 0.5rem 0 0;
}
.work-users-table td {
  overflow-wrap: anywhere;
}
.work-users-table small {
  display: block;
  max-width: 24rem;
}
.work-users-table td[data-label='관리'] .text-link {
  margin-right: 0.75rem;
}
@media (max-width: 640px) {
  .work-users-table,
  .work-users-table tbody {
    display: block;
    min-width: 0;
    width: 100%;
  }
  .work-users-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .work-users-table tr {
    display: block;
    border: 1px solid var(--hairline, #e3e8ee);
    margin-bottom: 1rem;
    border-radius: 8px;
    padding: 0.5rem;
  }
  .work-users-table td {
    display: grid;
    grid-template-columns: 5rem minmax(0, 1fr);
    height: auto;
    min-height: var(--row-compact);
    align-items: start;
    padding: 0.5rem;
    border: 0;
  }
  .work-users-table td::before {
    content: attr(data-label);
    grid-column: 1;
    font-weight: 600;
  }
  .work-users-table td > * {
    grid-column: 2;
    justify-self: start;
    text-align: left;
    max-width: 100%;
  }
}
</style>
