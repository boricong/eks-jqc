<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
import type { Verdict } from '../types';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const isFT = computed(() => route.name === 'evaluation');
const isObjective = computed(() => !isFT.value && route.params.kind === 'objective');
const a = computed(() => {
  const item = store.assignment(String(route.params.id));
  if (!item || item.excludedReason) return;
  return isFT.value
    ? item.ftId === store.actorId && item.learnerId !== store.actorId
      ? item
      : undefined
    : item.learnerId === store.actorId
      ? item
      : undefined;
});
const e = computed(() => a.value?.enrollments.find((e) => e.courseId === route.params.courseId));
const c = computed(() => e.value && store.course(e.value.courseId));
const valid = computed(
  () =>
    a.value &&
    e.value &&
    c.value &&
    store.requiredKinds(c.value).includes(isObjective.value ? 'objective' : 'practical'),
);
const stage = ref<'edit' | 'review' | 'result'>('edit');
const error = ref(''),
  materialOpen = ref(false);
watch(
  () => route.fullPath,
  () => {
    stage.value = 'edit';
    error.value = '';
  },
  { immediate: true },
);
const answered = computed(
  () => c.value?.questions.filter((q) => e.value?.answers[q.id] !== undefined).length || 0,
);
const judged = computed(
  () =>
    c.value?.practicalItems.filter(
      (i) => e.value?.verdicts[i.id]?.value && e.value?.verdicts[i.id]?.evidence.trim(),
    ).length || 0,
);
const isResult = computed(
  () =>
    stage.value === 'result' ||
    (isObjective.value
      ? e.value?.objective === 'passed'
      : isFT.value && e.value?.practical !== 'waiting'),
);
const result = computed(() => (isObjective.value ? e.value?.objective : e.value?.practical));
const returnPath = computed(() =>
  isFT.value ? '/evaluations' : `/qualifications/${a.value?.id}?course=${c.value?.id}`,
);
const nextPath = computed(() => {
  const next = a.value?.enrollments.find(
    (en) => en.courseId !== c.value?.id && !store.complete(en),
  );
  return `/qualifications/${a.value?.id}${next ? `?course=${next.courseId}` : ''}`;
});
async function focusItem(id: string) {
  await nextTick();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document
    .querySelector<HTMLElement>(`#${id} input, #${id} textarea`)
    ?.focus({ preventScroll: true });
}
function review() {
  error.value = '';
  if (isObjective.value && answered.value !== c.value!.questions.length) {
    error.value = '미응답 문항을 확인해 주세요.';
    const missing = c.value!.questions.find((q) => e.value!.answers[q.id] === undefined)!;
    focusItem(missing.id);
    return;
  }
  if (isFT.value && judged.value !== c.value!.practicalItems.length) {
    error.value = '판정과 근거를 모두 입력해 주세요.';
    const missing = c.value!.practicalItems.find(
      (i) => !e.value!.verdicts[i.id]?.value || !e.value!.verdicts[i.id]?.evidence.trim(),
    )!;
    focusItem(missing.id);
    return;
  }
  stage.value = 'review';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function submit() {
  try {
    if (isObjective.value) store.submitObjective(a.value!.id, c.value!.id);
    else store.evaluate(a.value!.id, c.value!.id);
    stage.value = 'result';
    error.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    error.value = (err as Error).message;
  }
}
function verdict(id: string, patch: Partial<Verdict>) {
  const previous = e.value!.verdicts[id] || { value: '', evidence: '' };
  store.saveVerdict(a.value!.id, c.value!.id, id, { ...previous, ...patch });
  if (judged.value === c.value!.practicalItems.length) error.value = '';
}
function answer(id: string, value: number) {
  store.saveAnswer(a.value!.id, c.value!.id, id, value);
  if (answered.value === c.value!.questions.length) error.value = '';
}
</script>
<template>
  <div v-if="valid && a && e && c" class="container page assessment-page">
    <RouterLink :to="returnPath" class="back-link"
      ><AppIcon name="back" :size="16" />{{ isFT ? 'FT 평가' : c.title }}</RouterLink
    >
    <div class="page-heading">
      <div>
        <h1>
          {{
            isResult
              ? '평가 결과'
              : stage === 'review'
                ? isFT
                  ? '판정 확인'
                  : '답안 확인'
                : isObjective
                  ? '객관식 평가'
                  : isFT
                    ? '실기 평가'
                    : '실기 평가 요청'
          }}
        </h1>
        <div class="heading-meta">
          <span>{{ c.title }}</span
          ><span v-if="isFT">{{ store.username(a.learnerId) }}</span
          ><span v-else>{{ store.qualification(a.qualificationId).title }}</span>
        </div>
      </div>
      <button v-if="c.material && !isResult" class="button secondary" @click="materialOpen = true">
        <AppIcon name="file" :size="18" />학습자료
      </button>
    </div>
    <div v-if="isResult" class="panel result-panel">
      <div class="result-symbol">
        <AppIcon :name="result === 'passed' ? 'check' : 'retry'" :size="36" />
      </div>
      <StatusBadge :status="result || 'ready'" />
      <h2>
        {{
          result === 'passed'
            ? store.complete(e)
              ? '과정을 수료했습니다.'
              : '평가를 통과했습니다.'
            : '다시 평가할 수 있습니다.'
        }}
      </h2>
      <div class="result-assessments">
        <span v-for="kind in store.requiredKinds(c)" :key="kind"
          >{{ kind === 'objective' ? '객관식' : '실기' }}<StatusBadge :status="e[kind]"
        /></span>
      </div>
      <div class="actions">
        <RouterLink :to="returnPath" class="button secondary">{{
          isFT ? '평가 목록' : '과정으로'
        }}</RouterLink
        ><button
          v-if="isObjective && result === 'failed'"
          class="button primary"
          @click="stage = 'edit'"
        >
          다시 응시<AppIcon name="retry" :size="18" /></button
        ><RouterLink
          v-else-if="a.certifiedAt"
          class="button primary"
          :to="`/certifications/${a.id}`"
          >인증 보기<AppIcon name="award" :size="18" /></RouterLink
        ><RouterLink
          v-else-if="!isFT"
          class="button primary"
          :to="store.complete(e) ? nextPath : returnPath"
          >{{ store.complete(e) ? '다음 과정' : '이어서 진행' }}<AppIcon name="arrow" :size="18"
        /></RouterLink>
      </div>
    </div>
    <div v-else class="assessment-layout">
      <div class="assessment-main">
        <div v-if="error" class="error-message" role="alert">
          <AppIcon name="alert" :size="18" />{{ error }}
        </div>
        <template v-if="isObjective && stage === 'edit'"
          ><fieldset v-for="(q, index) in c.questions" :id="q.id" :key="q.id" class="question-card">
            <legend class="sr-only">{{ index + 1 }}. {{ q.prompt }}</legend>
            <div class="question-title">
              <span class="question-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <h2>{{ q.prompt }}</h2>
            </div>
            <div class="choices">
              <label
                v-for="(option, i) in q.choices"
                :key="i"
                class="choice"
                :class="{ chosen: e.answers[q.id] === i }"
                ><input
                  type="radio"
                  :name="q.id"
                  :value="i"
                  :checked="e.answers[q.id] === i"
                  @change="answer(q.id, i)"
                /><span>{{ option }}</span></label
              >
            </div>
          </fieldset></template
        >
        <template v-else-if="isFT && stage === 'edit'"
          ><p class="evaluation-instruction">
            <AppIcon name="book" :size="18" />{{ c.instruction }}
          </p>
          <section
            v-for="(item, index) in c.practicalItems"
            :id="item.id"
            :key="item.id"
            class="question-card ft-item"
          >
            <div class="question-title">
              <span class="question-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <h2>{{ item.title }}</h2>
              <span class="small-label">{{ item.mandatory ? '필수' : '선택' }}</span>
            </div>
            <p class="criterion">{{ item.criterion }}</p>
            <fieldset class="verdict-options">
              <legend class="sr-only">{{ item.title }} 판정</legend>
              <label class="choice" :class="{ chosen: e.verdicts[item.id]?.value === 'pass' }"
                ><input
                  type="radio"
                  :name="item.id"
                  :checked="e.verdicts[item.id]?.value === 'pass'"
                  @change="verdict(item.id, { value: 'pass' })"
                />통과</label
              ><label class="choice" :class="{ chosen: e.verdicts[item.id]?.value === 'fail' }"
                ><input
                  type="radio"
                  :name="item.id"
                  :checked="e.verdicts[item.id]?.value === 'fail'"
                  @change="verdict(item.id, { value: 'fail' })"
                />미통과</label
              >
            </fieldset>
            <label class="field"
              ><span>판정 근거</span
              ><textarea
                rows="2"
                :value="e.verdicts[item.id]?.evidence || ''"
                @input="
                  verdict(item.id, { evidence: ($event.target as HTMLTextAreaElement).value })
                "
              />
            </label></section
        ></template>
        <template v-else-if="stage === 'review'"
          ><div class="panel review-panel">
            <div v-if="isObjective" class="review-list">
              <div v-for="(q, i) in c.questions" :key="q.id" class="review-row">
                <span class="question-number">{{ String(i + 1).padStart(2, '0') }}</span>
                <div>
                  <h2>{{ q.prompt }}</h2>
                  <p>{{ q.choices[e.answers[q.id]!] }}</p>
                </div>
                <button class="text-link" @click="stage = 'edit'">수정</button>
              </div>
            </div>
            <div v-else class="review-list">
              <div v-for="(item, i) in c.practicalItems" :key="item.id" class="review-row">
                <span class="question-number">{{ String(i + 1).padStart(2, '0') }}</span>
                <div>
                  <h2>{{ item.title }}</h2>
                  <StatusBadge
                    :status="e.verdicts[item.id]?.value === 'pass' ? 'passed' : 'failed'"
                  />
                  <p class="evidence-text">{{ e.verdicts[item.id]?.evidence }}</p>
                </div>
                <button class="text-link" @click="stage = 'edit'">수정</button>
              </div>
            </div>
          </div>
          <p class="submission-note">
            {{ isFT ? '확정 후 판정을 수정할 수 없습니다.' : '제출 후 답안을 수정할 수 없습니다.' }}
          </p></template
        >
        <template v-else
          ><div class="panel practical-request">
            <div class="section-heading">
              <h2>실기 항목</h2>
              <StatusBadge
                :status="e.practical"
                :label="e.practical === 'ready' ? '요청 전' : undefined"
              />
            </div>
            <div
              v-for="(item, index) in c.practicalItems"
              :key="item.id"
              class="practical-item-row"
            >
              <span class="question-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <div>
                <h3>{{ item.title }}</h3>
                <p>{{ item.criterion }}</p>
              </div>
              <span class="small-label">{{ item.mandatory ? '필수' : '선택' }}</span>
            </div>
            <p class="evaluation-instruction">
              <AppIcon name="book" :size="18" />{{ c.instruction }}
            </p>
          </div>
          <div v-if="e.practical === 'waiting'" class="waiting-note" role="status">
            <AppIcon name="clock" :size="22" /><span
              >{{ store.username(a.ftId) }} FT 평가 대기</span
            >
          </div></template
        >
        <div class="actionbar">
          <span class="muted">{{
            isObjective
              ? `${answered} / ${c.questions.length} 응답`
              : isFT
                ? `${judged} / ${c.practicalItems.length} 판정`
                : `FT ${store.username(a.ftId)}`
          }}</span>
          <div class="actions">
            <button v-if="stage === 'review'" class="button secondary" @click="stage = 'edit'">
              이전</button
            ><RouterLink v-else :to="returnPath" class="button secondary">나가기</RouterLink
            ><button v-if="stage === 'review'" class="button primary" @click="submit">
              {{ isFT ? '평가 확정' : '제출' }}<AppIcon name="check" :size="18" /></button
            ><button v-else-if="isObjective || isFT" class="button primary" @click="review">
              {{ isFT ? '판정 확인' : '답안 확인' }}<AppIcon name="arrow" :size="18" /></button
            ><RouterLink v-else-if="e.practical === 'waiting'" :to="nextPath" class="button primary"
              >다른 과정 보기<AppIcon name="arrow" :size="18" /></RouterLink
            ><button
              v-else-if="e.practical !== 'passed'"
              class="button primary"
              @click="store.requestPractical(a.id, c.id)"
            >
              {{ e.practical === 'failed' ? '다시 요청' : '평가 요청'
              }}<AppIcon name="arrow" :size="18" />
            </button>
          </div>
        </div>
      </div>
      <aside class="assessment-aside">
        <div class="panel aside-card">
          <h2>{{ isObjective ? '응답 현황' : isFT ? '판정 현황' : '평가 정보' }}</h2>
          <template v-if="isObjective"
            ><div class="answer-grid">
              <button
                v-for="(q, i) in c.questions"
                :key="q.id"
                :class="{ answered: e.answers[q.id] !== undefined }"
                :aria-label="`${i + 1}번 문항 ${e.answers[q.id] !== undefined ? '응답 완료' : '미응답'}`"
                @click="
                  stage = 'edit';
                  focusItem(q.id);
                "
              >
                {{ i + 1 }}
              </button>
            </div>
            <div class="aside-meta">
              <span>문항</span><span>{{ c.questions.length }}</span
              ><span>합격 기준</span><span>{{ c.passScore }}%</span>
            </div></template
          ><template v-else
            ><div v-if="isFT" class="answer-grid">
              <button
                v-for="(item, i) in c.practicalItems"
                :key="item.id"
                :class="{
                  answered: e.verdicts[item.id]?.value && e.verdicts[item.id]?.evidence.trim(),
                }"
                :aria-label="`${i + 1}번 판정 항목`"
                @click="
                  stage = 'edit';
                  focusItem(item.id);
                "
              >
                {{ i + 1 }}
              </button>
            </div>
            <div class="aside-meta">
              <span>담당 FT</span><span>{{ store.username(a.ftId) }}</span
              ><span>필수 항목</span
              ><span>{{ c.practicalItems.filter((i) => i.mandatory).length }}</span
              ><span>평가 회차</span
              ><span>{{ e.history.filter((h) => h.kind === 'practical').length + 1 }}회</span>
            </div></template
          >
        </div>
        <div class="aside-context">
          <span class="small-label">과정 현황</span>
          <div v-for="kind in store.requiredKinds(c)" :key="kind">
            <span>{{ kind === 'objective' ? '객관식' : '실기' }}</span
            ><StatusBadge :status="e[kind]" />
          </div>
        </div>
      </aside>
    </div>
    <AppDialog v-model:open="materialOpen" :title="`${c.title} · 학습자료`"
      ><div class="material-content">{{ c.material }}</div></AppDialog
    >
  </div>
  <div v-else class="container page empty-state">
    <h1>평가를 찾을 수 없습니다.</h1>
    <RouterLink to="/" class="button secondary">홈으로</RouterLink>
  </div>
</template>
