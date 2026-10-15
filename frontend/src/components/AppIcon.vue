<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });
const paths: Record<string, string> = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  diagonal: 'M6 18 18 6M6 6h12v12',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  circle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  retry: 'M3 11a9 9 0 1 1 2 7M3 5v6h6',
  book: 'M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15',
  file: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h6',
  award: 'M16 15 18 22l-6-3-6 3 2-7M19 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  home: 'm3 10 9-8 9 8v11h-6v-7H9v7H3Z',
  list: 'M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1',
  settings:
    'M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2M16 8l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  users:
    'M15 20v-3a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v3m18 0v-3a4 4 0 0 0-3-4M13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0m4-4a4 4 0 0 1 0 8',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  search: 'm16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 5v14M5 12h14',
  clipboard: 'M8 4H4v18h16V4h-4M8 2h8v5H8ZM8 12h8M8 16h5',
  alert: 'M12 8v5m0 4h.01M12 2l10 19H2Z',
  lock: 'M5 10h14v12H5Zm3 0V6a4 4 0 0 1 8 0v4',
  notice: 'M3 11v3h4l10 5V5L7 10H3Zm4 3 3 7h3M21 9v6',
  edit: 'm15 4 5 5M4 16 17 3l4 4L8 20l-5 1Z',
  menu: 'M4 6h16M4 12h16M4 18h16',
};
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.circle" />
  </svg>
</template>
