<script setup lang="ts">
import { kindLabels, learningTypeLabels, type Course } from '@eks/contracts';
import { computed, nextTick, ref, watch } from 'vue';
import AppDialog from './AppDialog.vue';
import CourseMaterials from './CourseMaterials.vue';
import StatusBadge from './StatusBadge.vue';
const props = defineProps<{ open: boolean; course: Course | null }>();
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
          <span class="small-label">v{{ course.version }}</span>
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
            <dt>학습 구성</dt>
            <dd>
              학습자료 {{ course.materials.length }}개 · 학습 항목
              {{ course.learningItems.length }}개
            </dd>
          </div>
          <div>
            <dt>필수 평가</dt>
            <dd>
              {{ assessmentSummary }}
            </dd>
          </div>
        </dl>
      </section>
      <CourseMaterials :materials="course.materials" :context-key="course.id" />
      <section aria-label="학습 항목">
        <h3>
          학습 항목 <span class="muted">{{ course.learningItems.length }}개</span>
        </h3>
        <ul v-if="course.learningItems.length" class="course-preview-learning">
          <li v-for="item in course.learningItems" :key="item.id">
            <span class="course-preview-kind">{{ learningTypeLabels[item.type] }}</span>
            <span class="course-preview-item-title">{{ item.title || '이름 없는 학습 항목' }}</span>
            <span class="course-preview-required">{{ item.required ? '필수' : '선택' }}</span>
          </li>
        </ul>
        <p v-else class="muted">등록된 학습 항목이 없습니다.</p>
      </section>
      <section aria-label="평가 요약">
        <h3>평가 요약</h3>
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
    </div>
    <p v-else role="status">인증Set을 찾을 수 없습니다. 목록을 다시 확인해 주세요.</p>
    <template #footer>
      <button type="button" class="button secondary" @click="emit('update:open', false)">
        확인
      </button>
    </template>
  </AppDialog>
</template>
