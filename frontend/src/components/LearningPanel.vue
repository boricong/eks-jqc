<script setup lang="ts">
import { computed, ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { learningTypeLabels, kstDate, type Course, type Enrollment } from '@eks/contracts';
import { useDemo } from '../stores/demo';
const props = defineProps<{ course: Course; enrollment: Enrollment; disabled: boolean }>();
const store = useDemo(),
  busy = ref(false),
  error = ref(''),
  selected = ref('');
const form = ref({ performedOn: '', content: '', evidenceUrl: '', reason: '' });
const current = computed(() =>
  props.enrollment.learningRecords.find((r) => r.itemId === selected.value),
);
let revision = 0;
function edit(id: string) {
  selected.value = id;
  const record = current.value;
  revision = record?.revision || 0;
  form.value = {
    performedOn: record?.performedOn || kstDate(),
    content: record?.content || '',
    evidenceUrl: record?.evidenceUrl || '',
    reason: '',
  };
  error.value = '';
}
async function save() {
  busy.value = true;
  error.value = '';
  try {
    await store.command(
      `/enrollments/${props.enrollment.id}/learning`,
      { ...form.value, itemId: selected.value, revision },
      'PUT',
    );
    selected.value = '';
    store.notify('학습자 완료 기록을 저장했습니다.');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
function leave() {
  return (
    !busy.value && (!selected.value || window.confirm('작성 중인 학습 기록을 버리고 이동할까요?'))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <section class="panel editor-panel learning-panel">
    <div class="section-heading">
      <h2>학습 완료 기록</h2>
      <span class="small-label">학습자 기록</span>
    </div>
    <p v-if="!course.learningItems.length" class="muted">
      별도 완료 기록이 필요한 학습 항목이 없습니다.
    </p>
    <div v-for="item in course.learningItems" :key="item.id" class="learning-item">
      <div>
        <strong>{{ item.title }}</strong>
        <p class="muted">
          {{ learningTypeLabels[item.type] }} · {{ item.required ? '필수' : '선택' }}
        </p>
      </div>
      <span>{{
        enrollment.learningRecords.some((r) => r.itemId === item.id) ? '기록 완료' : '미완료'
      }}</span
      ><button class="button secondary" :disabled="busy || disabled" @click="edit(item.id)">
        {{
          enrollment.learningRecords.some((r) => r.itemId === item.id)
            ? '기록 확인·수정'
            : '학습 완료 기록'
        }}
      </button>
    </div>
    <form v-if="selected" class="learning-form" @submit.prevent="save">
      <h3>{{ course.learningItems.find((i) => i.id === selected)?.title }}</h3>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <label class="field"
        ><span>실시일</span
        ><input v-model="form.performedOn" type="date" :max="kstDate()" :disabled="busy" required
      /></label>
      <label class="field"
        ><span>완료 내용</span
        ><textarea v-model="form.content" rows="3" :disabled="busy" required />
      </label>
      <label class="field"
        ><span>근거 URL · 선택</span
        ><input v-model="form.evidenceUrl" type="url" :disabled="busy" placeholder="https://"
      /></label>
      <label v-if="current" class="field"
        ><span>수정 사유</span><input v-model="form.reason" :disabled="busy" required
      /></label>
      <p class="muted">학습자가 기록한 내용입니다. 과정 수료에는 필수 평가 통과가 필요합니다.</p>
      <div class="actions">
        <button type="button" class="button secondary" :disabled="busy" @click="selected = ''">
          취소</button
        ><button class="button primary" :disabled="busy">학습 기록 저장</button>
      </div>
    </form>
  </section>
</template>
