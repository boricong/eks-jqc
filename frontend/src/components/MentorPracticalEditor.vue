<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { MentorPracticalConfig } from '@eks/contracts';
import { randomUUID } from '../uuid';
import { confirmAction } from '../composables/useConfirmation';
const props = defineProps<{ config: MentorPracticalConfig; disabled: boolean }>();
const root = ref<HTMLElement>();
const total = computed(() =>
  props.config.questions.reduce((n, q) => n + (Number(q.points) || 0), 0),
);
async function add() {
  props.config.questions.push({ id: randomUUID(), prompt: '', points: 10 });
  await nextTick();
  root.value
    ?.querySelectorAll<HTMLTextAreaElement>('textarea')
    .item(props.config.questions.length - 1)
    ?.focus();
}
async function remove(index: number) {
  if (await confirmAction('이 실기 문항과 배점을 삭제할까요?', '실기 문항 삭제'))
    props.config.questions.splice(index, 1);
}
</script>
<template>
  <section ref="root" class="mentor-editor" aria-label="실기(주관식) 문항 편집">
    <header>
      <h2>실기(주관식) · FT 멘토 평가</h2>
      <p class="muted">
        수강별로 지정한 FT 멘토가 문항별 점수를 매깁니다. 실기와 다른 필수 평가를 모두 통과해야
        수료됩니다.
      </p>
    </header>
    <label class="field"
      >실기 합격 기준 (%)<input
        v-model.number="config.passScore"
        type="number"
        min="1"
        max="100"
        step="1"
        :disabled="disabled"
        data-course-field="mentorPassScore"
    /></label>
    <p>
      {{ config.questions.length }} / 100문항 · 총 배점 {{ total }}점<span v-if="config.passScore">
        · {{ config.passScore }}% 이상 합격</span
      >
    </p>
    <fieldset v-for="(q, i) in config.questions" :key="q.id" :disabled="disabled">
      <legend>실기 문항 {{ i + 1 }}</legend>
      <label class="field"
        >실기 수행 지시·문항<textarea
          v-model="q.prompt"
          rows="4"
          maxlength="20000"
          data-course-field="mentorPrompt"
        />
      </label>
      <label class="field"
        >문항 배점<input
          v-model.number="q.points"
          type="number"
          min="1"
          max="1000"
          step="1"
          data-course-field="mentorPoints"
      /></label>
      <button class="button secondary" type="button" @click="remove(i)">
        실기 문항 {{ i + 1 }} 삭제
      </button>
    </fieldset>
    <button
      class="button secondary"
      type="button"
      :disabled="disabled || config.questions.length >= 100"
      data-course-field="mentorAdd"
      @click="add"
    >
      실기 문항 추가
    </button>
  </section>
</template>
<style scoped>
.mentor-editor {
  display: grid;
  gap: 20px;
}
fieldset {
  display: grid;
  gap: 16px;
  border: 1px solid var(--control-border);
  border-radius: 8px;
  padding: 20px;
  min-width: 0;
}
input[type='number'] {
  max-width: 200px;
}
</style>
