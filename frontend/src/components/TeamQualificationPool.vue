<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import type { OrganizationPoliciesView, Qualification } from '@eks/contracts';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
import AppDialog from './AppDialog.vue';
const store = useDemo(),
  open = ref(false),
  busy = ref(false),
  error = ref(''),
  query = ref(''),
  doc = ref<OrganizationPoliciesView>(),
  chosen = ref<Record<string, string>>({}),
  baseline = ref('');
const dirty = computed(() => open.value && JSON.stringify(chosen.value) !== baseline.value);
const groups = computed(() => {
  const map = new Map<string, Qualification[]>();
  for (const q of store.data.qualifications.filter(
    (q) => q.lv1OrganizationId === store.managementLv1 && !q.deletedAt,
  ))
    map.set(q.entityId, [...(map.get(q.entityId) || []), q]);
  return [...map]
    .map(([id, versions]) => ({ id, versions: versions.sort((a, b) => b.version - a.version) }))
    .filter((g) => g.versions[0]!.title.toLowerCase().includes(query.value.toLowerCase()));
});
const affected = computed(
  () =>
    doc.value?.entries.filter((e) =>
      e.requiredQualifications?.some(
        (id) =>
          doc.value!.pool.find((p) => p.entityId === id)?.qualificationId !== chosen.value[id],
      ),
    ) || [],
);
let generation = 0;
async function show() {
  const seq = ++generation;
  busy.value = true;
  error.value = '';
  try {
    const d = await api<OrganizationPoliciesView>(store.managementPath('/organization-policies'));
    if (seq !== generation) return;
    doc.value = d;
    query.value = '';
    chosen.value = Object.fromEntries(
      groups.value.map((g) => [
        g.id,
        d.pool.find((p) => p.entityId === g.id)?.qualificationId || '',
      ]),
    );
    baseline.value = JSON.stringify(chosen.value);
    open.value = true;
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  } finally {
    if (seq === generation) busy.value = false;
  }
}
async function leave() {
  return (
    !busy.value &&
    (!dirty.value ||
      (await confirmAction('팀 적용 변경을 취소하고 이동할까요?', '변경 버리고 이동')))
  );
}
async function close() {
  if (await leave()) open.value = false;
}
async function save() {
  if (busy.value || !doc.value) return;
  const seq = generation;
  busy.value = true;
  error.value = '';
  try {
    await store.command(
      store.managementPath(`/organization-policies/${store.managementLv1}/qualification-pool`),
      {
        revision: doc.value.revision,
        qualificationIds: Object.values(chosen.value).filter(Boolean),
      },
      'PUT',
    );
    if (seq !== generation) return;
    open.value = false;
    store.notify('팀 적용 버전을 저장했습니다.');
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  } finally {
    if (seq === generation) busy.value = false;
  }
}
watch(
  () => [store.actorId, store.managementLv1],
  () => {
    generation++;
    open.value = false;
    busy.value = false;
    doc.value = undefined;
  },
);
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <button class="button secondary" :disabled="busy || !store.managementReady" @click="show">
    팀 적용
  </button>
  <span v-if="error && !open" class="field-error" role="alert">{{ error }}</span>
  <AppDialog :open="open" title="팀 적용" @update:open="(v) => !v && close()">
    <p class="muted">선택한 버전을 세부조직 필수 자격으로 사용할 수 있습니다.</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <label class="field">팀 자격 검색<input v-model="query" type="search" /></label>
    <div v-for="g in groups" :key="g.id" class="team-application-row">
      <strong>{{ g.versions[0]!.title }}</strong
      ><label class="field"
        ><span class="sr-only">{{ g.versions[0]!.title }} 적용 버전</span
        ><select v-model="chosen[g.id]" :disabled="busy">
          <option value="">미적용</option>
          <option
            v-for="q in g.versions"
            :key="q.id"
            :value="q.id"
            :disabled="store.qualificationErrors(q).length > 0 && chosen[g.id] !== q.id"
          >
            v{{ q.version }} · {{ store.qualificationErrors(q).length ? '설정 필요' : '적용 가능' }}
          </option>
        </select></label
      >
    </div>
    <p v-if="!groups.length" class="empty-state">기본자격을 팀에 먼저 등록해 주세요.</p>
    <p v-if="affected.length" class="muted">
      영향 조직: {{ affected.map((e) => e.name).join(', ') }}. 필수 지정 중인 자격은 먼저 조직에서
      해제해야 팀 적용을 해제할 수 있습니다.
    </p>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="close">취소</button
      ><button class="button primary" :disabled="busy || !dirty" @click="save">
        {{ busy ? '저장 중' : '팀 적용 확정' }}
      </button></template
    >
  </AppDialog>
</template>
<style scoped>
.team-application-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid var(--border);
  padding: 12px 0;
}
.team-application-row strong {
  font-size: 14px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.team-application-row .field {
  margin: 0;
}
@media (max-width: 600px) {
  .team-application-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
