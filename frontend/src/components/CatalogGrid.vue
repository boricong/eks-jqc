<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { columnsFor, type CatalogRow, type CatalogTable, type CatalogIssue } from '@eks/contracts';
import type { Tabulator, ColumnDefinition } from 'tabulator-tables';
import { clone, rowKey } from '../catalog-editor';
import 'tabulator-tables/dist/css/tabulator.min.css';
const props = defineProps<{
  rows: CatalogRow[];
  table: CatalogTable;
  courses: CatalogRow[];
  allCourses: boolean;
  target?: { key: string; column: string };
  canUndo: boolean;
  canRedo: boolean;
  disabled?: boolean;
  issues?: CatalogIssue[];
}>();
const emit = defineEmits<{
  change: [CatalogRow[]];
  add: [];
  duplicate: [string[]];
  remove: [string[]];
  detail: [string];
  undo: [];
  redo: [];
}>();
const host = ref<HTMLElement>(),
  selected = ref<string[]>([]);
let grid: Tabulator | undefined,
  alive = true;
const maps: Record<string, Record<string, string>> = {
  type: { mtc: 'MTC교육', team: '팀 특화 교육', ojt: '현업 OJT' },
  required: { true: '필수', false: '선택' },
};
const textNode = (value: unknown) => {
  const el = document.createElement('span');
  el.textContent = String(value ?? '');
  return el;
};
onMounted(async () => {
  const { TabulatorFull } = await import('tabulator-tables');
  if (!alive) return;
  const courseOptions = Object.fromEntries(
    props.courses.map((c, i) => [
      String(c.code),
      `${i + 1}. ${String(c.title || '이름 없는 인증Set')}`,
    ]),
  );
  const columns: ColumnDefinition[] = [
    {
      title: '선택',
      formatter: 'rowSelection',
      titleFormatter: 'rowSelection',
      hozAlign: 'center',
      width: 48,
      headerSort: false,
      frozen: true,
      cellClick: (_e, c) => c.getRow().toggleSelect(),
    },
  ];
  for (const [field, label] of columnsFor(props.table, props.rows).filter(
    ([k]) =>
      !['code', 'sourceId', 'sourceRevision'].includes(k) &&
      !(k === 'courseCode' && !props.allCourses),
  )) {
    const values =
      field === 'courseCode'
        ? courseOptions
        : field === 'type' && props.table === 'materials'
          ? { text: '직접 작성', edm: 'EDM Link', confluence: 'Confluence', url: '일반 URL' }
          : maps[field];
    columns.push({
      field,
      title: field === 'courseCode' ? '인증Set' : label,
      width:
        field === 'order'
          ? 65
          : ['title', 'prompt'].includes(field)
            ? 300
            : field === 'courseCode'
              ? 240
              : 160,
      minWidth: 65,
      frozen: field === 'order',
      headerSort: true,
      tooltip: true,
      visible:
        props.allCourses ||
        (!['scenario', 'content', 'url', 'description'].includes(field) &&
          !field.startsWith('choice')),
      editor:
        field === 'kinds'
          ? 'list'
          : values
            ? 'list'
            : field === 'order' ||
                ['points', 'correct', 'passScore', 'practicalPassScore'].includes(field)
              ? 'number'
              : 'input',
      editorParams:
        field === 'kinds'
          ? {
              values: { objective: '지식 평가', practical: '상황 대응 평가' },
              multiselect: true,
            }
          : values
            ? { values, listOnEmpty: true, autocomplete: field === 'courseCode' }
            : undefined,
      editable: () => !props.disabled,
      formatter: (cell) =>
        textNode(
          field === 'kinds'
            ? String(cell.getValue() || '')
                .split(',')
                .map((k) => ({ objective: '지식 평가', practical: '상황 대응 평가' })[k] || k)
                .join(' · ')
            : (values?.[String(cell.getValue())] ?? cell.getValue()),
        ),
      cellDblClick: (_e, cell) => {
        if (props.disabled) return;
        if (['prompt', 'scenario', 'content', 'description'].includes(field))
          emit('detail', rowKey(cell.getRow().getData()));
      },
    });
  }
  columns.push({
    title: '내용 편집',
    width: 96,
    headerSort: false,
    formatter: () => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'text-link catalog-detail-button';
      b.textContent = '상세 편집';
      b.disabled = !!props.disabled;
      return b;
    },
    cellClick: (_e, c) => {
      if (!props.disabled) emit('detail', rowKey(c.getRow().getData()));
    },
  });
  grid = new TabulatorFull(host.value!, {
    data: clone(props.rows),
    columns,
    index: '__row',
    height: 'min(52vh, 520px)',
    rowHeight: 40,
    layout: 'fitData',
    selectableRows: 'highlight',
    selectableRange: 1,
    selectableRangeColumns: true,
    selectableRangeRows: true,
    selectableRangeClearCells: true,
    clipboard: true,
    clipboardCopyRowRange: 'range',
    clipboardCopyConfig: { rowHeaders: false, columnHeaders: false },
    clipboardPasteParser: 'range',
    clipboardPasteAction: 'range',
    editTriggerEvent: 'dblclick',
    history: false,
    keybindings: { undo: false, redo: false },
    placeholder: '항목 추가로 시작하거나 Excel에서 복사한 내용을 붙여넣으세요.',
  });
  const changed = () => {
    if (!grid || props.disabled) return;
    const rows = clone(grid.getData()) as CatalogRow[];
    for (const r of rows) {
      if (Array.isArray(r.kinds)) r.kinds = (r.kinds as string[]).join(',');
      for (const k of ['required', 'mandatory'])
        if (r[k] === 'true' || r[k] === 'false') r[k] = r[k] === 'true';
    }
    emit('change', rows);
  };
  grid.on('cellEdited', changed);
  grid.on('clipboardPasted', changed);
  grid.on('rowSelectionChanged', (data) => (selected.value = data.map(rowKey)));
  grid.on('tableBuilt', focusTarget);
  grid.on('renderComplete', showErrors);
  grid.on('renderComplete', syncDetailButtons);
});
function syncDetailButtons() {
  host.value?.querySelectorAll<HTMLButtonElement>('.catalog-detail-button').forEach((button) => {
    button.disabled = !!props.disabled;
  });
}
watch(() => props.disabled, syncDetailButtons, { flush: 'post' });
function showErrors() {
  if (!grid || !host.value) return;
  host.value.querySelectorAll('[aria-invalid]').forEach((e) => {
    e.removeAttribute('aria-invalid');
    e.classList.remove('catalog-invalid-cell');
  });
  for (const issue of props.issues || []) {
    if (issue.table !== props.table) continue;
    const data = props.rows.find(
      (r) =>
        r.code === issue.rowCode &&
        (props.table === 'courses' || r.courseCode === issue.courseCode),
    );
    if (!data) continue;
    const row = grid.getRow(rowKey(data));
    if (!row) continue;
    const cell = row.getCell(issue.column);
    if (!cell) continue;
    const el = cell.getElement();
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('title', issue.message);
    el.classList.add('catalog-invalid-cell');
  }
}
watch(() => props.issues, showErrors, { deep: true });
function focusTarget() {
  if (!grid || !props.target) return;
  const row = grid.getRow(props.target.key);
  if (!row) return;
  void grid.scrollToRow(row, 'center', false);
  const cell = row.getCell(props.target.column);
  if (!cell) return;
  cell.getColumn().show();
  void grid.scrollToColumn(props.target.column, 'middle', false);
  const el = cell.getElement();
  el.tabIndex = 0;
  el.focus();
  el.classList.add('catalog-error-cell');
}
watch(() => props.target, focusTarget, { deep: true });
watch(
  () => props.rows,
  (rows) => {
    if (grid && JSON.stringify(rows) !== JSON.stringify(grid.getData())) {
      selected.value = [];
      void grid.replaceData(clone(rows));
    }
  },
  { deep: true },
);
function keydown(e: KeyboardEvent) {
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === 'z' &&
    !(e.target instanceof HTMLInputElement)
  ) {
    e.preventDefault();
    if (e.shiftKey) emit('redo');
    else emit('undo');
  }
}
function focusTableWithoutScrolling(event: MouseEvent) {
  const target = event.target;
  if (
    event.button !== 0 ||
    !(target instanceof HTMLElement) ||
    !target.closest('.tabulator-cell') ||
    target.closest('input, textarea, select, button, a')
  )
    return;
  // Range selection focuses the table holder. Focus it without browser page
  // scrolling first so the second click still lands on the same visible cell.
  // Keep native mousedown from focusing the cell in between range operations.
  event.preventDefault();
  host.value?.querySelector<HTMLElement>('.tabulator-tableholder')?.focus({ preventScroll: true });
}
onBeforeUnmount(() => {
  alive = false;
  grid?.destroy();
});
</script>
<template>
  <div class="catalog-grid-tools">
    <button class="button secondary small" :disabled="disabled" @click="emit('add')">
      항목 추가</button
    ><button
      class="button secondary small"
      :disabled="disabled || !selected.length"
      @click="emit('duplicate', selected)"
    >
      선택 항목 복제</button
    ><button
      class="button secondary small"
      :disabled="disabled || !selected.length"
      @click="emit('remove', selected)"
    >
      선택 항목 제외</button
    ><span role="status">{{ selected.length }}개 선택</span
    ><button class="button ghost small" :disabled="disabled || !canUndo" @click="emit('undo')">
      실행 취소</button
    ><button class="button ghost small" :disabled="disabled || !canRedo" @click="emit('redo')">
      다시 실행</button
    ><span class="muted">셀 두 번 클릭 · 범위 복사·붙여넣기</span>
  </div>
  <div
    ref="host"
    class="catalog-grid"
    aria-label="기준 셀 편집 표"
    @keydown.capture="keydown"
    @mousedown.capture="focusTableWithoutScrolling"
  />
</template>
