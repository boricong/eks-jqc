<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import { roleLabels, type Role, type UserView, type OrganizationView } from '@eks/contracts';
import OrganizationSelect from './OrganizationSelect.vue';
import AppDialog from './AppDialog.vue';
import ListControls from './ListControls.vue';
import { useListView } from '../composables/useListView';
import { useRoute } from 'vue-router';
const route = useRoute();
const store = useDemo();
const labels = roleLabels;
const roleOptions = Object.entries(roleLabels)
  .filter(([value]) => value !== 'organization_admin')
  .map(([value, label]) => ({
    value: value as Role,
    label,
  }));
const users = ref<UserView[]>([]),
  doc = shallowRef<OrganizationView | null>(null),
  query = ref(''),
  orgFilter = ref('');
const selected = ref<UserView | null>(null),
  editing = ref(false),
  busy = ref(false),
  error = ref('');
const form = ref({ name: '', organizationId: '', roles: ['learner'] as Role[] });
const listed = computed(() =>
  users.value.filter(
    (u) =>
      (!orgFilter.value || u.organizationPath.some((p) => p.id === orgFilter.value)) &&
      `${u.name} ${u.organizationPath.map((p) => p.name).join(' ')}`
        .toLowerCase()
        .includes(query.value.toLowerCase()),
  ),
);
const list = useListView(listed, 'users', (user) => user.name);
try {
  const preferences = JSON.parse(localStorage.getItem('eks-users-filter') || '{}');
  query.value = preferences.query || '';
  orgFilter.value = preferences.organization || '';
} catch {}
watch([query, orgFilter], () => {
  list.page = 1;
  localStorage.setItem(
    'eks-users-filter',
    JSON.stringify({ query: query.value, organization: orgFilter.value }),
  );
});
async function load() {
  try {
    [users.value, doc.value] = await Promise.all([
      api<UserView[]>('/system/users'),
      api<OrganizationView>('/system/organizations'),
    ]);
  } catch (err) {
    error.value = (err as Error).message;
  }
}
function edit(user?: UserView) {
  selected.value = user ? structuredClone(JSON.parse(JSON.stringify(user))) : null;
  form.value = {
    name: user?.name ?? '',
    organizationId: user?.organizationId ?? '',
    roles: user ? user.roles.filter((r) => r !== 'organization_admin') : ['learner'],
  };
  editing.value = true;
  error.value = '';
}
async function save() {
  busy.value = true;
  error.value = '';
  try {
    await store.command(
      `/system/users${selected.value ? `/${selected.value.id}` : ''}`,
      {
        ...form.value,
        ...(selected.value ? { revision: selected.value.revision } : {}),
      },
      selected.value ? 'PATCH' : 'POST',
    );
    editing.value = false;
    await load();
    store.notify('사용자 정보를 저장했습니다.');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  await load();
  if (route.query.create === '1') {
    edit();
    const id = String(route.query.organizationId || '');
    if (doc.value?.entries.some((e) => e.id === id && e.effectiveActive)) {
      form.value.organizationId = id;
      orgFilter.value = id;
    }
  }
});
</script>
<template>
  <div class="section-heading">
    <h1>사용자 관리</h1>
    <div class="actions">
      <button
        class="button secondary"
        :disabled="busy"
        @click="
          editing = false;
          load();
        "
      >
        다시 불러오기</button
      ><button class="button primary" :disabled="busy" @click="edit()">사용자 추가</button>
    </div>
  </div>
  <p v-if="error" class="error-message" role="alert">{{ error }}</p>
  <AppDialog
    :open="editing && !!doc"
    :title="selected ? `${selected.name} 정보 수정` : '사용자 추가'"
    class="user-drawer"
    @update:open="editing = false"
  >
    <section v-if="editing && doc" class="user-editor">
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
          :fixed-lv1="selected?.lv1OrganizationId"
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
        <p v-if="selected?.organizationAdministration" class="notice-body">
          세부 조직 관리자 지정은 조직별 자격 설정에서 관리합니다. 소속 조직을 변경하면 현재 지정이
          해제되며 새 소속에서 다시 지정해야 합니다.
        </p>
        <p v-if="selected" class="muted">
          같은 Lv1 안에서 소속을 변경할 수 있습니다. 기존 기록의 배정 당시 소속은 유지됩니다.
        </p>
        <div class="actions">
          <button
            class="button primary"
            :disabled="busy || !form.name.trim() || !form.organizationId || !form.roles.length"
          >
            사용자 저장</button
          ><button type="button" class="button secondary" :disabled="busy" @click="editing = false">
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
  <ListControls
    :count="list.count"
    :pages="list.pages"
    v-model:page="list.page"
    v-model:size="list.size"
    v-model:density="list.density"
    v-model:sort="list.sort"
  />
  <div class="table-wrap" :data-density="list.density">
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
              :disabled="busy"
              :aria-label="`${user.name} 수정`"
              @click="edit(user)"
            >
              수정
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-if="!listed.length" class="empty-state">해당하는 사용자가 없습니다.</p>
</template>
