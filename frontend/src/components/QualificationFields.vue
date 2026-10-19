<script setup lang="ts">
import { computed } from 'vue';
import type { Qualification } from '@eks/contracts';
const props = defineProps<{ qualification: Qualification; disabled: boolean }>();
const validityChoice = computed({
  get: () => {
    const policy = props.qualification.validity;
    return policy.type === 'months' ? (policy.months === 36 ? 'three-years' : 'months') : policy.type;
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
function reminders(event: Event) {
  const values = (event.target as HTMLInputElement).value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  props.qualification.validity.reminderDays = values.map(Number);
}
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
      ><select
        aria-label="인증기간"
        v-model="validityChoice"
        :disabled="disabled"
      >
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
      ><span>만료 전 알림 일수</span
      ><input
        :value="qualification.validity.reminderDays.join(', ')"
        :disabled="disabled"
        placeholder="예: 90, 30, 7"
        @change="reminders"
    /></label>
    <button
      v-if="!disabled"
      class="text-link"
      type="button"
      @click="qualification.validity.reminderDays = [90, 30, 7]"
    >
      90·30·7일 전 선택
    </button>
  </template>
  <p class="muted">발급 당시 자격 버전의 기간을 적용합니다. 기존 인증의 기간은 바뀌지 않습니다.</p>
</template>
