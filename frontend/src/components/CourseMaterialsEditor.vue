<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { materialTypeLabels, type Course, type LearningMaterial } from '@eks/contracts';
import type { CourseIssue } from '../course-editor';
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
function add() {
  if (editing.value && !window.confirm('편집 중인 자료를 취소하고 새 자료를 추가할까요?')) return;
  editing.value = {
    id: crypto.randomUUID(),
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
function edit(m: LearningMaterial) {
  if (editing.value && !window.confirm('편집 중인 자료를 취소할까요?')) return;
  editing.value = { ...m };
  error.value = '';
}
function move(i: number, d: number) {
  const a = props.course.materials;
  if (i + d < 0 || i + d >= a.length || props.disabled) return;
  [a[i], a[i + d]] = [a[i + d]!, a[i]!];
}
function remove(i: number) {
  if (!props.disabled && window.confirm('이 학습자료를 삭제할까요?'))
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
  <section class="panel editor-panel">
    <div class="section-heading">
      <h2>학습자료</h2>
      <button v-if="!disabled" type="button" class="button secondary" @click="add">
        자료 추가
      </button>
    </div>
    <p class="muted">
      학습 안내에 표시할 자료입니다. 열람 여부를 기록하거나 평가 조건으로 사용하지 않습니다.
    </p>
    <ol class="materials-list">
      <li v-for="(m, i) in course.materials" :key="m.id" class="material-card">
        <span class="small-label">{{ materialTypeLabels[m.type] }}</span
        ><strong>{{ m.title || '이름 없는 자료' }}</strong>
        <span
          v-if="!m.title.trim() || (m.type === 'text' ? !m.content.trim() : !m.url)"
          class="small-label"
          >사용 등록 전 보완</span
        >
        <p>{{ m.description || (m.type === 'text' ? m.content.slice(0, 100) : m.url) }}</p>
        <div v-if="!disabled" class="actions">
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
    <p v-if="!course.materials.length && !editing" class="muted">자료를 추가할 수 있습니다.</p>
    <fieldset v-if="editing" class="material-card" :disabled="disabled">
      <legend>
        {{ course.materials.some((m) => m.id === editing?.id) ? '자료 수정' : '새 자료' }}
      </legend>
      <div class="form-grid">
        <label class="field"
          >유형<select v-model="editing.type">
            <option v-for="(label, key) in materialTypeLabels" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        ><label class="field"
          >자료명<input v-model="editing.title" data-material-field="title"
        /></label>
      </div>
      <label v-if="editing.type === 'text'" class="field"
        >본문<textarea rows="5" v-model="editing.content" data-material-field="content" /></label
      ><template v-else
        ><label class="field"
          >URL<input
            type="url"
            v-model="editing.url"
            placeholder="https://"
            data-material-field="url" /></label
        ><label class="field">설명 · 선택<textarea v-model="editing.description" rows="2" /></label
      ></template>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="button secondary" @click="editing = null">취소</button
        ><button type="button" class="button primary" @click="save(false)">
          {{ course.materials.some((m) => m.id === editing?.id) ? '변경 반영' : '목록에 추가' }}
        </button>
      </div>
      <p class="muted">
        인증Set 초안 저장 시 서버에 반영됩니다. 미완성 자료는 초안에 보관하고 사용 등록 전에 보완할
        수 있습니다.
      </p>
    </fieldset>
  </section>
</template>
