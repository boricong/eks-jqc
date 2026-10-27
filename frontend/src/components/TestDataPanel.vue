<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  testDataCountLabels,
  type TestDataAction,
  type TestDataStatus,
  type TestDataPreview,
  type TestDataReceipt,
} from '@eks/contracts';
import { api, mutate, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import { randomUUID } from '../uuid';
import AppDialog from './AppDialog.vue';
const store = useDemo();
const status = ref<TestDataStatus | null>(null),
  preview = ref<TestDataPreview | null>(null),
  result = ref<TestDataReceipt | null>(null);
const loading = ref(false),
  busy = ref(false),
  error = ref(''),
  dialogError = ref(''),
  confirmation = ref(''),
  operationKey = ref(''),
  notice = ref('');
const pendingStorage = 'eks-test-data-operation';
const phrase = { load: '테스트 로드', reset: '전체 초기화' } as const;
const title = { load: '테스트 데이터 로드', reset: '전체 데이터 초기화' } as const;
let refreshId = 0;
function pending(): { key: string; actorId: string } | null {
  try {
    const raw = sessionStorage.getItem(pendingStorage);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return typeof p.key === 'string' && typeof p.actorId === 'string' ? p : null;
  } catch {
    return null;
  }
}
function clearPending(key: string) {
  try {
    if (pending()?.key === key) sessionStorage.removeItem(pendingStorage);
  } catch {
    /* Optional browser storage. */
  }
}
async function refresh() {
  const id = ++refreshId,
    actorId = store.actorId;
  loading.value = true;
  error.value = '';
  try {
    const p = pending(),
      key = p?.actorId === actorId ? p.key : '';
    const value = await api<TestDataStatus>(
      `/system/test-data${key ? `?operationKey=${encodeURIComponent(key)}` : ''}`,
    );
    if (id !== refreshId || store.actorId !== actorId) return;
    status.value = value;
    if (key) {
      result.value = value.operation || null;
      notice.value = value.operation
        ? ''
        : '이전 요청의 완료 기록이 없습니다. 작업을 자동으로 다시 실행하지 않았습니다.';
      clearPending(key);
    }
  } catch (e) {
    if (id === refreshId) {
      error.value = (e as Error).message;
      status.value = null;
    }
  } finally {
    if (id === refreshId) loading.value = false;
  }
}
async function inspect(action: TestDataAction) {
  busy.value = true;
  error.value = '';
  dialogError.value = '';
  try {
    preview.value = await api<TestDataPreview>('/system/test-data/preview', {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    confirmation.value = '';
    operationKey.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function apply() {
  const p = preview.value;
  if (!p || busy.value || confirmation.value !== phrase[p.action]) return;
  busy.value = true;
  dialogError.value = '';
  const key = operationKey.value || randomUUID();
  operationKey.value = key;
  try {
    sessionStorage.setItem(pendingStorage, JSON.stringify({ key, actorId: store.actorId }));
  } catch {
    /* Receipt is retained on the server. */
  }
  try {
    await mutate<TestDataReceipt>(
      '/system/test-data/apply',
      { action: p.action, previewId: p.previewId, confirmation: confirmation.value },
      'POST',
      '',
      key,
    );
    preview.value = null;
    store.notify(
      '처리했습니다. 계정을 다시 선택한 뒤 테스트 데이터 관리에서 결과를 확인해 주세요.',
    );
  } catch (e) {
    dialogError.value =
      e instanceof ApiError && e.code === 'REVISION_CONFLICT'
        ? '확인 이후 데이터가 변경되었습니다. 창을 닫고 작업 내용을 다시 확인해 주세요.'
        : (e as Error).message;
    if (
      e instanceof ApiError &&
      e.status >= 400 &&
      e.status < 500 &&
      !['SESSION_REQUIRED', 'DATASET_CHANGED'].includes(e.code)
    ) {
      clearPending(key);
      operationKey.value = '';
    }
  } finally {
    busy.value = false;
  }
}
watch(
  () => store.actorId,
  () => {
    refreshId++;
    preview.value = null;
    status.value = null;
    result.value = null;
    notice.value = '';
    if (store.hasRole('system_operator')) void refresh();
  },
  { immediate: true },
);
</script>
<template>
  <h1>테스트 데이터 관리</h1>
  <section class="panel editor-panel test-data-panel" :aria-busy="loading || busy">
    <div class="section-heading">
      <h2>내장 테스트 데이터</h2>
      <button class="button secondary" :disabled="loading || busy" @click="refresh">
        상태 새로고침
      </button>
    </div>
    <p>
      파일 선택 없이 내장 데이터를 로드해 자격인증을 시험합니다. 로드하려면 먼저 계정과 조직 구조만
      남도록 전체 데이터를 초기화해야 합니다.
    </p>
    <div v-if="error" class="error-message" role="alert">{{ error }}</div>
    <p v-if="notice" role="status">{{ notice }}</p>
    <section v-if="result" class="test-data-result" role="status">
      <h3>{{ title[result.action] }} 완료</h3>
      <p>
        처리 일시: {{ new Date(result.completedAt).toLocaleString('ko-KR') }} · 계정과 조직 구조를
        보존했습니다.
      </p>
      <details>
        <summary>자동 백업과 실행 정보</summary>
        <p>실행 번호: {{ result.operationId }}</p>
        <p>업무: {{ result.backups.state }}</p>
        <p>조직: {{ result.backups.organizations }}</p>
        <p>관리 정보: {{ result.backups.maintenance }}</p>
      </details>
    </section>
    <template v-if="status">
      <p class="test-data-state" role="status">
        <strong>{{
          status.canReset ? '데이터가 등록되어 있습니다.' : '초기화된 상태입니다.'
        }}</strong>
      </p>
      <h3>보존할 정보</h3>
      <dl class="test-data-counts">
        <div>
          <dt>사용자 계정·역할·소속·관리 권한</dt>
          <dd>{{ status.preserved.users }}명</dd>
        </div>
        <div>
          <dt>조직 ID·이름·구조·사용 상태</dt>
          <dd>{{ status.preserved.organizations }}개</dd>
        </div>
      </dl>
      <h3>내장 구성</h3>
      <dl class="test-data-counts">
        <div>
          <dt>기본자격 원본</dt>
          <dd>{{ status.recipe.templates }}개</dd>
        </div>
        <div>
          <dt>공통 원본</dt>
          <dd>5개 · Auditee 3 / Auditor 2</dd>
        </div>
        <div>
          <dt>팀별 특화 인증Set</dt>
          <dd>10개 · Auditee 6 / Auditor 4</dd>
        </div>
        <div>
          <dt>활성 팀</dt>
          <dd>{{ status.teams.length }}개</dd>
        </div>
        <div>
          <dt>Auditee 인증Set별 문항</dt>
          <dd>지식 3 · 상황 3 · 주관식 1</dd>
        </div>
      </dl>
      <p>팀 자격은 로드 후 직접 등록합니다.</p>
      <details>
        <summary>시험 방법과 보완할 설정</summary>
        <ol>
          <li>전체 데이터 초기화 → 테스트 데이터 로드 후 기존 계정을 다시 선택합니다.</li>
          <li>
            팀 자격 설정에서 자격 풀을 선택해 등록하고 인증Set·운영 기준을 설정한 뒤 Active로
            전환합니다. Auditee는 조직 필요자격 지정 → 계획 요청 → 학습·평가 → 수료·인증서 순서로
            시험하세요.
          </li>
          <li>
            지식·상황 평가는 각각 3문항, 선택지 4개, 배점 34·33·33점으로 총 100점이며 합격 기준은
            각각 100점입니다. 질문 끝에 정답 번호를 표시하며 정답은 모두 첫 번째 선택지입니다.
            주관식 1개는 채점·수료에 영향을 주지 않습니다.
          </li>
          <li>
            Auditor는 기존 지정 계정의 교육 본인 확인을 사용합니다. 기본자격의 유형·등급은 자동
            변경하지 않으며 등급 등 등록 조건이 부족하면 기본자격부터 보완합니다.
          </li>
          <li>
            교육 3종·자료 4종을 제공합니다. 인증기간은 팀 자격 설정에서 지정합니다. 외부 자료 링크는
            편집 확인용 예시 주소입니다.
          </li>
          <li>초기화하면 시험 중 추가한 버전과 모든 진행·발급 기록도 함께 삭제됩니다.</li>
        </ol>
        <ul>
          <li v-for="warning in status.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </details>
      <details>
        <summary>현재 데이터 건수</summary>
        <dl class="test-data-counts">
          <div v-for="(label, key) in testDataCountLabels" :key="key">
            <dt>{{ label }}</dt>
            <dd>{{ status.counts[key] }}건</dd>
          </div>
        </dl>
      </details>
      <ul v-if="status.blockers.length" class="muted">
        <li v-for="blocker in status.blockers" :key="blocker">{{ blocker }}</li>
      </ul>
      <div class="actions test-data-actions">
        <button
          class="button primary"
          :disabled="loading || busy || !status.canLoad"
          @click="inspect('load')"
        >
          테스트 데이터 로드</button
        ><button
          class="button secondary"
          :disabled="loading || busy || !status.canReset"
          @click="inspect('reset')"
        >
          전체 데이터 초기화
        </button>
      </div>
      <details v-if="status.qualifications.length">
        <summary>현재 팀 자격 보기 ({{ status.qualifications.length }}개)</summary>
        <section v-for="team in status.teams" :key="team.id">
          <h3>{{ team.name }}</h3>
          <ul>
            <li v-for="q in status.qualifications.filter((q) => q.teamId === team.id)" :key="q.id">
              <RouterLink
                :to="`/admin/qualifications/${q.id}?lv1OrganizationId=${encodeURIComponent(team.id)}&type=${q.qualificationType}`"
                >{{ q.title }} ·
                {{ q.qualificationType === 'auditor' ? 'Auditor' : 'Auditee' }}</RouterLink
              >
            </li>
          </ul>
        </section>
      </details>
    </template>
  </section>
  <AppDialog
    :open="!!preview"
    :title="preview ? `${title[preview.action]} 확인` : ''"
    @update:open="
      (v) => {
        if (!v && !busy) preview = null;
      }
    "
  >
    <template v-if="preview"
      ><p v-if="preview.action === 'reset'">
        <strong>테스트 여부와 관계없이 기존 인증서와 모든 버전 이력까지 삭제됩니다.</strong>
        기본자격·팀 자격·인증Set·계획·평가·수료·인증·재인증·공지·업무 이력과 조직 설명·담당 업무를
        비웁니다.
      </p>
      <p v-else>
        내장 기본자격 {{ preview.recipe.templates }}개와 공통 원본 5개·팀별 특화 10개 및 학습 정보를
        생성합니다. 팀 자격은 로드 후 직접 등록합니다.
      </p>
      <p>
        사용자 {{ preview.preserved.users }}명과 조직 구조 {{ preview.preserved.organizations }}개를
        보존합니다. 모든 접속 세션이 종료되므로 계정을 다시 선택해야 합니다.
      </p>
      <dl class="test-data-counts">
        <div
          v-for="(label, key) in testDataCountLabels"
          :key="key"
          v-show="preview.before[key] || preview.after[key]"
        >
          <dt>{{ label }}</dt>
          <dd>{{ preview.before[key] }} → {{ preview.after[key] }}</dd>
        </div>
      </dl>
      <p class="muted">
        변경 전 세 데이터 파일을 자동 백업합니다. 백업·저장소 세대·최소 실행 영수증은 복구와 중복
        방지를 위해 유지합니다.
      </p>
      <div v-if="dialogError" class="error-message" role="alert">{{ dialogError }}</div>
      <label class="field"
        ><span>확인을 위해 ‘{{ phrase[preview.action] }}’를 입력해 주세요.</span
        ><input v-model="confirmation" :disabled="busy" autocomplete="off"
      /></label> </template
    ><template #footer
      ><button class="button secondary" :disabled="busy" @click="preview = null">취소</button
      ><button
        class="button primary"
        :disabled="busy || !preview || confirmation !== phrase[preview.action]"
        @click="apply"
      >
        {{ busy ? '처리 중' : '실행 확인' }}
      </button></template
    >
  </AppDialog>
</template>
