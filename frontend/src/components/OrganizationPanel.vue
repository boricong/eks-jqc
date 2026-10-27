<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import type { OrganizationView, OrganizationEntry } from '@eks/contracts';
import AppDialog from './AppDialog.vue';
const store = useDemo();
const doc = shallowRef<OrganizationView | null>(null),
  selectedId = ref(''),
  query = ref('');
const collapsed = ref(new Set<string>()),
  searchCollapsed = ref(new Set<string>()),
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
const parentIds = computed(
  () => new Set(doc.value?.entries.flatMap((entry) => (entry.parentId ? [entry.parentId] : []))),
);
const search = computed(() => query.value.trim().toLowerCase());
const activeCollapsed = computed(() => (search.value ? searchCollapsed.value : collapsed.value));
watch(
  search,
  () => {
    searchCollapsed.value = new Set();
  },
  { flush: 'sync' },
);
const visible = computed(() => {
  const entries = doc.value?.entries ?? [];
  let candidates = entries;
  if (search.value) {
    const ids = new Set(
      entries
        .filter((entry) =>
          entry.path
            .map((part) => part.name)
            .join(' ')
            .toLowerCase()
            .includes(search.value),
        )
        .flatMap((entry) => entry.path.map((part) => part.id)),
    );
    candidates = entries.filter((entry) => ids.has(entry.id));
  }
  return candidates.filter(
    (entry) => !entry.path.slice(0, -1).some((part) => activeCollapsed.value.has(part.id)),
  );
});
function setCollapsed(value: Set<string>) {
  if (search.value) searchCollapsed.value = value;
  else collapsed.value = value;
}
function collapseAll() {
  setCollapsed(new Set(parentIds.value));
}
function select(entry: OrganizationEntry) {
  selectedId.value = entry.id;
  creating.value = false;
  error.value = '';
  form.value = { name: entry.name, parentId: entry.parentId, active: entry.active };
}
let contextVersion = 0,
  loadVersion = 0;
async function load(id = selectedId.value, reset = false, reveal = false) {
  const context = contextVersion,
    request = ++loadVersion;
  try {
    const result = await api<OrganizationView>('/system/organizations');
    if (context !== contextVersion || request !== loadVersion) return false;
    const previousParents = parentIds.value;
    doc.value = result;
    collapsed.value = reset
      ? new Set(parentIds.value)
      : new Set(
          [
            ...collapsed.value,
            ...[...parentIds.value].filter((key) => !previousParents.has(key)),
          ].filter((key) => parentIds.value.has(key)),
        );
    const entry = result.entries.find((entry) => entry.id === id) ?? result.entries[0];
    if (entry) {
      select(entry);
      if (reveal) await revealSelected();
    }
    return context === contextVersion && request === loadVersion;
  } catch (err) {
    if (context === contextVersion && request === loadVersion) error.value = (err as Error).message;
    return false;
  }
}
function add(parentId: string | null) {
  creating.value = true;
  error.value = '';
  form.value = { name: '', parentId, active: true };
}
function toggle(id: string) {
  const next = new Set(activeCollapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setCollapsed(next);
}
async function revealSelected() {
  query.value = '';
  const next = new Set(collapsed.value);
  selected.value?.path.slice(0, -1).forEach((p) => next.delete(p.id));
  collapsed.value = next;
  await nextTick();
  document.querySelector('.tree-node[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
}
async function save(order?: number) {
  if (!doc.value || busy.value) return;
  const context = contextVersion;
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
    if (context !== contextVersion) return;
    confirm.value = false;
    query.value = '';
    if (await load(result.id, false, true)) store.notify('조직정보를 저장했습니다.');
  } catch (err) {
    if (context === contextVersion) error.value = (err as Error).message;
  } finally {
    if (context === contextVersion) busy.value = false;
  }
}
function reviewSave() {
  if (!creating.value && selected.value?.active && !form.value.active) confirm.value = true;
  else void save();
}
watch(
  () => store.actorId,
  () => {
    contextVersion++;
    doc.value = null;
    selectedId.value = '';
    query.value = '';
    collapsed.value = new Set();
    searchCollapsed.value = new Set();
    error.value = '';
    busy.value = false;
    creating.value = false;
    confirm.value = false;
    form.value = { name: '', parentId: null, active: true };
    void load('', true);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  contextVersion++;
  loadVersion++;
});
</script>
<template>
  <div class="section-heading organization-heading">
    <h1>조직 관리</h1>
    <button class="button primary" :disabled="busy" @click="add(null)">Lv1 조직 추가</button>
  </div>
  <div v-if="error && !confirm" class="error-message" role="alert">{{ error }}</div>
  <div v-if="doc" class="organization-layout">
    <section class="panel organization-tree" aria-label="조직 트리">
      <div class="organization-tree-toolbar">
        <div class="organization-tree-tools">
          <button class="text-link" @click="setCollapsed(new Set())">모두 펼치기</button>
          <button class="text-link" @click="collapseAll">모두 접기</button>
        </div>
        <label class="organization-search"
          ><span>조직 검색</span>
          <input v-model="query" type="search" placeholder="조직명 또는 경로" />
        </label>
      </div>
      <ul class="organization-nodes">
        <li
          v-for="entry in visible"
          :key="entry.id"
          :style="{ paddingLeft: `${Math.min(entry.level - 1, 5) * 14}px` }"
        >
          <button
            v-if="parentIds.has(entry.id)"
            class="tree-toggle"
            :aria-label="`${entry.name} ${activeCollapsed.has(entry.id) ? '펼치기' : '접기'}`"
            :aria-expanded="!activeCollapsed.has(entry.id)"
            @click="toggle(entry.id)"
          >
            {{ activeCollapsed.has(entry.id) ? '+' : '−' }}
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
      <p v-if="!visible.length" class="organization-search-empty">검색 결과가 없습니다.</p>
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
          :to="{ path: '/system/users', query: { create: '1', organizationId: selected.id } }"
          >사용자 등록</RouterLink
        >
        <button
          class="button secondary"
          :disabled="busy || !selected.effectiveActive"
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
