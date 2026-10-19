<script setup lang="ts">
import { computed } from 'vue';
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
    <div class="form-grid">
      <label class="field"
        >자격명<input v-model="sheet.title" data-field="title" /><CatalogFieldErrors
          :issues="issues"
          field="title" /></label
      ><label class="field"
        >영문명<input v-model="sheet.englishName" data-field="englishName" /><CatalogFieldErrors
          :issues="issues"
          field="englishName"
      /></label>
    </div>
    <label class="field"
      >자격 설명<textarea
        v-model="sheet.description"
        data-field="description"
        rows="3"
      /><CatalogFieldErrors :issues="issues" field="description" />
    </label>
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
        >만료 전 알림 일수<input
          :value="sheet.reminderDays.join(', ')"
          data-field="reminderDays"
          placeholder="예: 90, 30, 7"
          @change="
            sheet.reminderDays = ($event.target as HTMLInputElement).value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map(Number)
          "
      /></label>
    </div>
    <button
      v-if="sheet.validityType === 'months'"
      class="text-link"
      @click="
        sheet.reminderDays = [90, 30, 7];
        emit('change');
      "
    >
      90·30·7일 전 선택
    </button>
  </fieldset>
</template>
