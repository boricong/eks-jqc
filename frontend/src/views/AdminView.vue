<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
import ManagementContext from '../components/ManagementContext.vue';
import CourseLifecycle from '../components/CourseLifecycle.vue';
import ComparisonPanel from '../components/ComparisonPanel.vue';
import QualificationFields from '../components/QualificationFields.vue';
import CourseLearningEditor from '../components/CourseLearningEditor.vue';
import TemplateImport from '../components/TemplateImport.vue';
import ListControls from '../components/ListControls.vue';
import { useListView } from '../composables/useListView';
import PlanningPanel from '../components/PlanningPanel.vue';
import ValidityBadge from '../components/ValidityBadge.vue';
import { kindLabels, certificationStatus, kstDate } from '@eks/contracts';
import type {
  Assignment,
  Course,
  Notice,
  Qualification,
  AuditEvent,
  Verdict,
  Draft,
} from '../types';
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
  { id: 'qualifications', name: '자격 관리', icon: 'award' },
  { id: 'courses', name: '과정 관리', icon: 'book' },
  { id: 'assignments', name: '대상자·계획', icon: 'users' },
  { id: 'results', name: '결과 조회', icon: 'clipboard' },
  { id: 'comparisons', name: '기준 검증', icon: 'check' },
  { id: 'notices', name: '공지 관리', icon: 'notice' },
];
const section = computed(() => String(route.params.section));
const filterKey=()=>`eks-admin-filter-${store.actorId}-${store.managementLv1}-${section.value}`;
const title = computed(() => sections.find((s) => s.id === section.value)!.name);
const busy = ref(false);
const query = ref(''),
  courseSearch = ref(''),
  filter = ref('all'),
  errors = ref<string[]>([]),
  editorTab = ref('objective');
const learningEditor = ref<{ focusInvalid: () => boolean } | null>(null);
const courseDraft = ref<Course | null>(null),
  qualificationDraft = ref<Qualification | null>(null);
const editor = computed(() => courseDraft.value || qualificationDraft.value);
const readOnly = computed(() => editor.value?.status === 'published');
const selectedAssignment = ref<Assignment | null>(null),
  assignmentAction = ref<'exclude' | 'ft'>('exclude'),
  reason = ref(''),
  ftId = ref('');
const noticeDraft = ref<Notice | null>(null);
function plain<T>(item: T): T {
  return JSON.parse(JSON.stringify(item));
}
watch(
  () => route.fullPath,
  () => {
    let remembered:{query?:string;filter?:string}={};try{remembered=JSON.parse(localStorage.getItem(filterKey())||'{}');}catch{}
    query.value = remembered.query||'';
    courseSearch.value = '';
    filter.value = remembered.filter||(section.value === 'courses' ? 'active' : 'all');
    selectedAssignment.value = null;
    noticeDraft.value = null;
    reason.value = '';
    ftId.value = '';
    errors.value = [];
    courseDraft.value = null;
    qualificationDraft.value = null;
    if (route.params.id && section.value === 'courses') {
      const c = organizationData.value.courses.find((c) => c.id === route.params.id);
      if (c) {
        courseDraft.value = plain(c);
        editorTab.value = c.assessmentKinds[0] || 'objective';
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
    (q) => matches(q.title) && (filter.value === 'all' || q.status === filter.value),
  ),
);
const courses = computed(() =>
  organizationData.value.courses.filter(
    (c) =>
      matches(c.title) &&
      (filter.value === 'all' ||
        (filter.value === 'active' && c.operationalStatus !== 'retired') ||
        (filter.value === 'retired' && c.operationalStatus === 'retired') ||
        (filter.value === 'draft' && c.status === 'draft') ||
        (filter.value === 'published' &&
          c.status === 'published' &&
          c.operationalStatus === 'active')),
  ),
);
const selectableCourses = computed(() => {
  const selected = new Set(qualificationDraft.value?.courseIds || []);
  const term = courseSearch.value.trim().toLocaleLowerCase();
  return organizationData.value.courses
    .filter((c) => selected.has(c.id) || !term || `${c.title} v${c.version}`.toLocaleLowerCase().includes(term))
    .slice()
    .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || a.title.localeCompare(b.title, 'ko'));
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
const listItems=computed<Array<Qualification|Course|Assignment|Notice>>(()=>section.value==='qualifications'?qualifications.value:section.value==='courses'?courses.value:section.value==='notices'?notices.value:assignments.value);
const list=useListView(listItems,'admin',item=>'title'in item?item.title:store.username(item.learnerId));
watch([query,filter],()=>{list.page=1;localStorage.setItem(filterKey(),JSON.stringify({query:query.value,filter:filter.value}));});
const pageQualifications=computed(()=>list.rows as Qualification[]),pageCourses=computed(()=>list.rows as Course[]),pageAssignments=computed(()=>list.rows as Assignment[]),pageNotices=computed(()=>list.rows as Notice[]);
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
async function saveCatalog(publish = false) {
  if (!editor.value || readOnly.value || busy.value) return;
  errors.value = publish
    ? courseDraft.value
      ? store.courseErrors(courseDraft.value)
      : store.qualificationErrors(qualificationDraft.value!)
    : [];
  if (errors.value.length) {
    if (courseDraft.value) learningEditor.value?.focusInvalid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  busy.value = true;
  try {
    const result = await store.saveCatalog(section.value, plain(editor.value), publish);
    if (courseDraft.value) courseDraft.value = plain(store.course(result.id));
    else qualificationDraft.value = plain(store.qualification(result.id));
  } catch (error) {
    errors.value = [(error as Error).message];
  } finally {
    busy.value = false;
  }
}
async function reloadCatalog() {
  if (!window.confirm('저장하지 않은 내용을 버리고 다시 불러올까요?')) return;
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
async function cloneVersion() {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await store.cloneCatalog(section.value, editor.value!.id);
    await router.push(store.managementLink(`/admin/${section.value}/${result.id}`));
  } catch (error) {
    errors.value = [(error as Error).message];
  } finally {
    busy.value = false;
  }
}
const cryptoId = () => crypto.randomUUID();
function addQuestion() {
  courseDraft.value!.questions.push({
    id: crypto.randomUUID(),
    prompt: '',
    choices: ['', ''],
    correct: null,
    points: 1,
    category: 'written',
  });
}
function addPractical() {
  courseDraft.value!.practicalItems.push({
    id: crypto.randomUUID(),
    title: '',
    criterion: '',
    mandatory: true,
  });
}
function openAssignment(a: Assignment, action: 'exclude' | 'ft') {
  selectedAssignment.value = a;
  assignmentAction.value = action;
  reason.value = '';
  ftId.value = a.ftId || '';
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
      ftId.value,
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
        lv1OrganizationId: store.managementLv1,
        title: '',
        body: '',
        date: new Date().toISOString().slice(0, 10),
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
  'assignment.ft': 'FT 변경',
  'assignment.exclude': '검증 제외',
  'attempt.start': '평가 시작',
  'attempt.submit': '평가 확정',
  'attempt.grade.save': '주관식 채점 저장',
  'attempt.grade.finalize': '주관식 채점 확정',
  'plan.complete': '개인 계획 완료 · 결재 생략',
  'plan.save': '개인 계획 수정',
  'learning.save': '학습 완료 기록',
  seed: '초기 데이터',
  'comparison.create': '비교 초안',
  'comparison.save': '비교 저장',
  'comparison.finalize': '비교 확정',
  'comparison.correct': '비교 정정',
};
function archivedDrafts(ev: AuditEvent) {
  return (ev.details.archivedDrafts || []) as unknown as {
    attemptId: string;
    evaluatorId?: string;
    verdicts: Record<string, Verdict>;
    grades?: Draft['grades'];
    feedback?: string;
  }[];
}
function itemTitle(id: string) {
  return (
    organizationData.value.courses.flatMap((c) => c.practicalItems).find((i) => i.id === id)
      ?.title || '실기 항목'
  );
}

function canLeave() {
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
    !window.confirm(
      '작성 중인 입력이 있습니다. 저장하려면 취소를 누르세요. 변경을 버리고 나갈까요?',
    )
  )
    return false;
  return (
    !store.canEnterManagement ||
    !editor.value ||
    readOnly.value ||
    JSON.stringify(source) === JSON.stringify(editor.value) ||
    window.confirm(
      '저장하지 않은 변경 사항이 있습니다. 저장하려면 취소를 누르세요. 변경을 버리고 나갈까요?',
    )
  );
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
</script>
<template>
  <div class="container page admin-shell" :data-density="list.density">
    <ManagementContext />
    <aside class="admin-sidebar">
      <p class="organization-context">{{ store.managementOrganization?.name }}</p>
      <h2 class="small-heading">관리</h2>
      <nav aria-label="관리 메뉴">
        <RouterLink :to="store.managementLink('/admin/catalog')"><AppIcon name="file" :size="18"/>기준 일괄 관리</RouterLink>
        <RouterLink
          v-for="s in sections"
          :key="s.id"
          :to="store.managementLink(`/admin/${s.id}`)"
          :class="{ active: section === s.id }"
          :aria-current="section === s.id ? 'page' : undefined"
          ><AppIcon :name="s.icon" :size="18" />{{ s.name }}</RouterLink
        >
      </nav>
    </aside>
    <div v-if="!store.managementReady" class="empty-state">
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
        <div class="page-heading">
          <h1>{{ editor.title || (courseDraft ? '새 과정' : '새 자격') }}</h1>
          <div class="actions">
            <StatusBadge
              :status="
                courseDraft?.operationalStatus === 'retired'
                  ? 'retired'
                  : readOnly
                    ? 'published'
                    : 'catalogDraft'
              "
            /><span class="small-label">v{{ editor.version }}</span
            ><button v-if="readOnly" class="button primary" :disabled="busy" @click="cloneVersion">
              <AppIcon name="plus" :size="18" />새 버전
            </button>
          </div>
        </div>
        <div v-if="errors.length" class="error-message" role="alert">
          <AppIcon name="alert" :size="18" />
          <ul>
            <li v-for="error in errors" :key="error">{{ error }}</li>
          </ul>
        </div>
        <button v-if="errors.length" class="button secondary" @click="reloadCatalog">
          다시 불러오기
        </button>
        <CourseLifecycle
          v-if="courseDraft"
          :key="courseDraft.id"
          :course="store.course(courseDraft.id) || courseDraft"
          :disabled="busy"
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
              ? '새 버전에서 종료 과정을 제거하거나 대체해 주세요.'
              : '사용 등록 전에 종료 과정을 제거하거나 대체해 주세요.'
          }}
        </p>
        <div class="panel editor-panel">
          <label class="field"
            ><span>{{ courseDraft ? '과정명' : '자격명' }}</span
            ><input v-model="editor.title" :disabled="readOnly"
          /></label>
          <template v-if="qualificationDraft">
            <QualificationFields :qualification="qualificationDraft" :disabled="readOnly" />
            <fieldset class="course-selection">
              <legend>필수 과정</legend>
              <label class="field course-selection-search"><span>과정 검색 · {{ qualificationDraft.courseIds.length }}개 선택</span>
                <input v-model="courseSearch" type="search" placeholder="과정명 또는 버전 검색" aria-label="필수 과정 검색" />
              </label>
              <div class="course-selection-list">
              <label v-for="c in selectableCourses" :key="c.id" class="choice"
                ><input
                  v-model="qualificationDraft.courseIds"
                  type="checkbox"
                  :value="c.id"
                  :disabled="readOnly" /><span>{{ c.title || '이름 없음' }}</span
                ><span class="muted">v{{ c.version }}</span
                ><StatusBadge
                  :status="
                    c.operationalStatus === 'retired'
                      ? 'retired'
                      : c.status === 'draft'
                        ? 'catalogDraft'
                        : 'published'
                  "
              /></label>
              <p v-if="!selectableCourses.length" class="muted">검색 결과가 없습니다.</p>
              </div></fieldset
          ></template>
          <template v-if="courseDraft"
            ><div class="form-grid">
              <fieldset class="assessment-kind-group">
                <legend>필수 평가</legend>
                <div class="assessment-kind-options">
                <label v-for="(label, kind) in labels" :key="kind" class="checkbox-label"
                  ><input
                    v-model="courseDraft.assessmentKinds"
                    type="checkbox"
                    :value="kind"
                    :disabled="readOnly"
                    @change="editorTab = courseDraft.assessmentKinds[0] || 'objective'"
                  />{{ label }}</label
                >
                </div>
              </fieldset>
              <label v-if="courseDraft.assessmentKinds.includes('objective')" class="field"
                ><span>객관식 합격 기준 (%)</span
                ><input
                  v-model.number="courseDraft.passScore"
                  :disabled="readOnly"
                  type="number"
                  min="1"
                  max="100"
                  placeholder="미정"
              /></label>
            </div>
            <label class="field"
              ><span>학습자료</span
              ><textarea v-model="courseDraft.material" :disabled="readOnly" rows="3" /></label
            ><label class="field"
              ><span>학습자료 URL</span
              ><input
                v-model="courseDraft.materialUrl"
                :disabled="readOnly"
                type="url"
                placeholder="https://" /></label
          ></template>
        </div>
        <CourseLearningEditor v-if="courseDraft" ref="learningEditor" :course="courseDraft" :disabled="readOnly" />
        <template v-if="courseDraft"
          ><div v-if="section !== 'comparisons'" class="list-toolbar">
            <div class="tabs">
              <button
                v-if="courseDraft.assessmentKinds.includes('subjective')"
                :class="{ active: editorTab === 'subjective' }"
                :aria-pressed="editorTab === 'subjective'"
                @click="editorTab = 'subjective'"
              >
                주관식 <span>{{ courseDraft.subjectiveQuestions.length }}</span>
              </button>
              <button
                v-if="courseDraft.assessmentKinds.includes('objective')"
                :class="{ active: editorTab === 'objective' }"
                :aria-pressed="editorTab === 'objective'"
                @click="editorTab = 'objective'"
              >
                객관식 <span>{{ courseDraft.questions.length }}</span></button
              ><button
                v-if="courseDraft.assessmentKinds.includes('practical')"
                :class="{ active: editorTab === 'practical' }"
                :aria-pressed="editorTab === 'practical'"
                @click="editorTab = 'practical'"
              >
                실기 <span>{{ courseDraft.practicalItems.length }}</span>
              </button>
            </div>
            <button
              v-if="!readOnly"
              class="button secondary"
              @click="
                editorTab === 'objective'
                  ? addQuestion()
                  : editorTab === 'subjective'
                    ? courseDraft.subjectiveQuestions.push({
                        id: cryptoId(),
                        prompt: '',
                        points: 1,
                        rubric: '',
                        modelAnswer: '',
                      })
                    : addPractical()
              "
            >
              <AppIcon name="plus" :size="18" />{{
                editorTab === 'objective' ? '문항 추가' : '항목 추가'
              }}
            </button>
          </div>
          <template v-if="editorTab === 'objective'"
            ><details
              v-for="(q, index) in courseDraft.questions"
              :key="q.id"
              class="editor-question panel"
              :open="index === 0"
            >
              <summary>
                <span class="question-number">{{ index + 1 }}</span
                ><span>{{ q.prompt || '새 문항' }}</span
                ><AppIcon name="down" :size="16" />
              </summary>
              <div class="editor-question-body">
                <label class="field"
                  ><span>문항</span><textarea v-model="q.prompt" :disabled="readOnly" rows="2" />
                </label>
                <label class="field"
                  ><span>문항 분류</span
                  ><select v-model="q.category" :disabled="readOnly">
                    <option value="written">필기</option>
                    <option value="case">Case</option>
                  </select></label
                >
                <fieldset class="options-editor">
                  <legend>선택지 · 정답 선택</legend>
                  <div v-for="(_, i) in q.choices" :key="i" class="option-editor">
                    <label
                      ><input
                        v-model="q.correct"
                        :value="i"
                        :disabled="readOnly"
                        type="radio"
                        :name="`correct-${q.id}`"
                        :aria-label="`${i + 1}번 선택지를 정답으로 지정`" /></label
                    ><input
                      v-model="q.choices[i]"
                      :disabled="readOnly"
                      :aria-label="`${i + 1}번 선택지`"
                    /><span v-if="q.correct === i" class="small-label">정답</span
                    ><button
                      v-if="!readOnly"
                      class="icon-button"
                      :aria-label="`${i + 1}번 선택지 삭제`"
                      @click="
                        q.choices.splice(i, 1);
                        q.correct = null;
                      "
                    >
                      <AppIcon name="close" :size="16" />
                    </button>
                  </div>
                  <button v-if="!readOnly" class="text-link" @click="q.choices.push('')">
                    <AppIcon name="plus" :size="16" />선택지 추가
                  </button>
                </fieldset>
                <label class="field points-field"
                  ><span>배점</span
                  ><input
                    v-model.number="q.points"
                    :disabled="readOnly"
                    type="number"
                    min="1" /></label
                ><button
                  v-if="!readOnly"
                  class="text-link"
                  @click="courseDraft.questions.splice(index, 1)"
                >
                  문항 삭제
                </button>
              </div>
            </details>
            <div v-if="!courseDraft.questions.length" class="panel empty-state">
              등록된 문항이 없습니다.
            </div></template
          >
          <template v-else-if="editorTab === 'subjective'">
            <section class="panel editor-panel">
              <label class="field"
                ><span>주관식 합격 기준 (%)</span
                ><input
                  v-model.number="courseDraft.subjectivePassScore"
                  :disabled="readOnly"
                  type="number"
                  min="1"
                  max="100"
                  placeholder="미정"
              /></label>
            </section>
            <section
              v-for="(q, index) in courseDraft.subjectiveQuestions"
              :key="q.id"
              class="panel editor-panel"
            >
              <h2>주관식 {{ index + 1 }}</h2>
              <label class="field"
                ><span>문항</span><textarea v-model="q.prompt" :disabled="readOnly" rows="2" />
              </label>
              <label class="field"
                ><span>배점</span
                ><input v-model.number="q.points" :disabled="readOnly" type="number" min="1"
              /></label>
              <label class="field"
                ><span>채점 기준 · 관리자·지정 FT만 조회</span
                ><textarea v-model="q.rubric" :disabled="readOnly" rows="3" />
              </label>
              <label class="field"
                ><span>모범답안 · 선택</span
                ><textarea v-model="q.modelAnswer" :disabled="readOnly" rows="3" />
              </label>
              <button
                v-if="!readOnly"
                class="text-link"
                @click="courseDraft.subjectiveQuestions.splice(index, 1)"
              >
                문항 삭제
              </button>
            </section>
            <p v-if="!courseDraft.subjectiveQuestions.length" class="panel empty-state">
              등록된 문항이 없습니다.
            </p>
          </template>
          <template v-else
            ><div class="panel editor-panel">
              <label class="field"
                ><span>수행 조건</span
                ><input v-model="courseDraft.instruction" :disabled="readOnly"
              /></label>
            </div>
            <div
              v-for="(item, index) in courseDraft.practicalItems"
              :key="item.id"
              class="panel editor-panel"
            >
              <div class="section-heading">
                <h2>항목 {{ index + 1 }}</h2>
                <label class="checkbox-label"
                  ><input
                    v-model="item.mandatory"
                    :disabled="readOnly"
                    type="checkbox"
                  />필수</label
                >
              </div>
              <label class="field"
                ><span>항목명</span><input v-model="item.title" :disabled="readOnly" /></label
              ><label class="field"
                ><span>판정 기준</span
                ><textarea v-model="item.criterion" :disabled="readOnly" rows="2" /></label
              ><button
                v-if="!readOnly"
                class="text-link"
                @click="courseDraft.practicalItems.splice(index, 1)"
              >
                항목 삭제
              </button>
            </div>
            <div v-if="!courseDraft.practicalItems.length" class="panel empty-state">
              등록된 항목이 없습니다.
            </div></template
          ></template
        >
        <div v-if="!readOnly" class="actionbar">
          <span class="muted">초안 · v{{ editor.version }}</span>
          <div class="actions">
            <button class="button secondary" @click="saveCatalog()">초안 저장</button
            ><button class="button primary" :disabled="busy" @click="saveCatalog(true)">
              사용 등록<AppIcon name="check" :size="18" />
            </button>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="page-heading">
          <h1>{{ title }}</h1>
          <TemplateImport v-if="section === 'qualifications'" />
          <button
            v-if="section === 'qualifications' || section === 'courses'"
            class="button primary"
            :disabled="busy"
            @click="createCatalog"
          >
            <AppIcon name="plus" :size="18" />{{
              section === 'courses' ? '과정 추가' : '새 자격 만들기'
            }}</button
          ><button
            v-else-if="section === 'notices'"
            class="button primary"
            :disabled="busy"
            @click="editNotice()"
          >
            <AppIcon name="plus" :size="18" />공지 등록
          </button>
        </div>
        <div v-if="section !== 'comparisons'" class="list-toolbar">
          <div class="filter-controls">
            <label class="search-field"
              ><AppIcon name="search" :size="18" /><input
                v-model="query"
                :placeholder="
                  section === 'assignments' || section === 'results'
                    ? '대상자 · 자격 검색'
                    : section === 'courses'
                      ? '과정 검색'
                      : section === 'notices'
                        ? '공지 검색'
                        : '자격 검색'
                "
                :aria-label="`${title} 검색`" /></label
            ><select v-if="section !== 'notices'" v-model="filter" aria-label="상태 필터">
              <option v-if="section === 'courses'" value="active">초안 · 운영 중</option>
              <option v-if="section === 'courses'" value="retired">운영 종료</option>
              <option value="all">전체 상태</option>
              <template v-if="section === 'qualifications' || section === 'courses'"
                ><option value="draft">초안</option>
                <option value="published">사용 중</option></template
              ><template v-else
                ><option value="active">진행 중</option>
                <option value="certified">인증 취득 전체</option>
                <option value="valid">현재 유효</option>
                <option value="expiring">만료 예정</option>
                <option value="expired">만료</option>
                <option value="unknown">유효기간 미설정</option>
                <option value="excluded">검증 제외</option></template
              >
            </select>
          </div>
        </div>
        <ListControls v-if="section!=='comparisons'" :count="list.count" :pages="list.pages" v-model:page="list.page" v-model:size="list.size" v-model:density="list.density" v-model:sort="list.sort"/>
        <PlanningPanel v-if="section === 'assignments'" :key="store.managementLv1" />
        <div v-if="section === 'qualifications'" class="table-panel">
          <table>
            <thead>
              <tr>
                <th>자격명</th>
                <th>버전</th>
                <th>필수 과정</th>
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
                  <span v-if="q.description.includes('프로세스 검증용')" class="test-data-tag">시험 데이터</span>
                </td>
                <td>v{{ q.version }}</td>
                <td>{{ q.courseIds.length }}과정</td>
                <td>
                  <StatusBadge :status="q.status === 'draft' ? 'catalogDraft' : 'published'" />
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
                </td>
                <td>
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
                <th>과정명</th>
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
                  <StatusBadge
                    :status="
                      c.operationalStatus === 'retired'
                        ? 'retired'
                        : c.status === 'draft'
                          ? 'catalogDraft'
                          : 'published'
                    "
                  />
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
                <th>FT</th>
                <th>과정 수료</th>
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
                <td>{{ store.username(a.ftId) }}</td>
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
                      <button @click="openAssignment(a, 'ft')">FT 변경</button
                      ><button @click="openAssignment(a, 'exclude')">검증 제외</button>
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
                  a.certification.expiresOn
                    ? `만료일 ${a.certification.expiresOn}`
                    : a.certification.validity?.type === 'unlimited'
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
                  <div v-if="h.kind === 'objective'" class="attempt-items">
                    <p class="small-label">
                      득점 {{ h.earned }} / {{ h.total }} · 합격 기준
                      {{ store.course(e.courseId).passScore }}%
                    </p>
                    <div v-for="q in store.course(e.courseId).questions" :key="q.id">
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
                  <div v-else-if="h.kind === 'subjective'" class="attempt-items">
                    <p class="small-label">
                      평가자 {{ store.username(h.evaluatorId) }} · 득점 {{ h.earned }} /
                      {{ h.total }} · 합격 기준 {{ store.course(e.courseId).subjectivePassScore }}%
                    </p>
                    <div v-for="q in store.course(e.courseId).subjectiveQuestions" :key="q.id">
                      <h3>{{ q.prompt }}</h3>
                      <p class="preserve-lines">답안: {{ h.subjectiveAnswers?.[q.id] }}</p>
                      <p>{{ h.grades?.[q.id]?.points }} / {{ q.points }}점</p>
                      <p class="preserve-lines">채점 근거: {{ h.grades?.[q.id]?.reason }}</p>
                    </div>
                    <p class="preserve-lines">공개 피드백: {{ h.feedback || '없음' }}</p>
                  </div>
                  <div v-else class="attempt-items">
                    <p class="small-label">
                      평가자 {{ store.username(h.evaluatorId) }} ·
                      {{ new Date(h.date).toLocaleString('ko-KR') }}
                    </p>
                    <div v-for="item in store.course(e.courseId).practicalItems" :key="item.id">
                      <p>
                        {{ item.title }}
                        <StatusBadge
                          :status="h.verdicts?.[item.id]?.value === 'pass' ? 'passed' : 'failed'"
                        />
                      </p>
                      <span class="muted">{{ h.verdicts?.[item.id]?.evidence }}</span>
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
                  >과정 수료증 보기</RouterLink
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
                  <details v-if="ev.action === 'assignment.ft'">
                    <summary>이전 FT 초안</summary>
                    <p class="muted">
                      {{ store.username(String(ev.details.previousFtId)) }} →
                      {{ store.username(String(ev.details.nextFtId)) }}
                    </p>
                    <section v-for="archived in archivedDrafts(ev)" :key="archived.attemptId">
                      <div
                        v-for="(value, itemId) in archived.verdicts"
                        :key="itemId"
                        class="audit-row"
                      >
                        <p>
                          {{ itemTitle(String(itemId)) }} ·
                          {{
                            value.value === 'pass'
                              ? '통과'
                              : value.value === 'fail'
                                ? '미통과'
                                : '미판정'
                          }}
                        </p>
                        <p class="muted">{{ value.evidence || '근거 미입력' }}</p>
                      </div>
                      <div
                        v-for="(grade, questionId) in archived.grades"
                        :key="questionId"
                        class="audit-row"
                      >
                        <p>주관식 문항 {{ questionId }} · {{ grade.points }}점</p>
                        <p class="preserve-lines">{{ grade.reason || '근거 미입력' }}</p>
                      </div>
                      <p v-if="archived.feedback" class="preserve-lines">
                        공개 피드백 초안: {{ archived.feedback }}
                      </p>
                      <p
                        v-if="
                          !Object.keys(archived.verdicts).length &&
                          !Object.keys(archived.grades || {}).length
                        "
                        class="muted"
                      >
                        작성한 판정이 없습니다.
                      </p>
                    </section>
                  </details>
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
      </template>
      <AppDialog
        :open="!!selectedAssignment"
        :title="assignmentAction === 'ft' ? 'FT 변경' : '검증 제외'"
        @update:open="selectedAssignment = null"
        ><p>
          {{ selectedAssignment && store.username(selectedAssignment.learnerId) }} ·
          {{ selectedAssignment && store.qualification(selectedAssignment.qualificationId).title }}
        </p>
        <div v-if="errors.length" class="error-message" role="alert">{{ errors[0] }}</div>
        <label v-if="assignmentAction === 'ft'" class="field"
          ><span>담당 FT</span
          ><select aria-label="담당 FT" v-model="ftId" :disabled="busy">
            <option
              v-for="u in organizationData.users.filter(
                (u) =>
                  u.roles.includes('ft') &&
                  u.organizationActive &&
                  u.id !== selectedAssignment?.learnerId,
              )"
              :key="u.id"
              :value="u.id"
            >
              {{ u.name }} ·
              {{
                u.organizationPath
                  .slice(1)
                  .map((o) => o.name)
                  .join(' › ') || 'Lv1 직속'
              }}
            </option>
          </select></label
        >
        <p v-else class="muted">기존 기록은 보존되며, 이후 평가를 진행할 수 없습니다.</p>
        <label class="field"><span>변경 사유</span><textarea v-model="reason" rows="3" /></label
        ><template #footer
          ><button class="button secondary" @click="selectedAssignment = null">취소</button
          ><button class="button primary" :disabled="busy" @click="changeAssignment">
            {{ assignmentAction === 'ft' ? '변경' : '검증 제외' }}
          </button></template
        ></AppDialog
      >
      <AppDialog :open="!!noticeDraft" title="공지 편집" @update:open="noticeDraft = null"
        ><template v-if="noticeDraft"
          ><div v-if="errors.length" class="error-message" role="alert">{{ errors[0] }}</div>
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
