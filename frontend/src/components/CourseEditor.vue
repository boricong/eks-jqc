<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import type { Course, Kind } from '@eks/contracts';
import CompactTabs from './CompactTabs.vue';
import CourseMaterialsEditor from './CourseMaterialsEditor.vue';
import CourseLearningEditor from './CourseLearningEditor.vue';
import CourseAssessmentEditor from './CourseAssessmentEditor.vue';
import type { CourseIssue } from '../course-editor';
const props = defineProps<{
  course: Course;
  disabled: boolean;
  issues: CourseIssue[];
  showErrors: boolean;
}>();
const uid = useId(),
  section = ref('basic'),
  expanded = ref(false);
const tabs = ref<InstanceType<typeof CompactTabs>>(),
  materials = ref<InstanceType<typeof CourseMaterialsEditor>>(),
  learning = ref<InstanceType<typeof CourseLearningEditor>>(),
  assessment = ref<InstanceType<typeof CourseAssessmentEditor>>();
const kind = ref<Kind>('objective');
const sections = computed(() =>
  [
    { id: 'basic', label: '기본정보' },
    { id: 'materials', label: '학습자료' },
    { id: 'learning', label: '학습 항목' },
    ...(props.course.assessmentKinds.includes('objective')
      ? [{ id: 'objective', label: '지식 평가' }]
      : []),
    ...(props.course.assessmentKinds.includes('practical')
      ? [{ id: 'practical', label: '상황 대응 평가' }]
      : []),
  ].map((s) => ({ ...s, invalid: props.issues.some((i) => i.kind === s.id) })),
);
const currentLabel = computed(() => sections.value.find((s) => s.id === section.value)?.label);
watch(section, (value) => {
  if (value === 'objective' || value === 'practical') kind.value = value;
  expanded.value = false;
});
watch(sections, (list) => {
  if (!list.some((s) => s.id === section.value)) section.value = 'basic';
});
const root = ref<HTMLElement>();
async function focusIssue(issue: CourseIssue) {
  section.value = issue.kind;
  await nextTick();
  if (issue.kind === 'materials') return materials.value?.focusIssue(issue);
  if (issue.kind === 'learning') return learning.value?.focusIssue(issue);
  if (issue.kind === 'objective' || issue.kind === 'practical')
    return assessment.value?.focusIssue(issue);
  root.value?.querySelector<HTMLElement>(`[data-course-field="${issue.field}"]`)?.focus();
}
defineExpose({
  focusIssue,
  commit: () => !materials.value?.pending || materials.value.commit(false),
  pending: computed(() => materials.value?.pending),
});
</script>
<template>
  <section ref="root" class="course-editor-shell">
    <nav class="course-editor-navigation" aria-label="인증Set 편집 항목" :class="{ expanded }">
      <button
        class="course-editor-menu-toggle"
        type="button"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ currentLabel }} · 편집 항목 {{ expanded ? '접기' : '선택' }}
      </button>
      <CompactTabs
        ref="tabs"
        v-model="section"
        :items="sections"
        label="인증Set 편집 항목"
        vertical
        :panel-id="`${uid}-content`"
      />
    </nav>
    <div
      :id="`${uid}-content`"
      class="course-editor-content"
      role="tabpanel"
      :aria-labelledby="tabs?.tabId(section)"
    >
      <div v-show="section === 'basic'" class="course-basic-fields">
        <header>
          <h2>기본정보</h2>
          <p class="muted">인증Set의 이름과 평가 유형을 설정합니다.</p>
        </header>
        <label class="field"
          ><span>인증Set명</span
          ><input v-model="course.title" data-course-field="title" :disabled="disabled"
        /></label>
        <fieldset class="assessment-kind-group">
          <legend>필수 평가</legend>
          <div class="assessment-kind-options">
            <label class="checkbox-label"
              ><input
                v-model="course.assessmentKinds"
                type="checkbox"
                value="objective"
                data-course-field="assessmentKinds"
                :disabled="disabled"
              />객관식 · 지식 평가</label
            >
            <label class="checkbox-label"
              ><input
                v-model="course.assessmentKinds"
                type="checkbox"
                value="practical"
                :disabled="disabled"
              />실기 · 상황 대응 평가</label
            >
          </div>
        </fieldset>
        <p class="muted">
          상황 대응 평가에는 지식 평가가 필요합니다. 유형을 해제해도 작성한 문항은 보존됩니다.
        </p>
        <p v-if="!course.assessmentKinds.length" class="muted">
          평가 유형을 선택하면 해당 편집 항목이 나타납니다.
        </p>
      </div>
      <CourseMaterialsEditor
        v-show="section === 'materials'"
        ref="materials"
        :course="course"
        :disabled="disabled"
      />
      <CourseLearningEditor
        v-show="section === 'learning'"
        ref="learning"
        :course="course"
        :disabled="disabled"
        :issues="issues"
      />
      <div v-show="section === 'objective' || section === 'practical'">
        <header class="course-evaluation-heading">
          <h2>{{ kind === 'objective' ? '지식 평가' : '상황 대응 평가' }}</h2>
          <p class="muted">번호를 선택해 문항을 편집합니다. 정답은 관리자에게만 공개됩니다.</p>
        </header>
        <CourseAssessmentEditor
          ref="assessment"
          :course="course"
          :disabled="disabled"
          :show-errors="showErrors"
          :kind="kind"
          embedded
        />
      </div>
    </div>
  </section>
</template>
<style>
.course-editor-shell {
  display: grid;
  grid-template-columns: 172px minmax(0, 1fr);
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  overflow: clip;
}
.course-editor-navigation {
  background: var(--canvas);
  border-right: 1px solid var(--line);
  padding: 12px 0;
}
.course-editor-navigation .vertical-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
}
.course-editor-navigation [role='tab'] {
  width: 100%;
  min-height: 48px;
  max-width: none;
  justify-content: flex-start;
  text-align: left;
  white-space: normal;
  border: 0;
  border-left: 3px solid transparent;
  border-radius: 0;
  padding: 12px 16px;
  font-size: 15px;
  font-weight: 500;
}
.course-editor-navigation .compact-tabs button[aria-selected='true'] {
  background: var(--surface);
  border-left-color: var(--primary);
  color: var(--ink);
  box-shadow: none;
}
.course-editor-content {
  min-width: 0;
  padding: 24px;
}
.course-editor-content h2 {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
}
.course-editor-content h3 {
  font-size: 20px;
  font-weight: 600;
}
.course-editor-content header p {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.6;
}
.course-editor-content .field > span:first-child {
  font-size: 14px;
  font-weight: 500;
}
.course-editor-content input,
.course-editor-content textarea,
.course-editor-content select {
  font-size: 16px;
}
.course-editor-content .panel {
  border: 0;
  box-shadow: none;
  margin: 0;
  border-radius: 0;
}
.course-editor-content > .editor-panel {
  padding: 0;
}
.course-editor-content .assessment-type-panel {
  padding: 0;
  background: transparent;
}
.course-editor-content .assessment-settings {
  margin: 24px 0;
}
.course-editor-content .assessment-settings .field {
  max-width: 200px;
}
.course-editor-content .assessment-item-panel {
  border-radius: 8px;
}
.course-editor-content .muted,
.course-editor-content .field-error {
  font-size: 14px;
  line-height: 1.6;
}
.course-basic-fields {
  display: grid;
  gap: 24px;
}
.course-editor-menu-toggle {
  display: none;
}
@media (max-width: 767px) {
  .course-editor-shell {
    grid-template-columns: minmax(0, 1fr);
  }
  .course-editor-navigation {
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding: 0;
  }
  .course-editor-menu-toggle {
    display: block;
    padding: 12px 16px;
    min-height: 44px;
    width: 100%;
    text-align: left;
    font-size: 15px;
    font-weight: 500;
    background: transparent;
    border: 0;
  }
  .course-editor-navigation:not(.expanded) .vertical-tabs {
    display: none;
  }
  .course-editor-content {
    padding: 16px;
  }
}
</style>
