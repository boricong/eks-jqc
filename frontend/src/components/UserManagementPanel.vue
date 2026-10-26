<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import { api, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
import {
  roleLabels,
  teamEditableRoles,
  type Role,
  type UserView,
  type OrganizationView,
  type TeamUsersView,
  type TeamUserView,
} from '@eks/contracts';
import OrganizationSelect from './OrganizationSelect.vue';
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
    .filter(([value]) =>
      isTeam.value ? teamEditableRoles.some((r) => r === value) : value !== 'organization_admin',
    )
    .map(([value, label]) => ({ value: value as Role, label })),
);
type ListedUser = UserView & Partial<Pick<TeamUserView, 'canEdit' | 'editBlockedReason'>>;
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
const preferencesKey = [props.mode, store.actorId, isTeam.value ? store.managementLv1 : 'all'].join(
  ':',
);
const listed = computed(() =>
  users.value.filter(
    (u) =>
      (!orgFilter.value || u.organizationPath.some((p) => p.id === orgFilter.value)) &&
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
let generation = 0,
  auditorSequence = 0;
const addingAuditor = computed(
  () => form.value.roles.includes('evaluator') && !selected.value?.roles.includes('evaluator'),
);
const auditorPreview = ref<{
  readiness: { ready: boolean; reasons: string[] };
  program: {
    notice: { title: string; body: string; links: { title: string; url: string }[] };
  } | null;
}>();
const auditorError = ref('');
watch([addingAuditor, () => form.value.organizationId], async () => {
  const seq = ++auditorSequence;
  auditorPreview.value = undefined;
  auditorError.value = '';
  const team = doc.value?.entries.find(
    (e) => e.id === form.value.organizationId,
  )?.lv1OrganizationId;
  if (!editing.value || !addingAuditor.value || !team) return;
  try {
    const result = await api<typeof auditorPreview.value>(
      '/auditor-program?lv1OrganizationId=' + encodeURIComponent(team),
    );
    if (seq === auditorSequence) auditorPreview.value = result;
  } catch (e) {
    if (seq === auditorSequence) auditorError.value = (e as Error).message;
  }
});
function clearPrivateState() {
  users.value = [];
  doc.value = null;
  selected.value = null;
  editing.value = false;
  comparison.value = null;
  auditorSequence++;
  auditorPreview.value = undefined;
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
    (!isTeam.value ||
      !dirty.value ||
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
  if (busy.value || !canAccess.value) return;
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
  auditorSequence++;
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
      <form @submit.prevent="save">
        <label class="field"
          ><span>이름</span><input v-model="form.name" required maxlength="100" :disabled="busy"
        /></label>
        <OrganizationSelect
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
        <p class="muted">
          Auditor는 지정된 필수학습을 홈에서 시작합니다. 일반·메인 등급은 취득 인증으로 결정합니다.
          지정 해제 후에도 이미 시작한 학습과 기존 인증은 유지됩니다.
        </p>
        <section v-if="addingAuditor" aria-label="Auditor 지정 안내 미리보기">
          <p v-if="auditorError" role="alert">{{ auditorError }}</p>
          <p v-if="!auditorError && !auditorPreview" role="status">
            팀의 지정 준비 상태를 확인하고 있습니다.
          </p>
          <template v-if="auditorPreview"
            ><p>신규 지정 준비 · {{ auditorPreview.readiness.ready ? '완료' : '확인 필요' }}</p>
            <ul>
              <li v-for="reason in auditorPreview.readiness.reasons" :key="reason">{{ reason }}</li>
            </ul>
            <h3>{{ auditorPreview.program?.notice.title }}</h3>
            <p style="white-space: pre-wrap">{{ auditorPreview.program?.notice.body }}</p>
            <p v-for="link in auditorPreview.program?.notice.links" :key="link.url">
              <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.title }}</a>
            </p>
            <p class="muted">
              저장과 함께 앱 내 안내 및 Auditor 학습 진입 링크를 한 번 보냅니다.
            </p></template
          >
        </section>
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
              (!form.roles.length && !(isTeam && selected?.roles.includes('admin'))) ||
              (isTeam && addingAuditor && (!auditorPreview?.readiness.ready || !!auditorError))
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
    <table>
      <thead>
        <tr>
          <th>이름</th>
          <th>역할</th>
          <th>소속 조직</th>
          <th>관리</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in list.rows" :key="user.id">
          <td>{{ user.name }}</td>
          <td>{{ user.roles.map((r) => labels[r]).join(' · ') }}</td>
          <td
            class="organization-path"
            :title="user.organizationPath.map((p) => p.name).join(' › ')"
          >
            {{
              [
                user.organizationPath[0]?.name.split('(')[0],
                ...(user.organizationPath.length > 1 ? [user.organizationPath.at(-1)?.name] : []),
              ].join(' › ')
            }}<span v-if="!user.organizationActive" class="small-label"> · 사용 중지 조직</span>
          </td>
          <td>
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
</template>
