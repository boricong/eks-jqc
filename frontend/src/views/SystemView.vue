<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { systemSections as sections } from '../system-navigation';
import { useDemo } from '../stores/demo';
import QualificationTemplates from '../components/QualificationTemplates.vue';
import OrganizationPanel from '../components/OrganizationPanel.vue';
import UserManagementPanel from '../components/UserManagementPanel.vue';
import SystemOverview from '../components/SystemOverview.vue';
import SystemNotices from '../components/SystemNotices.vue';
import MasterDataPanel from '../components/MasterDataPanel.vue';
import TestProgressPanel from '../components/TestProgressPanel.vue';
const SystemDocuments = defineAsyncComponent(() => import('../components/SystemDocuments.vue'));
const route = useRoute();
const store = useDemo();
const section = computed(() => String(route.params.section));
const menuOpen = ref(false);
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
  },
);
</script>
<template>
  <div class="container page admin-shell system-shell management-layout">
    <aside class="admin-sidebar">
      <h2>시스템 운영</h2>
      <button
        class="button ghost management-menu-toggle"
        :aria-expanded="menuOpen"
        aria-controls="system-navigation"
        @click="menuOpen = !menuOpen"
      >
        {{ sections.find((s) => s.id === section)?.name }} · 메뉴 {{ menuOpen ? '접기' : '열기' }}
      </button>
      <nav id="system-navigation" aria-label="시스템 운영 메뉴" :class="{ 'is-open': menuOpen }">
        <RouterLink
          v-for="item in sections"
          :key="item.id"
          :to="item.path"
          :class="{ active: section === item.id }"
          :aria-current="section === item.id ? 'page' : undefined"
          >{{ item.name }}</RouterLink
        >
      </nav>
    </aside>
    <div class="admin-content management-content">
      <QualificationTemplates v-if="section === 'qualification-templates'" /><OrganizationPanel
        v-else-if="section === 'organizations'"
      /><UserManagementPanel
        v-else-if="section === 'users'"
        :key="store.actorId"
        mode="system"
      /><SystemOverview v-else-if="section === 'overview'" /><SystemNotices
        v-else-if="section === 'notices'"
      /><SystemDocuments v-else-if="section === 'documents'" /><template v-else
        ><h1>테스트 관리</h1>
        <TestProgressPanel />
        <MasterDataPanel
      /></template>
    </div>
  </div>
</template>
