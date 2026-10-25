<script setup lang="ts">
import { randomUUID } from '../uuid';
import { confirmAction } from '../composables/useConfirmation';
import { ref, computed, watch, nextTick } from 'vue';
import { materialTypeLabels, type Course, type LearningMaterial } from '@eks/contracts';
import type { CourseIssue } from '../course-editor';
import AppIcon from './AppIcon.vue';
const props = defineProps<{ course: Course; disabled: boolean }>();
const editing = ref<LearningMaterial | null>(null),
  error = ref('');
watch(
  () => props.course.id,
  () => {
    editing.value = null;
    error.value = '';
  },
);
async function add() {
  if (
    editing.value &&
    !(await confirmAction('편집 중인 자료를 취소하고 새 자료를 추가할까요?', '새 자료 작성'))
  )
    return;
  editing.value = {
    id: randomUUID(),
    type: 'text',
    title: '',
    content: '',
    url: '',
    description: '',
  };
  error.value = '';
}
function save(requireComplete = false) {
  const m = editing.value;
  if (!m || props.disabled) return;
  if (requireComplete && (!m.title.trim() || (m.type === 'text' ? !m.content.trim() : !m.url))) {
    error.value = '자료명과 본문 또는 HTTP(S) URL을 입력해 주세요.';
    return;
  }
  if (m.type !== 'text' && m.url) {
    try {
      if (!['http:', 'https:'].includes(new URL(m.url).protocol)) throw new Error();
    } catch {
      error.value = 'HTTP(S) URL을 입력해 주세요.';
      return;
    }
  }
  if (m.type === 'text') m.url = '';
  else m.content = '';
  const i = props.course.materials.findIndex((v) => v.id === m.id);
  if (i < 0) props.course.materials.push({ ...m });
  else props.course.materials[i] = { ...m };
  editing.value = null;
  return true;
}
async function edit(m: LearningMaterial) {
  if (editing.value && !(await confirmAction('편집 중인 자료를 취소할까요?', '자료 편집 전환')))
    return;
  editing.value = { ...m };
  error.value = '';
}
function move(i: number, d: number) {
  const a = props.course.materials;
  if (i + d < 0 || i + d >= a.length || props.disabled) return;
  [a[i], a[i + d]] = [a[i + d]!, a[i]!];
}
async function remove(i: number) {
  if (!props.disabled && (await confirmAction('이 학습자료를 삭제할까요?', '학습자료 삭제')))
    props.course.materials.splice(i, 1);
}
async function focusIssue(issue: CourseIssue) {
  const m = props.course.materials.find((item) => item.id === issue.itemId);
  if (!m) return;
  editing.value = { ...m };
  error.value = issue.message;
  await nextTick();
  const input = document.querySelector<HTMLElement>(`[data-material-field="${issue.field}"]`);
  input?.focus({ preventScroll: true });
  input?.scrollIntoView({ block: 'center', behavior: 'instant' });
}
defineExpose({ pending: computed(() => !!editing.value), commit: save, focusIssue });
</script>
<template>
  <section class="panel editor-panel materials-editor">
    <div class="section-heading">
      <h2>
        학습자료 <span class="editor-count">{{ course.materials.length }}개</span>
      </h2>
      <button v-if="!disabled" type="button" class="button secondary" @click="add">
        자료 추가
      </button>
    </div>
    <p class="muted">
      학습 안내에 표시할 자료입니다. 열람 여부를 기록하거나 평가 조건으로 사용하지 않습니다.
    </p>
    <ol class="editor-materials-list">
      <li v-for="(m, i) in course.materials" :key="m.id" class="editor-material-row">
        <span class="editor-material-type"
          ><AppIcon :name="m.type === 'text' ? 'clipboard' : 'diagonal'" :size="16" />{{
            materialTypeLabels[m.type]
          }}</span
        >
        <div class="editor-material-info">
          <h3>{{ m.title || '이름 없는 자료' }}</h3>
          <span
            v-if="!m.title.trim() || (m.type === 'text' ? !m.content.trim() : !m.url)"
            class="editor-material-warning"
            ><AppIcon name="alert" :size="14" />신규 운영 전 보완</span
          >
          <p v-if="m.description">{{ m.description }}</p>
          <p v-if="m.type === 'text' && m.content" class="editor-material-excerpt">
            {{ m.content.slice(0, 160) }}{{ m.content.length > 160 ? '…' : '' }}
          </p>
          <p v-else-if="m.url" class="editor-material-url">{{ m.url }}</p>
        </div>
        <div
          v-if="!disabled"
          class="editor-material-actions"
          :aria-label="`${m.title || '이름 없는 자료'} 작업`"
          role="group"
        >
          <button type="button" class="text-link" @click="edit(m)">수정</button
          ><button
            type="button"
            class="text-link"
            :disabled="i === 0"
            @click="move(i, -1)"
            :aria-label="`${m.title} 위로`"
          >
            위로</button
          ><button
            type="button"
            class="text-link"
            :disabled="i === course.materials.length - 1"
            @click="move(i, 1)"
            :aria-label="`${m.title} 아래로`"
          >
            아래로</button
          ><button type="button" class="text-link" @click="remove(i)">삭제</button>
        </div>
      </li>
    </ol>
    <p v-if="!course.materials.length && !editing" class="editor-empty">
      등록된 학습자료가 없습니다. 자료 추가로 작성을 시작하세요.
    </p>
    <fieldset v-if="editing" class="editor-material-form" :disabled="disabled">
      <legend>
        {{ course.materials.some((m) => m.id === editing?.id) ? '자료 수정' : '새 자료' }}
      </legend>
      <div class="form-grid material-fields">
        <label class="field"
          ><span>유형</span
          ><select v-model="editing.type">
            <option v-for="(label, key) in materialTypeLabels" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        ><label class="field"
          ><span>자료명</span><input v-model="editing.title" data-material-field="title"
        /></label>
      </div>
      <label v-if="editing.type === 'text'" class="field"
        ><span>본문</span
        ><textarea rows="5" v-model="editing.content" data-material-field="content" /></label
      ><template v-else
        ><label class="field"
          ><span>URL</span
          ><input
            type="url"
            v-model="editing.url"
            placeholder="https://"
            data-material-field="url" /></label
        ><label class="field"
          ><span>설명 · 선택</span><textarea v-model="editing.description" rows="2" /></label
      ></template>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="button secondary" @click="editing = null">취소</button
        ><button type="button" class="button primary" @click="save(false)">
          {{ course.materials.some((m) => m.id === editing?.id) ? '변경 반영' : '목록에 추가' }}
        </button>
      </div>
      <p class="muted">
        인증Set 저장 시 서버에 반영됩니다. 미완성 자료도 보관하고 신규 운영 전에 보완할 수 있습니다.
      </p>
    </fieldset>
  </section>
</template>
