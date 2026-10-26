<script setup lang="ts">
import { credentialCurrent, qualificationVersionLabel } from '@eks/contracts';
import CourseMaterials from './CourseMaterials.vue';
import ValidityBadge from './ValidityBadge.vue';
import { kindLabels, kstDate } from '@eks/contracts';
import { computed, ref } from 'vue';
import { useDemo } from '../stores/demo';
import StatusBadge from './StatusBadge.vue';
const store = useDemo();
const root = ref(''),
  tab = ref('assignments');
const tabs = [
  { id: 'assignments', name: '배정·평가 결과' },
  { id: 'qualifications', name: '자격' },
  { id: 'courses', name: '인증Set·평가 기준' },
  { id: 'notices', name: '공지' },
  { id: 'audits', name: '변경 이력' },
];
const matches = (id: string) => !root.value || id === root.value;
const assignments = computed(() =>
  store.data.assignments.filter((a) => matches(a.lv1OrganizationId)),
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
const assessmentNames = (kinds: (keyof typeof kindLabels)[]) =>
  kinds.map((kind) => kindLabels[kind]).join(' · ');
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
  'course.delete': '인증Set 삭제',
  'course.retire': '인증Set 운영 종료',
  'course.reactivate': '인증Set 운영 재개',
  'catalog.create': '기준 생성',
  'catalog.save': '기준 저장',
  'catalog.publish': '과거 기준 사용 등록',
  'catalog.clone': '기준 새 버전 생성',
  'assignment.create': '자격 배정',
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
  'template.import': '기본자격에서 팀 등록',
  'planning.request': '계획 수립 요청',
  'plan.create': '개인 계획 시작',
  'plan.save': '개인 계획 저장',
  'plan.complete': '개인 계획 완료',
  'learning.save': '과거 학습 완료 기록',
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
        {{ store.username(a.learnerId) }} ·
        {{ store.qualification(a.qualificationId, a.qualificationMetadata).title }}
        <span class="small-label">{{
          a.excludedReason ? '검증 제외' : a.certifiedAt ? '인증 완료' : '진행 중'
        }}</span>
      </summary>
      <p class="muted">
        {{ rootName(a.lv1OrganizationId) }}
      </p>
      <p class="muted">
        {{ a.organizationSource === 'migration' ? '이관 시 소속' : '배정 당시 소속' }}:
        {{ a.organizationPath.map((p) => p.name).join(' › ') }}
      </p>
      <p v-if="a.certification">
        <ValidityBadge :certification="a.certification" /> · 취득 {{ kstDate(a.certification.date)
        }}<span v-if="credentialCurrent(a.certification).expiresOn">
          · 만료 {{ credentialCurrent(a.certification).expiresOn }}</span
        >
      </p>
      <p v-if="a.excludedReason">제외 사유: {{ a.excludedReason }}</p>
      <RouterLink v-if="a.certification" :to="`/certifications/${a.id}`" class="text-link"
        >검증용 인증 보기</RouterLink
      >
      <article v-for="e in a.enrollments" :key="e.id" class="readonly-course">
        <h3>{{ store.course(e.courseId).title }}</h3>
        <p>
          <span v-for="kind in store.requiredKinds(store.course(e.courseId))" :key="kind"
            >{{ kindLabels[kind] }}: {{ stateLabels[e[kind]] }} · </span
          >{{ e.completion ? '수료' : '진행 중' }}
        </p>
        <p class="muted">
          자료 열람 여부를 완료로 집계하지 않습니다. 필수 평가 통과로 수료를 확인합니다.
        </p>
        <RouterLink v-if="e.completion" :to="`/completions/${e.completion.id}`" class="text-link"
          >인증Set 수료증 보기</RouterLink
        >
        <details
          v-for="t in [...e.history, ...Object.values(e.activeAttempts)]"
          :key="t!.id"
          class="attempt-readonly"
        >
          <summary>
            {{ kindLabels[t!.kind] }} {{ t!.round }}회 ·
            {{ t!.result === 'passed' ? '통과' : t!.result === 'failed' ? '미통과' : '작성 중' }}
          </summary>
          <p>자동 채점</p>
          <template
            ><p
              v-for="q in t!.kind === 'objective'
                ? store.course(e.courseId).questions
                : store.course(e.courseId).practicalQuestions"
              :key="q.id"
            >
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
        {{ q.title || '이름 없는 기준' }} · {{ qualificationVersionLabel(q.version) }}
        <StatusBadge :status="q.lifecycleStatus || 'Active'" />
      </summary>
      <p class="muted">{{ rootName(q.lv1OrganizationId) }} · {{ q.englishName }}</p>
      <p v-if="q.description">{{ q.description }}</p>
      <p>
        인증기간:
        {{
          q.validity.type === 'months'
            ? `${q.validity.months}개월 · 재인증 시작 ${q.renewalNoticeDaysBefore ?? 7}일 전 1회 알림`
            : q.validity.type === 'unlimited'
              ? '무기한'
              : '미정'
        }}
      </p>
      <ul>
        <li v-for="id in q.courseIds" :key="id">{{ store.course(id).title }}</li>
      </ul>
    </details>
  </section>
  <section v-else-if="tab === 'courses'" class="system-records">
    <p v-if="!store.data.courses.some((c) => matches(c.lv1OrganizationId))" class="empty-state">
      등록된 인증Set이 없습니다.
    </p>
    <details
      v-for="c in store.data.courses.filter((c) => matches(c.lv1OrganizationId))"
      :key="c.id"
      class="panel record-detail"
    >
      <summary>
        {{ c.title || '이름 없는 기준' }} · v{{ c.version }}
        <StatusBadge :status="c.operationalStatus === 'retired' ? 'retired' : 'active'" />
      </summary>
      <p class="muted">{{ rootName(c.lv1OrganizationId) }}</p>
      <CourseMaterials :materials="c.materials" />
      <p>필수 평가: {{ assessmentNames(c.assessmentKinds) }}</p>
      <p v-for="item in c.learningItems" :key="item.id">
        {{ item.title }} ·
        {{ item.type === 'mtc' ? 'MTC교육' : item.type === 'team' ? '팀 특화 교육' : '현업 OJT' }} ·
        {{ item.required ? '필수 학습' : '선택 학습' }}
      </p>
      <p v-if="c.passScore">객관식 합격 기준 {{ c.passScore }}%</p>
      <article v-for="q in c.questions" :key="q.id">
        <h3>{{ q.prompt }}</h3>
        <ol>
          <li v-for="(choice, index) in q.choices" :key="index">
            {{ choice }}{{ q.correct === index ? ' · 정답' : '' }}
          </li>
        </ol>
      </article>
      <p v-if="c.practicalPassScore">상황 대응 합격 기준 {{ c.practicalPassScore }}%</p>
      <article v-for="q in c.practicalQuestions" :key="q.id">
        <p>{{ q.scenario }}</p>
        <h3>{{ q.prompt }}</h3>
        <ol>
          <li v-for="(choice, i) in q.choices" :key="i">
            {{ choice }}{{ q.correct === i ? ' · 정답' : '' }}
          </li>
        </ol>
      </article>
    </details>
  </section>
  <section v-else-if="tab === 'notices'" class="system-records">
    <p
      v-if="!store.data.notices.some((n) => n.scope === 'team' && matches(n.lv1OrganizationId))"
      class="empty-state"
    >
      공지가 없습니다.
    </p>
    <article
      v-for="n in store.data.notices.filter(
        (n) => n.scope === 'team' && matches(n.lv1OrganizationId),
      )"
      :key="n.id"
      class="panel record-detail"
    >
      <h2>{{ n.title }}</h2>
      <p class="muted">
        {{ n.scope === 'team' ? rootName(n.lv1OrganizationId) : '시스템 공지' }} ·
        {{ n.published ? '게시' : '비공개' }}
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
