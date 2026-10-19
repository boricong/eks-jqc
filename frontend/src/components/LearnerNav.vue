<script setup lang="ts">
import { useRoute } from 'vue-router';
const route = useRoute();
const items = [
  { path: '/plans', label: '내 계획', key: 'plans' },
  { path: '/qualifications', label: '학습·평가', key: 'learning' },
  { path: '/qualifications?filter=certified', label: '보유 자격', key: 'certified' },
];
function active(key: string) {
  return route.path.startsWith('/plans')
    ? key === 'plans'
    : route.query.filter === 'certified'
      ? key === 'certified'
      : key === 'learning';
}
</script>
<template>
  <nav class="learner-nav" aria-label="자격 취득 메뉴">
    <RouterLink
      v-for="item in items"
      :key="item.key"
      :to="item.path"
      custom
      v-slot="{ href, navigate }"
      ><a
        :href="href"
        :class="{ 'router-link-active': active(item.key) }"
        :aria-current="active(item.key) ? 'page' : undefined"
        @click="navigate"
        >{{ item.label }}</a
      ></RouterLink
    >
  </nav>
</template>
