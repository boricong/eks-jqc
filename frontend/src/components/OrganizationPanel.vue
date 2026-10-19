<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import type { OrganizationView, OrganizationEntry } from '@eks/contracts';
import AppDialog from './AppDialog.vue';
const store = useDemo();
const doc = shallowRef<OrganizationView | null>(null),
  selectedId = ref(''),
  query = ref('');
const collapsed = ref(new Set<string>()),
  error = ref(''),
  busy = ref(false),
  creating = ref(false),
  confirm = ref(false);
const form = ref({ name: '', parentId: null as string | null, active: true });
const selected = computed(() => doc.value?.entries.find((e) => e.id === selectedId.value));
const dirty = computed(
  () =>
    !creating.value &&
    !!selected.value &&
    (form.value.name !== selected.value.name ||
      form.value.parentId !== selected.value.parentId ||
      form.value.active !== selected.value.active),
);
function describe(value: unknown) {
  const entry = value as OrganizationEntry | null;
  return entry
    ? entry.path.map((p) => p.name).join(' › ') +
        ' · ' +
        (entry.active ? '사용' : '사용 중지') +
        ' · 표시 순서 ' +
        (entry.order + 1)
    : '신규 조직';
}
const level = computed(() =>
  creating.value
    ? (doc.value?.entries.find((e) => e.id === form.value.parentId)?.level ?? 0) + 1
    : (selected.value?.level ?? 1),
);
const parents = computed(
  () =>
    doc.value?.entries.filter(
      (e) =>
        e.level === level.value - 1 &&
        (creating.value || e.lv1OrganizationId === selected.value?.lv1OrganizationId) &&
        (e.effectiveActive || e.id === selected.value?.parentId),
    ) ?? [],
);
const visible = computed(() => {
  const entries = doc.value?.entries ?? [],
    search = query.value.trim().toLowerCase();
  if (search) {
    const ids = new Set(
      entries
        .filter((e) =>
          e.path
            .map((p) => p.name)
            .join(' ')
            .toLowerCase()
            .includes(search),
        )
        .flatMap((e) => e.path.map((p) => p.id)),
    );
    return entries.filter((e) => ids.has(e.id));
  }
  return entries.filter((e) => !e.path.slice(0, -1).some((p) => collapsed.value.has(p.id)));
});
const history = computed(
  () =>
    doc.value?.audits
      .filter((ev) => ev.targetId === selectedId.value)
      .slice()
      .reverse() ?? [],
);
function select(entry: OrganizationEntry) {
  selectedId.value = entry.id;
  creating.value = false;
  error.value = '';
  form.value = { name: entry.name, parentId: entry.parentId, active: entry.active };
}
async function load(id = selectedId.value) {
  try {
    doc.value = await api<OrganizationView>('/system/organizations');
    const entry = doc.value.entries.find((e) => e.id === id) ?? doc.value.entries[0];
    if (entry) select(entry);
  } catch (err) {
    error.value = (err as Error).message;
  }
}
function add(parentId: string | null) {
  creating.value = true;
  error.value = '';
  form.value = { name: '', parentId, active: true };
}
function toggle(id: string) {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}
async function save(order?: number) {
  if (!doc.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await store.command(
      `/system/organizations${creating.value ? '' : `/${selectedId.value}`}`,
      {
        ...form.value,
        revision: doc.value.revision,
        ...(order === undefined ? {} : { order }),
      },
      creating.value ? 'POST' : 'PATCH',
    );
    confirm.value = false;
    query.value = '';
    await load(result.id);
    store.notify('조직정보를 저장했습니다.');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
function reviewSave() {
  if (!creating.value && selected.value?.active && !form.value.active) confirm.value = true;
  else void save();
}
onMounted(() => load());
</script>
<template>
  <div class="section-heading">
    <h1>조직 관리</h1>
    <button class="button primary" :disabled="busy" @click="add(null)">Lv1 조직 추가</button>
    <button class="button secondary" :disabled="busy" @click="load()">다시 불러오기</button>
  </div>
  <p class="muted">
    Lv1 단위로 자격 인증 업무를 관리합니다. 조직정보는 진행 초기화 후에도 유지됩니다.
  </p>
  <div v-if="error && !confirm" class="error-message" role="alert">{{ error }}</div>
  <div v-if="doc" class="organization-layout">
    <section class="panel organization-tree" aria-label="조직 트리">
      <label class="field"
        ><span>조직 검색</span><input v-model="query" placeholder="조직명 또는 경로"
      /></label>
      <div class="actions">
        <button class="text-link" @click="collapsed = new Set()">모두 펼치기</button>
      </div>
      <ul class="organization-nodes">
        <li
          v-for="entry in visible"
          :key="entry.id"
          :style="{ paddingLeft: `${(entry.level - 1) * 14}px` }"
        >
          <button
            v-if="doc.entries.some((e) => e.parentId === entry.id)"
            class="tree-toggle"
            :aria-label="`${entry.name} ${collapsed.has(entry.id) ? '펼치기' : '접기'}`"
            :aria-expanded="!collapsed.has(entry.id)"
            @click="toggle(entry.id)"
          >
            {{ collapsed.has(entry.id) ? '+' : '−' }}
          </button>
          <span v-else class="tree-toggle-placeholder"></span>
          <button
            class="tree-node"
            :class="{ selected: selectedId === entry.id && !creating }"
            :aria-current="selectedId === entry.id && !creating ? 'true' : undefined"
            :disabled="busy"
            @click="select(entry)"
          >
            <span class="small-label">Lv{{ entry.level }}</span
            ><span>{{ entry.name }}</span
            ><small v-if="!entry.effectiveActive">사용 중지</small>
          </button>
        </li>
      </ul>
    </section>
    <section class="panel editor-panel organization-detail">
      <div class="section-heading">
        <h2>{{ creating ? '조직 추가' : '조직 상세' }}</h2>
        <span class="small-label">Lv{{ level }}</span>
      </div>
      <p v-if="!creating" class="muted organization-path">
        {{ selected?.path.map((p) => p.name).join(' › ') }}
      </p>
      <form @submit.prevent="reviewSave">
        <label class="field"
          ><span>조직명</span><input v-model="form.name" required maxlength="200" :disabled="busy"
        /></label>
        <label v-if="level > 1" class="field"
          ><span>상위 조직</span
          ><select aria-label="상위 조직" v-model="form.parentId" :disabled="busy">
            <option v-for="entry in parents" :key="entry.id" :value="entry.id">
              {{ entry.path.map((p) => p.name).join(' › ') }}
            </option>
          </select></label
        >
        <label v-if="!creating || level > 1" class="checkbox-field"
          ><input v-model="form.active" type="checkbox" :disabled="busy" />조직 사용</label
        >
        <p v-if="!creating" class="muted">하위 조직 포함 소속 사용자 {{ selected?.userCount }}명</p>
        <div class="actions">
          <button class="button primary" :disabled="busy || !form.name.trim()">
            {{ busy ? '저장 중' : '조직 저장' }}</button
          ><button type="button" class="button secondary" :disabled="busy" @click="load()">
            취소
          </button>
        </div>
      </form>
      <div v-if="!creating && selected" class="actions organization-extra-actions">
        <RouterLink
          class="button secondary"
          :to="store.managementLink('/admin/qualifications', selected.lv1OrganizationId)"
          >이 조직의 인증 업무 관리</RouterLink
        >
        <RouterLink
          class="button secondary"
          :to="{ path: '/system/users', query: { create: '1', organizationId: selected.id } }"
          >사용자 등록</RouterLink
        >
        <button
          class="button secondary"
          :disabled="busy || selected.level === 4 || !selected.effectiveActive"
          @click="add(selected.id)"
        >
          하위 조직 추가
        </button>
        <button
          class="button secondary"
          :disabled="busy || dirty || selected.order === 0"
          @click="save(selected.order - 1)"
        >
          위로 이동
        </button>
        <button
          class="button secondary"
          :disabled="
            busy ||
            dirty ||
            selected.order ===
              doc.entries.filter((e) => e.parentId === selected?.parentId).length - 1
          "
          @click="save(selected.order + 1)"
        >
          아래로 이동
        </button>
      </div>
      <details v-if="!creating" class="organization-history">
        <summary>변경 이력 {{ history.length }}건</summary>
        <p v-if="!history.length" class="muted">최초 등록 이후 변경이 없습니다.</p>
        <article v-for="event in history" :key="event.id">
          <p>
            {{ new Date(event.date).toLocaleString('ko-KR') }} · {{ store.username(event.actorId) }}
          </p>
          <p>이전: {{ describe(event.before) }}</p>
          <p>이후: {{ describe(event.after) }}</p>
        </article>
      </details>
    </section>
  </div>
  <AppDialog
    :open="confirm"
    title="조직 사용을 중지할까요?"
    @update:open="
      (v) => {
        if (!busy) confirm = v;
      }
    "
  >
    <p>{{ selected?.name }} 및 하위 조직에 신규 사용자 소속·자격 배정을 할 수 없게 됩니다.</p>
    <p>기존 사용자 {{ selected?.userCount }}명의 소속과 진행·과거 기록은 유지됩니다.</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="confirm = false">취소</button
      ><button class="button primary" :disabled="busy" @click="save()">사용 중지</button></template
    >
  </AppDialog>
</template>
