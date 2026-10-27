<script setup lang="ts">
import { releaseVersionLabel } from '@eks/contracts';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { kstDate, type Assignment, type PlanningRequest } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import AppIcon from './AppIcon.vue';

const props = withDefaults(
  defineProps<{
    qualificationType?: 'auditee' | 'auditor';
    assignments: Assignment[];
    planningRequests?: PlanningRequest[];
  }>(),
  { planningRequests: () => [] },
);
const store = useDemo();
const id = useId();
const region = ref<HTMLElement>();
const viewport = ref<HTMLElement>();
const qualificationCards = computed(() =>
  props.assignments.map((assignment) => {
    const total = assignment.enrollments.length;
    const completed = store.completedCount(assignment);
    return {
      kind: 'qualification' as const,
      id: `assignment:${assignment.id}`,
      assignment,
      qualification: store.qualification(
        assignment.qualificationId,
        assignment.qualificationMetadata,
      ),
      endOn: store.data.plans.find((plan) => plan.id === assignment.planId)?.endOn,
      completed,
      total,
      passed: store.passedCount(assignment),
      assessments: store.assessmentCount(assignment),
      progress: total ? Math.round((completed / total) * 100) : 0,
    };
  }),
);
const cards = computed(() => {
  const request = props.planningRequests[0];
  if (!request) return qualificationCards.value;
  const stage =
    store.data.planningOptions.find((view) => view.requestId === request.id)?.stage || '확인 필요';
  return [
    {
      kind: 'planning' as const,
      // The summary keeps its identity when its representative request changes.
      id: 'planning-summary',
      request,
      count: props.planningRequests.length,
      stage,
      action:
        stage === '자격 준비 대기' || stage.includes('확인 필요')
          ? '요청 상태 확인'
          : '계획 수립하기',
    },
    ...qualificationCards.value,
  ];
});
const selectedId = ref(cards.value[0]?.id);
const index = computed(() =>
  Math.max(
    0,
    cards.value.findIndex((c) => c.id === selectedId.value),
  ),
);
let observer: ResizeObserver | undefined;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
let pendingScroll: string | undefined;

function select(next: number) {
  const card = cards.value[next];
  if (!card || card.id === selectedId.value) return;
  // A link on the previous slide must not retain focus after becoming inert.
  if (viewport.value?.contains(document.activeElement))
    region.value?.focus({ preventScroll: true });
  selectedId.value = card.id;
}
let alignedWidth = 0;
function align(smooth = false) {
  const el = viewport.value;
  const slide = el?.children[index.value];
  if (!el || !slide) return;
  alignedWidth = el.clientWidth;
  const left = slide.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
  el.scrollTo({
    left,
    behavior:
      smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant',
  });
}
function move(next: number) {
  if (next < 0 || next >= cards.value.length || next === index.value) return;
  select(next);
  pendingScroll = selectedId.value;
  align(true);
}
function onKeydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || cards.value.length < 2) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  move(index.value + (event.key === 'ArrowRight' ? 1 : -1));
}
function readPosition() {
  const el = viewport.value;
  if (!el?.clientWidth) return;
  // A resize can dispatch scroll before ResizeObserver restores the selected ID.
  if (el.clientWidth !== alignedWidth) {
    realign();
    return;
  }
  const left = el.getBoundingClientRect().left;
  const distances = Array.from(el.children, (slide) =>
    Math.abs(slide.getBoundingClientRect().left - left),
  );
  select(distances.indexOf(Math.min(...distances)));
}
function onScroll() {
  // Button/keyboard navigation keeps its destination while smooth scrolling;
  // native touch/trackpad scrolling follows the nearest slide.
  if (!pendingScroll) readPosition();
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(settle, 120);
}
function settle() {
  clearTimeout(scrollTimer);
  pendingScroll = undefined;
  readPosition();
}
function realign() {
  clearTimeout(scrollTimer);
  pendingScroll = undefined;
  align();
}
watch(
  () => cards.value.map((card) => card.id),
  async (ids) => {
    if (!ids.includes(selectedId.value || '')) {
      if (viewport.value?.contains(document.activeElement))
        region.value?.focus({ preventScroll: true });
      selectedId.value = ids[0];
    }
    await nextTick();
    realign();
  },
);
watch(viewport, (el, previous) => {
  if (previous) observer?.unobserve(previous);
  if (el) observer?.observe(el);
});
onMounted(() => {
  observer = new ResizeObserver(realign);
  if (viewport.value) observer.observe(viewport.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  clearTimeout(scrollTimer);
});
</script>

<template>
  <section
    ref="region"
    class="home-card home-qualification-carousel"
    :aria-labelledby="`${id}-title`"
    aria-roledescription="캐러셀"
    :tabindex="cards.length > 1 ? 0 : -1"
    @keydown="onKeydown"
  >
    <div class="section-heading">
      <h2 :id="`${id}-title`">진행 중인 자격</h2>
      <RouterLink to="/qualifications" class="text-link"
        >전체 보기<AppIcon name="chevron" :size="16"
      /></RouterLink>
    </div>
    <div v-if="cards.length" class="home-qualification-frame">
      <div
        :id="`${id}-slides`"
        ref="viewport"
        class="home-qualification-slides"
        @scroll.passive="onScroll"
        @scrollend="settle"
        @pointerdown="pendingScroll = undefined"
        @wheel.passive="pendingScroll = undefined"
      >
        <div
          v-for="(card, position) in cards"
          :key="card.id"
          class="home-qualification-slide"
          role="group"
          aria-roledescription="슬라이드"
          :aria-label="`${position + 1} / ${cards.length} · ${card.kind === 'planning' ? '자격 계획 수립' : card.qualification.title}`"
          :aria-hidden="position !== index"
          :inert="position !== index"
          :data-card-kind="card.kind"
          :data-assignment-id="card.kind === 'qualification' ? card.assignment.id : undefined"
          :data-request-id="card.kind === 'planning' ? card.request.id : undefined"
        >
          <template v-if="card.kind === 'planning'">
            <span class="small-label">계획 수립 요청</span>
            <h3>자격 계획 수립</h3>
            <p class="home-qualification-description">
              {{ card.request.message || '요청 내용을 확인하고 자격 취득 계획을 수립해 주세요.' }}
            </p>
            <dl class="home-qualification-facts">
              <div>
                <dt>가장 빠른 작성 기한</dt>
                <dd>
                  <time :datetime="card.request.dueOn">{{ card.request.dueOn }}</time>
                  <span v-if="card.request.dueOn < kstDate()"> · 기한 경과</span>
                </dd>
              </div>
              <div>
                <dt>미완료 요청</dt>
                <dd>{{ card.count }}건</dd>
              </div>
              <div>
                <dt>현재 단계</dt>
                <dd>{{ card.stage }}</dd>
              </div>
            </dl>
            <div class="home-qualification-action home-planning-action">
              <RouterLink
                :to="{
                  path: '/plans',
                  query: {
                    request: card.request.id,
                    type: props.qualificationType === 'auditor' ? 'auditor' : undefined,
                  },
                }"
                class="button primary"
                >{{ card.action }}<AppIcon name="arrow" :size="18"
              /></RouterLink>
            </div>
          </template>
          <template v-else>
            <span class="small-label"
              >{{ releaseVersionLabel(card.qualification) }} · 필수 인증Set {{ card.total }}개</span
            >
            <h3>{{ card.qualification.title }}</h3>
            <p class="home-qualification-description">
              {{ card.qualification.description || '등록된 자격 설명이 없습니다.' }}
            </p>
            <dl class="home-qualification-facts">
              <div>
                <dt>종료일</dt>
                <dd>
                  <time v-if="card.endOn" :datetime="card.endOn">{{ card.endOn }}</time
                  ><span v-else>미설정</span>
                </dd>
              </div>
              <div>
                <dt>인증Set 수료</dt>
                <dd>{{ card.completed }} / {{ card.total }}</dd>
              </div>
              <div v-if="props.qualificationType !== 'auditor'">
                <dt>평가 통과</dt>
                <dd>{{ card.passed }} / {{ card.assessments }}</dd>
              </div>
            </dl>
            <div
              class="progress-track"
              role="progressbar"
              aria-label="인증Set 수료율"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="card.progress"
              :aria-valuetext="`인증Set ${card.completed} / ${card.total} 수료`"
            >
              <span :style="{ width: `${card.progress}%` }"></span>
            </div>
            <div class="home-qualification-action">
              <RouterLink :to="`/qualifications/${card.assignment.id}`" class="button primary"
                >상세정보 보기<AppIcon name="arrow" :size="18"
              /></RouterLink>
            </div>
          </template>
        </div>
      </div>
      <div
        v-if="cards.length > 1"
        class="home-qualification-controls"
        role="group"
        aria-label="항목 탐색"
      >
        <button
          type="button"
          class="button secondary"
          aria-label="이전 항목"
          :aria-controls="`${id}-slides`"
          :aria-disabled="index === 0"
          @click="move(index - 1)"
        >
          <AppIcon name="back" :size="18" />이전
        </button>
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          :aria-label="`${cards.length}개 중 ${index + 1}번째 항목`"
          ><strong class="home-qualification-current">{{ index + 1 }}</strong> /
          {{ cards.length }}</span
        >
        <button
          type="button"
          class="button secondary"
          aria-label="다음 항목"
          :aria-controls="`${id}-slides`"
          :aria-disabled="index === cards.length - 1"
          @click="move(index + 1)"
        >
          다음<AppIcon name="arrow" :size="18" />
        </button>
      </div>
    </div>
    <div v-else class="home-qualification-frame empty-state">
      <div class="home-qualification-empty-summary">
        <AppIcon name="book" :size="28" /><span>진행 중인 자격이 없습니다.</span>
      </div>
      <div class="home-qualification-empty-actions">
        <RouterLink
          v-if="store.myAssignments.some((a) => a.certifiedAt)"
          class="button secondary"
          :to="
            props.qualificationType === 'auditor'
              ? '/qualifications?filter=certified&type=auditor'
              : '/qualifications?filter=certified'
          "
          >인증 보기</RouterLink
        >
        <RouterLink
          :to="props.qualificationType === 'auditor' ? '/plans?type=auditor' : '/plans'"
          class="button primary"
          >내 계획 확인</RouterLink
        >
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-qualification-carousel {
  min-width: 0;
}
.home-qualification-carousel:focus-visible {
  outline: 2px solid var(--selection-border);
  outline-offset: 4px;
}
.home-qualification-carousel .section-heading {
  flex-wrap: wrap;
  gap: 8px 16px;
}
.home-qualification-carousel .text-link {
  min-height: 44px;
}
.home-qualification-frame {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: #e8f0ff;
  border: 1px solid var(--line);
}
.home-qualification-frame::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: url('../assets/semiconductor-card.webp') right center / cover no-repeat;
  opacity: 0.55;
  mask-image:
    linear-gradient(90deg, transparent, rgb(0 0 0 / 25%) 45%, #000 85%),
    linear-gradient(180deg, rgb(0 0 0 / 55%) 45%, #000 65%, rgb(0 0 0 / 35%) 80%, rgb(0 0 0 / 20%));
  mask-composite: intersect;
}
.home-qualification-frame > * {
  position: relative;
  z-index: 1;
}
.home-qualification-frame.empty-state {
  align-items: stretch;
  justify-content: flex-start;
  text-align: left;
  padding: 24px;
  color: var(--ink-secondary);
}
.home-qualification-empty-summary {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.home-qualification-empty-actions {
  margin-top: auto;
  display: flex;
  justify-content: center;
  gap: 12px;
  width: 100%;
}
.home-qualification-slides {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}
.home-qualification-slides::-webkit-scrollbar {
  display: none;
}
.home-qualification-slide {
  flex: 0 0 100%;
  min-width: 0;
  padding: 24px;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  display: flex;
  flex-direction: column;
}
.home-qualification-slide h3 {
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.home-qualification-slide .small-label {
  color: var(--ink-secondary);
}
.home-qualification-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--ink-secondary);
  font-size: var(--text-body);
  line-height: var(--leading-body);
  min-height: 2.9em;
}
.home-qualification-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin: 16px 0;
}
.home-qualification-facts dt {
  font-size: var(--text-caption);
  color: var(--ink-secondary);
}
.home-qualification-facts dd {
  margin: 4px 0 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.home-qualification-slide .progress-track {
  margin-top: auto;
  flex-shrink: 0;
}
.home-qualification-action {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.home-planning-action {
  margin-top: auto;
  padding-top: 16px;
}
.home-qualification-carousel .button {
  min-height: 44px;
}
.home-qualification-carousel .button.primary {
  border-color: var(--primary-press);
}
.home-qualification-carousel .button.secondary {
  border-color: var(--ink-secondary);
}
.home-qualification-carousel .button:focus-visible {
  outline-color: var(--primary-press);
}
.home-qualification-action .button:focus-visible {
  outline-offset: 1px;
}
.home-qualification-controls {
  background: rgb(232 240 255 / 96%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 12px 24px;
  border-top: 1px solid var(--line);
}
.home-qualification-controls .button {
  min-width: 88px;
  padding: 8px 16px;
  color: var(--primary);
}
.home-qualification-controls [aria-disabled='true'] {
  opacity: 0.55;
  cursor: default;
}
.home-qualification-controls [role='status'] {
  min-width: 64px;
  text-align: center;
  font-size: var(--text-caption);
  font-variant-numeric: tabular-nums;
}
.home-qualification-current {
  color: var(--primary);
  font-weight: var(--weight-heading);
}
@media (max-width: 767px) {
  .home-qualification-frame::before {
    background-image: url('../assets/semiconductor-card-mobile.webp');
    opacity: 0.38;
  }
  .home-qualification-slide,
  .home-qualification-frame.empty-state {
    padding: 16px;
  }
  .home-qualification-controls {
    padding-inline: 16px;
  }
  .home-qualification-empty-actions {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
  }
}
@media (max-width: 480px) {
  .home-qualification-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .home-qualification-facts > :first-child {
    grid-column: 1 / -1;
  }
  .home-qualification-action .button {
    width: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .home-qualification-carousel .progress-track > span {
    transition: none;
  }
}
</style>
