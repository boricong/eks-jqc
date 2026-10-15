<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from './stores/demo';
import AppIcon from './components/AppIcon.vue';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const menuOpen = ref(false);
const isHome = computed(() => route.name === 'home');
const roles = { learner: '학습자', ft: 'FT', admin: '운영자' };
async function changeActor(event: Event) {
  const select = event.target as HTMLSelectElement;
  const target = select.value;
  const failure = await router.push('/');
  if (failure && route.path !== '/') {
    select.value = store.actorId;
    return;
  }
  store.switchActor(target);
  menuOpen.value = false;
}
</script>
<template>
  <div class="app" :class="{ 'home-theme': isHome }">
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
            v-if="store.actor.role === 'learner'"
            to="/qualifications"
            :class="{
              active:
                route.path.startsWith('/qualifications') ||
                route.path.startsWith('/certifications'),
            }"
            @click="menuOpen = false"
            >자격 취득</RouterLink
          >
          <RouterLink
            v-if="store.actor.role === 'ft'"
            to="/evaluations"
            :class="{ active: route.path.startsWith('/evaluations') }"
            @click="menuOpen = false"
            >FT 평가</RouterLink
          >
          <RouterLink
            v-if="store.actor.role === 'admin'"
            to="/admin/qualifications"
            :class="{ active: route.path.startsWith('/admin') }"
            @click="menuOpen = false"
            >관리</RouterLink
          >
        </nav>
        <div class="account">
          <span
            class="prototype-label"
            title="가상 데이터로 동작하는 화면 시안입니다. 새로고침하면 초기 상태로 돌아갑니다."
            >화면 시안</span
          >
          <span class="avatar" aria-hidden="true">{{ store.actor.name.slice(0, 1) }}</span>
          <label class="sr-only" for="actor">접속 계정</label>
          <select id="actor" :value="store.actorId" @change="changeActor">
            <option v-for="user in store.data.users" :key="user.id" :value="user.id">
              {{ user.name }} · {{ roles[user.role] }}
            </option>
          </select>
        </div>
      </div>
    </header>
    <main id="main" tabindex="-1"><RouterView /></main>
    <footer class="site-footer">
      <div class="footer-inner"><span>EKS · 직무자격인증</span><span>검증용</span></div>
    </footer>
    <div v-if="store.toast" class="toast" role="status">
      <AppIcon name="check" :size="18" />{{ store.toast }}
    </div>
  </div>
</template>
