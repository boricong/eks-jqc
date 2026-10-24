<script setup lang="ts">
import { ref } from 'vue';
import {
  masterCountLabels,
  clearedDataLabels,
  type MasterPreview,
  type MaintenanceReceipt,
} from '@eks/contracts';
import { api, mutate, downloadMasterData, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import AppDialog from './AppDialog.vue';
import { retainMaintenance, clearMaintenance } from '../maintenance-operation';
const store = useDemo();
const busy = ref(false),
  error = ref(''),
  importError = ref(''),
  fileName = ref('');
const resetPreview = ref<MasterPreview | null>(null),
  importPreview = ref<MasterPreview | null>(null);
const selectedFile = ref<File | null>(null),
  open = ref<'reset' | 'import' | ''>(''),
  confirmation = ref('');
const dialogError = ref('');
const operationKey = ref('');
async function inspectReset() {
  busy.value = true;
  error.value = '';
  try {
    resetPreview.value = await api<MasterPreview>('/testing/master-reset/preview');
    importPreview.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function selectFile(event: Event) {
  selectedFile.value = (event.target as HTMLInputElement).files?.[0] || null;
  fileName.value = selectedFile.value?.name || '';
  importPreview.value = null;
  importError.value = '';
}
async function inspectImport() {
  const file = selectedFile.value;
  if (!file || busy.value) return;
  busy.value = true;
  importError.value = '';
  try {
    if (file.size > 25 * 1024 * 1024)
      throw new Error('25MB 이하의 설정·기준 JSON 파일을 선택해 주세요.');
    const content = await file.text();
    try {
      JSON.parse(content);
    } catch {
      throw new Error('JSON 파일을 읽을 수 없습니다. 원래 내보낸 파일을 선택해 주세요.');
    }
    importPreview.value = await api<MasterPreview>('/system/master-data/import-preview', {
      method: 'POST',
      body: content,
    });
    resetPreview.value = null;
  } catch (e) {
    importError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function download() {
  busy.value = true;
  importError.value = '';
  try {
    await downloadMasterData();
  } catch (e) {
    importError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function confirm(kind: 'reset' | 'import') {
  open.value = kind;
  confirmation.value = '';
  dialogError.value = '';
  operationKey.value = '';
}
async function apply() {
  const kind = open.value,
    preview = kind === 'reset' ? resetPreview.value : importPreview.value;
  const phrase = kind === 'reset' ? '전체 초기화' : '전체 교체';
  if (!preview || confirmation.value !== phrase || busy.value) return;
  busy.value = true;
  dialogError.value = '';
  const key = operationKey.value || crypto.randomUUID();
  operationKey.value = key;
  retainMaintenance(key);
  try {
    const result = await mutate<MaintenanceReceipt>(
      kind === 'reset' ? '/testing/master-reset' : '/system/master-data/import',
      { previewId: preview.previewId, confirmation: confirmation.value },
      'POST',
      '',
      key,
    );
    store.maintenanceResult = result;
    clearMaintenance();
    store.notify(
      kind === 'reset'
        ? '설정·기준을 보존하고 초기화했습니다.'
        : '설정·기준 데이터를 불러왔습니다.',
    );
    open.value = '';
  } catch (e) {
    dialogError.value =
      e instanceof ApiError && e.code === 'REVISION_CONFLICT'
        ? '확인 이후 데이터가 바뀌었습니다. 창을 닫고 내용을 다시 검사해 주세요.'
        : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section
    class="panel editor-panel master-data-panel"
    :aria-busy="busy"
    aria-labelledby="master-reset-title"
  >
    <div class="section-heading">
      <h2 id="master-reset-title">설정·기준만 남기기</h2>
      <span class="badge">전체 조직</span>
    </div>
    <p>
      계획부터 다시 시험할 때 사용합니다. 사용자·조직·자격·인증Set·문항과 현재 설정은 그대로 두고,
      진행·공지·변경 이력을 모두 삭제합니다.
    </p>
    <div class="master-preservation-note">
      역할·소속·세부 관리자 지정·Hold, 팀 후보·필수 자격, 모든 기준 버전과 학습자료·정답은
      유지됩니다. 기존 학습·평가 초기화보다 넓은 범위입니다.
    </div>
    <button class="button secondary" :disabled="busy" @click="inspectReset">
      보존·삭제 내역 확인
    </button>
    <div v-if="error" class="error-message" role="alert">{{ error }}</div>
    <div v-if="resetPreview" class="master-preview-columns">
      <section>
        <h3>보존할 설정·기준</h3>
        <dl class="master-counts">
          <div v-for="(label, key) in masterCountLabels" :key="key">
            <dt>{{ label }}</dt>
            <dd>{{ resetPreview.preserved[key] }}건</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3>삭제할 진행·공지·이력</h3>
        <dl class="master-counts">
          <div
            v-for="(label, key) in clearedDataLabels"
            :key="key"
            v-show="key !== 'comparisons' || resetPreview.deleted[key] > 0"
          >
            <dt>{{ label }}</dt>
            <dd>{{ resetPreview.deleted[key] }}건</dd>
          </div>
        </dl>
      </section>
      <div class="master-preview-actions">
        <p class="muted">
          업무·조직의 영구 백업을 만든 뒤 초기화합니다. 모든 접속 계정은 다시 선택해야 합니다.
        </p>
        <button class="button primary" :disabled="busy" @click="confirm('reset')">
          설정·기준 보존 전체 초기화
        </button>
      </div>
    </div>
  </section>
  <section
    class="panel editor-panel master-data-panel"
    :aria-busy="busy"
    aria-labelledby="master-transfer-title"
  >
    <h2 id="master-transfer-title">설정·기준 데이터 이전</h2>
    <p>
      현재 사용자·조직과 자격 기준을 다른 서버로 옮깁니다. 진행·공지·과거 이력은 파일에 포함하지
      않습니다.
    </p>
    <div class="master-transfer-grid">
      <section>
        <h3>1. 현재 서버에서 내보내기</h3>
        <p>초기화 없이도 설정·기준만 다운로드합니다. 외부 학습자료는 URL로 보존합니다.</p>
        <button class="button secondary" :disabled="busy" @click="download">
          설정·기준 파일 내보내기
        </button>
      </section>
      <section>
        <h3>2. 이 서버로 불러오기</h3>
        <p>이 서버의 사용자·조직·기준을 파일 내용으로 전체 교체하고 진행은 비웁니다.</p>
        <label class="field"
          ><span>설정·기준 JSON 파일 (최대 25MB)</span
          ><input type="file" accept=".json,application/json" :disabled="busy" @change="selectFile"
        /></label>
        <p v-if="fileName" class="muted master-file-name">{{ fileName }}</p>
        <button class="button secondary" :disabled="busy || !selectedFile" @click="inspectImport">
          파일 검사
        </button>
      </section>
    </div>
    <div v-if="importError" class="error-message" role="alert">{{ importError }}</div>
    <section v-if="importPreview" class="master-import-review">
      <h3>전체 교체 전 확인</h3>
      <div class="table-scroll">
        <table class="master-comparison">
          <thead>
            <tr>
              <th scope="col">항목</th>
              <th scope="col">현재 서버</th>
              <th scope="col">불러올 파일</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(label, key) in masterCountLabels" :key="key">
              <th scope="row">{{ label }}</th>
              <td>{{ importPreview.current[key] }}건</td>
              <td>{{ importPreview.preserved[key] }}건</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="importPreview.compatibility" class="info-panel">{{ importPreview.compatibility }}</p>
      <details>
        <summary>삭제될 현재 서버의 진행·공지·이력 보기</summary>
        <dl class="master-counts">
          <div
            v-for="(label, key) in clearedDataLabels"
            :key="key"
            v-show="key !== 'comparisons' || importPreview.deleted[key] > 0"
          >
            <dt>{{ label }}</dt>
            <dd>{{ importPreview.deleted[key] }}건</dd>
          </div>
        </dl>
      </details>
      <p class="muted">
        기존 데이터는 영구 백업합니다. 파일의 운영자 계정으로 다시 접속해야 합니다.
      </p>
      <button class="button primary" :disabled="busy" @click="confirm('import')">
        전체 교체 확인
      </button>
    </section>
  </section>
  <AppDialog
    :open="!!open"
    :title="
      open === 'reset'
        ? '설정·기준만 남기고 전체 초기화할까요?'
        : '이 서버의 설정·기준을 전체 교체할까요?'
    "
    @update:open="
      (v) => {
        if (!v && !busy) open = '';
      }
    "
  >
    <p>
      {{
        open === 'reset'
          ? '사용자·조직·자격·인증Set·문항과 현재 설정은 보존합니다.'
          : '사용자·조직·자격·인증Set·문항을 검사한 파일 내용으로 교체합니다.'
      }}
    </p>
    <p>
      전체 조직의 계획·배정·평가·인증·공지·알림·기존 변경 이력과 재시도 기록이 삭제됩니다. 다른
      탭에서 진행 중인 작업에도 적용됩니다.
    </p>
    <p>업무·조직의 영구 백업을 만든 후 실행하며, 완료되면 계정을 다시 선택해야 합니다.</p>
    <div v-if="dialogError" class="error-message" role="alert">{{ dialogError }}</div>
    <label class="field"
      ><span
        >확인을 위해 ‘{{ open === 'reset' ? '전체 초기화' : '전체 교체' }}’를 입력해 주세요.</span
      ><input
        v-model="confirmation"
        :disabled="busy"
        autocomplete="off"
        aria-label="전체 작업 확인 문구"
    /></label>
    <template #footer
      ><button class="button secondary" :disabled="busy" @click="open = ''">취소</button
      ><button
        class="button primary"
        :disabled="busy || confirmation !== (open === 'reset' ? '전체 초기화' : '전체 교체')"
        @click="apply"
      >
        {{ busy ? '처리 중' : open === 'reset' ? '전체 초기화 실행' : '전체 교체 실행' }}
      </button></template
    >
  </AppDialog>
</template>
