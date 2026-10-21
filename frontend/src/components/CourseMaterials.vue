<script setup lang="ts">
import { materialTypeLabels, type LearningMaterial } from '@eks/contracts';
defineProps<{ materials: LearningMaterial[] }>();
</script>
<template>
  <div class="materials-list">
    <section v-for="m in materials" :key="m.id" class="material-card">
      <header>
        <span class="small-label">{{ materialTypeLabels[m.type] }}</span>
        <h3>{{ m.title }}</h3>
      </header>
      <p v-if="m.description">{{ m.description }}</p>
      <div v-if="m.type === 'text'" class="material-content">{{ m.content }}</div>
      <a
        v-else-if="/^https?:\/\//i.test(m.url)"
        :href="m.url"
        target="_blank"
        rel="noopener noreferrer"
        class="button secondary"
        >자료 열기 · 새 창</a
      >
    </section>
    <p v-if="!materials.length" class="muted">등록된 학습자료가 없습니다.</p>
    <p class="muted">외부 자료는 새 창에서 열립니다. 내용을 학습한 뒤 평가하기를 선택해 주세요.</p>
  </div>
</template>
