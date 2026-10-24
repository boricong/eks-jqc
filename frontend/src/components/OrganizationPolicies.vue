<script setup lang="ts">
import { confirmAction } from '../composables/useConfirmation';
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import type { OrganizationPoliciesView } from '@eks/contracts';
import AppDialog from './AppDialog.vue';
import PolicyOrganizationTree from './PolicyOrganizationTree.vue';
import OrganizationAdministrators from './OrganizationAdministrators.vue';
import CollapsibleSection from './CollapsibleSection.vue';
import { managementTitle } from '../management-navigation';
const store = useDemo(),
  doc = ref<OrganizationPoliciesView>(),
  busy = ref(false),
  error = ref(''),
  orgId = ref('');
const administratorsDirty = ref(false),
  administratorsBusy = ref(false),
  informationOpen = ref(false),
  administratorsOpen = ref(false);
const baselineMeta = ref('');
const metadata = ref({
  description: '',
  duties: '',
  requiredQualifications: [] as string[],
});
const review = ref(false),
  qualificationSearch = ref('');
const filteredQualifications = computed(
  () =>
    doc.value?.pool.filter((p) =>
      p.title.toLocaleLowerCase().includes(qualificationSearch.value.trim().toLocaleLowerCase()),
    ) || [],
);
let generation = 0;
const selected = computed(() => doc.value?.entries.find((e) => e.id === orgId.value));
const canSave = computed(
  () =>
    store.data.management.canManagePolicies &&
    store.data.management.editableOrganizationIds.includes(orgId.value),
);
const metaDirty = computed(() => JSON.stringify(metadata.value) !== baselineMeta.value);
const informationDirty = computed(
  () =>
    metadata.value.description !== (selected.value?.description || '') ||
    metadata.value.duties !== (selected.value?.duties || ''),
);
const requiredDirty = computed(
  () =>
    JSON.stringify(metadata.value.requiredQualifications) !==
    JSON.stringify(selected.value?.requiredQualifications || []),
);
const affected = computed(() => doc.value?.entries.filter((e) => e.id === orgId.value) || []);
function readMeta() {
  const e = selected.value;
  metadata.value = {
    description: e?.description || '',
    duties: e?.duties || '',
    requiredQualifications: [...(e?.requiredQualifications || [])],
  };
  baselineMeta.value = JSON.stringify(metadata.value);
  qualificationSearch.value = '';
}
async function select(id: string) {
  if (id === orgId.value || busy.value || administratorsBusy.value) return;
  if (
    (metaDirty.value || administratorsDirty.value) &&
    !(await confirmAction(
      '조직 입력을 저장하지 않았습니다. 변경을 취소하고 이동할까요?',
      '변경 버리고 이동',
    ))
  )
    return;
  orgId.value = id;
  informationOpen.value = false;
  administratorsOpen.value = false;
  readMeta();
}
async function reload() {
  if (
    !(metaDirty.value || administratorsDirty.value) ||
    (await confirmAction('입력을 버리고 다시 불러올까요?', '다시 불러오기'))
  )
    await load();
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
    readMeta();
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  }
}
async function save() {
  if (!doc.value || busy.value || administratorsBusy.value || !canSave.value) return;
  busy.value = true;
  error.value = '';
  const key = `${store.actorId}:${store.managementLv1}`;
  try {
    await store.command(
      store.managementPath(`/organization-policies/${orgId.value}`),
      {
        revision: doc.value.revision,
        description: metadata.value.description,
        duties: metadata.value.duties,
        requiredQualifications: metadata.value.requiredQualifications,
      },
      'PUT',
    );
    const updated = await api<OrganizationPoliciesView>(
      store.managementPath('/organization-policies'),
    );
    if (key !== `${store.actorId}:${store.managementLv1}`) return;
    doc.value = updated;
    readMeta();
    review.value = false;
    store.notify(`${managementTitle('policies')}을 저장했습니다.`);
  } catch (e) {
    error.value = (e as Error).message;
    if (informationDirty.value) informationOpen.value = true;
  } finally {
    busy.value = false;
  }
}
async function leave() {
  return (
    !busy.value &&
    !administratorsBusy.value &&
    (!(metaDirty.value || administratorsDirty.value) ||
      (await confirmAction(
        '저장하지 않은 조직 설정이 있습니다. 변경을 취소하고 이동할까요?',
        '변경 버리고 이동',
      )))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
watch(
  () => `${store.actorId}:${store.managementLv1}`,
  () => {
    informationOpen.value = false;
    administratorsOpen.value = false;
    if (store.managementReady) void load();
  },
  { immediate: true },
);
</script>
<template>
  <div class="policy-workspace">
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="doc && !canSave" class="error-message" role="alert">
      관리 권한 또는 소속이 변경되었습니다. 입력 내용은 유지하지만 저장할 수 없습니다.
      <RouterLink to="/">홈으로 이동</RouterLink>
    </p>
    <p v-if="!doc && !store.managementReady" class="empty-state">
      관리할 Lv1 조직을 선택하거나 현재 조직 설정 권한을 확인해 주세요.
    </p>
    <button
      class="button secondary small policy-reload"
      :disabled="busy || administratorsBusy"
      @click="reload"
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
      <div class="policy-detail-stack">
        <section v-if="selected" class="panel editor-panel">
          <h2>{{ selected.name }}</h2>
          <p v-if="selected.path.length > 1" class="organization-path">
            {{ selected.path.map((p) => p.name).join(' › ') }}
          </p>
          <p>
            {{ selected.userCount }}명 직속 ·
            {{ selected.effectiveActive ? '사용 중' : '사용 중지' }} ·
            {{ metaDirty ? '미저장 변경' : '저장된 설정' }}
          </p>
          <fieldset :disabled="busy || !canSave">
            <legend>필수 자격 · 선택 사항</legend>
            <p class="muted">
              선택하지 않으면 필수 자격 없음 · {{ metadata.requiredQualifications.length }}개 선택
              <span v-if="requiredDirty"> · 미저장 변경</span>
            </p>
            <label v-if="doc.pool.length" class="field compact-field"
              >자격 검색<input
                v-model="qualificationSearch"
                type="search"
                placeholder="자격명 검색"
            /></label>
            <label v-for="p in filteredQualifications" :key="p.entityId" class="choice"
              ><input
                type="checkbox"
                v-model="metadata.requiredQualifications"
                :value="p.entityId"
              /><span
                >{{ p.title }} · v{{ p.version
                }}<small v-if="p.errors.length" class="field-error"
                  >신규 계획 불가 · {{ p.errors.join(' · ') }}</small
                ></span
              ></label
            >
            <p v-if="doc.pool.length && !filteredQualifications.length" class="muted">
              검색 결과가 없습니다.
            </p>
            <p v-if="!doc.pool.length">
              팀 관리자가 자격 설정을 완료하고 팀 적용을 확정해야 합니다.
            </p>
          </fieldset>
          <CollapsibleSection
            v-model:open="informationOpen"
            title="조직 정보"
            class="policy-support-section"
          >
            <template #summary>{{
              informationDirty ? '미저장 변경' : '조직 설명·담당 업무'
            }}</template>
            <div class="text-stack">
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
            </div>
          </CollapsibleSection>
          <button
            class="button primary"
            :disabled="busy || administratorsBusy || !canSave || !metaDirty"
            @click="review = true"
          >
            조직 설정 변경 확인
          </button>
          <CollapsibleSection
            v-if="canSave"
            v-model:open="administratorsOpen"
            title="세부 조직 관리자"
            class="policy-support-section"
          >
            <template #summary>{{
              administratorsBusy ? '저장 중' : administratorsDirty ? '미저장 변경' : '지정 현황'
            }}</template>
            <OrganizationAdministrators
              :organization-id="orgId"
              :can-manage="doc.canAssignAdministrators && store.fullManagement"
              @dirty="administratorsDirty = $event"
              @busy="administratorsBusy = $event"
              @error="administratorsOpen = true"
            />
          </CollapsibleSection>
        </section>
        <p v-if="doc?.canManagePool">
          <RouterLink :to="store.managementLink('/admin/qualifications')"
            >{{ managementTitle('qualifications') }} · 등록·팀 적용</RouterLink
          >
        </p>
      </div>
    </div>
    <AppDialog v-model:open="review" :title="`${managementTitle('policies')} 변경 확인`"
      ><p>{{ store.managementOrganization?.name }} · 조직 필수 자격</p>
      <p>
        영향 조직 {{ affected.length }}개 · 직속 구성원
        {{ affected.reduce((n, e) => n + e.userCount, 0) }}명 · 작성 중 계획
        {{ affected.reduce((n, e) => n + e.draftCount, 0) }}건
      </p>
      <ul>
        <li v-for="e in affected" :key="e.id">{{ e.path.map((p) => p.name).join(' › ') }}</li>
      </ul>
      <p>
        기존 요청은 요청 당시 필수 기준을 유지합니다. 변경한 필수 자격은 다음 요청부터 반영하며,
        현재 소속의 필수 충족 현황은 즉시 갱신합니다.
      </p>
      <p v-if="error" class="error-message">{{ error }}</p>
      <template #footer
        ><button class="button secondary" :disabled="busy" @click="review = false">취소</button
        ><button class="button primary" :disabled="busy" @click="save">설정 저장</button></template
      ></AppDialog
    >
  </div>
</template>

<style scoped>
.policy-support-section :deep(.collapsible-section-toggle) {
  min-height: 44px;
  padding: 12px 0;
  background: transparent;
}
.policy-support-section :deep(.collapsible-section-title) {
  font-size: 16px;
}
.policy-support-section :deep(.collapsible-section-body) {
  padding: 8px 0 16px;
}
</style>
