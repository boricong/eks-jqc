<script setup lang="ts">
import { computed, ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import type { Course, CourseUsage } from '@eks/contracts';
import AppDialog from './AppDialog.vue';
const props = defineProps<{ course: Course; disabled?: boolean }>();
const emit = defineEmits<{ changed: []; deleted: [] }>();
const store = useDemo();
const open = ref(false),
  busy = ref(false),
  usage = ref<CourseUsage | null>(null),
  error = ref(''),
  reason = ref('');
const action = computed(() =>
  props.course.status === 'draft'
    ? 'delete'
    : props.course.operationalStatus === 'retired'
      ? 'reactivation'
      : 'retirement',
);
const label = computed(() =>
  action.value === 'delete'
    ? '초안 삭제'
    : action.value === 'retirement'
      ? '운영 종료'
      : '운영 재개',
);
async function load() {
  busy.value = true;
  error.value = '';
  usage.value = null;
  const actor = store.actorId,
    scope = store.managementLv1,
    id = props.course.id;
  try {
    const result = await api<CourseUsage>(store.managementPath(`/courses/${id}/usage`));
    if (actor === store.actorId && scope === store.managementLv1 && id === props.course.id)
      usage.value = result;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
async function review() {
  open.value = true;
  reason.value = '';
  await load();
}
async function perform() {
  if (!usage.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const deleting = action.value === 'delete';
    const completedLabel = label.value;
    await store.command(
      `/courses/${props.course.id}${deleting ? '' : `/${action.value}`}`,
      {
        courseRevision: usage.value.courseRevision,
        stateRevision: usage.value.stateRevision,
        reason: reason.value,
      },
      deleting ? 'DELETE' : 'POST',
    );
    open.value = false;
    store.notify(`${completedLabel}했습니다.`);
    if (deleting) emit('deleted');
    else emit('changed');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
const canLeave = () =>
  !store.managementAccess ||
  (!store.writing &&
    (!open.value ||
      !reason.value ||
      window.confirm('작성 중인 처리 사유가 있습니다. 변경을 취소하고 나갈까요?')));
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
</script>
<template>
  <section class="course-lifecycle">
    <div class="actions">
      <button
        class="button secondary"
        :disabled="disabled || busy || !!store.writing"
        @click="review"
      >
        {{ label }}
      </button>
      <p v-if="course.operationalStatus === 'retired'" class="muted">
        운영 종료 · {{ course.retirementReason }}
      </p>
    </div>
    <AppDialog
      :open="open"
      :title="`${label} 확인`"
      @update:open="
        (v) => {
          if (!busy) open = v;
        }
      "
    >
      <p>{{ store.managementOrganization?.name }}</p>
      <h3>{{ course.title || '이름 없는 인증Set' }} · v{{ course.version }}</h3>
      <p v-if="action === 'retirement'">
        신규 배정은 중단되며 기존 배정과 취득한 인증은 유지됩니다.
      </p>
      <p v-else-if="action === 'reactivation'">
        같은 내용과 버전으로 신규 배정을 다시 허용합니다. 기존 결과는 유지됩니다.
      </p>
      <p v-else>업무 참조가 없는 초안을 삭제합니다. 삭제 이력과 사전 백업은 보존됩니다.</p>
      <p v-if="busy && !usage" role="status">영향을 확인하는 중입니다.</p>
      <template v-if="usage">
        <p>
          배정 {{ usage.counts.assignments }}건 · 수료 {{ usage.counts.completions }}건 · 인증
          {{ usage.counts.certifications }}건
        </p>
        <p>
          평가 {{ usage.counts.attempts }}건 · 비교 {{ usage.counts.comparisons }}건 · 후속 버전
          {{ usage.successorVersions.length }}개
        </p>
        <p>연결된 자격 {{ usage.qualifications.length }}개</p>
        <ul v-if="usage.qualifications.length">
          <li v-for="q in usage.qualifications" :key="q.id">
            <RouterLink :to="store.managementLink(`/admin/qualifications/${q.id}`)"
              >{{ q.title || '이름 없는 자격' }} v{{ q.version }} ·
              {{ q.status === 'draft' ? '초안' : '사용 중' }}</RouterLink
            >
          </li>
        </ul>
        <p v-if="action === 'delete' && !usage.canDelete" class="error-message">
          {{ usage.blockers.join(' · ') }}
        </p>
        <label v-if="action !== 'delete' || usage.canDelete" class="field"
          ><span>처리 사유</span
          ><textarea v-model="reason" maxlength="2000" :disabled="busy" rows="3" />
        </label>
      </template>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <button v-if="error" class="text-link" :disabled="busy" @click="load">영향 다시 조회</button>
      <template #footer>
        <button class="button secondary" :disabled="busy" @click="open = false">취소</button>
        <button
          class="button primary"
          :disabled="busy || !usage || !reason.trim() || (action === 'delete' && !usage.canDelete)"
          @click="perform"
        >
          {{ label }} 실행
        </button>
      </template>
    </AppDialog>
  </section>
</template>
