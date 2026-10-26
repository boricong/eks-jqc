<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { qualificationTypeLabels, type CourseContent, type Kind } from '@eks/contracts';
import SubjectiveQuestionsEditor from './SubjectiveQuestionsEditor.vue';
import CompactTabs from './CompactTabs.vue';
import CourseMaterialsEditor from './CourseMaterialsEditor.vue';
import CourseLearningEditor from './CourseLearningEditor.vue';
import CourseAssessmentEditor from './CourseAssessmentEditor.vue';
import type { CourseIssue } from '../course-editor';
const props = defineProps<{
  course: CourseContent;
  typeEditing?: { canChangeType: boolean; typeChangeReason: string };
  disabled: boolean;
  issues: CourseIssue[];
  showErrors: boolean;
}>();
const uid = useId(),
  section = ref('basic');
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
    ...(props.course.qualificationType !== 'auditor' &&
    props.course.assessmentKinds.includes('objective')
      ? [{ id: 'objective', label: '지식 평가' }]
      : []),
    ...(props.course.qualificationType !== 'auditor' &&
    props.course.assessmentKinds.includes('practical')
      ? [{ id: 'practical', label: '상황 대응 평가' }]
      : []),
    ...(props.course.qualificationType === 'auditee' && props.course.subjectiveEnabled
      ? [{ id: 'subjective', label: '주관식 평가' }]
      : []),
  ].map((s) => ({ ...s, invalid: props.issues.some((i) => i.kind === s.id) })),
);
watch(section, (value) => {
  if (value === 'objective' || value === 'practical') kind.value = value;
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
    <nav class="course-editor-navigation" aria-label="인증Set 편집 항목">
      <CompactTabs
        ref="tabs"
        v-model="section"
        :items="sections"
        label="인증Set 편집 항목"
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
          <p class="muted">
            {{
              course.qualificationType === 'auditor'
                ? '필수 학습항목을 본인이 모두 확인하면 수료됩니다.'
                : '인증Set의 이름과 평가 유형을 설정합니다.'
            }}
          </p>
        </header>
        <label class="field"
          ><span>인증Set명</span
          ><input v-model="course.title" data-course-field="title" :disabled="disabled"
        /></label>
        <div class="field">
          <label :for="`${uid}-type`">인증 유형</label>
          <select
            v-if="typeEditing?.canChangeType"
            :id="`${uid}-type`"
            v-model="course.qualificationType"
            :disabled="disabled"
            :aria-describedby="`${uid}-type-help`"
          >
            <option value="auditee">Auditee(피심사자)</option>
            <option value="auditor">Auditor(심사자)</option>
          </select>
          <p v-else class="criteria-type-value">
            {{ qualificationTypeLabels[course.qualificationType] }}
          </p>
          <small :id="`${uid}-type-help`" class="muted">{{
            typeEditing?.typeChangeReason || '인증 유형은 연결된 자격과 같아야 합니다.'
          }}</small>
        </div>
        <fieldset v-if="course.qualificationType !== 'auditor'" class="assessment-kind-group">
          <legend>평가 유형</legend>
          <div class="assessment-kind-options">
            <label class="checkbox-label"
              ><input
                v-model="course.assessmentKinds"
                type="checkbox"
                value="objective"
                data-course-field="assessmentKinds"
                :disabled="disabled"
              />객관식 · 지식 평가 <small>수료 필수</small></label
            >
            <label class="checkbox-label"
              ><input
                v-model="course.assessmentKinds"
                type="checkbox"
                value="practical"
                :disabled="disabled"
              />실기 · 상황 대응 평가 <small>수료 필수</small></label
            >
            <label class="checkbox-label"
              ><input
                v-model="course.subjectiveEnabled"
                type="checkbox"
                :disabled="disabled"
              />주관식 평가 <small>수료에 영향 없음</small></label
            >
          </div>
        </fieldset>
        <p v-if="course.qualificationType !== 'auditor'" class="muted">
          상황 대응 평가에는 지식 평가가 필요합니다. 유형을 해제해도 작성한 문항은 보존됩니다.
        </p>
        <p
          v-if="course.qualificationType !== 'auditor' && !course.assessmentKinds.length"
          class="muted"
        >
          평가 유형을 선택하면 해당 편집 항목이 나타납니다.
        </p>
      </div>
      <SubjectiveQuestionsEditor
        v-if="course.qualificationType === 'auditee' && course.subjectiveEnabled"
        v-show="section === 'subjective'"
        :course="course"
        :disabled="disabled"
      />
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
      <div
        v-if="course.qualificationType !== 'auditor'"
        v-show="section === 'objective' || section === 'practical'"
      >
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
