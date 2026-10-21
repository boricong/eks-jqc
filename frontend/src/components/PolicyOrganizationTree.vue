<script setup lang="ts">
import { computed, ref, nextTick } from 'vue';
import type { OrganizationPoliciesView } from '@eks/contracts';
const props = defineProps<{
  entries: OrganizationPoliciesView['entries'];
  selected: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const query = ref(''),
  closed = ref(new Set<string>()),
  tree = ref<HTMLElement>();
const ids = computed(() => new Set(props.entries.map((e) => e.id)));
const baseLevel = computed(() => Math.min(...props.entries.map((e) => e.level)));
const children = (id: string) => props.entries.filter((e) => e.parentId === id);
const visible = computed(() => {
  const term = query.value.trim().toLocaleLowerCase();
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
  const next = new Set(closed.value);
  next.has(id) ? next.delete(id) : next.add(id);
  closed.value = next;
}
async function focus(id?: string) {
  await nextTick();
  if (id)
    [...(tree.value?.querySelectorAll<HTMLElement>('[role=treeitem]') || [])]
      .find((e) => e.dataset.id === id)
      ?.focus();
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
  <section class="panel policy-tree-panel">
    <div class="section-heading">
      <h2>조직 선택</h2>
      <span class="muted">관리 가능한 조직 {{ entries.length }}개</span>
    </div>
    <label class="field"
      >조직 검색<input v-model="query" placeholder="조직 이름 또는 경로"
    /></label>
    <div ref="tree" class="policy-org-list" role="tree" aria-label="설정 가능한 조직">
      <button
        v-for="e in visible"
        :key="e.id"
        role="treeitem"
        class="policy-org-row"
        :data-id="e.id"
        :aria-level="e.level - baseLevel + 1"
        :aria-expanded="children(e.id).length ? !closed.has(e.id) || !!query : undefined"
        :aria-selected="selected === e.id"
        :tabindex="
          selected === e.id || (!visible.some((v) => v.id === selected) && visible[0]?.id === e.id)
            ? 0
            : -1
        "
        :title="e.path.map((p) => p.name).join(' › ')"
        :style="{ paddingLeft: `${12 + Math.min(e.level - baseLevel, 8) * 16}px` }"
        :disabled="disabled"
        @click="emit('select', e.id)"
        @keydown="key($event, e.id)"
      >
        <span class="policy-tree-name"
          ><span
            v-if="children(e.id).length"
            aria-hidden="true"
            class="policy-tree-expander"
            @click.stop="toggle(e.id)"
            >{{ closed.has(e.id) && !query ? '▸' : '▾' }}</span
          ><span v-else aria-hidden="true" class="policy-tree-expander">·</span
          ><span>Lv{{ e.level }} · {{ e.name }}</span></span
        >
        <small
          >{{ e.userCount }}명 직속 ·
          {{
            e.requiredQualifications === null
              ? '미설정'
              : e.requiredQualifications.length + '개 필수'
          }}</small
        >
      </button>
      <p v-if="!visible.length" class="empty-state">검색에 맞는 관리 가능 조직이 없습니다.</p>
    </div>
  </section>
</template>
