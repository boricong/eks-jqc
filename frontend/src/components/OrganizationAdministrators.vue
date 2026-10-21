<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { OrganizationAdministratorsView } from '@eks/contracts';
import { api } from '../api';
import { useDemo } from '../stores/demo';
const props = defineProps<{ organizationId: string; canManage: boolean }>();
const confirm = (message: string) => window.confirm(message);
const emit = defineEmits<{ dirty: [value: boolean]; busy: [value: boolean] }>();
const store = useDemo(),
  view = ref<OrganizationAdministratorsView>(),
  chosen = ref<string[]>([]),
  baseline = ref('[]'),
  error = ref(''),
  busy = ref(false);
const dirty = computed(() => JSON.stringify([...chosen.value].sort()) !== baseline.value);
const context = () => `${store.actorId}:${store.managementLv1}:${props.organizationId}`;
let generation = 0;
watch(dirty, (value) => emit('dirty', value));
watch(busy, (value) => emit('busy', value));
async function load() {
  const key = context(),
    seq = ++generation;
  error.value = '';
  try {
    const result = await api<OrganizationAdministratorsView>(
      store.managementPath(`/organization-policies/${props.organizationId}/administrators`),
    );
    if (key !== context() || seq !== generation) return;
    view.value = result;
    chosen.value = result.candidates.filter((u) => u.assigned).map((u) => u.id);
    baseline.value = JSON.stringify([...chosen.value].sort());
  } catch (e) {
    if (key === context() && seq === generation) error.value = (e as Error).message;
  }
}
async function save() {
  if (
    !view.value ||
    busy.value ||
    !confirm(
      '선택한 구성원의 세부 조직 관리자 지정을 저장할까요? 다른 역할과 진행 내역은 유지됩니다.',
    )
  )
    return;
  const key = context();
  busy.value = true;
  error.value = '';
  try {
    await store.command(
      store.managementPath(`/organization-policies/${props.organizationId}/administrators`),
      {
        revision: view.value.revision,
        organizationRevision: view.value.organizationRevision,
        userIds: chosen.value,
      },
      'PUT',
    );
    if (key !== context()) return;
    await load();
    store.notify('세부 조직 관리자 지정을 저장했습니다.');
  } catch (e) {
    if (key === context()) error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
watch(
  context,
  () => {
    view.value = undefined;
    chosen.value = [];
    baseline.value = '[]';
    void load();
  },
  { immediate: true },
);
</script>
<template>
  <section class="organization-administrators text-stack" aria-label="세부 조직 관리자 지정">
    <div class="section-heading">
      <h3>세부 조직 관리자</h3>
      <button
        v-if="canManage"
        class="button secondary small"
        :disabled="busy"
        @click="(!dirty || confirm('지정 변경을 취소하고 다시 불러올까요?')) && load()"
      >
        지정 현황 새로고침
      </button>
    </div>
    <p class="muted">
      실제 소속 조직의 설명·담당 업무·필수 자격만 설정합니다. 소속이 바뀌면 지정을 해제합니다.
    </p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <template v-if="view">
      <p v-if="!view.candidates.some((u) => u.assigned)" class="muted">
        세부 조직 관리자 미지정 · 팀 관리자 관리
      </p>
      <div class="administrator-candidates">
        <label v-for="user in view.candidates" :key="user.id" class="checkbox-field"
          ><input
            v-if="canManage"
            type="checkbox"
            v-model="chosen"
            :value="user.id"
            :disabled="busy"
          />{{ user.name }}<span v-if="user.assigned" class="small-label">지정됨</span></label
        >
      </div>
      <p v-if="canManage && !view.candidates.length" class="muted">
        이 조직에 직접 소속된 구성원이 없습니다.
      </p>
      <button v-if="canManage" class="button secondary" :disabled="busy || !dirty" @click="save">
        관리자 지정 저장
      </button>
    </template>
  </section>
</template>
