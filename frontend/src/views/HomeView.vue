<script setup lang="ts">
import { managementTitle } from '../management-navigation';
import AuditorLearning from '../components/AuditorLearning.vue';
import PageHeading from '../components/PageHeading.vue';
import HomeNotices from '../components/HomeNotices.vue';
import HomeQualificationCarousel from '../components/HomeQualificationCarousel.vue';
import { computed, ref } from 'vue';
import CompactTabs from '../components/CompactTabs.vue';
import { useHomeRole } from '../composables/useHomeRole';
import { useProcessContext } from '../composables/useProcessContext';
import { useHomeSummary } from '../composables/useHomeSummary';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import HomeRecentNotifications from '../components/HomeRecentNotifications.vue';
import { certificationStatus } from '@eks/contracts';
const store = useDemo();
const { items: homeRoles, selected: homeRole, select: selectHome } = useHomeRole();
useProcessContext(() => `home-${homeRole.value}`);
const summary = useHomeSummary(homeRole);
const personalHome = computed(() => ['learner', 'evaluator'].includes(homeRole.value));
const personalType = computed(() => (homeRole.value === 'evaluator' ? 'auditor' : 'auditee'));
const personalAssignments = computed(() =>
  store.myAssignments.filter(
    (a) => store.qualification(a.qualificationId).qualificationType === personalType.value,
  ),
);
const personalLink = (path: string) =>
  personalType.value === 'auditor' ? `${path}${path.includes('?') ? '&' : '?'}type=auditor` : path;
const roleTabs = ref<InstanceType<typeof CompactTabs>>();
const multipleRoles = computed(() => homeRoles.value.length > 1);
const homeLabel = computed(
  () => homeRoles.value.find((item) => item.id === homeRole.value)?.label || '홈',
);
const panelLabel = computed(() =>
  multipleRoles.value ? roleTabs.value?.tabId(homeRole.value) : undefined,
);
const managementName = computed(
  () =>
    summary.data.value?.snapshot.scope.organizationName ||
    store.actor.organizationPath.find(
      (p) =>
        p.id ===
        (homeRole.value === 'admin' ? store.actor.lv1OrganizationId : store.actor.organizationId),
    )?.name ||
    '담당 조직',
);
const active = computed(() =>
  personalAssignments.value.filter((a) => !a.certifiedAt && !a.acquisitionClosedAt),
);
const planningRequests = computed(() => {
  const actor = store.actor;
  if (!personalHome.value || actor.certificationEligibility === 'hold' || !actor.organizationActive)
    return [];
  return store.data.planningRequests
    .filter(
      (request) =>
        request.learnerId === actor.id &&
        request.qualificationType === personalType.value &&
        request.organizationId === actor.organizationId &&
        request.lv1OrganizationId === actor.lv1OrganizationId &&
        !request.completion &&
        store.data.planningOptions.find((view) => view.requestId === request.id)?.canComplete !==
          true,
    )
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
});
const eligibleAssignment = (a: { learnerId: string; acquisitionClosedAt?: string }) =>
  !a.acquisitionClosedAt &&
  store.data.users.find((u) => u.id === a.learnerId)?.certificationEligibility !== 'hold';
const attention = computed(() => [
  {
    label: '자격 설정 필요',
    count: store.data.qualifications.filter(
      (q) =>
        q.lv1OrganizationId === store.actor.lv1OrganizationId &&
        !q.deletedAt &&
        store.qualificationErrors(q).length > 0,
    ).length,
    to: summary.link('/admin/qualifications'),
  },
  {
    label: '인증Set 설정 필요',
    count: store.data.courses.filter(
      (c) =>
        c.lv1OrganizationId === store.actor.lv1OrganizationId &&
        !c.deletedAt &&
        store.courseErrors(c).length > 0,
    ).length,
    to: summary.link('/admin/courses'),
  },
]);
const stats = computed(() =>
  personalHome.value
    ? [
        {
          label: '진행 중인 자격',
          value: active.value.length,
          icon: 'book',
          to: personalLink('/qualifications'),
        },
        {
          label: '수료 인증Set',
          value: personalAssignments.value.reduce((n, a) => n + store.completedCount(a), 0),
          icon: 'check',
          to: personalLink('/qualifications'),
        },
        {
          label: '현재 유효한 자격',
          value: personalAssignments.value.filter(
            (a) =>
              a.certification &&
              ['valid', 'expiring'].includes(certificationStatus(a.certification)),
          ).length,
          icon: 'award',
          to: personalLink('/qualifications?filter=certified'),
        },
      ]
    : homeRole.value === 'system_operator'
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
      : summary.data.value
        ? [
            {
              label:
                homeRole.value === 'organization_admin' ? '직속 취득 대상 인원' : '취득 대상 인원',
              value: summary.data.value.summary.eligiblePeople,
              icon: 'users',
              to: summary.link('/admin/dashboard', { tab: 'members' }),
            },
            {
              label: '계획 기한 경과',
              value: summary.data.value.summary.overdueRequests,
              icon: 'clipboard',
              to: summary.link('/admin/dashboard', { metric: 'overdueRequests' }),
            },
          ]
        : [],
);
</script>
<template>
  <div class="container home-page">
    <section class="home-hero" aria-labelledby="home-person-title">
      <PageHeading class="page-heading home-heading">
        <div>
          <h1 id="home-person-title">{{ store.actor.name }} 님</h1>
          <span v-if="personalHome && !multipleRoles" class="home-personal-type">{{
            homeLabel
          }}</span>
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
            timeZone: 'Asia/Seoul',
          }).format(new Date())
        }}</span>
      </PageHeading>
      <div v-if="multipleRoles" class="home-role-tabs">
        <CompactTabs
          ref="roleTabs"
          :items="homeRoles"
          :model-value="homeRole"
          label="홈 보기"
          panel-id="home-role-summary home-role-content"
          @update:model-value="selectHome"
        />
      </div>
      <div
        id="home-role-summary"
        :role="multipleRoles ? 'tabpanel' : undefined"
        :aria-labelledby="panelLabel"
      >
        <p v-if="summary.managed.value" class="home-scope">
          <strong>{{ managementName }}</strong> ·
          {{ homeRole === 'organization_admin' ? '직속 인원 기준' : '팀 전체 기준' }}
          <span v-if="summary.data.value">
            · Hold 제외 {{ summary.data.value.snapshot.exclusions.heldPeople }}명</span
          >
        </p>
        <p v-if="summary.loading.value" class="home-summary-status" role="status">
          관리 현황을 불러오는 중입니다.
        </p>
        <div v-else-if="summary.error.value" class="home-summary-status" role="alert">
          <p>{{ summary.error.value }}</p>
          <button class="button secondary" @click="summary.load">현황 다시 조회</button>
        </div>
        <section
          v-if="stats.length"
          class="stats-panel"
          :aria-label="personalHome ? '내 현황' : `${homeLabel} 현황`"
        >
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
      </div>
    </section>
    <div
      id="home-role-content"
      :role="multipleRoles ? 'tabpanel' : undefined"
      :aria-labelledby="panelLabel"
    >
      <p
        v-if="personalHome && store.actor.certificationEligibility === 'hold'"
        class="error-message"
      >
        취득 대상자 Hold · 취득·재인증과 대상자 통계에서 제외됩니다. 보유 자격 효력과 만료일은
        별도로 유지됩니다.
      </p>
      <nav v-if="summary.managed.value" class="home-shortcuts" aria-label="업무 바로가기">
        <template v-if="summary.managed.value">
          <RouterLink :to="summary.link('/admin/dashboard')" class="text-link"
            >인증 현황<AppIcon name="chevron" :size="16"
          /></RouterLink>
          <RouterLink
            v-if="homeRole === 'admin'"
            :to="summary.link('/admin/qualifications')"
            class="text-link"
            >{{ managementTitle('qualifications') }}<AppIcon name="chevron" :size="16"
          /></RouterLink>
          <RouterLink v-else :to="summary.link('/admin/organization-settings')" class="text-link"
            >{{ managementTitle('organization-settings') }}<AppIcon name="chevron" :size="16"
          /></RouterLink>
        </template>
      </nav>
      <div class="home-columns" :class="{ 'home-columns--learning': personalHome }">
        <div class="home-primary">
          <AuditorLearning v-if="personalHome && personalType === 'auditor'" />
          <HomeQualificationCarousel
            v-else-if="personalHome"
            :key="`${store.actorId}:${personalType}`"
            :qualification-type="personalType"
            :assignments="active"
            :planning-requests="planningRequests"
          />
          <section v-if="!personalHome" class="home-card">
            <div class="section-heading">
              <h2>
                {{
                  homeRole === 'system_operator'
                    ? '시스템 운영'
                    : homeRole === 'organization_admin'
                      ? '조직 관리'
                      : '기준 관리'
                }}
              </h2>
              <RouterLink
                :to="
                  homeRole === 'system_operator'
                    ? '/system/overview'
                    : summary.link(
                        homeRole === 'admin'
                          ? '/admin/qualifications'
                          : '/admin/organization-settings',
                      )
                "
                class="text-link"
                >전체 보기<AppIcon name="chevron" :size="16"
              /></RouterLink>
            </div>
            <template v-if="homeRole === 'system_operator'"
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
            <template v-else-if="homeRole === 'admin'"
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
              ><RouterLink :to="summary.link('/admin/assignments')" class="simple-row"
                >계획 요청·진행<AppIcon name="chevron" /></RouterLink
            ></template>
            <template v-else>
              <RouterLink :to="summary.link('/admin/dashboard')" class="simple-row"
                >인증 현황<AppIcon name="chevron"
              /></RouterLink>
              <RouterLink :to="summary.link('/admin/organization-settings')" class="simple-row"
                >조직 정보·필요자격<AppIcon name="chevron"
              /></RouterLink>
              <RouterLink :to="summary.link('/admin/targets')" class="simple-row"
                >취득 대상자 상태<AppIcon name="chevron"
              /></RouterLink>
            </template>
          </section>
        </div>
        <aside class="home-secondary">
          <HomeRecentNotifications />
        </aside>
      </div>
      <HomeNotices />
    </div>
  </div>
</template>
