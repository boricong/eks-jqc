<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { releaseVersionLabel, type CommonCourse } from '@eks/contracts';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import CoursePreviewDialog from './CoursePreviewDialog.vue';
const props = defineProps<{
  qualificationId: string;
  revision: number;
  disabled: boolean;
  search: string;
  additions?: { id: string; revision: number }[];
  selectionGroup?: 'selected' | 'unselected';
}>();
const emit = defineEmits<{ change: [value: { id: string; revision: number }[]] }>();
type Option = Pick<
  CommonCourse,
  keyof import('@eks/contracts').CourseContent | 'id' | 'revision' | 'releaseVersion'
> & { available: boolean };
const store = useDemo(),
  items = ref<Option[]>([]),
  loading = ref(false),
  error = ref('');
const preview = ref<Option | null>(null);
const visibleItems = computed(() =>
  items.value.filter((c) => {
    const selected = props.additions?.some((x) => x.id === c.id);
    return (
      (props.selectionGroup !== 'selected' || selected) &&
      (props.selectionGroup !== 'unselected' || !selected) &&
      (selected || c.title.toLocaleLowerCase().includes(props.search.trim().toLocaleLowerCase()))
    );
  }),
);
let sequence = 0;
async function load() {
  const seq = ++sequence;
  loading.value = true;
  error.value = '';
  items.value = [];
  preview.value = null;
  try {
    const result = await api<Option[]>(
      store.managementPath(`/qualifications/${props.qualificationId}/available-common-courses`),
    );
    if (seq === sequence) items.value = result;
  } catch (e) {
    if (seq === sequence) error.value = (e as Error).message;
  } finally {
    if (seq === sequence) loading.value = false;
  }
}
watch(() => [store.actorId, store.managementLv1, props.qualificationId, props.revision], load, {
  immediate: true,
});
async function toggle(c: Option, checked: boolean) {
  const next = (props.additions ?? []).filter((x) => x.id !== c.id);
  if (checked) next.push({ id: c.id, revision: c.revision });
  emit('change', next);
  await nextTick();
  [...document.querySelectorAll<HTMLInputElement>('[data-common-course-id]')]
    .find((el) => el.dataset.commonCourseId === c.id && el.getClientRects().length)
    ?.focus();
}
</script>
<template>
  <div v-if="!disabled" class="common-source-options">
    <p v-if="loading" class="muted" role="status">공통 원본을 불러오는 중입니다.</p>
    <p v-if="error" class="error-message" role="alert">
      {{ error }} <button type="button" class="text-link" @click="load">다시 불러오기</button>
    </p>
    <p v-if="visibleItems.length" class="muted">
      공통 원본 · 선택 후 저장하면 팀 사본으로 추가됩니다.
    </p>
    <div v-for="c in visibleItems" :key="c.id" class="qualification-course-row">
      <label class="qualification-course-choice"
        ><input
          type="checkbox"
          :data-common-course-id="c.id"
          :checked="additions?.some((x) => x.id === c.id) ?? false"
          :disabled="disabled || !c.available"
          @change="toggle(c, ($event.target as HTMLInputElement).checked)"
        /><span>{{ c.title || '이름 없음' }}</span></label
      >
      <div class="qualification-course-meta">
        <span class="muted">공통 원본 · {{ releaseVersionLabel(c) }}</span
        ><span v-if="!c.available" class="muted">원본 설정 보완 필요</span>
      </div>
      <div class="qualification-course-actions">
        <button
          type="button"
          class="button secondary"
          :aria-label="`${c.title} 공통 원본 내용 조회`"
          @click="preview = c"
        >
          내용 조회
        </button>
      </div>
    </div>
  </div>
  <CoursePreviewDialog
    :open="!!preview"
    :course="preview"
    @update:open="
      (open) => {
        if (!open) preview = null;
      }
    "
  />
</template>
