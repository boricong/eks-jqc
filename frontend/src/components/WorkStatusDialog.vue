<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onUnmounted, onMounted, nextTick } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { type TeamUserView, type WorkStatusPreview, workStatusLabels } from '@eks/contracts';
import { api, mutate, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import AppDialog from './AppDialog.vue';
import { randomUUID } from '../uuid';
const props = defineProps<{ user: TeamUserView; organizationRevision: number }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const store = useDemo();
const returnFocus = document.activeElement as HTMLElement | null;
const openedPath = location.pathname;
const error = ref(''),
  busy = ref(false);
const review = ref<WorkStatusPreview | null>(null);
const next = computed(() => (props.user.workStatus === 'deactive' ? 'active' : 'deactive'));
let sequence = 0;
let requestKey = randomUUID();
const path = (suffix = '') =>
  store.managementPath(`/team-users/${props.user.id}/work-status${suffix}`);
async function preview() {
  if (busy.value) return;
  const seq = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    // Refresh the user/organization revisions before confirming the change.
    const current = await api<import('@eks/contracts').TeamUsersView>(
      store.managementPath('/team-users'),
    );
    const user = current.users.find((u) => u.id === props.user.id);
    if (seq !== sequence) return;
    if (!user || (user.workStatus || 'active') !== (props.user.workStatus || 'active'))
      throw new Error(
        '대상자의 상태가 변경되었습니다. 이 창을 닫고 최신 목록에서 다시 확인해 주세요.',
      );
    const result = await api<WorkStatusPreview>(path('/preview'), {
      method: 'POST',
      body: JSON.stringify({
        status: next.value,
        revision: user.revision,
        organizationRevision: current.organizations.revision,
      }),
    });
    if (seq === sequence) {
      review.value = result;
      requestKey = randomUUID();
    }
  } catch (e) {
    if (seq === sequence) error.value = (e as Error).message;
  } finally {
    if (seq === sequence) busy.value = false;
  }
}
async function apply() {
  if (!review.value || busy.value) return;
  const seq = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    await mutate(path(), { token: review.value.token }, 'PUT', store.actorId, requestKey);
    if (seq !== sequence) return;
    await store.refresh();
    if (seq === sequence) {
      emit('saved');
      emit('close');
    }
  } catch (e) {
    if (seq === sequence) {
      error.value = (e as Error).message;
      if (e instanceof ApiError && [403, 409, 422].includes(e.status)) review.value = null;
    }
  } finally {
    if (seq === sequence) busy.value = false;
  }
}
function mayClose() {
  return !busy.value;
}
onMounted(preview);
async function close() {
  if (await mayClose()) emit('close');
}
onBeforeRouteLeave(mayClose);
function beforeUnload(e: BeforeUnloadEvent) {
  if (busy.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
window.addEventListener('beforeunload', beforeUnload);
watch([() => store.actorId, () => store.managementLv1], () => {
  sequence++;
  emit('close');
});
onBeforeUnmount(() => {
  sequence++;
  window.removeEventListener('beforeunload', beforeUnload);
});
onUnmounted(async () => {
  await nextTick();
  if (location.pathname === openedPath) {
    if (returnFocus?.isConnected && !returnFocus.matches(':disabled')) returnFocus.focus();
    else document.getElementById('main')?.focus();
  }
});
</script>
<template>
  <AppDialog :open="true" title="업무 상태 변경" class="work-status-dialog" @update:open="close">
    <div class="work-status-summary">
      <strong>{{ user.name }}</strong>
      <span
        >{{ workStatusLabels[user.workStatus || 'active'] }} → {{ workStatusLabels[next] }}</span
      >
    </div>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>
    <template #footer>
      <button
        type="button"
        class="button primary"
        :disabled="busy"
        @click="review ? apply() : preview()"
      >
        {{ busy ? '처리 중…' : review ? '변경' : '다시 확인' }}
      </button>
      <button type="button" class="button secondary" :disabled="busy" @click="close">취소</button>
    </template>
  </AppDialog>
</template>
<style scoped>
.work-status-dialog {
  width: min(400px, calc(100vw - 32px));
}
.work-status-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 16px;
  overflow-wrap: anywhere;
}
.work-status-summary strong {
  min-width: 0;
}
.work-status-summary span {
  white-space: nowrap;
}
</style>
