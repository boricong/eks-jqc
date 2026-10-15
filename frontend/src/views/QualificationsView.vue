<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from '../components/AppIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const search = ref('');
const filter = computed(() =>
  route.query.filter === 'excluded'
    ? 'excluded'
    : route.query.filter === 'certified'
      ? 'certified'
      : 'active',
);
const list = computed(() =>
  store.data.assignments.filter(
    (a) =>
      a.learnerId === store.actorId &&
      (filter.value === 'excluded'
        ? !!a.excludedReason
        : !a.excludedReason && Boolean(a.certifiedAt) === (filter.value === 'certified')) &&
      store
        .qualification(a.qualificationId)
        .title.toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
);
</script>
<template>
  <div class="container page">
    <div class="page-heading">
      <h1>자격 취득</h1>
      <span class="muted">{{ store.actor.name }}</span>
    </div>
    <div class="list-toolbar">
      <div class="tabs" aria-label="자격 상태">
        <button
          :class="{ active: filter === 'active' }"
          :aria-pressed="filter === 'active'"
          @click="router.replace({ query: {} })"
        >
          진행 중
          <span>{{ store.myAssignments.filter((a) => !a.certifiedAt).length }}</span></button
        ><button
          :class="{ active: filter === 'certified' }"
          :aria-pressed="filter === 'certified'"
          @click="router.replace({ query: { filter: 'certified' } })"
        >
          인증 완료 <span>{{ store.myAssignments.filter((a) => a.certifiedAt).length }}</span>
        </button>
        <button
          :class="{ active: filter === 'excluded' }"
          :aria-pressed="filter === 'excluded'"
          @click="router.replace({ query: { filter: 'excluded' } })"
        >
          검증 제외
        </button>
      </div>
      <label class="search-field"
        ><AppIcon name="search" :size="18" /><input
          v-model="search"
          aria-label="자격 검색"
          placeholder="자격 검색"
      /></label>
    </div>
    <div class="qualification-list">
      <RouterLink
        v-for="a in list"
        :key="a.id"
        :to="a.certifiedAt ? `/certifications/${a.id}` : `/qualifications/${a.id}`"
        class="qualification-row"
        ><span class="qualification-icon"
          ><AppIcon :name="a.certifiedAt ? 'award' : 'book'" :size="26" /></span
        ><span class="qualification-info"
          ><span class="row-title">{{ store.qualification(a.qualificationId).title }}</span
          ><span class="muted"
            >v{{ store.qualification(a.qualificationId).version }} · 필수
            {{ a.enrollments.length }}과정</span
          ></span
        ><span class="qualification-progress"
          ><span class="progress-label"
            ><span>과정 수료</span
            ><span>{{ store.completedCount(a) }} / {{ a.enrollments.length }}</span></span
          ><span class="progress-track"
            ><span
              :style="{ width: `${(store.completedCount(a) / a.enrollments.length) * 100}%` }"
            ></span></span></span
        ><StatusBadge v-if="a.excludedReason" status="excluded" /><StatusBadge
          v-else-if="a.certifiedAt"
          status="certified" /><span v-else class="inline-action"
          >진행하기<AppIcon name="arrow" :size="18" /></span
      ></RouterLink>
    </div>
    <div v-if="!list.length" class="panel empty-state spacious">
      <AppIcon name="book" :size="32" />
      <h2>
        {{
          search
            ? '검색 결과가 없습니다.'
            : filter === 'certified'
              ? '완료된 인증이 없습니다.'
              : '배정된 자격이 없습니다.'
        }}
      </h2>
    </div>
  </div>
</template>
