<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from './AppIcon.vue';
import ManagementContext from './ManagementContext.vue';
const store = useDemo(),
  route = useRoute(),
  menuOpen = ref(false);
const sections = [
  { id: 'dashboard', name: '인증 현황', icon: 'chart' },
  { id: 'catalog', name: '기준 일괄 관리', icon: 'file' },
  { id: 'credentials', name: '개인 자격 관리', icon: 'award' },
  { id: 'targets', name: '인증 대상자 관리', icon: 'users' },
  { id: 'policies', name: '조직별 자격 설정', icon: 'users' },
  { id: 'qualifications', name: '팀 자격 관리', icon: 'award' },
  { id: 'courses', name: '인증Set 관리', icon: 'book' },
  { id: 'assignments', name: '대상자·계획', icon: 'users' },
  { id: 'results', name: '결과 조회', icon: 'clipboard' },
  { id: 'comparisons', name: '기준 검증', icon: 'check' },
  { id: 'notices', name: '팀 공지 관리', icon: 'notice' },
];
const section = computed(() => String(route.meta.managementSection || route.params.section));
const current = computed(
  () => sections.find((s) => s.id === section.value)?.name || '인증 업무 관리',
);
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
  },
);
</script>
<template>
  <div
    class="container page admin-shell management-layout"
    :class="{ 'individual-editor': !!route.params.id }"
  >
    <ManagementContext />
    <aside class="admin-sidebar" aria-label="인증 업무 관리 탐색">
      <h2 class="small-heading">인증 업무 관리</h2>
      <button
        class="button ghost management-menu-toggle"
        :aria-expanded="menuOpen"
        aria-controls="management-navigation"
        @click="menuOpen = !menuOpen"
      >
        {{ current }} · 메뉴 {{ menuOpen ? '접기' : '열기' }}
      </button>
      <nav id="management-navigation" aria-label="관리 메뉴" :class="{ 'is-open': menuOpen }">
        <RouterLink
          v-for="s in sections.filter((s) => store.canManageSection(s.id))"
          :key="s.id"
          :to="store.managementLink(`/admin/${s.id}`)"
          :class="{ active: section === s.id }"
          :aria-current="section === s.id ? 'page' : undefined"
          ><AppIcon :name="s.icon" :size="18" />{{ s.name }}</RouterLink
        >
      </nav>
    </aside>
    <div class="management-content"><RouterView /></div>
  </div>
</template>
