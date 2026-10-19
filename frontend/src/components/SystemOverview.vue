<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDemo } from '../stores/demo';
import { comparisonLabels } from '@eks/contracts';
import StatusBadge from './StatusBadge.vue';
const store = useDemo();
const root = ref(''),
  tab = ref('assignments');
const tabs = [
  { id: 'assignments', name: '배정·평가 결과' },
  { id: 'qualifications', name: '자격' },
  { id: 'courses', name: '과정·평가 기준' },
  { id: 'comparisons', name: '실제 수행 비교' },
  { id: 'notices', name: '공지' },
  { id: 'audits', name: '변경 이력' },
];
const matches = (id: string) => !root.value || id === root.value;
const assignments = computed(() =>
  store.data.assignments.filter((a) => matches(a.lv1OrganizationId)),
);
const comparisons = computed(() =>
  store.data.comparisons.filter((c) =>
    assignments.value.some((a) => a.enrollments.some((e) => e.id === c.enrollmentId)),
  ),
);
const audits = computed(() =>
  store.data.audits
    .filter(
      (e) =>
        !root.value ||
        e.lv1OrganizationId === root.value ||
        assignments.value.some((a) => a.id === e.assignmentId),
    )
    .slice()
    .reverse(),
);
const rootName = (id: string) => store.data.organizations.find((o) => o.id === id)?.name ?? id;
const stateLabels: Record<string, string> = {
  ready: '미시작',
  draft: '작성 중',
  waiting: '평가 대기',
  passed: '통과',
  failed: '미통과',
};
const valueLabel = (value?: string) =>
  value === 'pass' ? '충족' : value === 'fail' ? '미충족' : '미판정';
const actionLabels: Record<string, string> = {
  'course.delete': '과정 초안 삭제',
  'course.retire': '과정 운영 종료',
  'course.reactivate': '과정 운영 재개',
  'catalog.create': '기준 초안 생성',
  'catalog.save': '기준 초안 저장',
  'catalog.publish': '기준 사용 등록',
  'catalog.clone': '기준 새 버전 생성',
  'assignment.create': '자격 배정',
  'assignment.ft': '담당 FT 변경',
  'assignment.exclude': '검증 제외 설정',
  'attempt.start': '평가 시작·요청',
  'attempt.submit': '평가 확정',
  'notice.save': '공지 저장',
  'comparison.create': '비교 기록 생성',
  'comparison.save': '비교 기록 저장',
  'comparison.finalize': '비교 확정',
  'comparison.correct': '비교 정정',
  'progress.reset': '테스트 진행 내역 초기화',
  'user.create': '사용자 등록',
  'user.update': '사용자 소속·역할 수정',
};
</script>
<template>
  <div class="section-heading">
    <h1>전체 업무 조회</h1>
    <span class="small-label">조회 전용</span>
  </div>
  <label class="field"
    ><span>조회할 Lv1 조직</span
    ><select aria-label="조회할 Lv1 조직" v-model="root">
      <option value="">전체 조직</option>
      <option
        v-for="o in store.data.organizations.filter((o) => o.level === 1)"
        :key="o.id"
        :value="o.id"
      >
        {{ o.name }}
      </option>
    </select></label
  >
  <div class="system-tabs" role="tablist" aria-label="조회 항목">
    <button
      v-for="item in tabs"
      :key="item.id"
      role="tab"
      :aria-selected="tab === item.id"
      :class="{ active: tab === item.id }"
      @click="tab = item.id"
    >
      {{ item.name }}
    </button>
  </div>
  <section v-if="tab === 'assignments'" class="system-records">
    <p v-if="!assignments.length" class="empty-state">배정된 자격이 없습니다.</p>
    <details v-for="a in assignments" :key="a.id" class="panel record-detail">
      <summary>
        {{ store.username(a.learnerId) }} · {{ store.qualification(a.qualificationId).title }}
        <span class="small-label">{{
          a.excludedReason ? '검증 제외' : a.certifiedAt ? '인증 완료' : '진행 중'
        }}</span>
      </summary>
      <p class="muted">
        {{ rootName(a.lv1OrganizationId) }} · 담당 FT {{ store.username(a.ftId) }}
      </p>
      <p class="muted">
        {{ a.organizationSource === 'migration' ? '이관 시 소속' : '배정 당시 소속' }}:
        {{ a.organizationPath.map((p) => p.name).join(' › ') }}
      </p>
      <p v-if="a.excludedReason">제외 사유: {{ a.excludedReason }}</p>
      <RouterLink v-if="a.certification" :to="`/certifications/${a.id}`" class="text-link"
        >검증용 인증 보기</RouterLink
      >
      <article v-for="e in a.enrollments" :key="e.id" class="readonly-course">
        <h3>{{ store.course(e.courseId).title }}</h3>
        <p>
          <span v-for="kind in store.requiredKinds(store.course(e.courseId))" :key="kind"
            >{{ kind === 'objective' ? '객관식' : '실기' }}: {{ stateLabels[e[kind]] }} · </span
          >{{ e.completion ? '수료' : '진행 중' }}
        </p>
        <details
          v-for="t in [...e.history, ...Object.values(e.activeAttempts)]"
          :key="t!.id"
          class="attempt-readonly"
        >
          <summary>
            {{ t!.kind === 'objective' ? '객관식' : '실기' }} {{ t!.round }}회 ·
            {{ t!.result === 'passed' ? '통과' : t!.result === 'failed' ? '미통과' : '작성 중' }}
          </summary>
          <p v-if="t!.evaluatorId">평가자: {{ store.username(t!.evaluatorId) }}</p>
          <template v-if="t!.kind === 'practical'"
            ><p v-for="item in store.course(e.courseId).practicalItems" :key="item.id">
              {{ item.title }} · {{ valueLabel(t!.verdicts?.[item.id]?.value) }}<br />{{
                t!.verdicts?.[item.id]?.evidence || '근거 미작성'
              }}
            </p></template
          >
          <template v-else
            ><p v-for="q in store.course(e.courseId).questions" :key="q.id">
              {{ q.prompt }}<br />응답: {{ q.choices[t!.answers?.[q.id] ?? -1] || '미응답' }}
            </p>
            <p v-if="t!.total">점수: {{ t!.earned }} / {{ t!.total }}</p></template
          >
        </details>
      </article>
    </details>
  </section>
  <section v-else-if="tab === 'qualifications'" class="system-records">
    <p
      v-if="!store.data.qualifications.some((q) => matches(q.lv1OrganizationId))"
      class="empty-state"
    >
      등록된 자격이 없습니다.
    </p>
    <details
      v-for="q in store.data.qualifications.filter((q) => matches(q.lv1OrganizationId))"
      :key="q.id"
      class="panel record-detail"
    >
      <summary>
        {{ q.title || '이름 없는 초안' }} · v{{ q.version }}
        <StatusBadge :status="q.status === 'draft' ? 'catalogDraft' : q.status" />
      </summary>
      <p class="muted">{{ rootName(q.lv1OrganizationId) }}</p>
      <ul>
        <li v-for="id in q.courseIds" :key="id">{{ store.course(id).title }}</li>
      </ul>
    </details>
  </section>
  <section v-else-if="tab === 'courses'" class="system-records">
    <p v-if="!store.data.courses.some((c) => matches(c.lv1OrganizationId))" class="empty-state">
      등록된 과정이 없습니다.
    </p>
    <details
      v-for="c in store.data.courses.filter((c) => matches(c.lv1OrganizationId))"
      :key="c.id"
      class="panel record-detail"
    >
      <summary>
        {{ c.title || '이름 없는 초안' }} · v{{ c.version }}
        <StatusBadge
          :status="
            c.operationalStatus === 'retired'
              ? 'retired'
              : c.status === 'draft'
                ? 'catalogDraft'
                : c.status
          "
        />
      </summary>
      <p class="muted">{{ rootName(c.lv1OrganizationId) }}</p>
      <p class="preserve-lines">{{ c.material }}</p>
      <a v-if="c.materialUrl" :href="c.materialUrl" target="_blank" rel="noopener noreferrer"
        >학습 자료</a
      >
      <p>{{ c.instruction }}</p>
      <p v-if="c.passScore">객관식 합격 기준 {{ c.passScore }}%</p>
      <article v-for="q in c.questions" :key="q.id">
        <h3>{{ q.prompt }}</h3>
        <ol>
          <li v-for="(choice, index) in q.choices" :key="index">
            {{ choice }}{{ q.correct === index ? ' · 정답' : '' }}
          </li>
        </ol>
      </article>
      <article v-for="item in c.practicalItems" :key="item.id">
        <h3>{{ item.title }} · {{ item.mandatory ? '필수' : '선택' }}</h3>
        <p>{{ item.criterion }}</p>
      </article>
    </details>
  </section>
  <section v-else-if="tab === 'comparisons'" class="system-records">
    <p v-if="!comparisons.length" class="empty-state">비교 기록이 없습니다.</p>
    <details v-for="c in comparisons" :key="c.id" class="panel record-detail">
      <summary>
        {{ store.username(c.learnerId) }} · {{ store.course(c.courseId).title }} ·
        {{ c.outcome ? comparisonLabels[c.outcome] : '초안' }}
      </summary>
      <p>관찰일 {{ c.observedAt || '미입력' }} · 관찰자 {{ c.observer || '미입력' }}</p>
      <p>작업: {{ c.task }}</p>
      <p>기준: {{ c.criterion }}</p>
      <p class="preserve-lines">근거: {{ c.evidence }}</p>
      <a v-if="c.evidenceUrl" :href="c.evidenceUrl" target="_blank" rel="noopener noreferrer"
        >근거 자료</a
      >
      <p v-if="c.correctionReason">정정 사유: {{ c.correctionReason }}</p>
      <p class="muted">비교한 회차 ID: {{ c.attemptIds.join(', ') }}</p>
    </details>
  </section>
  <section v-else-if="tab === 'notices'" class="system-records">
    <p v-if="!store.data.notices.some((n) => matches(n.lv1OrganizationId))" class="empty-state">
      공지가 없습니다.
    </p>
    <article
      v-for="n in store.data.notices.filter((n) => matches(n.lv1OrganizationId))"
      :key="n.id"
      class="panel record-detail"
    >
      <h2>{{ n.title }}</h2>
      <p class="muted">
        {{ rootName(n.lv1OrganizationId) }} · {{ n.published ? '게시' : '비공개' }}
      </p>
      <p class="preserve-lines">{{ n.body }}</p>
    </article>
  </section>
  <section v-else class="system-records">
    <p v-if="!audits.length" class="empty-state">변경 이력이 없습니다.</p>
    <details v-for="event in audits" :key="event.id" class="panel record-detail">
      <summary>
        {{ new Date(event.date).toLocaleString('ko-KR') }} · {{ store.username(event.actorId) }} ·
        {{ actionLabels[event.action] || '변경 기록' }}
      </summary>
      <p v-if="event.lv1OrganizationId" class="muted">{{ rootName(event.lv1OrganizationId) }}</p>
      <p>{{ event.reason || '추가 사유 없음' }}</p>
      <details v-if="Object.keys(event.details).length">
        <summary>상세 기록 원문</summary>
        <pre>{{ JSON.stringify(event.details, null, 2) }}</pre>
      </details>
    </details>
  </section>
</template>
