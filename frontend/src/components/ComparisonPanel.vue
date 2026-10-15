<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { comparisonLabels, type Comparison, type Kind } from '@eks/contracts';
import { useDemo } from '../stores/demo';
import AppIcon from './AppIcon.vue';
import AppDialog from './AppDialog.vue';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const draft = ref<Comparison | null>(null),
  baseline = ref(''),
  error = ref(''),
  busy = ref(false),
  query = ref(''),
  outcome = ref('all'),
  selectedEnrollment = ref(''),
  correctionOpen = ref(false),
  reason = ref('');
const entries = computed(() =>
  store.data.assignments
    .filter((a) => a.ownerAdminId === store.actorId)
    .flatMap((a) =>
      a.enrollments.map((e) => ({
        a,
        e,
        c: store.course(e.courseId),
        q: store.qualification(a.qualificationId),
      })),
    ),
);
const activeEntries = computed(() => entries.value.filter((x) => !x.a.excludedReason));
const selected = computed(() => entries.value.find((x) => x.e.id === draft.value?.enrollmentId));
const readOnly = computed(
  () => draft.value?.status === 'final' || !!selected.value?.a.excludedReason,
);
const dirty = computed(
  () => !!draft.value && !readOnly.value && JSON.stringify(draft.value) !== baseline.value,
);
const rows = computed(() =>
  store.data.comparisons
    .filter((r) => {
      const x = entries.value.find((x) => x.e.id === r.enrollmentId);
      return (
        x &&
        `${store.username(r.learnerId)} ${x.q.title} ${x.c.title} v${x.c.version}`
          .toLowerCase()
          .includes(query.value.toLowerCase()) &&
        (outcome.value === 'all' || (r.status === 'draft' ? 'draft' : r.outcome) === outcome.value)
      );
    })
    .slice()
    .reverse(),
);
function label(record: Comparison) {
  const x = entries.value.find((x) => x.e.id === record.enrollmentId);
  return x
    ? `${store.username(record.learnerId)} · ${x.q.title} · ${x.c.title} v${x.c.version}`
    : '';
}
function load() {
  const source = store.data.comparisons.find((r) => r.id === route.params.id);
  draft.value = source ? JSON.parse(JSON.stringify(source)) : null;
  baseline.value = JSON.stringify(draft.value);
  error.value = '';
}
watch(() => route.params.id, load, { immediate: true });
watch(
  activeEntries,
  (list) => {
    if (!list.some((x) => x.e.id === selectedEnrollment.value))
      selectedEnrollment.value = list[0]?.e.id || '';
  },
  { immediate: true },
);
function selectAttempt(kind: Kind, event: Event) {
  if (!draft.value || !selected.value) return;
  const id = (event.target as HTMLSelectElement).value;
  draft.value.attemptIds = draft.value.attemptIds.filter(
    (id) => selected.value!.e.history.find((t) => t.id === id)?.kind !== kind,
  );
  if (id) draft.value.attemptIds.push(id);
}
async function create() {
  if (!selectedEnrollment.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await store.command(
      `/enrollments/${encodeURIComponent(selectedEnrollment.value)}/comparisons`,
    );
    await router.push(`/admin/comparisons/${result.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function save(finalize = false) {
  if (!draft.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await store.command(
      `/comparisons/${draft.value.id}${finalize ? '/finalize' : ''}`,
      draft.value,
      finalize ? 'POST' : 'PUT',
    );
    load();
    store.notify(finalize ? '비교 기록을 확정했습니다.' : '초안을 저장했습니다.');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function correct() {
  if (!draft.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await store.command(`/comparisons/${draft.value.id}/corrections`, {
      reason: reason.value,
    });
    correctionOpen.value = false;
    await router.push(`/admin/comparisons/${result.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function reload() {
  if (dirty.value && !window.confirm('저장하지 않은 내용을 버리고 다시 불러올까요?')) return;
  try {
    await store.refresh();
    load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const canLeave = () =>
  !dirty.value || window.confirm('저장하지 않은 비교 기록이 있습니다. 나갈까요?');
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
</script>
<template>
  <section class="comparison-panel">
    <div v-if="error" class="error-message" role="alert">
      {{ error }} <button class="text-link" @click="reload">다시 불러오기</button>
    </div>
    <template v-if="draft && selected">
      <RouterLink to="/admin/comparisons" class="back-link"
        ><AppIcon name="back" :size="16" />비교 기록</RouterLink
      >
      <div class="section-heading">
        <div>
          <h2>
            {{ selected.c.title }} <span class="small-label">v{{ selected.c.version }}</span>
          </h2>
          <p class="muted">{{ store.username(draft.learnerId) }} · {{ selected.q.title }}</p>
        </div>
        <span class="status-badge">{{
          selected.a.excludedReason
            ? '검증 제외'
            : draft.status === 'draft'
              ? '초안'
              : comparisonLabels[draft.outcome!]
        }}</span>
      </div>
      <p v-if="selected.a.excludedReason" class="error-message">
        검증 제외 · {{ selected.a.excludedReason }}
      </p>
      <p v-if="draft.supersedesId" class="muted">
        정정 사유: {{ draft.correctionReason }} ·
        <RouterLink :to="`/admin/comparisons/${draft.supersedesId}`" class="text-link"
          >원본 보기</RouterLink
        >
      </p>
      <fieldset class="panel editor-panel comparison-fields" :disabled="readOnly || busy">
        <legend>비교할 평가</legend>
        <div class="form-grid">
          <label v-for="kind in store.requiredKinds(selected.c)" :key="kind" class="field"
            ><span>{{ kind === 'objective' ? '객관식' : '실기' }} 회차</span>
            <select
              :value="
                draft.attemptIds.find(
                  (id) => selected!.e.history.find((t) => t.id === id)?.kind === kind,
                ) || ''
              "
              @change="selectAttempt(kind, $event)"
            >
              <option value="">선택</option>
              <option
                v-for="t in selected.e.history.filter((t) => t.kind === kind)"
                :key="t.id"
                :value="t.id"
              >
                {{ t.round }}회 · {{ t.result === 'passed' ? '통과' : '미통과' }} ·
                {{ new Date(t.date).toLocaleDateString('ko-KR') }}
              </option>
            </select>
          </label>
        </div>
      </fieldset>
      <fieldset class="panel editor-panel comparison-fields" :disabled="readOnly || busy">
        <legend>실제 수행 근거</legend>
        <div class="form-grid">
          <label class="field"
            ><span>관찰일</span><input v-model="draft.observedAt" type="date" /></label
          ><label class="field"><span>관찰자</span><input v-model="draft.observer" /></label>
        </div>
        <label class="field"
          ><span>수행 작업</span><textarea v-model="draft.task" rows="2" />
        </label>
        <label class="field"
          ><span>실제 수행 판정 기준</span><textarea v-model="draft.criterion" rows="2" />
        </label>
        <label class="field"
          ><span>근거 요약</span><textarea v-model="draft.evidence" rows="3" />
        </label>
        <label class="field"
          ><span>근거 URL</span
          ><input v-model="draft.evidenceUrl" type="url" placeholder="https://"
        /></label>
        <div class="form-grid">
          <label class="field"
            ><span>근거 구분</span
            ><select v-model="draft.independence">
              <option value="unknown">독립 여부 미확인</option>
              <option value="independent">평가와 독립된 수행 근거</option>
              <option value="same_assessment">동일 평가의 결과</option>
            </select></label
          ><label class="field"
            ><span>실제 수행 판정</span
            ><select v-model="draft.performance" aria-label="실제 수행 판정">
              <option value="unknown">판정 불가</option>
              <option value="met">최소 요건 충족</option>
              <option value="unmet">미충족</option>
            </select></label
          >
        </div>
      </fieldset>
      <p
        v-if="draft.independence !== 'independent' || draft.performance === 'unknown'"
        class="muted"
      >
        독립된 근거나 수행 판정이 없으면 비교 보류로 기록됩니다.
      </p>
      <div class="actionbar">
        <span class="small-label">{{
          draft.status === 'draft'
            ? '초안'
            : `확정 · ${new Date(draft.finalizedAt!).toLocaleDateString('ko-KR')}`
        }}</span>
        <div class="actions">
          <template v-if="!readOnly"
            ><button class="button secondary" :disabled="busy" @click="save()">초안 저장</button
            ><button class="button primary" :disabled="busy" @click="save(true)">
              비교 확정<AppIcon name="check" :size="18" /></button
          ></template>
          <template v-else-if="!selected.a.excludedReason"
            ><RouterLink
              v-if="store.data.comparisons.some((r) => r.supersedesId === draft!.id)"
              :to="`/admin/comparisons/${store.data.comparisons.find((r) => r.supersedesId === draft!.id)!.id}`"
              class="button secondary"
              >정정 기록 보기</RouterLink
            ><button
              v-else
              class="button secondary"
              @click="
                correctionOpen = true;
                reason = '';
              "
            >
              정정 기록 만들기
            </button></template
          >
        </div>
      </div>
      <AppDialog v-model:open="correctionOpen" title="비교 기록 정정"
        ><p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <label class="field"><span>정정 사유</span><textarea v-model="reason" rows="3" /></label
        ><template #footer
          ><button class="button secondary" @click="correctionOpen = false">취소</button
          ><button class="button primary" :disabled="busy" @click="correct">
            정정 초안 생성
          </button></template
        ></AppDialog
      >
    </template>
    <template v-else>
      <div class="panel editor-panel comparison-create">
        <label class="field"
          ><span>대상 과정</span
          ><select v-model="selectedEnrollment">
            <option v-for="x in activeEntries" :key="x.e.id" :value="x.e.id">
              {{ store.username(x.a.learnerId) }} · {{ x.q.title }} · {{ x.c.title }} v{{
                x.c.version
              }}
            </option>
          </select></label
        ><button class="button primary" :disabled="!selectedEnrollment || busy" @click="create">
          <AppIcon name="plus" :size="18" />비교 기록 추가
        </button>
      </div>
      <div class="list-toolbar">
        <label class="search-field"
          ><AppIcon name="search" :size="18" /><input
            v-model="query"
            aria-label="비교 기록 검색"
            placeholder="대상자 · 자격 · 과정 · 버전" /></label
        ><label class="field compact-field"
          ><span class="sr-only">비교 결과</span
          ><select v-model="outcome">
            <option value="all">전체 결과</option>
            <option value="draft">초안</option>
            <option v-for="(label, key) in comparisonLabels" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        >
      </div>
      <div class="table-panel">
        <table v-if="rows.length">
          <thead>
            <tr>
              <th>대상자 · 과정</th>
              <th>관찰일</th>
              <th>비교 결과</th>
              <th>기록 상태</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td>
                <RouterLink :to="`/admin/comparisons/${r.id}`" class="table-title text-link">{{
                  label(r)
                }}</RouterLink>
              </td>
              <td>{{ r.observedAt || '—' }}</td>
              <td>{{ r.status === 'draft' ? '초안' : comparisonLabels[r.outcome!] }}</td>
              <td>
                {{
                  entries.find((x) => x.e.id === r.enrollmentId)?.a.excludedReason
                    ? '검증 제외'
                    : store.data.comparisons.some(
                          (x) => x.supersedesId === r.id && x.status === 'final',
                        )
                      ? '정정 전'
                      : r.supersedesId
                        ? '정정'
                        : '원본'
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-state">비교 기록이 없습니다.</p>
      </div>
    </template>
  </section>
</template>
