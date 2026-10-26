<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { auditorLevelLabels, type AuditorLevel } from '@eks/contracts';
import { useDemo } from '../stores/demo';
const store = useDemo();
const route = useRoute(),
  data = ref<any>(),
  error = ref('');
let sequence = 0;
async function load() {
  const seq = ++sequence;
  data.value = undefined;
  error.value = '';
  try {
    const query = new URLSearchParams();
    for (const key of ['lv1OrganizationId', 'organizationId', 'includeDescendants'])
      if (route.query[key]) query.set(key, String(route.query[key]));
    const result = await api<any>(`/dashboard/auditor?${query}`);
    if (seq === sequence) {
      data.value = result;
      error.value = '';
    }
  } catch (e) {
    if (seq === sequence) error.value = (e as Error).message;
  }
}
watch([() => route.fullPath, () => store.actorId], load, { immediate: true });
</script>
<template>
  <section aria-label="Auditor 학습·등급 현황">
    <div class="section-heading">
      <h2>Auditor 학습·등급 현황</h2>
      <button class="button secondary" @click="load">현황 새로고침</button>
    </div>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>
    <template v-if="data"
      ><p>
        지정 {{ data.summary.designated }}명 · 학습 시작 {{ data.summary.started }}명 · 수료 이력
        {{ data.summary.completed }}명 · 일반 {{ data.summary.general }}명 · 메인
        {{ data.summary.main }}명 · 학습 진행 {{ data.summary.learning }}명
      </p>
      <article v-for="m in data.members" :key="m.id" class="progress-person">
        <h3>
          {{ m.name }} ·
          {{
            m.currentLevel ? auditorLevelLabels[m.currentLevel as AuditorLevel] : '유효 등급 없음'
          }}
        </h3>
        <p>{{ m.designated ? '지정' : '지정 해제' }}</p>
        <p v-for="level in m.levels" :key="level.qualificationId">
          {{ level.title }} · {{ auditorLevelLabels[level.level as AuditorLevel] }} ·
          {{
            level.certified
              ? '유효'
              : level.pendingAward
                ? '선행 자격 확인 대기'
                : level.learning
                  ? `학습 ${level.completed}/${level.total} 수료`
                  : level.historyCount
                    ? '과거 취득 · 현재 유효 인증 없음'
                    : '미시작'
          }}<span v-if="level.expiresOn"> · 만료 {{ level.expiresOn }}</span>
        </p>
      </article>
      <p v-if="!data.members.length">해당 범위에 대상자가 없습니다.</p></template
    >
  </section>
</template>
<style scoped>
.progress-person {
  border-top: 1px solid var(--border, #e3e8ee);
  padding: 16px 0;
}
</style>
