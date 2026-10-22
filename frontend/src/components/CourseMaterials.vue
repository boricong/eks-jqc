<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { materialTypeLabels, type LearningMaterial } from '@eks/contracts';
import AppIcon from './AppIcon.vue';
const props = defineProps<{ materials: LearningMaterial[]; contextKey?: string }>();
const id = useId(),
  openByContext = ref<Record<string, string[]>>({});
const context = computed(() => props.contextKey || props.materials.map((m) => m.id).join('|'));
const openIds = computed(() => openByContext.value[context.value] || []);
watch(
  () => `${context.value}:${props.materials.map((m) => m.id).join('|')}`,
  () => {
    if (!(context.value in openByContext.value)) {
      const first = props.materials.find((m) => m.type === 'text');
      openByContext.value[context.value] = first ? [first.id] : [];
    } else
      openByContext.value[context.value] = openIds.value.filter((key) =>
        props.materials.some((m) => m.id === key),
      );
  },
  { immediate: true },
);
function changed(materialId: string, event: Event) {
  const details = event.currentTarget as HTMLDetailsElement;
  if (!details.isConnected || details.dataset.context !== context.value) return;
  const next = new Set(openIds.value);
  details.open ? next.add(materialId) : next.delete(materialId);
  openByContext.value[context.value] = [...next];
}
function setAll(open: boolean) {
  openByContext.value[context.value] = open ? props.materials.map((m) => m.id) : [];
}
</script>
<template>
  <section class="course-material-collection" aria-label="학습자료">
    <div class="section-heading">
      <h3>
        학습자료 <span class="muted">{{ materials.length }}개</span>
      </h3>
      <div v-if="materials.length" class="material-controls">
        <button
          class="text-link"
          :aria-controls="id"
          :disabled="openIds.length === materials.length"
          @click="setAll(true)"
        >
          모두 펼치기
        </button>
        <button
          class="text-link"
          :aria-controls="id"
          :disabled="!openIds.length"
          @click="setAll(false)"
        >
          모두 접기
        </button>
      </div>
    </div>
    <div :id="id" class="material-accordions">
      <details
        v-for="(m, index) in materials"
        :key="`${context}:${m.id}`"
        class="material-accordion"
        :data-context="context"
        :open="openIds.includes(m.id)"
        @toggle="changed(m.id, $event)"
      >
        <summary>
          <span class="material-type">{{ materialTypeLabels[m.type] }}</span>
          <span class="material-summary"
            ><strong>{{ m.title || `학습자료 ${index + 1}` }}</strong
            ><span v-if="m.description" class="material-description-preview">{{
              m.description
            }}</span></span
          >
          <AppIcon name="down" :size="16" />
        </summary>
        <div class="material-accordion-body text-stack">
          <p v-if="m.description" class="prose-text">{{ m.description }}</p>
          <div v-if="m.type === 'text'" class="material-content">{{ m.content }}</div>
          <a
            v-else-if="/^https?:\/\//i.test(m.url)"
            :href="m.url"
            target="_blank"
            rel="noopener noreferrer"
            class="button secondary"
            :aria-label="`${m.title} 자료 열기 · 새 창`"
            >자료 열기 · 새 창<AppIcon name="diagonal" :size="16"
          /></a>
          <p v-else class="muted">자료 링크를 확인할 수 없습니다. 관리자에게 확인해 주세요.</p>
        </div>
      </details>
      <p v-if="!materials.length" class="muted material-empty">등록된 학습자료가 없습니다.</p>
    </div>
    <p v-if="materials.some((m) => m.type !== 'text')" class="muted material-external-note">
      외부 자료는 새 창에서 열리며, 해당 서비스의 접근 권한이 필요할 수 있습니다.
    </p>
  </section>
</template>
