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
function move(delta: number) {
  const list = props.course.subjectiveQuestions,
    i = index.value;
  if (props.disabled || i + delta < 0 || i + delta >= list.length) return;
  [list[i], list[i + delta]] = [list[i + delta]!, list[i]!];
}
</script>
<template>
  <section class="assessment-editor panel" aria-label="주관식 문항 편집">
    <header>
      <h2>주관식 평가</h2>
      <p class="muted">
        답변 수집 전용입니다. 합격 기준·배점 없이 저장하며 인증Set 수료에 영향을 주지 않습니다.
      </p>
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
    <CompactTabs
      v-if="options.length"
      v-model="selected"
      :items="options"
      label="주관식 문항"
      :panel-id="uid + '-question'"
      class="question-tabs"
    />
    <div v-if="current" :id="uid + '-question'">
      <label class="field"
        ><span>{{ index + 1 }}번 문제</span
        ><textarea
          ref="input"
          v-model="current.prompt"
          :disabled="disabled"
          maxlength="20000"
          rows="8"
          aria-label="주관식 문제"
        />
      </label>
      <p class="muted">{{ current.prompt.length.toLocaleString() }} / 20,000자</p>
      <div class="inline-actions">
        <button class="button secondary" :disabled="disabled || index === 0" @click="move(-1)">
          문항 위로</button
        ><button
          class="button secondary"
          :disabled="disabled || index === options.length - 1"
          @click="move(1)"
        >
          문항 아래로</button
        ><button class="button danger" :disabled="disabled" @click="remove">
          주관식 문항 삭제
        </button>
      </div>
    </div>
    <p v-else class="muted">주관식 문항을 추가해 주세요.</p>
  </section>
</template>
