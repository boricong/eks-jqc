<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDemo } from '../stores/demo';
import CompactTabs from './CompactTabs.vue';
defineProps<{ panelId: string }>();
const store = useDemo(),
  route = useRoute(),
  router = useRouter();
const items = computed(() =>
  store.personalTypes.map((id) => ({
    id,
    label: id === 'auditor' ? '평가자 인증 · Auditor' : '학습자 인증 · Auditee',
  })),
);
const selected = computed(() =>
  route.query.type === 'auditor'
    ? 'auditor'
    : store.personalTypes.includes('auditee')
      ? 'auditee'
      : 'auditor',
);
function select(type: string) {
  void router.push({
    query: {
      ...route.query,
      type: type === 'auditor' ? 'auditor' : undefined,
      request: undefined,
      qualification: undefined,
    },
  });
}
</script>
<template>
  <CompactTabs
    class="certification-type-tabs"
    :items="items"
    :panel-id="panelId"
    :model-value="selected"
    label="인증 유형"
    @update:model-value="select"
  />
</template>
