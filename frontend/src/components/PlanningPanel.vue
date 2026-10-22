<script setup lang="ts">
import { confirmAction } from '../composables/useConfirmation';
import { computed, ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { kstDate, defaultPlanningDueOn, type Enrollment } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import AppDialog from './AppDialog.vue';
const store = useDemo(),
  open = ref(false),
  busy = ref(false),
  error = ref(''),
  filter = ref('all'),
  dueEdited = ref(false);
const form = ref({ learnerIds: [] as string[], dueOn: '', message: '' });
const readiness = (id: string) => store.data.planningReadiness.find((r) => r.learnerId === id);
const learners = computed(() =>
  store.data.users.filter(
    (u) => u.lv1OrganizationId === store.managementLv1 && u.roles.includes('learner'),
  ),
);
const ready = computed(() => learners.value.some((u) => readiness(u.id)?.canRequest));
function phase(e: Enrollment) {
  return e.completion
    ? '수료'
    : [e.objective, e.practical].includes('passed')
      ? '일부 통과'
      : e.history.length || Object.keys(e.activeAttempts).length
        ? '평가 중'
        : '평가 전';
}
const rows = computed(() =>
  learners.value
    .map((user) => {
      const requests = store.data.planningRequests
        .filter((r) => r.learnerId === user.id)
        .slice()
        .reverse();
      const summaries = store.data.requestProgress.filter((p) => p.learnerId === user.id);
      const plans = store.data.plans.filter((p) => p.learnerId === user.id);
      const assignments = store.data.assignments.filter(
        (a) => a.learnerId === user.id && !a.excludedReason,
      );
      const stage = summaries.find((p) => p.id === requests[0]?.id)?.stage || '미발송';
      const late =
        requests.some(
          (r) =>
            r.dueOn < kstDate() &&
            !['계획 완료', '추가 계획 대상 없음'].includes(
              summaries.find((p) => p.id === r.id)?.stage || '',
            ),
        ) ||
        plans.some(
          (p) =>
            p.targetOn &&
            p.targetOn < kstDate() &&
            (!p.assignmentId || assignments.some((a) => a.id === p.assignmentId && !a.certifiedAt)),
        );
      return { user, requests, summaries, plans, assignments, stage, late };
    })
    .filter(
      (r) =>
        filter.value === 'all' ||
        filter.value === r.stage ||
        (filter.value === 'late' && r.late) ||
        r.assignments.some((a) => a.enrollments.some((e) => phase(e) === filter.value)),
    ),
);
function startRequest() {
  form.value = {
    learnerIds: [],
    dueOn: defaultPlanningDueOn(store.data.serverDate + 'T00:00:00+09:00'),
    message: '',
  };
  dueEdited.value = false;
  error.value = '';
  open.value = true;
}
async function send() {
  if (!form.value.dueOn) {
    error.value = '계획 작성 기한을 입력해 주세요.';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await store.command('/planning-requests', {
      ...form.value,
      ...(dueEdited.value ? {} : { dueOn: undefined }),
    });
    open.value = false;
    store.notify('대상자별 계획 수립 요청을 저장했습니다.');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function leave() {
  return (
    !busy.value &&
    (!open.value ||
      !form.value.learnerIds.length ||
      (await confirmAction('작성 중인 요청을 취소하고 이동할까요?', '변경 버리고 이동')))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <section class="panel planning-panel">
    <div class="section-heading">
      <h2>계획 요청 현황</h2>
      <button class="button primary" :disabled="busy || !ready" @click="startRequest">
        계획 수립 요청
      </button>
    </div>
    <p v-if="!ready" class="notice-body">
      요청할 대상이 없습니다. 아래 대상자의 소속·취득 대상자 상태를 확인해 주세요.
    </p>
    <label class="field compact-field"
      >계획·진행 필터<select v-model="filter">
        <option value="all">전체 대상자</option>
        <option
          v-for="state in [
            '미발송',
            '미착수',
            '자격 준비 대기',
            '확인 필요',
            '추가 계획 대상 없음',
            '작성 중',
            '계획 완료',
            '평가 전',
            '평가 중',
            '일부 통과',
            '수료',
          ]"
          :key="state"
        >
          {{ state }}
        </option>
        <option value="late">목표일·기한 경과</option>
      </select></label
    >
    <div class="table-panel">
      <table>
        <thead>
          <tr>
            <th>대상자·소속</th>
            <th>요청 준비</th>
            <th>요청별 계획 현황</th>
            <th>진행 상태</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.user.id">
            <td>
              {{ row.user.name
              }}<small class="table-subtext">{{ row.user.organizationPath.at(-1)?.name }}</small>
            </td>
            <td>
              {{ readiness(row.user.id)?.reason
              }}<small class="table-subtext"
                >필수 {{ readiness(row.user.id)?.requiredCount || 0 }} · 신규 가능
                {{ readiness(row.user.id)?.count || 0 }} · 작성 중
                {{ readiness(row.user.id)?.draftCount || 0 }}</small
              >
            </td>
            <td>
              <span>{{ row.stage }}</span>
              <details v-for="r in row.requests" :key="r.id">
                <summary>
                  {{ r.dueOn }} 기한 · {{ row.summaries.find((s) => s.id === r.id)?.stage }}
                </summary>
                <p v-for="s in row.summaries.filter((s) => s.id === r.id)" :key="s.id">
                  대상 {{ s.total }}개 · 계획 확정 {{ s.planned }}개 · 유효 인증 {{ s.valid }}개 ·
                </p>
                <p>{{ r.message }}</p>
                <p v-if="r.source === 'migration'" class="muted">
                  이관 시 확보한 소속·계획 대상입니다. 당시 원본에 없는 요청 범위를 추정하지
                  않았습니다.
                </p>
                <ul>
                  <li
                    v-for="target in [...(r.targets || []), ...r.selections]"
                    :key="target.entityId"
                  >
                    {{ target.title }} · 요청 당시 v{{ target.version }}
                  </li>
                </ul>
              </details>
              <details v-if="row.plans.length">
                <summary>개인 계획 {{ row.plans.length }}건</summary>
                <div v-for="p in row.plans" :key="p.id">
                  <strong>{{
                    store.qualification(p.qualificationId, p.qualificationMetadata).title
                  }}</strong>
                  <p>목표 인증일 {{ p.targetOn || '미정' }}</p>
                  <p v-for="s in p.schedules" :key="s.courseId">
                    {{ store.course(s.courseId).title }} · {{ s.goal || '목표 미정' }} · 평가 예정
                    {{ s.assessmentOn || '미정' }}
                  </p>
                </div>
              </details>
            </td>
            <td>
              <p v-for="a in row.assignments" :key="a.id">
                {{ store.qualification(a.qualificationId, a.qualificationMetadata).title
                }}<span
                  v-for="state in ['평가 전', '평가 중', '일부 통과', '수료']"
                  :key="state"
                  class="table-subtext"
                  >{{ state }}
                  {{ a.enrollments.filter((e) => phase(e) === state).length }}인증Set</span
                >
              </p>
              <p v-if="row.late">목표일·기한 경과</p>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="empty-state">해당 대상자가 없습니다.</p>
    </div>
  </section>
  <AppDialog v-model:open="open" title="계획 수립 요청"
    ><p>{{ store.managementOrganization?.name }}</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <fieldset class="template-list">
      <legend>대상 학습자</legend>
      <label v-for="u in learners" :key="u.id" class="choice"
        ><input
          v-model="form.learnerIds"
          :aria-label="u.name"
          :value="u.id"
          type="checkbox"
          :disabled="busy || !readiness(u.id)?.canRequest"
        /><span
          >{{ u.name }} · {{ u.organizationPath.at(-1)?.name
          }}<small
            >{{ readiness(u.id)?.reason }} · 필수 {{ readiness(u.id)?.requiredCount || 0 }} · 신규
            가능 {{ readiness(u.id)?.count || 0 }} · 작성 중
            {{ readiness(u.id)?.draftCount || 0 }}</small
          ></span
        ></label
      >
    </fieldset>
    <label class="field"
      >계획 작성 기한<input
        v-model="form.dueOn"
        @input="dueEdited = true"
        type="date"
        :disabled="busy"
      /><span v-if="dueEdited && !form.dueOn" class="field-error"
        >계획 작성 기한을 입력해 주세요.</span
      ></label
    ><label class="field"
      >안내문<textarea v-model="form.message" rows="3" maxlength="2000" :disabled="busy" />
    </label>
    <p class="muted">
      학습자가 팀 적용 자격을 선택합니다. 이번 요청의 필수 기준은 발송 시점에 고정하며, 필수 자격이
      없어도 요청할 수 있습니다.
    </p>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="open = false">취소</button
      ><button
        class="button primary"
        :disabled="busy || !form.learnerIds.length || !form.dueOn"
        @click="send"
      >
        대상자에게 요청
      </button></template
    ></AppDialog
  >
</template>
