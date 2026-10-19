<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { useAttemptDraft } from '../composables/useAttemptDraft';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppDialog from '../components/AppDialog.vue';
import type { Verdict } from '../types';
import { kindLabels } from '@eks/contracts';
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
const busy = ref(false);
const {
  attempt,
  draft,
  status: saveStatus,
  error: saveError,
  conflict,
  load,
  flush,
  changed,
  canLeave,
} = useAttemptDraft(() => store.actorId);
const answered = computed(
  () => c.value?.questions.filter((q) => draft.value.answers[q.id] !== undefined).length || 0,
);
const judged = computed(
  () =>
    c.value?.practicalItems.filter(
      (i) => draft.value.verdicts[i.id]?.value && draft.value.verdicts[i.id]?.evidence.trim(),
    ).length || 0,
);
const isResult = computed(
  () =>
    stage.value === 'result' ||
    (isObjective.value
      ? e.value?.objective === 'passed'
      : isFT.value && ['passed', 'failed'].includes(e.value?.practical || '')),
);
const result = computed(() => (isObjective.value ? e.value?.objective : e.value?.practical));
const learnerName = computed(() => (a.value ? store.username(a.value.learnerId) : '학습자'));
const resultHeading = computed(() => {
  if (isFT.value) return stage.value === 'result' ? '실기 평가를 확정했습니다.' : '실기 평가 결과';
  return result.value === 'passed'
    ? e.value && store.complete(e.value)
      ? '과정을 수료했습니다.'
      : '평가를 통과했습니다.'
    : '객관식 평가에 다시 응시할 수 있습니다.';
});
const ftResultMessage = computed(() => {
  if (!e.value) return '';
  if (result.value !== 'passed')
    return `${learnerName.value} 님의 실기 평가 결과는 미통과입니다. 학습자가 다시 요청하면 재평가할 수 있습니다.`;
  if (store.complete(e.value)) return `${learnerName.value} 님이 이 과정을 수료했습니다.`;
  const remaining = c
    .value!.assessmentKinds.filter((kind) => e.value![kind] !== 'passed')
    .map((kind) => kindLabels[kind])
    .join(' · ');
  return `${learnerName.value} 님이 실기 평가를 통과했습니다. 과정 수료에는 ${remaining} 평가 통과가 필요합니다.`;
});
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
    const missing = c.value!.questions.find((q) => draft.value.answers[q.id] === undefined)!;
    focusItem(missing.id);
    return;
  }
  if (isFT.value && judged.value !== c.value!.practicalItems.length) {
    error.value = '판정과 근거를 모두 입력해 주세요.';
    const missing = c.value!.practicalItems.find(
      (i) => !draft.value.verdicts[i.id]?.value || !draft.value.verdicts[i.id]?.evidence.trim(),
    )!;
    focusItem(missing.id);
    return;
  }
  stage.value = 'review';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function prepare() {
  busy.value = true;
  error.value = '';
  stage.value = 'edit';
  try {
    if (!valid.value || !a.value || !c.value || !e.value) {
      load(null);
      return;
    }
    if (isObjective.value && e.value.objective !== 'passed' && e.value.learningComplete)
      load(await store.startAttempt(a.value.id, c.value.id, 'objective'));
    else if (isFT.value && e.value.practical === 'waiting')
      load(e.value.activeAttempts.practical || null);
    else load(null);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
async function submit() {
  if (busy.value || !attempt.value) return;
  busy.value = true;
  error.value = '';
  try {
    await flush();
    await store.command(`/attempts/${attempt.value.id}/submit`, {
      revision: attempt.value.revision,
    });
    load(null);
    stage.value = 'result';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
function verdict(id: string, patch: Partial<Verdict>) {
  const previous = draft.value.verdicts[id] || { value: '', evidence: '' };
  draft.value.verdicts[id] = { ...previous, ...patch };
  changed();
  if (judged.value === c.value!.practicalItems.length) error.value = '';
}
function answer(id: string, value: number) {
  draft.value.answers[id] = value;
  changed();
  if (answered.value === c.value!.questions.length) error.value = '';
}
async function requestPractical() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await store.requestPractical(a.value!.id, c.value!.id);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
async function reloadDraft() {
  if (!window.confirm('현재 입력을 서버에 저장된 내용으로 바꿀까요?')) return;
  try {
    await store.refresh();
    await prepare();
  } catch (err) {
    error.value = (err as Error).message;
  }
}
async function retrySave() {
  try {
    await flush();
  } catch {
    /* saveError retains the actionable message */
  }
}
watch(
  () => route.fullPath,
  () => {
    void prepare();
  },
  { immediate: true },
);
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
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
          <StatusBadge v-if="c.operationalStatus === 'retired'" status="retired" /><span>{{
            c.title
          }}</span
          ><span v-if="isFT">학습자 {{ learnerName }}</span
          ><span v-else>{{ store.qualification(a.qualificationId).title }}</span>
          <span v-if="isFT">평가자 {{ store.actor.name }}</span>
        </div>
      </div>
      <button
        v-if="(c.material || c.materialUrl) && !isResult"
        class="button secondary"
        @click="materialOpen = true"
      >
        <AppIcon name="file" :size="18" />학습자료
      </button>
    </div>
    <div v-if="isResult" class="panel result-panel">
      <div class="result-symbol">
        <AppIcon :name="result === 'passed' ? 'check' : 'retry'" :size="36" />
      </div>
      <StatusBadge :status="result || 'ready'" />
      <h2>{{ resultHeading }}</h2>
      <p v-if="isFT" class="muted">{{ ftResultMessage }}</p>
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
          @click="prepare"
          :disabled="busy"
        >
          다시 응시<AppIcon name="retry" :size="18" /></button
        ><RouterLink
          v-else-if="a.certifiedAt"
          class="button primary"
          :to="`/certifications/${a.id}`"
          >{{ isFT ? '학습자 인증 보기' : '인증 보기'
          }}<AppIcon name="award" :size="18" /></RouterLink
        ><RouterLink
          v-else-if="!isFT"
          class="button primary"
          :to="store.complete(e) ? nextPath : returnPath"
          >{{ store.complete(e) ? '다음 과정' : '이어서 진행' }}<AppIcon name="arrow" :size="18"
        /></RouterLink>
      </div>
    </div>
    <div v-else-if="!isFT && !e.learningComplete" class="panel empty-state">
      <h2>필수 학습 완료 기록이 필요합니다.</h2>
      <RouterLink :to="returnPath" class="button primary">학습 기록으로</RouterLink>
    </div>
    <div v-else-if="isFT && !attempt && !busy" class="panel empty-state">
      <h2>학습자의 실기 평가 요청을 기다리고 있습니다.</h2>
      <RouterLink to="/evaluations" class="button secondary">평가 목록</RouterLink>
    </div>
    <div v-else class="assessment-layout">
      <div v-if="saveError" class="error-message save-error" role="alert">
        <span>{{ saveError }}</span>
        <button v-if="!conflict" class="button secondary" @click="retrySave">저장 재시도</button>
        <button class="button secondary" @click="reloadDraft">다시 불러오기</button>
      </div>
      <div class="assessment-main" :aria-busy="busy">
        <div v-if="error" class="error-message" role="alert">
          <AppIcon name="alert" :size="18" />{{ error }}
        </div>
        <template v-if="isObjective && stage === 'edit'"
          ><fieldset
            v-for="(q, index) in c.questions"
            :id="q.id"
            :key="q.id"
            class="question-card"
            :disabled="busy || !attempt || conflict"
          >
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
                :class="{ chosen: draft.answers[q.id] === i }"
                ><input
                  type="radio"
                  :name="q.id"
                  :value="i"
                  :checked="draft.answers[q.id] === i"
                  @change="answer(q.id, i)"
                /><span>{{ option }}</span></label
              >
            </div>
          </fieldset></template
        >
        <template v-else-if="isFT && stage === 'edit'"
          ><p class="evaluation-instruction">
            <AppIcon name="book" :size="18" />학습자 수행 조건 · {{ c.instruction }}
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
            <fieldset class="verdict-options" :disabled="busy || !attempt">
              <legend class="sr-only">{{ item.title }} 판정</legend>
              <label class="choice" :class="{ chosen: draft.verdicts[item.id]?.value === 'pass' }"
                ><input
                  type="radio"
                  :name="item.id"
                  :checked="draft.verdicts[item.id]?.value === 'pass'"
                  @change="verdict(item.id, { value: 'pass' })"
                />통과</label
              ><label class="choice" :class="{ chosen: draft.verdicts[item.id]?.value === 'fail' }"
                ><input
                  type="radio"
                  :name="item.id"
                  :checked="draft.verdicts[item.id]?.value === 'fail'"
                  @change="verdict(item.id, { value: 'fail' })"
                />미통과</label
              >
            </fieldset>
            <label class="field"
              ><span>판정 근거</span
              ><textarea
                :disabled="busy || !attempt"
                rows="2"
                :value="draft.verdicts[item.id]?.evidence || ''"
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
                  <p>{{ q.choices[draft.answers[q.id]!] }}</p>
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
                    :status="draft.verdicts[item.id]?.value === 'pass' ? 'passed' : 'failed'"
                  />
                  <p class="evidence-text">{{ draft.verdicts[item.id]?.evidence }}</p>
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
        <p v-if="!isFT && !isObjective && !a.ftId" class="error-message">
          FT 배정 대기 · 조직 관리자가 FT를 지정하면 실기 평가를 요청할 수 있습니다.
        </p>
        <div class="actionbar">
          <span v-if="attempt" class="save-status" role="status">{{
            { saved: '저장됨', saving: '저장 중', dirty: '저장 대기', error: '저장 실패' }[
              saveStatus
            ]
          }}</span>
          <span class="muted">{{
            isObjective
              ? `${answered} / ${c.questions.length} 응답`
              : isFT
                ? `${judged} / ${c.practicalItems.length} 판정`
                : `FT ${store.username(a.ftId)}`
          }}</span>
          <div class="actions">
            <button v-if="stage === 'review'" class="button secondary" @click="stage = 'edit'">
              {{ isFT ? '판정 수정' : '답안 수정' }}</button
            ><RouterLink v-else :to="returnPath" class="button secondary">나가기</RouterLink
            ><button
              v-if="stage === 'review'"
              class="button primary"
              :disabled="busy || conflict"
              @click="submit"
            >
              {{ isFT ? '평가 확정' : '제출' }}<AppIcon name="check" :size="18" /></button
            ><button
              v-else-if="isObjective || isFT"
              class="button primary"
              :disabled="busy || !attempt || conflict"
              @click="review"
            >
              {{ isFT ? '판정 확인' : '답안 확인' }}<AppIcon name="arrow" :size="18" /></button
            ><RouterLink v-else-if="e.practical === 'waiting'" :to="nextPath" class="button primary"
              >다른 과정 보기<AppIcon name="arrow" :size="18" /></RouterLink
            ><button
              v-else-if="e.practical !== 'passed'"
              class="button primary"
              :disabled="busy || !a.ftId || !e.learningComplete"
              @click="requestPractical"
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
                :class="{ answered: draft.answers[q.id] !== undefined }"
                :aria-label="`${i + 1}번 문항 ${draft.answers[q.id] !== undefined ? '응답 완료' : '미응답'}`"
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
                  answered:
                    draft.verdicts[item.id]?.value && draft.verdicts[item.id]?.evidence.trim(),
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
              <template v-if="isFT"
                ><span>학습자</span><span>{{ learnerName }}</span></template
              >
              <span>{{ isFT ? '평가자' : '담당 FT' }}</span
              ><span>{{ store.username(a.ftId) }}</span
              ><span>필수 항목</span
              ><span>{{ c.practicalItems.filter((i) => i.mandatory).length }}</span
              ><span>평가 회차</span
              ><span>{{ e.history.filter((h) => h.kind === 'practical').length + 1 }}회</span>
            </div></template
          >
        </div>
        <div class="aside-context">
          <span class="small-label">{{ isFT ? '학습자 과정 현황' : '과정 현황' }}</span>
          <div v-for="kind in store.requiredKinds(c)" :key="kind">
            <span>{{ kind === 'objective' ? '객관식' : '실기' }}</span
            ><StatusBadge :status="e[kind]" />
          </div>
        </div>
      </aside>
    </div>
    <AppDialog v-model:open="materialOpen" :title="`${c.title} · 학습자료`"
      ><div class="material-content">{{ c.material }}</div>
      <a
        v-if="c.materialUrl"
        :href="c.materialUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="button secondary"
        >자료 열기<AppIcon name="diagonal" :size="16" /></a
    ></AppDialog>
  </div>
  <div v-else class="container page empty-state">
    <h1>평가를 찾을 수 없습니다.</h1>
    <RouterLink to="/" class="button secondary">홈으로</RouterLink>
  </div>
</template>
