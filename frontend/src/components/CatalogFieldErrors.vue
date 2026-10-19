<script setup lang="ts">
import type { CatalogIssue } from '@eks/contracts';
defineProps<{ issues?: CatalogIssue[]; field: string }>();
</script>
<template>
  <span
    v-for="(i, n) in issues?.filter((i) => i.column === field)"
    :key="n"
    class="catalog-field-error"
    role="alert"
    >{{ i.message }}</span
  >
</template>
