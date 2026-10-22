<script setup lang="ts">
import PageHeading from './PageHeading.vue';
import { confirmAction } from '../composables/useConfirmation';
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import type { Notice } from '@eks/contracts';
import AppDialog from './AppDialog.vue';
const store = useDemo(),
  notices = ref<Notice[]>([]),
  error = ref(''),
  busy = ref(false),
  query = ref('');
const draft = ref<{
  id?: string;
  revision?: number;
  title: string;
  body: string;
  published: boolean;
}>();
const baseline = ref('');
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value);
const listed = computed(() =>
  notices.value
    .filter((n) => n.title.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
);
let generation = 0;
async function load() {
  const actor = store.actorId,
    seq = ++generation;
  try {
    const result = await api<Notice[]>('/system/notices');
    if (actor === store.actorId && seq === generation) notices.value = result;
  } catch (e) {
    if (actor === store.actorId && seq === generation) error.value = (e as Error).message;
  }
}
function edit(n?: Notice) {
  draft.value = n
    ? { id: n.id, revision: n.revision, title: n.title, body: n.body, published: n.published }
    : { title: '', body: '', published: false };
  baseline.value = JSON.stringify(draft.value);
  error.value = '';
}
async function close() {
  if (
    busy.value ||
    (dirty.value &&
      !(await confirmAction('저장하지 않은 공지 내용을 취소할까요?', '공지 편집 취소')))
  )
    return;
  draft.value = undefined;
}
async function leave() {
  return (
    !busy.value &&
    (!dirty.value ||
      (await confirmAction(
        '공지를 저장하지 않았습니다. 변경을 취소하고 이동할까요?',
        '변경 버리고 이동',
      )))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
async function save() {
  if (!draft.value || busy.value) return;
  const actor = store.actorId;
  busy.value = true;
  error.value = '';
  try {
    await store.command('/system/notices', { ...draft.value, scope: 'system' });
    if (actor !== store.actorId) return;
    draft.value = undefined;
    await load();
    store.notify('전 조직 시스템 공지를 저장했습니다.');
  } catch (e) {
    if (actor === store.actorId) error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
watch(
  () => store.actorId,
  () => {
    draft.value = undefined;
    notices.value = [];
    void load();
  },
  { immediate: true },
);
</script>
<template>
  <div class="text-stack">
    <PageHeading class="page-heading">
      <div>
        <h1>시스템 공지 관리</h1>
        <p class="muted">게시 대상: 전 조직의 모든 사용자</p>
      </div>
      <button class="button primary" @click="edit()">시스템 공지 작성</button>
    </PageHeading>
    <label class="field">공지 검색<input v-model="query" /></label>
    <p v-if="error && !draft" class="error-message" role="alert">{{ error }}</p>
    <div class="table-panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>제목</th>
            <th>게시일</th>
            <th>상태</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in listed" :key="n.id">
            <td>{{ n.title }}</td>
            <td>{{ n.date }}</td>
            <td>{{ n.published ? '게시 중' : '미게시' }}</td>
            <td><button class="button secondary small" @click="edit(n)">편집</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!listed.length" class="empty-state">등록된 시스템 공지가 없습니다.</p>
    </div>
    <AppDialog :open="!!draft" title="시스템 공지 편집" @update:open="close"
      ><template v-if="draft"
        ><p class="notice-body">게시하면 전 조직 홈의 시스템 공지에 표시됩니다.</p>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <label class="field"
          >제목<input v-model="draft.title" maxlength="300" :disabled="busy" /></label
        ><label class="field"
          >내용<textarea v-model="draft.body" rows="8" maxlength="20000" :disabled="busy" /></label
        ><label class="checkbox-field"
          ><input v-model="draft.published" type="checkbox" :disabled="busy" />전 조직에 게시</label
        ></template
      ><template #footer
        ><button class="button secondary" :disabled="busy" @click="close">취소</button
        ><button class="button primary" :disabled="busy" @click="save">공지 저장</button></template
      ></AppDialog
    >
  </div>
</template>
