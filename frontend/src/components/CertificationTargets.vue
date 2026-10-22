<script setup lang="ts">
import { confirmAction } from '../composables/useConfirmation';
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import AppDialog from './AppDialog.vue';
import type { LifecycleEvent } from '@eks/contracts';
const store = useDemo();
type Target = {
  id: string;
  name: string;
  organizationPath: { name: string }[];
  eligibility: 'eligible' | 'hold';
  revision: number;
  progressCount: number;
  renewalCount: number;
  lastChange?: LifecycleEvent;
};
const data = ref<{ revision: number; users: Target[] }>(),
  selected = ref<string[]>([]),
  search = ref(''),
  filter = ref('all'),
  reason = ref(''),
  eligibility = ref('hold');
const busy = ref(false),
  error = ref(''),
  open = ref(false);
const visible = computed(
  () =>
    data.value?.users.filter(
      (u) =>
        u.name.includes(search.value) && (filter.value === 'all' || u.eligibility === filter.value),
    ) || [],
);
const chosen = computed(() => data.value?.users.filter((u) => selected.value.includes(u.id)) || []);
let generation = 0;
async function load() {
  const g = ++generation;
  error.value = '';
  try {
    const result = await api<typeof data.value>(store.managementPath('/certification-targets'));
    if (g === generation) data.value = result;
  } catch (e) {
    if (g === generation) error.value = (e as Error).message;
  }
}
watch(
  () => [store.actorId, store.managementLv1],
  () => {
    data.value = undefined;
    selected.value = [];
    open.value = false;
    if (store.managementReady) void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => generation++);
async function guard() {
  return (
    !busy.value &&
    (!selected.value.length ||
      (await confirmAction('저장하지 않은 대상자 선택을 취소하고 이동할까요?', '변경 버리고 이동')))
  );
}
onBeforeRouteLeave(guard);
onBeforeRouteUpdate(guard);
async function save() {
  if (!data.value || !reason.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    await store.command(
      store.managementPath('/certification-targets/eligibility'),
      {
        userIds: selected.value,
        eligibility: eligibility.value,
        reason: reason.value,
        revision: data.value.revision,
      },
      'PUT',
    );
    selected.value = [];
    open.value = false;
    reason.value = '';
    await load();
    store.notify('취득 대상자 상태를 저장했습니다.');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="panel editor-panel lifecycle-panel">
    <div class="section-heading">
      <h2>인증 대상자 관리</h2>
      <span class="muted"
        >대상 {{ data?.users.filter((u) => u.eligibility === 'eligible').length || 0 }}명 · Hold
        제외 {{ data?.users.filter((u) => u.eligibility === 'hold').length || 0 }}명</span
      >
    </div>
    <p>
      인원 단위 Hold는 모든 취득·재인증을 중단하고 대상자 통계에서 제외합니다. 기존 보유 자격의
      효력과 만료일은 그대로 유지됩니다.
    </p>
    <div class="form-grid">
      <label class="field">이름 검색<input v-model="search" type="search" /></label
      ><label class="field"
        >대상 여부<select v-model="filter">
          <option value="all">전체</option>
          <option value="eligible">대상</option>
          <option value="hold">Hold</option>
        </select></label
      >
    </div>
    <div class="table-panel lifecycle-target-table">
      <table>
        <thead>
          <tr>
            <th>선택</th>
            <th>이름 · 소속</th>
            <th>대상 여부</th>
            <th>변경일 · 사유</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in visible" :key="u.id">
            <td>
              <input
                v-model="selected"
                type="checkbox"
                :value="u.id"
                :aria-label="`${u.name} 선택`"
                :disabled="busy"
              />
            </td>
            <td>
              <strong>{{ u.name }}</strong>
              <p class="muted">{{ u.organizationPath.map((p) => p.name).join(' › ') }}</p>
            </td>
            <td>{{ u.eligibility === 'hold' ? 'Hold · 대상 제외' : '대상' }}</td>
            <td>
              {{
                u.lastChange
                  ? new Date(u.lastChange.recordedAt).toLocaleString('ko-KR')
                  : '변경 없음'
              }}
              <p>{{ u.lastChange?.reason }}</p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="data && !visible.length" class="empty-state">
      관리 범위에 해당하는 대상자가 없습니다.
    </p>
    <div aria-live="polite">
      <h3>선택한 인원 {{ chosen.length }}명</h3>
      <div class="lifecycle-selected">
        <button
          v-for="u in chosen"
          :key="u.id"
          class="button secondary"
          :disabled="busy"
          @click="selected = selected.filter((id) => id !== u.id)"
        >
          {{ u.name }} · 선택 해제
        </button>
      </div>
    </div>
    <div class="actions">
      <button class="button secondary" :disabled="busy" @click="load">최신 상태 확인</button
      ><button class="button primary" :disabled="busy || !selected.length" @click="open = true">
        대상자 상태 변경
      </button>
    </div>
    <p v-if="error && !open" role="alert" class="error-message">{{ error }}</p>
  </section>
  <AppDialog v-model:open="open" title="인증 대상자 Hold · 해제">
    <p>{{ chosen.map((u) => u.name).join(', ') }} · {{ chosen.length }}명</p>
    <p>
      진행 중 배정 {{ chosen.reduce((n, u) => n + u.progressCount, 0) }}건 · 재인증
      {{ chosen.reduce((n, u) => n + u.renewalCount, 0) }}건
    </p>
    <label class="field"
      >대상 상태<select v-model="eligibility" :disabled="busy">
        <option value="hold">Hold · 취득·재인증 중단 및 통계 제외</option>
        <option value="eligible">대상 · Hold 해제</option>
      </select></label
    >
    <p>기존 기록은 보존합니다. Hold 중에도 만료일은 지나며 만료 후에는 자동 폐기됩니다.</p>
    <label class="field"
      >변경 사유<textarea v-model="reason" rows="3" maxlength="2000" :disabled="busy" />
    </label>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="open = false">취소</button
      ><button class="button primary" :disabled="busy || !reason.trim()" @click="save">
        대상 상태 저장
      </button></template
    >
  </AppDialog>
</template>
