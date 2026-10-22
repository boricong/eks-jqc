<script setup lang="ts">
import { confirmAction } from '../composables/useConfirmation';
import { ref, watch, nextTick } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import type { Qualification } from '@eks/contracts';
import AppDialog from './AppDialog.vue';
import RowActions from './RowActions.vue';
const props = defineProps<{
  qualification: Qualification;
  disabled?: boolean;
  compact?: boolean;
}>();
const emit = defineEmits<{ deleted: [] }>();
const rowActions = ref<InstanceType<typeof RowActions>>();
async function restoreFocus() {
  await nextTick();
  rowActions.value?.focus();
}
const store = useDemo(),
  open = ref(false),
  busy = ref(false),
  reason = ref(''),
  error = ref('');
type Impact = {
  qualificationRevision: number;
  stateRevision: number;
  organizationRevision: number;
  references: Record<string, number>;
  canDelete: boolean;
  blockers: string[];
  mode: 'archive' | 'remove';
};
const impact = ref<Impact>();
watch(
  () => [store.actorId, store.managementLv1, props.qualification.id],
  () => {
    open.value = false;
    reason.value = '';
    impact.value = undefined;
    error.value = '';
  },
);
const canLeave = async () =>
  !store.managementAccess ||
  (!busy.value &&
    (!open.value ||
      !reason.value ||
      (await confirmAction('작성 중인 삭제 사유를 취소하고 이동할까요?', '변경 버리고 이동'))));
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
const labels: Record<string, string> = {
  lifecycleEvents: '상태 변경 근거',
  pools: '팀 적용 목록',
  requests: '계획 요청',
  plans: '개인 계획',
  assignments: '배정',
  certifications: '인증',
  renewals: '재인증',
  successors: '후속 버전',
};
async function review() {
  open.value = true;
  busy.value = true;
  error.value = '';
  impact.value = undefined;
  const actor = store.actorId,
    scope = store.managementLv1;
  try {
    const result = await api<Impact>(
      store.managementPath(`/qualifications/${props.qualification.id}/deletion-impact`),
    );
    if (actor === store.actorId && scope === store.managementLv1) impact.value = result;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (!impact.value?.canDelete || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await store.command(
      `/qualifications/${props.qualification.id}`,
      { ...impact.value, reason: reason.value },
      'DELETE',
    );
    open.value = false;
    store.notify('선택한 자격 버전을 삭제했습니다. 인증Set과 기존 인증은 유지됩니다.');
    emit('deleted');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <RowActions
    v-if="compact && !qualification.deletedAt"
    ref="rowActions"
    :label="`${qualification.title} 더보기`"
    :disabled="disabled || busy"
    :actions="[{ id: 'delete', label: '자격 삭제' }]"
    @action="review"
  />
  <button
    v-else-if="!qualification.deletedAt"
    class="button secondary"
    :disabled="disabled || busy"
    @click="review"
  >
    자격 삭제
  </button>
  <AppDialog
    :open="open"
    title="자격 삭제 확인"
    @closed="restoreFocus"
    @update:open="
      (v) => {
        if (!busy) open = v;
      }
    "
  >
    <h3>{{ qualification.title || '이름 없는 자격' }} · v{{ qualification.version }}</h3>
    <p>{{ store.managementOrganization?.name }}</p>
    <template v-if="impact">
      <dl class="deletion-counts">
        <div v-for="(count, key) in impact.references" :key="key">
          <dt>{{ labels[key] || key }}</dt>
          <dd>{{ count }}건</dd>
        </div>
      </dl>
      <p v-if="impact.canDelete">
        {{
          impact.mode === 'archive'
            ? '관리 목록에서 제외하고 기존 기록의 기준은 보존합니다.'
            : '참조가 없는 선택 버전을 백업 후 제거합니다.'
        }}
        다른 자격 버전과 연결된 인증Set은 삭제하지 않습니다.
      </p>
      <p v-else class="error-message">{{ impact.blockers.join(' ') }}</p>
      <RouterLink v-if="!impact.canDelete" :to="store.managementLink('/admin/policies')"
        >조직별 자격 설정</RouterLink
      >
      <label v-if="impact.canDelete" class="field"
        ><span>삭제 사유</span
        ><textarea v-model="reason" rows="3" maxlength="2000" :disabled="busy" />
      </label>
    </template>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <button v-if="error" class="text-link" @click="review">영향 다시 확인</button>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="open = false">취소</button
      ><button
        class="button primary"
        :disabled="busy || !impact?.canDelete || !reason.trim()"
        @click="remove"
      >
        선택 버전 삭제
      </button></template
    >
  </AppDialog>
</template>
<style scoped>
.deletion-counts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 24px 0;
}
.deletion-counts div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.deletion-counts dd {
  margin: 0;
}
</style>
