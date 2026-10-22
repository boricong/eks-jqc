<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type {
  DashboardMetric,
  DashboardOrganizationRow,
  DashboardQualificationCell,
} from '@eks/contracts';
import PageHeading from '../components/PageHeading.vue';
import CompactTabs from '../components/CompactTabs.vue';
import DashboardMetricCard from '../components/dashboard/DashboardMetric.vue';
import DashboardRatio from '../components/dashboard/DashboardRatio.vue';
import DashboardPager from '../components/dashboard/DashboardPager.vue';
import DashboardMemberPanel from '../components/dashboard/DashboardMemberPanel.vue';
import DashboardDetailsDialog from '../components/dashboard/DashboardDetailsDialog.vue';
import {
  dashboardTabs,
  efficacyLabels,
  progressLabels,
  renewalLabels,
  metricLabels,
  scheduleLabels,
  displayTime,
} from '../components/dashboard/labels';
import { useDashboard } from '../composables/useDashboard';
import '../styles/dashboard.css';

const route = useRoute(),
  router = useRouter();
const {
  store,
  data,
  options,
  loading,
  error,
  stale,
  changed,
  details,
  member,
  detailLoading,
  detailError,
  density,
  tab,
  matrix,
  query,
  detailMetric,
  memberId,
  detailEntityId,
  ready,
  load,
  loadDetail,
  update,
  changeTab,
  setDensity,
  setPageSize,
  openMetric,
  openMember,
  closeDetail,
  restoreFocus,
} = useDashboard();
const tabs = computed(() =>
  dashboardTabs.filter((t) => t.id !== 'organizations' || store.fullManagement),
);
const tabControl = ref<InstanceType<typeof CompactTabs>>();
const search = ref('');
watch(
  () => query.value.search,
  (value) => {
    search.value = value || '';
  },
  { immediate: true },
);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
function searchChanged() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void update({ search: search.value });
  }, 300);
}
onBeforeUnmount(() => clearTimeout(searchTimer));
const currentPage = computed(() =>
  !data.value
    ? null
    : matrix.value
      ? data.value.matrix.members
      : tab.value === 'summary'
        ? null
        : data.value[tab.value],
);
const sortValue = computed(() => `${query.value.sort || 'name'}:${query.value.order || 'asc'}`);
const sortOptions = computed(() => [
  { value: 'name:asc', label: '이름 오름차순' },
  { value: 'name:desc', label: '이름 내림차순' },
  ...(tab.value === 'organizations' || tab.value === 'qualifications'
    ? [
        { value: 'coverage:asc', label: '필수 충족률 낮은 순' },
        { value: 'coverage:desc', label: '필수 충족률 높은 순' },
      ]
    : []),
  ...(tab.value === 'members' ? [{ value: 'organization:asc', label: '조직·이름 순' }] : []),
  ...(tab.value === 'renewals'
    ? [
        { value: 'expiresOn:asc', label: '만료일 빠른 순' },
        { value: 'expiresOn:desc', label: '만료일 늦은 순' },
      ]
    : []),
]);
const sortChanged = (event: Event) => {
  const [sort, order] = (event.target as HTMLSelectElement).value.split(':');
  void update({ sort, order });
};
const valueOf = (event: Event) => (event.target as HTMLSelectElement).value;
const summaryMetrics = computed(() => {
  const s = data.value?.summary;
  if (!s) return [];
  return [
    { metric: 'eligiblePeople', label: '대상 인원', value: s.eligiblePeople, unit: '명' },
    {
      metric: 'requiredCoverage',
      label: '필수 자격 충족률',
      value: s.requiredCoverage.rate === null ? '—' : `${s.requiredCoverage.rate.toFixed(1)}%`,
      note: s.requiredCoverage.total
        ? `${s.requiredCoverage.fulfilled} / ${s.requiredCoverage.total} 사람·자격`
        : '필수 자격 없음',
    },
    {
      metric: 'uniqueActiveHolders',
      label: '유효 자격 보유 인원',
      value: s.uniqueActiveHolders,
      unit: '명',
    },
    {
      metric: 'inProgress',
      label: '취득 진행',
      value: s.inProgress,
      unit: '건',
      note: '사람·자격·취득 회차',
    },
    {
      metric: 'incompleteRequests',
      label: '미완료 계획 요청',
      value: s.incompleteRequests,
      unit: '건',
    },
    {
      metric: 'expires0to30',
      label: '30일 내 만료',
      value: s.expires0to30,
      unit: '건',
      note: '인증 기준',
    },
  ] as {
    metric: DashboardMetric;
    label: string;
    value: string | number;
    unit?: string;
    note?: string;
  }[];
});
const alerts = computed(() =>
  !data.value
    ? []
    : [
        { metric: 'requiredMissing' as const, count: data.value.summary.requiredMissing },
        { metric: 'blockedProgress' as const, count: data.value.summary.blockedProgress },
        { metric: 'overdueRequests' as const, count: data.value.summary.overdueRequests },
        { metric: 'overdueTargets' as const, count: data.value.summary.overdueTargets },
        { metric: 'overdueAssessments' as const, count: data.value.summary.overdueAssessments },
      ],
);
const scopeText = computed(
  () => data.value?.snapshot.scope.organizationPath.map((p) => p.name).join(' / ') || '',
);
async function organizationMembers(row: DashboardOrganizationRow) {
  await router.push({
    query: {
      lv1OrganizationId: store.managementLv1,
      tab: 'members',
      organizationId: row.organizationId,
      includeDescendants: String(!row.direct),
    },
  });
}
async function qualificationMembers(entityId: string) {
  await router.push({
    query: {
      lv1OrganizationId: store.managementLv1,
      tab: 'members',
      organizationId: query.value.organizationId,
      includeDescendants: String(query.value.includeDescendants),
      entityId,
    },
  });
}
const cellSummary = (cell: DashboardQualificationCell) =>
  [
    efficacyLabels[cell.efficacy],
    cell.progress !== 'none' ? progressLabels[cell.progress] : '',
    cell.renewalState === 'in_progress' ? '재인증 진행' : '',
  ]
    .filter(Boolean)
    .join(' · ');
function detailPage(page: number) {
  void router.replace({ query: { ...route.query, detailPage: String(page) } });
}
</script>

<template>
  <section class="dashboard-page dashboard-view" aria-label="인증 현황">
    <PageHeading>
      <h1>인증 현황</h1>
      <div class="dashboard-heading-actions">
        <span v-if="data" class="dashboard-meta">{{ displayTime(data.snapshot.asOf) }} 기준</span
        ><button class="button secondary" :disabled="loading || !ready" @click="load()">
          새로고침
        </button>
      </div>
    </PageHeading>
    <p v-if="!ready" class="dashboard-empty">조회할 Lv1 조직을 선택해 주세요.</p>
    <template v-else>
      <div v-if="options" class="dashboard-scope">
        <template v-if="!options.snapshot.scope.directOnly">
          <label class="field"
            ><span>조회 조직</span
            ><select
              aria-label="조회 조직"
              :value="query.organizationId"
              @change="update({ organizationId: valueOf($event) })"
            >
              <option v-for="org in options.organizations" :key="org.id" :value="org.id">
                {{ org.path.map((p) => p.name).join(' / ') }}{{ org.active ? '' : ' · 사용 중지' }}
              </option>
            </select></label
          >
          <label class="field"
            ><span>조회 범위</span
            ><select
              aria-label="하위 조직 포함"
              :value="String(query.includeDescendants)"
              @change="update({ includeDescendants: valueOf($event) })"
            >
              <option value="true">하위 조직 포함</option>
              <option value="false">직접 소속만</option>
            </select></label
          >
        </template>
        <p v-else class="dashboard-scope-fixed">
          <strong>{{
            options.snapshot.scope.organizationPath.map((p) => p.name).join(' / ')
          }}</strong
          ><span class="dashboard-meta">직접 소속만</span>
        </p>
      </div>
      <CompactTabs
        ref="tabControl"
        :items="tabs"
        :model-value="tab"
        label="인증 현황 보기"
        panel-id="dashboard-tab-panel"
        @update:model-value="changeTab"
      />
      <div v-if="error" class="dashboard-notice error" role="alert">
        <span
          >{{ error
          }}<small v-if="stale && data" class="dashboard-meta">
            · {{ displayTime(data.snapshot.asOf) }} 조회 결과</small
          ></span
        ><button class="button secondary" :disabled="loading" @click="load()">다시 조회</button>
      </div>
      <p v-if="changed" class="dashboard-notice info" role="status">{{ changed }}</p>
      <section
        id="dashboard-tab-panel"
        role="tabpanel"
        :aria-labelledby="tabControl?.tabId(tab)"
        :aria-busy="loading"
      >
        <div
          v-if="tab === 'qualifications' || tab === 'members' || tab === 'renewals'"
          class="dashboard-filters"
        >
          <label class="field dashboard-filter-wide"
            ><span>{{ tab === 'qualifications' ? '자격 검색' : '구성원 검색' }}</span
            ><input
              v-model="search"
              type="search"
              :aria-label="tab === 'qualifications' ? '자격 검색' : '구성원 검색'"
              :placeholder="tab === 'qualifications' ? '자격명' : '이름'"
              @input="searchChanged"
              @keydown.enter="update({ search })"
          /></label>
          <label v-if="tab === 'qualifications'" class="field"
            ><span>자격 범위</span
            ><select
              aria-label="자격 범위"
              :value="query.qualificationScope"
              @change="update({ qualificationScope: valueOf($event) })"
            >
              <option value="all">전체</option>
              <option value="applied">현재 팀 적용</option>
              <option value="records">기록 보유</option>
            </select></label
          >
          <template v-if="tab === 'members' || tab === 'renewals'">
            <label class="field"
              ><span>조회 자격</span
              ><select
                aria-label="조회 자격"
                :value="query.entityId || ''"
                @change="update({ entityId: valueOf($event) })"
              >
                <option value="">전체 자격</option>
                <option
                  v-for="qualification in options?.qualifications || []"
                  :key="qualification.entityId"
                  :value="qualification.entityId"
                >
                  {{ qualification.title }}{{ qualification.applied ? '' : ' · 현재 미적용' }}
                </option>
              </select></label
            >
            <label class="field"
              ><span>조회 대상</span
              ><select
                aria-label="조회 대상"
                :value="query.population"
                @change="update({ population: valueOf($event) })"
              >
                <option value="eligible">취득 대상</option>
                <option value="excluded">집계 제외</option>
                <option value="all">전체 인원</option>
              </select></label
            >
          </template>
          <template v-if="tab === 'members'">
            <label class="field"
              ><span>필수 여부</span
              ><select
                aria-label="필수 여부"
                :value="query.required"
                @change="update({ required: valueOf($event) })"
              >
                <option value="all">전체</option>
                <option value="required">필수</option>
                <option value="optional">선택</option>
              </select></label
            >
            <label class="field"
              ><span>인증 효력</span
              ><select
                aria-label="인증 효력"
                :value="query.efficacy || ''"
                @change="update({ efficacy: valueOf($event) })"
              >
                <option value="">전체</option>
                <option v-for="(label, status) in efficacyLabels" :key="status" :value="status">
                  {{ label }}
                </option>
              </select></label
            >
            <label class="field"
              ><span>진행 상태</span
              ><select
                aria-label="진행 상태"
                :value="query.progress || ''"
                @change="update({ progress: valueOf($event) })"
              >
                <option value="">전체</option>
                <option v-for="(label, status) in progressLabels" :key="status" :value="status">
                  {{ label }}
                </option>
              </select></label
            >
          </template>
          <template v-if="tab === 'renewals'">
            <label class="field"
              ><span>만료 구간</span
              ><select
                aria-label="만료 구간"
                :value="query.expiryBucket || ''"
                @change="update({ expiryBucket: valueOf($event) })"
              >
                <option value="">전체</option>
                <option value="0_30">오늘~30일 이내</option>
                <option value="31_60">31~60일</option>
                <option value="61_90">61~90일</option>
                <option value="over_90">90일 초과</option>
                <option value="unlimited">무기한</option>
                <option value="unknown">확인 필요</option>
                <option value="expired">기간 만료</option>
                <option value="revoked">수동 폐기</option>
              </select></label
            >
            <label class="field"
              ><span>재인증 상태</span
              ><select
                aria-label="재인증 상태"
                :value="query.renewalState || ''"
                @change="update({ renewalState: valueOf($event) })"
              >
                <option value="">전체</option>
                <option v-for="(label, status) in renewalLabels" :key="status" :value="status">
                  {{ label }}
                </option>
              </select></label
            >
          </template>
        </div>
        <p v-if="loading && !data" class="dashboard-loading" role="status">
          인증 현황을 불러오는 중입니다.
        </p>
        <template v-if="data">
          <div class="dashboard-view-toolbar">
            <p class="dashboard-meta">
              {{ scopeText }} ·
              {{ data.snapshot.scope.includeDescendants ? '하위 조직 포함' : '직접 소속'
              }}<template v-if="data.snapshot.exclusions.excludedPeople">
                ·
                <button
                  class="dashboard-link"
                  :disabled="loading"
                  @click="openMetric('excludedPeople')"
                >
                  집계 제외 {{ data.snapshot.exclusions.excludedPeople }}명
                </button></template
              >
            </p>
            <label v-if="tab !== 'summary'" class="dashboard-sort"
              >정렬<select aria-label="현황 정렬" :value="sortValue" @change="sortChanged">
                <option v-for="sort in sortOptions" :key="sort.value" :value="sort.value">
                  {{ sort.label }}
                </option>
              </select></label
            >
          </div>
          <template v-if="tab === 'summary'">
            <div class="dashboard-metrics" aria-label="인증 현황 요약">
              <DashboardMetricCard
                v-for="metric in summaryMetrics"
                :key="metric.metric"
                :label="metric.label"
                :value="metric.value"
                :unit="metric.unit"
                :note="metric.note"
                :disabled="loading"
                @select="openMetric(metric.metric)"
              />
            </div>
            <div class="dashboard-summary-layout">
              <section class="dashboard-section" aria-label="조직별 필수 충족 요약">
                <div class="dashboard-section-heading">
                  <h2>
                    {{ data.snapshot.scope.directOnly ? '필수 자격 충족' : '조직별 필수 충족' }}
                  </h2>
                  <button
                    v-if="!data.snapshot.scope.directOnly"
                    class="dashboard-link"
                    @click="changeTab('organizations')"
                  >
                    전체 보기
                  </button>
                </div>
                <template v-if="data.snapshot.scope.directOnly"
                  ><DashboardRatio
                    :fulfilled="data.summary.requiredCoverage.fulfilled"
                    :total="data.summary.requiredCoverage.total"
                  />
                  <p class="dashboard-meta">
                    필수 전부 충족 {{ data.summary.fullyRequiredPeople }} /
                    {{ data.summary.peopleWithRequirements }}명 · 필수 없음
                    {{ data.summary.peopleWithoutRequirements }}명
                  </p></template
                >
                <div
                  v-else-if="data.organizations.items.length"
                  class="dashboard-table-wrap dashboard-summary-organizations"
                  tabindex="0"
                  role="region"
                  aria-label="조직 필수 충족 표"
                >
                  <table class="dashboard-table">
                    <thead>
                      <tr>
                        <th scope="col">조직</th>
                        <th scope="col">필수 충족</th>
                        <th scope="col" class="dashboard-number">대상</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="org in data.organizations.items.slice(0, 6)"
                        :key="`${org.organizationId}-${org.direct}`"
                      >
                        <td>
                          <button class="dashboard-link" @click="organizationMembers(org)">
                            {{ org.name }}{{ org.direct ? ' · 직속' : '' }}
                          </button>
                        </td>
                        <td>
                          <DashboardRatio
                            :fulfilled="org.requiredCoverage.fulfilled"
                            :total="org.requiredCoverage.total"
                          />
                        </td>
                        <td class="dashboard-number">{{ org.people }}명</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p v-else class="dashboard-empty">조회할 조직 현황이 없습니다.</p>
              </section>
              <section class="dashboard-section" aria-label="확인 필요">
                <div class="dashboard-section-heading"><h2>확인 필요</h2></div>
                <ul class="dashboard-alerts">
                  <li v-for="alert in alerts" :key="alert.metric">
                    <button :disabled="loading" @click="openMetric(alert.metric)">
                      <span>{{ metricLabels[alert.metric] }}</span
                      ><strong>{{ alert.count }}건 <span aria-hidden="true">›</span></strong>
                    </button>
                  </li>
                  <li>
                    <button :disabled="loading" @click="openMetric('fullyRequiredPeople')">
                      <span>필수 전부 충족 인원</span
                      ><span
                        >{{ data.summary.fullyRequiredPeople }} /
                        {{ data.summary.peopleWithRequirements }}명
                        <span aria-hidden="true">›</span></span
                      >
                    </button>
                  </li>
                </ul>
                <p class="dashboard-meta">
                  필수 자격이 없는 {{ data.summary.peopleWithoutRequirements }}명은 필수 충족률에서
                  제외합니다.
                </p>
              </section>
            </div>
            <section class="dashboard-section" aria-label="자격별 현황 요약">
              <div class="dashboard-section-heading">
                <h2>자격별 현황</h2>
                <button class="dashboard-link" @click="changeTab('qualifications')">
                  전체 보기
                </button>
              </div>
              <div
                v-if="data.qualifications.items.length"
                class="dashboard-table-wrap"
                tabindex="0"
                role="region"
                aria-label="자격별 현황 표"
              >
                <table class="dashboard-table">
                  <thead>
                    <tr>
                      <th scope="col">자격</th>
                      <th scope="col">팀 적용</th>
                      <th scope="col" class="dashboard-number">필수 대상</th>
                      <th scope="col" class="dashboard-number">유효 보유</th>
                      <th scope="col" class="dashboard-number">취득 진행</th>
                      <th scope="col" class="dashboard-number">30일 내 만료</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="q in data.qualifications.items.slice(0, 5)" :key="q.entityId">
                      <td class="dashboard-name">
                        <button class="dashboard-link" @click="qualificationMembers(q.entityId)">
                          {{ q.title }}
                        </button>
                      </td>
                      <td>
                        {{ q.applied ? `적용 v${q.appliedVersion}` : '현재 미적용'
                        }}<small v-if="q.criterionStatus" class="dashboard-meta">{{
                          q.criterionStatus === 'Active'
                            ? '운영 중'
                            : q.criterionStatus === 'Hold'
                              ? '운영 보류'
                              : '운영 폐기'
                        }}</small>
                      </td>
                      <td class="dashboard-number">{{ q.requiredPeople }}명</td>
                      <td class="dashboard-number">{{ q.activePeople }}명</td>
                      <td class="dashboard-number">{{ q.inProgress }}건</td>
                      <td class="dashboard-number">{{ q.expires0to30 }}건</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="dashboard-empty">팀 적용 자격이나 구성원의 자격 기록이 없습니다.</p>
            </section>
          </template>
          <template v-else-if="tab === 'organizations'">
            <div
              v-if="data.organizations.items.length"
              class="dashboard-table-wrap"
              tabindex="0"
              role="region"
              aria-label="조직별 인증 현황 표"
            >
              <table class="dashboard-table" :data-density="density">
                <thead>
                  <tr>
                    <th scope="col">조직</th>
                    <th scope="col" class="dashboard-number">대상 인원</th>
                    <th scope="col">필수 충족</th>
                    <th scope="col" class="dashboard-number">필수 전부 충족</th>
                    <th scope="col" class="dashboard-number">유효 보유</th>
                    <th scope="col" class="dashboard-number">취득 진행</th>
                    <th scope="col">기한 경과</th>
                    <th scope="col" class="dashboard-number">만료 예정</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="org in data.organizations.items"
                    :key="`${org.organizationId}-${org.direct}`"
                  >
                    <td class="dashboard-name">
                      <button class="dashboard-link" @click="organizationMembers(org)">
                        {{ org.name }}{{ org.direct ? ' · 직속' : '' }}
                      </button>
                    </td>
                    <td class="dashboard-number">
                      {{ org.people }}명<small v-if="org.excludedPeople" class="dashboard-meta"
                        >제외 {{ org.excludedPeople }}명</small
                      >
                    </td>
                    <td>
                      <DashboardRatio
                        :fulfilled="org.requiredCoverage.fulfilled"
                        :total="org.requiredCoverage.total"
                      />
                    </td>
                    <td class="dashboard-number">{{ org.fullyRequiredPeople }}명</td>
                    <td class="dashboard-number">{{ org.activeHolders }}명</td>
                    <td class="dashboard-number">{{ org.inProgress }}건</td>
                    <td>
                      <span>요청 {{ org.overdueRequests }}건</span>
                      <small class="dashboard-meta"
                        >목표 인증 {{ org.overdueTargets }}건 · 평가
                        {{ org.overdueAssessments }}건</small
                      >
                    </td>
                    <td class="dashboard-number">{{ org.expires0to30 }}건</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="dashboard-empty">조회할 조직 현황이 없습니다.</p>
          </template>
          <template v-else-if="tab === 'qualifications'">
            <div
              v-if="data.qualifications.items.length"
              class="dashboard-table-wrap"
              tabindex="0"
              role="region"
              aria-label="자격별 인증 현황 표"
            >
              <table class="dashboard-table" :data-density="density">
                <thead>
                  <tr>
                    <th scope="col">자격</th>
                    <th scope="col">팀 적용</th>
                    <th scope="col">필수 충족</th>
                    <th scope="col" class="dashboard-number">Active</th>
                    <th scope="col" class="dashboard-number">Hold</th>
                    <th scope="col" class="dashboard-number">Revoke</th>
                    <th scope="col" class="dashboard-number">취득 진행</th>
                    <th scope="col" class="dashboard-number">계획 미작성</th>
                    <th scope="col" class="dashboard-number">만료 예정</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="q in data.qualifications.items" :key="q.entityId">
                    <td class="dashboard-name">
                      <button class="dashboard-link" @click="qualificationMembers(q.entityId)">
                        {{ q.title }}
                      </button>
                    </td>
                    <td>
                      {{ q.applied ? `적용 v${q.appliedVersion}` : '현재 미적용'
                      }}<small v-if="q.criterionStatus" class="dashboard-meta">{{
                        q.criterionStatus === 'Active'
                          ? '운영 중'
                          : q.criterionStatus === 'Hold'
                            ? '운영 보류'
                            : '운영 폐기'
                      }}</small>
                    </td>
                    <td>
                      <DashboardRatio
                        :fulfilled="q.requiredCoverage.fulfilled"
                        :total="q.requiredCoverage.total"
                      />
                    </td>
                    <td class="dashboard-number">{{ q.activePeople }}명</td>
                    <td class="dashboard-number">{{ q.heldPeople }}명</td>
                    <td class="dashboard-number">{{ q.revokedPeople }}명</td>
                    <td class="dashboard-number">{{ q.inProgress }}건</td>
                    <td class="dashboard-number">{{ q.unplanned }}명</td>
                    <td class="dashboard-number">{{ q.expires0to30 }}건</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="dashboard-empty">조건에 맞는 자격이 없습니다.</p>
          </template>
          <template v-else-if="tab === 'members'">
            <div class="dashboard-view-toolbar">
              <div class="dashboard-view-switch" role="group" aria-label="구성원 표시 방식">
                <button :aria-pressed="!matrix" @click="update({ mode: 'list' })">목록</button
                ><button :aria-pressed="matrix" @click="update({ mode: 'matrix' })">
                  매트릭스
                </button>
              </div>
              <p v-if="matrix" class="dashboard-meta">현재 효력 · 진행 · 필수 여부</p>
            </div>
            <template v-if="matrix">
              <div v-if="data.matrix.columns.pages > 1" class="dashboard-matrix-pagination">
                <span>자격 열 {{ data.matrix.columns.page }} / {{ data.matrix.columns.pages }}</span
                ><button
                  class="icon-button"
                  aria-label="이전 자격 열"
                  :disabled="loading || data.matrix.columns.page <= 1"
                  @click="update({ columnPage: data.matrix.columns.page - 1 }, false)"
                >
                  ‹</button
                ><button
                  class="icon-button"
                  aria-label="다음 자격 열"
                  :disabled="loading || data.matrix.columns.page >= data.matrix.columns.pages"
                  @click="update({ columnPage: data.matrix.columns.page + 1 }, false)"
                >
                  ›
                </button>
              </div>
              <div
                v-if="data.matrix.members.items.length && data.matrix.columns.items.length"
                class="dashboard-table-wrap"
                tabindex="0"
                role="region"
                aria-label="구성원 자격 매트릭스"
              >
                <table
                  class="dashboard-table dashboard-matrix"
                  data-testid="dashboard-matrix"
                  :data-density="density"
                >
                  <thead>
                    <tr>
                      <th scope="col">구성원 · 소속</th>
                      <th v-for="q in data.matrix.columns.items" :key="q.entityId" scope="col">
                        {{ q.title
                        }}<small class="dashboard-meta">{{
                          q.applied ? `팀 적용 v${q.appliedVersion}` : '현재 미적용'
                        }}</small>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="person in data.matrix.members.items" :key="person.userId">
                      <td>
                        <button
                          class="dashboard-link"
                          :aria-label="`${person.name} 상세 보기`"
                          @click="openMember(person.userId)"
                        >
                          {{ person.name }}</button
                        ><span class="dashboard-meta">{{ person.organizationName }}</span
                        ><span v-if="!person.eligible" class="dashboard-meta">{{
                          person.held ? '대상자 Hold' : '비활성 소속'
                        }}</span>
                      </td>
                      <td v-for="q in data.matrix.columns.items" :key="q.entityId">
                        <template
                          v-for="cell in person.cells.filter((c) => c.entityId === q.entityId)"
                          :key="cell.entityId"
                          ><button
                            class="dashboard-matrix-cell"
                            :aria-label="`${person.name} · ${q.title} 현황 보기: ${cellSummary(cell)}${cell.required ? ' · 필수' : ''}`"
                            @click="openMember(person.userId, cell.entityId)"
                          >
                            <span v-if="cell.required" class="dashboard-required">[필수]</span
                            ><span
                              v-if="
                                !cell.required &&
                                !cell.selected &&
                                cell.efficacy === 'none' &&
                                cell.progress === 'none'
                              "
                              class="dashboard-meta"
                              >미선택</span
                            ><template v-else
                              ><span
                                class="dashboard-status"
                                :class="cell.efficacy.toLowerCase()"
                                >{{ efficacyLabels[cell.efficacy] }}</span
                              ><span v-if="cell.progress !== 'none'"
                                >{{ progressLabels[cell.progress]
                                }}<small v-if="cell.totalCourses" class="dashboard-meta"
                                  >인증Set {{ cell.completedCourses }} /
                                  {{ cell.totalCourses }}</small
                                ></span
                              ><span
                                v-if="cell.renewalState === 'in_progress'"
                                class="dashboard-meta"
                                >재인증 진행</span
                              ></template
                            >
                          </button></template
                        >
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="dashboard-empty">표시할 구성원 또는 자격이 없습니다.</p>
            </template>
            <template v-else
              ><div
                v-if="data.members.items.length"
                class="dashboard-table-wrap"
                tabindex="0"
                role="region"
                aria-label="구성원 인증 현황 표"
              >
                <table
                  class="dashboard-table"
                  data-testid="dashboard-members"
                  :data-density="density"
                >
                  <thead>
                    <tr>
                      <th scope="col">구성원</th>
                      <th scope="col">소속</th>
                      <th scope="col">필수 충족</th>
                      <th scope="col" class="dashboard-number">유효 보유</th>
                      <th scope="col" class="dashboard-number">취득 진행</th>
                      <th scope="col" class="dashboard-number">미완료 요청</th>
                      <th scope="col">진행·다음 일정</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="person in data.members.items" :key="person.userId">
                      <td class="dashboard-name">
                        <button
                          class="dashboard-link"
                          :aria-label="`${person.name} 상세 보기`"
                          @click="openMember(person.userId)"
                        >
                          {{ person.name }}</button
                        ><small v-if="!person.eligible" class="dashboard-meta">{{
                          person.held ? '대상자 Hold' : '비활성 소속'
                        }}</small>
                      </td>
                      <td>{{ person.organizationName }}</td>
                      <td>
                        <DashboardRatio
                          :fulfilled="person.requiredCoverage.fulfilled"
                          :total="person.requiredCoverage.total"
                        />
                      </td>
                      <td class="dashboard-number">{{ person.activeQualifications }}개</td>
                      <td class="dashboard-number">{{ person.inProgress }}건</td>
                      <td class="dashboard-number">
                        {{ person.incompleteRequests }}건<small
                          v-if="person.overdueRequests"
                          class="dashboard-meta"
                          >기한 경과 {{ person.overdueRequests }}건</small
                        >
                      </td>
                      <td>
                        <template
                          v-for="cell in person.cells
                            .filter(
                              (c) => c.progress !== 'none' || c.renewalState === 'in_progress',
                            )
                            .slice(0, 2)"
                          :key="cell.entityId"
                          ><button
                            class="dashboard-link"
                            @click="openMember(person.userId, cell.entityId)"
                          >
                            {{ cell.title }}</button
                          ><span class="dashboard-meta"
                            >{{ progressLabels[cell.progress]
                            }}{{
                              cell.renewalState === 'in_progress' ? ' · 재인증 진행' : ''
                            }}</span
                          ></template
                        ><span
                          v-if="
                            !person.cells.some(
                              (c) => c.progress !== 'none' || c.renewalState === 'in_progress',
                            )
                          "
                          class="dashboard-meta"
                          >진행 없음</span
                        >
                        <div
                          v-if="person.nextSchedule"
                          class="dashboard-next-schedule"
                          aria-label="다음 일정"
                        >
                          <span class="dashboard-meta"
                            >{{
                              person.nextSchedule.date < data.snapshot.date
                                ? '기한 경과'
                                : '다음 일정'
                            }}
                            · {{ scheduleLabels[person.nextSchedule.kind] }}</span
                          >
                          <span>{{ person.nextSchedule.date }}</span>
                          <small
                            v-if="person.nextSchedule.title || person.nextSchedule.courseTitle"
                            class="dashboard-meta"
                            >{{
                              [person.nextSchedule.title, person.nextSchedule.courseTitle]
                                .filter(Boolean)
                                .join(' · ')
                            }}</small
                          >
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="dashboard-empty">조건에 맞는 구성원이 없습니다.</p></template
            >
          </template>
          <template v-else-if="tab === 'renewals'">
            <div
              v-if="data.renewals.items.length"
              class="dashboard-table-wrap"
              tabindex="0"
              role="region"
              aria-label="만료 및 재인증 현황 표"
            >
              <table class="dashboard-table" :data-density="density">
                <thead>
                  <tr>
                    <th scope="col">구성원</th>
                    <th scope="col">자격</th>
                    <th scope="col">효력</th>
                    <th scope="col">현재 만료일</th>
                    <th scope="col">재인증</th>
                    <th scope="col">재인증 시작일</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in data.renewals.items" :key="row.certificationId">
                    <td>
                      <button
                        class="dashboard-link"
                        :aria-label="`${row.name} 상세 보기`"
                        @click="openMember(row.userId, row.entityId)"
                      >
                        {{ row.name }}</button
                      ><small class="dashboard-meta">{{ row.organizationName }}</small>
                    </td>
                    <td class="dashboard-name">
                      {{ row.title
                      }}<small class="dashboard-meta">기록 v{{ row.recordVersion }}</small>
                    </td>
                    <td>
                      <span class="dashboard-status" :class="row.efficacy.toLowerCase()">{{
                        efficacyLabels[row.efficacy]
                      }}</span>
                    </td>
                    <td class="dashboard-date">
                      {{
                        row.expiresOn ||
                        (row.expiryBucket === 'unlimited' ? '무기한' : '확인 필요')
                      }}<small v-if="row.daysUntilExpiry !== undefined" class="dashboard-meta">{{
                        row.daysUntilExpiry < 0
                          ? `${Math.abs(row.daysUntilExpiry)}일 경과`
                          : row.daysUntilExpiry === 0
                            ? '오늘 만료'
                            : `${row.daysUntilExpiry}일 남음`
                      }}</small>
                    </td>
                    <td>
                      {{ renewalLabels[row.renewalState]
                      }}<button
                        v-if="row.renewalState === 'blocked'"
                        class="dashboard-link"
                        @click="openMember(row.userId, row.entityId)"
                      >
                        상태 확인
                      </button>
                    </td>
                    <td class="dashboard-date">{{ row.renewalOpensOn || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="dashboard-empty">조건에 맞는 인증 기록이 없습니다.</p>
          </template>
          <DashboardPager
            v-if="currentPage"
            :total="currentPage.total"
            :page="currentPage.page"
            :page-size="currentPage.pageSize"
            :density="density"
            :disabled="loading"
            :fixed-page-size="matrix"
            @page="update({ page: $event }, false)"
            @page-size="setPageSize"
            @density="setDensity"
          />
        </template>
      </section>
    </template>
    <DashboardDetailsDialog
      :open="!!detailMetric && !memberId"
      :metric="detailMetric"
      :detail="details"
      :loading="detailLoading"
      :error="detailError"
      @close="closeDetail"
      @retry="loadDetail"
      @member="openMember"
      @page="detailPage"
      @closed="restoreFocus"
    />
    <DashboardMemberPanel
      :open="!!memberId"
      :detail="member"
      :entity-id="detailEntityId"
      :loading="detailLoading"
      :error="detailError"
      @close="closeDetail"
      @retry="loadDetail"
      @closed="restoreFocus"
    />
  </section>
</template>
