<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const done = computed(() => route.query.filter === 'done');
const waiting = computed(() =>
  store.ftAssignments.flatMap((a) =>
    a.enrollments.filter((e) => e.practical === 'waiting').map((e) => ({ a, e })),
  ),
);
const history = computed(() =>
  store.ftAssignments.flatMap((a) =>
    a.enrollments.filter((e) => ['passed', 'failed'].includes(e.practical)).map((e) => ({ a, e })),
  ),
);
const rows = computed(() => (done.value ? history.value : waiting.value));
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
    </div>
    <div class="table-panel">
      <table v-if="rows.length">
        <thead>
          <tr>
            <th>대상자</th>
            <th>과정</th>
            <th>자격</th>
            <th>평가 회차</th>
            <th>상태</th>
            <th><span class="sr-only">행동</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ a, e } in rows" :key="a.id + e.courseId">
            <td>
              <span class="person-cell"
                ><span class="avatar light">{{ store.username(a.learnerId)[0] }}</span
                >{{ store.username(a.learnerId) }}</span
              >
            </td>
            <td>{{ store.course(e.courseId).title }}</td>
            <td class="muted">{{ store.qualification(a.qualificationId).title }}</td>
            <td>{{ e.history.filter((h) => h.kind === 'practical').length + (done ? 0 : 1) }}회</td>
            <td><StatusBadge :status="e.practical" /></td>
            <td>
              <RouterLink class="button secondary" :to="`/evaluations/${a.id}/${e.courseId}`"
                >{{ done ? '결과 보기' : '평가하기' }}<AppIcon name="arrow" :size="16"
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
