import { pendingMaintenance, clearMaintenance } from '../maintenance-operation';
import { DATASET_EVENT } from '../data-generation';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, mutate, ApiError } from '../api';
import {
  requiredKinds,
  courseUseErrors as courseErrors,
  qualificationReadinessErrors as checkQualification,
  retiredCourses,
  type Assignment,
  type Course,
  type Qualification,
  type Kind,
  type UserView as User,
  type Workspace,
  type MaintenanceReceipt,
  type Notice,
} from '@eks/contracts';

export const useDemo = defineStore('workspace', () => {
  const anonymous: User = {
    id: '',
    name: '',
    roles: [],
    organizationId: '',
    revision: 1,
    lv1OrganizationId: '',
    organizationPath: [],
    organizationActive: false,
  };
  const empty = (): Workspace => ({
    actor: anonymous,
    eligibilitySummary: { eligible: 0, held: 0 },
    requiredQualifications: null,
    requestProgress: [],
    planningReadiness: [],
    planningOptions: [],
    planEligibility: [],
    serverDate: new Date().toISOString().slice(0, 10),
    management: {
      lv1OrganizationId: null,
      canManage: false,
      canManagePolicies: false,
      canManageEligibility: false,
      editableOrganizationIds: [],
    },
    organizations: [],
    users: [],
    courses: [],
    qualifications: [],
    qualificationPool: [],
    assignments: [],
    notices: [],
    homeNotices: [],
    audits: [],
    planningRequests: [],
    plans: [],
    notifications: [],
  });
  const data = ref<Workspace>(empty()),
    actors = ref<User[]>([]),
    sessionActor = ref<User | null>(null),
    initialized = ref(false),
    loading = ref(false),
    connectionError = ref('');
  const actor = computed(() => ({
    ...(sessionActor.value || anonymous),
    role: sessionActor.value?.roles.includes('system_operator')
      ? 'system_operator'
      : sessionActor.value?.roles.includes('admin')
        ? 'admin'
        : 'learner',
  }));
  const actorId = computed(() => actor.value.id),
    signedIn = computed(() => !!sessionActor.value);
  const hasRole = (role: User['roles'][number]) => actor.value.roles.includes(role);
  const workspaceScope = ref(''),
    contextLoading = ref(false),
    writing = ref(0);
  const fullManagement = computed(() => hasRole('admin') || hasRole('system_operator'));
  const canEnterManagement = computed(() => fullManagement.value || hasRole('organization_admin'));
  const canManageSection = (section: string) =>
    fullManagement.value ||
    (['dashboard', 'policies', 'targets'].includes(section) && hasRole('organization_admin'));
  const managementAccess = computed(
    () =>
      canEnterManagement.value &&
      (hasRole('system_operator') ||
        !workspaceScope.value ||
        workspaceScope.value === actor.value.lv1OrganizationId),
  );
  const managementLv1 = computed(() =>
    hasRole('system_operator')
      ? workspaceScope.value
      : canEnterManagement.value
        ? actor.value.lv1OrganizationId
        : '',
  );
  const managementReady = computed(
    () =>
      managementAccess.value &&
      !!managementLv1.value &&
      data.value.management.canManagePolicies &&
      data.value.management.lv1OrganizationId === managementLv1.value,
  );
  const managementOrganization = computed(() =>
    data.value.organizations.find((o) => o.id === managementLv1.value),
  );
  function managementLink(path: string, lv1 = managementLv1.value) {
    return { path, query: lv1 ? { lv1OrganizationId: lv1 } : {} };
  }
  function managementPath(path: string) {
    if (!managementReady.value) throw new Error('관리할 Lv1 조직을 먼저 선택해 주세요.');
    return `${path}${path.includes('?') ? '&' : '?'}lv1OrganizationId=${encodeURIComponent(managementLv1.value)}`;
  }
  function rememberedManagement() {
    return sessionStorage.getItem(`eks-management-${actorId.value}`) || '';
  }
  function rememberManagement(lv1: string) {
    sessionStorage.setItem(`eks-management-${actorId.value}`, lv1);
  }
  const maintenanceResult = ref<MaintenanceReceipt | null>(null);
  const toast = ref('');
  let toastTimer: ReturnType<typeof setTimeout>;
  function notify(message: string) {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ''), 4500);
  }
  let boot: Promise<void> | undefined;
  let refreshVersion = 0;
  async function refresh() {
    const version = ++refreshVersion;
    const scope = actorId.value,
      lv1 = workspaceScope.value;
    try {
      const [result, currentActors] = await Promise.all([
        api<Workspace>(`/workspace${lv1 ? `?lv1OrganizationId=${encodeURIComponent(lv1)}` : ''}`),
        api<User[]>('/actors'),
      ]);
      if (version === refreshVersion && scope === actorId.value && lv1 === workspaceScope.value) {
        data.value = result;
        sessionActor.value = result.actor;
        actors.value = currentActors;
        connectionError.value = '';
      }
    } catch (error) {
      if (version !== refreshVersion || scope !== actorId.value || lv1 !== workspaceScope.value)
        return;
      // A revoked global role can make a previously selected workspace forbidden.
      // Reload identity independently so the UI stops offering those operations.
      if (error instanceof ApiError && error.status === 403) {
        const current = await api<{ actor: User }>('/session');
        if (version === refreshVersion && scope === actorId.value && lv1 === workspaceScope.value) {
          sessionActor.value = current.actor;
        }
      }
      throw error;
    }
  }
  async function initialize() {
    if (boot) return boot;
    boot = (async () => {
      loading.value = true;
      try {
        actors.value = await api<User[]>('/actors');
        try {
          const result = await api<{ actor: User }>('/session');
          sessionActor.value = result.actor;
          await refresh();
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
          sessionActor.value = null;
        }
        initialized.value = true;
        connectionError.value = '';
      } catch (error) {
        connectionError.value = (error as Error).message;
        boot = undefined;
      } finally {
        loading.value = false;
      }
    })();
    return boot;
  }
  async function switchActor(id: string) {
    loading.value = true;
    try {
      const result = await api<{ actor: User }>('/session', {
        method: 'POST',
        body: JSON.stringify({ actorId: id }),
      });
      sessionActor.value = result.actor;
      data.value = empty();
      workspaceScope.value = '';
      await refresh();
      toast.value = '';
      maintenanceResult.value = null;
      const operationKey = pendingMaintenance();
      if (operationKey && result.actor.roles.includes('system_operator')) {
        const status = await api<{ receipt: MaintenanceReceipt | null }>(
          `/system/master-data/operations/${encodeURIComponent(operationKey)}`,
        );
        maintenanceResult.value = status.receipt;
        clearMaintenance();
      }
    } catch (error) {
      connectionError.value = (error as Error).message;
      throw error;
    } finally {
      loading.value = false;
    }
  }
  const qualification = (id: string, snapshot?: Partial<Qualification>) => ({
    ...data.value.qualifications.find((q) => q.id === id)!,
    ...snapshot,
  });
  const course = (id: string) => data.value.courses.find((c) => c.id === id)!;
  const assignment = (id: string) => data.value.assignments.find((a) => a.id === id);
  const enrollmentFor = (aid: string, cid: string) =>
    assignment(aid)?.enrollments.find((e) => e.courseId === cid);
  const myAssignments = computed(() =>
    data.value.assignments.filter((a) => a.learnerId === actorId.value && !a.excludedReason),
  );
  const notices = computed(() =>
    data.value.homeNotices.filter((n) => n.published).sort((a, b) => b.date.localeCompare(a.date)),
  );
  const complete = (e: Assignment['enrollments'][number]) => !!e.completion;
  const completedCount = (a: Assignment) => a.enrollments.filter(complete).length;
  const assessmentCount = (a: Assignment) =>
    a.enrollments.reduce((n, e) => n + requiredKinds(course(e.courseId)).length, 0);
  const passedCount = (a: Assignment) =>
    a.enrollments.reduce(
      (n, e) => n + requiredKinds(course(e.courseId)).filter((k) => e[k] === 'passed').length,
      0,
    );
  const username = (id: string | null | undefined) =>
    actors.value.find((u) => u.id === id)?.name || '미지정';
  type CommandResult = {
    newVersion?: boolean;
    version?: number;
    readiness?: string[];
    linkedQualifications?: { id: string; title: string; version: number }[];
    id: string;
    revision: number;
    assignmentId?: string;
    result?: 'passed' | 'failed';
  };
  const pendingCommands = new Map<string, { key: string; result?: CommandResult }>();
  window.addEventListener(DATASET_EVENT, () => {
    refreshVersion++;
    pendingCommands.clear();
    sessionActor.value = null;
    data.value = empty();
    workspaceScope.value = '';
    maintenanceResult.value = null;
    connectionError.value =
      '설정·기준 초기화 또는 교체로 세션이 종료되었습니다. 계정을 다시 선택해 주세요.';
    void api<User[]>('/actors')
      .then((v) => {
        actors.value = v;
      })
      .catch(() => {});
  });
  async function command(path: string, body: unknown = {}, method = 'POST') {
    const managed =
      /^\/(courses|qualifications|assignments|notices|qualification-templates)(\/|$)/.test(path) ||
      (path === '/planning-requests' && method === 'POST');
    if (managed) path = managementPath(path);
    const scope = actorId.value;
    const signature = JSON.stringify({ path, body, method, scope });
    const pending = pendingCommands.get(signature) || { key: crypto.randomUUID() };
    pendingCommands.set(signature, pending);
    writing.value++;
    try {
      // Keep a confirmed result until its updated view is loaded. A failed refresh
      // must not turn a user's retry into another mutation with a new request ID.
      if (!pending.result)
        pending.result = await mutate<CommandResult>(path, body, method, scope, pending.key);
      await refresh();
      pendingCommands.delete(signature);
      return pending.result;
    } catch (error) {
      if (!pending.result && error instanceof ApiError && error.status >= 400 && error.status < 500)
        pendingCommands.delete(signature);
      throw error;
    } finally {
      writing.value--;
    }
  }
  async function startAttempt(aid: string, cid: string, kind: Kind) {
    const e = enrollmentFor(aid, cid)!;
    await command(`/enrollments/${encodeURIComponent(e.id)}/attempts`, { kind });
    return enrollmentFor(aid, cid)!.activeAttempts[kind]!;
  }
  async function createCatalog(section: string) {
    return command(`/${section}`);
  }
  async function saveCatalog(
    section: string,
    item: Course | Qualification,
    review: { stateRevision: number; organizationRevision: number },
  ) {
    const result = await command(`/${section}/${item.id}`, { ...item, ...review }, 'PUT');
    notify(
      result.newVersion
        ? `기존 기록을 보존하고 v${result.version} 버전을 저장했습니다. 팀 적용 버전은 유지됩니다.`
        : '기준을 저장했습니다.',
    );
    return result;
  }
  async function cloneCatalog(section: string, id: string) {
    return command(
      `/${section}/${id}/versions`,
      section === 'qualifications' ? { templateRevision: qualification(id).templateRevision } : {},
    );
  }
  async function changeAssignment(a: Assignment, action: 'exclude', reason: string) {
    await command(`/assignments/${a.id}/exclusion`, {
      revision: a.revision,
      reason,
    });
    notify('검증 대상에서 제외했습니다.');
  }
  async function saveNotice(n: Notice) {
    const { id, ...values } = n;
    await command('/notices', {
      ...values,
      ...(data.value.notices.some((item) => item.id === id) ? { id } : {}),
    });
    notify('공지를 저장했습니다.');
  }
  return {
    data,
    maintenanceResult,
    actors,
    actor,
    actorId,
    initialized,
    loading,
    connectionError,
    signedIn,
    hasRole,
    workspaceScope,
    contextLoading,
    writing,
    canEnterManagement,
    fullManagement,
    canManageSection,
    managementAccess,
    managementLv1,
    managementReady,
    managementOrganization,
    managementLink,
    managementPath,
    rememberedManagement,
    rememberManagement,
    retiredCourses: (q: Qualification) => retiredCourses(q, data.value.courses),
    initialize,
    refresh,
    switchActor,
    toast,
    notify,
    qualification,
    course,
    assignment,
    enrollmentFor,
    myAssignments,
    notices,
    complete,
    completedCount,
    assessmentCount,
    passedCount,
    username,
    requiredKinds,
    courseErrors,
    qualificationErrors: (q: Qualification) => checkQualification(q, data.value.courses),
    command,
    startAttempt,
    createCatalog,
    saveCatalog,
    cloneCatalog,
    changeAssignment,
    saveNotice,
  };
});
