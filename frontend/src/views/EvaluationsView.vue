<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { kindLabels } from '@eks/contracts';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const done = computed(() => route.query.filter === 'done');
const type = computed(() => String(route.query.type || 'all'));
const all = computed(() =>
  store.ftAssignments.flatMap((a) =>
    a.enrollments.flatMap((e) =>
      (['subjective', 'practical'] as const)
        .filter((kind) => store.course(e.courseId).assessmentKinds.includes(kind))
        .map((kind) => ({ a, e, kind })),
    ),
  ),
);
const waiting = computed(() => all.value.filter(({ e, kind }) => e[kind] === 'waiting'));
const history = computed(() =>
  all.value.filter(({ e, kind }) => ['passed', 'failed'].includes(e[kind])),
);
const rows = computed(() =>
  (done.value ? history.value : waiting.value).filter(
    (row) => type.value === 'all' || row.kind === type.value,
  ),
);
</script>
<template>
  <div class="container page">
    <div class="page-heading">
      <h1>FT 평가</h1>
      <span class="muted">{{ store.actor.name }} FT</span>
    </div>
    <div class="list-toolbar">
      <div class="tabs">
        <button
          :class="{ active: !done }"
          :aria-pressed="!done"
          @click="router.replace({ query: {} })"
        >
          평가 대기 <span>{{ waiting.length }}</span></button
        ><button
          :class="{ active: done }"
          :aria-pressed="done"
          @click="router.replace({ query: { filter: 'done' } })"
        >
          평가 완료 <span>{{ history.length }}</span>
        </button>
      </div>
      <label class="field"
        ><span>평가 유형</span
        ><select
          :value="type"
          @change="
            router.replace({
              query: { ...route.query, type: ($event.target as HTMLSelectElement).value },
            })
          "
        >
          <option value="all">전체</option>
          <option value="subjective">주관식 채점</option>
          <option value="practical">실기 평가</option>
        </select></label
      >
    </div>
    <div class="table-panel">
      <table v-if="rows.length">
        <thead>
          <tr>
            <th>대상자</th>
            <th>과정</th>
            <th>자격</th>
            <th>평가 회차</th>
            <th>유형 · 상태</th>
            <th><span class="sr-only">행동</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ a, e, kind } in rows" :key="a.id + e.courseId + kind">
            <td>
              <span class="person-cell"
                ><span class="avatar light">{{ store.username(a.learnerId)[0] }}</span
                >{{ store.username(a.learnerId) }}</span
              >
            </td>
            <td>{{ store.course(e.courseId).title }}</td>
            <td class="muted">{{ store.qualification(a.qualificationId).title }}</td>
            <td>
              {{ e.history.filter((h) => h.kind === kind).length + (done ? 0 : 1) }}회<small
                v-if="e.activeAttempts[kind]"
                class="muted"
                >{{
                  new Date(
                    e.activeAttempts[kind]!.submittedAt || e.activeAttempts[kind]!.createdAt,
                  ).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
                }}
                요청</small
              >
            </td>
            <td>{{ kindLabels[kind] }} · <StatusBadge :status="e[kind]" /></td>
            <td>
              <RouterLink
                class="button secondary"
                :to="`/evaluations/${a.id}/${e.courseId}${kind === 'subjective' ? '/subjective' : ''}`"
                >{{ done ? '결과 보기' : kind === 'subjective' ? '채점하기' : '평가하기'
                }}<AppIcon name="arrow" :size="16"
              /></RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-state spacious">
        <AppIcon :name="done ? 'clipboard' : 'check'" :size="32" />
        <h2>{{ done ? '완료된 평가가 없습니다.' : '대기 중인 평가가 없습니다.' }}</h2>
      </div>
    </div>
  </div>
</template>
