<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import AppDialog from '../components/AppDialog.vue';
import type { Notice } from '../types';
import PersonalTasks from '../components/PersonalTasks.vue';
import { certificationStatus, kindLabels } from '@eks/contracts';
const store = useDemo();
const notice = ref<Notice | null>(null);
const active = computed(() => store.myAssignments.filter((a) => !a.certifiedAt));
const upcoming = computed(() =>
  store.data.plans
    .filter((p) => p.learnerId === store.actorId && p.targetOn)
    .sort((a, b) => a.targetOn.localeCompare(b.targetOn))
    .slice(0, 2),
);
const attention = computed(() => [
  {
    label: '기준 준비',
    detail: '미완성 기준을 보완하고 사용 등록하세요.',
    count: store.data.qualifications.filter((q) => q.status === 'draft').length,
    to: '/admin/qualifications',
  },
  {
    label: 'FT 배정',
    detail: '주관식·실기 진행을 위해 평가자를 지정하세요.',
    count: store.data.assignments.filter((a) => !a.ftId && !a.certifiedAt && !a.excludedReason)
      .length,
    to: '/admin/assignments',
  },
  {
    label: '계획 기한',
    detail: '기한이 지난 계획 요청을 확인하세요.',
    count: store.data.planningRequests.filter(
      (r) =>
        r.dueOn < new Date().toISOString().slice(0, 10) &&
        !store.data.plans.some((p) => p.requestId === r.id && p.status === 'completed'),
    ).length,
    to: '/admin/assignments',
  },
]);
const waiting = computed(() =>
  store.ftAssignments.flatMap((a) =>
    a.enrollments.flatMap((e) =>
      (['subjective', 'practical'] as const)
        .filter((kind) => e[kind] === 'waiting')
        .map((kind) => ({ a, e, kind })),
    ),
  ),
);
const stats = computed(() =>
  store.actor.role === 'learner'
    ? [
        {
          label: '진행 중인 자격',
          value: active.value.length,
          icon: 'book',
          to: '/qualifications',
        },
        {
          label: '수료 과정',
          value: store.myAssignments.reduce((n, a) => n + store.completedCount(a), 0),
          icon: 'check',
          to: '/qualifications',
        },
        {
          label: '현재 유효한 자격',
          value: store.myAssignments.filter(
            (a) =>
              a.certification &&
              ['valid', 'expiring'].includes(certificationStatus(a.certification)),
          ).length,
          icon: 'award',
          to: '/qualifications?filter=certified',
        },
      ]
    : store.actor.role === 'ft'
      ? [
          { label: '평가 대기', value: waiting.value.length, icon: 'clock', to: '/evaluations' },
          {
            label: '담당 과정',
            value: store.ftAssignments.reduce((n, a) => n + a.enrollments.length, 0),
            icon: 'book',
            to: '/evaluations',
          },
          {
            label: '확정한 평가',
            value: store.ftAssignments.reduce(
              (n, a) =>
                n +
                a.enrollments.flatMap((e) =>
                  e.history.filter((h) => h.evaluatorId === store.actorId),
                ).length,
              0,
            ),
            icon: 'check',
            to: '/evaluations?filter=done',
          },
        ]
      : store.actor.role === 'system_operator'
        ? [
            {
              label: 'Lv1 조직',
              value: store.data.organizations.filter((o) => o.level === 1).length,
              icon: 'users',
              to: '/system/organizations',
            },
            {
              label: '등록 사용자',
              value: store.data.users.length,
              icon: 'users',
              to: '/system/users',
            },
            {
              label: '진행 중인 배정',
              value: store.data.assignments.filter((a) => !a.certifiedAt && !a.excludedReason)
                .length,
              icon: 'clipboard',
              to: '/system/overview',
            },
          ]
        : [
            {
              label: '자격 초안',
              value: store.data.qualifications.filter((q) => q.status === 'draft').length,
              icon: 'file',
              to: '/admin/qualifications',
            },
            {
              label: '과정 초안',
              value: store.data.courses.filter((c) => c.status === 'draft').length,
              icon: 'book',
              to: '/admin/courses',
            },
            {
              label: '진행 중인 배정',
              value: store.data.assignments.filter((a) => !a.certifiedAt && !a.excludedReason)
                .length,
              icon: 'users',
              to: '/admin/assignments',
            },
          ],
);
</script>
<template>
  <div class="container home-page">
    <div class="page-heading home-heading">
      <div>
        <span class="eyebrow">{{
          store.actor.role === 'learner'
            ? 'MY CERTIFICATION'
            : store.actor.role === 'ft'
              ? 'EVALUATION WORKSPACE'
              : 'OPERATIONS WORKSPACE'
        }}</span>
        <h1>{{ store.actor.name }} 님</h1>
        <p class="muted organization-path">
          {{ store.actor.organizationPath.map((p) => p.name).join(' › ') }}
        </p>
      </div>
      <span class="muted home-date">{{
        new Intl.DateTimeFormat('ko-KR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        }).format(new Date())
      }}</span>
    </div>
    <section class="stats-panel" aria-label="내 현황">
      <RouterLink v-for="stat in stats" :key="stat.label" :to="stat.to" class="stat-item"
        ><div class="stat-top">
          <span>{{ stat.label }}</span
          ><AppIcon :name="stat.icon" />
        </div>
        <div class="stat-bottom">
          <span class="stat-value">{{ stat.value.toString().padStart(2, '0') }}</span
          ><AppIcon name="diagonal" :size="18" /></div
      ></RouterLink>
    </section>
    <div class="home-columns">
      <div class="home-primary">
        <PersonalTasks />
        <section class="home-card">
          <div class="section-heading">
            <h2>
              {{
                store.actor.role === 'learner'
                  ? '진행 중인 자격'
                  : store.actor.role === 'ft'
                    ? '평가 요청'
                    : store.actor.role === 'system_operator'
                      ? '시스템 운영'
                      : '기준 관리'
              }}
            </h2>
            <RouterLink
              :to="
                store.actor.role === 'learner'
                  ? '/qualifications'
                  : store.actor.role === 'ft'
                    ? '/evaluations'
                    : '/admin/qualifications'
              "
              class="text-link"
              >전체 보기<AppIcon name="chevron" :size="16"
            /></RouterLink>
          </div>
          <template v-if="store.actor.role === 'learner' && active.length">
            <div class="home-current">
              <span class="small-label">필수 과정 {{ active[0]!.enrollments.length }}개</span>
              <h3>{{ store.qualification(active[0]!.qualificationId).title }}</h3>
              <div class="progress-label">
                <span>과정 수료</span
                ><span
                  >{{ store.completedCount(active[0]!) }} /
                  {{ active[0]!.enrollments.length }}</span
                >
              </div>
              <div class="progress-track">
                <span
                  :style="{
                    width: `${(store.completedCount(active[0]!) / active[0]!.enrollments.length) * 100}%`,
                  }"
                ></span>
              </div>
              <div class="home-card-bottom">
                <span class="muted"
                  >평가 {{ store.passedCount(active[0]!) }} /
                  {{ store.assessmentCount(active[0]!) }} 통과</span
                ><RouterLink :to="`/qualifications/${active[0]!.id}`" class="button primary"
                  >이어서 진행<AppIcon name="arrow" :size="18"
                /></RouterLink>
              </div>
            </div>
          </template>
          <div v-else-if="store.actor.role === 'learner'" class="empty-state">
            <AppIcon name="book" :size="28" /><span>진행 중인 자격이 없습니다.</span
            ><RouterLink
              v-if="store.myAssignments.some((a) => a.certifiedAt)"
              class="button secondary"
              to="/qualifications?filter=certified"
              >인증 보기</RouterLink
            >
            <RouterLink to="/plans" class="button primary">내 계획 확인</RouterLink>
          </div>
          <template v-else-if="store.actor.role === 'ft'"
            ><RouterLink
              v-for="item in waiting.slice(0, 3)"
              :key="item.a.id + item.e.courseId + item.kind"
              :to="`/evaluations/${item.a.id}/${item.e.courseId}${item.kind === 'subjective' ? '/subjective' : ''}`"
              class="simple-row"
              ><span
                ><strong>{{ store.username(item.a.learnerId) }}</strong
                ><small
                  >{{ store.course(item.e.courseId).title }} · {{ kindLabels[item.kind] }}</small
                ></span
              ><AppIcon name="chevron"
            /></RouterLink>
            <div v-if="!waiting.length" class="empty-state">
              <AppIcon name="check" :size="28" /><span>대기 중인 평가가 없습니다.</span>
            </div></template
          >
          <template v-else-if="store.actor.role === 'system_operator'"
            ><label class="field home-org-select"
              >관리할 Lv1 조직<select
                aria-label="홈 관리할 Lv1 조직"
                @change="
                  $router.push(
                    store.managementLink(
                      '/admin/qualifications',
                      ($event.target as HTMLSelectElement).value,
                    ),
                  )
                "
              >
                <option value="" disabled selected>조직을 선택해 인증 업무 관리</option>
                <option
                  v-for="o in store.data.organizations.filter((o) => o.level === 1)"
                  :key="o.id"
                  :value="o.id"
                >
                  {{ o.name }}
                </option>
              </select></label
            ><RouterLink to="/system/organizations" class="simple-row"
              >조직 트리 관리<AppIcon name="chevron" /></RouterLink
            ><RouterLink to="/system/users" class="simple-row"
              >사용자 소속·역할 관리<AppIcon name="chevron" /></RouterLink
            ><RouterLink to="/system/overview" class="simple-row"
              >전체 조직 업무 조회<AppIcon name="chevron" /></RouterLink
          ></template>
          <template v-else
            ><RouterLink
              v-for="item in attention"
              :key="item.label"
              :to="item.to"
              class="simple-row"
              ><span
                ><strong
                  >{{ item.label }} <span class="home-count">{{ item.count }}</span></strong
                ><small>{{ item.detail }}</small></span
              ><AppIcon name="chevron" /></RouterLink
          ></template>
        </section>
        <div class="home-journey" aria-label="자격 인증 절차">
          <span><b>01</b> 개인 계획</span><i>→</i><span><b>02</b> 학습·평가</span><i>→</i
          ><span><b>03</b> 수료·인증</span><i>→</i><span><b>04</b> 유효성 확인</span>
        </div>
      </div>
      <aside class="home-secondary">
        <section v-if="store.actor.role === 'learner'" class="home-card focus-card">
          <span class="eyebrow">YOUR NEXT MILESTONE</span>
          <h2>나의 인증 일정</h2>
          <template v-if="upcoming.length"
            ><RouterLink v-for="p in upcoming" :key="p.id" :to="`/plans/${p.id}`" class="simple-row"
              ><span
                ><strong>{{ store.qualification(p.qualificationId).title }}</strong
                ><small
                  >목표 인증일 {{ p.targetOn }} ·
                  {{ p.status === 'draft' ? '계획 작성 중' : '계획 완료' }}</small
                ></span
              ><AppIcon name="chevron" :size="16" /></RouterLink></template
          ><template v-else
            ><p>목표를 정하면 다음 단계가 보입니다.</p>
            <RouterLink to="/plans" class="text-link"
              >개인 인증 계획 살펴보기 →</RouterLink
            ></template
          >
        </section>
        <section v-else class="home-card focus-card">
          <span class="eyebrow">{{
            store.actor.role === 'ft' ? 'REVIEW WITH EVIDENCE' : 'CATALOG WORKSPACE'
          }}</span>
          <h2>{{ store.actor.role === 'ft' ? '근거로 판단하는 평가' : '기준을 한눈에 관리' }}</h2>
          <p>
            {{
              store.actor.role === 'ft'
                ? '학습자의 목표와 답안을 확인하고 지정된 평가를 확정하세요.'
                : '자격·과정·문항을 Excel 또는 웹 표에서 함께 준비하세요.'
            }}
          </p>
          <RouterLink
            :to="
              store.actor.role === 'ft' ? '/evaluations' : store.managementLink('/admin/catalog')
            "
            class="text-link"
            >{{
              store.actor.role === 'ft' ? '평가 대기 확인' : '기준 일괄 관리 열기'
            }}
            →</RouterLink
          >
        </section>
        <section class="home-card notice-card">
          <div class="section-heading">
            <h2>공지사항</h2>
            <AppIcon name="notice" :size="20" />
          </div>
          <button
            v-for="n in store.notices.slice(0, 3)"
            :key="n.id"
            class="notice-row"
            @click="notice = n"
          >
            <span
              >{{ n.title }}<time>{{ n.date.replaceAll('-', '.') }}</time></span
            ><AppIcon name="chevron" :size="16" />
          </button>
          <p v-if="!store.notices.length" class="empty-state">등록된 공지가 없습니다.</p>
        </section>
      </aside>
    </div>
    <AppDialog :open="!!notice" :title="notice?.title || '공지사항'" @update:open="notice = null"
      ><time class="muted">{{ notice?.date }}</time>
      <p class="notice-body">{{ notice?.body }}</p></AppDialog
    >
  </div>
</template>
