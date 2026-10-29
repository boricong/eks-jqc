<script setup lang="ts">
import CommonReleaseUpdates from '../components/CommonReleaseUpdates.vue';
import QualificationCommonCourses from '../components/QualificationCommonCourses.vue';
import QualificationCourseCreate from '../components/QualificationCourseCreate.vue';
import { releaseVersionLabel } from '@eks/contracts';
import type { QualificationTemplate } from '@eks/contracts';
import CourseCategory from '../components/CourseCategory.vue';
import { randomUUID } from '../uuid';
import PageHeading from '../components/PageHeading.vue';
import CompactTabs from '../components/CompactTabs.vue';
import { withCriteriaType, managementTitle } from '../management-navigation';
import ActionBar from '../components/ActionBar.vue';
import { confirmAction } from '../composables/useConfirmation';
import CourseEditor from '../components/CourseEditor.vue';
import QualificationDelete from '../components/QualificationDelete.vue';
import { api } from '../api';
import CredentialManagement from '../components/CredentialManagement.vue';
import { useProcessContext } from '../composables/useProcessContext';
import { computed, nextTick, ref, watch, onBeforeUnmount } from 'vue';
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
  type RouteLocationNormalized,
} from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
import CourseLifecycle from '../components/CourseLifecycle.vue';
import CertificationTargets from '../components/CertificationTargets.vue';
import QualificationLifecycle from '../components/QualificationLifecycle.vue';
import QualificationFields from '../components/QualificationFields.vue';
import CollapsibleSection from '../components/CollapsibleSection.vue';
import CoursePreviewDialog from '../components/CoursePreviewDialog.vue';
import '../team-qualification.css';
import { courseIssues, type CourseIssue } from '../course-editor';
import TemplateImport from '../components/TemplateImport.vue';
import ListControls from '../components/ListControls.vue';
import { useListView } from '../composables/useListView';
import PlanningPanel from '../components/PlanningPanel.vue';
import OrganizationSettings from '../components/OrganizationSettings.vue';
import ValidityBadge from '../components/ValidityBadge.vue';
import {
  kindLabels,
  qualificationVersionLabel,
  criterionLifecycleLabels,
  qualificationTypeLabels,
  qualificationReadinessErrors,
  validityErrors,
  planningDeadlineErrors,
  type QualificationType,
  AUDITOR_PREPARATION_MESSAGE,
  certificationStatus,
  kstDate,
  credentialCurrent,
  type CatalogItemSavePreview,
  type QualificationVersionMode,
} from '@eks/contracts';
import type { Assignment, Course, Notice, Qualification, AuditEvent } from '../types';
const auditorTemplates = ref<QualificationTemplate[]>([]);
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const organizationData = computed(() => {
  const data = store.data,
    root = store.managementLv1;
  const assignments = data.assignments.filter((a) => a.lv1OrganizationId === root);
  return {
    ...data,
    assignments,
    users: data.users.filter((u) => u.lv1OrganizationId === root),
    courses: data.courses.filter((c) => c.lv1OrganizationId === root),
    qualifications: data.qualifications.filter((q) => q.lv1OrganizationId === root),
    notices: data.notices.filter((n) => n.lv1OrganizationId === root),
    audits: data.audits.filter((e) => e.lv1OrganizationId === root),
  };
});
const section = computed(() => String(route.params.section));
const selectedType = computed<QualificationType>(() => {
  const item = route.params.id
    ? (section.value === 'courses'
        ? organizationData.value.courses
        : organizationData.value.qualifications
      ).find((x) => x.id === route.params.id)
    : undefined;
  return item?.qualificationType ?? (route.query.type === 'auditor' ? 'auditor' : 'auditee');
});
const typeItems = [
  { id: 'auditee', label: 'Auditee(피심사자)' },
  { id: 'auditor', label: 'Auditor(심사자)' },
];
const typeTabs = ref<InstanceType<typeof CompactTabs>>();
const criteriaLink = (path: string, type = selectedType.value) =>
  withCriteriaType(store.managementLink(path), type);
function selectType(type: string) {
  void router.push({
    path: route.path,
    query: { ...route.query, type: type === 'auditor' ? 'auditor' : undefined },
  });
}
watch(
  () => [route.path, route.query.type, selectedType.value],
  () => {
    if (!['courses', 'qualifications'].includes(section.value)) return;
    const expected = selectedType.value === 'auditor' ? 'auditor' : undefined;
    if (route.query.type !== expected)
      void router.replace({ path: route.path, query: { ...route.query, type: expected } });
  },
  { immediate: true },
);
watch(
  () => [store.actorId, store.managementLv1],
  () => {
    createOpen.value = false;
    if (
      !route.params.id &&
      ['courses', 'qualifications'].includes(section.value) &&
      route.query.type
    )
      void router.replace({ path: route.path, query: { ...route.query, type: undefined } });
  },
);
const filterKey = () =>
  `eks-admin-filter-${store.actorId}-${store.managementLv1}-${section.value}-${selectedType.value}`;
const qualificationErrors = (q: Qualification) =>
  q.qualificationType === 'auditor'
    ? qualificationReadinessErrors(q, organizationData.value.courses)
    : store.qualificationErrors(q);
const createOpen = ref(false),
  createName = ref(''),
  createError = ref('');

const title = computed(() => managementTitle(section.value));
const busy = ref(false);
const editingContext = ref('');
const query = ref(''),
  filter = ref('all'),
  errors = ref<string[]>([]);
const validationShown = ref(false);
const courseEditor = ref<InstanceType<typeof CourseEditor>>();
const courseCreator = ref<InstanceType<typeof QualificationCourseCreate>>();
const courseCreateOpen = ref(false);
const savePreview = ref<CatalogItemSavePreview | null>(null);
const versionMode = ref<QualificationVersionMode>('current');
const previewPending = ref(false),
  previewError = ref('');
let previewGeneration = 0;
const saveTrigger = ref<HTMLButtonElement>();
let saveReturnTarget: HTMLElement | null = null;
const savedLinks = ref<{ id: string; title: string; version: number }[]>([]);
const listHeading = ref<HTMLElement>();
const courseSaveResult = ref<{
  actor: string;
  organization: string;
  id: string;
  title: string;
  version: number;
  releaseVersion?: { major: number; minor: number } | null;
  readiness: string[];
  links: { id: string; title: string; version: number }[];
  newVersion: boolean;
  qualificationType: QualificationType;
} | null>(null);
const locatedIssues = computed(() =>
  validationShown.value && courseDraft.value ? courseIssues(courseDraft.value) : [],
);
const courseDraft = ref<Course | null>(null),
  qualificationDraft = ref<
    (Qualification & { commonCourseAdditions?: { id: string; revision: number }[] }) | null
  >(null);
watch(
  () => [courseDraft.value?.id, courseDraft.value?.qualificationType],
  async ([id, type], [previousId, previousType]) => {
    const target = courseDraft.value;
    if (!target || id !== previousId || type !== 'auditor' || previousType !== 'auditee') return;
    if (!target.subjectiveEnabled && !target.subjectiveQuestions.length) return;
    const confirmed = await confirmAction(
      'Auditor는 주관식 평가를 사용하지 않습니다. 작성한 주관식 문항을 제외하고 Auditor로 변경할까요?',
      '주관식 제외 후 변경',
    );
    if (courseDraft.value !== target) return;
    if (confirmed) {
      target.subjectiveEnabled = false;
      target.subjectiveQuestions = [];
    } else target.qualificationType = 'auditee';
  },
);
const previewCourseId = ref('');
const previewCourse = computed(
  () =>
    organizationData.value.courses.find((course) => course.id === previewCourseId.value) || null,
);
const qualificationContext = computed(
  () => `${store.actorId}:${store.managementLv1}:${qualificationDraft.value?.id || ''}`,
);
watch(qualificationContext, () => {
  previewCourseId.value = '';
});
const validitySummary = computed(() => {
  const policy = qualificationDraft.value?.validity;
  if (policy?.type === 'unlimited') return '무기한';
  if (policy?.type === 'months' && policy.months) return `취득 후 ${policy.months}개월`;
  return '인증기간 미정';
});
watch(locatedIssues, (issues) => {
  if (validationShown.value && courseDraft.value)
    errors.value = [
      ...new Set([...store.courseErrors(courseDraft.value), ...issues.map((i) => i.message)]),
    ];
});
const editor = computed(() => courseDraft.value || qualificationDraft.value);
const qualificationValidityErrors = computed(() =>
  qualificationDraft.value && qualificationDraft.value.purpose !== 'renewal'
    ? [
        ...validityErrors(qualificationDraft.value.validity),
        ...planningDeadlineErrors(qualificationDraft.value),
      ]
    : [],
);
const relatedVersions = computed(() =>
  editor.value
    ? (courseDraft.value ? organizationData.value.courses : organizationData.value.qualifications)
        .filter((v) => v.entityId === editor.value!.entityId)
        .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
    : [],
);
const readOnly = computed(
  () =>
    !!editor.value?.deletedAt ||
    relatedVersions.value.some(
      (v) => !v.deletedAt && (v.version ?? 0) > (editor.value?.version ?? 0),
    ),
);
const courseVersionSelect = ref<HTMLSelectElement>();
const selectingCourseVersion = ref(false);
const latestRelatedVersion = computed(() => relatedVersions.value.find((v) => !v.deletedAt));
const versionContext = () => `${store.actorId}:${store.managementLv1}:${route.fullPath}`;
const courseDraftFingerprint = () =>
  JSON.stringify([courseDraft.value, !!courseEditor.value?.pending]);
let confirmedVersionNavigation: {
  from: string;
  to: string;
  context: string;
  fingerprint: string;
} | null = null;
function courseVersionLabel(version: Course | Qualification) {
  return `${releaseVersionLabel(version)} · ${version.title || '이름 없는 인증Set'} · ${version.deletedAt ? '삭제됨 · 읽기 전용' : version.id === latestRelatedVersion.value?.id ? '최신' : '과거 · 읽기 전용'}`;
}
async function viewCourseVersion(event: Event) {
  const input = event.target as HTMLSelectElement,
    id = input.value;
  input.value = courseDraft.value?.id || '';
  if (
    !courseDraft.value ||
    id === courseDraft.value.id ||
    selectingCourseVersion.value ||
    busy.value ||
    store.writing ||
    previewPending.value ||
    savePreview.value
  )
    return;
  const target = relatedVersions.value.find((v) => v.id === id);
  if (!target) return;
  const actor = store.actorId,
    scope = store.managementLv1;
  const context = versionContext(),
    fingerprint = courseDraftFingerprint(),
    from = route.fullPath;
  const historical = target.deletedAt || target.id !== latestRelatedVersion.value?.id;
  const source = organizationData.value.courses.find((c) => c.id === courseDraft.value!.id);
  if (!source) return;
  const dirty =
    !!courseEditor.value?.pending ||
    JSON.stringify(plain(source)) !== JSON.stringify(courseDraft.value);
  selectingCourseVersion.value = true;
  try {
    if (
      historical &&
      !(await confirmAction(
        [
          `${target.title || '이름 없는 인증Set'} ${releaseVersionLabel(target)}을 읽기 전용으로 조회할까요?`,
          ...(dirty
            ? ['저장하지 않은 변경 사항은 버리고 이동합니다. 취소하면 입력을 유지합니다.']
            : []),
        ].join('\n'),
        '조회',
        '과거 버전 조회 확인',
      ))
    )
      return;
    if (
      versionContext() !== context ||
      courseDraftFingerprint() !== fingerprint ||
      !relatedVersions.value.some((v) => v.id === id)
    )
      return;
    const destination = criteriaLink(`/admin/courses/${id}`, target.qualificationType);
    if (historical)
      confirmedVersionNavigation = {
        from,
        to: router.resolve(destination).fullPath,
        context,
        fingerprint,
      };
    await router.push(destination);
  } catch (error) {
    if (versionContext() === context) errors.value = [(error as Error).message];
  } finally {
    confirmedVersionNavigation = null;
    selectingCourseVersion.value = false;
    await nextTick();
    if (
      store.actorId === actor &&
      store.managementLv1 === scope &&
      (versionContext() === context || route.params.id === id)
    )
      courseVersionSelect.value?.focus();
  }
}
useProcessContext(() => (editor.value ? (readOnly.value ? 'readonly' : 'editing') : 'list'));
const selectedAssignment = ref<Assignment | null>(null),
  assignmentAction = ref<'exclude'>('exclude'),
  reason = ref('');
const noticeDraft = ref<Notice | null>(null);
function plain<T>(item: T): T {
  return JSON.parse(
    JSON.stringify(item, (key, value) => (key === 'typeEditing' ? undefined : value)),
  );
}
function enrollmentPhase(enrollment: Assignment['enrollments'][number]) {
  if (store.course(enrollment.courseId).qualificationType === 'auditor')
    return enrollment.completion
      ? '수료'
      : enrollment.checklist?.items.length
        ? '학습 확인 중'
        : '학습 미확인';
  return enrollment.completion
    ? '수료'
    : [enrollment.objective, enrollment.practical].includes('passed')
      ? '일부 통과'
      : enrollment.history.length || Object.keys(enrollment.activeAttempts).length
        ? '평가 중'
        : '평가 전';
}
watch(
  () => [route.fullPath, store.actorId, store.managementLv1],
  () => {
    const reviewSavedCourse =
      !!courseSaveResult.value &&
      courseSaveResult.value.id === route.params.id &&
      courseSaveResult.value.actor === store.actorId &&
      courseSaveResult.value.organization === store.managementLv1;
    if (
      courseSaveResult.value &&
      (section.value !== 'courses' ||
        route.params.id ||
        courseSaveResult.value.actor !== store.actorId ||
        courseSaveResult.value.organization !== store.managementLv1 ||
        courseSaveResult.value.qualificationType !== selectedType.value)
    )
      courseSaveResult.value = null;
    if (
      editingContext.value === `${store.actorId}:${store.managementLv1}` &&
      editor.value &&
      route.params.id === editor.value.id &&
      section.value === (courseDraft.value ? 'courses' : 'qualifications')
    )
      return;
    createOpen.value = false;
    courseCreateOpen.value = false;
    editingContext.value = `${store.actorId}:${store.managementLv1}`;
    savePreview.value = null;
    previewGeneration++;
    previewPending.value = false;
    previewError.value = '';
    savedLinks.value = [];
    selectedAssignment.value = null;
    noticeDraft.value = null;
    reason.value = '';
    errors.value = [];
    validationShown.value = reviewSavedCourse;
    courseDraft.value = null;
    qualificationDraft.value = null;
    if (route.params.id && section.value === 'courses') {
      const c = organizationData.value.courses.find((c) => c.id === route.params.id);
      if (c) {
        courseDraft.value = plain(c);
      }
    }
    if (route.params.id && section.value === 'qualifications') {
      const q = organizationData.value.qualifications.find((q) => q.id === route.params.id);
      if (q) qualificationDraft.value = plain(q);
    }
  },
  { immediate: true },
);
const categoryFilter = ref('all');
const matches = (text: string) => text.toLowerCase().includes(query.value.toLowerCase());
const qualifications = computed(() =>
  organizationData.value.qualifications.filter(
    (q) =>
      matches(q.title) &&
      q.qualificationType === selectedType.value &&
      (filter.value === 'deleted'
        ? !!q.deletedAt
        : !q.deletedAt &&
          (filter.value === 'all' || (q.lifecycleStatus || 'Active') === filter.value)),
  ),
);
const latestCourses = computed(() => {
  const byEntity = new Map<string, Course>();
  for (const course of organizationData.value.courses) {
    if (course.deletedAt) continue;
    const previous = byEntity.get(course.entityId);
    if (!previous || course.version > previous.version) byEntity.set(course.entityId, course);
  }
  return [...byEntity.values()];
});
const courses = computed(() =>
  latestCourses.value.filter(
    (c) =>
      c.qualificationType === selectedType.value &&
      (categoryFilter.value === 'all' || c.category === categoryFilter.value) &&
      matches(c.title) &&
      (filter.value === 'all' ||
        (filter.value === 'active' && c.operationalStatus !== 'retired') ||
        (filter.value === 'retired' && c.operationalStatus === 'retired')),
  ),
);
const selectableCourses = computed(() => {
  const selected = new Set(qualificationDraft.value?.courseIds || []);
  return organizationData.value.courses
    .filter((c) => selected.has(c.id) || !c.deletedAt)
    .filter((c) => c.qualificationType === qualificationDraft.value?.qualificationType)
    .filter(
      (c) =>
        c.category !== 'common' ||
        qualificationDraft.value?.commonCourseEntityIds.includes(c.entityId),
    )
    .filter(
      (c) =>
        c.category !== 'common' ||
        selected.has(c.id) ||
        !organizationData.value.courses.some(
          (other) => other.entityId === c.entityId && other.version > c.version && !other.deletedAt,
        ),
    )
    .slice()
    .sort(
      (a, b) =>
        Number(selected.has(b.id)) - Number(selected.has(a.id)) ||
        a.title.localeCompare(b.title, 'ko'),
    );
});
const groupedCourses = computed(() => [
  ...(!store.hasRole('system_operator')
    ? [
        {
          title: '공통인증Set',
          category: 'common',
          items: selectableCourses.value.filter((c) => c.category === 'common'),
        },
      ]
    : []),
  {
    title: store.hasRole('system_operator') ? '적용 인증Set' : '적용 특화인증Set',
    category: 'applied',
    items: selectableCourses.value.filter(
      (c) =>
        qualificationDraft.value?.courseIds.includes(c.id) &&
        (store.hasRole('system_operator') || c.category === 'specialized'),
    ),
  },
  ...[
    ...(store.hasRole('system_operator')
      ? [{ title: '추가할 공통인증Set', category: 'common' }]
      : []),
    { title: '추가할 특화인증Set', category: 'specialized' },
  ].map((g) => ({
    ...g,
    items: selectableCourses.value.filter(
      (c) => c.category === g.category && !qualificationDraft.value?.courseIds.includes(c.id),
    ),
  })),
]);
const confirmInitial = computed(
  () =>
    qualificationDraft.value?.version === null &&
    (!!qualificationDraft.value.commonCourseEntityIds.length ||
      !!qualificationDraft.value.commonCourseAdditions?.length),
);
const resultAssignmentId = computed(() =>
  section.value === 'results' ? String(route.params.id || route.query.assignmentId || '') : '',
);
const assignments = computed(() =>
  organizationData.value.assignments.filter(
    (a) =>
      (section.value !== 'assignments' || !a.renewalBatchId) &&
      (resultAssignmentId.value
        ? a.id === resultAssignmentId.value
        : matches(
            store.qualification(a.qualificationId, a.qualificationMetadata).title +
              ' ' +
              store.username(a.learnerId),
          ) &&
          (filter.value === 'all' ||
            (filter.value === 'excluded' && !!a.excludedReason) ||
            (filter.value === 'active' && !a.excludedReason && !a.certifiedAt) ||
            (filter.value === 'certified' && !a.excludedReason && !!a.certifiedAt) ||
            (!a.excludedReason &&
              a.certification &&
              (filter.value === 'valid'
                ? ['valid', 'expiring'].includes(certificationStatus(a.certification))
                : filter.value === certificationStatus(a.certification))))),
  ),
);
const notices = computed(() => organizationData.value.notices.filter((n) => matches(n.title)));
const listItems = computed<Array<Qualification | Course | Assignment | Notice>>(() =>
  section.value === 'qualifications'
    ? qualifications.value
    : section.value === 'courses'
      ? courses.value
      : section.value === 'notices'
        ? notices.value
        : assignments.value,
);
const list = useListView(listItems, 'admin', (item) =>
  'title' in item ? item.title : store.username(item.learnerId),
);
let restoringFilters = false;
let activeFilterKey = '';
watch(
  () => filterKey(),
  (key) => {
    restoringFilters = true;
    let saved: { query?: string; filter?: string; size?: number; sort?: string } = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) || '{}');
    } catch {}
    activeFilterKey = key;
    query.value = saved.query || '';
    filter.value = ['draft', 'published'].includes(saved.filter || '')
      ? 'all'
      : saved.filter || (section.value === 'courses' ? 'active' : 'all');
    list.size = [25, 50, 100].includes(saved.size || 0) ? saved.size! : 25;
    list.sort = ['original', 'asc', 'desc'].includes(saved.sort || '') ? saved.sort! : 'original';
    list.page = 1;
    restoringFilters = false;
  },
  { immediate: true, flush: 'sync' },
);
watch(
  [query, filter, () => list.size, () => list.sort],
  () => {
    if (restoringFilters || activeFilterKey !== filterKey()) return;
    list.page = 1;
    localStorage.setItem(
      activeFilterKey,
      JSON.stringify({
        query: query.value,
        filter: filter.value,
        size: list.size,
        sort: list.sort,
      }),
    );
  },
  { flush: 'sync' },
);
const pageQualifications = computed(() => list.rows as Qualification[]),
  pageCourses = computed(() => list.rows as Course[]),
  pageAssignments = computed(() => list.rows as Assignment[]),
  pageNotices = computed(() => list.rows as Notice[]);
async function createCatalog() {
  if (busy.value || !createName.value.trim()) return;
  createError.value = '';
  busy.value = true;
  try {
    const actor = store.actorId,
      scope = store.managementLv1,
      type = selectedType.value;
    const result = await store.createCatalog(section.value, {
      qualificationType: type,
      title: createName.value.trim(),
    });
    if (actor !== store.actorId || scope !== store.managementLv1) return;
    createOpen.value = false;
    await router.push(criteriaLink(`/admin/${section.value}/${result.id}`, type));
  } catch (error) {
    createError.value = (error as Error).message;
  } finally {
    busy.value = false;
  }
}
function closeSavePreview() {
  if (busy.value) return;
  saveReturnTarget = saveTrigger.value || null;
  previewGeneration++;
  previewPending.value = false;
  savePreview.value = null;
  previewError.value = '';
}
function restoreSaveFocus() {
  if (saveReturnTarget?.isConnected) saveReturnTarget.focus();
  saveReturnTarget = null;
}
async function reviewSave(mode: QualificationVersionMode = versionMode.value) {
  if (!editor.value || readOnly.value || busy.value || qualificationValidityErrors.value.length)
    return;
  const sequence = ++previewGeneration;
  const context = `${store.actorId}:${store.managementLv1}:${editor.value.id}`;
  versionMode.value = mode;
  previewPending.value = true;
  previewError.value = '';
  errors.value = [];
  try {
    const preview = await api<CatalogItemSavePreview>(
      store.managementPath(`/${section.value}/${editor.value.id}/save-preview`),
      {
        method: 'POST',
        body: JSON.stringify({
          ...plain(editor.value),
          ...(section.value === 'qualifications'
            ? { confirmInitialConfiguration: confirmInitial.value }
            : {}),
        }),
      },
    );
    if (
      sequence !== previewGeneration ||
      context !== `${store.actorId}:${store.managementLv1}:${editor.value?.id}`
    )
      return;
    savePreview.value = preview;
    if (preview.versionPolicy) versionMode.value = preview.versionPolicy.effectiveMode;
  } catch (error) {
    if (sequence === previewGeneration) {
      previewError.value = (error as Error).message;
      errors.value = [previewError.value];
    }
  } finally {
    if (sequence === previewGeneration) previewPending.value = false;
  }
}
async function saveCatalog(confirm = false) {
  if (
    !editor.value ||
    readOnly.value ||
    busy.value ||
    previewPending.value ||
    qualificationValidityErrors.value.length
  )
    return;
  if (courseEditor.value && !courseEditor.value.commit()) return;
  if (!confirm) {
    await reviewSave('current');
    return;
  }
  if (!savePreview.value || previewError.value) return;
  const context = `${store.actorId}:${store.managementLv1}:${editor.value.id}`;
  busy.value = true;
  errors.value = [];
  try {
    const result = await store.saveCatalog(section.value, plain(editor.value), {
      confirmInitialConfiguration: confirmInitial.value,
      stateRevision: savePreview.value.stateRevision,
      organizationRevision: savePreview.value.organizationRevision,
    });
    if (context !== `${store.actorId}:${store.managementLv1}:${editor.value?.id}`) return;
    savePreview.value = null;
    savedLinks.value = result.linkedQualifications || [];
    if (courseDraft.value) {
      const saved = store.course(result.id);
      courseDraft.value = plain(saved);
      courseSaveResult.value = {
        actor: store.actorId,
        organization: store.managementLv1,
        id: saved.id,
        title: saved.title || '이름 없는 인증Set',
        qualificationType: saved.qualificationType,
        version: saved.version,
        releaseVersion: saved.releaseVersion,
        readiness: result.readiness || [],
        links: result.linkedQualifications || [],
        newVersion: !!result.newVersion,
      };
      await router.replace(criteriaLink('/admin/courses', saved.qualificationType));
      await nextTick();
      // Apply the contextual destination after the router's general main focus.
      requestAnimationFrame(() => {
        if (
          section.value === 'courses' &&
          !route.params.id &&
          courseSaveResult.value?.id === saved.id
        )
          listHeading.value?.focus();
      });
      return;
    }
    qualificationDraft.value = plain(store.qualification(result.id));
    await router.replace(
      criteriaLink('/admin/qualifications', qualificationDraft.value.qualificationType),
    );
    await nextTick();
    requestAnimationFrame(() => {
      if (section.value === 'qualifications' && !route.params.id) listHeading.value?.focus();
    });
    validationShown.value = true;
    errors.value = result.readiness || [];
  } catch (error) {
    errors.value = [(error as Error).message];
  } finally {
    busy.value = false;
  }
}
async function focusIssue(issue: CourseIssue) {
  await courseEditor.value?.focusIssue(issue);
}
async function reloadCatalog() {
  if (!(await confirmAction('저장하지 않은 내용을 버리고 다시 불러올까요?', '다시 불러오기')))
    return;
  try {
    await store.refresh();
    if (courseDraft.value) courseDraft.value = plain(store.course(courseDraft.value.id));
    else if (qualificationDraft.value)
      qualificationDraft.value = plain(store.qualification(qualificationDraft.value.id));
    errors.value = [];
  } catch (error) {
    errors.value = [(error as Error).message];
  }
}
function openAssignment(a: Assignment, action: 'exclude') {
  selectedAssignment.value = a;
  assignmentAction.value = action;
  reason.value = '';
  errors.value = [];
}
async function changeAssignment() {
  if (busy.value) return;
  busy.value = true;
  try {
    await store.changeAssignment(
      selectedAssignment.value!,
      assignmentAction.value,
      reason.value.trim(),
    );
    selectedAssignment.value = null;
    errors.value = [];
  } catch (error) {
    errors.value = [(error as Error).message];
  } finally {
    busy.value = false;
  }
}
function selectCourseVersion(id: string, selected: boolean) {
  const q = qualificationDraft.value;
  if (!q) return;
  const course = store.data.courses.find((c) => c.id === id);
  if (course?.category === 'common' && !store.hasRole('system_operator')) return;
  const entity = course?.entityId;
  q.courseIds = q.courseIds.filter(
    (old) =>
      old !== id &&
      (!selected || store.data.courses.find((c) => c.id === old)?.entityId !== entity),
  );
  if (selected) q.courseIds.push(id);
  void nextTick(() =>
    document.querySelector<HTMLInputElement>(`[data-course-id="${id}"] input`)?.focus(),
  );
}
function addCreatedCourse(id: string) {
  if (qualificationDraft.value && !qualificationDraft.value.courseIds.includes(id))
    qualificationDraft.value.courseIds.push(id);
}
function finishUnchanged() {
  closeSavePreview();
  if (!qualificationDraft.value) return;
  qualificationDraft.value = plain(store.qualification(qualificationDraft.value.id));
  void router
    .push(criteriaLink('/admin/qualifications', qualificationDraft.value.qualificationType))
    .then(async () => {
      await nextTick();
      requestAnimationFrame(() => listHeading.value?.focus());
    });
}
const qualificationDirty = computed(
  () =>
    !!qualificationDraft.value &&
    JSON.stringify(qualificationDraft.value) !==
      JSON.stringify(plain(store.qualification(qualificationDraft.value.id))),
);
function beforeUnload(event: BeforeUnloadEvent) {
  if (!qualificationDirty.value && !courseCreator.value?.dirty && !courseCreator.value?.pending)
    return;
  event.preventDefault();
  event.returnValue = '';
}
window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
function editNotice(n?: Notice) {
  noticeDraft.value = n
    ? plain(n)
    : {
        id: randomUUID(),
        scope: 'team',
        lv1OrganizationId: store.managementLv1,
        title: '',
        body: '',
        date: store.data.serverDate,
        published: true,
        revision: 1,
      };
  errors.value = [];
}
async function saveNotice() {
  if (!noticeDraft.value || busy.value) return;
  busy.value = true;
  try {
    await store.saveNotice(plain(noticeDraft.value));
    noticeDraft.value = null;
    errors.value = [];
  } catch (error) {
    errors.value = [(error as Error).message];
  } finally {
    busy.value = false;
  }
}
const labels = kindLabels;
const auditLabels: Record<string, string> = {
  'assignment.create': '자격 배정',
  'assignment.exclude': '검증 제외',
  'attempt.start': '평가 시작',
  'attempt.submit': '평가 확정',
  'plan.complete': '개인 계획 완료 · 결재 생략',
  'plan.save': '개인 계획 수정',
  'learning.save': '과거 학습 완료 기록',
  seed: '초기 데이터',
  'comparison.create': '비교 초안',
  'comparison.save': '비교 저장',
  'comparison.finalize': '비교 확정',
  'comparison.correct': '비교 정정',
};
async function refreshCommon() {
  if (!qualificationDraft.value) return;
  const id = qualificationDraft.value.id,
    actor = store.actorId,
    scope = store.managementLv1;
  try {
    await store.refresh();
    if (
      actor !== store.actorId ||
      scope !== store.managementLv1 ||
      qualificationDraft.value?.id !== id
    )
      return;
    const q = store.qualification(id);
    Object.assign(qualificationDraft.value, {
      title: q.title,
      qualificationType: q.qualificationType,
      englishName: q.englishName,
      description: q.description,
      templateId: q.templateId,
      templateRevision: q.templateRevision,
    });
    savePreview.value = null;
    errors.value = [];
  } catch (e) {
    errors.value = [(e as Error).message];
  }
}
async function canLeave(to: RouteLocationNormalized, from: RouteLocationNormalized) {
  if (!store.managementAccess) return true;
  const source = courseDraft.value
    ? organizationData.value.courses.find((c) => c.id === courseDraft.value!.id)
    : qualificationDraft.value
      ? organizationData.value.qualifications.find((q) => q.id === qualificationDraft.value!.id)
      : null;
  if (store.writing || courseCreator.value?.pending) {
    store.notify('저장이 끝난 뒤 이동해 주세요.');
    return false;
  }
  const confirmed = confirmedVersionNavigation;
  confirmedVersionNavigation = null;
  if (
    confirmed &&
    confirmed.from === from.fullPath &&
    confirmed.to === to.fullPath &&
    confirmed.context === versionContext() &&
    confirmed.fingerprint === courseDraftFingerprint()
  )
    return true;
  if (
    (noticeDraft.value ||
      selectedAssignment.value ||
      (createOpen.value && createName.value.trim())) &&
    !(await confirmAction(
      '작성 중인 입력이 있습니다. 저장하려면 취소를 누르세요. 변경을 버리고 나갈까요?',
      '변경 버리고 이동',
    ))
  )
    return false;
  return (
    !store.canEnterManagement ||
    !editor.value ||
    (readOnly.value && !qualificationDirty.value && !courseCreator.value?.dirty) ||
    (!courseEditor.value?.pending &&
      !courseCreator.value?.dirty &&
      JSON.stringify(plain(source)) === JSON.stringify(editor.value)) ||
    (await confirmAction(
      '저장하지 않은 변경 사항이 있습니다. 저장하려면 취소를 누르세요. 변경을 버리고 나갈까요?',
      '변경 버리고 이동',
    ))
  );
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
let auditorTemplateSequence = 0;
watch(
  [
    () => store.managementLv1,
    () => store.actorId,
    () => qualificationDraft.value?.qualificationType,
  ],
  async () => {
    const seq = ++auditorTemplateSequence;
    auditorTemplates.value = [];
    if (qualificationDraft.value?.qualificationType !== 'auditor' || !store.managementLv1) return;
    try {
      const result = await api<QualificationTemplate[]>(
        store.managementPath('/qualification-templates'),
      );
      if (seq === auditorTemplateSequence) auditorTemplates.value = result;
    } catch {}
  },
  { immediate: true },
);
</script>
<template>
  <AppDialog
    :open="createOpen"
    @update:open="
      (value) => {
        if (!busy) createOpen = value;
      }
    "
    :title="`${qualificationTypeLabels[selectedType]} 특화인증Set 만들기`"
  >
    <p class="muted">{{ qualificationTypeLabels[selectedType] }} 전용 인증Set을 만듭니다.</p>
    <label v-if="createOpen" class="field"
      >인증Set명<input v-model="createName" maxlength="300" :disabled="busy"
    /></label>
    <p v-if="createError" class="error-message" role="alert">{{ createError }}</p>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="createOpen = false">취소</button
      ><button class="button primary" :disabled="busy || !createName.trim()" @click="createCatalog">
        생성 후 편집
      </button></template
    >
  </AppDialog>
  <div class="admin-section" :class="{ 'individual-editor': !!editor }">
    <div v-if="!store.managementReady && section !== 'organization-settings'" class="empty-state">
      관리할 Lv1 조직을 선택하면 인증 업무를 관리할 수 있습니다.
    </div>
    <div v-else class="admin-content">
      <div
        v-if="errors.length && !editor && !selectedAssignment && !noticeDraft"
        class="error-message"
        role="alert"
      >
        {{ errors.join(' · ') }}
      </div>
      <template v-if="editor">
        <RouterLink :to="criteriaLink(`/admin/${section}`)" class="back-link"
          ><AppIcon name="back" :size="16" />{{ title }}</RouterLink
        >
        <PageHeading class="page-heading">
          <h1>{{ editor.title || (courseDraft ? '새 인증Set' : '새 자격') }}</h1>
          <div v-if="courseDraft || qualificationDraft?.version !== null" class="actions">
            <RouterLink
              v-if="qualificationDraft && qualificationDraft.version !== null"
              class="button secondary"
              :to="criteriaLink(`/admin/qualifications/${qualificationDraft.id}`)"
              >조회</RouterLink
            >
            <CourseCategory
              v-if="courseDraft"
              :course="
                organizationData.courses.find((c) => c.id === courseDraft?.id) || courseDraft
              "
            /><span v-if="courseDraft" class="small-label">{{
              qualificationTypeLabels[selectedType]
            }}</span>
            <span v-if="editor.deletedAt" class="muted"
              >삭제된 항목 · {{ editor.deletionReason }}</span
            >
          </div>
        </PageHeading>
        <p v-if="qualificationDraft && readOnly" class="qualification-save-notice" role="status">
          저장된 기준이 변경되어 이 초안은 저장할 수 없습니다. 작성 중인 값은 화면에 유지됩니다.
          <RouterLink
            v-if="relatedVersions.find((v) => !v.deletedAt)"
            class="text-link"
            :to="
              criteriaLink(`/admin/qualifications/${relatedVersions.find((v) => !v.deletedAt)!.id}`)
            "
            >최신 기준 조회</RouterLink
          >
        </p>
        <div v-if="errors.length" class="error-message editor-errors" role="alert" tabindex="-1">
          <AppIcon name="alert" :size="18" />
          <ul>
            <template v-if="locatedIssues.length"
              ><li v-for="(issue, i) in locatedIssues" :key="i">
                <button type="button" class="text-link" @click="focusIssue(issue)">
                  {{ issue.message }}
                </button>
              </li></template
            ><template v-else
              ><li v-for="error in errors" :key="error">{{ error }}</li></template
            >
          </ul>
        </div>
        <button v-if="errors.length" class="button secondary" @click="reloadCatalog">
          다시 불러오기
        </button>
        <p v-if="courseDraft?.qualificationType === 'auditor'" class="qualification-save-notice">
          {{ AUDITOR_PREPARATION_MESSAGE }}
        </p>
        <div v-if="courseDraft" class="course-editor-meta">
          <label v-if="courseDraft" class="field course-version-control">
            <span>조회 버전</span>
            <select
              ref="courseVersionSelect"
              aria-label="조회 버전"
              :value="courseDraft.id"
              :title="courseVersionLabel(courseDraft)"
              :disabled="
                busy || previewPending || !!savePreview || !!store.writing || selectingCourseVersion
              "
              @change="viewCourseVersion"
            >
              <option v-for="version in relatedVersions" :key="version.id" :value="version.id">
                {{ courseVersionLabel(version) }}
              </option>
            </select>
          </label>
          <CourseLifecycle
            v-if="courseDraft && !readOnly"
            :key="courseDraft.id"
            :course="store.course(courseDraft.id) || courseDraft"
            :disabled="
              busy ||
              JSON.stringify(courseDraft) !==
                JSON.stringify(plain(store.course(courseDraft.id) || courseDraft))
            "
            @changed="courseDraft = plain(store.course(courseDraft.id))"
            @deleted="
              courseDraft = null;
              router.push(criteriaLink('/admin/courses'));
            "
          />
        </div>
        <p v-if="courseDraft && readOnly" class="qualification-save-notice" role="status">
          {{ courseDraft.deletedAt ? '삭제된 버전' : '과거 버전' }}을 읽기 전용으로 조회 중입니다.
        </p>
        <div
          v-if="qualificationDraft"
          :key="qualificationContext"
          class="team-qualification-detail"
        >
          <button
            v-if="
              qualificationDraft.qualificationType === 'auditee' &&
              qualificationDraft.purpose !== 'renewal' &&
              !qualificationDraft.deletedAt
            "
            class="button secondary"
            :disabled="
              busy ||
              JSON.stringify(qualificationDraft) !==
                JSON.stringify(plain(store.qualification(qualificationDraft.id)))
            "
            @click="
              router.push({
                path: '/admin/organization-requirements',
                query: {
                  ...store.managementLink('/admin/organization-requirements').query,
                  view: 'qualification',
                  entityId: qualificationDraft.entityId,
                },
              })
            "
          >
            필요 조직 설정
          </button>
          <p
            v-if="qualificationDraft.qualificationType === 'auditor'"
            class="qualification-save-notice"
          >
            {{ AUDITOR_PREPARATION_MESSAGE }}
            등급:
            {{
              qualificationDraft.auditorCriteria?.level === 'general'
                ? '일반'
                : qualificationDraft.auditorCriteria?.level === 'main'
                  ? '메인'
                  : '미지정 · 시스템 운영자 보완 필요'
            }}.
            <span v-if="qualificationDraft.auditorCriteria?.prerequisiteTemplateId"
              >선행 일반 자격:
              {{
                auditorTemplates.find(
                  (t) => t.id === qualificationDraft!.auditorCriteria?.prerequisiteTemplateId,
                )?.title || '기본자격 목록 확인'
              }}.</span
            >
            등급과 선행 조건은 기본자격에서 지정합니다.
          </p>
          <QualificationLifecycle
            v-if="qualificationDraft && qualificationDraft.version !== null && !readOnly"
            :qualification="store.qualification(qualificationDraft.id)"
            :disabled="
              busy ||
              (!readOnly &&
                JSON.stringify(qualificationDraft) !==
                  JSON.stringify(store.qualification(qualificationDraft.id)))
            "
            @changed="qualificationDraft = plain(store.qualification(qualificationDraft.id))"
            @version-created="(id) => router.push(criteriaLink(`/admin/qualifications/${id}`))"
          />
          <p
            v-if="qualificationDraft.version === null && !readOnly"
            class="qualification-save-notice"
          >
            Ready · 대기 — 최초 기준을 저장하면 v1부터 시작합니다.
          </p>
          <p
            v-if="qualificationDraft && store.retiredCourses(qualificationDraft).length"
            class="error-message"
          >
            신규 배정 불가 ·
            {{
              store
                .retiredCourses(qualificationDraft)
                .map((c) => `${c.title} ${releaseVersionLabel(c)}`)
                .join(', ')
            }}
            운영 종료.
            {{
              !store.hasRole('system_operator') &&
              store.retiredCourses(qualificationDraft).some((c) => c.category === 'common')
                ? '공통인증Set의 운영 구성을 시스템 운영자에게 확인해 주세요. 종료된 특화인증Set은 제거하거나 대체할 수 있습니다.'
                : readOnly
                  ? '새 버전에서 종료 인증Set을 제거하거나 대체해 주세요.'
                  : '신규 운영 전에 종료 인증Set을 제거하거나 대체해 주세요.'
            }}
          </p>
          <CollapsibleSection title="공통 정보" class="editor-panel">
            <dl class="property-list team-qualification-facts">
              <div class="team-qualification-title">
                <dt>자격명</dt>
                <dd>
                  {{ qualificationDraft.title
                  }}<span v-if="qualificationDraft.englishName" class="muted">
                    · {{ qualificationDraft.englishName }}</span
                  >
                </dd>
              </div>
              <div v-if="qualificationDraft.description" class="team-qualification-description">
                <dt>공통 설명</dt>
                <dd>
                  {{ qualificationDraft.description }}
                </dd>
              </div>
            </dl>
            <button
              v-if="errors.length"
              class="button secondary"
              :disabled="busy"
              @click="refreshCommon"
            >
              공통 정보 다시 확인
            </button>
          </CollapsibleSection>
          <CollapsibleSection v-if="qualificationDraft.purpose !== 'renewal'" title="팀 설정">
            <template #summary>{{ validitySummary }}</template>
            <QualificationFields :qualification="qualificationDraft" :disabled="readOnly || busy" />
          </CollapsibleSection>
          <p v-if="qualificationDraft.purpose === 'renewal'" class="muted">
            재인증 · 객관식 전용 인증Set 1개
          </p>
          <CollapsibleSection title="필수 인증Set">
            <template #summary
              >{{
                qualificationDraft.courseIds.length +
                (qualificationDraft.commonCourseAdditions?.length ?? 0)
              }}개 선택</template
            >
            <p
              v-if="!store.hasRole('system_operator')"
              id="qualification-common-policy"
              class="muted qualification-common-policy"
            >
              사전 적용된 공통인증Set은 사용 해제할 수 없습니다. 특화인증Set만 추가·제거할 수
              있습니다.
            </p>
            <fieldset class="course-selection">
              <legend class="sr-only">필수 인증Set 선택</legend>
              <div
                v-for="group in groupedCourses"
                :key="group.category"
                class="course-selection-list"
              >
                <div class="team-qualification-course-heading">
                  <h3>{{ group.title }}</h3>
                  <button
                    v-if="group.category === 'applied'"
                    class="button secondary"
                    :disabled="
                      readOnly ||
                      busy ||
                      qualificationDraft.courseIds.length +
                        (qualificationDraft.commonCourseAdditions?.length ?? 0) >=
                        100
                    "
                    @click="courseCreateOpen = true"
                  >
                    새 특화인증Set 등록
                  </button>
                </div>
                <div
                  v-for="c in group.items"
                  :key="c.id"
                  class="qualification-course-row"
                  :data-course-id="c.id"
                >
                  <label class="qualification-course-choice"
                    ><input
                      :checked="qualificationDraft.courseIds.includes(c.id)"
                      @change="
                        selectCourseVersion(c.id, ($event.target as HTMLInputElement).checked)
                      "
                      type="checkbox"
                      :value="c.id"
                      :disabled="
                        readOnly ||
                        busy ||
                        (c.category === 'common' && !store.hasRole('system_operator'))
                      "
                      :aria-describedby="
                        c.category === 'common' && !store.hasRole('system_operator')
                          ? 'qualification-common-policy'
                          : undefined
                      "
                    /><span>{{ c.title || '이름 없음' }}</span></label
                  >
                  <div class="qualification-course-meta">
                    <CourseCategory :course="c" /><span class="muted">{{
                      releaseVersionLabel(c)
                    }}</span>
                    <StatusBadge
                      :status="c.operationalStatus === 'retired' ? 'retired' : 'active'"
                    />
                    <span v-if="c.deletedAt" class="muted">삭제됨</span>
                    <span
                      v-if="c.category === 'common' && !store.hasRole('system_operator')"
                      class="muted"
                      >{{
                        qualificationDraft.courseIds.includes(c.id)
                          ? '필수 적용'
                          : '미적용 · 조회 전용'
                      }}</span
                    >
                  </div>
                  <div class="qualification-course-actions">
                    <button
                      v-if="
                        group.category === 'applied' &&
                        !readOnly &&
                        (c.category === 'specialized' || store.hasRole('system_operator'))
                      "
                      type="button"
                      class="text-link"
                      :disabled="busy"
                      :aria-label="`${c.title} 자격에서 제거`"
                      @click="selectCourseVersion(c.id, false)"
                    >
                      자격에서 제거
                    </button>
                    <RouterLink
                      v-if="!readOnly"
                      class="text-link"
                      :to="criteriaLink(`/admin/courses/${c.id}`, c.qualificationType)"
                      >내용 수정</RouterLink
                    >
                    <button
                      type="button"
                      class="button secondary"
                      :aria-label="`${c.title || '이름 없는 인증Set'} ${releaseVersionLabel(c)} 내용 조회`"
                      @click="previewCourseId = c.id"
                    >
                      내용 조회
                    </button>
                  </div>
                </div>
                <p
                  v-if="
                    !group.items.length &&
                    !(
                      group.category === 'applied' &&
                      qualificationDraft.commonCourseAdditions?.length
                    )
                  "
                  class="muted"
                >
                  {{
                    group.category === 'applied'
                      ? '적용된 인증Set이 없습니다.'
                      : group.category === 'common'
                        ? store.hasRole('system_operator')
                          ? '추가할 팀 공통 사본이 없습니다.'
                          : '적용된 공통인증Set이 없습니다.'
                        : '추가할 특화인증Set이 없습니다.'
                  }}
                </p>
                <QualificationCommonCourses
                  v-if="
                    group.category === 'common' ||
                    (store.hasRole('system_operator') && group.category === 'applied')
                  "
                  :qualification-id="qualificationDraft.id"
                  :revision="qualificationDraft.revision"
                  :disabled="readOnly || busy"
                  :read-only="!store.hasRole('system_operator')"
                  :additions="qualificationDraft.commonCourseAdditions"
                  :selection-group="group.category === 'applied' ? 'selected' : 'unselected'"
                  @change="
                    (items) => {
                      if (!qualificationDraft || !store.hasRole('system_operator')) return;
                      if (items.length) qualificationDraft.commonCourseAdditions = items;
                      else delete qualificationDraft.commonCourseAdditions;
                    }
                  "
                />
              </div>
            </fieldset>
          </CollapsibleSection>
        </div>
        <QualificationCourseCreate
          v-if="qualificationDraft"
          ref="courseCreator"
          v-model:open="courseCreateOpen"
          :qualification="qualificationDraft"
          @created="addCreatedCourse"
        />
        <CoursePreviewDialog
          :open="!!previewCourseId"
          :course="previewCourse"
          @update:open="
            (open) => {
              if (!open) previewCourseId = '';
            }
          "
        />
        <CourseEditor
          v-if="courseDraft"
          ref="courseEditor"
          :course="courseDraft"
          :type-editing="store.course(courseDraft.id)?.typeEditing"
          :disabled="readOnly || busy"
          :issues="locatedIssues"
          :show-errors="validationShown"
        />
        <div v-if="savedLinks.length" class="panel editor-panel">
          <p>새 인증Set 버전은 기존 자격 구성에 자동 반영되지 않습니다.</p>
          <RouterLink
            v-for="q in savedLinks"
            :key="q.id"
            :to="criteriaLink(`/admin/qualifications/${q.id}`)"
            >{{ q.title }} {{ releaseVersionLabel(q) }} · 자격 조회</RouterLink
          >
        </div>
        <section
          v-if="qualificationDraft"
          class="qualification-version-info"
          aria-label="버전 정보"
        >
          <h2>버전 정보</h2>
          <dl class="property-list team-qualification-facts">
            <div>
              <dt>자격 버전</dt>
              <dd>
                {{
                  qualificationDraft.version === null
                    ? '최초 설정 전'
                    : releaseVersionLabel(qualificationDraft)
                }}
              </dd>
            </div>
            <div>
              <dt>기본자격 수정 번호</dt>
              <dd>{{ qualificationDraft.templateRevision }}</dd>
            </div>
          </dl>
          <details class="criterion-versions">
            <summary>
              {{ qualificationDraft.version === null ? '등록 이력' : '버전 이력' }} ·
              {{ relatedVersions.length }}개
            </summary>
            <ul>
              <li v-for="version in relatedVersions" :key="version.id">
                <RouterLink :to="criteriaLink(`/admin/${section}/${version.id}`)"
                  >{{ releaseVersionLabel(version) }} · {{ version.title || '이름 없는 기준'
                  }}{{ version.deletedAt ? ' · 삭제된 항목' : '' }}</RouterLink
                >
              </li>
            </ul>
          </details>
        </section>
        <p v-else class="release-footer">{{ releaseVersionLabel(editor) }}</p>
        <ActionBar v-if="!readOnly" class="actionbar">
          <RouterLink
            v-if="qualificationDraft"
            class="button secondary"
            :to="
              criteriaLink(
                qualificationDraft.version === null
                  ? '/admin/qualifications'
                  : `/admin/qualifications/${qualificationDraft.id}`,
              )
            "
            >변경 취소</RouterLink
          >
          <span v-if="courseDraft" class="muted"
            >전체 기준을 저장합니다. 완성된 버전을 연결 자격에 자동 반영합니다.</span
          >
          <span
            v-if="qualificationValidityErrors.length"
            id="qualification-save-reason"
            class="sr-only"
            >{{ qualificationValidityErrors[0] }}</span
          >
          <button
            ref="saveTrigger"
            :aria-describedby="
              qualificationValidityErrors.length ? 'qualification-save-reason' : undefined
            "
            class="button primary"
            :disabled="busy || previewPending || !!qualificationValidityErrors.length"
            @click="saveCatalog()"
          >
            {{ confirmInitial ? '최초 설정 저장' : '저장' }}
          </button>
        </ActionBar>
        <AppDialog
          :open="!!savePreview"
          title="기준 저장 확인"
          @closed="restoreSaveFocus"
          @update:open="
            (v) => {
              if (!v) closeSavePreview();
            }
          "
        >
          <template v-if="savePreview"
            ><h3>
              {{ editor.title || '이름 없는 기준' }} ·
              {{ releaseVersionLabel(editor) }}
            </h3>
            <p v-if="savePreview.unchanged">변경 내용이 없습니다.</p>
            <template v-else>
              <p>
                {{ savePreview.releaseChange?.before }} → {{ savePreview.releaseChange?.after }} ·
                {{
                  savePreview.releaseChange?.kind === 'major'
                    ? '메이저 업데이트'
                    : savePreview.initialConfiguration
                      ? '최초 설정'
                      : '마이너 업데이트'
                }}
              </p>
              <p>새 버전을 저장합니다. 확정된 계획과 기존 인증 기록은 당시 기준을 유지합니다.</p>
              <p v-for="target in savePreview.propagation?.updated" :key="target.id">
                자동 반영: {{ target.title }} {{ releaseVersionLabel(target) }}
              </p>
              <p v-for="target in savePreview.propagation?.deferred" :key="target.id" class="muted">
                반영 보류: {{ target.title }} · {{ target.reason }}
              </p>
            </template>
            <details v-if="savePreview.changes?.length" class="criterion-changes">
              <summary>변경 전후 확인 · {{ savePreview.changes.length }}개 항목</summary>
              <section v-for="change in savePreview.changes" :key="change.label">
                <h4>{{ change.label }}</h4>
                <div>
                  <p>
                    <strong>변경 전</strong><span>{{ change.before || '미입력' }}</span>
                  </p>
                  <p>
                    <strong>변경 후</strong><span>{{ change.after || '미입력' }}</span>
                  </p>
                </div>
              </section>
            </details>
            <details v-if="savePreview.readiness.length" open>
              <summary>
                설정 필요 {{ savePreview.readiness.length }}건 · 미완성 내용도 저장할 수 있습니다
              </summary>
              <ul>
                <li v-for="message in savePreview.readiness" :key="message">{{ message }}</li>
              </ul>
            </details>
            <p v-if="errors.length" class="error-message" role="alert">
              {{ errors.join(' · ') }}
            </p>
            <button
              v-if="previewError || errors.length"
              class="button secondary"
              :disabled="busy || previewPending"
              @click="reviewSave()"
            >
              다시 검토
            </button>
          </template>
          <template #footer
            ><button
              v-if="savePreview?.versionPolicy && savePreview.unchanged"
              class="button primary"
              @click="finishUnchanged"
            >
              닫기
            </button>
            <template v-else
              ><button class="button secondary" :disabled="busy" @click="closeSavePreview()">
                계속 편집</button
              ><button
                class="button primary"
                :disabled="busy || previewPending || !!previewError"
                @click="saveCatalog(true)"
              >
                {{
                  savePreview?.initialConfiguration
                    ? 'v1.0으로 최초 설정 저장'
                    : savePreview?.versionPolicy
                      ? savePreview.newVersion
                        ? '새 버전 저장'
                        : '저장 확인'
                      : '저장 확인'
                }}
              </button></template
            ></template
          >
        </AppDialog>
      </template>
      <template v-else>
        <CommonReleaseUpdates v-if="section === 'courses' || section === 'qualifications'" />
        <PageHeading class="page-heading">
          <h1 ref="listHeading" tabindex="-1">{{ title }}</h1>
          <TemplateImport v-if="section === 'qualifications'" :qualification-type="selectedType" />
          <button
            v-if="section === 'courses'"
            class="button primary"
            :disabled="busy"
            @click="
              createName = '';
              createError = '';
              createOpen = true;
            "
          >
            <AppIcon name="plus" :size="18" />{{
              qualificationTypeLabels[selectedType]
            }}
            특화인증Set 추가</button
          ><button
            v-else-if="section === 'notices'"
            class="button primary"
            :disabled="busy"
            @click="editNotice()"
          >
            <AppIcon name="plus" :size="18" />공지 등록
          </button>
        </PageHeading>
        <CompactTabs
          v-if="['qualifications', 'courses'].includes(section)"
          ref="typeTabs"
          class="criteria-type-tabs"
          :items="typeItems"
          :model-value="selectedType"
          label="기준 인증 유형"
          panel-id="criteria-type-panel"
          @update:model-value="selectType"
        />
        <p
          v-if="['qualifications', 'courses'].includes(section) && selectedType === 'auditor'"
          class="qualification-save-notice"
        >
          {{ AUDITOR_PREPARATION_MESSAGE }}
        </p>
        <section
          v-if="section === 'courses' && courseSaveResult"
          class="course-save-result"
          aria-label="인증Set 저장 결과"
        >
          <p role="status">
            <strong>저장 완료</strong> · {{ courseSaveResult.title }} ·
            {{ releaseVersionLabel(courseSaveResult) }}
          </p>
          <RouterLink
            class="text-link"
            data-testid="saved-course-link"
            :to="criteriaLink(`/admin/courses/${courseSaveResult.id}`)"
            >저장한 인증Set 확인<AppIcon name="chevron" :size="16"
          /></RouterLink>
          <details v-if="courseSaveResult.readiness.length">
            <summary>신규 운영 전 보완 {{ courseSaveResult.readiness.length }}건</summary>
            <ul>
              <li v-for="message in courseSaveResult.readiness" :key="message">{{ message }}</li>
            </ul>
          </details>
          <div
            v-if="courseSaveResult.newVersion && courseSaveResult.links.length"
            class="course-save-result-links"
          >
            <p>새 인증Set 버전은 기존 자격 구성에 자동 반영되지 않습니다.</p>
            <RouterLink
              v-for="q in courseSaveResult.links"
              :key="q.id"
              class="text-link"
              :to="criteriaLink(`/admin/qualifications/${q.id}`)"
              >{{ q.title }} {{ releaseVersionLabel(q) }} · 자격 조회</RouterLink
            >
          </div>
        </section>
        <template v-if="section === 'assignments'">
          <PlanningPanel :key="store.managementLv1" />
          <section class="assignment-progress" aria-labelledby="acquisition-progress-heading">
            <h2 id="acquisition-progress-heading">자격별 취득 진행</h2>
            <div class="list-toolbar">
              <div class="filter-controls">
                <label class="search-field"
                  ><AppIcon name="search" :size="18" /><input
                    v-model="query"
                    placeholder="대상자 · 자격 검색"
                    aria-label="취득 진행 검색"
                /></label>
                <select v-model="filter" aria-label="취득 진행 상태">
                  <option value="all">전체 상태</option>
                  <option value="active">진행 중</option>
                  <option value="certified">인증 취득 전체</option>
                  <option value="valid">현재 유효</option>
                  <option value="expiring">만료 예정</option>
                  <option value="revoked">Revoke · 폐기</option>
                  <option value="held">Hold · 효력 정지</option>
                  <option value="unknown">유효기간 미설정</option>
                  <option value="excluded">검증 제외</option>
                </select>
              </div>
            </div>
            <div class="table-panel">
              <table>
                <thead>
                  <tr>
                    <th>대상자</th>
                    <th>자격</th>
                    <th>인증Set 수료</th>
                    <th>상태</th>
                    <th><span class="sr-only">관리</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="a in pageAssignments" :key="a.id">
                    <td>{{ store.username(a.learnerId) }}</td>
                    <td>
                      {{ store.qualification(a.qualificationId, a.qualificationMetadata).title
                      }}<small class="table-subtext">{{
                        releaseVersionLabel(
                          store.qualification(a.qualificationId, a.qualificationMetadata),
                        )
                      }}</small>
                    </td>
                    <td>
                      {{ store.completedCount(a) }} / {{ a.enrollments.length }}
                      <template
                        v-for="stage in [
                          '평가 전',
                          '평가 중',
                          '일부 통과',
                          '학습 미확인',
                          '학습 확인 중',
                        ]"
                        :key="stage"
                      >
                        <span
                          v-if="
                            a.enrollments.some(
                              (enrollment) => enrollmentPhase(enrollment) === stage,
                            )
                          "
                          class="table-subtext"
                        >
                          {{ stage }}
                          {{
                            a.enrollments.filter(
                              (enrollment) => enrollmentPhase(enrollment) === stage,
                            ).length
                          }}인증Set
                        </span>
                      </template>
                    </td>
                    <td>
                      <StatusBadge
                        :status="
                          a.excludedReason ? 'excluded' : a.certifiedAt ? 'certified' : 'draft'
                        "
                        :label="!a.excludedReason && !a.certifiedAt ? '진행 중' : undefined"
                      />
                    </td>
                    <td>
                      <details v-if="!a.excludedReason" class="row-menu">
                        <summary aria-label="배정 관리">
                          <AppIcon name="settings" :size="18" />
                        </summary>
                        <div>
                          <button @click="openAssignment(a, 'exclude')">검증 제외</button>
                        </div>
                      </details>
                      <span v-else class="muted">{{ a.excludedReason }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!assignments.length" class="empty-state">검색 결과가 없습니다.</p>
            </div>
            <ListControls
              :count="list.count"
              :pages="list.pages"
              v-model:page="list.page"
              v-model:size="list.size"
              v-model:sort="list.sort"
            />
          </section>
        </template>
        <div
          v-if="
            !resultAssignmentId &&
            !['organization-settings', 'targets', 'credentials', 'assignments'].includes(section)
          "
          class="list-toolbar"
        >
          <div class="filter-controls">
            <label class="search-field"
              ><AppIcon name="search" :size="18" /><input
                v-model="query"
                :placeholder="
                  section === 'assignments' || section === 'results'
                    ? '대상자 · 자격 검색'
                    : section === 'courses'
                      ? '인증Set 검색'
                      : section === 'notices'
                        ? '공지 검색'
                        : '자격 검색'
                "
                :aria-label="`${title} 검색`" /></label
            ><select v-if="section !== 'notices'" v-model="filter" aria-label="상태 필터">
              <option v-if="section === 'courses'" value="active">운영 중</option>
              <option v-if="section === 'courses'" value="retired">운영 종료</option>
              <option value="all">전체 상태</option>
              <template v-if="section === 'qualifications'"
                ><option value="Ready">Ready · 대기</option>
                <option value="Active">Active</option>
                <option value="Hold">Hold</option>
                <option value="Revoke">Revoke</option>
                <option value="deleted">삭제된 항목</option></template
              ><template v-else-if="section !== 'courses'"
                ><option value="active">진행 중</option>
                <option value="certified">인증 취득 전체</option>
                <option value="valid">현재 유효</option>
                <option value="expiring">만료 예정</option>
                <option value="revoked">Revoke · 폐기</option>
                <option value="held">Hold · 효력 정지</option>
                <option value="unknown">유효기간 미설정</option>
                <option value="excluded">검증 제외</option></template
              >
            </select>
            <select
              v-if="section === 'courses'"
              v-model="categoryFilter"
              aria-label="인증Set 구분 필터"
            >
              <option value="all">전체 인증Set</option>
              <option value="common">공통인증Set</option>
              <option value="specialized">특화인증Set</option>
            </select>
          </div>
        </div>

        <CredentialManagement v-if="section === 'credentials'" />
        <CertificationTargets
          v-else-if="section === 'targets'"
          :key="`${store.actorId}:${store.managementLv1}`"
        />
        <OrganizationSettings v-if="section === 'organization-settings'" :key="store.actorId" />
        <div
          v-if="section === 'qualifications'"
          id="criteria-type-panel"
          role="tabpanel"
          :aria-labelledby="typeTabs?.tabId(selectedType)"
          class="table-panel"
        >
          <table>
            <thead>
              <tr>
                <th>자격명</th>
                <th>버전</th>
                <th>현재 팀 기준</th>
                <th>상태</th>
                <th><span class="sr-only">상세</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="q in pageQualifications" :key="q.id">
                <td>
                  <RouterLink
                    :to="criteriaLink(`/admin/qualifications/${q.id}`)"
                    class="table-title"
                    >{{ q.title || '이름 없음' }}</RouterLink
                  >
                  <details v-if="qualificationErrors(q).length" class="readiness">
                    <summary>설정 필요 {{ qualificationErrors(q).length }}건</summary>
                    <ul>
                      <li v-for="error in qualificationErrors(q)" :key="error">
                        {{ error }}
                      </li>
                    </ul>
                    <RouterLink :to="criteriaLink(`/admin/qualifications/${q.id}`)"
                      >기준 확인</RouterLink
                    >
                  </details>
                  <p v-if="store.retiredCourses(q).length" class="muted">
                    신규 배정 불가 ·
                    {{
                      store
                        .retiredCourses(q)
                        .map((c) => `${c.title} ${releaseVersionLabel(c)}`)
                        .join(', ')
                    }}
                    운영 종료
                  </p>
                  <span v-if="q.description.includes('프로세스 검증용')" class="test-data-tag"
                    >시험 데이터</span
                  >
                </td>

                <td>{{ releaseVersionLabel(q) }}</td>
                <td>
                  {{
                    store.data.currentQualifications.some((p) => p.qualificationId === q.id)
                      ? '현재 기준'
                      : '과거 버전'
                  }}
                </td>
                <td>
                  <span class="lifecycle-badge" :data-status="q.lifecycleStatus || 'Active'">{{
                    q.lifecycleStatus === 'Ready'
                      ? criterionLifecycleLabels.Ready
                      : q.lifecycleStatus || 'Active'
                  }}</span>
                </td>
                <td class="qualification-management-actions">
                  <QualificationDelete :qualification="q" :disabled="busy" compact />
                  <RouterLink
                    v-if="q.version !== null"
                    :to="criteriaLink(`/admin/qualifications/${q.id}`)"
                    class="text-link"
                    :aria-label="`${q.title} ${releaseVersionLabel(q)} 조회`"
                    >조회</RouterLink
                  >
                  <RouterLink
                    v-if="
                      !q.deletedAt &&
                      !organizationData.qualifications.some(
                        (other) =>
                          other.entityId === q.entityId &&
                          !other.deletedAt &&
                          (other.version ?? 0) > (q.version ?? 0),
                      )
                    "
                    :to="criteriaLink(`/admin/qualifications/${q.id}/edit`)"
                    class="text-link"
                    :aria-label="`${q.title} ${releaseVersionLabel(q)} ${q.version === null ? '최초 설정' : '변경'}`"
                    >{{ q.version === null ? '최초 설정' : '변경' }}</RouterLink
                  >
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!qualifications.length" class="empty-state">
            {{
              query
                ? '검색 결과가 없습니다.'
                : `${qualificationTypeLabels[selectedType]} 팀 자격이 없습니다. 기본자격에서 등록해 주세요.`
            }}
          </p>
        </div>
        <div
          v-else-if="section === 'courses'"
          id="criteria-type-panel"
          role="tabpanel"
          :aria-labelledby="typeTabs?.tabId(selectedType)"
          class="table-panel"
        >
          <table>
            <thead>
              <tr>
                <th>인증Set명</th>
                <th>구분</th>
                <th>버전</th>
                <th>필수 평가</th>
                <th>상태</th>
                <th><span class="sr-only">상세</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in pageCourses" :key="c.id">
                <td>
                  <RouterLink :to="criteriaLink(`/admin/courses/${c.id}`)" class="table-title">{{
                    c.title || '이름 없음'
                  }}</RouterLink>
                </td>
                <td><CourseCategory :course="c" /></td>
                <td>{{ releaseVersionLabel(c) }}</td>
                <td class="muted">
                  {{
                    c.qualificationType === 'auditor'
                      ? '본인 학습 확인'
                      : c.assessmentKinds.map((k) => labels[k]).join(' · ')
                  }}
                </td>
                <td>
                  <StatusBadge :status="c.operationalStatus === 'retired' ? 'retired' : 'active'" />
                </td>
                <td>
                  <RouterLink
                    :to="criteriaLink(`/admin/courses/${c.id}`)"
                    class="icon-button"
                    :aria-label="`${c.title} 상세`"
                    ><AppIcon name="chevron" :size="18"
                  /></RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!courses.length" class="empty-state">
            {{
              query
                ? '검색 결과가 없습니다.'
                : `${qualificationTypeLabels[selectedType]} 인증Set이 없습니다. 새 인증Set을 만들어 주세요.`
            }}
          </p>
        </div>
        <div v-else-if="section === 'results'" class="results-list">
          <RouterLink
            v-if="resultAssignmentId"
            class="text-link"
            :to="criteriaLink('/admin/results')"
            >전체 결과 목록</RouterLink
          >
          <details
            v-for="a in assignments"
            :key="a.id"
            class="panel result-details"
            :open="!!resultAssignmentId"
          >
            <summary>
              <span
                ><strong>{{ store.username(a.learnerId) }}</strong
                ><small
                  >{{ store.qualification(a.qualificationId, a.qualificationMetadata).title }} ·
                  {{
                    releaseVersionLabel(
                      store.qualification(a.qualificationId, a.qualificationMetadata),
                    )
                  }}</small
                ></span
              ><span class="muted"
                >{{ store.completedCount(a) }} / {{ a.enrollments.length }} 수료</span
              ><StatusBadge
                :status="a.excludedReason ? 'excluded' : a.certifiedAt ? 'certified' : 'draft'"
                :label="
                  a.renewalBatch
                    ? `재인증 · ${{ evaluating: '평가 진행', passed: '합격 · 보류', completed: '갱신 처리 완료', closed: '종료' }[a.renewalBatch.status]}`
                    : !a.certifiedAt && !a.excludedReason
                      ? '진행 중'
                      : undefined
                "
              /><ValidityBadge v-if="a.certification" :certification="a.certification" /><AppIcon
                name="down"
                :size="18"
              />
            </summary>
            <div class="result-detail-body">
              <p v-if="a.certification" class="muted">
                취득일 {{ kstDate(a.certification.date) }} ·
                {{
                  credentialCurrent(a.certification).expiresOn
                    ? `만료일 ${credentialCurrent(a.certification).expiresOn}`
                    : credentialCurrent(a.certification).validity?.type === 'unlimited'
                      ? '무기한'
                      : '유효기간 미설정 · 기존 기록'
                }}
              </p>
              <p v-if="a.excludedReason" class="error-message">
                검증 제외 · {{ a.excludedReason }}
              </p>
              <section v-for="e in a.enrollments" :key="e.courseId" class="result-course">
                <div class="section-heading">
                  <h2>
                    {{ store.course(e.courseId).title }}
                    <span class="small-label">{{
                      releaseVersionLabel(store.course(e.courseId))
                    }}</span>
                  </h2>
                  <StatusBadge v-if="store.complete(e)" status="complete" /><StatusBadge
                    v-if="store.course(e.courseId).operationalStatus === 'retired'"
                    status="retired"
                  />
                </div>
                <details
                  v-if="e.subjective?.response?.status === 'submitted'"
                  class="attempt-detail"
                >
                  <summary>
                    주관식 평가 · 답변 제출 완료 ·
                    {{ new Date(e.subjective.response.submittedAt!).toLocaleString('ko-KR') }}
                  </summary>
                  <div class="attempt-items">
                    <section
                      v-for="(question, index) in e.subjective.response.questions"
                      :key="question.id"
                    >
                      <h3>{{ index + 1 }}번 문제</h3>
                      <p style="white-space: pre-wrap; overflow-wrap: anywhere">
                        {{ question.prompt }}
                      </p>
                      <h4>제출 답변</h4>
                      <p style="white-space: pre-wrap; overflow-wrap: anywhere">
                        {{ e.subjective.response.answers[question.id] }}
                      </p>
                    </section>
                  </div>
                </details>
                <details v-for="h in [...e.history].reverse()" :key="h.id" class="attempt-detail">
                  <summary>
                    <span>{{ labels[h.kind] }} {{ h.round }}회</span
                    ><StatusBadge :status="h.result" /><time>{{
                      new Date(h.date).toLocaleDateString('ko-KR')
                    }}</time
                    ><AppIcon name="down" :size="16" />
                  </summary>
                  <div class="attempt-items">
                    <p class="small-label">
                      자동 채점 · 득점 {{ h.earned }} / {{ h.total }} · 합격 기준
                      {{
                        h.kind === 'objective'
                          ? store.course(e.courseId).passScore
                          : store.course(e.courseId).practicalPassScore
                      }}%
                    </p>
                    <div
                      v-for="q in h.kind === 'objective'
                        ? store.course(e.courseId).questions
                        : store.course(e.courseId).practicalQuestions"
                      :key="q.id"
                    >
                      <p>
                        {{ q.prompt }}
                        <span class="small-label"
                          >{{ h.itemResults?.find((r) => r.itemId === q.id)?.earned }} /
                          {{ q.points }}점</span
                        >
                      </p>
                      <span class="muted"
                        >응답 {{ q.choices[h.answers?.[q.id] ?? -1] }} · 정답
                        {{ q.correct == null ? '미정' : q.choices[q.correct] }}</span
                      >
                    </div>
                  </div>
                </details>
                <p v-if="e.completion" class="small-label">
                  수료 {{ e.completion.id }} ·
                  {{ new Date(e.completion.date).toLocaleString('ko-KR') }}
                </p>
                <RouterLink
                  v-if="e.completion"
                  class="text-link"
                  :to="criteriaLink(`/completions/${e.completion.id}`)"
                  >인증Set 수료증 보기</RouterLink
                >
                <template v-if="store.course(e.courseId).qualificationType === 'auditor'"
                  ><p class="muted">
                    본인 학습 확인 · {{ e.completion ? '수료 확정' : '확인 진행' }}
                  </p>
                  <ul>
                    <li v-for="item in e.checklist?.items || []" :key="item.itemId">
                      {{ item.title }} · {{ item.required ? '필수' : '선택' }} ·
                      {{
                        new Date(item.confirmedAt).toLocaleString('ko-KR', {
                          timeZone: 'Asia/Seoul',
                        })
                      }}
                    </li>
                  </ul></template
                >
                <p v-else-if="!e.history.length" class="muted">평가 이력이 없습니다.</p>
              </section>
              <details class="attempt-detail">
                <summary>변경 이력</summary>
                <div
                  v-for="ev in organizationData.audits.filter((x) => x.assignmentId === a.id)"
                  :key="ev.id"
                  class="audit-row"
                >
                  <p>
                    {{ auditLabels[ev.action] || ev.action }} · {{ store.username(ev.actorId) }} ·
                    {{ new Date(ev.date).toLocaleString('ko-KR') }}
                  </p>
                  <p class="muted">{{ ev.reason }}</p>
                </div>
              </details>
              <RouterLink
                v-if="a.certifiedAt"
                :to="criteriaLink(`/certifications/${a.id}`)"
                class="button secondary"
                >인증 근거 보기<AppIcon name="arrow" :size="16"
              /></RouterLink>
            </div>
          </details>
          <p v-if="!assignments.length" class="panel empty-state">검색 결과가 없습니다.</p>
        </div>
        <div v-else-if="section === 'notices'" class="table-panel">
          <table>
            <thead>
              <tr>
                <th>제목</th>
                <th>등록일</th>
                <th>상태</th>
                <th><span class="sr-only">수정</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="n in pageNotices" :key="n.id">
                <td>
                  <button class="table-title text-link" @click="editNotice(n)">
                    {{ n.title }}
                  </button>
                </td>
                <td class="muted">{{ n.date }}</td>
                <td>
                  <StatusBadge
                    :status="n.published ? 'published' : 'catalogDraft'"
                    :label="n.published ? '게시 중' : '초안'"
                  />
                </td>
                <td>
                  <button
                    class="icon-button"
                    :aria-label="`${n.title} 수정`"
                    @click="editNotice(n)"
                  >
                    <AppIcon name="edit" :size="18" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!notices.length" class="empty-state">등록된 공지가 없습니다.</p>
        </div>
        <ListControls
          v-if="
            !['organization-settings', 'targets', 'credentials', 'assignments'].includes(section)
          "
          :count="list.count"
          :pages="list.pages"
          v-model:page="list.page"
          v-model:size="list.size"
          v-model:sort="list.sort"
        />
      </template>
      <AppDialog
        :open="!!selectedAssignment"
        title="검증 제외"
        @update:open="selectedAssignment = null"
        ><p>
          {{ selectedAssignment && store.username(selectedAssignment.learnerId) }} ·
          {{
            selectedAssignment &&
            store.qualification(
              selectedAssignment.qualificationId,
              selectedAssignment.qualificationMetadata,
            ).title
          }}
        </p>
        <div v-if="errors.length" class="error-message" role="alert">{{ errors[0] }}</div>
        <p class="muted">기존 기록은 보존되며, 이후 평가를 진행할 수 없습니다.</p>
        <label class="field"><span>변경 사유</span><textarea v-model="reason" rows="3" /></label
        ><template #footer
          ><button class="button secondary" @click="selectedAssignment = null">취소</button
          ><button class="button primary" :disabled="busy" @click="changeAssignment">
            검증 제외
          </button></template
        ></AppDialog
      >
      <AppDialog :open="!!noticeDraft" title="공지 편집" @update:open="noticeDraft = null"
        ><template v-if="noticeDraft"
          ><div v-if="errors.length" class="error-message" role="alert">{{ errors[0] }}</div>
          <p class="notice-body">팀 공지 · 게시 대상: {{ store.managementOrganization?.name }}</p>
          <label class="field"><span>제목</span><input v-model="noticeDraft.title" /></label
          ><label class="field"
            ><span>내용</span><textarea v-model="noticeDraft.body" rows="5" /></label
          ><label class="checkbox-label"
            ><input v-model="noticeDraft.published" type="checkbox" />게시</label
          ></template
        ><template #footer
          ><button class="button secondary" @click="noticeDraft = null">취소</button
          ><button class="button primary" :disabled="busy" @click="saveNotice">
            저장
          </button></template
        ></AppDialog
      >
    </div>
  </div>
</template>

<style scoped>
.assignment-progress {
  margin-top: 32px;
  display: grid;
  gap: 16px;
  min-width: 0;
}
.assignment-progress > h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.assignment-progress > .list-toolbar {
  margin: 0;
}
</style>

<style scoped>
.criterion-versions {
  margin: 16px 0;
  font-size: 14px;
}
.course-version-control {
  min-width: 0;
  width: min(100%, 640px);
  margin: 16px 0;
}
.course-version-control select {
  width: 100%;
  min-width: 0;
  text-overflow: ellipsis;
}
.criterion-versions ul {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding-left: 20px;
}
.criterion-changes {
  margin: 24px 0;
}
.criterion-changes section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.criterion-changes h4 {
  margin: 0 0 12px;
  font-size: 16px;
}
.criterion-changes section > div {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.criterion-changes p {
  min-width: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.criterion-changes span {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.6;
  max-height: 300px;
  overflow: auto;
}
@media (max-width: 600px) {
  .criterion-changes section > div {
    grid-template-columns: 1fr;
  }
}
</style>
