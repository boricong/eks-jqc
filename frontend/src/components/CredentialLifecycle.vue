<script setup lang="ts">
import PropertyList from './PropertyList.vue';
import { ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import AppDialog from './AppDialog.vue';
import {
  lifecycleLabels,
  renewalNoticeOn,
  type Certification,
  type CertificationPeriod,
  type Renewal,
  type LifecycleEvent,
  type LifecycleStatus,
  type ValidityPolicy,
} from '@eks/contracts';
const props = defineProps<{ certification: Certification }>();
const store = useDemo(),
  route = useRoute();
type History = {
  certification: Certification;
  effectiveStatus: LifecycleStatus;
  current: { validity?: ValidityPolicy; expiresOn?: string };
  periods: CertificationPeriod[];
  events: LifecycleEvent[];
  renewals: Renewal[];
  canManage: boolean;
  canRenew: boolean;
  renewal: {
    canStart: boolean;
    reasons: string[];
    opensOn?: string;
    nextExpiresOn?: string;
    renewal?: Renewal;
    appliedQualification?: { title: string; version: number; validity: ValidityPolicy } | null;
  };
};
const data = ref<History>(),
  error = ref(''),
  busy = ref(false),
  dialog = ref(false),
  mode = ref<'renew' | 'status' | 'correct'>('renew'),
  reason = ref(''),
  status = ref<LifecycleStatus>('Hold'),
  evidence = ref(''),
  months = ref<number>(),
  lead = ref(3),
  noticeDays = ref(7),
  correctionType = ref('months');
function stateText(value: any) {
  if (typeof value === 'string') return value;
  return (
    (value?.status === 'draft' ? '작성 중' : value?.status) ||
    (value?.sequence ? `${value.sequence}회차 · ${value.expiresOn || '무기한'}` : '—')
  );
}
const dates = (v: string) => new Date(v).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
let sequence = 0;
const path = (suffix: string) =>
  `/certifications/${props.certification.id}/${suffix}${route.query.lv1OrganizationId ? `?lv1OrganizationId=${encodeURIComponent(String(route.query.lv1OrganizationId))}` : ''}`;
async function load() {
  const seq = ++sequence;
  try {
    const result = await api<History>(path('history'));
    if (seq === sequence) data.value = result;
  } catch (e) {
    if (seq === sequence) error.value = (e as Error).message;
  }
}
watch(
  () => [
    props.certification.id,
    props.certification.revision,
    store.actorId,
    route.query.lv1OrganizationId,
  ],
  () => {
    data.value = undefined;
    dialog.value = false;
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => sequence++);
async function start() {
  if (!data.value) return;
  busy.value = true;
  error.value = '';
  try {
    await store.command(path('renewals'), {
      certificationRevision: data.value.certification.revision,
    });
    await load();
    mode.value = 'renew';
    dialog.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function edit(next: 'status' | 'correct') {
  mode.value = next;
  reason.value = '';
  error.value = '';
  status.value = data.value?.effectiveStatus === 'Hold' ? 'Active' : 'Hold';
  dialog.value = true;
}
async function save() {
  if (!data.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (mode.value === 'renew') {
      const r = data.value.renewal.renewal;
      if (!r) throw new Error('최신 기준을 확인하여 재인증을 다시 시작해 주세요.');
      await store.command(`/renewals/${r.id}/complete`, {
        certificationRevision: data.value.certification.revision,
        revision: r.revision,
        confirmation: '종합평가 완료',
      });
      store.notify('MVP 종합평가 완료로 자격을 갱신했습니다. 최초 취득 근거는 유지됩니다.');
    } else if (mode.value === 'status')
      await store.command(path('status'), {
        revision: data.value.certification.revision,
        status: status.value,
        reason: reason.value,
      });
    else
      await store.command(path('validity-correction'), {
        revision: data.value.certification.revision,
        reason: reason.value,
        evidence: evidence.value,
        renewalLeadMonths: lead.value,
        renewalNoticeDaysBefore: noticeDays.value,
        validity: {
          type: correctionType.value,
          months: correctionType.value === 'months' ? months.value : null,
          reminderDays: [],
        },
      });
    dialog.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const eventLabels: Record<string, string> = {
  acquired: '최초 취득',
  expired: '만료 폐기',
  'status.changed': '상태 변경',
  'renewal.started': '재인증 시작',
  'renewal.completed': '갱신 완료',
  'validity.corrected': '유효기간 정정',
};
</script>
<template>
  <section class="panel editor-panel lifecycle-panel" aria-label="자격 상태와 재인증">
    <template v-if="data">
      <div class="section-heading">
        <h2>현재 효력과 재인증</h2>
        <span class="lifecycle-badge" :data-status="data.effectiveStatus">{{
          lifecycleLabels[data.effectiveStatus]
        }}</span>
      </div>
      <PropertyList class="lifecycle-facts">
        <div>
          <dt>최초 취득일</dt>
          <dd>{{ dates(certification.date) }}</dd>
        </div>
        <div>
          <dt>현재 만료일</dt>
          <dd>
            {{
              data.current.expiresOn ||
              (data.current.validity?.type === 'unlimited' ? '무기한' : '확인 필요')
            }}
          </dd>
        </div>
        <div>
          <dt>재인증 시작일</dt>
          <dd>{{ data.renewal.opensOn || '정기 재인증 대상 아님' }}</dd>
        </div>
        <div v-if="data.periods.at(-1) && renewalNoticeOn(data.periods.at(-1)!)">
          <dt>재인증 사전 알림 · 1회</dt>
          <dd>{{ renewalNoticeOn(data.periods.at(-1)!) }}</dd>
        </div>
      </PropertyList>
      <p>
        최초 취득 근거는 보존되며 갱신은 기존 만료일부터 새 기간을 이어 갑니다. Hold 중에도 만료일은
        연장되지 않습니다.
      </p>
      <template v-if="data.canRenew">
        <p v-if="data.effectiveStatus === 'Revoke'" class="error-message">
          폐기된 자격입니다. 현재 필수 자격과 관리자의 새 요청을 확인하여 인증Set 평가부터 다시
          취득해 주세요.
        </p>
        <p v-else-if="!data.renewal.canStart" class="muted">
          {{ data.renewal.reasons.join(' · ') }}
        </p>
        <button v-if="data.renewal.canStart" class="button primary" :disabled="busy" @click="start">
          {{ data.renewal.renewal ? '재인증 이어서 진행' : '재인증 시작' }}
        </button>
        <RouterLink v-if="data.effectiveStatus === 'Revoke'" class="button secondary" to="/plans"
          >재취득 계획·요청 확인</RouterLink
        >
      </template>
      <div v-if="data.canManage && data.effectiveStatus !== 'Revoke'" class="actions">
        <button class="button secondary" :disabled="busy" @click="edit('status')">
          개인 자격 상태 변경</button
        ><button
          v-if="data.certification.validityNeedsCorrection"
          class="button secondary"
          :disabled="busy"
          @click="edit('correct')"
        >
          유효기간 근거 확인·정정
        </button>
      </div>
      <p v-if="error && !dialog" class="error-message" role="alert">{{ error }}</p>
      <button class="text-link" :disabled="busy" @click="load">최신 상태 확인</button>
      <details class="lifecycle-history">
        <summary>취득·변경·갱신·정지·폐기 이력 {{ data.events.length }}건</summary>
        <ol>
          <li v-for="e in data.events" :key="e.id">
            <strong>{{ eventLabels[e.action] || e.action }}</strong>
            <p>{{ e.reason }}</p>
            <p>변경 전 {{ stateText(e.before) }} → 변경 후 {{ stateText(e.after) }}</p>
            <PropertyList class="lifecycle-facts">
              <div>
                <dt>효력 발생</dt>
                <dd>{{ dates(e.effectiveAt) }}</dd>
              </div>
              <div>
                <dt>기록 일시</dt>
                <dd>{{ dates(e.recordedAt) }}</dd>
              </div>
              <div>
                <dt>처리자</dt>
                <dd>
                  {{ e.actorId === 'system' ? '시스템 자동 처리' : store.username(e.actorId) }}
                </dd>
              </div>
            </PropertyList>
          </li>
        </ol>
      </details>
      <details class="lifecycle-history">
        <summary>유효기간과 갱신 근거 {{ data.periods.length }}건</summary>
        <ol>
          <li v-for="p in data.periods" :key="p.id">
            <strong
              >{{ p.sequence }}회차 · {{ p.kind === 'initial' ? '최초 취득' : '종합평가 재인증' }} ·
              적용 v{{ p.qualificationVersion }}</strong
            >
            <p>
              {{ p.startsOn }} ~
              {{ p.expiresOn || (p.validity.type === 'unlimited' ? '무기한' : '확인 필요') }} · 실제
              완료 {{ dates(p.completedAt) }}
            </p>
            <p v-if="p.kind === 'renewal'">MVP 완료 버튼으로 처리 · 실제 종합평가 점수 없음</p>
          </li>
        </ol>
      </details>
    </template>
    <p v-else-if="error" role="alert" class="error-message">{{ error }}</p>
    <p v-else class="muted">자격 이력을 불러오고 있습니다.</p>
  </section>
  <AppDialog
    v-model:open="dialog"
    :title="
      mode === 'renew'
        ? '자격 재인증 · 종합평가'
        : mode === 'correct'
          ? '유효기간 근거 확인·정정'
          : '개인 보유 자격 상태 변경'
    "
  >
    <template v-if="data">
      <template v-if="mode === 'renew'"
        ><h3>
          {{ data.renewal.appliedQualification?.title }} · v{{
            data.renewal.appliedQualification?.version
          }}
        </h3>
        <PropertyList class="lifecycle-facts">
          <div>
            <dt>기존 만료일</dt>
            <dd>{{ data.current.expiresOn }}</dd>
          </div>
          <div>
            <dt>갱신 후 만료일</dt>
            <dd>{{ data.renewal.nextExpiresOn || '무기한' }}</dd>
          </div>
        </PropertyList>
        <p>
          이번 MVP는 종합평가 문항 없이 완료 버튼으로 재인증 절차를 검증합니다. 실제 능력 평가를
          완료했다는 의미가 아니며 처리 방식이 이력에 남습니다.
        </p>
        <p>인증Set별 수료와 최초 취득일·발급번호는 유지됩니다.</p></template
      >
      <template v-else
        ><label v-if="mode === 'status'" class="field"
          >개인 자격 상태<select v-model="status" :disabled="busy">
            <option
              v-for="(label, key) in lifecycleLabels"
              :value="key"
              :disabled="
                key === data.effectiveStatus ||
                (data.certification.validityNeedsCorrection && key !== 'Revoke')
              "
            >
              {{ label }}
            </option>
          </select></label
        >
        <template v-if="mode === 'correct'"
          ><p>
            이관된 기간 미정 기록만 정정합니다. 최초 취득일에 확인한 기간을 적용하며 이미 만료됐다면
            Revoke로 처리됩니다.
          </p>
          <label class="field"
            >확인한 인증기간<select v-model="correctionType">
              <option value="months">기간제</option>
              <option value="unlimited">무기한</option>
            </select></label
          ><label v-if="correctionType === 'months'" class="field"
            >확인한 유효 개월 수<input
              v-model.number="months"
              type="number"
              min="1"
              max="1200" /></label
          ><label v-if="correctionType === 'months'" class="field"
            >재인증 시작 N일 전 알림<input
              v-model.number="noticeDays"
              type="number"
              min="0"
              max="365" /></label
          ><label class="field"
            >재인증 시작 개월 수<input
              v-model.number="lead"
              type="number"
              min="1"
              max="1200" /></label
          ><label class="field">확인 근거<textarea v-model="evidence" rows="3" /></label
        ></template>
        <label class="field"
          >변경 사유<textarea v-model="reason" rows="3" maxlength="2000" :disabled="busy" />
        </label>
        <p v-if="mode === 'status' && status === 'Revoke'">
          폐기 후에는 이 인증을 되살릴 수 없습니다. 새 요청과 인증Set 평가를 통해 다시 취득해야
          합니다.
        </p>
      </template>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    </template>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="dialog = false">취소</button
      ><button
        class="button primary"
        :disabled="busy || (mode !== 'renew' && !reason.trim())"
        @click="save"
      >
        {{
          mode === 'renew'
            ? '종합평가 완료'
            : mode === 'correct'
              ? '근거 확인·정정 저장'
              : '개인 자격 상태 저장'
        }}
      </button></template
    >
  </AppDialog>
</template>
