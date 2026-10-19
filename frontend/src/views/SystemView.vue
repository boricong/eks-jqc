<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import OrganizationPanel from '../components/OrganizationPanel.vue';
import UserManagementPanel from '../components/UserManagementPanel.vue';
import SystemOverview from '../components/SystemOverview.vue';
import TestProgressPanel from '../components/TestProgressPanel.vue';
const route = useRoute();
const section = computed(() => String(route.params.section));
const sections = [
  { id: 'organizations', name: '조직 관리' },
  { id: 'users', name: '사용자 관리' },
  { id: 'overview', name: '전체 업무 조회' },
  { id: 'testing', name: '테스트 관리' },
];
</script>
<template>
  <div class="container page admin-shell system-shell">
    <aside class="admin-sidebar">
      <h2>시스템 운영</h2>
      <nav aria-label="시스템 운영 메뉴">
        <RouterLink
          v-for="item in sections"
          :key="item.id"
          :to="`/system/${item.id}`"
          :class="{ active: section === item.id }"
          >{{ item.name }}</RouterLink
        >
      </nav>
    </aside>
    <div class="admin-content">
      <OrganizationPanel v-if="section === 'organizations'" /><UserManagementPanel
        v-else-if="section === 'users'"
      /><SystemOverview v-else-if="section === 'overview'" /><template v-else
        ><h1>테스트 관리</h1>
        <TestProgressPanel
      /></template>
    </div>
  </div>
</template>
