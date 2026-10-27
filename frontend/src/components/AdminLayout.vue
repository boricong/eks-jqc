<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDemo } from '../stores/demo';
import AppIcon from './AppIcon.vue';
import ManagementContext from './ManagementContext.vue';
import {
  withCriteriaType,
  visibleManagementGroups,
  managementTitle,
} from '../management-navigation';
const store = useDemo(),
  route = useRoute(),
  menuOpen = ref(false),
  menuToggle = ref<HTMLButtonElement>();
const groups = computed(() => visibleManagementGroups(store.canManageSection));
const section = computed(() => String(route.meta.managementSection || route.params.section));
const current = computed(() => managementTitle(section.value));
function closeMenu(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !menuOpen.value) return;
  event.preventDefault();
  event.stopPropagation();
  menuOpen.value = false;
  menuToggle.value?.focus();
}
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
    <aside class="admin-sidebar" aria-label="인증 업무 관리 탐색" @keydown="closeMenu">
      <button
        ref="menuToggle"
        class="button ghost management-menu-toggle"
        :aria-expanded="menuOpen"
        aria-controls="management-navigation"
        @click="menuOpen = !menuOpen"
      >
        {{ current }} · 메뉴 {{ menuOpen ? '접기' : '열기' }}
      </button>
      <nav
        id="management-navigation"
        class="management-navigation"
        aria-label="관리 메뉴"
        :class="{ 'is-open': menuOpen }"
      >
        <section
          v-for="group in groups"
          :key="group.id"
          class="management-nav-group"
          :aria-labelledby="`management-group-${group.id}`"
        >
          <h3 :id="`management-group-${group.id}`">{{ group.name }}</h3>
          <ul>
            <li v-for="s in group.sections" :key="s.id">
              <RouterLink
                :to="
                  withCriteriaType(
                    store.managementLink(s.path),
                    /^\/admin\/(qualifications|courses)(\/|$)/.test(route.path)
                      ? route.query.type
                      : undefined,
                  )
                "
                :class="{ active: section === s.id }"
                :aria-current="section === s.id ? 'page' : undefined"
                ><AppIcon :name="s.icon" :size="18" /><span>{{ s.name }}</span></RouterLink
              >
            </li>
          </ul>
        </section>
      </nav>
    </aside>
    <div class="management-content"><RouterView /></div>
  </div>
</template>

<style scoped>
.admin-sidebar nav.management-navigation {
  gap: 16px;
}
.management-nav-group {
  min-width: 0;
}
.management-nav-group + .management-nav-group {
  border-top: 1px solid var(--line);
  padding-top: 16px;
}
.management-nav-group h3 {
  margin: 0 0 4px;
  padding: 0 12px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
}
.management-nav-group ul {
  display: grid;
  gap: 4px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.admin-sidebar .management-nav-group a {
  min-height: 40px;
  padding: 8px 8px;
  gap: 8px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.45;
  white-space: normal;
}
.management-nav-group a svg {
  flex: 0 0 18px;
}
.management-nav-group a span {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: keep-all;
}
.admin-sidebar .management-nav-group a.active {
  font-weight: 500;
}
@media (max-width: 1024px) {
  .admin-sidebar nav.management-navigation.is-open {
    display: flex;
    flex-direction: column;
    padding-block: 16px;
  }
  .admin-sidebar .management-nav-group a {
    min-height: 44px;
  }
}
</style>
