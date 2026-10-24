<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { materialTypeLabels, type LearningMaterial } from '@eks/contracts';
import CompactTabs from './CompactTabs.vue';
import AppIcon from './AppIcon.vue';
import { useLearnerMemory } from '../composables/useLearnerMemory';
const props = defineProps<{ materials: LearningMaterial[]; contextKey: string }>();
const memory = useLearnerMemory();
const state = computed(() => memory.reading(props.contextKey));
const selected = computed(() => props.materials.find((m) => m.id === state.value.selected));
const items = computed(() => {
  const totals = new Map<LearningMaterial['type'], number>();
  const positions = new Map<LearningMaterial['type'], number>();
  for (const material of props.materials)
    totals.set(material.type, (totals.get(material.type) || 0) + 1);
  return props.materials.map((m, i) => {
    const position = (positions.get(m.type) || 0) + 1;
    positions.set(m.type, position);
    const label = `${materialTypeLabels[m.type]}${totals.get(m.type)! > 1 ? ` ${position}` : ''}`;
    return { id: m.id, label, ariaLabel: `${label} · ${m.title || `학습자료 ${i + 1}`}` };
  });
});
const selectedLabel = computed(() => items.value.find((m) => m.id === selected.value?.id)?.label);
const externalUrl = computed(() => {
  if (!selected.value || selected.value.type === 'text') return '';
  try {
    const value = new URL(selected.value.url);
    return ['http:', 'https:'].includes(value.protocol) && value.hostname ? selected.value.url : '';
  } catch {
    return '';
  }
});
const copyMessage = ref(''),
  copying = ref(false);
let copyGeneration = 0;
watch(
  () => [props.contextKey, selected.value?.id, selected.value?.url],
  () => {
    copyGeneration++;
    copyMessage.value = '';
    copying.value = false;
  },
);
async function copyUrl() {
  if (!externalUrl.value || copying.value) return;
  const seq = ++copyGeneration;
  copying.value = true;
  copyMessage.value = '';
  try {
    await navigator.clipboard.writeText(externalUrl.value);
    if (seq === copyGeneration) copyMessage.value = '주소를 복사했습니다.';
  } catch {
    if (seq === copyGeneration)
      copyMessage.value = '주소 복사에 실패했습니다. 위 주소를 직접 선택해 복사해 주세요.';
  } finally {
    if (seq === copyGeneration) copying.value = false;
  }
}
const body = ref<HTMLElement>(),
  toggle = ref<HTMLButtonElement>(),
  tabs = ref<InstanceType<typeof CompactTabs>>();
const id = useId(),
  open = ref(false);
const media = matchMedia('(max-width: 1023px)'),
  compact = ref(media.matches);
let renderedState = state.value,
  renderedMaterial = '',
  generation = 0;
function savePosition() {
  if (!body.value || !renderedMaterial) return;
  if (compact.value) {
    const rect = body.value.getBoundingClientRect();
    if (rect.top <= 0 && rect.bottom > 0)
      renderedState.scroll[renderedMaterial] = Math.max(0, -rect.top);
  } else renderedState.scroll[renderedMaterial] = body.value.scrollTop;
}
async function revealSelection() {
  await nextTick();
  const tabId = tabs.value?.tabId(state.value.selected);
  const tab = tabId ? document.getElementById(tabId) : null;
  const list = tab?.parentElement;
  if (!tab || !list || !list.clientHeight) return;
  const top = tab.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (top + tab.offsetHeight > list.scrollTop + list.clientHeight)
    list.scrollTop = top + tab.offsetHeight - list.clientHeight;
}
async function restore() {
  const seq = ++generation;
  await nextTick();
  if (seq !== generation) return;
  renderedState = state.value;
  renderedMaterial = selected.value?.id || '';
  void revealSelection();
  const offset = renderedState.scroll[renderedMaterial] || 0;
  if (body.value && !compact.value) body.value.scrollTop = offset;
  requestAnimationFrame(() => {
    if (seq !== generation) return;
    // Route navigation resets the page after Vue's nextTick. Restore mobile
    // reading position after that reset, without nesting a second scroll area.
    if (body.value && compact.value && offset > 0)
      window.scrollTo({
        top:
          window.scrollY +
          body.value.getBoundingClientRect().top +
          Math.min(offset, body.value.scrollHeight - 1),
        behavior: 'instant',
      });
  });
}
async function choose(value: string) {
  if (value !== state.value.selected) {
    savePosition();
    state.value.selected = value;
  }
  if (compact.value) {
    open.value = false;
    await nextTick();
    toggle.value?.focus({ preventScroll: true });
  }
}
watch(open, (value) => {
  if (value) void revealSelection();
});
watch(
  () => `${props.contextKey}:${props.materials.map((m) => m.id).join('|')}`,
  () => {
    savePosition();
    open.value = false;
    if (!props.materials.some((m) => m.id === state.value.selected))
      state.value.selected =
        (props.materials.find((m) => m.type === 'text') || props.materials[0])?.id || '';
    for (const key of Object.keys(state.value.scroll))
      if (!props.materials.some((m) => m.id === key)) delete state.value.scroll[key];
    void restore();
  },
  { immediate: true },
);
watch(
  () => state.value.selected,
  () => void restore(),
);
function resize(event: MediaQueryListEvent) {
  savePosition();
  compact.value = event.matches;
  open.value = false;
  void restore();
}
onMounted(() => {
  media.addEventListener('change', resize);
  window.addEventListener('scroll', savePosition, { passive: true });
  void restore();
});
onBeforeUnmount(() => {
  savePosition();
  generation++;
  copyGeneration++;
  media.removeEventListener('change', resize);
  window.removeEventListener('scroll', savePosition);
});
</script>
<template>
  <section class="learning-material-reader" aria-label="학습자료">
    <div class="section-heading">
      <h3>
        학습자료 <span class="muted">{{ materials.length }}개</span>
      </h3>
    </div>
    <p v-if="!selected" class="muted">등록된 학습자료가 없습니다.</p>
    <div v-else class="learning-reader-layout">
      <div class="learning-reader-index">
        <button
          v-if="compact"
          ref="toggle"
          type="button"
          class="button secondary learning-reader-toggle"
          :aria-expanded="open"
          :aria-controls="id + '-list'"
          @click="open = !open"
        >
          <span>{{ selectedLabel }}</span
          ><span>자료 선택 {{ open ? '접기' : '열기' }}</span>
        </button>
        <div v-show="!compact || open" :id="id + '-list'">
          <CompactTabs
            ref="tabs"
            :model-value="state.selected"
            @update:model-value="choose"
            :items="items"
            label="학습자료 선택"
            :panel-id="id + '-body'"
            vertical
          />
        </div>
      </div>
      <div
        ref="body"
        :id="id + '-body'"
        class="learning-material-body"
        role="tabpanel"
        :aria-labelledby="tabs?.tabId(state.selected)"
        tabindex="0"
        @scroll="savePosition"
      >
        <div class="learning-reader-title">
          <span class="small-label">{{ materialTypeLabels[selected.type] }}</span>
          <h4>{{ selected.title || '학습자료' }}</h4>
        </div>
        <p v-if="selected.description" class="prose-text">{{ selected.description }}</p>
        <div v-if="selected.type === 'text'" class="material-content">{{ selected.content }}</div>
        <template v-else>
          <p v-if="selected.url" class="learning-material-url">{{ selected.url }}</p>
          <div v-if="externalUrl" class="actions learning-material-link-actions">
            <button type="button" class="button secondary" :disabled="copying" @click="copyUrl">
              {{ copying ? '복사 중' : '주소 복사' }}
            </button>
            <a
              :href="externalUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="button secondary"
              :aria-label="`${selected.title} 자료 열기 · 새 창`"
              >자료 열기 · 새 창<AppIcon name="diagonal" :size="16"
            /></a>
          </div>
          <p v-else class="muted">자료 링크를 확인할 수 없습니다. 관리자에게 확인해 주세요.</p>
          <p class="learning-copy-status" role="status">{{ copyMessage }}</p>
          <p class="learning-external-note">외부 서비스의 접근 권한이 필요할 수 있습니다.</p>
        </template>
      </div>
    </div>
  </section>
</template>
