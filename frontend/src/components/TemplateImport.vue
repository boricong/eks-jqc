<script setup lang="ts">
import { confirmAction } from '../composables/useConfirmation';
import { computed, ref, watch } from 'vue';
import { qualificationTypeLabels, type QualificationType } from '@eks/contracts';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import AppDialog from './AppDialog.vue';
const props = defineProps<{ qualificationType: QualificationType }>();
const store = useDemo(),
  open = ref(false),
  busy = ref(false),
  error = ref(''),
  chosen = ref<string[]>([]);
let generation = 0;
const templates = ref<
  {
    id: string;
    title: string;
    englishName: string;
    description: string;
    imported: boolean;
    qualificationType: QualificationType;
  }[]
>([]);
const listed = computed(() =>
  templates.value.filter((t) => t.qualificationType === props.qualificationType),
);
watch(
  () => [store.actorId, store.managementLv1, props.qualificationType],
  () => {
    generation++;
    busy.value = false;
    open.value = false;
    templates.value = [];
    chosen.value = [];
  },
);
async function show() {
  const seq = ++generation;
  const scope = store.managementLv1,
    actor = store.actorId;
  try {
    const data = await api<typeof templates.value>(
      store.managementPath('/qualification-templates'),
    );
    if (seq !== generation || scope !== store.managementLv1 || actor !== store.actorId) return;
    templates.value = data;
    chosen.value = [];
    error.value = '';
    open.value = true;
  } catch (err) {
    if (seq === generation) store.notify((err as Error).message);
  }
}
async function save() {
  if (busy.value) return;
  const seq = generation;
  busy.value = true;
  error.value = '';
  try {
    await store.command('/qualification-templates/import', {
      qualificationType: props.qualificationType,
      templateIds: chosen.value.filter((id) =>
        listed.value.some((t) => t.id === id && !t.imported),
      ),
    });
    if (seq !== generation) return;
    open.value = false;
    store.notify('선택한 자격을 팀 자격으로 저장했습니다.');
  } catch (err) {
    if (seq === generation) error.value = (err as Error).message;
  } finally {
    if (seq === generation) busy.value = false;
  }
}
async function leave() {
  return (
    !busy.value &&
    (!open.value ||
      !chosen.value.length ||
      (await confirmAction('선택한 자격 가져오기를 취소하고 이동할까요?', '변경 버리고 이동')))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <button class="button secondary" :disabled="!store.managementReady || busy" @click="show">
    {{ qualificationTypeLabels[qualificationType] }} 자격 등록
  </button>
  <AppDialog
    :open="open"
    :title="`${qualificationTypeLabels[qualificationType]} 자격 등록`"
    @update:open="
      (value) => {
        if (!busy) open = value;
      }
    "
  >
    <p>{{ store.managementOrganization?.name }}</p>
    <p class="muted">필요한 자격을 선택한 뒤 기간·인증Set 기준을 준비해 주세요.</p>
    <p v-if="qualificationType === 'auditee'" class="muted">
      처음 등록하는 자격은 버전 없는 Ready · 대기 상태입니다. 최초 기준 저장 시 v1부터 시작합니다.
    </p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <div v-if="!listed.length" class="empty-state">
      <p>등록할 {{ qualificationTypeLabels[qualificationType] }} 기본자격이 없습니다.</p>
      <p class="muted">시스템 운영자가 해당 유형의 기본자격을 먼저 생성해야 합니다.</p>
      <RouterLink
        v-if="store.hasRole('system_operator')"
        to="/system/qualification-templates"
        class="text-link"
        @click="open = false"
        >기본자격 관리</RouterLink
      >
    </div>
    <div class="template-list">
      <label v-for="t in listed" :key="t.id" class="choice"
        ><input
          v-model="chosen"
          type="checkbox"
          :value="t.id"
          :disabled="t.imported || busy"
        /><span
          >{{ t.title
          }}<small class="muted"
            >{{ qualificationTypeLabels[t.qualificationType] }} · {{ t.englishName
            }}{{ t.imported ? ' · 등록됨' : '' }}</small
          ></span
        ></label
      >
    </div>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="open = false">취소</button
      ><button class="button primary" :disabled="busy || !chosen.length" @click="save">
        팀 자격 등록
      </button></template
    >
  </AppDialog>
</template>
