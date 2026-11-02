<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { api, mutate, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { randomUUID } from '../uuid';
import AppDialog from './AppDialog.vue';
import AppIcon from './AppIcon.vue';
import StatusBadge from './StatusBadge.vue';
const props = defineProps<{
  team: { id: string; name: string; auditorEnabled?: boolean };
  revision: number;
  disabled?: boolean;
  disabledReason?: string;
}>();
const emit = defineEmits<{ saved: [] }>();
const store = useDemo();
const open = ref(false),
  enabled = ref(false),
  busy = ref(false),
  error = ref('');
const review = ref<{ token: string; members: number; ongoing: number; certifications: number }>();
const trigger = ref<HTMLButtonElement>(),
  selection = ref<HTMLFieldSetElement>(),
  confirmButton = ref<HTMLButtonElement>(),
  errorMessage = ref<HTMLElement>(),
  reviewSection = ref<HTMLElement>();
let sequence = 0,
  key = randomUUID();
const path = () => `/system/organizations/${encodeURIComponent(props.team.id)}/auditor-eligibility`;
function dismiss(restoreFocus = true) {
  open.value = false;
  review.value = undefined;
  error.value = '';
  if (restoreFocus) void nextTick(() => trigger.value?.focus());
}
function close() {
  if (!busy.value) dismiss();
}
async function focusSelection() {
  await nextTick();
  selection.value?.querySelector<HTMLInputElement>('input:checked')?.focus();
}
async function show() {
  if (props.disabled || busy.value) return;
  enabled.value = !!props.team.auditorEnabled;
  review.value = undefined;
  error.value = '';
  open.value = true;
  await nextTick();
  await focusSelection();
}
async function chooseAgain() {
  review.value = undefined;
  error.value = '';
  await focusSelection();
}
async function preview() {
  if (busy.value || enabled.value === !!props.team.auditorEnabled) return;
  const seq = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await api<NonNullable<typeof review.value>>(path() + '/preview', {
      method: 'POST',
      body: JSON.stringify({ enabled: enabled.value, revision: props.revision }),
    });
    if (seq === sequence) {
      review.value = result;
      key = randomUUID();
    }
  } catch (e) {
    if (seq === sequence) {
      error.value = (e as Error).message;
      if (e instanceof ApiError && [403, 409].includes(e.status)) emit('saved');
    }
  } finally {
    if (seq === sequence) {
      busy.value = false;
      await nextTick();
      if (seq === sequence) {
        if (review.value) {
          reviewSection.value?.scrollIntoView({ block: 'nearest' });
          confirmButton.value?.focus();
        } else if (error.value) errorMessage.value?.focus();
      }
    }
  }
}
async function save() {
  if (!review.value || busy.value) return;
  const seq = ++sequence;
  busy.value = true;
  error.value = '';
  try {
    await mutate(path(), { token: review.value.token }, 'PUT', store.actorId, key);
    if (seq === sequence) {
      await store.refresh();
      if (seq !== sequence) return;
      dismiss();
      emit('saved');
    }
  } catch (e) {
    if (seq === sequence) {
      error.value = (e as Error).message;
      if (e instanceof ApiError && [403, 409].includes(e.status)) {
        review.value = undefined;
        emit('saved');
      }
    }
  } finally {
    if (seq === sequence) {
      busy.value = false;
      await nextTick();
      if (seq === sequence && error.value) errorMessage.value?.focus();
    }
  }
}
watch([() => props.team.id, () => store.actorId], () => {
  sequence++;
  busy.value = false;
  dismiss(false);
});
onBeforeRouteLeave(() => !busy.value);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <section aria-label="Auditor 대상 팀 설정" class="auditor-team-setting">
    <div class="auditor-team-setting-heading">
      <div class="auditor-team-setting-title">
        <AppIcon name="users" :size="20" />
        <h3>Auditor 대상 팀</h3>
        <StatusBadge
          :status="team.auditorEnabled ? 'active' : 'retired'"
          :label="team.auditorEnabled ? '사용' : '미사용'"
        />
      </div>
      <button
        ref="trigger"
        type="button"
        class="button secondary"
        :disabled="disabled || busy"
        :title="disabled ? disabledReason : undefined"
        aria-label="Auditor 대상 팀 변경"
        @click="show"
      >
        <AppIcon name="edit" :size="16" />변경
      </button>
    </div>
    <p class="auditor-team-setting-description">
      {{
        team.auditorEnabled
          ? '이 팀과 모든 하위 조직의 구성원이 Auditor 취득 대상입니다.'
          : '이 팀의 신규 Auditor 취득을 사용하지 않습니다.'
      }}
    </p>
    <p v-if="disabled && disabledReason" class="auditor-team-setting-disabled" role="status">
      {{ disabledReason }}
    </p>
  </section>
  <AppDialog
    v-if="open"
    :open="open"
    :busy="busy"
    scroll-body
    title="Auditor 대상 팀 설정"
    @update:open="close"
  >
    <div class="auditor-team-dialog">
      <div class="auditor-team-identity">
        <span class="auditor-team-caption">대상 조직 · Lv1</span><strong>{{ team.name }}</strong>
      </div>
      <fieldset ref="selection" class="auditor-team-options" :disabled="busy || !!review">
        <legend>Auditor 사용 여부</legend>
        <div class="auditor-team-option-grid">
          <label class="auditor-team-option" :class="{ selected: enabled }"
            ><input
              type="radio"
              name="auditor-team-enabled"
              v-model="enabled"
              :value="true"
              aria-label="사용"
            /><span>사용</span></label
          >
          <label class="auditor-team-option" :class="{ selected: !enabled }"
            ><input
              type="radio"
              name="auditor-team-enabled"
              v-model="enabled"
              :value="false"
              aria-label="미사용"
            /><span>미사용</span></label
          >
        </div>
      </fieldset>
      <p class="auditor-team-policy">
        {{
          enabled
            ? '선택한 팀과 모든 하위 조직의 구성원이 개인 지정 없이 취득 대상이 됩니다.'
            : '신규 취득·갱신·재취득을 중단합니다. 기존 진행 회차와 인증은 유지됩니다.'
        }}
      </p>
      <section
        v-if="review"
        ref="reviewSection"
        class="auditor-team-review"
        aria-label="대상 팀 변경 내용"
      >
        <div class="auditor-team-review-heading">
          <h3>변경 내용</h3>
          <div class="auditor-team-transition">
            <StatusBadge
              :status="team.auditorEnabled ? 'active' : 'retired'"
              :label="`현재 ${team.auditorEnabled ? '사용' : '미사용'}`"
            /><AppIcon name="arrow" :size="16" /><StatusBadge
              :status="enabled ? 'active' : 'retired'"
              :label="`변경 후 ${enabled ? '사용' : '미사용'}`"
            />
          </div>
        </div>
        <dl class="auditor-team-impact">
          <div>
            <dt>소속 인원</dt>
            <dd>{{ review.members }}<span>명</span></dd>
          </div>
          <div>
            <dt>진행 회차</dt>
            <dd>{{ review.ongoing }}<span>건</span></dd>
          </div>
          <div>
            <dt>보유 인증</dt>
            <dd>{{ review.certifications }}<span>건</span></dd>
          </div>
        </dl>
      </section>
      <p v-if="error" ref="errorMessage" class="error-message" role="alert" tabindex="-1">
        {{ error }}
      </p>
      <p v-if="busy" class="auditor-team-progress" role="status">
        {{ review ? '대상 팀 설정을 변경하고 있습니다.' : '변경할 내용을 확인하고 있습니다.' }}
      </p>
    </div>
    <template #footer>
      <button type="button" class="button secondary" :disabled="busy" @click="close">취소</button>
      <button
        v-if="review"
        type="button"
        class="button secondary"
        :disabled="busy"
        @click="chooseAgain"
      >
        다시 선택
      </button>
      <button
        v-if="!review"
        type="button"
        class="button primary"
        :disabled="busy || enabled === !!team.auditorEnabled"
        @click="preview"
      >
        {{ busy ? '확인 중' : '변경' }}
      </button>
      <button
        v-else
        ref="confirmButton"
        type="button"
        class="button primary"
        :disabled="busy"
        @click="save"
      >
        {{ busy ? '변경 중' : '변경 확정' }}
      </button>
    </template>
  </AppDialog>
</template>
<style scoped>
.auditor-team-setting {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
}
.auditor-team-setting-heading,
.auditor-team-setting-title {
  display: flex;
  align-items: center;
  gap: 12px;
}
.auditor-team-setting-heading {
  justify-content: space-between;
}
.auditor-team-setting-title {
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
}
.auditor-team-setting-title > svg {
  flex-shrink: 0;
  color: var(--ink-secondary);
}
.auditor-team-setting h3 {
  margin: 0;
  font-size: var(--text-body);
  font-weight: var(--weight-control);
  line-height: 1.5;
}
.auditor-team-setting-description,
.auditor-team-setting-disabled {
  margin: 12px 0 0;
  color: var(--ink-secondary);
  font-size: var(--text-caption);
  line-height: 1.65;
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.auditor-team-setting-disabled {
  color: var(--warning);
}
.auditor-team-dialog {
  min-width: 0;
}
.auditor-team-dialog p {
  margin: 0;
}
.auditor-team-identity {
  display: grid;
  gap: 8px;
  padding: 16px 20px;
  background: var(--surface-tint);
  border: 1px solid var(--line);
}
.auditor-team-caption {
  font-size: var(--text-caption);
  color: var(--ink-secondary);
}
.auditor-team-identity strong {
  font-size: var(--text-body);
  line-height: 1.6;
  font-weight: var(--weight-control);
  overflow-wrap: anywhere;
  word-break: keep-all;
}
.auditor-team-options {
  margin: 24px 0 0;
  border: 0;
  padding: 0;
  min-width: 0;
}
.auditor-team-options legend {
  padding: 0;
  margin-bottom: 12px;
  font-weight: var(--weight-control);
  font-size: var(--text-body);
}
.auditor-team-option-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.auditor-team-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  min-height: 48px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius-input);
  cursor: pointer;
}
.auditor-team-option.selected {
  border-color: var(--primary);
  background: var(--selection);
}
.auditor-team-option input {
  width: 18px;
  height: 18px;
  margin: 0;
  flex-shrink: 0;
  accent-color: var(--primary);
}
.auditor-team-option:has(input:focus-visible) {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
.auditor-team-options:disabled .auditor-team-option {
  cursor: default;
}
.auditor-team-policy {
  margin-top: 12px !important;
  font-size: var(--text-caption);
  line-height: 1.65;
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
  word-break: keep-all;
}
.auditor-team-review {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
.auditor-team-review-heading {
  display: grid;
  gap: 12px;
}
.auditor-team-review h3 {
  margin: 0;
  font-size: var(--text-body);
  font-weight: var(--weight-control);
}
.auditor-team-transition {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.auditor-team-impact {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--line);
  margin: 16px 0 0;
}
.auditor-team-impact > div {
  min-width: 0;
  padding: 14px 12px;
}
.auditor-team-impact > div + div {
  border-left: 1px solid var(--line);
}
.auditor-team-impact dt {
  font-size: var(--text-caption);
  color: var(--ink-secondary);
  line-height: 1.5;
}
.auditor-team-impact dd {
  margin: 8px 0 0;
  font-size: 22px;
  line-height: 1.4;
  font-weight: var(--weight-heading);
  font-variant-numeric: tabular-nums;
}
.auditor-team-impact dd span {
  margin-left: 4px;
  font-size: var(--text-caption);
  font-weight: var(--weight-body);
}
.auditor-team-dialog .error-message,
.auditor-team-progress {
  margin-top: 16px;
}
.auditor-team-progress {
  font-size: var(--text-caption);
  color: var(--ink-secondary);
}
@media (max-width: 767px) {
  .auditor-team-setting-heading {
    align-items: flex-start;
    gap: 12px;
  }
  .auditor-team-setting-heading > .button {
    flex-shrink: 0;
  }
  .auditor-team-setting-title {
    gap: 8px;
  }
  .auditor-team-identity {
    padding: 14px 16px;
  }
  .auditor-team-option {
    padding: 12px;
  }
  .auditor-team-impact > div {
    padding: 12px 8px;
  }
  .auditor-team-impact dt {
    font-size: 12px;
  }
}
</style>
