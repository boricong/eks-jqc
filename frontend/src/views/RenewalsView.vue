<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { RenewalCandidates, RenewalBatchView, RenewalCandidate } from '@eks/contracts';
import { api, mutate } from '../api';
import { useDemo } from '../stores/demo';
import AppDialog from '../components/AppDialog.vue';
import { confirmAction } from '../composables/useConfirmation';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const data = ref<RenewalCandidates>(),
  view = ref<RenewalBatchView>(),
  selected = ref<string[]>([]),
  preview = ref<RenewalCandidate[]>(),
  error = ref(''),
  busy = ref(false),
  loading = ref(false);
let generation = 0;
const labels = {
  evaluating: '평가 진행',
  passed: '합격 · 일부 보류',
  completed: '갱신 처리 완료',
  closed: '회차 종료',
};
const selection = computed(() => ({
  stateRevision: data.value!.stateRevision,
  organizationRevision: data.value!.organizationRevision,
  qualificationId: data.value!.qualification!.id,
  qualificationRevision: data.value!.qualification!.revision,
  certificationIds: selected.value,
}));
async function load() {
  const n = ++generation;
  loading.value = true;
  error.value = '';
  try {
    if (route.params.id) {
      const result = await api<RenewalBatchView>(`/renewal-batches/${route.params.id}`);
      if (n === generation) {
        view.value = result;
        data.value = undefined;
      }
    } else {
      const result = await api<RenewalCandidates>('/me/renewal-candidates');
      if (n === generation) {
        data.value = result;
        view.value = undefined;
        selected.value = selected.value.filter((id) =>
          result.candidates.some((c) => c.certificationId === id),
        );
        const id = String(route.query.certificationId || '');
        if (
          id &&
          !selected.value.length &&
          result.candidates.some((c) => c.certificationId === id && !c.reasons.length)
        )
          selected.value = [id];
      }
    }
  } catch (e) {
    if (n === generation) error.value = (e as Error).message;
  } finally {
    if (n === generation) loading.value = false;
  }
}
watch(
  () => [store.actorId, route.params.id],
  () => {
    preview.value = undefined;
    data.value = undefined;
    view.value = undefined;
    selected.value = [];
    busy.value = false;
    void load();
  },
  { immediate: true },
);
async function review() {
  const n = generation;
  busy.value = true;
  error.value = '';
  try {
    const p = await api<{ targets: RenewalCandidate[] }>('/renewal-batches/preview', {
      method: 'POST',
      body: JSON.stringify(selection.value),
    });
    if (n === generation) preview.value = p.targets;
  } catch (e) {
    if (n === generation) error.value = (e as Error).message;
  } finally {
    if (n === generation) busy.value = false;
  }
}
async function start() {
  const n = generation;
  busy.value = true;
  error.value = '';
  try {
    const result = await mutate('/renewal-batches', selection.value);
    if (n !== generation) return;
    preview.value = undefined;
    await store.refresh();
    if (n === generation) await router.push(`/renewals/${result.id}`);
  } catch (e) {
    if (n === generation) error.value = (e as Error).message;
  } finally {
    if (n === generation) busy.value = false;
  }
}
async function act(action: 'apply' | 'close') {
  if (!view.value) return;
  const n = generation,
    batch = view.value.batch;
  if (
    action === 'close' &&
    !(await confirmAction(
      '처리된 갱신과 평가 기록은 유지하고, 남은 대상의 갱신을 종료합니다.',
      '회차 종료',
      '재인증 회차 종료',
    ))
  )
    return;
  if (n !== generation) return;
  busy.value = true;
  error.value = '';
  try {
    await mutate(`/renewal-batches/${batch.id}/${action}`, {
      revision: batch.revision,
    });
    if (n !== generation) return;
    await store.refresh();
    if (n === generation) {
      busy.value = false;
      await load();
    }
  } catch (e) {
    if (n === generation) error.value = (e as Error).message;
  } finally {
    if (n === generation) busy.value = false;
  }
}
</script>
<template>
  <div class="container page renewal-page">
    <div class="renewal-heading">
      <h1>재인증</h1>
      <RouterLink to="/qualifications?filter=certified" class="text-link">보유 자격</RouterLink>
    </div>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>
    <button v-if="error" class="button secondary" :disabled="busy || loading" @click="load">
      최신 상태 다시 확인
    </button>
    <p v-if="loading" role="status">불러오는 중…</p>
    <template v-if="data">
      <section class="panel">
        <h2>{{ data.qualification?.title || '재인증 준비 중' }}</h2>
        <p v-for="reason in data.reasons" :key="reason" class="muted">{{ reason }}</p>
        <div class="renewal-list">
          <label v-for="c in data.candidates" :key="c.certificationId" class="renewal-row"
            ><input
              type="checkbox"
              v-model="selected"
              :value="c.certificationId"
              :disabled="busy || !!c.reasons.length || !!data.reasons.length"
            /><span
              ><strong>{{ c.title }}</strong
              ><span class="renewal-dates"
                >{{ c.expiresOn || '기간 미설정' }} → {{ c.nextExpiresOn || '—' }}</span
              ><span v-if="c.reasons.length" class="muted">{{ c.reasons.join(' · ') }}</span></span
            ></label
          >
          <p v-if="!data.candidates.length" class="muted">
            현재 팀에서 취득한 Auditee 인증이 없습니다.
          </p>
        </div>
        <div class="actions">
          <button
            class="button primary"
            :disabled="busy || loading || !selected.length || !!data.reasons.length"
            @click="review"
          >
            {{ selected.length }}개 대상 확인
          </button>
        </div>
      </section>
      <section class="panel">
        <h2>재인증 이력</h2>
        <RouterLink
          v-for="b in data.batches"
          :key="b.id"
          :to="`/renewals/${b.id}`"
          class="renewal-history"
          ><span>{{ b.startedAt.slice(0, 10) }}</span
          ><strong>{{ labels[b.status] }}</strong></RouterLink
        >
        <p v-if="!data.batches.length" class="muted">진행한 재인증이 없습니다.</p>
      </section>
    </template>
    <template v-if="view">
      <RouterLink to="/renewals" class="text-link">대상·이력 목록</RouterLink>
      <section class="panel">
        <h2>{{ view.qualificationTitle }}</h2>
        <p>
          {{ labels[view.batch.status]
          }}<span v-if="view.score"> · {{ view.score.earned }} / {{ view.score.total }}점</span>
        </p>
        <p v-for="r in view.reasons" :key="r" class="muted">{{ r }}</p>
        <div class="actions">
          <RouterLink v-if="view.canEvaluate" :to="view.assessmentHref" class="button primary"
            >객관식 평가 시작·이어하기</RouterLink
          ><button
            v-if="view.batch.status === 'passed'"
            :disabled="busy"
            class="button primary"
            @click="act('apply')"
          >
            보류 대상 다시 적용</button
          ><button
            v-if="['evaluating', 'passed'].includes(view.batch.status)"
            class="button secondary"
            :disabled="busy"
            @click="act('close')"
          >
            회차 종료
          </button>
        </div>
      </section>
      <section class="panel">
        <h2>갱신 대상 {{ view.targets.length }}개</h2>
        <div class="renewal-list">
          <article v-for="t in view.targets" :key="t.renewalId" class="renewal-row">
            <div>
              <RouterLink :to="t.certificateHref">{{ t.title }}</RouterLink
              ><span class="renewal-dates"
                >{{ t.expiresOn }} → {{ t.nextExpiresOn || '무기한' }}</span
              ><span>{{
                t.status === 'completed'
                  ? '갱신 완료'
                  : t.status === 'closed'
                    ? '대상 종료'
                    : view.batch.status === 'evaluating'
                      ? '평가 대기'
                      : '갱신 보류'
              }}</span>
              <p v-if="t.reasons.length" class="muted">{{ t.reasons.join(' · ') }}</p>
            </div>
          </article>
        </div>
      </section>
    </template>
    <AppDialog
      :open="!!preview"
      title="재인증 대상 확인"
      @update:open="(v) => !v && !busy && (preview = undefined)"
      ><p>객관식 평가 합격 후 선택한 인증의 기간을 갱신합니다.</p>
      <div class="renewal-list">
        <article v-for="t in preview" :key="t.certificationId" class="renewal-row">
          <div>
            <strong>{{ t.title }}</strong
            ><span class="renewal-dates"
              >{{ t.expiresOn }} → {{ t.nextExpiresOn || '무기한' }}</span
            >
          </div>
        </article>
      </div>
      <p v-if="error" role="alert" class="error-message">{{ error }}</p>
      <template #footer
        ><button class="button secondary" :disabled="busy" @click="preview = undefined">
          돌아가기</button
        ><button class="button primary" :disabled="busy" @click="start">
          재인증 시작
        </button></template
      ></AppDialog
    >
  </div>
</template>
<style scoped>
.renewal-page {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.renewal-heading,
.renewal-history {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.renewal-list {
  border: 1px solid var(--hairline, #e3e8ee);
  border-radius: 8px;
  overflow: hidden;
  margin-block: 16px;
}
.renewal-row {
  display: flex;
  gap: 12px;
  padding: 16px;
  overflow-wrap: anywhere;
}
.renewal-row + .renewal-row {
  border-top: 1px solid var(--hairline, #e3e8ee);
}
.renewal-row > span,
.renewal-row > div {
  min-width: 0;
  display: grid;
  gap: 6px;
}
.renewal-row input {
  flex-shrink: 0;
  align-self: start;
  margin-top: 4px;
}
.renewal-dates {
  color: var(--ink-mute, #64748d);
  font-variant-numeric: tabular-nums;
}
.renewal-history {
  padding: 14px 0;
  border-bottom: 1px solid var(--hairline, #e3e8ee);
}
.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
@media (max-width: 480px) {
  .actions > * {
    width: 100%;
    text-align: center;
  }
  .renewal-heading {
    align-items: start;
  }
  .renewal-row {
    padding: 12px;
  }
}
</style>
