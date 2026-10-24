<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type {
  DashboardResponse,
  DashboardQuery,
  DashboardChartSelection,
  DashboardChartDetails,
  DashboardMemberDetail,
} from '@eks/contracts';
import { api, ApiError } from '../../api';
import AppDialog from '../AppDialog.vue';
import DashboardChartPlot from './DashboardChartPlot.vue';
import DashboardChartDetailTable from './DashboardChartDetailTable.vue';
import DashboardMemberContent from './DashboardMemberContent.vue';
import { displayTime, efficacyLabels, progressLabels } from './labels';
const props = defineProps<{
  data: DashboardResponse;
  query: DashboardQuery;
  loading: boolean;
  refresh: () => Promise<void>;
}>();
const route = useRoute(),
  router = useRouter();
const keys = [
  'chart',
  'chartPage',
  'chartDisplay',
  'chartGroup',
  'chartSeries',
  'chartDetailPage',
  'chartMember',
  'chartMemberEntity',
] as const;
const one = (key: string) =>
  typeof route.query[key] === 'string' ? (route.query[key] as string) : '';
const positive = (key: string) =>
  /^\d+$/.test(one(key)) && Number(one(key)) > 0 ? Number(one(key)) : 1;
const charts = computed(() => props.data.charts || []);
const selected = computed(() => charts.value.find((c) => c.id === one('chart')));
const table = computed(() => one('chartDisplay') === 'table');
const page = computed(() =>
  Math.min(
    positive('chartPage'),
    Math.max(1, Math.ceil((selected.value?.groups.length || 0) / 20)),
  ),
);
const selection = computed<DashboardChartSelection | null>(() =>
  selected.value && one('chartGroup') && one('chartSeries')
    ? {
        chartId: selected.value.id,
        groupKey: one('chartGroup'),
        seriesKey: one('chartSeries'),
      }
    : null,
);
const screen = computed(() =>
  one('chartMember') ? 'member' : selection.value ? 'details' : 'chart',
);
const detail = ref<DashboardChartDetails | null>(null),
  member = ref<DashboardMemberDetail | null>(null);
const busy = ref(false),
  error = ref(''),
  changed = ref('');
const title = computed(() =>
  screen.value === 'member'
    ? (member.value?.person.name || '구성원') + ' · 인증 현황'
    : screen.value === 'details'
      ? detail.value?.title || (selected.value?.title || '') + ' · 명세'
      : selected.value?.title || '차트',
);
const selectionKey = computed(() =>
  JSON.stringify([
    one('chart'),
    one('chartGroup'),
    one('chartSeries'),
    one('chartMember'),
    one('chartMemberEntity'),
    one('chartDetailPage'),
    props.query,
  ]),
);
const filters = computed(() =>
  [
    props.query.population === 'excluded'
      ? '제외 인원'
      : props.query.population === 'all'
        ? '전체 인원'
        : '기본 대상',
    props.query.search ? '검색: ' + props.query.search : '',
    props.query.entityId ? '자격 필터 적용' : '',
    props.query.required === 'required'
      ? '필수만'
      : props.query.required === 'optional'
        ? '비필수만'
        : '',
    props.query.efficacy ? efficacyLabels[props.query.efficacy] : '',
    props.query.progress ? progressLabels[props.query.progress] : '',
    props.query.expiryBucket ? '만료 구간 필터 적용' : '',
    props.query.renewalState ? '재인증 필터 적용' : '',
    props.query.qualificationScope === 'applied'
      ? '팀 적용 자격'
      : props.query.qualificationScope === 'records'
        ? '기록 보유 자격'
        : '',
  ]
    .filter(Boolean)
    .join(' · '),
);
let sequence = 0,
  controller: AbortController | undefined,
  disposed = false,
  refreshed = false;
let returnFocus: HTMLElement | null = null,
  returnScroll = 0,
  detailFocus: Element | null = null,
  focusLabel = '',
  memberFocusId = '',
  pendingMemberFocus = '';
function capture() {
  if (!selected.value) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnScroll = window.scrollY;
  }
}
async function update(values: Record<string, string | undefined>) {
  const query = { ...route.query };
  for (const [k, v] of Object.entries(values))
    if (v) query[k] = v;
    else delete query[k];
  await router.replace({ query });
}
async function expand(id: string) {
  capture();
  changed.value = '';
  await update({
    chart: id,
    chartPage: undefined,
    chartDisplay: undefined,
    chartGroup: undefined,
    chartSeries: undefined,
    chartMember: undefined,
    chartDetailPage: undefined,
  });
}
async function choose(value: DashboardChartSelection) {
  capture();
  detailFocus = document.activeElement;
  focusLabel = detailFocus?.getAttribute('aria-label') || '';
  await update({
    chart: value.chartId,
    chartGroup: value.groupKey,
    chartSeries: value.seriesKey,
    chartMember: undefined,
    chartMemberEntity: undefined,
    chartDetailPage: undefined,
  });
}
async function close() {
  const query = { ...route.query };
  for (const key of keys) delete query[key];
  await router.replace({ query });
}
function restoreFocus() {
  if (selected.value) return;
  window.scrollTo({ top: returnScroll });
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}
async function back() {
  const fromMember = screen.value === 'member';
  if (fromMember) pendingMemberFocus = memberFocusId;
  if (fromMember) await update({ chartMember: undefined, chartMemberEntity: undefined });
  else await update({ chartGroup: undefined, chartSeries: undefined, chartDetailPage: undefined });
  await nextTick();
  const restored = !fromMember
    ? [...document.querySelectorAll<HTMLElement>('.dashboard-chart-dialog [aria-label]')].find(
        (el) => el.tagName === detailFocus?.tagName && el.getAttribute('aria-label') === focusLabel,
      )
    : undefined;
  if (restored) restored.focus({ preventScroll: true });
  else
    document
      .querySelector<HTMLElement>(
        '.dashboard-chart-dialog .chart-back, .dashboard-chart-dialog .dialog-head button',
      )
      ?.focus();
}
async function loadDetail() {
  const version = ++sequence,
    key = selectionKey.value;
  controller?.abort();
  controller = new AbortController();
  detail.value = null;
  member.value = null;
  error.value = '';
  busy.value = false;
  if (!selection.value || disposed) return;
  busy.value = true;
  const q: DashboardQuery = {
    ...props.query,
    ...selection.value,
    page: positive('chartDetailPage'),
    pageSize: 25,
    expectedStateRevision: props.data.snapshot.stateRevision,
    expectedOrganizationRevision: props.data.snapshot.organizationRevision,
    expectedDate: props.data.snapshot.date,
  };
  const path =
    screen.value === 'member'
      ? '/dashboard/members/' + encodeURIComponent(one('chartMember'))
      : '/dashboard/chart-details';
  try {
    const url = new URLSearchParams(
      Object.entries(q)
        .filter(([, v]) => v !== '' && v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    const value = await api<DashboardChartDetails | DashboardMemberDetail>(path + '?' + url, {
      signal: controller.signal,
    });
    if (disposed || version !== sequence || key !== selectionKey.value) return;
    if (screen.value === 'member') member.value = value as DashboardMemberDetail;
    else detail.value = value as DashboardChartDetails;
    refreshed = false;
  } catch (e) {
    if (disposed || version !== sequence || key !== selectionKey.value) return;
    if (e instanceof ApiError && e.code === 'DASHBOARD_STALE' && !refreshed) {
      refreshed = true;
      changed.value = '조회 중 현황이 변경되어 차트와 목록을 최신 기준으로 갱신했습니다.';
      await props.refresh();
      await nextTick();
      if (!disposed && version === sequence) {
        if (
          props.data.snapshot.stateRevision !== q.expectedStateRevision ||
          props.data.snapshot.organizationRevision !== q.expectedOrganizationRevision ||
          props.data.snapshot.date !== q.expectedDate
        )
          void loadDetail();
        else error.value = '최신 현황을 불러오지 못했습니다. 다시 조회해 주세요.';
      }
      return;
    }
    error.value = e instanceof Error ? e.message : '명세를 불러오지 못했습니다.';
    if (e instanceof ApiError && ([401, 403].includes(e.status) || e.code === 'DATASET_CHANGED'))
      await props.refresh();
  } finally {
    if (version === sequence) busy.value = false;
  }
}
function retry() {
  refreshed = false;
  void loadDetail();
}
async function openMember(id: string, entityId?: string) {
  memberFocusId = id;
  await update({ chartMember: id, chartMemberEntity: entityId });
}
watch(
  selectionKey,
  () => {
    refreshed = false;
    void loadDetail();
  },
  { immediate: true },
);
watch(
  () => [
    props.data.snapshot.stateRevision,
    props.data.snapshot.organizationRevision,
    props.data.snapshot.date,
  ],
  () => void loadDetail(),
);
watch(
  selected,
  (value) => {
    if (!value && one('chart')) void close();
  },
  { immediate: true },
);
watch(detail, async (value) => {
  if (!value || !pendingMemberFocus) return;
  await nextTick();
  const target = [...document.querySelectorAll<HTMLElement>('.chart-member-link')].find(
    (el) => el.dataset.userId === pendingMemberFocus,
  );
  if (target) target.focus({ preventScroll: true });
  pendingMemberFocus = '';
});
watch(
  () => screen.value,
  async () => {
    await nextTick();
    document
      .querySelector<HTMLElement>(
        '.dashboard-chart-dialog .chart-back, .dashboard-chart-dialog .dialog-head button',
      )
      ?.focus({ preventScroll: true });
  },
);
onBeforeUnmount(() => {
  disposed = true;
  sequence++;
  controller?.abort();
  detail.value = null;
  member.value = null;
});
</script>
<template>
  <div class="dashboard-charts" aria-label="인증 현황 차트">
    <section
      v-for="chart in charts"
      :key="chart.id"
      class="dashboard-chart-section"
      :data-chart="chart.id"
      :aria-label="chart.title + ' 차트'"
    >
      <div class="dashboard-section-heading">
        <h2>{{ chart.title }}</h2>
        <button
          class="dashboard-link chart-expand"
          :disabled="loading"
          :aria-label="chart.title + ' 크게 보기'"
          @click="expand(chart.id)"
        >
          크게 보기 <span aria-hidden="true">⤢</span>
        </button>
      </div>
      <DashboardChartPlot :chart="chart" :disabled="loading" @select="choose" />
      <p v-if="chart.comparison" class="chart-preview-count">
        전체 {{ chart.groups.length }}개 중 {{ Math.min(chart.groups.length, 8) }}개 표시
      </p>
    </section>
  </div>
  <AppDialog
    class="dashboard-dialog dashboard-chart-dialog"
    :open="!!selected"
    :title="title"
    @update:open="!$event && close()"
    @closed="restoreFocus"
  >
    <template v-if="selected">
      <div class="chart-dialog-context">
        <span
          >{{ data.snapshot.scope.organizationPath.map((p) => p.name).join(' / ') }} ·
          {{ data.snapshot.scope.includeDescendants ? '하위 조직 포함' : '직접 소속' }}</span
        >
        <span>{{ displayTime(data.snapshot.asOf) }} 기준</span><span>{{ filters }}</span>
      </div>
      <p v-if="changed" class="dashboard-notice info" role="status">{{ changed }}</p>
      <button v-if="screen !== 'chart'" class="button secondary chart-back" @click="back">
        {{ screen === 'member' ? '명세로 돌아가기' : '차트로 돌아가기' }}
      </button>
      <template v-if="screen === 'chart'">
        <div class="chart-dialog-tools">
          <div class="dashboard-view-switch" role="group" aria-label="확대 차트 표시 방식">
            <button :aria-pressed="!table" @click="update({ chartDisplay: undefined })">
              차트 보기</button
            ><button :aria-pressed="table" @click="update({ chartDisplay: 'table' })">
              데이터 표 보기
            </button>
          </div>
          <nav
            v-if="selected.comparison"
            class="dashboard-pagination"
            aria-label="차트 항목 페이지"
          >
            <span
              >전체 {{ selected.groups.length }}개 · {{ page }} /
              {{ Math.max(1, Math.ceil(selected.groups.length / 20)) }}</span
            >
            <button
              class="icon-button"
              aria-label="차트 이전 항목"
              :disabled="page <= 1"
              @click="update({ chartPage: String(page - 1) })"
            >
              ‹
            </button>
            <button
              class="icon-button"
              aria-label="차트 다음 항목"
              :disabled="page >= Math.ceil(selected.groups.length / 20)"
              @click="update({ chartPage: String(page + 1) })"
            >
              ›
            </button>
          </nav>
        </div>
        <DashboardChartPlot
          :chart="selected"
          :table="table"
          :start="(page - 1) * 20"
          :limit="20"
          :disabled="loading"
          @select="choose"
        />
      </template>
      <template v-else-if="screen === 'details'">
        <p v-if="busy" class="dashboard-loading" role="status">차트 명세를 불러오는 중입니다.</p>
        <div v-else-if="error" class="dashboard-notice error" role="alert">
          <span>{{ error }}</span
          ><button class="button secondary" @click="retry">다시 조회</button>
        </div>
        <DashboardChartDetailTable
          v-else-if="detail"
          :detail="detail"
          @member="openMember"
          @page="update({ chartDetailPage: String($event) })"
        />
      </template>
      <DashboardMemberContent
        v-else
        :detail="member"
        :entity-id="one('chartMemberEntity')"
        :loading="busy"
        :error="error"
        @retry="retry"
      />
    </template>
    <template #footer><button class="button secondary" @click="close">닫기</button></template>
  </AppDialog>
</template>
