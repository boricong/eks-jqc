<script setup lang="ts">
import { confirmAction } from '../composables/useConfirmation';
import { computed, nextTick, ref, useId, watch } from 'vue';
import CompactTabs from './CompactTabs.vue';
import type { CourseIssue } from '../course-editor';
import { learningTypeLabels, type Course } from '@eks/contracts';

const props = defineProps<{ course: Course; disabled: boolean; issues?: CourseIssue[] }>();
const activeId = ref('');
const item = computed(() =>
  props.course.learningItems.find((value) => value.id === activeId.value),
);
const index = computed(() =>
  props.course.learningItems.findIndex((value) => value.id === activeId.value),
);
const uid = useId();
const tabs = ref<InstanceType<typeof CompactTabs>>();
const root = ref<HTMLElement>();
const options = computed(() =>
  props.course.learningItems.map((value, index) => ({
    id: value.id,
    label: `${index + 1}번 ${value.title.trim() || '새 학습 항목'}`,
    invalid: !value.title.trim(),
  })),
);
const newId = () => crypto.randomUUID();

watch(
  () => [props.course.id, ...props.course.learningItems.map((value) => value.id)],
  () => {
    if (!props.course.learningItems.some((value) => value.id === activeId.value))
      activeId.value = props.course.learningItems[0]?.id || '';
  },
  { immediate: true },
);

function add() {
  const id = newId();
  props.course.learningItems.push({ id, type: 'mtc', title: '', required: true });
  activeId.value = id;
  nextTick(() => document.getElementById(`learning-title-${id}`)?.focus());
}
async function remove() {
  if (props.disabled || index.value < 0) return;
  if (
    item.value?.title.trim() &&
    !(await confirmAction('이 학습 항목을 삭제할까요?', '학습 항목 삭제'))
  )
    return;
  const next =
    props.course.learningItems[index.value + 1] || props.course.learningItems[index.value - 1];
  props.course.learningItems.splice(index.value, 1);
  activeId.value = next?.id || '';
  nextTick(() =>
    (
      root.value?.querySelector<HTMLElement>('[aria-selected="true"]') ||
      root.value?.querySelector<HTMLElement>('.learning-add')
    )?.focus(),
  );
}
function focusInvalid() {
  const invalid = props.course.learningItems.find((value) => !value.title.trim());
  if (!invalid) return false;
  activeId.value = invalid.id;
  nextTick(() => document.getElementById(`learning-title-${invalid.id}`)?.focus());
  return true;
}
async function focusIssue(issue: CourseIssue) {
  if (issue.itemId) activeId.value = issue.itemId;
  await nextTick();
  const el =
    issue.field === 'title'
      ? document.getElementById(`learning-title-${activeId.value}`)
      : document.querySelector<HTMLElement>('.learning-tab-actions input, .learning-add');
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: 'center', behavior: 'instant' });
}
defineExpose({ focusInvalid, focusIssue });
</script>
<template>
  <section ref="root" class="panel editor-panel learning-editor">
    <div class="section-heading">
      <h2>
        학습 항목 <span class="editor-count">{{ course.learningItems.length }}개</span>
      </h2>
      <button v-if="!disabled" class="button secondary learning-add" type="button" @click="add">
        학습 항목 추가
      </button>
    </div>
    <p class="muted">
      학습자가 확인해야 할 학습 범위입니다. 별도의 완료 기록 없이 평가를 진행합니다.
    </p>
    <div class="number-editor" :class="{ 'is-empty': !item }">
      <div v-if="course.learningItems.length" class="question-navigation">
        <CompactTabs
          ref="tabs"
          v-model="activeId"
          :items="options"
          label="학습 항목"
          :panel-id="`${uid}-item-panel`"
          vertical
          numbered
        />
      </div>
      <div
        v-if="item"
        :id="`${uid}-item-panel`"
        role="tabpanel"
        :aria-labelledby="tabs?.tabId(item.id)"
        class="learning-tab-panel"
      >
        <p
          v-for="issue in issues?.filter(
            (i) => i.kind === 'learning' && (!i.itemId || i.itemId === item?.id),
          )"
          :key="issue.field"
          class="field-error"
        >
          {{ issue.message }}
        </p>
        <div class="question-toolbar">
          <h3>학습 항목 {{ index + 1 }}번</h3>
          <button v-if="!disabled" class="text-link" type="button" @click="remove">
            이 항목 삭제
          </button>
        </div>
        <div class="form-grid learning-fields">
          <label class="field"
            ><span>교육 종류</span>
            <select aria-label="교육 종류" v-model="item.type" :disabled="disabled">
              <option v-for="(label, type) in learningTypeLabels" :key="type" :value="type">
                {{ label }}
              </option>
            </select>
          </label>
          <label class="field"
            ><span>학습 항목명</span>
            <input
              :id="`learning-title-${item.id}`"
              v-model="item.title"
              :disabled="disabled"
              :aria-invalid="!item.title.trim()"
            />
          </label>
        </div>
        <div class="learning-tab-actions">
          <label class="checkbox-label"
            ><input v-model="item.required" :disabled="disabled" type="checkbox" />필수 학습
            항목</label
          >
        </div>
      </div>
      <p v-else class="editor-empty">등록된 학습 항목이 없습니다.</p>
    </div>
    <p v-if="!item && issues?.some((i) => i.kind === 'learning')" class="field-error">
      필수 학습 항목을 하나 이상 설정해 주세요.
    </p>
  </section>
</template>
