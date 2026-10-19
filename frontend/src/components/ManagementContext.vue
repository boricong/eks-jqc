<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
async function change(event: Event) {
  const select = event.target as HTMLSelectElement;
  const target = select.value;
  await router.push({
    path: `/admin/${String(route.params.section || 'qualifications')}`,
    query: { lv1OrganizationId: target },
  });
  select.value = store.managementLv1;
}
</script>
<template>
  <section class="management-context panel" aria-label="인증 업무 관리 대상">
    <label v-if="store.hasRole('system_operator')" class="field">
      <span>관리할 Lv1 조직</span>
      <select
        aria-label="관리할 Lv1 조직"
        :value="store.managementLv1"
        :disabled="!!store.writing || store.contextLoading"
        @change="change"
      >
        <option value="">조직을 선택해 주세요</option>
        <option
          v-for="org in store.data.organizations.filter((o) => o.level === 1)"
          :key="org.id"
          :value="org.id"
        >
          {{ org.name }}{{ org.effectiveActive ? '' : ' · 사용 중지' }}
        </option>
      </select>
    </label>
    <p v-else>{{ store.actor.organizationPath[0]?.name }}</p>
    <p class="muted">
      {{ store.hasRole('system_operator') ? '시스템 운영자 관리' : '조직 관리자' }}
      <span v-if="store.managementOrganization && !store.managementOrganization.effectiveActive">
        · 사용 중지 조직: 신규 소속·배정 불가</span
      >
    </p>
  </section>
</template>
