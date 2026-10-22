<script setup lang="ts">
import PageHeading from '../components/PageHeading.vue';
import ActionBar from '../components/ActionBar.vue';
import { confirmAction } from '../composables/useConfirmation';
import CourseEditor from '../components/CourseEditor.vue';
import QualificationDelete from '../components/QualificationDelete.vue';
import { api } from '../api';
import CredentialManagement from '../components/CredentialManagement.vue';
import { useProcessContext } from '../composables/useProcessContext';
import { computed, nextTick, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
import CourseLifecycle from '../components/CourseLifecycle.vue';
import ComparisonPanel from '../components/ComparisonPanel.vue';
import CertificationTargets from '../components/CertificationTargets.vue';
import QualificationLifecycle from '../components/QualificationLifecycle.vue';
import QualificationFields from '../components/QualificationFields.vue';
import { courseIssues, type CourseIssue } from '../course-editor';
import TemplateImport from '../components/TemplateImport.vue';
import ListControls from '../components/ListControls.vue';
import { useListView } from '../composables/useListView';
import PlanningPanel from '../components/PlanningPanel.vue';
import OrganizationPolicies from '../components/OrganizationPolicies.vue';
import ValidityBadge from '../components/ValidityBadge.vue';
import { kindLabels, certificationStatus, kstDate, credentialCurrent } from '@eks/contracts';
import type { Assignment, Course, Notice, Qualification, AuditEvent } from '../types';
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
const sections = [
  { id: 'credentials', name: '개인 자격 관리', icon: 'award' },
  { id: 'targets', name: '인증 대상자 관리', icon: 'users' },
  { id: 'policies', name: '조직별 자격 설정', icon: 'users' },
  { id: 'qualifications', name: '자격 관리', icon: 'award' },
  { id: 'courses', name: '인증Set 관리', icon: 'book' },
  { id: 'assignments', name: '대상자·계획', icon: 'users' },
  { id: 'results', name: '결과 조회', icon: 'clipboard' },
  { id: 'comparisons', name: '기준 검증', icon: 'check' },
  { id: 'notices', name: '팀 공지 관리', icon: 'notice' },
];
const section = computed(() => String(route.params.section));
const filterKey = () => `eks-admin-filter-${store.actorId}-${store.managementLv1}-${section.value}`;
const title = computed(() => sections.find((s) => s.id === section.value)!.name);
const busy = ref(false);
const editingContext = ref('');
const query = ref(''),
  courseSearch = ref(''),
  filter = ref('all'),
  errors = ref<string[]>([]);
const validationShown = ref(false);
const courseEditor = ref<InstanceType<typeof CourseEditor>>();
const savePreview = ref<any>(null);
const savedLinks = ref<{ id: string; title: string; version: number }[]>([]);
const locatedIssues = computed(() =>
  validationShown.value && courseDraft.value ? courseIssues(courseDraft.value) : [],
);
const courseDraft = ref<Course | null>(null),
  qualificationDraft = ref<Qualification | null>(null);
watch(locatedIssues, (issues) => {
  if (validationShown.value && courseDraft.value)
    errors.value = [
      ...new Set([...store.courseErrors(courseDraft.value), ...issues.map((i) => i.message)]),
    ];
});
const editor = computed(() => courseDraft.value || qualificationDraft.value);
const relatedVersions = computed(() =>
  editor.value
    ? (courseDraft.value ? organizationData.value.courses : organizationData.value.qualifications)
        .filter((v) => v.entityId === editor.value!.entityId)
        .sort((a, b) => b.version - a.version)
    : [],
);
const readOnly = computed(() => !!editor.value?.deletedAt);
useProcessContext(() => (editor.value ? (readOnly.value ? 'readonly' : 'editing') : 'list'));
const selectedAssignment = ref<Assignment | null>(null),
  assignmentAction = ref<'exclude'>('exclude'),
  reason = ref('');
const noticeDraft = ref<Notice | null>(null);
function plain<T>(item: T): T {
  return JSON.parse(JSON.stringify(item));
}
watch(
  () => [route.fullPath, store.actorId, store.managementLv1],
  () => {
    if (
      editingContext.value === `${store.actorId}:${store.managementLv1}` &&
      editor.value &&
      route.params.id === editor.value.id &&
      section.value === (courseDraft.value ? 'courses' : 'qualifications')
    )
      return;
    editingContext.value = `${store.actorId}:${store.managementLv1}`;
    let remembered: { query?: string; filter?: string } = {};
    try {
      remembered = JSON.parse(localStorage.getItem(filterKey()) || '{}');
    } catch {}
    query.value = remembered.query || '';
    courseSearch.value = '';
    filter.value = ['draft', 'published'].includes(remembered.filter || '')
      ? 'all'
      : remembered.filter || (section.value === 'courses' ? 'active' : 'all');
    savePreview.value = null;
    selectedAssignment.value = null;
    noticeDraft.value = null;
    reason.value = '';
    errors.value = [];
    validationShown.value = false;
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
const matches = (text: string) => text.toLowerCase().includes(query.value.toLowerCase());
const qualifications = computed(() =>
  organizationData.value.qualifications.filter(
    (q) =>
      matches(q.title) &&
      (filter.value === 'deleted'
        ? !!q.deletedAt
        : !q.deletedAt &&
          (filter.value === 'all' || (q.lifecycleStatus || 'Active') === filter.value)),
  ),
);
const courses = computed(() =>
  organizationData.value.courses.filter(
    (c) =>
      matches(c.title) &&
      (filter.value === 'all' ||
        (filter.value === 'active' && c.operationalStatus !== 'retired') ||
        (filter.value === 'retired' && c.operationalStatus === 'retired')),
  ),
);
const selectableCourses = computed(() => {
  const selected = new Set(qualificationDraft.value?.courseIds || []);
  const term = courseSearch.value.trim().toLocaleLowerCase();
  return organizationData.value.courses
    .filter(
      (c) =>
        selected.has(c.id) ||
        !term ||
        `${c.title} v${c.version}`.toLocaleLowerCase().includes(term),
    )
    .slice()
    .sort(
      (a, b) =>
        Number(selected.has(b.id)) - Number(selected.has(a.id)) ||
        a.title.localeCompare(b.title, 'ko'),
    );
});
const assignments = computed(() =>
  organizationData.value.assignments.filter(
    (a) =>
      matches(store.qualification(a.qualificationId).title + ' ' + store.username(a.learnerId)) &&
      (filter.value === 'all' ||
        (filter.value === 'excluded' && !!a.excludedReason) ||
        (filter.value === 'active' && !a.excludedReason && !a.certifiedAt) ||
        (filter.value === 'certified' && !a.excludedReason && !!a.certifiedAt) ||
        (!a.excludedReason &&
          a.certification &&
          (filter.value === 'valid'
            ? ['valid', 'expiring'].includes(certificationStatus(a.certification))
            : filter.value === certificationStatus(a.certification)))),
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
watch([query, filter], () => {
  list.page = 1;
  localStorage.setItem(filterKey(), JSON.stringify({ query: query.value, filter: filter.value }));
});
const pageQualifications = computed(() => list.rows as Qualification[]),
  pageCourses = computed(() => list.rows as Course[]),
  pageAssignments = computed(() => list.rows as Assignment[]),
  pageNotices = computed(() => list.rows as Notice[]);
async function createCatalog() {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await store.createCatalog(section.value);
    await router.push(store.managementLink(`/admin/${section.value}/${result.id}`));
  } catch (error) {
    errors.value = [(error as Error).message];
  } finally {
    busy.value = false;
  }
}
async function saveCatalog(confirm = false) {
  if (!editor.value || readOnly.value || busy.value) return;
  if (courseEditor.value && !courseEditor.value.commit()) return;
  const context = `${store.actorId}:${store.managementLv1}:${editor.value.id}`;
  busy.value = true;
  errors.value = [];
  try {
    if (!confirm) {
      const preview = await api(
        store.managementPath(`/${section.value}/${editor.value.id}/save-preview`),
        { method: 'POST', body: JSON.stringify(plain(editor.value)) },
      );
      if (context === `${store.actorId}:${store.managementLv1}:${editor.value?.id}`)
        savePreview.value = preview;
      return;
    }
    const result = await store.saveCatalog(section.value, plain(editor.value), {
      stateRevision: savePreview.value.stateRevision,
      organizationRevision: savePreview.value.organizationRevision,
    });
    if (context !== `${store.actorId}:${store.managementLv1}:${editor.value?.id}`) return;
    savePreview.value = null;
    savedLinks.value = result.linkedQualifications || [];
    if (courseDraft.value) courseDraft.value = plain(store.course(result.id));
    else qualificationDraft.value = plain(store.qualification(result.id));
    await router.replace(store.managementLink(`/admin/${section.value}/${result.id}`));
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
function editNotice(n?: Notice) {
  noticeDraft.value = n
    ? plain(n)
    : {
        id: crypto.randomUUID(),
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
async function canLeave() {
  if (!store.managementAccess) return true;
  const source = courseDraft.value
    ? organizationData.value.courses.find((c) => c.id === courseDraft.value!.id)
    : qualificationDraft.value
      ? organizationData.value.qualifications.find((q) => q.id === qualificationDraft.value!.id)
      : null;
  if (store.writing) {
    store.notify('저장이 끝난 뒤 이동해 주세요.');
    return false;
  }
  if (
    (noticeDraft.value || selectedAssignment.value) &&
    !(await confirmAction(
      '작성 중인 입력이 있습니다. 저장하려면 취소를 누르세요. 변경을 버리고 나갈까요?',
      '변경 버리고 이동',
    ))
  )
    return false;
  return (
    !store.canEnterManagement ||
    !editor.value ||
    readOnly.value ||
    (!courseEditor.value?.pending && JSON.stringify(source) === JSON.stringify(editor.value)) ||
    (await confirmAction(
      '저장하지 않은 변경 사항이 있습니다. 저장하려면 취소를 누르세요. 변경을 버리고 나갈까요?',
      '변경 버리고 이동',
    ))
  );
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
</script>
<template>
  <div
    class="admin-section"
    :class="{ 'individual-editor': !!editor }"
    :data-density="list.density"
  >
    <div v-if="!store.managementReady && section !== 'policies'" class="empty-state">
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
        <RouterLink :to="store.managementLink(`/admin/${section}`)" class="back-link"
          ><AppIcon name="back" :size="16" />{{ title }}</RouterLink
        >
        <PageHeading class="page-heading">
          <h1>{{ editor.title || (courseDraft ? '새 인증Set' : '새 자격') }}</h1>
          <div class="actions">
            <span class="small-label">v{{ editor.version }}</span>
            <span v-if="editor.deletedAt" class="muted"
              >삭제된 항목 · {{ editor.deletionReason }}</span
            >
            <QualificationDelete
              v-if="qualificationDraft"
              :qualification="qualificationDraft"
              :disabled="
                busy ||
                JSON.stringify(qualificationDraft) !==
                  JSON.stringify(store.qualification(qualificationDraft.id))
              "
              @deleted="
                qualificationDraft = null;
                router.push(store.managementLink('/admin/qualifications'));
              "
            />
          </div>
        </PageHeading>
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
        <details class="criterion-versions">
          <summary>버전 이력 · {{ relatedVersions.length }}개</summary>
          <ul>
            <li v-for="version in relatedVersions" :key="version.id">
              <RouterLink :to="store.managementLink(`/admin/${section}/${version.id}`)"
                >v{{ version.version }} · {{ version.title || '이름 없는 기준'
                }}{{ version.deletedAt ? ' · 삭제된 항목' : '' }}</RouterLink
              >
            </li>
          </ul>
        </details>
        <QualificationLifecycle
          v-if="qualificationDraft && !readOnly"
          :qualification="store.qualification(qualificationDraft.id)"
          :disabled="
            busy ||
            (!readOnly &&
              JSON.stringify(qualificationDraft) !==
                JSON.stringify(store.qualification(qualificationDraft.id)))
          "
          @changed="qualificationDraft = plain(store.qualification(qualificationDraft.id))"
          @version-created="
            (id) => router.push(store.managementLink(`/admin/qualifications/${id}`))
          "
        />
        <CourseLifecycle
          v-if="courseDraft"
          :key="courseDraft.id"
          :course="store.course(courseDraft.id) || courseDraft"
          :disabled="
            busy || JSON.stringify(courseDraft) !== JSON.stringify(store.course(courseDraft.id))
          "
          @changed="courseDraft = plain(store.course(courseDraft.id))"
          @deleted="
            courseDraft = null;
            router.push(store.managementLink('/admin/courses'));
          "
        />
        <p
          v-if="qualificationDraft && store.retiredCourses(qualificationDraft).length"
          class="error-message"
        >
          신규 배정 불가 ·
          {{
            store
              .retiredCourses(qualificationDraft)
              .map((c) => `${c.title} v${c.version}`)
              .join(', ')
          }}
          운영 종료.
          {{
            readOnly
              ? '새 버전에서 종료 인증Set을 제거하거나 대체해 주세요.'
              : '신규 운영 전에 종료 인증Set을 제거하거나 대체해 주세요.'
          }}
        </p>
        <div v-if="qualificationDraft" class="panel editor-panel">
          <label class="field"
            ><span>{{ courseDraft ? '인증Set명' : '자격명' }}</span
            ><input
              v-model="editor.title"
              data-course-field="title"
              :aria-invalid="locatedIssues.some((i) => i.kind === 'basic' && i.field === 'title')"
              :disabled="readOnly || busy"
          /></label>
          <p
            v-if="locatedIssues.some((i) => i.kind === 'basic' && i.field === 'title')"
            class="field-error"
          >
            인증Set명을 입력해 주세요.
          </p>
          <template v-if="qualificationDraft">
            <QualificationFields :qualification="qualificationDraft" :disabled="readOnly || busy" />
            <fieldset class="course-selection">
              <legend>필수 인증Set</legend>
              <label class="field course-selection-search"
                ><span>인증Set 검색 · {{ qualificationDraft.courseIds.length }}개 선택</span>
                <input
                  v-model="courseSearch"
                  type="search"
                  placeholder="인증Set명 또는 버전 검색"
                  aria-label="필수 인증Set 검색"
                />
              </label>
              <div class="course-selection-list">
                <label v-for="c in selectableCourses" :key="c.id" class="choice"
                  ><input
                    v-model="qualificationDraft.courseIds"
                    type="checkbox"
                    :value="c.id"
                    :disabled="readOnly || busy" /><span>{{ c.title || '이름 없음' }}</span
                  ><span class="muted">v{{ c.version }}</span
                  ><StatusBadge :status="c.operationalStatus === 'retired' ? 'retired' : 'active'"
                /></label>
                <p v-if="!selectableCourses.length" class="muted">검색 결과가 없습니다.</p>
              </div>
            </fieldset></template
          >
        </div>
        <CourseEditor
          v-if="courseDraft"
          ref="courseEditor"
          :course="courseDraft"
          :disabled="readOnly || busy"
          :issues="locatedIssues"
          :show-errors="validationShown"
        />
        <div v-if="savedLinks.length" class="panel editor-panel">
          <p>새 인증Set 버전은 기존 자격 구성에 자동 반영되지 않습니다.</p>
          <RouterLink
            v-for="q in savedLinks"
            :key="q.id"
            :to="store.managementLink(`/admin/qualifications/${q.id}`)"
            >{{ q.title }} v{{ q.version }} · 자격 구성에 반영</RouterLink
          >
        </div>
        <ActionBar v-if="!readOnly" class="actionbar">
          <span class="muted">전체 기준을 저장합니다. 팀 적용 버전은 유지됩니다.</span
          ><button class="button primary" :disabled="busy" @click="saveCatalog()">저장</button>
        </ActionBar>
        <AppDialog
          :open="!!savePreview"
          title="기준 저장 확인"
          @update:open="
            (v) => {
              if (!v && !busy) savePreview = null;
            }
          "
        >
          <template v-if="savePreview"
            ><h3>{{ editor.title || '이름 없는 기준' }} · v{{ editor.version }}</h3>
            <p>
              {{
                savePreview.unchanged
                  ? '변경 내용이 없습니다.'
                  : savePreview.newVersion
                    ? '기존 기록을 보존하고 v' +
                      savePreview.candidate.version +
                      ' 버전을 생성합니다.'
                    : '현재 버전을 수정합니다.'
              }}
            </p>
            <p>기존 진행과 팀 적용 버전은 변경하지 않습니다.</p>
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
            </p></template
          >
          <template #footer
            ><button class="button secondary" :disabled="busy" @click="savePreview = null">
              계속 편집</button
            ><button class="button primary" :disabled="busy" @click="saveCatalog(true)">
              저장 확인
            </button></template
          >
        </AppDialog>
      </template>
      <template v-else>
        <PageHeading class="page-heading">
          <h1>{{ title }}</h1>
          <TemplateImport v-if="section === 'qualifications'" />
          <button
            v-if="section === 'qualifications' || section === 'courses'"
            class="button primary"
            :disabled="busy"
            @click="createCatalog"
          >
            <AppIcon name="plus" :size="18" />{{
              section === 'courses' ? '인증Set 추가' : '새 자격 만들기'
            }}</button
          ><button
            v-else-if="section === 'notices'"
            class="button primary"
            :disabled="busy"
            @click="editNotice()"
          >
            <AppIcon name="plus" :size="18" />공지 등록
          </button>
        </PageHeading>
        <div
          v-if="!['comparisons', 'policies', 'targets', 'credentials'].includes(section)"
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
                ><option value="Active">Active</option>
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
          </div>
        </div>

        <CredentialManagement v-if="section === 'credentials'" />
        <CertificationTargets
          v-else-if="section === 'targets'"
          :key="`${store.actorId}:${store.managementLv1}`"
        />
        <OrganizationPolicies v-if="section === 'policies'" :key="store.actorId" />
        <PlanningPanel v-if="section === 'assignments'" :key="store.managementLv1" />
        <div v-if="section === 'qualifications'" class="table-panel">
          <table>
            <thead>
              <tr>
                <th>자격명</th>
                <th>버전</th>
                <th>상태</th>
                <th><span class="sr-only">상세</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="q in pageQualifications" :key="q.id">
                <td>
                  <RouterLink
                    :to="store.managementLink(`/admin/qualifications/${q.id}`)"
                    class="table-title"
                    >{{ q.title || '이름 없음' }}</RouterLink
                  >
                  <details v-if="store.qualificationErrors(q).length" class="readiness">
                    <summary>설정 필요 {{ store.qualificationErrors(q).length }}건</summary>
                    <ul>
                      <li v-for="error in store.qualificationErrors(q)" :key="error">
                        {{ error }}
                      </li>
                    </ul>
                    <RouterLink :to="store.managementLink(`/admin/qualifications/${q.id}`)"
                      >기준 확인</RouterLink
                    >
                  </details>
                  <p v-if="store.retiredCourses(q).length" class="muted">
                    신규 배정 불가 ·
                    {{
                      store
                        .retiredCourses(q)
                        .map((c) => `${c.title} v${c.version}`)
                        .join(', ')
                    }}
                    운영 종료
                  </p>
                  <span v-if="q.description.includes('프로세스 검증용')" class="test-data-tag"
                    >시험 데이터</span
                  >
                </td>
                <td>v{{ q.version }}</td>
                <td>
                  <span class="lifecycle-badge" :data-status="q.lifecycleStatus || 'Active'">{{
                    q.lifecycleStatus || 'Active'
                  }}</span>
                </td>
                <td>
                  <QualificationDelete :qualification="q" :disabled="busy" compact />
                  <RouterLink
                    :to="store.managementLink(`/admin/qualifications/${q.id}`)"
                    class="icon-button"
                    :aria-label="`${q.title} 상세`"
                    ><AppIcon name="chevron" :size="18"
                  /></RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!qualifications.length" class="empty-state">검색 결과가 없습니다.</p>
        </div>
        <div v-else-if="section === 'courses'" class="table-panel">
          <table>
            <thead>
              <tr>
                <th>인증Set명</th>
                <th>버전</th>
                <th>필수 평가</th>
                <th>상태</th>
                <th><span class="sr-only">상세</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in pageCourses" :key="c.id">
                <td>
                  <RouterLink
                    :to="store.managementLink(`/admin/courses/${c.id}`)"
                    class="table-title"
                    >{{ c.title || '이름 없음' }}</RouterLink
                  >
                </td>
                <td>v{{ c.version }}</td>
                <td class="muted">{{ c.assessmentKinds.map((k) => labels[k]).join(' · ') }}</td>
                <td>
                  <StatusBadge :status="c.operationalStatus === 'retired' ? 'retired' : 'active'" />
                </td>
                <td>
                  <RouterLink
                    :to="store.managementLink(`/admin/courses/${c.id}`)"
                    class="icon-button"
                    :aria-label="`${c.title} 상세`"
                    ><AppIcon name="chevron" :size="18"
                  /></RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!courses.length" class="empty-state">검색 결과가 없습니다.</p>
        </div>
        <div v-else-if="section === 'assignments'" class="table-panel">
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
                  {{ store.qualification(a.qualificationId).title
                  }}<small class="table-subtext"
                    >v{{ store.qualification(a.qualificationId).version }}</small
                  >
                </td>
                <td>{{ store.completedCount(a) }} / {{ a.enrollments.length }}</td>
                <td>
                  <StatusBadge
                    :status="a.excludedReason ? 'excluded' : a.certifiedAt ? 'certified' : 'draft'"
                    :label="!a.excludedReason && !a.certifiedAt ? '진행 중' : undefined"
                  />
                </td>
                <td>
                  <details v-if="!a.excludedReason" class="row-menu">
                    <summary aria-label="배정 관리"><AppIcon name="settings" :size="18" /></summary>
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
        <div v-else-if="section === 'results'" class="results-list">
          <details v-for="a in assignments" :key="a.id" class="panel result-details">
            <summary>
              <span
                ><strong>{{ store.username(a.learnerId) }}</strong
                ><small
                  >{{ store.qualification(a.qualificationId).title }} · v{{
                    store.qualification(a.qualificationId).version
                  }}</small
                ></span
              ><span class="muted"
                >{{ store.completedCount(a) }} / {{ a.enrollments.length }} 수료</span
              ><StatusBadge
                :status="a.excludedReason ? 'excluded' : a.certifiedAt ? 'certified' : 'draft'"
                :label="!a.certifiedAt && !a.excludedReason ? '진행 중' : undefined"
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
                    <span class="small-label">v{{ store.course(e.courseId).version }}</span>
                  </h2>
                  <StatusBadge v-if="store.complete(e)" status="complete" /><StatusBadge
                    v-if="store.course(e.courseId).operationalStatus === 'retired'"
                    status="retired"
                  />
                </div>
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
                  :to="store.managementLink(`/completions/${e.completion.id}`)"
                  >인증Set 수료증 보기</RouterLink
                >
                <p v-if="!e.history.length" class="muted">평가 이력이 없습니다.</p>
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
                :to="store.managementLink(`/certifications/${a.id}`)"
                class="button secondary"
                >인증 근거 보기<AppIcon name="arrow" :size="16"
              /></RouterLink>
            </div>
          </details>
          <p v-if="!assignments.length" class="panel empty-state">검색 결과가 없습니다.</p>
        </div>
        <ComparisonPanel v-else-if="section === 'comparisons'" />
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
          v-if="!['comparisons', 'policies', 'targets', 'credentials'].includes(section)"
          :count="list.count"
          :pages="list.pages"
          v-model:page="list.page"
          v-model:size="list.size"
          v-model:density="list.density"
          v-model:sort="list.sort"
        />
      </template>
      <AppDialog
        :open="!!selectedAssignment"
        title="검증 제외"
        @update:open="selectedAssignment = null"
        ><p>
          {{ selectedAssignment && store.username(selectedAssignment.learnerId) }} ·
          {{ selectedAssignment && store.qualification(selectedAssignment.qualificationId).title }}
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
.criterion-versions {
  margin: 16px 0;
  font-size: 14px;
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
