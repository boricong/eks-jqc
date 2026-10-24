<script setup lang="ts">
import { computed, useId } from 'vue';
import RenewalNoticeExample from './RenewalNoticeExample.vue';
import type { Qualification } from '@eks/contracts';
const props = defineProps<{ qualification: Qualification; disabled: boolean }>();
const id = useId();
const validityChoice = computed({
  get: () => {
    const policy = props.qualification.validity;
    return policy.type === 'months'
      ? policy.months === 36
        ? 'three-years'
        : 'months'
      : policy.type;
  },
  set: (choice: string) => {
    const policy = props.qualification.validity;
    if (choice === 'three-years') {
      policy.type = 'months';
      policy.months = 36;
    } else if (choice === 'months') {
      if (policy.type !== 'months' || policy.months === 36) policy.months = null;
      policy.type = 'months';
    } else {
      policy.type = choice as 'unknown' | 'unlimited';
      policy.months = null;
      policy.reminderDays = [];
    }
  },
});
</script>
<template>
  <div class="qualification-settings-grid">
    <label class="field"
      ><span>인증기간</span
      ><select
        aria-label="인증기간"
        v-model="validityChoice"
        :disabled="disabled"
        :aria-describedby="`${id}-validity-help`"
      >
        <option value="unknown">미정</option>
        <option value="three-years">취득 후 3년</option>
        <option value="months">기간 직접 입력</option>
        <option value="unlimited">무기한</option></select
      ><span :id="`${id}-validity-help`" class="qualification-field-help"
        >계획 완료 당시의 기간을 적용합니다. 완료된 계획과 기존 인증의 기간은 바뀌지 않습니다.</span
      ></label
    >
    <label v-if="validityChoice === 'months'" class="field"
      ><span>유효 개월 수</span
      ><input
        v-model.number="qualification.validity.months"
        :disabled="disabled"
        type="number"
        min="1"
        max="1200"
        placeholder="미정"
    /></label>
    <template v-if="qualification.validity.type === 'months'">
      <label class="field"
        ><span>재인증 시작 · 만료 전 개월</span
        ><input
          aria-label="재인증 시작 · 만료 전 개월"
          :value="qualification.renewalLeadMonths ?? 3"
          @input="
            qualification.renewalLeadMonths = Number(($event.target as HTMLInputElement).value)
          "
          :disabled="disabled"
          type="number"
          min="1"
          max="1200"
          :aria-describedby="`${id}-renewal-help`"
        /><span :id="`${id}-renewal-help`" class="qualification-field-help">
          기본 3개월 전부터 별도 종합평가로 갱신합니다. 이미 발급한 자격에는 당시 정책이 유지됩니다.
        </span></label
      >
      <label class="field"
        ><span>재인증 시작 N일 전 알림</span
        ><input
          aria-label="재인증 시작 N일 전 알림"
          :value="qualification.renewalNoticeDaysBefore ?? 7"
          :disabled="disabled"
          type="number"
          min="0"
          max="365"
          :aria-describedby="`${id}-notice-help`"
          @input="
            qualification.renewalNoticeDaysBefore = Number(
              ($event.target as HTMLInputElement).value,
            )
          "
        /><span :id="`${id}-notice-help`" class="qualification-field-help"
          >기본 7일 전, 유효기간마다 한 번 알립니다. 0은 재인증 시작일 당일입니다.</span
        ></label
      >
    </template>
  </div>
  <RenewalNoticeExample
    v-if="qualification.validity.type === 'months'"
    class="qualification-note"
    :months="qualification.validity.months"
    :lead="qualification.renewalLeadMonths"
    :days="qualification.renewalNoticeDaysBefore"
  />
</template>
