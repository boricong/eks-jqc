<script setup lang="ts">
import { confirmAction } from '../composables/useConfirmation';
import { computed, ref, watch } from 'vue';
import type { OrganizationAdministratorsView } from '@eks/contracts';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import AppIcon from './AppIcon.vue';
const props = defineProps<{ organizationId: string; canManage: boolean }>();
const emit = defineEmits<{
  dirty: [value: boolean];
  busy: [value: boolean];
  error: [];
  summary: [value: string];
}>();
const store = useDemo(),
  view = ref<OrganizationAdministratorsView>(),
  chosen = ref<string[]>([]),
  query = ref(''),
  baseline = ref('[]'),
  error = ref(''),
  busy = ref(false);
const dirty = computed(() => JSON.stringify([...chosen.value].sort()) !== baseline.value);
const candidates = computed(() =>
  (view.value?.candidates || []).filter((user) =>
    user.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
  ),
);
const selected = computed(() =>
  (view.value?.candidates || []).filter((user) => chosen.value.includes(user.id)),
);
const context = () => `${store.actorId}:${store.managementLv1}:${props.organizationId}`;
let generation = 0;
watch(dirty, (value) => emit('dirty', value));
watch(busy, (value) => emit('busy', value));
watch(error, (value) => {
  if (value) emit('error');
});
async function load() {
  const key = context(),
    seq = ++generation;
  error.value = '';
  try {
    const result = await api<OrganizationAdministratorsView>(
      store.managementPath(`/organization-settings/${props.organizationId}/administrators`),
    );
    if (key !== context() || seq !== generation) return;
    view.value = result;
    const assigned = result.candidates.filter((u) => u.assigned);
    emit(
      'summary',
      assigned.length
        ? assigned
            .slice(0, 2)
            .map((u) => u.name)
            .join(', ') + (assigned.length > 2 ? ` 외 ${assigned.length - 2}명` : '')
        : '지정된 관리자 없음',
    );
    chosen.value = result.candidates.filter((u) => u.assigned).map((u) => u.id);
    baseline.value = JSON.stringify([...chosen.value].sort());
  } catch (e) {
    if (key === context() && seq === generation) {
      error.value = (e as Error).message;
      emit('summary', '관리자 조회 실패');
    }
  }
}
async function reload() {
  if (
    !dirty.value ||
    (await confirmAction('지정 변경을 취소하고 다시 불러올까요?', '다시 불러오기'))
  )
    await load();
}
async function save() {
  if (
    !view.value ||
    !props.canManage ||
    busy.value ||
    !(await confirmAction(
      '선택한 구성원의 세부 조직 관리자 지정을 저장할까요? 다른 역할과 진행 내역은 유지됩니다.',
      '관리자 지정 저장',
    ))
  )
    return;
  const key = context();
  busy.value = true;
  error.value = '';
  try {
    await store.command(
      store.managementPath(`/organization-settings/${props.organizationId}/administrators`),
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
    emit('summary', '불러오는 중');
    chosen.value = [];
    query.value = '';
    baseline.value = '[]';
    void load();
  },
  { immediate: true },
);
</script>
<template>
  <section class="organization-administrators text-stack" aria-label="세부 조직 관리자 지정">
    <div class="section-heading">
      <h3>관리자 지정 현황</h3>
      <button v-if="canManage" class="button secondary small" :disabled="busy" @click="reload">
        지정 현황 새로고침
      </button>
    </div>
    <p class="muted">
      실제 소속 조직의 설명·담당 업무를 설정합니다. 소속이 바뀌면 지정을 해제합니다.
    </p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <template v-if="view">
      <template v-if="canManage">
        <label class="field"
          >구성원 검색<input v-model="query" placeholder="이름으로 검색"
        /></label>
        <p class="muted administrator-hint">이 조직에 직접 소속된 구성원만 표시합니다.</p>
        <ul v-if="candidates.length" class="administrator-candidates" aria-label="관리자 후보">
          <li v-for="user in candidates" :key="user.id">
            <label class="checkbox-field">
              <input
                type="checkbox"
                v-model="chosen"
                :value="user.id"
                :aria-label="user.name"
                :disabled="busy"
              /><span>{{ user.name }}</span
              ><span v-if="user.assigned" class="small-label">지정됨</span>
            </label>
          </li>
        </ul>
        <p v-else class="muted administrator-empty">
          {{
            view.candidates.length
              ? '검색에 맞는 구성원이 없습니다'
              : '이 조직에 소속된 구성원이 없습니다'
          }}
        </p>
      </template>
      <section class="administrator-selection" aria-label="선택한 관리자">
        <div class="section-heading">
          <h4 aria-live="polite" aria-atomic="true">선택한 관리자 {{ selected.length }}명</h4>
          <span v-if="canManage" class="small-label">{{
            dirty ? '저장 전 변경' : '저장된 지정'
          }}</span>
        </div>
        <ul v-if="selected.length" class="administrator-selected-list">
          <li v-for="user in selected" :key="user.id">
            <span>{{ user.name }}</span>
            <button
              v-if="canManage"
              class="administrator-remove"
              :aria-label="`${user.name} 선택 해제`"
              :disabled="busy"
              @click="chosen = chosen.filter((id) => id !== user.id)"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </li>
        </ul>
        <p v-else class="muted">선택한 관리자가 없습니다</p>
      </section>
      <button v-if="canManage" class="button secondary" :disabled="busy || !dirty" @click="save">
        관리자 지정 저장
      </button>
    </template>
  </section>
</template>
