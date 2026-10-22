<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ProgressSummary, ResetScope } from '@eks/contracts';
import { api, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import AppDialog from './AppDialog.vue';

const store = useDemo();
const summary = ref<ProgressSummary | null>(null);
const target = ref('');
const scope = computed<ResetScope>(() =>
  target.value === 'all'
    ? { type: 'all' }
    : { type: 'organization', lv1OrganizationId: target.value },
);
const targetName = computed(() =>
  target.value === 'all'
    ? '전체 조직'
    : store.data.organizations.find((o) => o.id === target.value)?.name || '조직 미선택',
);
let refreshVersion = 0;
const loading = ref(false),
  busy = ref(false),
  open = ref(false);
const error = ref(''),
  resetError = ref(''),
  confirmation = ref('');
const labels: Record<keyof ProgressSummary['counts'], string> = {
  renewals: '재인증 진행',
  certificationPeriods: '인증 유효기간 이력',
  credentialEvents: '개인 자격 상태 이력',
  objectiveAttempts: '지식 평가 응시',
  practicalAttempts: '상황 대응 평가 응시',
  learningRecords: '과거 학습 완료 기록',
  notifications: '진행 관련 알림',
  completions: '인증Set 수료',
  certifications: '검증용 인증',
  comparisons: '실제 수행 비교',
};
const total = computed(() =>
  Object.values(summary.value?.counts || {}).reduce((n, count) => n + count, 0),
);
async function refresh() {
  const version = ++refreshVersion;
  if (!target.value) {
    summary.value = null;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const result = await api<ProgressSummary>(
      `/testing/progress?scope=${scope.value.type}${scope.value.type === 'organization' ? `&lv1OrganizationId=${encodeURIComponent(scope.value.lv1OrganizationId)}` : ''}`,
    );
    if (version === refreshVersion) summary.value = result;
  } catch (err) {
    error.value = (err as Error).message;
    summary.value = null;
  } finally {
    loading.value = false;
  }
}
async function reviewReset() {
  await refresh();
  if (!summary.value || !total.value) return;
  confirmation.value = '';
  resetError.value = '';
  open.value = true;
}
async function reset() {
  if (!summary.value || busy.value || confirmation.value !== '초기화') return;
  busy.value = true;
  resetError.value = '';
  try {
    await store.command('/testing/progress/reset', {
      revision: summary.value.revision,
      confirmation: confirmation.value,
      scope: summary.value.scope,
    });
    open.value = false;
    store.notify(`${targetName.value}의 학습·평가 진행 내역을 초기화했습니다.`);
    await refresh();
  } catch (err) {
    resetError.value =
      err instanceof ApiError && err.code === 'REVISION_CONFLICT'
        ? '확인 중 진행 내역이 변경되었습니다. 취소 후 초기화 내역을 다시 확인해 주세요.'
        : (err as Error).message;
  } finally {
    busy.value = false;
  }
}
watch(target, () => {
  summary.value = null;
  void refresh();
});
</script>
<template>
  <section class="panel editor-panel test-progress-panel" :aria-busy="loading">
    <div class="section-heading">
      <h2>학습·평가 내역 초기화</h2>
      <button class="button secondary" :disabled="loading || busy" @click="refresh">
        새로고침
      </button>
    </div>
    <p>대상 조직의 학습·평가 진행 내역을 지우고 배정된 인증Set을 처음부터 테스트합니다.</p>
    <label class="field"
      ><span>초기화 대상</span
      ><select aria-label="초기화 대상" v-model="target" :disabled="loading || busy || open">
        <option value="">대상을 선택해 주세요</option>
        <option value="all">전체 조직</option>
        <option
          v-for="o in store.data.organizations.filter((o) => o.level === 1)"
          :key="o.id"
          :value="o.id"
        >
          {{ o.name }}
        </option>
      </select></label
    >
    <p class="muted">
      조직정보·변경 이력, 사용자 소속·역할, 자격·인증Set 기준과 운영 상태, 개인 계획·일정·목표, 계획
      요청·알림, 배정·담당 기준·제외 설정, 공지는 유지됩니다.
    </p>
    <div v-if="error" class="error-message" role="alert">{{ error }}</div>
    <dl v-if="summary" class="reset-counts">
      <div v-for="(label, key) in labels" :key="key">
        <dt>{{ label }}</dt>
        <dd>{{ summary.counts[key] }}건</dd>
      </div>
    </dl>
    <p class="muted">
      작성 중인 답안과 근거, 확정 결과, 관련 변경 이력도 초기화됩니다. 초기화 전 기록은 백업합니다.
    </p>
    <div class="actions">
      <button
        class="button secondary"
        :disabled="loading || busy || !summary || !total"
        @click="reviewReset"
      >
        진행 내역 초기화
      </button>
      <span v-if="summary && !total" class="muted">초기화할 진행 내역이 없습니다.</span>
    </div>
  </section>
  <AppDialog
    :open="open"
    :title="`${targetName}의 진행 내역을 초기화할까요?`"
    @update:open="
      (value) => {
        if (!busy) open = value;
      }
    "
  >
    <p>
      선택한 대상의 응시·평가·수료·인증·비교 기록이 삭제됩니다. 조직정보·사용자 소속·역할과
      자격·인증Set·배정 설정은 유지됩니다.
    </p>
    <p>다른 탭에서 평가 중인 사용자도 영향을 받습니다. 초기화 후 해당 화면을 새로고침해 주세요.</p>
    <p class="muted">초기화 전 기록은 백업하며, 복구는 서버를 중지한 뒤 수행할 수 있습니다.</p>
    <div v-if="resetError" class="error-message" role="alert">{{ resetError }}</div>
    <label class="field"
      ><span>확인을 위해 ‘초기화’를 입력해 주세요.</span
      ><input v-model="confirmation" :disabled="busy" autocomplete="off"
    /></label>
    <template #footer>
      <button class="button secondary" :disabled="busy" @click="open = false">취소</button>
      <button class="button primary" :disabled="busy || confirmation !== '초기화'" @click="reset">
        {{ busy ? '초기화 중' : '초기화 실행' }}
      </button>
    </template>
  </AppDialog>
</template>
