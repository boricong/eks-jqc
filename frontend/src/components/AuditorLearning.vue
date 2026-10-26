<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useDemo } from '../stores/demo';
import {
  auditorLevelLabels,
  type AuditorLevel,
  type AuditorProgram,
  type Certification,
  type StoredAssignment,
} from '@eks/contracts';
const store = useDemo(),
  router = useRouter();
type Status = {
  designated: boolean;
  currentLevel: AuditorLevel | null;
  notice: AuditorProgram['notice'] | null;
  legacyCertifications: Certification[];
  levels: {
    level: AuditorLevel;
    qualificationId: string;
    qualificationRevision: number;
    templateRevision: number;
    title: string;
    prerequisiteTitle: string | null;
    certification: Certification | null;
    assignment: StoredAssignment | null;
    history: Certification[];
    canStart: boolean;
    reasons: string[];
    completed: number;
    total: number;
    pendingAward: boolean;
    kind: string;
    renewal: { canStart: boolean; opensOn?: string; reasons: string[] } | null;
  }[];
};
const data = ref<Status>(),
  error = ref(''),
  busy = ref(false);
let sequence = 0;
async function load() {
  const seq = ++sequence;
  try {
    const result = await api<Status>('/me/auditor');
    if (seq === sequence) data.value = result;
  } catch (e) {
    if (seq === sequence) error.value = (e as Error).message;
  }
}
watch(
  () => store.actorId,
  () => {
    data.value = undefined;
    void load();
  },
  { immediate: true },
);
async function start(item: Status['levels'][number]) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = (await store.command('/me/auditor/starts', {
      qualificationId: item.qualificationId,
      qualificationRevision: item.qualificationRevision,
      templateRevision: item.templateRevision,
    })) as {
      assignmentId: string;
    };
    await router.push({
      path: `/qualifications/${result.assignmentId}`,
      query: { type: 'auditor' },
    });
  } catch (e) {
    error.value = (e as Error).message;
    await load();
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="auditor-learning" aria-label="Auditor 학습과 인증">
    <div class="section-heading">
      <h2>Auditor 학습과 인증</h2>
      <button class="button secondary" :disabled="busy" @click="load">새로고침</button>
    </div>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <template v-if="data">
      <p class="current-level">
        현재 유효 등급 ·
        <strong>{{
          data.currentLevel ? auditorLevelLabels[data.currentLevel] : '취득 전 또는 유효 인증 없음'
        }}</strong>
      </p>
      <p v-if="!data.designated" class="muted">
        Auditor 지정이 해제되었습니다. 이미 시작한 학습과 기존 인증 이력은 유지됩니다.
      </p>
      <details v-if="data.notice?.title" class="auditor-notice">
        <summary>{{ data.notice.title }}</summary>
        <p class="notice-body">{{ data.notice.body }}</p>
        <ul v-if="data.notice.links.length">
          <li v-for="link in data.notice.links" :key="link.url">
            <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.title }}</a>
          </li>
        </ul>
      </details>
      <p v-if="!data.levels.length" class="muted">팀에서 Auditor 자격을 준비 중입니다.</p>
      <article v-for="item in data.levels" :key="item.qualificationId" class="auditor-level">
        <h3>{{ item.title }}</h3>
        <p class="muted">
          {{ auditorLevelLabels[item.level]
          }}<span v-if="item.prerequisiteTitle">
            · 선행 일반 자격: {{ item.prerequisiteTitle }}</span
          >
        </p>
        <template v-if="item.certification"
          ><p>유효 · 만료일 {{ item.certification.expiresOn || '무기한' }}</p>
          <RouterLink
            class="button secondary"
            :to="`/certifications/${item.certification.assignmentId}?type=auditor`"
            >{{ item.renewal?.canStart ? '갱신 기준 확인' : '인증·갱신 상태 보기' }}</RouterLink
          >
          <p v-if="item.renewal?.opensOn" class="muted">
            갱신 시작일 {{ item.renewal.opensOn }}
          </p></template
        >
        <template v-else-if="item.assignment"
          ><p>필수 인증Set {{ item.completed }} / {{ item.total }} 수료</p>
          <p v-if="item.pendingAward" role="status">
            학습 수료 근거를 보존했습니다. 선행 자격과 취득 효력이 회복되면 자동 발급합니다.
          </p>
          <RouterLink
            class="button primary"
            :to="`/qualifications/${item.assignment.id}?type=auditor`"
            >{{ item.pendingAward ? '수료 근거 보기' : '학습 계속' }}</RouterLink
          ></template
        >
        <button
          v-else-if="item.canStart"
          class="button primary"
          :disabled="busy"
          @click="start(item)"
        >
          {{
            item.kind === 'reacquisition'
              ? `${auditorLevelLabels[item.level]} 재취득 학습 시작`
              : `${auditorLevelLabels[item.level]} 학습 시작`
          }}
        </button>
        <ul v-else class="muted">
          <li v-for="reason in item.reasons" :key="reason">{{ reason }}</li>
        </ul>
        <p v-if="item.history.length && !item.certification" class="muted">
          과거 취득 {{ item.history.length }}회 · 취득 이력은 보존됩니다.
        </p>
        <details v-if="item.history.length">
          <summary>취득·효력 이력</summary>
          <ul>
            <li v-for="cert in item.history" :key="cert.id">
              <RouterLink :to="`/certifications/${cert.assignmentId}?type=auditor`"
                >{{
                  new Date(cert.date).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
                }}
                취득 · 인증·효력 근거 보기</RouterLink
              >
            </li>
          </ul>
        </details>
      </article>
      <p v-if="data.legacyCertifications.length" class="muted">
        이전 Auditor 인증 {{ data.legacyCertifications.length }}건 · 등급 미지정
      </p>
      <ul v-if="data.legacyCertifications.length">
        <li v-for="cert in data.legacyCertifications" :key="cert.id">
          <RouterLink :to="`/certifications/${cert.assignmentId}?type=auditor`"
            >이전 Auditor 인증 ·
            {{ new Date(cert.date).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) }}
            취득</RouterLink
          >
        </li>
      </ul>
    </template>
    <p v-else-if="!error" role="status">학습 상태를 불러오는 중입니다.</p>
  </section>
</template>
<style scoped>
.auditor-learning {
  padding: 24px;
  background: #e8f0ff;
  border-radius: 8px;
  min-width: 0;
}
.auditor-level {
  border-top: 1px solid var(--border, #b8c8dd);
  padding: 20px 0;
}
.muted {
  color: var(--ink-secondary, #273951);
}
.auditor-level h3 {
  margin: 0 0 12px;
}
.auditor-level p {
  margin: 10px 0;
}
.auditor-notice {
  margin: 16px 0;
}
.auditor-notice summary {
  cursor: pointer;
  padding: 12px 0;
}
.notice-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 768px) {
  .auditor-learning {
    padding: 16px;
  }
  .button {
    min-height: 44px;
    white-space: normal;
  }
}
</style>
