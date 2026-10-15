<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
import ComparisonPanel from '../components/ComparisonPanel.vue';
import type { Assignment, Course, Notice, Qualification, AuditEvent, Verdict } from '../types';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const sections = [
  { id: 'qualifications', name: '자격 관리', icon: 'award' },
  { id: 'courses', name: '과정 관리', icon: 'book' },
  { id: 'assignments', name: '자격 배정', icon: 'users' },
  { id: 'results', name: '결과 조회', icon: 'clipboard' },
  { id: 'comparisons', name: '기준 검증', icon: 'check' },
  { id: 'notices', name: '공지 관리', icon: 'notice' },
];
const section = computed(() => String(route.params.section));
const title = computed(() => sections.find((s) => s.id === section.value)!.name);
const busy = ref(false);
const query = ref(''),
  filter = ref('all'),
  errors = ref<string[]>([]),
  editorTab = ref('objective');
const courseDraft = ref<Course | null>(null),
  qualificationDraft = ref<Qualification | null>(null);
const editor = computed(() => courseDraft.value || qualificationDraft.value);
const readOnly = computed(() => editor.value?.status === 'published');
const assignmentOpen = ref(false),
  assignmentForm = ref({
    qualificationId: 'demo-qualification',
    learnerId: 'learner-2',
    ftId: 'ft-1',
  });
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
    query.value = '';
    filter.value = 'all';
    errors.value = [];
    courseDraft.value = null;
    qualificationDraft.value = null;
    if (route.params.id && section.value === 'courses') {
      const c = store.data.courses.find((c) => c.id === route.params.id);
      if (c) {
        courseDraft.value = plain(c);
        editorTab.value = c.mode === 'practical' ? 'practical' : 'objective';
      }
    }
    if (route.params.id && section.value === 'qualifications') {
      const q = store.data.qualifications.find((q) => q.id === route.params.id);
      if (q) qualificationDraft.value = plain(q);
    }
  },
  { immediate: true },
);
const matches = (text: string) => text.toLowerCase().includes(query.value.toLowerCase());
const qualifications = computed(() =>
  store.data.qualifications.filter(
    (q) => matches(q.title) && (filter.value === 'all' || q.status === filter.value),
  ),
);
const courses = computed(() =>
  store.data.courses.filter(
    (c) => matches(c.title) && (filter.value === 'all' || c.status === filter.value),
  ),
);
const assignments = computed(() =>
  store.data.assignments.filter(
    (a) =>
      matches(store.qualification(a.qualificationId).title + ' ' + store.username(a.learnerId)) &&
      (filter.value === 'all' ||
        (filter.value === 'excluded' && !!a.excludedReason) ||
        (filter.value === 'active' && !a.excludedReason && !a.certifiedAt) ||
        (filter.value === 'certified' && !a.excludedReason && !!a.certifiedAt)),
  ),
);
const notices = computed(() => store.data.notices.filter((n) => matches(n.title)));
async function createCatalog() {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await store.createCatalog(section.value);
    await router.push(`/admin/${section.value}/${result.id}`);
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
    await router.push(`/admin/${section.value}/${result.id}`);
  } catch (error) {
    errors.value = [(error as Error).message];
  } finally {
    busy.value = false;
  }
}
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
async function addAssignment() {
  if (busy.value) return;
  busy.value = true;
  try {
    await store.addAssignment(
      assignmentForm.value.qualificationId,
      assignmentForm.value.learnerId,
      assignmentForm.value.ftId,
    );
    assignmentOpen.value = false;
    errors.value = [];
  } catch (error) {
    errors.value = [(error as Error).message];
  } finally {
    busy.value = false;
  }
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
const needsFT = computed(() =>
  store
    .qualification(assignmentForm.value.qualificationId)
    ?.courseIds.some((id) => store.requiredKinds(store.course(id)).includes('practical')),
);
const labels = { objective: '객관식', practical: '실기', both: '객관식 · 실기' };
const auditLabels: Record<string, string> = {
  'assignment.create': '자격 배정',
  'assignment.ft': 'FT 변경',
  'assignment.exclude': '검증 제외',
  'attempt.start': '평가 시작',
  'attempt.submit': '평가 확정',
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
  }[];
}
function itemTitle(id: string) {
  return (
    store.data.courses.flatMap((c) => c.practicalItems).find((i) => i.id === id)?.title ||
    '실기 항목'
  );
}

function canLeave() {
  const source = courseDraft.value
    ? store.data.courses.find((c) => c.id === courseDraft.value!.id)
    : qualificationDraft.value
      ? store.data.qualifications.find((q) => q.id === qualificationDraft.value!.id)
      : null;
  return (
    !editor.value ||
    readOnly.value ||
    JSON.stringify(source) === JSON.stringify(editor.value) ||
    window.confirm('저장하지 않은 변경 사항이 있습니다. 나갈까요?')
  );
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
</script>
<template>
  <div class="container page admin-shell">
    <aside class="admin-sidebar">
      <h2 class="small-heading">관리</h2>
      <nav aria-label="관리 메뉴">
        <RouterLink
          v-for="s in sections"
          :key="s.id"
          :to="`/admin/${s.id}`"
          :class="{ active: section === s.id }"
          :aria-current="section === s.id ? 'page' : undefined"
          ><AppIcon :name="s.icon" :size="18" />{{ s.name }}</RouterLink
        >
      </nav>
    </aside>
    <div class="admin-content">
      <div
        v-if="errors.length && !editor && !assignmentOpen && !selectedAssignment && !noticeDraft"
        class="error-message"
        role="alert"
      >
        {{ errors.join(' · ') }}
      </div>
      <template v-if="editor">
        <RouterLink :to="`/admin/${section}`" class="back-link"
          ><AppIcon name="back" :size="16" />{{ title }}</RouterLink
        >
        <div class="page-heading">
          <h1>{{ editor.title || (courseDraft ? '새 과정' : '새 자격') }}</h1>
          <div class="actions">
            <StatusBadge :status="readOnly ? 'published' : 'catalogDraft'" /><span
              class="small-label"
              >v{{ editor.version }}</span
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
        <div class="panel editor-panel">
          <label class="field"
            ><span>{{ courseDraft ? '과정명' : '자격명' }}</span
            ><input v-model="editor.title" :disabled="readOnly"
          /></label>
          <template v-if="qualificationDraft"
            ><fieldset class="course-selection">
              <legend>필수 과정</legend>
              <label v-for="c in store.data.courses" :key="c.id" class="choice"
                ><input
                  v-model="qualificationDraft.courseIds"
                  type="checkbox"
                  :value="c.id"
                  :disabled="readOnly" /><span>{{ c.title || '이름 없음' }}</span
                ><span class="muted">v{{ c.version }}</span
                ><StatusBadge :status="c.status === 'draft' ? 'catalogDraft' : 'published'"
              /></label></fieldset
          ></template>
          <template v-if="courseDraft"
            ><div class="form-grid">
              <label class="field"
                ><span>필수 평가</span
                ><select
                  v-model="courseDraft.mode"
                  :disabled="readOnly"
                  @change="editorTab = courseDraft.mode === 'practical' ? 'practical' : 'objective'"
                >
                  <option value="both">객관식 · 실기</option>
                  <option value="objective">객관식</option>
                  <option value="practical">실기</option>
                </select></label
              ><label v-if="courseDraft.mode !== 'practical'" class="field"
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
        <template v-if="courseDraft"
          ><div v-if="section !== 'comparisons'" class="list-toolbar">
            <div class="tabs">
              <button
                v-if="courseDraft.mode !== 'practical'"
                :class="{ active: editorTab === 'objective' }"
                :aria-pressed="editorTab === 'objective'"
                @click="editorTab = 'objective'"
              >
                객관식 <span>{{ courseDraft.questions.length }}</span></button
              ><button
                v-if="courseDraft.mode !== 'objective'"
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
              @click="editorTab === 'objective' ? addQuestion() : addPractical()"
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
          <button
            v-if="section === 'qualifications' || section === 'courses'"
            class="button primary"
            :disabled="busy"
            @click="createCatalog"
          >
            <AppIcon name="plus" :size="18" />{{
              section === 'courses' ? '과정 추가' : '자격 추가'
            }}</button
          ><button
            v-else-if="section === 'assignments'"
            class="button primary"
            :disabled="busy"
            @click="
              assignmentOpen = true;
              errors = [];
            "
          >
            <AppIcon name="plus" :size="18" />자격 배정</button
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
              <option value="all">전체 상태</option>
              <template v-if="section === 'qualifications' || section === 'courses'"
                ><option value="draft">초안</option>
                <option value="published">사용 중</option></template
              ><template v-else
                ><option value="active">진행 중</option>
                <option value="certified">인증 완료</option>
                <option value="excluded">검증 제외</option></template
              >
            </select>
          </div>
        </div>
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
              <tr v-for="q in qualifications" :key="q.id">
                <td>
                  <RouterLink :to="`/admin/qualifications/${q.id}`" class="table-title">{{
                    q.title || '이름 없음'
                  }}</RouterLink>
                </td>
                <td>v{{ q.version }}</td>
                <td>{{ q.courseIds.length }}과정</td>
                <td>
                  <StatusBadge :status="q.status === 'draft' ? 'catalogDraft' : 'published'" />
                </td>
                <td>
                  <RouterLink
                    :to="`/admin/qualifications/${q.id}`"
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
              <tr v-for="c in courses" :key="c.id">
                <td>
                  <RouterLink :to="`/admin/courses/${c.id}`" class="table-title">{{
                    c.title || '이름 없음'
                  }}</RouterLink>
                </td>
                <td>v{{ c.version }}</td>
                <td class="muted">{{ labels[c.mode] }}</td>
                <td>
                  <StatusBadge :status="c.status === 'draft' ? 'catalogDraft' : 'published'" />
                </td>
                <td>
                  <RouterLink
                    :to="`/admin/courses/${c.id}`"
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
              <tr v-for="a in assignments" :key="a.id">
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
              /><AppIcon name="down" :size="18" />
            </summary>
            <div class="result-detail-body">
              <p v-if="a.excludedReason" class="error-message">
                검증 제외 · {{ a.excludedReason }}
              </p>
              <section v-for="e in a.enrollments" :key="e.courseId" class="result-course">
                <div class="section-heading">
                  <h2>
                    {{ store.course(e.courseId).title }}
                    <span class="small-label">v{{ store.course(e.courseId).version }}</span>
                  </h2>
                  <StatusBadge v-if="store.complete(e)" status="complete" />
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
                <p v-if="!e.history.length" class="muted">평가 이력이 없습니다.</p>
              </section>
              <details class="attempt-detail">
                <summary>변경 이력</summary>
                <div
                  v-for="ev in store.data.audits.filter((x) => x.assignmentId === a.id)"
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
                      <p v-if="!Object.keys(archived.verdicts).length" class="muted">
                        작성한 판정이 없습니다.
                      </p>
                    </section>
                  </details>
                </div>
              </details>
              <RouterLink
                v-if="a.certifiedAt"
                :to="`/certifications/${a.id}`"
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
              <tr v-for="n in notices" :key="n.id">
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
      <AppDialog v-model:open="assignmentOpen" title="자격 배정"
        ><div v-if="errors.length" class="error-message" role="alert">{{ errors[0] }}</div>
        <label class="field"
          ><span>대상자</span
          ><select v-model="assignmentForm.learnerId">
            <option
              v-for="u in store.data.users.filter((u) => u.roles.includes('learner'))"
              :key="u.id"
              :value="u.id"
            >
              {{ u.name }}
            </option>
          </select></label
        ><label class="field"
          ><span>자격</span
          ><select v-model="assignmentForm.qualificationId">
            <option
              v-for="q in store.data.qualifications.filter((q) => q.status === 'published')"
              :key="q.id"
              :value="q.id"
            >
              {{ q.title }} · v{{ q.version }}
            </option>
          </select></label
        ><label class="field"
          ><span>담당 FT</span
          ><select v-model="assignmentForm.ftId" :disabled="!needsFT">
            <option value="">미지정</option>
            <option
              v-for="u in store.data.users.filter((u) => u.roles.includes('ft'))"
              :key="u.id"
              :value="u.id"
            >
              {{ u.name }}
            </option>
          </select></label
        ><template #footer
          ><button class="button secondary" @click="assignmentOpen = false">취소</button
          ><button class="button primary" :disabled="busy" @click="addAssignment">
            배정
          </button></template
        ></AppDialog
      >
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
          ><select v-model="ftId">
            <option
              v-for="u in store.data.users.filter((u) => u.roles.includes('ft'))"
              :key="u.id"
              :value="u.id"
            >
              {{ u.name }}
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
