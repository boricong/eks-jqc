<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { qualificationTypeLabels, type QualificationType } from '@eks/contracts';
import type { QualificationTemplate, AuditEvent } from '@eks/contracts';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
import AppDialog from './AppDialog.vue';
type TemplateItem = QualificationTemplate & { canChangeType: boolean; typeChangeReason: string };
const typeFilter = ref('all');
const typeEditing = computed(() => items.value.find((t) => t.id === draft.value?.id));
const store = useDemo(),
  items = ref<TemplateItem[]>([]),
  audits = ref<AuditEvent[]>([]),
  query = ref(''),
  error = ref(''),
  busy = ref(false);
const draft = ref<{
  id?: string;
  revision?: number;
  qualificationType: QualificationType;
  title: string;
  englishName: string;
  description: string;
}>();
const baseline = ref('');
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value);
const listed = computed(() =>
  items.value.filter(
    (t) =>
      (typeFilter.value === 'all' || t.qualificationType === typeFilter.value) &&
      `${t.title} ${t.englishName}`.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
let generation = 0;
async function load() {
  const seq = ++generation,
    actor = store.actorId;
  try {
    const result = await api<{ items: TemplateItem[]; audits: AuditEvent[] }>(
      '/system/qualification-templates',
    );
    if (seq === generation && actor === store.actorId) {
      items.value = result.items;
      audits.value = result.audits;
    }
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  }
}
function edit(item?: QualificationTemplate) {
  draft.value = item
    ? {
        id: item.id,
        qualificationType: item.qualificationType,
        revision: item.revision,
        title: item.title,
        englishName: item.englishName,
        description: item.description,
      }
    : { qualificationType: 'auditee', title: '', englishName: '', description: '' };
  baseline.value = JSON.stringify(draft.value);
  error.value = '';
}
async function leave() {
  return (
    !busy.value &&
    (!dirty.value ||
      (await confirmAction('기본자격 편집을 취소하고 이동할까요?', '변경 버리고 이동')))
  );
}
async function close() {
  if (await leave()) draft.value = undefined;
}
async function save() {
  if (!draft.value || busy.value || !draft.value.title.trim()) return;
  const actor = store.actorId,
    { id, ...body } = draft.value;
  busy.value = true;
  error.value = '';
  try {
    await store.command(
      `/system/qualification-templates${id ? `/${id}` : ''}`,
      body,
      id ? 'PUT' : 'POST',
    );
    if (actor !== store.actorId) return;
    draft.value = undefined;
    await load();
    store.notify('기본자격을 저장했습니다. 현재 팀 목록에 공통 정보가 반영됩니다.');
  } catch (e) {
    if (actor === store.actorId) error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function historyChanges(a: AuditEvent) {
  const d = a.details as {
    before?: Partial<QualificationTemplate>;
    after?: Partial<QualificationTemplate>;
  };
  return (['title', 'englishName', 'description', 'qualificationType'] as const)
    .filter((k) => d?.before?.[k] !== d?.after?.[k])
    .map((k) => ({
      label: {
        title: '자격명',
        englishName: '영문명',
        description: '설명',
        qualificationType: '인증 유형',
      }[k],
      before: d?.before?.[k] || '없음',
      after: d?.after?.[k] || '없음',
    }));
}
async function reloadDraft() {
  const id = draft.value?.id;
  if (!id || !(await leave())) return;
  await load();
  const latest = items.value.find((t) => t.id === id);
  if (latest) edit(latest);
}
function focus() {
  if (!draft.value) void load();
}
onMounted(() => window.addEventListener('focus', focus));
onBeforeUnmount(() => {
  generation++;
  window.removeEventListener('focus', focus);
});
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
watch(
  () => store.actorId,
  () => {
    draft.value = undefined;
    items.value = [];
    audits.value = [];
    void load();
  },
  { immediate: true },
);
</script>
<template>
  <div class="text-stack">
    <div class="section-heading">
      <h1>기본자격 관리</h1>
      <button class="button primary" @click="edit()">새 기본자격 만들기</button>
    </div>
    <div class="list-toolbar">
      <label class="field">기본자격 검색<input v-model="query" type="search" /></label>
      <label class="field"
        >인증 유형<select v-model="typeFilter" aria-label="인증 유형 필터">
          <option value="all">전체</option>
          <option value="auditee">Auditee</option>
          <option value="auditor">Auditor</option>
        </select></label
      >
    </div>
    <p v-if="error && !draft" class="error-message" role="alert">{{ error }}</p>
    <div class="table-panel template-table">
      <table>
        <thead>
          <tr>
            <th>기본자격명</th>
            <th>영문명</th>
            <th>유형</th>
            <th>설정</th>
            <th>수정 번호</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in listed" :key="t.id">
            <td>
              <button class="text-button" @click="edit(t)">{{ t.title }}</button>
            </td>
            <td>{{ t.englishName || '—' }}</td>
            <td>{{ qualificationTypeLabels[t.qualificationType] }}</td>
            <td>{{ t.description ? '설명 등록됨' : '—' }}</td>
            <td>{{ t.revision }}</td>
            <td><button class="button ghost" @click="edit(t)">수정</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!listed.length" class="empty-state">등록된 기본자격이 없습니다.</p>
    </div>
    <AppDialog :open="!!draft" title="기본자격 편집" @update:open="(value) => !value && close()">
      <template v-if="draft"
        ><p class="muted">
          공통 정보는 현재 팀 목록에 반영됩니다. 확정된 계획·평가·인증의 당시 정보는 유지됩니다.
        </p>
        <div v-if="error" role="alert">
          <p class="error-message">{{ error }}</p>
          <button v-if="draft.id" class="button secondary" :disabled="busy" @click="reloadDraft">
            최신 정보 다시 불러오기
          </button>
        </div>
        <label class="field"
          >인증 유형<select
            aria-label="인증 유형"
            aria-describedby="template-type-reason"
            v-model="draft.qualificationType"
            :disabled="busy || (!!draft.id && !typeEditing?.canChangeType)"
          >
            <option value="auditee">Auditee(피심사자)</option>
            <option value="auditor">Auditor(심사자)</option>
          </select></label
        >
        <p id="template-type-reason" class="muted">
          {{ typeEditing?.typeChangeReason || '팀 등록 전까지 유형을 변경할 수 있습니다.' }}
        </p>
        <p v-if="draft.qualificationType === 'auditor'" class="muted">
          Auditor는 필수 학습항목의 본인 완료 확인으로 수료·인증됩니다.
        </p>
        <label class="field"
          >기본자격명<input v-model="draft.title" :disabled="busy" maxlength="300" required
        /></label>
        <label class="field"
          >영문명<input v-model="draft.englishName" :disabled="busy" maxlength="300"
        /></label>
        <label class="field"
          >공통 설명 (선택)<textarea
            v-model="draft.description"
            :disabled="busy"
            rows="4"
            maxlength="20000"
          />
        </label>
        <p v-if="!draft.description.trim()" class="muted">
          설명은 선택 항목이며 비워 두어도 자격을 사용할 수 있습니다.
        </p>
        <details v-if="draft.id">
          <summary>변경 이력</summary>
          <ol class="template-history">
            <li
              v-for="a in audits
                .filter((a) => a.targetId === draft?.id)
                .slice()
                .reverse()"
              :key="a.id"
            >
              <time>{{
                new Date(a.date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
              }}</time>
              · {{ store.username(a.actorId) }}
              <dl class="template-history-fields">
                <template v-for="c in historyChanges(a)" :key="c.label"
                  ><dt>{{ c.label }}</dt>
                  <dd>
                    <span class="muted">이전: {{ c.before }}</span
                    ><br />변경: {{ c.after }}
                  </dd></template
                >
              </dl>
            </li>
          </ol>
        </details>
      </template>
      <template #footer
        ><button class="button secondary" :disabled="busy" @click="close">취소</button
        ><button class="button primary" :disabled="busy || !draft?.title.trim()" @click="save">
          {{ busy ? '저장 중' : '기본자격 저장' }}
        </button></template
      >
    </AppDialog>
  </div>
</template>
<style scoped>
.template-history {
  padding-left: 20px;
  font-size: 13px;
}
.template-history-fields {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  margin: 12px 0 24px;
}
.template-history-fields dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.template-table table {
  min-width: 760px;
  table-layout: fixed;
}
.template-table th:first-child {
  width: 30%;
}
.template-table th:nth-child(2) {
  width: 24%;
}
.template-table td:nth-child(-n + 2) {
  white-space: normal;
  overflow-wrap: anywhere;
}
.text-button {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  background: none;
  border: 0;
  padding: 8px 0;
  color: var(--primary);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
</style>
