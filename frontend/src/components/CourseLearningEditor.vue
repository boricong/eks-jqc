<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
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
const tablist = ref<HTMLElement | null>(null);
const newId = () => crypto.randomUUID();
watch(activeId, async () => {
  await nextTick();
  const host = tablist.value,
    tab = host?.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!host || !tab) return;
  const offset = tab.offsetTop - host.offsetTop;
  if (offset < host.scrollTop) host.scrollTop = offset;
  else if (offset + tab.offsetHeight > host.scrollTop + host.clientHeight)
    host.scrollTop = offset + tab.offsetHeight - host.clientHeight;
});

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
function remove() {
  if (props.disabled || index.value < 0) return;
  if (item.value?.title.trim() && !window.confirm('이 학습 항목을 삭제할까요?')) return;
  const next =
    props.course.learningItems[index.value + 1] || props.course.learningItems[index.value - 1];
  props.course.learningItems.splice(index.value, 1);
  activeId.value = next?.id || '';
  nextTick(() => tablist.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
}
function onTabsKeydown(event: KeyboardEvent) {
  const key = event.key;
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
  event.preventDefault();
  event.stopPropagation();
  const ids = props.course.learningItems.map((value) => value.id);
  if (!ids.length) return;
  const position = ids.indexOf(activeId.value);
  activeId.value =
    ids[
      key === 'Home'
        ? 0
        : key === 'End'
          ? ids.length - 1
          : (position + (key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length
    ]!;
  nextTick(() => tablist.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
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
  <section class="panel editor-panel">
    <div class="section-heading">
      <h2>학습 항목</h2>
      <button v-if="!disabled" class="button secondary learning-add" type="button" @click="add">
        학습 항목 추가
      </button>
    </div>
    <p class="muted">
      학습자가 확인해야 할 학습 범위입니다. 별도의 완료 기록 없이 평가를 진행합니다.
    </p>
    <div class="number-editor">
      <div
        v-if="course.learningItems.length"
        class="learning-tabs number-tabs"
        aria-orientation="vertical"
        role="tablist"
        aria-label="학습 항목"
        ref="tablist"
        @keydown="onTabsKeydown"
      >
        <button
          v-for="(value, i) in course.learningItems"
          :key="value.id"
          type="button"
          role="tab"
          :id="`learning-tab-${value.id}`"
          :title="`${i + 1}. ${value.title.trim() || '새 학습 항목'}`"
          :aria-label="`${i + 1}번 ${value.title || '새 학습 항목'}${!value.title.trim() ? ' · 보완 필요' : ''}`"
          :aria-controls="activeId === value.id ? `learning-panel-${value.id}` : undefined"
          :aria-selected="activeId === value.id"
          :tabindex="activeId === value.id ? 0 : -1"
          :class="{ active: activeId === value.id, invalid: !value.title.trim() }"
          @click="activeId = value.id"
        >
          <span>{{ i + 1 }}</span>
        </button>
      </div>
      <div
        v-if="item"
        :id="`learning-panel-${item.id}`"
        role="tabpanel"
        :aria-labelledby="`learning-tab-${item.id}`"
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
        <div class="form-grid">
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
          <button v-if="!disabled" class="text-link" type="button" @click="remove">
            이 항목 삭제
          </button>
        </div>
      </div>
      <p v-else class="muted">등록된 학습 항목이 없습니다.</p>
    </div>
    <p v-if="!item && issues?.some((i) => i.kind === 'learning')" class="field-error">
      필수 학습 항목을 하나 이상 설정해 주세요.
    </p>
  </section>
</template>
