<script setup lang="ts">
import { releaseVersionLabel } from '@eks/contracts';
import CourseCategory from './CourseCategory.vue';
import { kindLabels, type Course, type CourseContent } from '@eks/contracts';
import { computed, nextTick, ref, watch } from 'vue';
import AppDialog from './AppDialog.vue';
import CourseLearningInfo from './CourseLearningInfo.vue';
import StatusBadge from './StatusBadge.vue';
const props = defineProps<{
  open: boolean;
  course: (CourseContent & { id: string } & Partial<Course>) | null;
}>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();
const content = ref<HTMLElement>();
watch(
  () => [props.open, props.course?.id],
  async () => {
    if (!props.open) return;
    await nextTick();
    content.value?.closest('.dialog-body')?.scrollTo({ top: 0 });
  },
  { flush: 'post' },
);
const assessmentSummary = computed(
  () =>
    props.course?.assessmentKinds.map((kind) => kindLabels[kind]).join(' · ') ||
    '설정된 평가가 없습니다.',
);
</script>

<template>
  <AppDialog
    :open="open"
    title="인증Set 내용 조회"
    class="course-preview-dialog"
    @update:open="emit('update:open', $event)"
  >
    <div v-if="course" :key="course.id" ref="content" class="course-preview-content">
      <section aria-label="기본정보">
        <div class="course-preview-heading">
          <h3>{{ course.title || '이름 없는 인증Set' }}</h3>
          <CourseCategory v-if="course.category" :course="course" />

          <StatusBadge :status="course.operationalStatus === 'retired' ? 'retired' : 'active'" />
        </div>
        <p v-if="course.deletedAt" class="qualification-note">
          삭제된 항목 · {{ course.deletionReason }}
        </p>
        <p v-else-if="course.operationalStatus === 'retired'" class="qualification-note">
          운영 종료된 버전입니다.<template v-if="course.retirementReason">
            {{ course.retirementReason }}</template
          >
        </p>
        <dl class="team-qualification-facts course-preview-facts">
          <div>
            <dt>학습 정보</dt>
            <dd>교육 {{ course.learningItems.length }}개 · 자료 {{ course.materials.length }}개</dd>
          </div>
          <div>
            <dt>{{ course.qualificationType === 'auditor' ? '수료 방식' : '필수 평가' }}</dt>
            <dd>
              {{
                course.qualificationType === 'auditor' ? '필수 교육 본인 확인' : assessmentSummary
              }}
            </dd>
          </div>
        </dl>
      </section>
      <CourseLearningInfo :course="course" readonly />
      <section v-if="course.qualificationType !== 'auditor'" aria-label="평가 요약">
        <h3>평가 요약</h3>
        <section v-if="course.subjectiveEnabled" aria-label="주관식 문항">
          <h4>주관식 평가 · 수료에 영향 없음 · {{ course.subjectiveQuestions.length }}문항</h4>
          <p
            v-for="(q, i) in course.subjectiveQuestions"
            :key="q.id"
            style="white-space: pre-wrap; overflow-wrap: anywhere"
          >
            {{ i + 1 }}. {{ q.prompt || '문제 미입력' }}
          </p>
        </section>
        <dl v-if="course.assessmentKinds.length" class="course-preview-assessments">
          <div v-for="kind in course.assessmentKinds" :key="kind">
            <dt>{{ kindLabels[kind] }}</dt>
            <dd>
              <span
                >{{
                  kind === 'objective' ? course.questions.length : course.practicalQuestions.length
                }}문항</span
              >
              <span
                >합격 기준
                {{
                  (kind === 'objective' ? course.passScore : course.practicalPassScore) == null
                    ? '미정'
                    : `${kind === 'objective' ? course.passScore : course.practicalPassScore}% 이상`
                }}</span
              >
            </dd>
          </div>
        </dl>
        <p v-else class="muted">설정된 평가가 없습니다.</p>
      </section>
      <p class="release-footer">{{ releaseVersionLabel(course) }}</p>
    </div>
    <p v-else role="status">인증Set을 찾을 수 없습니다. 목록을 다시 확인해 주세요.</p>
    <template #footer>
      <button type="button" class="button secondary" @click="emit('update:open', false)">
        확인
      </button>
    </template>
  </AppDialog>
</template>
