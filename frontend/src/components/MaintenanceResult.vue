<script setup lang="ts">
import { masterCountLabels, clearedDataLabels, type MaintenanceReceipt } from '@eks/contracts';
defineProps<{ result: MaintenanceReceipt; authenticated?: boolean }>();
</script>
<template>
  <section class="panel editor-panel maintenance-result" role="status">
    <h2>
      {{
        result.kind === 'master-reset' ? '설정·기준 보존 초기화 완료' : '설정·기준 전체 교체 완료'
      }}
    </h2>
    <p>
      업무·조직의 영구 백업 2개를 보관했습니다.
      <template v-if="!authenticated"
        >상단에서
        {{ result.kind === 'master-import' ? '불러온 파일의 운영자 계정' : '운영자 계정' }}을 다시
        선택해 주세요.</template
      >
      <template v-else
        >완료된 실행 결과를 확인했습니다. 새 계획 요청부터 진행할 수 있습니다.</template
      >
    </p>
    <p class="muted">
      처리 일시:
      {{ new Date(result.completedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) }} (KST)
    </p>
    <details>
      <summary>보존·삭제 건수와 백업 정보</summary>
      <div class="master-preview-columns">
        <section>
          <h3>현재 설정·기준</h3>
          <dl class="master-counts">
            <div v-for="(label, key) in masterCountLabels" :key="key">
              <dt>{{ label }}</dt>
              <dd>{{ result.preserved[key] }}건</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>삭제한 데이터</h3>
          <dl class="master-counts">
            <div v-for="(label, key) in clearedDataLabels" :key="key">
              <dt>{{ label }}</dt>
              <dd>{{ result.deleted[key] }}건</dd>
            </div>
          </dl>
        </section>
      </div>
      <p class="master-file-name">업무 백업: {{ result.backups.state }}</p>
      <p class="master-file-name">조직 백업: {{ result.backups.organizations }}</p>
      <p class="muted">실행 번호: {{ result.operationId }}</p>
    </details>
  </section>
</template>
