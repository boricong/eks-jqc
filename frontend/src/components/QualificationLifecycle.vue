<script setup lang="ts">
import PropertyList from './PropertyList.vue';
import CollapsibleSection from './CollapsibleSection.vue';
import { ref, watch } from 'vue';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import AppDialog from './AppDialog.vue';
import {
  criterionLifecycleLabels,
  type LifecycleStatus,
  type Qualification,
  type LifecycleEvent,
} from '@eks/contracts';
const props = defineProps<{ qualification: Qualification; disabled?: boolean }>();
const emit = defineEmits<{ changed: []; versionCreated: [string] }>();
const store = useDemo();
const open = ref(false),
  busy = ref(false),
  error = ref(''),
  reason = ref('');
const status = ref<LifecycleStatus>('Hold');
const createOpen = ref(false);
const impact = ref<{
  revision: number;
  organizationRevision: number;
  qualification: Qualification;
  counts: Record<string, number>;
  events: LifecycleEvent[];
}>();
const countLabels: Record<string, string> = {
  organizations: '필수 지정 조직',
  draftPlans: '계획 초안',
  assignments: '확정 배정',
  certifications: '보유 자격',
  renewals: '진행 중 재인증',
};
let sequence = 0;
watch(
  () => [props.qualification.id, store.actorId, store.managementLv1],
  () => {
    sequence++;
    busy.value = false;
    open.value = false;
    impact.value = undefined;
  },
);
async function review() {
  const seq = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await api<typeof impact.value>(
      store.managementPath(`/qualifications/${props.qualification.id}/lifecycle-impact`),
    );
    if (seq !== sequence) return;
    impact.value = result;
    status.value = props.qualification.lifecycleStatus === 'Hold' ? 'Active' : 'Hold';
    reason.value = '';
    open.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    if (seq === sequence) busy.value = false;
  }
}
async function save() {
  if (!impact.value || !reason.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    await store.command(`/qualifications/${props.qualification.id}/lifecycle`, {
      status: status.value,
      reason: reason.value,
      revision: impact.value.qualification.revision,
      stateRevision: impact.value.revision,
      organizationRevision: impact.value.organizationRevision,
    });
    open.value = false;
    emit('changed');
    store.notify('자격 기준의 운영 상태를 변경했습니다.');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function createVersion() {
  busy.value = true;
  error.value = '';
  try {
    const result = await store.command(`/qualifications/${props.qualification.id}/versions`, {
      revision: props.qualification.revision,
    });
    createOpen.value = false;
    emit('versionCreated', result.id);
    store.notify('새 Active 버전을 만들었습니다. 최신 저장 버전을 신규 업무에 사용합니다.');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <CollapsibleSection title="자격 기준 운영 상태">
    <template #summary>
      <span class="lifecycle-badge" :data-status="qualification.lifecycleStatus || 'Active'">{{
        criterionLifecycleLabels[qualification.lifecycleStatus || 'Active']
      }}</span>
    </template>
    <div class="qualification-lifecycle-content">
      <div class="qualification-lifecycle-description">
        <p>
          Hold·Revoke는 신규 계획과 재인증을 중단합니다. 기존 확정 배정과 개인 보유 자격은
          유지됩니다.
        </p>
        <p v-if="qualification.lifecycleStatus === 'Revoke'" class="muted">
          폐기한 버전은 재개할 수 없습니다. 새 기준 버전을 작성해 주세요.
        </p>
      </div>
      <div class="qualification-lifecycle-actions">
        <button
          v-if="qualification.lifecycleStatus !== 'Revoke'"
          class="button secondary"
          :disabled="disabled || busy"
          @click="review"
        >
          운영 상태 변경
        </button>
        <button v-else class="button secondary" :disabled="busy" @click="review">
          운영 상태 이력 보기
        </button>
        <button
          v-if="qualification.lifecycleStatus === 'Revoke'"
          class="button secondary"
          :disabled="disabled || busy"
          @click="createOpen = true"
        >
          새 버전 작성
        </button>
      </div>
    </div>
    <p v-if="error && !open" role="alert" class="error-message">{{ error }}</p>
  </CollapsibleSection>
  <AppDialog v-model:open="createOpen" title="폐기 기준의 새 버전 작성">
    <p>
      기존 Revoke 버전과 취득 근거는 그대로 보존하고 동일한 내용의 새 Active 버전을 만듭니다. 기준을
      저장 즉시 최신 버전을 사용합니다. 필수 기준을 보완하기 전에는 신규 시작이 제한됩니다.
    </p>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="createOpen = false">취소</button
      ><button class="button primary" :disabled="busy" @click="createVersion">
        새 버전 만들기
      </button></template
    >
  </AppDialog>
  <AppDialog v-model:open="open" title="자격 기준 상태 변경">
    <template v-if="impact">
      <h3>{{ qualification.title }} · v{{ qualification.version }}</h3>
      <PropertyList class="lifecycle-facts">
        <div v-for="(count, key) in impact.counts" :key="key">
          <dt>{{ countLabels[key] }}</dt>
          <dd>{{ count }}건</dd>
        </div>
      </PropertyList>
      <label v-if="qualification.lifecycleStatus !== 'Revoke'" class="field"
        >변경할 운영 상태<select v-model="status" :disabled="busy">
          <option
            v-for="(label, key) in criterionLifecycleLabels"
            :key="key"
            :value="key"
            :disabled="key === (qualification.lifecycleStatus || 'Active')"
          >
            {{ label }}
          </option>
        </select></label
      >
      <p>
        신규 계획·재인증을 중단해도 이미 확정된 배정의 평가와 취득은 계속됩니다. 개인 보유 자격을
        정지하려면 별도로 처리하세요.
      </p>
      <label v-if="qualification.lifecycleStatus !== 'Revoke'" class="field"
        >변경 사유<textarea v-model="reason" :disabled="busy" rows="3" maxlength="2000" />
      </label>
      <p v-if="status === 'Revoke'">이 버전은 다시 Active로 전환할 수 없습니다.</p>
      <p v-if="error" role="alert" class="error-message">{{ error }}</p>
      <details v-if="impact.events.length">
        <summary>기준 상태 변경 이력 {{ impact.events.length }}건</summary>
        <p v-for="e in impact.events" :key="e.id">
          {{ new Date(e.recordedAt).toLocaleString('ko-KR') }} · {{ e.reason }} · {{ e.after }}
        </p>
      </details>
    </template>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="open = false">취소</button
      ><button
        v-if="qualification.lifecycleStatus !== 'Revoke'"
        class="button primary"
        :disabled="busy || !reason.trim()"
        @click="save"
      >
        상태 변경 저장
      </button></template
    >
  </AppDialog>
</template>
