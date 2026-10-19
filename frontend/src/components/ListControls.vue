<script setup lang="ts">
defineProps<{ count: number; pages: number }>();
const page = defineModel<number>('page', { required: true }),
  size = defineModel<number>('size', { required: true }),
  density = defineModel<string>('density', { required: true }),
  sort = defineModel<string>('sort', { required: true });
</script>
<template>
  <div class="list-controls">
    <span class="list-count">전체 {{ count }}개</span
    ><label
      >정렬<select v-model="sort" aria-label="목록 정렬">
        <option value="original">등록 순서</option>
        <option value="asc">이름 오름차순</option>
        <option value="desc">이름 내림차순</option>
      </select></label
    ><label
      >밀도<select v-model="density" aria-label="목록 밀도">
        <option value="compact">촘촘하게</option>
        <option value="roomy">여유 있게</option>
      </select></label
    ><label
      >페이지 크기<select v-model.number="size" aria-label="페이지 크기">
        <option :value="25">25개</option>
        <option :value="50">50개</option>
        <option :value="100">100개</option>
      </select></label
    >
    <div class="pagination">
      <button class="icon-button" aria-label="이전 페이지" :disabled="page <= 1" @click="page--">
        ‹</button
      ><span>{{ page }} / {{ pages }}</span
      ><button
        class="icon-button"
        aria-label="다음 페이지"
        :disabled="page >= pages"
        @click="page++"
      >
        ›
      </button>
    </div>
  </div>
</template>
