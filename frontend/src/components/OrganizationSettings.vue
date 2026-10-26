<script setup lang="ts">
import OrganizationRequirements from './OrganizationRequirements.vue';
import { confirmAction } from '../composables/useConfirmation';
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import type { OrganizationSettingsView } from '@eks/contracts';
import AppDialog from './AppDialog.vue';
import PolicyOrganizationTree from './PolicyOrganizationTree.vue';
import OrganizationAdministrators from './OrganizationAdministrators.vue';
import CollapsibleSection from './CollapsibleSection.vue';
import { managementTitle } from '../management-navigation';
const store = useDemo(),
  doc = ref<OrganizationSettingsView>(),
  busy = ref(false),
  error = ref(''),
  orgId = ref('');
const requirementsDirty = ref(false),
  requirementsBusy = ref(false);
const administratorsDirty = ref(false),
  administratorsBusy = ref(false),
  informationOpen = ref(true),
  administratorsOpen = ref(false);
const baselineMeta = ref('');
const metadata = ref({
  description: '',
  duties: '',
});
const review = ref(false);
let generation = 0;
const selected = computed(() => doc.value?.entries.find((e) => e.id === orgId.value));
const canSave = computed(
  () =>
    store.data.management.canManageOrganizationSettings &&
    store.data.management.editableOrganizationIds.includes(orgId.value),
);
const metaDirty = computed(() => JSON.stringify(metadata.value) !== baselineMeta.value);
const informationDirty = computed(
  () =>
    metadata.value.description !== (selected.value?.description || '') ||
    metadata.value.duties !== (selected.value?.duties || ''),
);
const affected = computed(() => doc.value?.entries.filter((e) => e.id === orgId.value) || []);
function readMeta() {
  const e = selected.value;
  metadata.value = {
    description: e?.description || '',
    duties: e?.duties || '',
  };
  baselineMeta.value = JSON.stringify(metadata.value);
}
async function select(id: string) {
  if (id === orgId.value || busy.value || administratorsBusy.value || requirementsBusy.value)
    return;
  if (
    (metaDirty.value || administratorsDirty.value || requirementsDirty.value) &&
    !(await confirmAction(
      '조직 입력을 저장하지 않았습니다. 변경을 취소하고 이동할까요?',
      '변경 버리고 이동',
    ))
  )
    return;
  orgId.value = id;
  informationOpen.value = true;
  administratorsOpen.value = false;
  readMeta();
}
async function load() {
  const seq = ++generation,
    key = `${store.actorId}:${store.managementLv1}`;
  error.value = '';
  try {
    const result = await api<OrganizationSettingsView>(
      store.managementPath('/organization-settings'),
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
  if (
    !doc.value ||
    busy.value ||
    administratorsBusy.value ||
    requirementsBusy.value ||
    !canSave.value
  )
    return;
  busy.value = true;
  error.value = '';
  const key = `${store.actorId}:${store.managementLv1}`;
  try {
    await store.command(
      store.managementPath(`/organization-settings/${orgId.value}`),
      {
        revision: doc.value.revision,
        description: metadata.value.description,
        duties: metadata.value.duties,
      },
      'PUT',
    );
    const updated = await api<OrganizationSettingsView>(
      store.managementPath('/organization-settings'),
    );
    if (key !== `${store.actorId}:${store.managementLv1}`) return;
    doc.value = updated;
    readMeta();
    review.value = false;
    store.notify(`${managementTitle('organization-settings')}을 저장했습니다.`);
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
    !requirementsBusy.value &&
    (!(metaDirty.value || administratorsDirty.value || requirementsDirty.value) ||
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
    informationOpen.value = true;
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
    <div v-if="doc" class="policy-selection-layout">
      <PolicyOrganizationTree
        :entries="
          doc.entries.filter((e) => store.data.management.editableOrganizationIds.includes(e.id))
        "
        :selected="orgId"
        :disabled="busy || administratorsBusy || requirementsBusy"
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
          <OrganizationRequirements
            :organization-id="orgId"
            :disabled="!canSave"
            @dirty="requirementsDirty = $event"
            @busy="requirementsBusy = $event"
          />
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
      </div>
    </div>
    <AppDialog
      v-model:open="review"
      :title="`${managementTitle('organization-settings')} 변경 확인`"
      ><p>{{ store.managementOrganization?.name }} · 조직 정보·필요자격</p>
      <p>
        영향 조직 {{ affected.length }}개 · 직속 구성원
        {{ affected.reduce((n, e) => n + e.userCount, 0) }}명
      </p>
      <ul>
        <li v-for="e in affected" :key="e.id">{{ e.path.map((p) => p.name).join(' › ') }}</li>
      </ul>
      <p>
        선택한 조직의 설명과 담당 업무를 저장합니다. 개인 계획·학습·인증 기준은 변경하지 않습니다.
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
