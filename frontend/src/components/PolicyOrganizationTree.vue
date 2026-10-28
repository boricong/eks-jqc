<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onBeforeUnmount, watch, useId } from 'vue';
import type { OrganizationSettingsView } from '@eks/contracts';
const props = defineProps<{
  entries: Pick<
    OrganizationSettingsView['entries'][number],
    'id' | 'name' | 'path' | 'parentId' | 'level'
  >[];
  selected: string;
  disabled?: boolean;
  searchable?: boolean;
  embedded?: boolean;
  label?: string;
  selectableIds?: string[];
}>();
const emit = defineEmits<{ select: [id: string] }>();
const query = ref(''),
  closed = ref(new Set<string>()),
  tree = ref<HTMLElement>(),
  toggleButton = ref<HTMLButtonElement>();
const browserId = useId(),
  media = window.matchMedia('(max-width: 1023px)'),
  compact = ref(media.matches),
  open = ref(false);
const browserVisible = computed(() => props.embedded || !compact.value || open.value);
const treeLabel = computed(() => props.label || '설정 가능한 조직');
const selectedPath = computed(() => props.entries.find((e) => e.id === props.selected)?.path || []);
const selectable = computed(() => (props.selectableIds ? new Set(props.selectableIds) : null));
const canSelect = (id: string) =>
  !props.disabled && (!selectable.value || selectable.value.has(id));
function select(id: string) {
  if (canSelect(id)) emit('select', id);
}
const selectedName = computed(
  () => props.entries.find((e) => e.id === props.selected)?.name || '조직을 선택해 주세요',
);
function resize(event: MediaQueryListEvent) {
  compact.value = event.matches;
  if (event.matches) open.value = false;
}
onMounted(() => {
  media.addEventListener('change', resize);
  if (props.embedded) void revealSelected();
});
onBeforeUnmount(() => media.removeEventListener('change', resize));
watch(
  () => props.entries,
  () => {
    if (props.embedded) void revealSelected();
  },
);
watch(
  () => props.selected,
  async () => {
    if (props.embedded) {
      await revealSelected();
      return;
    }
    if (compact.value && open.value) {
      open.value = false;
      await nextTick();
      toggleButton.value?.focus();
    }
  },
);
const ids = computed(() => new Set(props.entries.map((e) => e.id)));
const baseLevel = computed(() => Math.min(...props.entries.map((e) => e.level)));
const children = (id: string) => props.entries.filter((e) => e.parentId === id);
const visible = computed(() => {
  const term = props.searchable === false ? '' : query.value.trim().toLocaleLowerCase();
  const matches = props.entries.filter((e) =>
    e.path
      .map((p) => p.name)
      .join(' ')
      .toLocaleLowerCase()
      .includes(term),
  );
  const included = new Set(matches.flatMap((e) => e.path.map((p) => p.id)));
  return props.entries.filter((e) =>
    term ? included.has(e.id) : !e.path.slice(0, -1).some((p) => closed.value.has(p.id)),
  );
});
function toggle(id: string) {
  if (props.disabled) return;
  const next = new Set(closed.value);
  next.has(id) ? next.delete(id) : next.add(id);
  closed.value = next;
}
function element(id: string) {
  return [...(tree.value?.querySelectorAll<HTMLElement>('[role=treeitem]') || [])].find(
    (e) => e.dataset.id === id,
  );
}
function scrollRow(row?: HTMLElement) {
  const container = tree.value;
  if (!container || !row || !props.embedded) return;
  const outer = container.getBoundingClientRect(),
    inner = row.getBoundingClientRect();
  if (inner.top < outer.top) container.scrollTop += inner.top - outer.top;
  else if (inner.bottom > outer.bottom) container.scrollTop += inner.bottom - outer.bottom;
}
async function revealSelected() {
  const ancestors = selectedPath.value.slice(0, -1).map((p) => p.id);
  closed.value = new Set([...closed.value].filter((id) => !ancestors.includes(id)));
  await nextTick();
  scrollRow(element(props.selected));
}
async function focus(id?: string) {
  await nextTick();
  if (id) {
    const row = element(id);
    if (props.embedded) row?.focus({ preventScroll: true });
    else row?.focus();
    scrollRow(row);
  }
}
function key(event: KeyboardEvent, id: string) {
  const at = visible.value.findIndex((e) => e.id === id),
    entry = visible.value[at];
  if (
    !entry ||
    !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'ArrowDown')
    void focus(visible.value[Math.min(at + 1, visible.value.length - 1)]?.id);
  if (event.key === 'ArrowUp') void focus(visible.value[Math.max(0, at - 1)]?.id);
  if (event.key === 'Home') void focus(visible.value[0]?.id);
  if (event.key === 'End') void focus(visible.value.at(-1)?.id);
  if (event.key === 'ArrowRight' && children(id).length) {
    if (closed.value.has(id)) toggle(id);
    else void focus(children(id)[0]?.id);
  }
  if (event.key === 'ArrowLeft') {
    if (children(id).length && !closed.value.has(id)) toggle(id);
    else if (entry.parentId && ids.value.has(entry.parentId)) void focus(entry.parentId);
  }
}
</script>
<template>
  <section
    class="panel policy-tree-panel"
    :class="{ 'policy-tree-embedded': embedded }"
    :aria-label="embedded ? treeLabel : undefined"
  >
    <div class="section-heading">
      <component :is="embedded ? 'h3' : 'h2'">{{
        embedded ? '소속 조직 선택' : '조직 선택'
      }}</component>
    </div>
    <button
      ref="toggleButton"
      v-if="!embedded"
      type="button"
      class="button secondary policy-tree-toggle"
      :aria-expanded="open"
      :aria-controls="browserId"
      @click="open = !open"
    >
      <span>{{ selectedName }}</span
      ><span>조직 선택 {{ open ? '접기' : '열기' }}</span>
    </button>
    <div v-show="browserVisible" :id="browserId" class="policy-tree-browser">
      <label v-if="searchable !== false" class="field"
        >조직 검색<input
          v-model="query"
          placeholder="조직 이름 또는 경로"
          :disabled="disabled"
          @keydown.enter="embedded && $event.preventDefault()"
      /></label>
      <div ref="tree" class="policy-org-list" role="tree" :aria-label="treeLabel">
        <div v-for="e in visible" :key="e.id" role="none" class="policy-tree-item">
          <button
            type="button"
            role="treeitem"
            class="policy-org-row"
            :data-id="e.id"
            :aria-level="e.level - baseLevel + 1"
            :aria-expanded="children(e.id).length ? !closed.has(e.id) || !!query : undefined"
            :aria-selected="selected === e.id"
            :aria-disabled="!canSelect(e.id) || undefined"
            :tabindex="
              selected === e.id ||
              (!visible.some((v) => v.id === selected) && visible[0]?.id === e.id)
                ? 0
                : -1
            "
            :aria-label="e.name"
            :title="e.path.map((p) => p.name).join(' › ')"
            :style="{ paddingLeft: `${8 + Math.min(e.level - baseLevel, 5) * 12}px` }"
            :disabled="disabled"
            @click="select(e.id)"
            @keydown="key($event, e.id)"
          >
            <span class="policy-tree-name"
              ><span
                v-if="children(e.id).length"
                aria-hidden="true"
                class="policy-tree-expander"
                @click.stop="toggle(e.id)"
                >{{ closed.has(e.id) && !query ? '▸' : '▾' }}</span
              ><span v-else aria-hidden="true" class="policy-tree-expander"></span
              ><span>{{ e.name }}</span></span
            >
            <slot name="status" :entry="e" />
          </button>
          <slot name="action" :entry="e" />
        </div>
        <p v-if="!visible.length" class="empty-state">검색에 맞는 관리 가능 조직이 없습니다.</p>
      </div>
    </div>
    <p v-if="embedded" class="organization-tree-selection" aria-live="polite">
      선택한 소속:
      {{
        selectedPath.length ? selectedPath.map((p) => p.name).join(' › ') : '조직을 선택해 주세요'
      }}
    </p>
  </section>
</template>

<style scoped>
.policy-tree-item {
  display: flex;
  align-items: center;
  min-width: 0;
}
.policy-org-row {
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}
.policy-tree-embedded.policy-tree-panel {
  position: static;
  padding: 12px;
  border: 1px solid var(--control-border);
  gap: 12px;
  min-width: 0;
}
.policy-tree-embedded .section-heading {
  margin: 0;
}
.policy-tree-embedded h3 {
  font-size: var(--text-body);
}
.policy-tree-embedded .policy-tree-browser {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.policy-tree-embedded .policy-org-list {
  max-height: min(320px, 35dvh);
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
}
.policy-tree-embedded .policy-org-row {
  min-height: 40px;
  overflow-wrap: anywhere;
}
.policy-tree-embedded .policy-org-row[aria-disabled='true'] {
  color: var(--ink-muted);
  cursor: default;
}
.organization-tree-selection {
  margin: 0;
  font-size: var(--text-caption);
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .policy-tree-embedded .policy-org-list {
    max-height: min(240px, 35dvh);
  }
  .policy-tree-embedded .policy-org-row {
    min-height: 44px;
  }
}
</style>
