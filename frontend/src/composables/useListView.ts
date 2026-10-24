import { computed, reactive, ref, watch, type Ref } from 'vue';
export function useListView<T>(items: Ref<T[]>, key: string, label: (item: T) => string) {
  let saved: any = {};
  try {
    saved = JSON.parse(localStorage.getItem(`eks-list-${key}`) || '{}');
  } catch {}
  const size = ref([25, 50, 100].includes(saved.size) ? saved.size : 25),
    sort = ref(saved.sort || 'original'),
    page = ref(1);
  const ordered = computed(() =>
    sort.value === 'original'
      ? items.value
      : [...items.value].sort(
          (a, b) => label(a).localeCompare(label(b), 'ko') * (sort.value === 'desc' ? -1 : 1),
        ),
  );
  const pages = computed(() => Math.max(1, Math.ceil(items.value.length / size.value)));
  const rows = computed(() =>
    ordered.value.slice((page.value - 1) * size.value, page.value * size.value),
  );
  watch([size, sort], () => {
    page.value = 1;
    localStorage.setItem(`eks-list-${key}`, JSON.stringify({ size: size.value, sort: sort.value }));
  });
  watch(
    () => items.value.length,
    () => {
      page.value = Math.min(page.value, pages.value);
    },
  );
  return reactive({
    size,
    sort,
    page,
    pages,
    rows,
    count: computed(() => items.value.length),
  });
}
