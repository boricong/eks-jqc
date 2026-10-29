<script setup lang="ts">
import { computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from './stores/demo';
import HeaderNavigation from './components/HeaderNavigation.vue';
import AppIcon from './components/AppIcon.vue';
import ProcessGuide from './components/ProcessGuide.vue';
import ConfirmationHost from './components/ConfirmationHost.vue';
import { roleLabels, type Role } from '@eks/contracts';
import { primaryNavigationSection } from './learner-navigation';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const documentAssignment = computed(() =>
  route.name === 'certificate'
    ? store.assignment(String(route.params.id))
    : route.name === 'completion'
      ? store.data.assignments.find((a) =>
          a.enrollments.some((e) => e.completion?.id === route.params.id),
        )
      : undefined,
);
const navigationSection = computed(() =>
  primaryNavigationSection(route, store.actor, documentAssignment.value, store.canEnterPersonal),
);
const isHome = computed(() => route.name === 'home');
const isWide = computed(
  () => route.path.startsWith('/system') || (route.path.startsWith('/admin') && !route.params.id),
);
const roles = roleLabels;

watch(
  [
    () => store.signedIn,
    () => store.actor.roles.join(','),
    () => store.canEnterPersonal,
    () => route.meta.role,
    () => route.meta.management,
  ],
  () => {
    const required = route.meta.role as Role | undefined;
    if (
      store.signedIn &&
      ((required && !(required === 'learner' ? store.canEnterPersonal : store.hasRole(required))) ||
        (route.meta.management &&
          !store.managementAccess &&
          route.params.section !== 'organization-settings'))
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
  // Dialogs manage their own scroll and focus.
  if (element.closest('dialog[open]')) return;
  const bounds = element.getBoundingClientRect();
  const covered = [...document.querySelectorAll<HTMLElement>('.actionbar')].some((bar) => {
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
  });
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
        <HeaderNavigation :section="navigationSection" />
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
        <aside
          v-if="store.data.actor.workStatus === 'deactive'"
          class="container notice-body"
          role="status"
        >
          <strong>deactive</strong> · 현재 팀 Auditee 절차가 중단되어 있습니다.
          <span v-if="store.data.actor.workDeactivation"
            >미수행 시작 {{ store.data.actor.workDeactivation.startedOn }} · 인증 말소 기준
            {{ store.data.actor.workDeactivation.revokesOn }}.</span
          >
          기존 기록은 조회할 수 있습니다. 복귀는 팀 관리자에게 요청해 주세요.
        </aside>
        <RouterView />
      </template>
      <div v-else class="container page empty-state spacious">
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
