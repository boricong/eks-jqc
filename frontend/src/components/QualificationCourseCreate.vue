<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CourseContentSchema, type CourseContent, type Qualification } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import { ApiError } from '../api';
import { confirmAction } from '../composables/useConfirmation';
import { courseIssues } from '../course-editor';
import AppDialog from './AppDialog.vue';
import CourseEditor from './CourseEditor.vue';
const props = defineProps<{ open: boolean; qualification: Qualification }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; created: [id: string] }>();
const store = useDemo(),
  content = ref<CourseContent>(),
  editor = ref<InstanceType<typeof CourseEditor>>();
const busy = ref(false),
  error = ref(''),
  pending = ref<{ content: CourseContent }>(),
  baseline = ref('');
let generation = 0;
const dirty = computed(
  () => props.open && (!!pending.value || JSON.stringify(content.value) !== baseline.value),
);
watch(
  () => [props.open, props.qualification.id, store.actorId, store.managementLv1],
  () => {
    generation++;
    busy.value = false;
    error.value = '';
    pending.value = undefined;
    content.value = CourseContentSchema.parse({
      title: '',
      qualificationType: props.qualification.qualificationType,
      assessmentKinds: props.qualification.qualificationType === 'auditor' ? [] : ['objective'],
      passScore: null,
      practicalPassScore: null,
      questions: [],
      practicalQuestions: [],
      materials: [],
    });
    baseline.value = JSON.stringify(content.value);
  },
  { immediate: true },
);
async function close() {
  if (busy.value || pending.value) {
    store.notify('인증Set 저장 결과를 확인한 뒤 닫아 주세요.');
    return;
  }
  if (
    dirty.value &&
    !(await confirmAction('작성 중인 인증Set을 버리고 닫을까요?', '변경 버리고 닫기'))
  )
    return;
  emit('update:open', false);
}
async function save() {
  if (busy.value || !content.value || (!pending.value && !editor.value?.commit())) return;
  if (!pending.value) {
    if (!content.value.title.trim()) {
      error.value = '인증Set명을 입력해 주세요.';
      return;
    }
    pending.value = { content: CourseContentSchema.parse(content.value) };
  }
  const seq = generation;
  busy.value = true;
  error.value = '';
  try {
    const result = await store.createCatalog('courses', pending.value);
    if (seq !== generation) return;
    pending.value = undefined;
    baseline.value = JSON.stringify(content.value);
    emit('created', result.id);
    emit('update:open', false);
    store.notify('인증Set을 저장하고 자격 변경안에 추가했습니다.');
  } catch (e) {
    if (seq === generation) {
      error.value = (e as Error).message;
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.value = undefined;
    }
  } finally {
    if (seq === generation) busy.value = false;
  }
}
defineExpose({ dirty, pending });
</script>
<template>
  <AppDialog
    :open="open"
    title="새 특화인증Set 등록"
    class="qualification-course-create"
    @update:open="
      (open) => {
        if (!open) void close();
      }
    "
  >
    <template v-if="open && content">
      <p class="muted">
        인증Set 저장 후 자격의 변경안에 추가됩니다. 자격 저장 시 적용되며, 변경을 취소해도 인증Set은
        팀 목록에 남습니다.
      </p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <CourseEditor
        ref="editor"
        :course="content"
        :disabled="busy || !!pending"
        :issues="courseIssues(content)"
        :show-errors="!!error"
        :objective-only="qualification.purpose === 'renewal'"
      />
    </template>
    <template #footer
      ><button class="button secondary" :disabled="busy || !!pending" @click="close">취소</button
      ><button
        class="button primary"
        :disabled="busy || (!pending && !content?.title.trim())"
        @click="save"
      >
        {{ pending ? '저장 결과 확인·재시도' : '인증Set 저장 후 추가' }}
      </button></template
    >
  </AppDialog>
</template>
<style scoped>
.qualification-course-create {
  width: calc(100% - 32px);
  max-width: 1120px;
  max-height: calc(100dvh - 32px);
}
.qualification-course-create[open] {
  display: flex;
  flex-direction: column;
}
.qualification-course-create :deep(.dialog-head),
.qualification-course-create :deep(.dialog-footer) {
  flex-shrink: 0;
}
.qualification-course-create :deep(.dialog-body) {
  min-height: 0;
  overflow-y: auto;
}
</style>
