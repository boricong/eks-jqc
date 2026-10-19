<script setup lang="ts">
import { computed, ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { kstDate } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import AppDialog from './AppDialog.vue';
const store = useDemo(),
  open = ref(false),
  busy = ref(false),
  error = ref(''),
  filter = ref('all');
const form = ref({ learnerIds: [] as string[], dueOn: '', message: '', ftId: '' });
const ready = computed(() =>
  store.data.qualifications.some(
    (q) =>
      q.lv1OrganizationId === store.managementLv1 &&
      q.status === 'published' &&
      !store.qualificationErrors(q).length,
  ),
);
const learners = computed(() =>
  store.data.users.filter(
    (u) => u.lv1OrganizationId === store.managementLv1 && u.roles.includes('learner'),
  ),
);
const rows = computed(() =>
  learners.value
    .map((user) => {
      const request = store.data.planningRequests.filter((r) => r.learnerId === user.id).at(-1);
      const plans = store.data.plans.filter((p) => p.learnerId === user.id);
      const assignments = store.data.assignments.filter(
        (a) => a.learnerId === user.id && !a.excludedReason && !a.certifiedAt,
      );
      const requestedPlans = plans.filter((p) => p.requestId === request?.id);
      const stage = !request
        ? '미발송'
        : !requestedPlans.length
          ? '미착수'
          : requestedPlans.some((p) => p.status === 'draft')
            ? '작성 중'
            : '계획 완료';
      const ftMissing = assignments.some(
        (a) =>
          !a.ftId &&
          a.enrollments.some((e) =>
            store.requiredKinds(store.course(e.courseId)).some((k) => k !== 'objective'),
          ),
      );
      const waiting = assignments.reduce(
        (n, a) =>
          n +
          a.enrollments.filter((e) => e.subjective === 'waiting' || e.practical === 'waiting')
            .length,
        0,
      );
      const late =
        (!!request && stage !== '계획 완료' && request.dueOn < kstDate()) ||
        plans.some(
          (p) =>
            p.targetOn &&
            p.targetOn < kstDate() &&
            (!p.assignmentId || assignments.some((a) => a.id === p.assignmentId)),
        );
      return { user, request, plans, assignments, stage, ftMissing, waiting, late };
    })
    .filter(
      (r) =>
        filter.value === 'all' ||
        (filter.value === 'ft'
          ? r.ftMissing
          : filter.value === 'waiting'
            ? r.waiting
            : filter.value === 'late'
              ? r.late
              : filter.value === 'learning'
                ? r.assignments.some((a) => a.enrollments.some((e) => !e.learningComplete))
                : r.stage === filter.value),
    ),
);
async function send() {
  busy.value = true;
  error.value = '';
  try {
    await store.command('/planning-requests', { ...form.value, ftId: form.value.ftId || null });
    open.value = false;
    form.value = { learnerIds: [], dueOn: '', message: '', ftId: '' };
    store.notify('대상자별 계획 요청과 개인 알림을 생성했습니다.');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
function leave() {
  return (
    !busy.value &&
    (!open.value ||
      !form.value.learnerIds.length ||
      window.confirm('작성한 계획 요청을 취소하고 이동할까요?'))
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
</script>
<template>
  <section class="panel planning-panel">
    <div class="section-heading">
      <h2>계획 요청 현황</h2>
      <button class="button primary" :disabled="!ready || busy" @click="open = true">
        계획 수립 요청
      </button>
    </div>
    <p v-if="!ready" class="muted">
      계획할 수 있는 자격이 없습니다.
      <RouterLink :to="store.managementLink('/admin/qualifications')"
        >자격 설명·기간·과정 기준을 준비해 주세요.</RouterLink
      >
    </p>
    <label class="field compact-field"
      ><span>계획·진행 필터</span
      ><select aria-label="계획·진행 필터" v-model="filter">
        <option value="all">전체 대상자</option>
        <option v-for="state in ['미발송', '미착수', '작성 중', '계획 완료']" :key="state">
          {{ state }}
        </option>
        <option value="learning">학습 진행</option>
        <option value="ft">FT 미배정</option>
        <option value="waiting">평가 대기</option>
        <option value="late">목표일·기한 경과</option>
      </select></label
    >
    <div class="table-panel">
      <table v-if="rows.length">
        <thead>
          <tr>
            <th>대상자</th>
            <th>계획 상태</th>
            <th>작성 기한</th>
            <th>자격별 계획</th>
            <th>진행 상태</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.user.id">
            <td>
              {{ row.user.name
              }}<small class="table-subtext">{{ row.user.organizationPath.at(-1)?.name }}</small>
            </td>
            <td>{{ row.stage }}</td>
            <td>{{ row.request?.dueOn || '—' }}</td>
            <td>
              <details v-if="row.plans.length">
                <summary>
                  {{ row.plans.filter((p) => p.status === 'completed').length }} /
                  {{ row.plans.length }} 계획 완료
                </summary>
                <div v-for="p in row.plans" :key="p.id" class="plan-summary">
                  <strong>{{ store.qualification(p.qualificationId).title }}</strong>
                  <p>목표 인증일 {{ p.targetOn || '미정' }}</p>
                  <p v-for="s in p.schedules" :key="s.courseId">
                    {{ store.course(s.courseId).title }} · {{ s.goal || '목표 미정' }} · 평가 예정
                    {{ s.assessmentOn || '미정' }}
                  </p>
                </div>
              </details>
              <span v-else>—</span>
            </td>
            <td>
              <p v-if="row.ftMissing">FT 미배정 · 아래 배정에서 지정</p>
              <p v-if="row.waiting">평가 대기 {{ row.waiting }}과정</p>
              <p v-if="row.late">목표일·기한 경과</p>
              <span v-if="!row.ftMissing && !row.waiting && !row.late">{{
                row.assignments.length ? '학습·평가 진행' : '—'
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state">해당 대상자가 없습니다.</p>
    </div>
  </section>
  <AppDialog v-model:open="open" title="계획 수립 요청">
    <p>{{ store.managementOrganization?.name }}</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <fieldset class="template-list">
      <legend>대상 학습자</legend>
      <label v-for="u in learners" :key="u.id" class="choice"
        ><input
          v-model="form.learnerIds"
          :value="u.id"
          type="checkbox"
          :disabled="busy || !u.organizationActive"
        />{{ u.name
        }}<span v-if="store.data.planningRequests.some((r) => r.learnerId === u.id)" class="muted"
          >이전 요청 있음</span
        ></label
      >
    </fieldset>
    <label class="field"
      ><span>계획 작성 기한</span><input v-model="form.dueOn" type="date" :disabled="busy"
    /></label>
    <label class="field"
      ><span>안내문</span
      ><textarea v-model="form.message" rows="3" maxlength="2000" :disabled="busy" />
    </label>
    <label class="field"
      ><span>담당 FT · 선택</span
      ><select aria-label="담당 FT · 선택" v-model="form.ftId" :disabled="busy">
        <option value="">계획 완료 후 배정</option>
        <option
          v-for="u in store.data.users.filter(
            (u) =>
              u.lv1OrganizationId === store.managementLv1 &&
              u.roles.includes('ft') &&
              u.organizationActive &&
              !form.learnerIds.includes(u.id),
          )"
          :key="u.id"
          :value="u.id"
        >
          {{ u.name }}
        </option>
      </select></label
    >
    <p class="muted">
      학습자가 취득할 자격을 직접 선택합니다. 다시 요청하면 새 기한과 안내를 별도 기록하며 기존
      계획과 배정은 유지합니다. FT는 계획 완료 후에도 배정할 수 있습니다.
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
    >
  </AppDialog>
</template>
