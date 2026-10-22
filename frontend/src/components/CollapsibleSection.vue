<script setup lang="ts">
import { useId } from 'vue';
import AppIcon from './AppIcon.vue';
defineProps<{ title: string }>();
const open = defineModel<boolean>('open', { default: true }),
  id = useId();
</script>

<template>
  <section class="collapsible-section" :aria-labelledby="`${id}-title`">
    <h2 :id="`${id}-title`" :aria-label="title" class="collapsible-section-heading">
      <button
        type="button"
        class="collapsible-section-toggle"
        :aria-label="`${title} ${open ? '접기' : '펼치기'}`"
        :aria-expanded="open"
        :aria-controls="`${id}-body`"
        :aria-describedby="$slots.summary ? `${id}-summary` : undefined"
        @click="open = !open"
      >
        <span class="collapsible-section-title">{{ title }}</span>
        <span v-if="$slots.summary" :id="`${id}-summary`" class="collapsible-section-summary"
          ><slot name="summary"
        /></span>
        <AppIcon name="down" :size="18" :class="{ 'is-open': open }" />
      </button>
    </h2>
    <div v-show="open" :id="`${id}-body`" class="collapsible-section-body"><slot /></div>
  </section>
</template>

<style scoped>
.collapsible-section {
  min-width: 0;
  border-block: 1px solid var(--line);
}
.collapsible-section-heading {
  margin: 0;
}
.collapsible-section-toggle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  width: 100%;
  min-height: 64px;
  padding: 16px 24px;
  background: var(--surface-tint);
  text-align: left;
}
.collapsible-section-toggle:focus-visible {
  outline-offset: -3px;
}
.collapsible-section-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-section);
  font-weight: var(--weight-heading);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.collapsible-section-summary {
  font-size: var(--text-caption);
  font-weight: var(--weight-body);
  color: var(--ink-muted);
}
.collapsible-section-toggle > svg.is-open {
  transform: rotate(180deg);
}
.collapsible-section-body {
  padding: 24px;
  min-width: 0;
}
@media (max-width: 768px) {
  .collapsible-section-toggle {
    padding: 16px;
  }
  .collapsible-section-body {
    padding: 20px 16px;
  }
}
@media (max-width: 480px) {
  .collapsible-section-summary {
    flex-basis: calc(100% - 34px);
    order: 2;
  }
}
</style>
