<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import type { OrganizationPoliciesView } from '@eks/contracts';
import AppDialog from './AppDialog.vue';
import PolicyOrganizationTree from './PolicyOrganizationTree.vue';
import OrganizationAdministrators from './OrganizationAdministrators.vue';
const store = useDemo(),
  doc = ref<OrganizationPoliciesView>(),
  busy = ref(false),
  error = ref(''),
  orgId = ref(''),
  search = ref('');
const administratorsDirty = ref(false),
  administratorsBusy = ref(false);
const confirm = (message: string) => window.confirm(message);
const selectedVersions = ref<Record<string, string>>({}),
  chosen = ref<string[]>([]),
  baselinePool = ref(''),
  baselineMeta = ref('');
const metadata = ref({
  description: '',
  duties: '',
  configured: false,
  requiredQualifications: [] as string[],
});
const review = ref(false),
  reviewKind = ref<'pool' | 'metadata'>('pool');
let generation = 0;
const selected = computed(() => doc.value?.entries.find((e) => e.id === orgId.value));
const canSave = computed(
  () =>
    store.data.management.canManagePolicies &&
    store.data.management.editableOrganizationIds.includes(orgId.value),
);
const metaDirty = computed(() => JSON.stringify(metadata.value) !== baselineMeta.value);
const poolValue = () => JSON.stringify(chosen.value.map((id) => selectedVersions.value[id]).sort());
const poolDirty = computed(() => poolValue() !== baselinePool.value);
const groups = computed(() => {
  const map = new Map<string, typeof store.data.qualifications>();
  for (const q of store.data.qualifications.filter(
    (q) => q.lv1OrganizationId === store.managementLv1 && q.status === 'published',
  ))
    map.set(q.entityId, [...(map.get(q.entityId) || []), q]);
  return [...map.entries()]
    .map(([id, versions]) => ({ id, versions: versions.sort((a, b) => b.version - a.version) }))
    .filter((g) =>
      g.versions.some((q) => q.title.toLowerCase().includes(search.value.toLowerCase())),
    );
});
const affected = computed(() =>
  reviewKind.value === 'metadata'
    ? doc.value?.entries.filter((e) => e.id === orgId.value) || []
    : doc.value?.entries.filter((e) =>
        e.requiredQualifications?.some((id) =>
          chosen.value.includes(id)
            ? doc.value!.pool.find((p) => p.entityId === id)?.qualificationId !==
              selectedVersions.value[id]
            : true,
        ),
      ) || [],
);
function readMeta() {
  const e = selected.value;
  metadata.value = {
    description: e?.description || '',
    duties: e?.duties || '',
    configured: e?.requiredQualifications !== null,
    requiredQualifications: [...(e?.requiredQualifications || [])],
  };
  baselineMeta.value = JSON.stringify(metadata.value);
}
function readPool() {
  chosen.value = doc.value?.pool.map((p) => p.entityId) || [];
  selectedVersions.value = Object.fromEntries(
    doc.value?.pool.map((p) => [p.entityId, p.qualificationId]) || [],
  );
  baselinePool.value = poolValue();
}
function select(id: string) {
  if (administratorsBusy.value) return;
  if (
    (metaDirty.value || administratorsDirty.value) &&
    !confirm('조직 입력을 저장하지 않았습니다. 변경을 취소하고 이동할까요?')
  )
    return;
  orgId.value = id;
  readMeta();
}
async function load() {
  const seq = ++generation,
    key = `${store.actorId}:${store.managementLv1}`;
  error.value = '';
  try {
    const result = await api<OrganizationPoliciesView>(
      store.managementPath('/organization-policies'),
    );
    if (seq !== generation || key !== `${store.actorId}:${store.managementLv1}`) return;
    doc.value = result;
    orgId.value =
      result.entries.find((e) => e.id === orgId.value)?.id || result.entries[0]?.id || '';
    readPool();
    readMeta();
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  }
}
function toggle(id: string, checked: boolean) {
  if (checked) {
    if (!chosen.value.includes(id)) chosen.value.push(id);
    selectedVersions.value[id] ||= groups.value.find((g) => g.id === id)!.versions[0]!.id;
  } else chosen.value = chosen.value.filter((v) => v !== id);
}
async function save() {
  if (!doc.value || busy.value || administratorsBusy.value || !canSave.value) return;
  busy.value = true;
  error.value = '';
  const key = `${store.actorId}:${store.managementLv1}`;
  try {
    const pool = reviewKind.value === 'pool';
    await store.command(
      store.managementPath(
        `/organization-policies/${pool ? store.managementLv1 : orgId.value}${pool ? '/qualification-pool' : ''}`,
      ),
      {
        revision: doc.value.revision,
        ...(pool
          ? { qualificationIds: chosen.value.map((id) => selectedVersions.value[id]) }
          : {
              description: metadata.value.description,
              duties: metadata.value.duties,
              requiredQualifications: metadata.value.configured
                ? metadata.value.requiredQualifications
                : null,
            }),
      },
      'PUT',
    );
    const updated = await api<OrganizationPoliciesView>(
      store.managementPath('/organization-policies'),
    );
    if (key !== `${store.actorId}:${store.managementLv1}`) return;
    doc.value = updated;
    if (pool) readPool();
    else readMeta();
    review.value = false;
    store.notify('조직별 자격 설정을 저장했습니다.');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function leave() {
  return (
    !busy.value &&
    !administratorsBusy.value &&
    (!(poolDirty.value || metaDirty.value || administratorsDirty.value) ||
      confirm('저장하지 않은 조직 설정이 있습니다. 변경을 취소하고 이동할까요?'))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
watch(
  () => `${store.actorId}:${store.managementLv1}`,
  () => {
    if (store.managementReady) void load();
  },
  { immediate: true },
);
</script>
<template>
  <div class="policy-workspace">
    <p class="notice-body">
      관리할 조직을 먼저 선택한 뒤 팀 후보 목록에서 필수 자격을 지정합니다. 상위 조직 설정은 자동
      상속하지 않습니다.
    </p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="doc && !canSave" class="error-message" role="alert">
      관리 권한 또는 소속이 변경되었습니다. 입력 내용은 유지하지만 저장할 수 없습니다.
      <RouterLink to="/">홈으로 이동</RouterLink>
    </p>
    <p v-if="!doc && !store.managementReady" class="empty-state">
      관리할 Lv1 조직을 선택하거나 현재 조직 설정 권한을 확인해 주세요.
    </p>
    <button
      class="button secondary"
      :disabled="busy"
      @click="
        (!(poolDirty || metaDirty || administratorsDirty) ||
          confirm('입력을 버리고 다시 불러올까요?')) &&
        load()
      "
    >
      다시 불러오기
    </button>
    <div v-if="doc" class="policy-selection-layout">
      <PolicyOrganizationTree
        :entries="
          doc.entries.filter((e) => store.data.management.editableOrganizationIds.includes(e.id))
        "
        :selected="orgId"
        :disabled="busy || administratorsBusy"
        @select="select"
      />
      <section v-if="selected" class="panel editor-panel">
        <h2>{{ selected.name }}</h2>
        <p class="organization-path">{{ selected.path.map((p) => p.name).join(' › ') }}</p>
        <p>
          {{ selected.userCount }}명 직속 ·
          {{ selected.effectiveActive ? '사용 중' : '사용 중지' }} ·
          {{ metaDirty ? '미저장 변경' : '저장된 설정' }}
        </p>
        <label class="field"
          >조직 설명<textarea
            v-model="metadata.description"
            :disabled="busy || !canSave"
            maxlength="4000"
            rows="3"
          />
        </label>
        <label class="field"
          >담당 업무<textarea
            v-model="metadata.duties"
            :disabled="busy || !canSave"
            maxlength="4000"
            rows="3"
          />
        </label>
        <OrganizationAdministrators
          v-if="canSave"
          :organization-id="orgId"
          :can-manage="doc.canAssignAdministrators && store.fullManagement"
          @dirty="administratorsDirty = $event"
          @busy="administratorsBusy = $event"
        />
        <fieldset :disabled="busy || !canSave">
          <legend>선택 조직의 필수 자격</legend>
          <label class="checkbox-field"
            ><input type="checkbox" v-model="metadata.configured" />필수 자격 선정을
            완료합니다</label
          >
          <p class="muted">
            선정 완료 후 아무 자격도 선택하지 않으면 ‘필수 자격 없음’으로 저장합니다. 상위 조직에서
            가져오지 않습니다.
          </p>
          <label v-for="p in doc.pool" :key="p.entityId" class="choice"
            ><input
              type="checkbox"
              v-model="metadata.requiredQualifications"
              :value="p.entityId"
              :disabled="!metadata.configured"
            /><span
              >{{ p.title }} · v{{ p.version
              }}<small v-if="p.errors.length" class="field-error"
                >신규 계획 불가 · {{ p.errors.join(' · ') }}</small
              ></span
            ></label
          >
          <p v-if="!doc.pool.length">팀 자격 목록을 먼저 저장해 주세요.</p>
        </fieldset>
        <button
          class="button primary"
          :disabled="busy || administratorsBusy || !canSave || !metaDirty"
          @click="
            reviewKind = 'metadata';
            review = true;
          "
        >
          조직 설정 변경 확인
        </button>
      </section>
    </div>
    <details
      v-if="doc?.canManagePool && store.fullManagement"
      class="panel editor-panel policy-pool-management"
    >
      <summary>팀 공통 자격 후보 목록 관리 · Lv1 전체에 적용</summary>
      <div class="section-heading">
        <h2>팀 자격 목록</h2>
        <span>{{ chosen.length }}개 선정 · {{ poolDirty ? '미저장 변경' : '저장된 설정' }}</span>
      </div>
      <p class="muted">게시된 버전을 직접 선택합니다. 새 게시 버전으로 자동 변경하지 않습니다.</p>
      <label class="field">팀 자격 검색<input v-model="search" /></label>
      <button
        class="button secondary"
        :disabled="busy"
        @click="groups.forEach((g) => toggle(g.id, true))"
      >
        검색 결과 전체 선택
      </button>
      <div class="policy-pool-list">
        <div v-for="g in groups" :key="g.id" class="policy-pool-row">
          <label class="checkbox-field"
            ><input
              type="checkbox"
              :checked="chosen.includes(g.id)"
              :disabled="busy"
              @change="toggle(g.id, ($event.target as HTMLInputElement).checked)"
            />{{ g.versions[0]!.title }}</label
          >
          <label class="field"
            ><span class="sr-only">{{ g.versions[0]!.title }} 적용 버전</span
            ><select
              :disabled="busy || !chosen.includes(g.id)"
              :value="selectedVersions[g.id] || g.versions[0]!.id"
              @change="selectedVersions[g.id] = ($event.target as HTMLSelectElement).value"
            >
              <option v-for="q in g.versions" :key="q.id" :value="q.id">
                v{{ q.version }} ·
                {{ store.qualificationErrors(q).length ? '신규 계획 불가' : '사용 가능' }}
              </option>
            </select></label
          >
        </div>
      </div>
      <p v-if="!groups.length" class="muted">같은 Lv1의 게시 자격을 먼저 준비해 주세요.</p>
      <button
        class="button primary"
        :disabled="busy || !poolDirty"
        @click="
          reviewKind = 'pool';
          review = true;
        "
      >
        팀 목록 변경 확인
      </button>
    </details>
    <AppDialog v-model:open="review" title="조직별 자격 설정 변경 확인"
      ><p>
        {{ store.managementOrganization?.name }} ·
        {{ reviewKind === 'pool' ? '팀 선정 목록' : '조직 필수 자격' }}
      </p>
      <p>
        영향 조직 {{ affected.length }}개 · 직속 구성원
        {{ affected.reduce((n, e) => n + e.userCount, 0) }}명 · 작성 중 계획
        {{ affected.reduce((n, e) => n + e.draftCount, 0) }}건
      </p>
      <ul>
        <li v-for="e in affected" :key="e.id">{{ e.path.map((p) => p.name).join(' › ') }}</li>
      </ul>
      <p>
        확정된 계획·평가·유효한 인증은 유지합니다. 작성 중 계획은 현재 소속과 적용 버전을 다시
        확인합니다. 새로 추가한 필수 자격은 별도 계획 요청이 필요합니다.
      </p>
      <p v-if="error" class="error-message">{{ error }}</p>
      <template #footer
        ><button class="button secondary" :disabled="busy" @click="review = false">취소</button
        ><button class="button primary" :disabled="busy" @click="save">설정 저장</button></template
      ></AppDialog
    >
  </div>
</template>
