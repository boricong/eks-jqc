<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import AppIcon from './AppIcon.vue';
const props = defineProps<{
  courses: {
    id: string;
    title: string;
    status: string;
    passed: number;
    total: number;
    completed: boolean;
  }[];
  selected: string;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const id = useId(),
  media = window.matchMedia('(max-width: 1279px)'),
  compact = ref(media.matches),
  open = ref(false);
const navigation = ref<HTMLElement>(),
  toggle = ref<HTMLButtonElement>();
const current = computed(() => props.courses.find((c) => c.id === props.selected));
const visible = computed(() => !compact.value || open.value);
function resize(e: MediaQueryListEvent) {
  compact.value = e.matches;
  if (e.matches) open.value = false;
}
function reveal() {
  const nav = navigation.value,
    button = nav?.querySelector<HTMLElement>('[aria-current="step"]');
  if (!nav || !button || !visible.value) return;
  const a = nav.getBoundingClientRect(),
    b = button.getBoundingClientRect();
  if (b.top < a.top) nav.scrollTop -= a.top - b.top;
  if (b.bottom > a.bottom) nav.scrollTop += b.bottom - a.bottom;
}
async function choose(courseId: string) {
  emit('select', courseId);
  if (compact.value) {
    open.value = false;
    await nextTick();
    toggle.value?.focus();
  }
}
onMounted(() => {
  media.addEventListener('change', resize);
  reveal();
});
onBeforeUnmount(() => media.removeEventListener('change', resize));
watch([() => props.selected, visible], async () => {
  await nextTick();
  reveal();
});
</script>
<template>
  <aside class="panel qualification-course-nav" aria-label="인증Set 선택">
    <div class="section-heading">
      <h2>필수 인증Set</h2>
      <span class="muted">{{ courses.length }}개</span>
    </div>
    <button
      ref="toggle"
      class="button secondary qualification-course-toggle"
      :aria-expanded="open"
      :aria-controls="id"
      @click="open = !open"
    >
      <span
        ><strong>{{ current?.title }}</strong
        ><small>{{ current?.status }}</small></span
      ><span>인증Set 선택 {{ open ? '접기' : '열기' }}</span>
    </button>
    <nav v-show="visible" :id="id" ref="navigation" aria-label="필수 인증Set">
      <button
        v-for="(course, index) in courses"
        :key="course.id"
        class="qualification-course-item"
        :aria-current="selected === course.id ? 'step' : undefined"
        @click="choose(course.id)"
      >
        <span class="course-number"
          ><AppIcon v-if="course.completed" name="check" :size="16" /><template v-else>{{
            String(index + 1).padStart(2, '0')
          }}</template></span
        >
        <span
          ><strong>{{ course.title }}</strong
          ><small>{{ course.status }}</small></span
        >
      </button>
    </nav>
  </aside>
</template>
