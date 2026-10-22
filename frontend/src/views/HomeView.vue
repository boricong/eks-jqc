<script setup lang="ts">
import PageHeading from '../components/PageHeading.vue';
import HomeNotices from '../components/HomeNotices.vue';
import { computed } from 'vue';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import PersonalTasks from '../components/PersonalTasks.vue';
import RequiredQualifications from '../components/RequiredQualifications.vue';
import {
  certificationStatus,
  kindLabels,
  latestPeriod,
  renewalOpensOn,
  credentialCurrent,
} from '@eks/contracts';
const store = useDemo();
const active = computed(() =>
  store.myAssignments.filter((a) => !a.certifiedAt && !a.acquisitionClosedAt),
);
const renewables = computed(() =>
  store.actor.certificationEligibility === 'hold'
    ? []
    : store.myAssignments
        .filter(
          (a) =>
            a.certification &&
            latestPeriod(a.certification) &&
            renewalOpensOn(latestPeriod(a.certification)!) &&
            ['valid', 'expiring'].includes(certificationStatus(a.certification)),
        )
        .slice(0, 3),
);
const eligibleAssignment = (a: { learnerId: string; acquisitionClosedAt?: string }) =>
  !a.acquisitionClosedAt &&
  store.data.users.find((u) => u.id === a.learnerId)?.certificationEligibility !== 'hold';
const upcoming = computed(() =>
  store.data.plans
    .filter((p) => p.learnerId === store.actorId && p.targetOn)
    .sort((a, b) => a.targetOn.localeCompare(b.targetOn))
    .slice(0, 2),
);
const attention = computed(() => [
  {
    label: '기준 준비',
    count: store.data.qualifications.filter(
      (q) => !q.deletedAt && store.qualificationErrors(q).length > 0,
    ).length,
    to: '/admin/qualifications',
  },
  {
    label: '계획 기한',
    count: store.data.planningRequests.filter(
      (r) =>
        r.dueOn < new Date().toISOString().slice(0, 10) &&
        !['계획 완료', '현재 대상 없음'].includes(
          store.data.requestProgress.find((p) => p.id === r.id)?.stage || '',
        ),
    ).length,
    to: '/admin/assignments',
  },
]);
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
          label: '수료 인증Set',
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
            value: store.data.assignments.filter(
              (a) => !a.certifiedAt && !a.excludedReason && eligibleAssignment(a),
            ).length,
            icon: 'clipboard',
            to: '/system/overview',
          },
        ]
      : [
          {
            label: '자격 설정 필요',
            value: store.data.qualifications.filter(
              (q) => !q.deletedAt && store.qualificationErrors(q).length > 0,
            ).length,
            icon: 'file',
            to: '/admin/qualifications',
          },
          {
            label: '인증Set 설정 필요',
            value: store.data.courses.filter((c) => store.courseErrors(c).length > 0).length,
            icon: 'book',
            to: '/admin/courses',
          },
          {
            label: '진행 중인 배정',
            value: store.data.assignments.filter(
              (a) => !a.certifiedAt && !a.excludedReason && eligibleAssignment(a),
            ).length,
            icon: 'users',
            to: '/admin/assignments',
          },
        ],
);
</script>
<template>
  <div class="container home-page">
    <PageHeading class="page-heading home-heading">
      <div>
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
    </PageHeading>
    <p v-if="store.actor.certificationEligibility === 'hold'" class="error-message">
      취득 대상자 Hold · 취득·재인증과 대상자 통계에서 제외됩니다. 보유 자격 효력과 만료일은 별도로
      유지됩니다.
    </p>
    <p v-if="store.fullManagement" class="muted">
      {{
        store.data.eligibilitySummary.eligible
          ? `취득 대상 ${store.data.eligibilitySummary.eligible}명`
          : '취득 대상 없음'
      }}
      · Hold 제외 {{ store.data.eligibilitySummary.held }}명
    </p>
    <section class="stats-panel" aria-label="내 현황">
      <RouterLink v-for="stat in stats" :key="stat.label" :to="stat.to" class="stat-item"
        ><div class="stat-top">
          <span>{{ stat.label }}</span
          ><AppIcon :name="stat.icon" />
        </div>
        <div class="stat-bottom">
          <span class="stat-value">{{ stat.value }}</span
          ><AppIcon name="diagonal" :size="18" /></div
      ></RouterLink>
    </section>
    <nav class="home-shortcuts" aria-label="업무 바로가기">
      <RouterLink v-if="store.hasRole('learner')" to="/plans" class="text-link"
        >내 계획<AppIcon name="chevron" :size="16"
      /></RouterLink>
      <RouterLink
        v-if="store.fullManagement"
        :to="store.managementLink('/admin/catalog')"
        class="text-link"
        >기준 일괄 관리<AppIcon name="chevron" :size="16"
      /></RouterLink>
      <RouterLink v-if="store.hasRole('organization_admin')" to="/admin/policies" class="text-link"
        >조직별 자격 설정<AppIcon name="chevron" :size="16"
      /></RouterLink>
    </nav>
    <div class="home-columns">
      <div class="home-primary">
        <RequiredQualifications v-if="store.hasRole('learner')" />
        <PersonalTasks />
        <section v-if="renewables.length" class="home-card lifecycle-panel">
          <div class="section-heading"><h2>보유 자격 · 재인증</h2></div>
          <RouterLink
            v-for="a in renewables"
            :key="a.id"
            class="lifecycle-renewal-link"
            :to="`/certifications/${a.id}`"
            ><strong>{{ store.qualification(a.qualificationId).title }}</strong
            ><span
              >재인증 시작 {{ renewalOpensOn(latestPeriod(a.certification!)!) }} · 만료
              {{ credentialCurrent(a.certification!).expiresOn }}</span
            ><span class="text-link">상태·재인증 확인 →</span></RouterLink
          >
        </section>
        <section class="home-card">
          <div class="section-heading">
            <h2>
              {{
                store.actor.role === 'learner'
                  ? '진행 중인 자격'
                  : store.actor.role === 'system_operator'
                    ? '시스템 운영'
                    : '기준 관리'
              }}
            </h2>
            <RouterLink
              :to="
                store.actor.role === 'learner'
                  ? '/qualifications'
                  : store.actor.role === 'system_operator'
                    ? '/system/overview'
                    : '/admin/qualifications'
              "
              class="text-link"
              >전체 보기<AppIcon name="chevron" :size="16"
            /></RouterLink>
          </div>
          <template v-if="store.actor.role === 'learner' && active.length">
            <div class="home-current">
              <span class="small-label">필수 인증Set {{ active[0]!.enrollments.length }}개</span>
              <h3>{{ store.qualification(active[0]!.qualificationId).title }}</h3>
              <div class="progress-label">
                <span>인증Set 수료</span
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
                ></span
              ><AppIcon name="chevron" /></RouterLink
          ></template>
        </section>
      </div>
      <aside class="home-secondary">
        <HomeNotices />
        <section v-if="upcoming.length" class="home-card">
          <h2>나의 인증 일정</h2>
          <RouterLink v-for="p in upcoming" :key="p.id" :to="`/plans/${p.id}`" class="simple-row">
            <span
              ><strong>{{ store.qualification(p.qualificationId).title }}</strong
              ><small
                >목표 인증일 {{ p.targetOn }} ·
                {{ p.status === 'draft' ? '계획 작성 중' : '계획 완료' }}</small
              ></span
            >
            <AppIcon name="chevron" :size="16" />
          </RouterLink>
        </section>
      </aside>
    </div>
  </div>
</template>
