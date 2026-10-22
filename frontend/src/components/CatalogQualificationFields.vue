<script setup lang="ts">
import { computed } from 'vue';
import RenewalNoticeExample from './RenewalNoticeExample.vue';
import CatalogFieldErrors from './CatalogFieldErrors.vue';
import type { CatalogIssue } from '@eks/contracts';
import type { CatalogSheet } from '@eks/contracts';
const props = defineProps<{ sheet: CatalogSheet; disabled?: boolean; issues?: CatalogIssue[] }>();
const emit = defineEmits<{ change: []; checkpoint: [] }>();
const validity = computed({
  get: () =>
    props.sheet.validityType === 'months'
      ? props.sheet.months === 36
        ? 'three-years'
        : 'months'
      : props.sheet.validityType,
  set: (v: string) => {
    if (v === 'three-years') {
      props.sheet.validityType = 'months';
      props.sheet.months = 36;
    } else if (v === 'months') {
      props.sheet.validityType = 'months';
      props.sheet.months = null;
    } else {
      props.sheet.validityType = v as 'unknown' | 'unlimited';
      props.sheet.months = null;
      props.sheet.reminderDays = [];
    }
    emit('change');
  },
});
</script>
<template>
  <fieldset
    class="catalog-fields catalog-qualification-fields"
    :disabled="disabled"
    @focusin="emit('checkpoint')"
    @input="emit('change')"
    @change="emit('change')"
  >
    <dl class="property-list">
      <dt>자격명</dt>
      <dd>{{ sheet.title }}</dd>
      <dt>영문명</dt>
      <dd>{{ sheet.englishName || '—' }}</dd>
      <dt>공통 설명</dt>
      <dd style="white-space: pre-wrap">{{ sheet.description || '시스템 관리자 보완 필요' }}</dd>
    </dl>
    <div class="form-grid">
      <label class="field"
        >인증기간<select v-model="validity" data-field="validityType" aria-label="인증기간">
          <option value="unknown">미정</option>
          <option value="three-years">취득 후 3년</option>
          <option value="months">기간 직접 입력</option>
          <option value="unlimited">무기한</option></select
        ><CatalogFieldErrors :issues="issues" field="validityType" /></label
      ><label v-if="validity === 'months'" class="field"
        >유효 개월 수<input
          v-model.number="sheet.months"
          data-field="months"
          type="number"
          min="1"
          max="1200" /><CatalogFieldErrors :issues="issues" field="months" /></label
      ><label v-if="sheet.validityType === 'months'" class="field"
        >재인증 시작 N일 전 알림<input
          :value="sheet.renewalNoticeDaysBefore ?? 7"
          data-field="renewalNoticeDaysBefore"
          type="number"
          min="0"
          max="365"
          @input="
            sheet.renewalNoticeDaysBefore = Number(($event.target as HTMLInputElement).value)
          " /><CatalogFieldErrors :issues="issues" field="renewalNoticeDaysBefore"
      /></label>
    </div>
    <label v-if="sheet.validityType === 'months'" class="field"
      >재인증 시작 · 만료 전 개월<input
        :value="sheet.renewalLeadMonths ?? 3"
        data-field="renewalLeadMonths"
        type="number"
        min="1"
        max="1200"
        @input="
          sheet.renewalLeadMonths = Number(($event.target as HTMLInputElement).value);
          emit('change');
        " /><CatalogFieldErrors :issues="issues" field="renewalLeadMonths"
    /></label>
    <p class="muted">
      운영 상태 {{ sheet.lifecycleStatus || 'Active' }} · 참고용. Hold·Revoke는 자격 관리에서 영향과
      사유를 확인하여 변경합니다.
    </p>
    <RenewalNoticeExample
      v-if="sheet.validityType === 'months'"
      :months="sheet.months"
      :lead="sheet.renewalLeadMonths"
      :days="sheet.renewalNoticeDaysBefore"
    />
  </fieldset>
</template>
