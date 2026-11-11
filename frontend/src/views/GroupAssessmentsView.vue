<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import type {
  GroupAssessment,
  GroupFile,
  GroupTrial,
  GroupPracticalConfig,
  GroupAssessmentPreview,
} from '@eks/contracts';
import { releaseVersionLabel } from '@eks/contracts';
import { api, mutate, downloadEvidence } from '../api';
import { randomUUID } from '../uuid';
import { useDemo } from '../stores/demo';
import { confirmAction } from '../composables/useConfirmation';
import PageHeading from '../components/PageHeading.vue';
import AppDialog from '../components/AppDialog.vue';
type Detail = {
  group: GroupAssessment;
  management: boolean;
  canEvaluate: boolean;
  enabled: boolean;
  blockers: string[];
  course: {
    title: string;
    releaseVersion?: { major: number; minor: number };
    version: number;
    groupPractical: GroupPracticalConfig;
  };
  files: GroupFile[];
  sourceHashes: Record<string, string>;
  evaluatorName: string;
};
type Candidates = {
  courses: {
    id: string;
    title: string;
    version: number;
    releaseVersion?: { major: number; minor: number };
  }[];
  evaluators: { id: string; name: string }[];
  enrollments: {
    id: string;
    learnerId: string;
    name: string;
    courseId: string;
    qualificationTitle: string;
    occupied: boolean;
  }[];
};
type Summary = {
  id: string;
  title: string;
  status: string;
  courseTitle: string;
  memberCount: number;
  runNumber: number;
  runStatus?: string;
  completedTrials: number;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const detail = ref<Detail>(),
  list = ref<Summary[]>([]),
  candidates = ref<Candidates>(),
  busy = ref(false),
  loading = ref(false),
  error = ref(''),
  message = ref('');
const group = computed(() => detail.value?.group),
  runId = ref(''),
  run = computed(() => group.value?.runs.find((r) => r.id === runId.value));
const base = computed(() => `/group-assessments/${group.value?.id}`),
  runBase = computed(() => `${base.value}/runs/${run.value?.id}`);
const manager = computed(() => !!detail.value?.management),
  enabled = ref(false),
  maxBytes = ref(20 * 1024 * 1024),
  maxFiles = ref(20);
const editable = computed(
  () =>
    !!detail.value?.canEvaluate &&
    group.value?.status === 'active' &&
    run.value === group.value?.runs.at(-1) &&
    !run.value?.decision,
);
const form = reactive({ title: '', courseId: '', evaluatorId: '', enrollmentIds: [] as string[] });
const trials = ref<GroupTrial[]>([]),
  analysis = reactive({
    values: {} as Record<string, number | string>,
    reportFileIds: [] as string[],
    reason: '',
    result: 'passed' as 'passed' | 'failed',
    dataVerified: false,
  });
const pendingUpload = shallowRef<{
  file: File;
  kind: 'raw' | 'report';
  key: string;
  path: string;
  input: HTMLInputElement;
}>();
const initial = ref(''),
  createInitial = JSON.stringify(form),
  dirty = computed(
    () =>
      !!pendingUpload.value ||
      (route.params.id
        ? JSON.stringify({ trials: trials.value, analysis }) !== initial.value && !!detail.value
        : JSON.stringify(form) !== createInitial),
  );
const rawFiles = computed(
    () => detail.value?.files.filter((f) => f.runId === run.value?.id && f.kind === 'raw') || [],
  ),
  reports = computed(
    () => detail.value?.files.filter((f) => f.runId === run.value?.id && f.kind === 'report') || [],
  );
const eligible = computed(
  () => candidates.value?.enrollments.filter((e) => e.courseId === form.courseId) || [],
);
const names = computed(() =>
  Object.fromEntries(group.value?.members.map((m) => [m.learnerId, m.name]) || []),
);
const statuses: Record<string, string> = {
  draft: '시작 전',
  active: '진행 중',
  collecting: '수행 기록 중',
  reviewing: '판정 검토 중',
  passed: 'Pass',
  failed: 'Fail',
  invalidated: '판정 무효',
  closed: '종료',
};
let epoch = 0;
function syncDrafts() {
  pendingUpload.value = undefined;
  trials.value = clone(run.value?.trials || []);
  const a = run.value?.analysis;
  Object.assign(analysis, {
    values: clone(a?.values || {}),
    reportFileIds: [...(a?.reportFileIds || [])],
    reason: a?.reason || '',
    result: a?.result || 'passed',
    dataVerified: a?.dataVerified || false,
  });
  initial.value = JSON.stringify({ trials: trials.value, analysis });
}
async function load(preserve = false) {
  const ticket = ++epoch,
    id = String(route.params.id || '');
  loading.value = true;
  error.value = '';
  try {
    const status = await api<{ enabled: boolean; maxFileBytes: number; maxFilesPerRun: number }>(
      '/group-assessments/status',
    );
    const result = id
      ? await api<Detail>(`/group-assessments/${id}`)
      : await api<Summary[]>(store.managementPath('/group-assessments'));
    const available =
      !id && status.enabled
        ? await api<Candidates>(store.managementPath('/group-assessments/candidates'))
        : undefined;
    if (ticket !== epoch) return;
    enabled.value = status.enabled;
    maxBytes.value = status.maxFileBytes;
    maxFiles.value = status.maxFilesPerRun;
    if (id) {
      detail.value = result as Detail;
      if (!detail.value.group.runs.some((r) => r.id === runId.value))
        runId.value = detail.value.group.runs.at(-1)?.id || '';
      if (!preserve) syncDrafts();
    } else {
      detail.value = undefined;
      list.value = result as Summary[];
      candidates.value = available;
    }
  } catch (e) {
    if (ticket === epoch) error.value = (e as Error).message;
  } finally {
    if (ticket === epoch) loading.value = false;
  }
}
watch(
  () => [route.params.id, store.actorId, store.managementLv1],
  () => {
    pendingUpload.value = undefined;
    detail.value = undefined;
    candidates.value = undefined;
    list.value = [];
    runId.value = '';
    Object.assign(form, JSON.parse(createInitial));
    void load();
  },
  { immediate: true },
);
watch(
  () => form.courseId,
  () => {
    form.enrollmentIds = [];
  },
);
async function leave() {
  return (
    !busy.value &&
    (!dirty.value || (await confirmAction('저장하지 않은 입력이 있습니다. 이동할까요?', '이동')))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
const beforeUnload = (e: BeforeUnloadEvent) => {
  if (dirty.value || busy.value) {
    e.preventDefault();
    e.returnValue = '';
  }
};
window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => {
  epoch++;
  window.removeEventListener('beforeunload', beforeUnload);
});
async function selectRun(event: Event) {
  const input = event.target as HTMLSelectElement,
    id = input.value;
  if (!(await leave())) {
    input.value = runId.value;
    return;
  }
  runId.value = id;
  syncDrafts();
}
async function perform(work: () => Promise<unknown>, success: string, preserve = false) {
  if (busy.value) return;
  const actor = store.actorId,
    scope = store.managementLv1;
  busy.value = true;
  store.writing++;
  error.value = '';
  message.value = '';
  try {
    await work();
    if (actor !== store.actorId || scope !== store.managementLv1) return;
    await load(preserve);
    await store.refresh();
    message.value = success;
  } catch (e) {
    if (actor === store.actorId) error.value = (e as Error).message;
  } finally {
    busy.value = false;
    store.writing--;
  }
}
async function create() {
  let id = '';
  await perform(async () => {
    const saved = await mutate<{ id: string }>('/group-assessments', {
      ...form,
      lv1OrganizationId: store.managementLv1,
    });
    id = saved.id;
    Object.assign(form, JSON.parse(createInitial));
  }, '그룹을 만들었습니다.');
  if (id) await router.push(store.managementLink(`/admin/group-assessments/${id}`));
}
async function start(retry = false) {
  if (
    !(await confirmAction(
      retry
        ? '같은 구성원이 실기 3회를 모두 다시 수행하는 새 평가 차수를 만들까요?'
        : '구성원과 인증Set 버전을 고정하고 실기를 시작할까요?',
      retry ? '재평가 시작' : '시작',
    ))
  )
    return;
  await perform(async () => {
    await mutate(`${base.value}/${retry ? 'retry' : 'start'}`, { revision: group.value!.revision });
    runId.value = '';
  }, '실기를 시작했습니다.');
}
async function saveTrial(t: GroupTrial) {
  const { updatedAt: _, updatedBy: __, ...body } = t;
  // Preserve unsaved entries in other rows and analysis while updating the saved row's revision.
  await perform(
    async () => {
      await mutate(`${runBase.value}/trial`, body);
      t.revision++;
      analysis.dataVerified = false;
      const saved = JSON.parse(initial.value);
      const i = saved.trials.findIndex(
        (v: GroupTrial) => v.learnerId === t.learnerId && v.number === t.number,
      );
      saved.trials[i] = clone(t);
      initial.value = JSON.stringify(saved);
    },
    '수행 기록을 저장했습니다. 원자료 변경 후 분석 결과를 다시 등록해 주세요.',
    true,
  );
}
async function saveAnalysis() {
  if (
    JSON.stringify(trials.value.map(({ updatedAt, updatedBy, ...t }) => t)) !==
    JSON.stringify(run.value?.trials.map(({ updatedAt, updatedBy, ...t }) => t))
  ) {
    error.value = '수행 기록의 변경 내용을 먼저 저장해 주세요.';
    return;
  }
  await perform(
    () =>
      mutate(`${runBase.value}/analysis`, {
        ...analysis,
        revision: run.value!.revision,
        sourceHash: detail.value!.sourceHashes[run.value!.id],
      }),
    '분석 결과를 저장했습니다.',
  );
}
async function upload(event: Event, kind: 'raw' | 'report') {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  if (file.size > maxBytes.value) {
    error.value = `파일은 ${maxBytes.value / 1024 / 1024}MB 이하여야 합니다.`;
    return;
  }
  pendingUpload.value = { file, kind, key: randomUUID(), path: runBase.value, input };
  await sendUpload();
}
async function sendUpload() {
  if (!pendingUpload.value) return;
  const { file, kind, key, path, input } = pendingUpload.value;
  await perform(
    async () => {
      await api(`${path}/files?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'Idempotency-Key': key },
      });
      input.value = '';
      pendingUpload.value = undefined;
    },
    '근거 파일을 등록했습니다.',
    true,
  );
}
const preview = ref<GroupAssessmentPreview>(),
  dialog = ref(false),
  action = ref<'finalize' | 'close' | 'evaluator' | 'invalidate'>('finalize'),
  reason = ref(''),
  evaluatorId = ref('');
const impact = ref<{
  token: string;
  completionIds: string[];
  certificationIds: string[];
  assignmentIds: string[];
}>();
async function openAction(next: typeof action.value) {
  if (dirty.value) {
    error.value = '입력한 내용을 먼저 저장하거나 다시 불러와 주세요.';
    return;
  }
  action.value = next;
  reason.value = '';
  preview.value = undefined;
  impact.value = undefined;
  evaluatorId.value = group.value!.evaluatorId;
  dialog.value = true;
  if (next === 'finalize')
    await perform(
      async () => {
        preview.value = await mutate<GroupAssessmentPreview>(`${runBase.value}/preview`, {});
      },
      '최종 반영 대상을 확인해 주세요.',
      true,
    );
  if (next === 'evaluator')
    await perform(
      async () => {
        candidates.value = await api<Candidates>(
          store.managementPath('/group-assessments/candidates'),
        );
      },
      '',
      true,
    );
}
async function previewInvalidation() {
  await perform(
    async () => {
      impact.value = await mutate(`${runBase.value}/invalidate-preview`, { reason: reason.value });
    },
    '무효화 영향을 확인해 주세요.',
    true,
  );
}
watch(reason, () => {
  impact.value = undefined;
});
async function confirm() {
  await perform(async () => {
    if (action.value === 'finalize')
      await mutate(`${runBase.value}/finalize`, {
        revision: run.value!.revision,
        reviewToken: preview.value!.token,
      });
    if (action.value === 'invalidate')
      await mutate(`${runBase.value}/invalidate`, {
        revision: run.value!.revision,
        reviewToken: impact.value!.token,
        reason: reason.value,
      });
    if (action.value === 'close')
      await mutate(`${base.value}/close`, {
        revision: group.value!.revision,
        reason: reason.value,
      });
    if (action.value === 'evaluator')
      await mutate(`${base.value}/evaluator`, {
        revision: group.value!.revision,
        evaluatorId: evaluatorId.value,
        reason: reason.value,
      });
    dialog.value = false;
  }, '반영했습니다.');
}
async function reload() {
  if (await leave()) {
    if (!route.params.id) Object.assign(form, JSON.parse(createInitial));
    await load();
  }
}
</script>
<template>
  <div class="page group-page" :class="{ container: !route.meta.management }">
    <RouterLink
      v-if="group && manager"
      :to="store.managementLink('/admin/group-assessments')"
      class="back-link"
      >그룹 목록</RouterLink
    >
    <PageHeading
      ><div>
        <p class="small-label">시험운영</p>
        <h1>{{ group?.title || '그룹 실기' }}</h1>
        <p class="muted">동일 인증Set · 개인별 실기 3회 · 평가자 공동 판정</p>
      </div>
      <button class="button secondary" :disabled="busy" @click="reload">
        다시 불러오기
      </button></PageHeading
    >
    <p class="trial-banner">
      시험환경의 수행·판정 기록입니다. 이 기능으로 발급한 수료증과 자격 인증서는 시험 발급으로
      표시됩니다.
    </p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="loading" role="status">불러오는 중…</p>
    <template v-if="!route.params.id">
      <section v-if="enabled && candidates" class="panel group-section">
        <h2>그룹 지정</h2>
        <form class="group-form" @submit.prevent="create">
          <label class="field"
            >그룹명<input v-model="form.title" required maxlength="200" :disabled="busy"
          /></label>
          <label class="field"
            >인증Set 버전<select
              aria-label="인증Set 버전"
              v-model="form.courseId"
              required
              :disabled="busy"
            >
              <option value="">선택</option>
              <option v-for="c in candidates.courses" :key="c.id" :value="c.id">
                {{ c.title }} · {{ releaseVersionLabel(c) }}
              </option>
            </select></label
          >
          <label class="field"
            >평가자<select aria-label="평가자" v-model="form.evaluatorId" required :disabled="busy">
              <option value="">팀 관리자 선택</option>
              <option
                v-for="e in candidates.evaluators"
                :key="e.id"
                :value="e.id"
                :disabled="
                  eligible.some((m) => form.enrollmentIds.includes(m.id) && m.learnerId === e.id)
                "
              >
                {{ e.name }}
              </option>
            </select></label
          >
          <fieldset class="member-options">
            <legend>구성원 {{ form.enrollmentIds.length }}명 · 3~4명 선택</legend>
            <label v-for="e in eligible" :key="e.id" class="checkbox-label"
              ><input
                v-model="form.enrollmentIds"
                type="checkbox"
                :value="e.id"
                :disabled="
                  busy ||
                  e.occupied ||
                  e.learnerId === form.evaluatorId ||
                  (!form.enrollmentIds.includes(e.id) && form.enrollmentIds.length >= 4)
                "
              />{{ e.name }} · {{ e.qualificationTitle }}
              {{ e.occupied ? '(다른 그룹 진행 중)' : '' }}</label
            >
            <p v-if="!eligible.length" class="muted">
              동일 버전의 개인 계획을 완료한 수강자가 필요합니다.
            </p>
          </fieldset>
          <button class="button primary" :disabled="busy || form.enrollmentIds.length < 3">
            그룹 만들기
          </button>
        </form>
      </section>
      <section class="panel group-section">
        <h2>그룹 목록</h2>
        <p v-if="!list.length" class="muted">등록된 그룹이 없습니다.</p>
        <ul class="group-list">
          <li v-for="g in list" :key="g.id">
            <RouterLink :to="store.managementLink(`/admin/group-assessments/${g.id}`)">{{
              g.title
            }}</RouterLink
            ><span>{{ g.courseTitle }} · {{ g.memberCount }}명</span
            ><span
              >{{ statuses[g.status] }} · {{ g.runNumber }}차 · {{ g.completedTrials }}/{{
                g.memberCount * 3
              }}회</span
            ><strong v-if="g.runStatus">{{ statuses[g.runStatus] }}</strong>
          </li>
        </ul>
      </section>
    </template>
    <template v-else-if="detail && group">
      <section class="panel group-section">
        <h2>{{ detail.course.title }} · {{ releaseVersionLabel(detail.course) }}</h2>
        <p>{{ statuses[group.status] }} · 평가자 {{ detail.evaluatorName }}</p>
        <p>{{ group.members.map((m) => m.name).join(' · ') }}</p>
        <details>
          <summary>수행 지침과 판정 기준</summary>
          <p class="preserve">{{ detail.course.groupPractical.instruction }}</p>
          <h3>분석 방법</h3>
          <p>{{ detail.course.groupPractical.method }}</p>
          <h3>공동 판정 기준</h3>
          <p class="preserve">{{ detail.course.groupPractical.criterion }}</p>
        </details>
        <ul v-if="detail.blockers.length" role="status" class="error">
          <li v-for="b in detail.blockers" :key="b">{{ b }}</li>
        </ul>
        <div v-if="manager && enabled" class="group-actions">
          <button
            v-if="group.status === 'draft'"
            class="button primary"
            :disabled="busy || !!detail.blockers.length"
            @click="start()"
          >
            실기 시작
          </button>
          <button
            class="button secondary"
            v-if="group.status === 'active' && group.runs.at(-1)?.decision?.result === 'failed'"
            :disabled="busy || !!detail.blockers.length"
            @click="start(true)"
          >
            전원 재평가 시작
          </button>
          <button
            class="button secondary"
            v-if="['draft', 'active'].includes(group.status)"
            :disabled="busy"
            @click="openAction('evaluator')"
          >
            평가자 교체
          </button>
          <button
            class="button secondary"
            v-if="['draft', 'active'].includes(group.status)"
            :disabled="busy"
            @click="openAction('close')"
          >
            그룹 종료
          </button>
        </div>
        <p v-if="group.closed" class="muted">종료 사유: {{ group.closed.reason }}</p>
      </section>
      <template v-if="run">
        <label class="field run-selector"
          >평가 차수<select
            aria-label="평가 차수"
            :value="runId"
            :disabled="busy"
            @change="selectRun"
          >
            <option v-for="r in group.runs" :key="r.id" :value="r.id">
              {{ r.number }}차 · {{ statuses[r.status] }}
            </option>
          </select></label
        >
        <section v-if="manager" class="panel group-section">
          <h2>근거 파일</h2>
          <p v-if="pendingUpload && !busy" role="status">
            {{ pendingUpload.file.name }} 등록 응답을 확인하지 못했습니다.
            <button class="button secondary" @click="sendUpload">파일 등록 다시 시도</button>
          </p>
          <p class="muted">
            파일당 {{ maxBytes / 1024 / 1024 }}MB · 평가 차수당 {{ maxFiles }}개. 등록한 파일은
            이력으로 보존됩니다.
          </p>
          <div v-if="editable" class="group-form">
            <label class="field"
              >원자료 등록 (CSV, XLSX)<input
                type="file"
                accept=".csv,.xlsx"
                :disabled="busy"
                @change="upload($event, 'raw')" /></label
            ><label class="field"
              >분석 보고서 등록 (PDF)<input
                type="file"
                accept=".pdf"
                :disabled="busy"
                @change="upload($event, 'report')"
            /></label>
          </div>
          <ul>
            <li v-for="f in [...rawFiles, ...reports]" :key="f.id">
              <button
                class="text-link"
                :disabled="busy"
                @click="perform(() => downloadEvidence(f.id, f.name), '', true)"
              >
                {{ f.name }}
              </button>
              · {{ f.kind === 'raw' ? '원자료' : '보고서' }} · {{ Math.ceil(f.bytes / 1024) }}KB
            </li>
          </ul>
        </section>
        <section class="panel group-section">
          <h2>
            개인별 수행 기록 · {{ run.trials.filter((t) => t.completed).length }}/{{
              run.trials.length
            }}회 완료
          </h2>
          <div class="trial-grid">
            <form
              v-for="t in trials"
              :key="`${t.learnerId}-${t.number}`"
              class="trial-card"
              @submit.prevent="saveTrial(t)"
            >
              <h3>{{ names[t.learnerId] }} · 실기 {{ t.number }}회</h3>
              <fieldset :disabled="!editable || busy">
                <label class="field"
                  >수행일<input
                    v-model="t.performedOn"
                    type="date"
                    :max="store.data.serverDate.slice(0, 10)"
                /></label>
                <template v-if="manager"
                  ><label class="field"
                    >원자료<select
                      aria-label="원자료"
                      :value="t.evidence[0]?.fileId || ''"
                      @change="
                        t.evidence = ($event.target as HTMLSelectElement).value
                          ? [
                              {
                                fileId: ($event.target as HTMLSelectElement).value,
                                locator: t.evidence[0]?.locator || '',
                              },
                            ]
                          : []
                      "
                    >
                      <option value="">선택</option>
                      <option v-for="f in rawFiles" :key="f.id" :value="f.id">{{ f.name }}</option>
                    </select></label
                  >
                  <label v-for="e in t.evidence" :key="e.fileId" class="field"
                    >자료 내 위치<input
                      v-model="e.locator"
                      maxlength="1000"
                      placeholder="시트명·행·측정 구간" /></label
                  ><label class="field"
                    >기록 메모<textarea v-model="t.note" rows="2" maxlength="2000" /></label
                ></template>
                <label class="checkbox-label"
                  ><input v-model="t.completed" type="checkbox" />수행 완료</label
                >
              </fieldset>
              <button class="button secondary" v-if="editable" :disabled="busy">
                수행 기록 저장
              </button>
            </form>
          </div>
        </section>
        <section v-if="manager" class="panel group-section">
          <h2>외부 분석 결과와 공동 판정</h2>
          <p class="muted">
            {{ detail.course.groupPractical.method }} · 기준을 확인하고 평가자가 직접 판정합니다.
          </p>
          <form class="group-form" @submit.prevent="saveAnalysis">
            <fieldset :disabled="!editable || busy">
              <label v-for="m in detail.course.groupPractical.metrics" :key="m.id" class="field"
                >{{ m.label }} {{ m.unit ? `(${m.unit})` : ''
                }}<input
                  v-model="analysis.values[m.id]"
                  :type="m.type === 'number' ? 'number' : 'text'"
                  :step="m.type === 'number' ? 'any' : undefined"
              /></label>
              <fieldset>
                <legend>분석에 사용한 보고서</legend>
                <label v-for="f in reports" :key="f.id" class="checkbox-label"
                  ><input v-model="analysis.reportFileIds" type="checkbox" :value="f.id" />{{
                    f.name
                  }}</label
                >
                <p v-if="!reports.length" class="muted">분석 보고서를 먼저 등록해 주세요.</p>
              </fieldset>
              <label class="field"
                >공동 판정<select aria-label="공동 판정" v-model="analysis.result">
                  <option value="passed">Pass · 전원 합격</option>
                  <option value="failed">Fail · 전원 재수행</option>
                </select></label
              ><label class="field"
                >판정 사유<textarea v-model="analysis.reason" rows="4" maxlength="2000" /></label
              ><label class="checkbox-label"
                ><input v-model="analysis.dataVerified" type="checkbox" />전원의 실기 3회 원자료와
                분석 보고서를 대조했습니다.</label
              >
            </fieldset>
            <div v-if="editable" class="group-actions">
              <button class="button secondary" :disabled="busy">분석 결과 저장</button
              ><button
                type="button"
                class="button primary"
                :disabled="busy || !run.analysis || dirty"
                @click="openAction('finalize')"
              >
                판정 검토
              </button>
            </div>
          </form>
          <details v-if="run.previousAnalyses.length">
            <summary>이전 분석 등록 {{ run.previousAnalyses.length }}건</summary>
            <ul>
              <li v-for="(a, i) in run.previousAnalyses" :key="i">
                {{ a.registeredAt }} · {{ statuses[a.result] }} · {{ a.reason }}
              </li>
            </ul>
          </details>
        </section>
        <section v-if="run.decision" class="panel group-section">
          <h2>확정 판정 · {{ statuses[run.decision.result] }}</h2>
          <p>
            {{ run.decision.decidedAt }} · 판정자 {{ store.username(run.decision.decidedBy) }} ·
            {{ run.invalidation ? '무효화됨' : '전원 공동 판정' }}
          </p>
          <p v-if="run.invalidation">무효화 사유: {{ run.invalidation.reason }}</p>
          <button
            class="button secondary"
            v-if="
              manager &&
              enabled &&
              !run.invalidation &&
              !group.members.some((m) => m.learnerId === store.actorId)
            "
            :disabled="busy"
            @click="openAction('invalidate')"
          >
            판정 무효화 검토
          </button>
        </section>
      </template>
    </template>
    <AppDialog
      v-model:open="dialog"
      :title="
        {
          finalize: '공동 판정 최종 검토',
          close: '그룹 종료',
          evaluator: '평가자 교체',
          invalidate: '판정 무효화 검토',
        }[action]
      "
      :busy="busy"
      scroll-body
    >
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <template v-if="action === 'finalize' && preview"
        ><p>
          <strong>{{
            preview.result === 'passed' ? 'Pass · 전원 합격' : 'Fail · 전원 재수행'
          }}</strong>
        </p>
        <ul v-if="preview.blockers.length" class="error">
          <li v-for="b in preview.blockers" :key="b">{{ b }}</li>
        </ul>
        <ul>
          <li v-for="m in preview.outcomes" :key="m.enrollmentId">
            {{ m.name }} · {{ m.wouldComplete ? '실기 인증Set 수료' : '수료 없음' }} ·
            {{ m.wouldCertify ? '시험 자격 발급 예정' : '자격 발급 없음' }}
          </li>
        </ul>
        <p>
          확정한 판정과 근거는 보존됩니다. 정정이 필요하면 별도 무효화 절차를 진행합니다.
        </p></template
      >
      <template v-else-if="action !== 'finalize'"
        ><label v-if="action === 'evaluator'" class="field"
          >새 평가자<select aria-label="새 평가자" v-model="evaluatorId" :disabled="busy">
            <option
              v-for="e in candidates?.evaluators.filter(
                (e) => !group?.members.some((m) => m.learnerId === e.id),
              )"
              :key="e.id"
              :value="e.id"
            >
              {{ e.name }}
            </option>
          </select></label
        ><label class="field"
          >사유<textarea v-model="reason" maxlength="2000" :disabled="busy" />
        </label>
        <template v-if="action === 'invalidate'"
          ><p>
            원래 판정은 남기고 수료 효력을 무효화합니다. 연결된 취득 절차를 종료하고 파생 인증을
            말소합니다. 다시 취득하려면 새 개인 계획이 필요합니다.
          </p>
          <button
            class="button secondary"
            :disabled="busy || !reason.trim()"
            @click="previewInvalidation"
          >
            영향 확인
          </button>
          <p v-if="impact">
            수료 {{ impact.completionIds.length }}건 무효 · 인증
            {{ impact.certificationIds.length }}건 말소 · 취득 절차
            {{ impact.assignmentIds.length }}건 종료
          </p></template
        >
        <p v-else>
          {{
            action === 'close'
              ? '이 그룹의 기록을 보존하고 진행을 종료합니다.'
              : '기존 기록은 보존하고 분석 결과를 다시 등록해야 합니다.'
          }}
        </p>
      </template>
      <template #footer
        ><button class="button secondary" :disabled="busy" @click="dialog = false">취소</button
        ><button
          class="button primary"
          :disabled="
            busy ||
            (action === 'finalize'
              ? !preview || !!preview.blockers.length
              : !reason.trim() || (action === 'invalidate' && !impact))
          "
          @click="confirm"
        >
          {{
            action === 'finalize'
              ? '공동 판정 확정'
              : action === 'invalidate'
                ? '무효화 확정'
                : '변경 확정'
          }}
        </button></template
      >
    </AppDialog>
  </div>
</template>
<style scoped>
.group-page {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.group-section {
  padding: 24px;
  display: grid;
  gap: 16px;
}
.group-form,
.group-form > fieldset {
  display: grid;
  gap: 16px;
}
.group-form {
  max-width: 800px;
}
fieldset {
  min-width: 0;
  border: 0;
  padding: 0;
  margin: 0;
}
.member-options {
  display: grid;
  gap: 12px;
}
.group-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.trial-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.trial-card {
  padding: 18px;
  border: 1px solid var(--control-border);
  border-radius: 8px;
  display: grid;
  gap: 14px;
}
.trial-card fieldset {
  display: grid;
  gap: 12px;
}
.trial-card h3 {
  margin: 0;
}
.group-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0;
}
.group-list li {
  display: grid;
  grid-template-columns: 2fr 2fr 2fr 1fr;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--control-border);
}
.trial-banner {
  border-left: 3px solid var(--accent, #635bff);
  padding: 12px 16px;
  background: var(--surface-subtle, #f6f8fc);
}
.run-selector {
  max-width: 340px;
}
.preserve {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.group-page input,
.group-page select,
.group-page textarea {
  max-width: 100%;
  min-width: 0;
}
.group-page .error {
  color: var(--danger, #b42318);
}
.group-page button {
  white-space: normal;
}
@media (max-width: 1000px) {
  .trial-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .group-list li {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 600px) {
  .trial-grid,
  .group-list li {
    grid-template-columns: minmax(0, 1fr);
  }
  .group-section {
    padding: 16px;
  }
  .group-page .page-heading {
    flex-wrap: wrap;
    gap: 12px;
  }
}
</style>
