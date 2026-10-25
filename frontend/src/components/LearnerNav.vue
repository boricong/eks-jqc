<script setup lang="ts">
import { computed } from 'vue';
import { useDemo } from '../stores/demo';
import { useRoute } from 'vue-router';
import { learningStage, learnerNavigationItems } from '../learner-navigation';
const props = defineProps<{ assignmentId?: string; courseId?: string }>();
const route = useRoute(),
  store = useDemo();
const assignmentId = computed(
  () =>
    props.assignmentId ||
    (['qualification', 'assessment'].includes(String(route.name))
      ? String(route.params.id)
      : undefined),
);
const courseId = computed(
  () =>
    props.courseId ||
    (route.name === 'assessment'
      ? String(route.params.courseId)
      : typeof route.query.course === 'string'
        ? route.query.course
        : undefined),
);
const type = computed(() => {
  const a = assignmentId.value && store.assignment(assignmentId.value);
  const p = store.data.plans.find((p) => p.id === route.params.id);
  return a
    ? store.qualification(a.qualificationId).qualificationType
    : p
      ? store.qualification(p.qualificationId).qualificationType
      : route.query.type === 'auditor' || !store.personalTypes.includes('auditee')
        ? 'auditor'
        : 'auditee';
});
const items = computed(() =>
  learnerNavigationItems(assignmentId.value, courseId.value, type.value),
);
function active(key: string) {
  return route.path.startsWith('/plans') ? key === 'plans' : key === learningStage(route);
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
