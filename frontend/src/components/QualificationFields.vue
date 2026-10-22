<script setup lang="ts">
import { computed } from 'vue';
import RenewalNoticeExample from './RenewalNoticeExample.vue';
import type { Qualification } from '@eks/contracts';
const props = defineProps<{ qualification: Qualification; disabled: boolean }>();
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
  <label class="field"
    ><span>영문명</span
    ><input v-model="qualification.englishName" :disabled="disabled" maxlength="300"
  /></label>
  <label class="field"
    ><span>자격 설명</span
    ><textarea
      v-model="qualification.description"
      :disabled="disabled"
      rows="3"
      placeholder="이 자격으로 수행할 직무와 취득 목적"
    />
  </label>
  <div class="form-grid">
    <label class="field"
      ><span>인증기간</span
      ><select aria-label="인증기간" v-model="validityChoice" :disabled="disabled">
        <option value="unknown">미정</option>
        <option value="three-years">취득 후 3년</option>
        <option value="months">기간 직접 입력</option>
        <option value="unlimited">무기한</option>
      </select></label
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
  </div>
  <template v-if="qualification.validity.type === 'months'">
    <label class="field"
      ><span>재인증 시작 · 만료 전 개월</span
      ><input
        :value="qualification.renewalLeadMonths ?? 3"
        @input="qualification.renewalLeadMonths = Number(($event.target as HTMLInputElement).value)"
        :disabled="disabled"
        type="number"
        min="1"
        max="1200"
    /></label>
    <p class="muted">
      기본 3개월 전부터 별도 종합평가로 갱신합니다. 이미 발급한 자격에는 당시 정책이 유지됩니다.
    </p>
    <label class="field"
      ><span>재인증 시작 N일 전 알림</span
      ><input
        :value="qualification.renewalNoticeDaysBefore ?? 7"
        :disabled="disabled"
        type="number"
        min="0"
        max="365"
        @input="
          qualification.renewalNoticeDaysBefore = Number(($event.target as HTMLInputElement).value)
        "
    /></label>
    <p class="muted">기본 7일 전, 유효기간마다 한 번 알립니다. 0은 재인증 시작일 당일입니다.</p>
    <RenewalNoticeExample
      :months="qualification.validity.months"
      :lead="qualification.renewalLeadMonths"
      :days="qualification.renewalNoticeDaysBefore"
    />
  </template>
  <p class="muted">발급 당시 자격 버전의 기간을 적용합니다. 기존 인증의 기간은 바뀌지 않습니다.</p>
</template>
