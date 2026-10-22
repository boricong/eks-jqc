<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from './stores/demo';
import AppIcon from './components/AppIcon.vue';
import MaintenanceResult from './components/MaintenanceResult.vue';
import ProcessGuide from './components/ProcessGuide.vue';
import ConfirmationHost from './components/ConfirmationHost.vue';
import { roleLabels, type Role } from '@eks/contracts';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const menuOpen = ref(false);
const isHome = computed(() => route.name === 'home');
const isWide = computed(
  () => route.path.startsWith('/system') || (route.path.startsWith('/admin') && !route.params.id),
);
const roles = roleLabels;

watch(
  [
    () => store.signedIn,
    () => store.actor.roles.join(','),
    () => route.meta.role,
    () => route.meta.management,
  ],
  () => {
    const required = route.meta.role as Role | undefined;
    if (
      store.signedIn &&
      ((required && !store.hasRole(required)) ||
        (route.meta.management && !store.managementAccess && route.params.section !== 'policies'))
    )
      void router.replace('/');
  },
);
async function changeActor(event: Event) {
  const select = event.target as HTMLSelectElement;
  const target = select.value;
  const failure = await router.push('/');
  if (failure && route.path !== '/') {
    select.value = store.actorId;
    return;
  }
  try {
    await store.switchActor(target);
  } catch (error) {
    store.notify((error as Error).message);
    select.value = store.actorId;
  }
  menuOpen.value = false;
}
async function refreshOnFocus() {
  if (store.signedIn && !store.loading)
    try {
      await store.refresh();
    } catch (error) {
      store.notify((error as Error).message);
    }
}
function revealFocusedInput(event: FocusEvent) {
  const element = event.target;
  if (
    !(element instanceof HTMLElement) ||
    !element.matches('input, textarea, select, [role="tab"]')
  )
    return;
  // Dialogs and the virtual table manage their own scroll/focus. Moving the
  // page while a table editor opens can retarget the second click to another row.
  if (element.closest('dialog[open], .tabulator')) return;
  const bounds = element.getBoundingClientRect();
  const covered = [...document.querySelectorAll<HTMLElement>('.actionbar, .catalog-save-bar')].some(
    (bar) => {
      if (bar.contains(element)) return false;
      const area = bar.getBoundingClientRect();
      return (
        area.height > 0 &&
        area.top < innerHeight &&
        bounds.bottom > area.top &&
        bounds.top < area.bottom &&
        bounds.right > area.left &&
        bounds.left < area.right
      );
    },
  );
  if (covered) element.scrollIntoView({ block: 'center', behavior: 'instant' });
}
onMounted(() => {
  void store.initialize();
  window.addEventListener('focus', refreshOnFocus);
});
onBeforeUnmount(() => window.removeEventListener('focus', refreshOnFocus));
</script>
<template>
  <div class="app" :class="{ 'home-page-shell': isHome, 'app-wide': isWide }">
    <a class="skip-link" href="#main">본문으로 이동</a>
    <header class="topbar">
      <div class="topbar-inner">
        <RouterLink to="/" class="brand" aria-label="EKS 직무자격인증 홈"
          ><span class="brand-symbol"><i></i><i></i><i></i></span
          ><span>EKS<span class="brand-label">직무자격인증</span></span></RouterLink
        >
        <button
          class="icon-button mobile-menu"
          :aria-expanded="menuOpen"
          aria-label="메뉴"
          @click="menuOpen = !menuOpen"
        >
          <AppIcon name="menu" />
        </button>
        <nav class="primary-nav" :class="{ expanded: menuOpen }" aria-label="주 메뉴">
          <RouterLink to="/" :class="{ active: isHome }" @click="menuOpen = false">홈</RouterLink>
          <RouterLink
            v-if="store.hasRole('learner')"
            to="/qualifications"
            :class="{
              active:
                route.path.startsWith('/qualifications') ||
                route.path.startsWith('/plans') ||
                route.path.startsWith('/completions') ||
                route.path.startsWith('/certifications'),
            }"
            @click="menuOpen = false"
            >자격 취득</RouterLink
          >
          <RouterLink
            v-if="store.canEnterManagement"
            to="/admin"
            :class="{ active: route.path.startsWith('/admin') }"
            @click="menuOpen = false"
            >인증 업무 관리</RouterLink
          >
          <RouterLink
            v-if="store.hasRole('system_operator')"
            to="/system/organizations"
            :class="{ active: route.path.startsWith('/system') }"
            @click="menuOpen = false"
            >시스템 운영</RouterLink
          >
          <RouterLink
            v-if="store.signedIn"
            to="/notifications"
            :class="{ active: route.path === '/notifications' }"
            @click="menuOpen = false"
          >
            알림
            <span
              v-if="store.data.notifications.some((n) => !n.readAt)"
              class="notification-count"
              >{{ store.data.notifications.filter((n) => !n.readAt).length }}</span
            >
          </RouterLink>
        </nav>
        <div class="account">
          <span class="prototype-label" title="로컬 계정 선택으로 사용하는 검증용 MVP입니다."
            >검증용 MVP</span
          >
          <span class="avatar" aria-hidden="true">{{ store.actor.name.slice(0, 1) }}</span>
          <label class="sr-only" for="actor">접속 계정</label>
          <select
            id="actor"
            :value="store.actorId"
            :disabled="store.loading || !!store.writing"
            @change="changeActor"
          >
            <option disabled value="">계정 선택</option>
            <option v-for="user in store.actors" :key="user.id" :value="user.id">
              {{ user.name }} · {{ user.roles.map((role) => roles[role]).join(' · ') }} ·
              {{ user.organizationPath[0]?.name.split('(')[0] }}
            </option>
          </select>
        </div>
      </div>
    </header>
    <main id="main" tabindex="-1" @focusin="revealFocusedInput">
      <div
        v-if="store.loading || store.contextLoading"
        class="container page empty-state"
        role="status"
      >
        불러오는 중
      </div>
      <template v-else-if="store.signedIn">
        <div v-if="store.maintenanceResult" class="container">
          <MaintenanceResult :result="store.maintenanceResult" authenticated />
        </div>
        <RouterView />
      </template>
      <div v-else class="container page empty-state spacious">
        <MaintenanceResult v-if="store.maintenanceResult" :result="store.maintenanceResult" />
        <h1>접속 계정 선택</h1>
        <p class="muted">상단에서 검증에 사용할 계정을 선택해 주세요.</p>
        <p v-if="store.connectionError" class="error-message" role="alert">
          {{ store.connectionError }}
        </p>
        <button v-if="store.connectionError" class="button secondary" @click="store.initialize()">
          다시 연결
        </button>
      </div>
      <ProcessGuide />
    </main>
    <footer class="site-footer">
      <div class="footer-inner"><span>EKS · 직무자격인증</span><span>검증용</span></div>
    </footer>
    <ConfirmationHost />
    <div v-if="store.toast" class="toast" role="status">
      <AppIcon name="check" :size="18" />{{ store.toast }}
    </div>
  </div>
</template>
