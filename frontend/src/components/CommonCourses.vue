<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import {
  CourseContentSchema,
  courseUseErrors,
  qualificationTypeLabels,
  type CommonCourse,
  type CourseContent,
  type AuditEvent,
} from '@eks/contracts';
import { api, mutate, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
import { courseIssues } from '../course-editor';
import CourseEditor from './CourseEditor.vue';
import AppDialog from './AppDialog.vue';
import '../course-editor.css';
type Item = CommonCourse & {
  readiness: string[];
  templateCount: number;
  copyCount: number;
  canChangeType: boolean;
  typeChangeReason: string;
};
const store = useDemo(),
  items = ref<Item[]>([]),
  audits = ref<AuditEvent[]>([]),
  query = ref(''),
  type = ref('all'),
  status = ref('active'),
  busy = ref(false),
  loading = ref(false),
  error = ref('');
const draft = ref<CourseContent & { id?: string; revision?: number }>(),
  baseline = ref(''),
  editor = ref<InstanceType<typeof CourseEditor>>();
const heading = ref<HTMLElement>(),
  comparison = ref<Item>(),
  conflict = ref(false);
const lifecycle = ref<Item>(),
  reason = ref('');
const current = computed(() => items.value.find((c) => c.id === draft.value?.id));
const dirty = computed(
  () => !!draft.value && (JSON.stringify(draft.value) !== baseline.value || editor.value?.pending),
);
const issues = computed(() => (draft.value ? courseIssues(draft.value) : []));
const listed = computed(() =>
  items.value.filter(
    (c) =>
      (type.value === 'all' || c.qualificationType === type.value) &&
      (status.value === 'all' || c.operationalStatus === status.value) &&
      c.title.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()),
  ),
);
const history = computed(() =>
  audits.value
    .filter((a) => a.targetId === draft.value?.id)
    .slice()
    .reverse()
    .slice(0, 20),
);
watch(
  () => draft.value?.qualificationType,
  async (value, previous) => {
    if (value !== 'auditor' || !draft.value) return;
    const target = draft.value;
    if (
      target.questions.length ||
      target.practicalQuestions.length ||
      target.subjectiveQuestions.length ||
      target.subjectiveEnabled
    ) {
      if (
        !(await confirmAction(
          'Auditor는 평가를 사용하지 않습니다. 작성한 평가 문항을 제외하고 Auditor로 변경할까요?',
          '평가 제외 후 변경',
        ))
      ) {
        if (draft.value === target) target.qualificationType = previous || 'auditee';
        return;
      }
    }
    if (draft.value !== target) return;
    target.assessmentKinds = [];
    target.passScore = null;
    target.practicalPassScore = null;
    target.questions = [];
    target.practicalQuestions = [];
    target.subjectiveQuestions = [];
    target.subjectiveEnabled = false;
  },
);
let generation = 0;
async function load() {
  const seq = ++generation;
  loading.value = true;
  try {
    const result = await api<{ items: Item[]; audits: AuditEvent[] }>('/system/common-courses');
    if (seq !== generation) return;
    items.value = result.items;
    audits.value = result.audits;
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  } finally {
    if (seq === generation) loading.value = false;
  }
}
function edit(c?: Item) {
  draft.value = c
    ? { ...CourseContentSchema.parse(c), id: c.id, revision: c.revision }
    : {
        qualificationType: 'auditee',
        title: '',
        assessmentKinds: ['objective'],
        passScore: null,
        practicalPassScore: null,
        learningItems: [],
        materials: [],
        subjectiveEnabled: false,
        subjectiveQuestions: [],
        questions: [],
        practicalQuestions: [],
      };
  conflict.value = false;
  comparison.value = undefined;
  baseline.value = JSON.stringify(draft.value);
  error.value = '';
}
async function compareLatest() {
  const id = draft.value?.id,
    actor = store.actorId;
  if (!id || busy.value) return;
  await load();
  if (actor !== store.actorId || draft.value?.id !== id) return;
  comparison.value = items.value.find((c) => c.id === id);
}
function keepDraft() {
  const latest = comparison.value;
  if (draft.value && latest && latest.id === draft.value.id) {
    draft.value.revision = latest.revision;
    comparison.value = undefined;
    conflict.value = false;
    error.value = '';
    store.notify('작성 내용은 유지했습니다. 최신 내용과 비교한 결과로 다시 저장해 주세요.');
  }
}
watch(
  () => !!draft.value,
  async () => {
    await nextTick();
    heading.value?.focus();
  },
);
async function leave() {
  return (
    !busy.value &&
    (!dirty.value ||
      (await confirmAction(
        '작성 중인 공통인증Set을 저장하지 않고 이동할까요?',
        '변경 버리고 이동',
      )))
  );
}
async function close() {
  if (await leave()) {
    draft.value = undefined;
    error.value = '';
  }
}
async function save() {
  if (!draft.value || busy.value || !editor.value?.commit()) return;
  const seq = generation;
  busy.value = true;
  error.value = '';
  try {
    const { id, ...body } = draft.value;
    await mutate(`/system/common-courses${id ? '/' + id : ''}`, body, id ? 'PUT' : 'POST');
    if (seq !== generation) return;
    draft.value = undefined;
    await load();
    store.notify('공통인증Set을 저장했습니다. 기존 팀 사본에는 반영되지 않습니다.');
  } catch (e) {
    if (seq === generation) {
      error.value = (e as Error).message;
      conflict.value = e instanceof ApiError && e.status === 409;
    }
  } finally {
    if (seq === generation || !draft.value) busy.value = false;
  }
}
async function changeStatus() {
  if (!lifecycle.value || busy.value) return;
  const item = lifecycle.value,
    seq = generation;
  busy.value = true;
  error.value = '';
  try {
    await mutate(
      `/system/common-courses/${item.id}/${item.operationalStatus === 'active' ? 'retire' : 'restore'}`,
      { revision: item.revision, reason: reason.value },
    );
    if (seq !== generation) return;
    lifecycle.value = undefined;
    await load();
    store.notify('공통인증Set 운영 상태를 변경했습니다.');
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => {
  generation++;
  window.removeEventListener('beforeunload', beforeUnload);
});
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
watch(
  () => store.actorId,
  () => {
    generation++;
    draft.value = undefined;
    lifecycle.value = undefined;
    comparison.value = undefined;
    conflict.value = false;
    busy.value = false;
    items.value = [];
    error.value = '';
    void load();
  },
  { immediate: true },
);
</script>
<template>
  <div class="text-stack common-courses">
    <div class="section-heading">
      <h1 ref="heading" tabindex="-1">{{ draft ? '공통인증Set 편집' : '공통인증Set 관리' }}</h1>
      <button v-if="!draft" class="button primary" :disabled="loading || busy" @click="edit()">
        새 공통인증Set 만들기</button
      ><button v-else class="button secondary" :disabled="busy" @click="close">목록으로</button>
    </div>
    <p class="muted">
      기본자격의 기본 목록으로 지정할 인증Set입니다. 변경 내용은 이후 새 팀 자격 등록에만
      반영됩니다.
    </p>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>
    <button
      v-if="draft && conflict"
      class="button secondary"
      :disabled="busy || loading"
      @click="compareLatest"
    >
      입력 유지·최신 내용 비교
    </button>
    <template v-if="!draft">
      <button class="text-link" :disabled="busy || loading" @click="load">
        목록 다시 불러오기
      </button>
      <div class="list-toolbar">
        <label class="field">공통인증Set 검색<input v-model="query" type="search" /></label
        ><label class="field"
          >인증 유형<select v-model="type">
            <option value="all">전체</option>
            <option value="auditee">Auditee</option>
            <option value="auditor">Auditor</option>
          </select></label
        ><label class="field"
          >운영 상태<select v-model="status" aria-label="운영 상태">
            <option value="active">운영 중</option>
            <option value="retired">운영 종료</option>
            <option value="all">전체</option>
          </select></label
        >
      </div>
      <p v-if="loading" role="status">불러오는 중입니다.</p>
      <div class="table-panel">
        <table>
          <thead>
            <tr>
              <th>공통인증Set명</th>
              <th>유형</th>
              <th>운영 상태</th>
              <th>준비 상태</th>
              <th>기본자격</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in listed" :key="c.id">
              <td>
                <button class="text-button" @click="edit(c)">{{ c.title || '이름 없음' }}</button>
              </td>
              <td>{{ qualificationTypeLabels[c.qualificationType] }}</td>
              <td>{{ c.operationalStatus === 'active' ? '운영 중' : '운영 종료' }}</td>
              <td>{{ c.readiness.length ? '보완 필요' : '준비 완료' }}</td>
              <td>{{ c.templateCount }}개</td>
              <td>
                <button class="button ghost" @click="edit(c)">내용 보기·수정</button
                ><button
                  class="button ghost"
                  @click="
                    lifecycle = c;
                    reason = '';
                    error = '';
                  "
                >
                  {{ c.operationalStatus === 'active' ? '운영 종료' : '운영 재개' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!loading && !listed.length" class="empty-state">등록된 공통인증Set이 없습니다.</p>
      </div>
    </template>
    <template v-else>
      <p v-if="current?.operationalStatus === 'retired'" class="notice-body">
        운영 종료된 공통인증Set입니다. 목록에서 운영을 재개한 뒤 수정해 주세요.
      </p>
      <CourseEditor
        :key="draft.id || 'new'"
        ref="editor"
        :course="draft"
        :type-editing="{
          canChangeType: current?.canChangeType ?? true,
          typeChangeReason: current?.typeChangeReason ?? '사용 전까지 유형을 변경할 수 있습니다.',
        }"
        :disabled="busy || current?.operationalStatus === 'retired'"
        :issues="issues"
        :show-errors="false"
      />
      <details v-if="issues.length">
        <summary>신규 운영 전 보완 {{ issues.length }}건</summary>
        <ul>
          <li v-for="(i, n) in issues" :key="n">{{ i.message }}</li>
        </ul>
      </details>
      <div class="form-actions">
        <button class="button secondary" :disabled="busy" @click="close">취소</button
        ><button
          class="button primary"
          :disabled="busy || current?.operationalStatus === 'retired'"
          @click="save"
        >
          공통인증Set 저장
        </button>
      </div>
      <details v-if="history.length">
        <summary>변경 이력 {{ history.length }}건</summary>
        <ol>
          <li v-for="a in history" :key="a.id">
            {{ new Date(a.date).toLocaleString('ko-KR') }} ·
            {{
              a.action.endsWith('create')
                ? '생성'
                : a.action.endsWith('update')
                  ? '내용 수정'
                  : '운영 상태 변경'
            }}
            · {{ store.username(a.actorId) }}
            <p class="muted">{{ a.reason }}</p>
          </li>
        </ol>
      </details>
    </template>
    <AppDialog
      :open="!!comparison"
      title="최신 공통인증Set 내용"
      @update:open="
        (v) => {
          if (!v) comparison = undefined;
        }
      "
    >
      <p>
        현재 서버에 저장된 내용입니다. 작성 중인 입력은 유지됩니다. 차이를 확인한 뒤 다시 검토해
        주세요.
      </p>
      <CourseEditor
        v-if="comparison"
        :course="comparison"
        :disabled="true"
        :issues="[]"
        :show-errors="false"
      />
      <template #footer
        ><button class="button secondary" @click="comparison = undefined">입력으로 돌아가기</button
        ><button class="button primary" @click="keepDraft">
          작성 내용 유지·다시 검토
        </button></template
      >
    </AppDialog>
    <AppDialog
      :open="!!lifecycle"
      :title="
        lifecycle?.operationalStatus === 'active'
          ? '공통인증Set 운영 종료'
          : '공통인증Set 운영 재개'
      "
      @update:open="
        (v) => {
          if (!v && !busy) lifecycle = undefined;
        }
      "
      ><p>{{ lifecycle?.title }}</p>
      <p>
        기본 목록에서 사용 중인 공통인증Set은 먼저 연결을 해제해야 합니다. 기존 팀 사본은
        유지됩니다.
      </p>
      <p v-if="error" role="alert" class="error-message">{{ error }}</p>
      <label class="field"
        >변경 사유<textarea v-model="reason" :disabled="busy" maxlength="2000" /></label
      ><template #footer
        ><button class="button secondary" :disabled="busy" @click="lifecycle = undefined">
          취소</button
        ><button class="button primary" :disabled="busy || !reason.trim()" @click="changeStatus">
          상태 변경
        </button></template
      ></AppDialog
    >
  </div>
</template>
<style scoped>
.common-courses table {
  min-width: 720px;
}
.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.common-courses details {
  padding: 12px 0;
  border-top: 1px solid var(--border, #e3e8ee);
}
.common-courses td .button {
  white-space: nowrap;
}
</style>
