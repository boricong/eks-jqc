<script setup lang="ts">
import type { GroupPracticalConfig } from '@eks/contracts';
import { randomUUID } from '../uuid';
defineProps<{ config: GroupPracticalConfig; disabled: boolean }>();
</script>
<template>
  <section class="group-criteria">
    <header>
      <h2>그룹 실기 기준</h2>
      <p class="muted">
        같은 팀 3~4명이 각각 3회 수행합니다. 외부 분석 결과를 평가자가 확인하고 전원을 함께
        판정합니다.
      </p>
    </header>
    <label class="field"
      >수행 지침<textarea
        v-model="config.instruction"
        data-course-field="instruction"
        :disabled="disabled"
        maxlength="20000"
        rows="5"
      />
    </label>
    <label class="field"
      >분석 방법<input
        v-model="config.method"
        :disabled="disabled"
        maxlength="300"
        placeholder="예: 측정 시스템 분석"
    /></label>
    <label class="field"
      >공동 판정 기준<textarea
        v-model="config.criterion"
        :disabled="disabled"
        maxlength="20000"
        rows="4"
      />
    </label>
    <h3>필수 결과 항목</h3>
    <fieldset v-for="(metric, index) in config.metrics" :key="metric.id" :disabled="disabled">
      <legend>결과 항목 {{ index + 1 }}</legend>
      <label class="field">항목명<input v-model="metric.label" maxlength="200" /></label>
      <label class="field"
        >값 유형<select v-model="metric.type">
          <option value="number">숫자</option>
          <option value="text">문자</option>
        </select></label
      >
      <label class="field">단위<input v-model="metric.unit" maxlength="80" /></label>
      <button class="button secondary" type="button" @click="config.metrics.splice(index, 1)">
        항목 삭제
      </button>
    </fieldset>
    <button
      class="button secondary"
      type="button"
      :disabled="disabled || config.metrics.length >= 30"
      @click="config.metrics.push({ id: randomUUID(), label: '', type: 'number', unit: '' })"
    >
      결과 항목 추가
    </button>
    <p class="muted">
      이 기준은 인증Set 버전에 고정됩니다. 시스템은 통계값을 계산하거나 자동으로 합격을 판정하지
      않습니다.
    </p>
  </section>
</template>
<style scoped>
.group-criteria {
  display: grid;
  gap: 20px;
}
fieldset {
  border: 1px solid var(--control-border);
  border-radius: 8px;
  padding: 16px;
  display: grid;
  gap: 12px;
}
</style>
