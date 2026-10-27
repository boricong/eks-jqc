<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { subjectiveIssues, type CourseContent } from '@eks/contracts';
import { randomUUID } from '../uuid';
import { confirmAction } from '../composables/useConfirmation';
import CompactTabs from './CompactTabs.vue';
const props = defineProps<{ course: CourseContent; disabled: boolean }>();
const selected = ref(''),
  uid = useId(),
  input = ref<HTMLTextAreaElement>();
const tabs = ref<InstanceType<typeof CompactTabs>>();
const options = computed(() =>
  props.course.subjectiveQuestions.map((q, i) => ({
    id: q.id,
    label: `${i + 1}. ${q.prompt.trim() || '새 문항'}`,
  })),
);
const current = computed(() =>
  props.course.subjectiveQuestions.find((q) => q.id === selected.value),
);
const index = computed(() =>
  props.course.subjectiveQuestions.findIndex((q) => q.id === selected.value),
);
const issues = computed(() => subjectiveIssues(props.course));
watch(
  options,
  () => {
    if (!current.value) selected.value = props.course.subjectiveQuestions[0]?.id || '';
  },
  { immediate: true },
);
async function add() {
  if (props.disabled || props.course.subjectiveQuestions.length >= 500) return;
  const q = { id: randomUUID(), prompt: '' };
  props.course.subjectiveQuestions.push(q);
  selected.value = q.id;
  await nextTick();
  input.value?.focus();
}
async function remove() {
  if (props.disabled || !current.value) return;
  if (current.value.prompt && !(await confirmAction('이 주관식 문항을 삭제할까요?', '문항 삭제')))
    return;
  props.course.subjectiveQuestions.splice(index.value, 1);
  await nextTick();
  input.value?.focus();
}
</script>
<template>
  <section class="assessment-editor subjective-editor panel" aria-label="주관식 문항 편집">
    <header>
      <h2>주관식 평가</h2>
    </header>
    <p v-if="issues.length" class="muted" role="status">
      {{ issues.join(' ') }} 기존 학습·평가·수료는 계속 사용할 수 있습니다.
    </p>
    <div class="section-heading">
      <span>{{ course.subjectiveQuestions.length }} / 500문항</span
      ><button
        class="button secondary"
        :disabled="disabled || course.subjectiveQuestions.length >= 500"
        @click="add"
      >
        주관식 문항 추가
      </button>
    </div>
    <div class="number-editor" :class="{ 'is-empty': !current }">
      <div v-if="options.length" class="question-navigation">
        <CompactTabs
          ref="tabs"
          v-model="selected"
          :items="options"
          label="주관식 문항"
          :panel-id="uid + '-question'"
          class="question-tabs"
          vertical
          numbered
        />
      </div>
      <div
        v-if="current"
        :id="uid + '-question'"
        role="tabpanel"
        :aria-labelledby="tabs?.tabId(current.id)"
        class="assessment-item-panel"
      >
        <textarea
          ref="input"
          v-model="current.prompt"
          :disabled="disabled"
          maxlength="20000"
          rows="8"
          aria-label="주관식 문제"
        />
        <div class="subjective-question-footer">
          <span class="muted">{{ current.prompt.length.toLocaleString() }} / 20,000자</span>
          <button class="text-link" :disabled="disabled" @click="remove">주관식 문항 삭제</button>
        </div>
      </div>
      <p v-else class="editor-empty">주관식 문항을 추가해 주세요.</p>
    </div>
  </section>
</template>
