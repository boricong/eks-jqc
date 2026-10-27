<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import { releaseVersionLabel } from '@eks/contracts';
import CourseEditor from './CourseEditor.vue';
import AppDialog from './AppDialog.vue';
const store = useDemo(),
  items = ref<any[]>([]),
  selected = ref<any>(),
  busy = ref(false),
  error = ref('');
async function load() {
  const scope = store.managementLv1;
  if (!scope) return;
  try {
    const result = await api<any[]>(store.managementPath('/common-course-updates'));
    if (scope === store.managementLv1) {
      items.value = result;
      error.value = '';
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(
  () => [store.actorId, store.managementLv1],
  () => {
    items.value = [];
    selected.value = undefined;
    error.value = '';
  },
);
watch(
  () => [store.managementLv1, store.data.courses],
  () => {
    void load();
  },
  { immediate: true },
);
async function resolve(decision: 'apply' | 'keep') {
  if (!selected.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const v = selected.value;
    await store.command(store.managementPath(`/common-course-updates/${v.id}/resolve`), {
      decision,
      courseId: v.course.id,
      revision: v.course.revision,
      sourceReleaseId: v.source.id,
    });
    selected.value = undefined;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <p v-if="error && !selected" role="alert">
    {{ error }} <button class="text-link" @click="load">다시 확인</button>
  </p>
  <section v-if="items.length" class="panel" aria-label="공통 원본 반영 보류">
    <h2>공통 원본 반영 보류</h2>
    <p class="muted">
      팀 수정 내용을 유지하고 있습니다. 기존 연결 기준으로 계획을 계속 진행할 수 있습니다.
    </p>
    <p v-for="item in items" :key="item.id">
      <button class="text-link" @click="selected = item">
        {{ item.course?.title }} · {{ releaseVersionLabel(item.source) }} 원본 비교
      </button>
    </p>
  </section>
  <AppDialog
    :open="!!selected"
    title="공통 원본과 팀 내용 비교"
    @update:open="
      (v) => {
        if (!v && !busy) selected = undefined;
      }
    "
  >
    <template v-if="selected">
      <h3>현재 팀 내용 · {{ releaseVersionLabel(selected.course) }}</h3>
      <CourseEditor :course="selected.course" :issues="[]" :show-errors="false" disabled />
      <h3>변경된 공통 원본 · {{ releaseVersionLabel(selected.source) }}</h3>
      <CourseEditor :course="selected.source" :issues="[]" :show-errors="false" disabled />
      <p>
        원본 반영 시 팀 수정 내용을 대신하는 새 버전과 연결 자격의 새 마이너 버전을 생성합니다. 과거
        버전은 유지합니다.
      </p>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="resolve('keep')">
        팀 내용 유지</button
      ><button class="button primary" :disabled="busy" @click="resolve('apply')">
        원본 반영
      </button></template
    >
  </AppDialog>
</template>
