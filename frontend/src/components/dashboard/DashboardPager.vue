<script setup lang="ts">
defineProps<{
  total: number;
  page: number;
  pageSize: number;
  density: string;
  disabled?: boolean;
  fixedPageSize?: boolean;
}>();
const emit = defineEmits<{
  page: [number];
  pageSize: [number];
  density: [string];
}>();
</script>
<template>
  <div class="dashboard-pager" aria-label="현황 목록 조작">
    <span class="dashboard-count">전체 {{ total.toLocaleString('ko-KR') }}건</span>
    <label
      >밀도<select
        aria-label="목록 밀도"
        :value="density"
        @change="emit('density', ($event.target as HTMLSelectElement).value)"
      >
        <option value="compact">촘촘하게</option>
        <option value="roomy">여유 있게</option>
      </select></label
    >
    <label
      >페이지 크기<select
        aria-label="페이지 크기"
        :value="pageSize"
        :disabled="disabled || fixedPageSize"
        @change="emit('pageSize', Number(($event.target as HTMLSelectElement).value))"
      >
        <option :value="25">25개</option>
        <option :value="50">50개</option>
        <option :value="100">100개</option>
      </select></label
    >
    <nav class="dashboard-pagination" aria-label="현황 페이지">
      <button
        type="button"
        class="icon-button"
        aria-label="이전 페이지"
        :disabled="disabled || page <= 1"
        @click="emit('page', page - 1)"
      >
        ‹
      </button>
      <span>{{ page }} / {{ Math.max(1, Math.ceil(total / pageSize)) }}</span>
      <button
        type="button"
        class="icon-button"
        aria-label="다음 페이지"
        :disabled="disabled || page >= Math.max(1, Math.ceil(total / pageSize))"
        @click="emit('page', page + 1)"
      >
        ›
      </button>
    </nav>
  </div>
</template>
