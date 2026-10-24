import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { api, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { DATASET_EVENT } from '../data-generation';
import type {
  DashboardQuery,
  DashboardResponse,
  DashboardOptions,
  DashboardDetails,
  DashboardMemberDetail,
  DashboardMetric,
} from '@eks/contracts';
import { dashboardTabs, type DashboardTab } from '../components/dashboard/labels';

const one = (value: LocationQuery[string]) => (typeof value === 'string' ? value : '');
const positive = (value: string) => (/^\d+$/.test(value) && Number(value) > 0 ? Number(value) : 1);
const choice = <const T extends string>(value: string, choices: readonly T[], fallback: T): T =>
  choices.includes(value as T) ? (value as T) : fallback;
const filterKeys = [
  'search',
  'entityId',
  'required',
  'efficacy',
  'progress',
  'qualificationScope',
  'expiryBucket',
  'renewalState',
  'population',
  'sort',
  'order',
  'page',
  'pageSize',
  'columnPage',
  'mode',
] as const;
export function useDashboard() {
  const store = useDemo(),
    route = useRoute(),
    router = useRouter();
  const data = ref<DashboardResponse | null>(null),
    options = ref<DashboardOptions | null>(null);
  const loading = ref(false),
    error = ref(''),
    stale = ref(false),
    changed = ref('');
  const details = ref<DashboardDetails | null>(null),
    member = ref<DashboardMemberDetail | null>(null);
  const detailLoading = ref(false),
    detailError = ref('');
  const tab = computed(() => {
    const selected = choice(
      one(route.query.tab),
      dashboardTabs.map((t) => t.id),
      'summary',
    );
    return selected === 'organizations' && !store.fullManagement ? 'summary' : selected;
  });
  const matrix = computed(() => tab.value === 'members' && one(route.query.mode) === 'matrix');
  const detailMetric = computed(() => one(route.query.metric) as DashboardMetric);
  const memberId = computed(() => one(route.query.member));
  const detailEntityId = computed(() => one(route.query.detailEntity));
  const context = computed(
    () =>
      `${store.actorId}:${store.managementLv1}:${store.actor.organizationId}:${store.actor.roles.join(',')}`,
  );
  const ready = computed(
    () => !!store.actorId && !!store.managementLv1 && store.canEnterManagement,
  );
  const memories = new Map<string, Record<string, string>>();
  const prefsKey = () => `eks-dashboard-list-${store.actorId}-${store.managementLv1}-${tab.value}`;
  function preferences() {
    try {
      return JSON.parse(localStorage.getItem(prefsKey()) || '{}');
    } catch {
      return {};
    }
  }
  const pageSize = computed<25 | 50 | 100>(() => {
    if (matrix.value) return 25;
    const value = Number(one(route.query.pageSize) || preferences().pageSize || 25);
    return [25, 50, 100].includes(value) ? (value as 25 | 50 | 100) : 25;
  });
  const query = computed<DashboardQuery>(() => {
    const q = route.query;
    const result: DashboardQuery = {
      lv1OrganizationId: store.managementLv1,
      organizationId:
        one(q.organizationId) ||
        (store.fullManagement ? store.managementLv1 : store.actor.organizationId),
      includeDescendants: store.fullManagement && one(q.includeDescendants) !== 'false',
      view: matrix.value ? 'matrix' : tab.value,
      page: positive(one(q.page)),
      pageSize: pageSize.value,
      columnPage: positive(one(q.columnPage)),
    };
    if (tab.value !== 'summary' && tab.value !== 'organizations') {
      result.search = one(q.search);
      result.sort = choice(
        one(q.sort),
        ['name', 'organization', 'qualification', 'coverage', 'expiresOn', 'targetOn', 'dueOn'],
        tab.value === 'renewals' ? 'expiresOn' : tab.value === 'members' ? 'organization' : 'name',
      );
      result.order = choice(one(q.order), ['asc', 'desc'], 'asc');
    }
    if (tab.value === 'organizations') {
      result.sort = choice(one(q.sort), ['name', 'coverage'], 'name');
      result.order = choice(one(q.order), ['asc', 'desc'], 'asc');
    }
    if (tab.value === 'qualifications')
      result.qualificationScope = choice(
        one(q.qualificationScope),
        ['all', 'applied', 'records'],
        'all',
      );
    if (tab.value === 'members' || tab.value === 'renewals') {
      result.population = choice(one(q.population), ['eligible', 'excluded', 'all'], 'eligible');
      result.entityId = one(q.entityId);
    }
    if (tab.value === 'members') {
      result.required = choice(one(q.required), ['all', 'required', 'optional'], 'all');
      if (['Active', 'Hold', 'Revoke', 'none'].includes(one(q.efficacy)))
        result.efficacy = one(q.efficacy) as DashboardQuery['efficacy'];
      if (
        [
          'unplanned',
          'draft',
          'assessment_wait',
          'assessment_progress',
          'partial_completion',
          'none',
        ].includes(one(q.progress))
      )
        result.progress = one(q.progress) as DashboardQuery['progress'];
    }
    if (tab.value === 'renewals') {
      if (
        [
          '0_30',
          '31_60',
          '61_90',
          'over_90',
          'unlimited',
          'unknown',
          'expired',
          'revoked',
        ].includes(one(q.expiryBucket))
      )
        result.expiryBucket = one(q.expiryBucket) as DashboardQuery['expiryBucket'];
      if (
        ['available', 'in_progress', 'upcoming', 'scheduled', 'blocked', 'not_applicable'].includes(
          one(q.renewalState),
        )
      )
        result.renewalState = one(q.renewalState) as DashboardQuery['renewalState'];
    }
    return result;
  });
  const baseKey = computed(() => `${context.value}:${JSON.stringify(query.value)}`);
  const detailKey = computed(
    () =>
      `${memberId.value}:${detailMetric.value}:${detailEntityId.value}:${one(route.query.detailPage)}`,
  );
  let sequence = 0,
    detailSequence = 0,
    controller: AbortController | undefined,
    detailController: AbortController | undefined;
  let disposed = false,
    rememberedKey = '',
    returnFocus: HTMLElement | null = null,
    returnScroll = 0;
  const serialize = (q: DashboardQuery) =>
    new URLSearchParams(
      Object.entries(q)
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([key, value]) => [key, String(value)]),
    ).toString();
  const fatal = (e: unknown) =>
    e instanceof ApiError && ([401, 403].includes(e.status) || e.code === 'DATASET_CHANGED');
  const message = (e: unknown) =>
    e instanceof Error ? e.message : '현황을 불러오지 못했습니다. 다시 시도해 주세요.';
  function clearPrivate() {
    sequence++;
    detailSequence++;
    controller?.abort();
    detailController?.abort();
    data.value = null;
    options.value = null;
    details.value = null;
    member.value = null;
    loading.value = false;
    detailLoading.value = false;
    stale.value = false;
  }
  function revokeView() {
    clearPrivate();
    void router.replace({
      query: {
        ...route.query,
        member: undefined,
        metric: undefined,
        detailEntity: undefined,
        detailPage: undefined,
      },
    });
  }
  async function load(skipDetail = false) {
    if (!ready.value || disposed) return;
    const version = ++sequence,
      key = baseKey.value;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    loading.value = true;
    error.value = '';
    const common: DashboardQuery = {
      lv1OrganizationId: query.value.lv1OrganizationId,
      organizationId: query.value.organizationId,
      includeDescendants: query.value.includeDescendants,
    };
    try {
      const [view, available] = await Promise.all([
        api<DashboardResponse>(`/dashboard?${serialize(query.value)}`, { signal }),
        api<DashboardOptions>(`/dashboard/options?${serialize(common)}`, { signal }),
      ]);
      if (disposed || version !== sequence || key !== baseKey.value) return;
      data.value = view;
      options.value = available;
      stale.value = false;
      if (!skipDetail && (memberId.value || detailMetric.value)) await loadDetail();
    } catch (e) {
      if (disposed || version !== sequence || key !== baseKey.value) return;
      if (fatal(e)) revokeView();
      else stale.value = !!data.value;
      error.value = message(e);
    } finally {
      if (version === sequence) loading.value = false;
    }
  }
  async function loadDetail() {
    if (!data.value || (!memberId.value && !detailMetric.value) || disposed) return;
    const version = ++detailSequence,
      key = `${context.value}:${detailKey.value}:${baseKey.value}`;
    detailController?.abort();
    detailController = new AbortController();
    const signal = detailController.signal;
    detailLoading.value = true;
    detailError.value = '';
    details.value = null;
    member.value = null;
    for (let retry = 0; retry < 2; retry++) {
      const snapshot = data.value?.snapshot;
      if (!snapshot) break;
      const expected = {
        expectedStateRevision: snapshot.stateRevision,
        expectedOrganizationRevision: snapshot.organizationRevision,
        expectedDate: snapshot.date,
      };
      const q: DashboardQuery = {
        ...query.value,
        ...expected,
        page: positive(one(route.query.detailPage)),
        pageSize: 25,
      };
      if (detailMetric.value) q.metric = detailMetric.value;
      // A summary metric is scoped to the organization, independent of other tab filters.
      if (detailMetric.value)
        for (const field of [
          'search',
          'entityId',
          'required',
          'efficacy',
          'progress',
          'population',
          'expiryBucket',
          'renewalState',
          'qualificationScope',
        ] as const)
          delete q[field];
      try {
        const value = memberId.value
          ? await api<DashboardMemberDetail>(
              `/dashboard/members/${encodeURIComponent(memberId.value)}?${serialize(q)}`,
              { signal },
            )
          : await api<DashboardDetails>(`/dashboard/details?${serialize(q)}`, { signal });
        if (
          disposed ||
          version !== detailSequence ||
          key !== `${context.value}:${detailKey.value}:${baseKey.value}`
        )
          return;
        if (memberId.value) member.value = value as DashboardMemberDetail;
        else details.value = value as DashboardDetails;
        detailLoading.value = false;
        return;
      } catch (e) {
        if (
          disposed ||
          version !== detailSequence ||
          key !== `${context.value}:${detailKey.value}:${baseKey.value}`
        )
          return;
        if (
          e instanceof ApiError &&
          e.status === 409 &&
          e.code !== 'DATASET_CHANGED' &&
          retry === 0
        ) {
          await load(true);
          if (error.value || !data.value) {
            detailError.value = error.value || '최신 현황을 불러온 뒤 다시 조회해 주세요.';
            break;
          }
          changed.value = '조회 중 현황이 변경되어 최신 기준으로 갱신했습니다.';
          continue;
        }
        if (fatal(e)) {
          revokeView();
          error.value = message(e);
        }
        detailError.value = message(e);
        break;
      }
    }
    if (version === detailSequence) detailLoading.value = false;
  }
  function remember() {
    if (!rememberedKey) return;
    const kept: Record<string, string> = {};
    for (const key of filterKeys) if (one(route.query[key])) kept[key] = one(route.query[key]);
    memories.set(rememberedKey, kept);
  }
  async function update(
    changes: Record<string, string | number | boolean | undefined>,
    resetPage = true,
  ) {
    const next = { ...route.query };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') delete next[key];
      else next[key] = String(value);
    }
    if ('organizationId' in changes || 'includeDescendants' in changes) {
      delete next.entityId;
      for (const filters of memories.values()) {
        delete filters.entityId;
        delete filters.page;
        delete filters.columnPage;
      }
    }
    if (resetPage) {
      delete next.page;
      delete next.columnPage;
    }
    for (const key of [
      'chart',
      'chartPage',
      'chartDisplay',
      'chartGroup',
      'chartSeries',
      'chartDetailPage',
      'chartMember',
      'chartMemberEntity',
    ])
      delete next[key];
    delete next.member;
    delete next.metric;
    delete next.detailEntity;
    delete next.detailPage;
    await router.replace({ query: next });
  }
  async function changeTab(value: string) {
    remember();
    const next = { ...route.query };
    for (const key of filterKeys) delete next[key];
    for (const key of [
      'chart',
      'chartPage',
      'chartDisplay',
      'chartGroup',
      'chartSeries',
      'chartDetailPage',
      'chartMember',
      'chartMemberEntity',
    ])
      delete next[key];
    delete next.member;
    delete next.metric;
    delete next.detailEntity;
    delete next.detailPage;
    Object.assign(next, memories.get(`${context.value}:${value}`) || {});
    next.tab = value;
    await router.push({ query: next });
  }
  function setPageSize(value: number) {
    try {
      localStorage.setItem(prefsKey(), JSON.stringify({ pageSize: value }));
    } catch {
      /* The URL retains the current setting. */
    }
    return update({ pageSize: value });
  }
  function opening() {
    if (!memberId.value && !detailMetric.value) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      returnScroll = window.scrollY;
    }
  }
  async function openMetric(value: DashboardMetric) {
    opening();
    await router.push({
      query: {
        ...route.query,
        member: undefined,
        detailEntity: undefined,
        detailPage: undefined,
        metric: value,
      },
    });
  }
  async function openMember(userId: string, entityId?: string) {
    opening();
    await router.push({
      query: {
        ...route.query,
        metric: undefined,
        member: userId,
        detailEntity: entityId,
        detailPage: undefined,
      },
    });
  }
  async function closeDetail() {
    await router.replace({
      query: {
        ...route.query,
        member: undefined,
        metric: undefined,
        detailEntity: undefined,
        detailPage: undefined,
      },
    });
  }
  function restoreFocus() {
    if (memberId.value || detailMetric.value) return;
    window.scrollTo({ top: returnScroll });
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  watch(context, () => {
    clearPrivate();
    memories.clear();
    error.value = '';
    changed.value = '';
  });
  watch(
    [tab, context],
    () => {
      rememberedKey = `${context.value}:${tab.value}`;
    },
    { immediate: true },
  );
  watch(
    baseKey,
    () => {
      const snapshot = data.value?.snapshot;
      if (
        snapshot &&
        (snapshot.scope.organizationId !== query.value.organizationId ||
          snapshot.scope.includeDescendants !== query.value.includeDescendants ||
          data.value?.view !== query.value.view)
      ) {
        data.value = null;
        stale.value = false;
      }
      changed.value = '';
      details.value = null;
      member.value = null;
      detailError.value = '';
      void load();
    },
    { immediate: true },
  );
  watch(detailKey, () => {
    detailSequence++;
    detailController?.abort();
    details.value = null;
    member.value = null;
    detailError.value = '';
    detailLoading.value = false;
    if (memberId.value || detailMetric.value) void loadDetail();
  });
  const focus = () => {
    if (document.visibilityState === 'visible' && !loading.value) void load();
  };
  window.addEventListener('focus', focus);
  window.addEventListener(DATASET_EVENT, clearPrivate);
  onBeforeUnmount(() => {
    disposed = true;
    clearPrivate();
    window.removeEventListener('focus', focus);
    window.removeEventListener(DATASET_EVENT, clearPrivate);
  });
  return {
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
    setPageSize,
    openMetric,
    openMember,
    closeDetail,
    restoreFocus,
  };
}
