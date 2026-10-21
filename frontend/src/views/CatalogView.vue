<script setup lang="ts">
import { useProcessContext } from '../composables/useProcessContext';
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import {
  catalogTables,
  catalogLabels,
  qualificationUseErrors,
  courseUseErrors,
  type CatalogWorkbook,
  type CatalogSheet,
  type CatalogPreview,
  type CatalogIssue,
  type CatalogTable,
  type CatalogRow,
  type CatalogBatch,
  type Qualification,
} from '@eks/contracts';
import { api, mutate, downloadWorkbook, ApiError } from '../api';
import { useDemo } from '../stores/demo';
import {
  clone,
  decorate,
  clean,
  fingerprint,
  newSheet,
  newRow,
  rowKey,
  mergeVisible,
  duplicateRows,
} from '../catalog-editor';
import {
  saveRecovery,
  listRecovery,
  deleteRecovery,
  claimRecovery,
  releaseRecovery,
  type CatalogRecovery,
} from '../composables/catalogRecovery';
import CatalogGrid from '../components/CatalogGrid.vue';
import CatalogFields from '../components/CatalogFields.vue';
import CatalogQualificationFields from '../components/CatalogQualificationFields.vue';
import AppDialog from '../components/AppDialog.vue';
import '../catalog.css';

const store = useDemo();
const importProblems = ref<NonNullable<CatalogRecovery['importProblems']>>([]);
const workbook = ref<CatalogWorkbook | null>(null),
  preview = ref<CatalogPreview | null>(null),
  baselines = ref<Record<string, string>>({}),
  sheetIndex = ref(0),
  table = ref<CatalogTable>('courses'),
  courseCode = ref(''),
  allCourses = ref(false),
  metadataOpen = ref(false),
  search = ref(''),
  sheetSearch = ref(''),
  statusFilter = ref('all'),
  exportIds = ref<string[]>([]),
  selected = ref<string[]>([]),
  batches = ref<CatalogBatch[]>([]),
  busy = ref(false),
  error = ref(''),
  fileHash = ref(''),
  compareOpen = ref(false),
  reviewIntent = ref<'save' | 'publish'>('save'),
  checked = ref(''),
  validationPending = ref(false),
  recoveryStatus = ref(''),
  recoveries = ref<CatalogRecovery[]>([]),
  importName = ref('');
const target = ref<{ key: string; column: string }>(),
  detail = ref<{ sheetCode: string; table: CatalogTable; row: CatalogRow } | null>(null),
  removeRequest = ref<{ table: CatalogTable; keys: string[]; childCount: number } | null>(null);
const undo = ref<string[]>([]),
  redo = ref<string[]>([]);
let epoch = 0,
  validationSequence = 0,
  localTimer: ReturnType<typeof setTimeout> | undefined,
  validationTimer: ReturnType<typeof setTimeout> | undefined;
let workId: string = crypto.randomUUID(),
  owner = { actorId: '', lv1: '' },
  pending: CatalogRecovery['pending'];
const sheet = computed(() => workbook.value?.sheets[sheetIndex.value]);
useProcessContext(() => (workbook.value ? 'catalog-editing' : 'catalog-list'));
const course = computed(() => sheet.value?.tables.courses.find((c) => c.code === courseCode.value));
const rows = computed(() => sheet.value?.tables[table.value] || []);
const visibleRows = computed(() =>
  allCourses.value
    ? rows.value
    : rows.value.filter(
        (r) => (table.value === 'courses' ? r.code : r.courseCode) === courseCode.value,
      ),
);
const modified = (s: CatalogSheet) => baselines.value[s.code] !== fingerprint(s);
const dirty = computed(
  () => workbook.value?.sheets.some(modified) || false || importProblems.value.length > 0,
);
const selectedSheets = computed(
  () => workbook.value?.sheets.filter((s) => selected.value.includes(s.code)) || [],
);
const selectedIssues = computed(
  () => preview.value?.issues.filter((i) => selected.value.includes(i.code)) || [],
);
const currentIssues = computed(
  () => preview.value?.issues.filter((i) => i.code === sheet.value?.code) || [],
);
const selectedDirty = computed(() => selectedSheets.value.some(modified));
const selectedDraftIds = computed(() =>
  selectedSheets.value.map((s) => s.sourceId).filter((v): v is string => !!v),
);
const latestBatch = computed(() =>
  batches.value.find(
    (b) =>
      selectedDraftIds.value.length === selectedSheets.value.length &&
      selectedDraftIds.value.length > 0 &&
      selectedDraftIds.value.every(
        (id) =>
          b.qualificationIds.includes(id) &&
          !b.publishedQualificationIds?.includes(id) &&
          store.data.qualifications.find((q) => q.id === id)?.status === 'draft' &&
          store.data.qualifications.find((q) => q.id === id)?.revision === b.revisions[id],
      ),
  ),
);
const eligible = computed(() =>
  store.data.qualifications.filter(
    (q) =>
      !store.data.qualifications.some((o) => o.entityId === q.entityId && o.version > q.version),
  ),
);
function readiness(q: Qualification) {
  return [
    ...qualificationUseErrors(q, store.data.courses),
    ...q.courseIds.flatMap((id) => {
      const c = store.data.courses.find((c) => c.id === id);
      return c ? courseUseErrors(c) : ['연결 과정 확인'];
    }),
  ];
}
const qualifications = computed(() =>
  eligible.value.filter(
    (q) =>
      (q.title || '이름 없는 자격').toLowerCase().includes(search.value.toLowerCase()) &&
      (statusFilter.value === 'all' ||
        (statusFilter.value === 'needs' && readiness(q).length > 0) ||
        q.status === statusFilter.value),
  ),
);
const selectedChanges = computed(
  () => preview.value?.changes.filter((c) => selected.value.includes(c.code)) || [],
);
const viewSignature = () => (workbook.value ? JSON.stringify(clean(workbook.value)) : '');
const validated = computed(
  () => !!checked.value && checked.value === viewSignature() && !validationPending.value,
);
const canSave = computed(
  () =>
    selectedSheets.value.length > 0 &&
    validated.value &&
    !selectedIssues.value.some((i) => i.severity === 'structure'),
);
const canPublish = computed(
  () =>
    canSave.value && !selectedDirty.value && !selectedIssues.value.length && !!latestBatch.value,
);
const scopePath = (p: string) => store.managementPath(p);
function issueValue(i: CatalogIssue) {
  const s = workbook.value?.sheets.find((s) => s.code === i.code);
  if (!s) return '__removed';
  if (i.table === 'metadata')
    return JSON.stringify((s as unknown as Record<string, unknown>)[i.column]);
  const r = i.rowCode
    ? s.tables[i.table].find(
        (r) =>
          r.code === i.rowCode &&
          (!i.courseCode || i.table === 'courses' || r.courseCode === i.courseCode),
      )
    : s.tables[i.table][i.row - 1];
  return r ? JSON.stringify(r[i.column] ?? '') : '__removed';
}
function checkpoint() {
  if (!workbook.value) return;
  const s = JSON.stringify(workbook.value);
  if (undo.value.at(-1) !== s) undo.value.push(s);
  if (undo.value.length > 30) undo.value.shift();
  redo.value = [];
}
function restore(forward = false) {
  const from = forward ? redo : undo,
    to = forward ? undo : redo,
    s = from.value.pop();
  if (!s || !workbook.value) return;
  to.value.push(JSON.stringify(workbook.value));
  workbook.value = JSON.parse(s);
  ensureSelection();
  changed();
}
function ensureSelection() {
  sheetIndex.value = Math.min(sheetIndex.value, (workbook.value?.sheets.length || 1) - 1);
  if (!course.value) courseCode.value = String(sheet.value?.tables.courses[0]?.code || '');
}
function localSnapshot(): CatalogRecovery | undefined {
  if (!workbook.value || !owner.actorId) return;
  return {
    id: workId,
    ...owner,
    updatedAt: new Date().toISOString(),
    workbook: clone(workbook.value),
    baselines: clone(baselines.value),
    fileHash: fileHash.value,
    sheetIndex: sheetIndex.value,
    courseCode: courseCode.value,
    pending: pending ? clone(pending) : undefined,
    importProblems: clone(importProblems.value),
  };
}
async function retain() {
  clearTimeout(localTimer);
  const record = localSnapshot();
  if (!record) return;
  const token = epoch;
  try {
    if (!dirty.value && !pending) {
      await deleteRecovery(workId);
      if (token === epoch) recoveryStatus.value = '서버 초안 저장됨';
    } else {
      await saveRecovery(record);
      if (token === epoch) recoveryStatus.value = '이 브라우저에 보관됨';
    }
  } catch {
    if (token === epoch)
      recoveryStatus.value = '브라우저에 보관하지 못했습니다. 작업 파일을 다운로드해 주세요.';
  }
}
function changed() {
  checked.value = '';
  if (!workbook.value) return;
  recoveryStatus.value = '브라우저 보관 대기';
  clearTimeout(localTimer);
  localTimer = setTimeout(() => void retain(), 500);
  clearTimeout(validationTimer);
  validationTimer = setTimeout(() => void inspect().catch(() => {}), 800);
}
async function inspect() {
  if (!workbook.value || !store.managementReady) return;
  const token = epoch,
    sequence = ++validationSequence,
    signature = viewSignature(),
    path = scopePath('/catalog/batches/validate');
  validationPending.value = true;
  try {
    const p = await api<CatalogPreview>(path, {
      method: 'POST',
      body: JSON.stringify({ workbook: clean(workbook.value) }),
    });
    if (token !== epoch || sequence !== validationSequence || signature !== viewSignature()) return;
    importProblems.value = importProblems.value.filter((i) => issueValue(i) === i.originalValue);
    preview.value = { ...p, issues: [...importProblems.value, ...p.issues] };
    checked.value = signature;
  } catch (e) {
    if (token === epoch && sequence === validationSequence) error.value = (e as Error).message;
    throw e;
  } finally {
    if (token === epoch && sequence === validationSequence) validationPending.value = false;
  }
}
async function run(fn: (token: number) => Promise<void>) {
  if (busy.value) return;
  const token = epoch;
  busy.value = true;
  error.value = '';
  try {
    await fn(token);
  } catch (e) {
    if (token === epoch) error.value = (e as Error).message;
  } finally {
    if (token === epoch) busy.value = false;
  }
}
async function loadBatches(token = epoch) {
  if (!store.managementReady) return;
  const result = await api<CatalogBatch[]>(scopePath('/catalog/batches'));
  if (token === epoch) batches.value = result;
}
function startWork(w: CatalogWorkbook, imported = false, p?: CatalogPreview) {
  releaseRecovery(workId);
  workbook.value = decorate(clone(w));
  owner = { actorId: store.actorId, lv1: store.managementLv1 };
  workId = crypto.randomUUID();
  void claimRecovery(workId);
  if (!imported) {
    importName.value = '';
    fileHash.value = '';
  }
  baselines.value = {};
  for (const s of workbook.value.sheets) {
    const changed = p?.changes.find((c) => c.code === s.code)?.kind !== 'unchanged';
    baselines.value[s.code] = imported && changed ? '' : fingerprint(s);
  }
  preview.value = p || null;
  importProblems.value = imported
    ? p?.issues
        .filter((i) => i.cell && /수식|입력하지 않음|미사용 열|평가 사용 여부/.test(i.message))
        .map((i) => ({ ...i, originalValue: issueValue(i) })) || []
    : [];
  sheetIndex.value = 0;
  courseCode.value = String(sheet.value?.tables.courses[0]?.code || '');
  allCourses.value = false;
  table.value = 'courses';
  metadataOpen.value = !sheet.value?.title;
  undo.value = [];
  redo.value = [];
  checked.value = p ? viewSignature() : '';
  pending = undefined;
}
// Route and account switches preserve browser recovery, but never silently discard an unprotected edit.
async function leave() {
  if (busy.value) return false;
  if (!dirty.value && !pending) return true;
  await retain();
  return window.confirm(
    '서버에 저장하지 않은 입력이 있습니다. 브라우저 보관 상태를 확인하고 이동하시겠습니까?',
  );
}
onBeforeRouteLeave(leave);
onBeforeRouteUpdate(leave);
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value || pending) {
    void retain();
    e.preventDefault();
    e.returnValue = '';
  }
}
async function initialize() {
  const token = epoch;
  if (!store.managementReady) return;
  try {
    await loadBatches(token);
    const list = await listRecovery(store.actorId, store.managementLv1);
    if (token === epoch) recoveries.value = list;
  } catch {
    if (token === epoch) recoveryStatus.value = '브라우저 자동 보관을 사용할 수 없습니다.';
  }
}
watch(
  () => `${store.actorId}/${store.managementLv1}/${store.managementAccess}`,
  () => {
    void retain();
    releaseRecovery(workId);
    epoch++;
    clearTimeout(localTimer);
    clearTimeout(validationTimer);
    validationSequence++;
    workbook.value = null;
    preview.value = null;
    baselines.value = {};
    checked.value = '';
    validationPending.value = false;
    busy.value = false;
    compareOpen.value = false;
    detail.value = null;
    removeRequest.value = null;
    importName.value = '';
    recoveries.value = [];
    batches.value = [];
    exportIds.value = [];
    pending = undefined;
    importProblems.value = [];
    owner = { actorId: '', lv1: '' };
    void initialize();
  },
);
watch(
  () => store.managementReady,
  (ready) => {
    if (ready) void initialize();
  },
);
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload);
  void initialize();
});
onBeforeUnmount(() => {
  void retain();
  releaseRecovery(workId);
  epoch++;
  clearTimeout(validationTimer);
  window.removeEventListener('beforeunload', beforeUnload);
});
function downloadRecovery(record: CatalogRecovery) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'eks-legacy-work.json';
  a.click();
  URL.revokeObjectURL(url);
}
async function recover(record: CatalogRecovery) {
  if (record.workbook.format !== 'eks-catalog-v3') {
    error.value =
      '구형 작성 내용입니다. 원본 보관 파일을 다운로드하고 새 양식 v3에서 기준을 작성해 주세요. 구형 내용은 삭제하지 않았습니다.';
    return;
  }

  await run(async (token) => {
    await store.refresh();
    if (token !== epoch || !store.managementReady) return;
    const p = await api<CatalogPreview>(scopePath('/catalog/batches/validate'), {
      method: 'POST',
      body: JSON.stringify({ workbook: clean(record.workbook) }),
    });
    if (token !== epoch) return;
    startWork(record.workbook);
    if (await claimRecovery(record.id)) {
      releaseRecovery(workId);
      workId = record.id;
    }
    if (token !== epoch) {
      releaseRecovery(workId);
      return;
    }
    baselines.value = clone(record.baselines);
    fileHash.value = record.fileHash;
    pending = record.pending;
    importProblems.value = record.importProblems || [];
    sheetIndex.value = record.sheetIndex;
    courseCode.value = record.courseCode;
    ensureSelection();
    preview.value = { ...p, issues: [...importProblems.value, ...p.issues] };
    checked.value = viewSignature();
    await retain();
    if (!recoveryStatus.value.includes('못했')) {
      recoveries.value = recoveries.value.filter((r) => r.id !== record.id);
    }
    if (p.issues.some((i) => i.severity === 'structure'))
      error.value =
        '원본 변경 또는 연결 확인이 필요합니다. 작성 내용을 유지했습니다. 오류 위치를 확인하거나 작업 파일을 보관하세요.';
  });
}
async function discardRecovery(id: string) {
  await run(async () => {
    if (navigator.locks && !(await claimRecovery(id)))
      throw new Error('다른 탭에서 작성 중인 작업입니다. 해당 탭에서 종료한 뒤 폐기해 주세요.');
    await deleteRecovery(id);
    releaseRecovery(id);
    recoveries.value = recoveries.value.filter((r) => r.id !== id);
  });
}
async function openExisting(ids: string[]) {
  if (!ids.length) return;
  await run(async (token) => {
    const p = await api<CatalogPreview>(scopePath('/catalog/workbook-export'), {
      method: 'POST',
      body: JSON.stringify({ qualificationIds: ids, view: 'table' }),
    });
    if (token !== epoch) return;
    if (!workbook.value) startWork(p.workbook, false, p);
    else
      for (const s of decorate(p.workbook).sheets) {
        const existing = workbook.value.sheets.findIndex((v) => v.sourceId === s.sourceId);
        if (existing >= 0) {
          sheetIndex.value = existing;
          continue;
        }
        if (workbook.value.sheets.length >= 100)
          throw new Error('한 작업은 자격 100개까지 편집할 수 있습니다.');
        workbook.value.sheets.push(s);
        baselines.value[s.code] = fingerprint(s);
        sheetIndex.value = workbook.value.sheets.length - 1;
      }
    ensureSelection();
    exportIds.value = [];
    await inspect();
  });
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 10 * 1024 * 1024) {
    error.value = '10MB 이하 .xlsx 파일을 선택해 주세요.';
    input.value = '';
    return;
  }
  await run(async (token) => {
    if (
      (dirty.value || pending) &&
      !window.confirm('현재 입력은 브라우저에 보관하고 새 파일을 열까요?')
    )
      return;
    await retain();
    const p = await api<CatalogPreview>(scopePath('/catalog/workbook-preview'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: await file.arrayBuffer(),
    });
    if (token !== epoch) return;
    startWork(p.workbook, true, p);
    fileHash.value = p.fileHash || '';
    importName.value = file.name;
    await retain();
  });
  input.value = '';
}
function addSheet(copy = false) {
  if (busy.value) return;
  checkpoint();
  const s = copy && sheet.value ? clone(sheet.value) : newSheet();
  if (copy) {
    s.mode = 'new';
    s.code = crypto.randomUUID();
    delete s.sourceId;
    delete s.sourceRevision;
    s.title = `${s.title || '자격'} 사본`;
    const old = clone(s.tables);
    s.tables = { courses: [], learning: [], objective: [], materials: [], practical: [] };
    for (const c of old.courses) {
      const next = {
        ...c,
        code: crypto.randomUUID(),
        __row: crypto.randomUUID(),
        sourceId: '',
        sourceRevision: null,
      };
      s.tables.courses.push(next);
      for (const t of catalogTables.filter((t) => t !== 'courses'))
        s.tables[t].push(
          ...old[t]
            .filter((r) => r.courseCode === c.code)
            .map((r) => ({
              ...r,
              code: crypto.randomUUID(),
              __row: crypto.randomUUID(),
              courseCode: next.code,
            })),
        );
    }
  }
  if (!workbook.value)
    startWork({ format: 'eks-catalog-v3', lv1OrganizationId: store.managementLv1, sheets: [] });
  if (workbook.value!.sheets.length >= 100) {
    error.value = '한 작업은 자격 100개까지 편집할 수 있습니다.';
    return;
  }
  workbook.value!.sheets.push(s);
  sheetIndex.value = workbook.value!.sheets.length - 1;
  baselines.value[s.code] = '';
  metadataOpen.value = true;
  courseCode.value = String(s.tables.courses[0]?.code || '');
  table.value = 'courses';
  allCourses.value = false;
  changed();
}
function chooseSheet(index: number) {
  sheetIndex.value = index;
  courseCode.value = String(sheet.value?.tables.courses[0]?.code || '');
  table.value = 'courses';
  target.value = undefined;
  metadataOpen.value = false;
}
function addItem(t = table.value) {
  if (!sheet.value) return;
  if (t !== 'courses' && !courseCode.value) {
    error.value = '먼저 연결할 과정을 선택해 주세요.';
    return;
  }
  checkpoint();
  const r = newRow(t, sheet.value.tables[t], courseCode.value);
  sheet.value.tables[t].push(r);
  if (t === 'courses') {
    courseCode.value = String(r.code);
    table.value = 'courses';
    allCourses.value = false;
  } else detail.value = { sheetCode: sheet.value.code, table: t, row: clone(r) };
  changed();
}
function editRows(next: CatalogRow[]) {
  if (!sheet.value) return;
  checkpoint();
  sheet.value.tables[table.value] = mergeVisible(rows.value, visibleRows.value, next);
  changed();
  target.value = undefined;
}
function duplicate(keys: string[]) {
  if (!sheet.value) return;
  checkpoint();
  duplicateRows(sheet.value, table.value, keys);
  changed();
}
function requestRemove(keys: string[]) {
  if (!sheet.value || !keys.length) return;
  const codes = sheet.value.tables[table.value]
    .filter((r) => keys.includes(rowKey(r)))
    .map((r) => r.code);
  const childCount =
    table.value === 'courses'
      ? catalogTables
          .filter((t) => t !== 'courses')
          .reduce(
            (n, t) => n + sheet.value!.tables[t].filter((r) => codes.includes(r.courseCode)).length,
            0,
          )
      : 0;
  removeRequest.value = { table: table.value, keys, childCount };
}
function removeConfirmed() {
  if (!sheet.value || !removeRequest.value) return;
  checkpoint();
  const { table: t, keys } = removeRequest.value,
    codes = sheet.value.tables[t].filter((r) => keys.includes(rowKey(r))).map((r) => r.code);
  sheet.value.tables[t] = sheet.value.tables[t].filter((r) => !keys.includes(rowKey(r)));
  if (t === 'courses')
    for (const child of catalogTables.filter((t) => t !== 'courses'))
      sheet.value.tables[child] = sheet.value.tables[child].filter(
        (r) => !codes.includes(r.courseCode),
      );
  removeRequest.value = null;
  ensureSelection();
  changed();
}
function openDetail(key: string) {
  const r = rows.value.find((r) => rowKey(r) === key);
  if (r && sheet.value)
    detail.value = { sheetCode: sheet.value.code, table: table.value, row: clone(r) };
}
function saveDetail() {
  if (!detail.value || !workbook.value) return;
  const d = detail.value,
    s = workbook.value.sheets.find((s) => s.code === d.sheetCode);
  if (!s) return;
  checkpoint();
  s.tables[d.table] = s.tables[d.table].map((r) =>
    rowKey(r) === rowKey(d.row) ? clone(d.row) : r,
  );
  detail.value = null;
  changed();
}
async function jump(i: CatalogIssue) {
  if (!workbook.value) return;
  const si = workbook.value.sheets.findIndex((s) => s.code === i.code);
  if (si < 0) return;
  sheetIndex.value = si;
  compareOpen.value = false;
  table.value = i.table === 'metadata' ? 'courses' : i.table;
  target.value = undefined;
  if (i.table === 'metadata') {
    metadataOpen.value = true;
    await nextTick();
    document
      .querySelector<HTMLElement>(`.catalog-qualification-fields [data-field="${i.column}"]`)
      ?.focus();
    return;
  }
  const r =
    sheet.value!.tables[i.table].find(
      (r) =>
        r.code === i.rowCode &&
        (!i.courseCode || i.table === 'courses' || r.courseCode === i.courseCode),
    ) || sheet.value!.tables[i.table][i.row - 1];
  if (!r) return;
  courseCode.value = String(i.table === 'courses' ? r.code : r.courseCode || '');
  allCourses.value = !courseCode.value;
  await nextTick();
  if (i.table === 'courses' && !allCourses.value) {
    document
      .querySelector<HTMLElement>(`.catalog-course-fields [data-field="${i.column}"]`)
      ?.focus();
  } else target.value = { key: rowKey(r), column: i.column };
}
async function review(intent: 'save' | 'publish') {
  await run(async () => {
    clearTimeout(validationTimer);
    await inspect();
    selected.value = (
      workbook.value?.sheets.filter(
        (s) =>
          modified(s) ||
          store.data.qualifications.find((q) => q.id === s.sourceId)?.status === 'draft',
      ) || []
    ).map((s) => s.code);
    reviewIntent.value = intent;
    compareOpen.value = true;
  });
}
function applySaved(w: CatalogWorkbook) {
  if (!workbook.value) return;
  for (const s of decorate(w).sheets) {
    const index = workbook.value.sheets.findIndex((q) => q.code === s.code);
    if (index < 0) continue;
    const old = workbook.value.sheets[index]!;
    for (const t of catalogTables)
      for (const r of s.tables[t])
        r.__row =
          old.tables[t].find(
            (v) => v.code === r.code && (t === 'courses' || v.courseCode === r.courseCode),
          )?.__row || r.__row!;
    workbook.value.sheets[index] = s;
    baselines.value[s.code] = fingerprint(s);
  }
  undo.value = [];
  redo.value = [];
  ensureSelection();
}
async function commit(path: string, body: unknown, token: number) {
  const signature = JSON.stringify({ path, body });
  if (pending && JSON.stringify({ path: pending.path, body: pending.body }) !== signature)
    throw new Error(
      '응답을 확인하지 못한 저장이 있습니다. 먼저 저장 결과 확인·재시도를 실행해 주세요.',
    );
  pending ||= { key: crypto.randomUUID(), path, body: clone(body) };
  await retain();
  store.writing++;
  try {
    const result = await mutate<{ workbook: CatalogWorkbook; id: string; unchanged?: boolean }>(
      path,
      body,
      'POST',
      '',
      pending.key,
    );
    if (token !== epoch) return;
    applySaved(result.workbook);
    pending = undefined;
    await retain();
    await store.refresh();
    if (token !== epoch) return;
    await loadBatches(token);
    await inspect();
    store.notify(
      result.unchanged
        ? '변경된 기준이 없습니다.'
        : reviewIntent.value === 'publish' && path.endsWith('/publish')
          ? '선택한 자격과 과정을 사용 등록했습니다.'
          : '선택한 기준을 초안으로 저장했습니다.',
    );
  } catch (e) {
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
      pending = undefined;
      await retain();
    }
    throw e;
  } finally {
    store.writing--;
  }
}
async function save() {
  if (!canSave.value) return;
  await run(async (token) => {
    await commit(
      scopePath('/catalog/batches'),
      {
        workbook: clean({ ...workbook.value!, sheets: selectedSheets.value }),
        fileHash: fileHash.value,
      },
      token,
    );
  });
}
async function publish() {
  if (!canPublish.value) return;
  await run(async (token) => {
    await commit(
      scopePath(`/catalog/batches/${latestBatch.value!.id}/publish`),
      { qualificationIds: selectedDraftIds.value },
      token,
    );
    if (token === epoch) compareOpen.value = false;
  });
}
async function retryPending() {
  if (!pending) return;
  const p = clone(pending);
  await run(async (token) => {
    await commit(p.path, p.body, token);
  });
}
async function downloadWork() {
  await run(async () => {
    if (workbook.value)
      await downloadWorkbook(scopePath('/catalog/workbook-export'), {
        workbook: clean(workbook.value),
        review: true,
      });
  });
}
async function backToList() {
  if (!(await leave())) return;
  releaseRecovery(workId);
  workbook.value = null;
  preview.value = null;
  compareOpen.value = false;
  await initialize();
}
</script>
<template>
  <div class="catalog-page" :class="{ 'has-catalog-draft': workbook && sheet }">
    <div class="page-heading">
      <div>
        <span class="eyebrow">인증 업무 관리</span>
        <h1>기준 일괄 관리</h1>
        <p class="muted">자격과 과정을 선택하고 학습·평가 내용을 작성하세요.</p>
      </div>
      <RouterLink :to="store.managementLink('/admin/qualifications')" class="button secondary"
        >개별 기준 관리</RouterLink
      >
    </div>
    <template v-if="store.managementReady">
      <div class="panel catalog-top-actions">
        <button class="button primary" :disabled="busy" @click="addSheet()">새 자격 만들기</button
        ><label class="button secondary upload-button"
          >Excel 가져오기<input
            aria-label="Excel 가져오기"
            type="file"
            accept=".xlsx"
            :disabled="busy"
            @change="upload"
        /></label>
        <details class="catalog-excel-menu">
          <summary>Excel 작업</summary>
          <div>
            <button
              class="button ghost small"
              :disabled="busy"
              @click="
                run(async () => {
                  await downloadWorkbook(scopePath('/catalog/workbook-template'));
                })
              "
            >
              양식 다운로드</button
            ><button
              v-if="!workbook"
              class="button ghost small"
              :disabled="busy || !exportIds.length"
              @click="
                run(async () => {
                  await downloadWorkbook(scopePath('/catalog/workbook-export'), {
                    qualificationIds: exportIds,
                  });
                })
              "
            >
              선택 자격 내보내기</button
            ><button v-else class="button ghost small" :disabled="busy" @click="downloadWork">
              작업 파일 다운로드
            </button>
          </div>
        </details>
        <button v-if="workbook" class="button ghost small" :disabled="busy" @click="backToList">
          자격 목록
        </button>
      </div>
      <p v-if="error" role="alert" class="error-message">{{ error }}</p>
      <p v-if="busy" role="status">처리 중입니다. 입력을 유지하고 있습니다…</p>
      <section v-if="!workbook && recoveries.length" class="panel catalog-recovery">
        <h2>이어서 작성할 작업</h2>
        <button
          v-for="r in recoveries.filter((v) => v.workbook.format !== 'eks-catalog-v3')"
          :key="r.id + '-download'"
          class="button secondary"
          @click="downloadRecovery(r)"
        >
          구형 작성 내용 보관 · {{ r.updatedAt }}
        </button>
        <div v-for="r in recoveries" :key="r.id" class="simple-row">
          <span
            ><strong>{{
              r.workbook.sheets.map((s) => s.title || '이름 없는 자격').join(' · ')
            }}</strong
            ><small
              >{{ new Date(r.updatedAt).toLocaleString('ko-KR') }} · 이 브라우저에 보관</small
            ></span
          ><button class="button secondary small" :disabled="busy" @click="recover(r)">
            이어서 작성</button
          ><button class="button ghost small" :disabled="busy" @click="discardRecovery(r.id)">
            보관 내용 폐기
          </button>
        </div>
      </section>
      <section v-if="!workbook" class="panel catalog-start">
        <div class="catalog-list-toolbar">
          <label class="field">자격 검색<input v-model="search" placeholder="자격명 검색" /></label
          ><label class="field"
            >상태<select v-model="statusFilter">
              <option value="all">전체</option>
              <option value="draft">작성 중</option>
              <option value="published">사용 중</option>
              <option value="needs">보완 필요</option>
            </select></label
          ><button
            class="button secondary"
            :disabled="busy || !exportIds.length"
            @click="openExisting(exportIds)"
          >
            선택 자격 편집 ({{ exportIds.length }})
          </button>
        </div>
        <div class="catalog-list-scroll">
          <table class="catalog-start-table">
            <thead>
              <tr>
                <th>선택</th>
                <th>자격</th>
                <th>과정</th>
                <th>준비 상태</th>
                <th>다음 행동</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="q in qualifications"
                :key="q.id"
                :data-testid="`catalog-qualification-${q.id}`"
              >
                <td>
                  <input
                    v-model="exportIds"
                    type="checkbox"
                    :value="q.id"
                    :aria-label="`${q.title || '이름 없는 자격'} 선택`"
                  />
                </td>
                <td>
                  <strong>{{ q.title || '이름 없는 자격' }}</strong
                  ><small
                    >v{{ q.version }} · {{ q.status === 'draft' ? '작성 중' : '사용 중' }}</small
                  >
                </td>
                <td>{{ q.courseIds.length }}개</td>
                <td>
                  <span class="badge" :class="readiness(q).length ? 'warning' : 'success'">{{
                    readiness(q).length
                      ? `보완 필요 ${readiness(q).length}개`
                      : q.status === 'draft'
                        ? '사용 등록 가능'
                        : '사용 중'
                  }}</span>
                </td>
                <td>
                  <button
                    class="button secondary small"
                    :disabled="busy"
                    @click="openExisting([q.id])"
                  >
                    {{ q.status === 'draft' ? '이어서 편집' : '내용 수정' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!qualifications.length" class="empty-state">
            표시할 자격이 없습니다. 새 자격을 만들거나 Excel을 가져오세요.
          </p>
        </div>
      </section>
      <template v-if="workbook && sheet">
        <div v-if="importName" class="catalog-import-summary" role="status">
          <strong>{{ importName }}</strong> · 자격 {{ workbook.sheets.length }}개 · 과정
          {{ workbook.sheets.reduce((n, s) => n + s.tables.courses.length, 0) }}개 · 평가
          {{
            workbook.sheets.reduce(
              (n, s) => n + s.tables.objective.length + s.tables.practical.length,
              0,
            )
          }}개 <span>내용 확인 → 적용 대상 확인 → 초안 저장</span>
        </div>
        <div class="catalog-workspace">
          <aside class="panel catalog-navigation">
            <label class="field"
              >편집 중 자격 검색<input v-model="sheetSearch" placeholder="자격명"
            /></label>
            <div
              v-for="(s, index) in workbook.sheets"
              :key="s.code"
              v-show="(s.title || '이름 없는 자격').includes(sheetSearch)"
              class="catalog-tree-qualification"
            >
              <button
                class="catalog-nav-item"
                :class="{ active: index === sheetIndex }"
                :disabled="busy"
                @click="chooseSheet(index)"
              >
                <strong>{{ s.title || '이름 없는 자격' }}</strong
                ><small
                  >{{
                    modified(s)
                      ? '저장 전 수정'
                      : store.data.qualifications.find((q) => q.id === s.sourceId)?.status ===
                          'draft'
                        ? '초안 저장됨'
                        : '사용 중'
                  }}
                  · {{ s.tables.courses.length }}과정</small
                >
              </button>
              <div v-if="index === sheetIndex" class="catalog-course-tree">
                <button
                  v-for="(c, ci) in s.tables.courses"
                  :key="rowKey(c)"
                  :class="{ active: c.code === courseCode && !allCourses }"
                  :disabled="busy"
                  @click="
                    courseCode = String(c.code);
                    allCourses = false;
                    target = undefined;
                  "
                >
                  <span>{{ ci + 1 }}</span
                  >{{ c.title || '이름 없는 과정' }}</button
                ><button class="text-link" :disabled="busy" @click="addItem('courses')">
                  + 과정 추가
                </button>
              </div>
            </div>
          </aside>
          <section class="panel catalog-editor">
            <div class="section-heading">
              <div>
                <h2>{{ sheet.title || '이름 없는 자격' }}</h2>
                <p class="muted">
                  {{
                    sheet.mode === 'new'
                      ? '새 자격 작성'
                      : store.data.qualifications.find((q) => q.id === sheet?.sourceId)?.status ===
                          'published'
                        ? '변경 내용을 저장하면 새 버전으로 작성합니다.'
                        : '저장한 초안을 이어서 작성합니다.'
                  }}
                </p>
              </div>
              <button
                class="button secondary small"
                :disabled="busy"
                @click="metadataOpen = !metadataOpen"
              >
                기본정보 수정
              </button>
            </div>
            <CatalogQualificationFields
              v-if="metadataOpen"
              :sheet="sheet"
              :issues="currentIssues.filter((i) => i.table === 'metadata')"
              :disabled="busy"
              @checkpoint="checkpoint"
              @change="changed"
            />
            <div class="catalog-summary-line">
              <span
                >인증기간:
                {{
                  sheet.validityType === 'months'
                    ? `취득 후 ${sheet.months ?? '?'}개월`
                    : sheet.validityType === 'unlimited'
                      ? '무기한'
                      : '설정 필요'
                }}</span
              ><button class="text-link" :disabled="busy" @click="addSheet(true)">
                독립 사본 만들기
              </button>
              <details>
                <summary>연결 정보</summary>
                <p>
                  자격 연결: {{ sheet.code }}<br />원본: {{ sheet.sourceId || '새 자격' }} ·
                  revision {{ sheet.sourceRevision || '—' }}
                </p>
              </details>
            </div>
            <div class="catalog-editor-toolbar">
              <h3>{{ allCourses ? '전체 과정 표' : course?.title || '과정을 추가하세요' }}</h3>
              <button
                class="button secondary small"
                :disabled="busy"
                @click="
                  allCourses = !allCourses;
                  target = undefined;
                "
              >
                {{ allCourses ? '과정별 편집' : '전체 과정 표 보기' }}
              </button>
            </div>
            <div class="bulk-tabs" role="tablist" aria-label="과정 편집">
              <button
                v-for="t in catalogTables"
                :key="t"
                role="tab"
                :aria-selected="table === t"
                :class="{ active: table === t }"
                @click="
                  table = t;
                  target = undefined;
                "
              >
                {{ t === 'courses' && !allCourses ? '과정 정보' : catalogLabels[t] }}
                <small>{{
                  allCourses
                    ? sheet.tables[t].length
                    : t === 'courses'
                      ? 1
                      : sheet.tables[t].filter((r) => r.courseCode === courseCode).length
                }}</small>
              </button>
            </div>
            <div
              v-if="currentIssues.length || validationPending || !validated"
              class="catalog-validation-status"
              role="status"
            >
              <span>{{
                validationPending
                  ? '입력 내용 확인 중'
                  : !validated
                    ? '입력 변경됨 · 검사 대기'
                    : `이 자격에서 확인할 항목 ${currentIssues.length}개`
              }}</span
              ><button
                v-if="currentIssues.length"
                class="text-link"
                @click="jump(currentIssues[0]!)"
              >
                첫 항목 수정
              </button>
            </div>
            <template v-if="table === 'courses' && !allCourses"
              ><CatalogFields
                v-if="course"
                class="catalog-course-fields"
                :row="course"
                :issues="
                  currentIssues.filter((i) => i.table === 'courses' && i.rowCode === course?.code)
                "
                table="courses"
                :courses="sheet.tables.courses"
                :disabled="busy"
                @checkpoint="checkpoint"
                @change="changed"
              />
              <p v-else class="empty-state">과정을 추가한 뒤 학습 항목과 평가 문항을 작성하세요.</p>
              <div class="catalog-grid-tools">
                <button class="button secondary small" :disabled="busy" @click="addItem('courses')">
                  과정 추가</button
                ><button
                  class="button secondary small"
                  :disabled="busy || !course"
                  @click="duplicate([rowKey(course!)])"
                >
                  과정 복제</button
                ><button
                  class="button ghost small"
                  :disabled="busy || !course"
                  @click="requestRemove([rowKey(course!)])"
                >
                  과정 제외</button
                ><button
                  class="button ghost small"
                  :disabled="busy || !undo.length"
                  @click="restore()"
                >
                  실행 취소</button
                ><button
                  class="button ghost small"
                  :disabled="busy || !redo.length"
                  @click="restore(true)"
                >
                  다시 실행
                </button>
              </div></template
            >
            <CatalogGrid
              v-else
              :key="`${sheet.code}-${table}-${allCourses}-${allCourses ? '' : courseCode}`"
              :rows="visibleRows"
              :table="table"
              :courses="sheet.tables.courses"
              :all-courses="allCourses"
              :target="target"
              :issues="currentIssues"
              :can-undo="!!undo.length"
              :can-redo="!!redo.length"
              :disabled="busy"
              @change="editRows"
              @add="addItem()"
              @duplicate="duplicate"
              @remove="requestRemove"
              @detail="openDetail"
              @undo="restore()"
              @redo="restore(true)"
            />
            <div v-if="currentIssues.length" class="bulk-issues">
              <h3>수정할 항목</h3>
              <button v-for="(i, n) in currentIssues.slice(0, 100)" :key="n" @click="jump(i)">
                <span class="badge" :class="i.severity === 'structure' ? 'danger' : 'warning'">{{
                  i.severity === 'structure' ? '연결·입력 확인' : '등록 전 보완'
                }}</span
                >{{
                  i.pathLabel ||
                  `${sheet.title || '이름 없는 자격'} → ${catalogLabels[i.table as CatalogTable] || '기본정보'}`
                }}<strong>{{ i.message }}</strong
                ><small v-if="i.cell">Excel {{ i.cell }}</small>
              </button>
            </div>
          </section>
        </div>
        <div class="panel catalog-save-bar">
          <div aria-live="polite">
            <strong>{{
              dirty ? '서버 저장 전 수정 내용이 있습니다.' : '서버 기준과 같습니다.'
            }}</strong
            ><small>{{ recoveryStatus }}</small>
          </div>
          <button class="button ghost small" :disabled="busy" @click="downloadWork">
            작업 파일 다운로드</button
          ><button
            class="button secondary"
            :disabled="busy || validationPending"
            @click="review('save')"
          >
            초안 저장</button
          ><button
            class="button primary"
            :disabled="busy || validationPending"
            @click="review('publish')"
          >
            검토 후 사용 등록
          </button>
        </div>
        <button v-if="pending" class="button secondary" :disabled="busy" @click="retryPending">
          저장 결과 확인·재시도
        </button>
      </template>
      <details v-if="batches.length" class="panel catalog-history">
        <summary>변경 이력 ({{ batches.length }})</summary>
        <div v-for="b in batches" :key="b.id" class="simple-row">
          <span
            ><strong>{{
              b.qualificationIds
                .map(
                  (id) =>
                    store.data.qualifications.find((q) => q.id === id)?.title || '이름 없는 자격',
                )
                .join(' · ')
            }}</strong
            ><small
              >{{ new Date(b.createdAt).toLocaleString('ko-KR') }} ·
              {{ store.data.users.find((u) => u.id === b.actorId)?.name || '관리자' }}</small
            ></span
          ><span class="badge">{{
            b.status === 'published'
              ? '사용 등록 완료'
              : b.status === 'partial'
                ? `일부 등록 ${b.publishedQualificationIds?.length} / ${b.qualificationIds.length}`
                : '초안 저장'
          }}</span
          ><button
            class="button ghost small"
            :disabled="busy"
            @click="openExisting(b.qualificationIds)"
          >
            내용 확인
          </button>
        </div>
      </details>
    </template>
    <AppDialog
      :open="compareOpen"
      title="적용할 자격과 변경 내용 확인"
      @update:open="!busy && (compareOpen = $event)"
      ><p>선택한 자격만 처리합니다. 기존 학습·수료·인증은 당시 기준을 유지합니다.</p>
      <div class="catalog-review-list">
        <label v-for="s in workbook?.sheets" :key="s.code"
          ><input
            v-model="selected"
            type="checkbox"
            :value="s.code"
            :disabled="
              busy ||
              (!modified(s) &&
                store.data.qualifications.find((q) => q.id === s.sourceId)?.status === 'published')
            "
          /><strong>{{ s.title || '이름 없는 자격' }}</strong
          ><span>{{
            preview?.changes.find((c) => c.code === s.code)?.kind === 'new'
              ? '신규'
              : preview?.changes.find((c) => c.code === s.code)?.kind === 'changed'
                ? '개정'
                : '내용 변경 없음'
          }}</span
          ><small
            >{{ preview?.issues.filter((i) => i.code === s.code).length || 0 }}개 확인</small
          ></label
        >
      </div>
      <details v-for="c in selectedChanges" :key="c.code" class="catalog-diff">
        <summary>
          {{ c.title || '이름 없는 자격' }} · v{{ c.version }} · 변경 {{ c.details?.length || 0 }}개
        </summary>
        <div v-for="(d, i) in c.details" :key="i">
          <strong
            >{{ d.kind === 'added' ? '추가' : d.kind === 'removed' ? '제외' : '수정' }} ·
            {{ d.label }}</strong
          >
          <div class="catalog-diff-values">
            <p><small>변경 전</small>{{ d.before === '' ? '—' : d.before }}</p>
            <p><small>변경 후</small>{{ d.after === '' ? '—' : d.after }}</p>
          </div>
        </div>
      </details>
      <div v-if="selectedIssues.length" class="bulk-issues">
        <h3>선택한 자격의 확인 사항</h3>
        <button v-for="(i, n) in selectedIssues.slice(0, 100)" :key="n" @click="jump(i)">
          {{ i.pathLabel || i.sheet }} · {{ i.message }}
        </button>
        <p>
          등록 전 보완 항목은 초안으로 보관할 수 있습니다. 연결 오류는 수정하거나 해당 자격의 선택을
          해제하세요.
        </p>
      </div>
      <p v-if="!selected.length" class="muted">변경한 자격 또는 저장한 초안을 선택해 주세요.</p>
      <p v-else-if="reviewIntent === 'publish' && !canPublish" class="muted">
        선택한 최신 내용을 초안으로 저장하고 확인 사항을 해결한 뒤 사용 등록할 수 있습니다.
      </p>
      <template #footer
        ><button class="button secondary" :disabled="busy || !canSave" @click="save">
          선택 기준 초안 저장</button
        ><button
          v-if="reviewIntent === 'publish'"
          class="button primary"
          :disabled="busy || !canPublish"
          @click="publish"
        >
          선택 기준 사용 등록
        </button></template
      ></AppDialog
    >
    <AppDialog
      :open="!!detail"
      title="학습·평가 내용 편집"
      @update:open="!$event && (detail = null)"
      ><CatalogFields
        v-if="detail"
        :row="detail.row"
        :table="detail.table"
        :issues="
          currentIssues.filter((i) => i.table === detail?.table && i.rowCode === detail?.row.code)
        "
        :courses="sheet?.tables.courses || []"
      /><template #footer
        ><button class="button primary" @click="saveDetail">내용 반영</button></template
      ></AppDialog
    >
    <AppDialog
      :open="!!removeRequest"
      title="선택한 항목 제외"
      @update:open="!$event && (removeRequest = null)"
      ><p>
        {{ sheet?.title || '이름 없는 자격' }}에서 선택한 {{ removeRequest?.keys.length }}개 항목을
        제외합니다.
      </p>
      <p v-if="removeRequest?.childCount">
        연결된 학습·평가 {{ removeRequest.childCount }}개 항목도 함께 제외합니다.
      </p>
      <p>초안 저장 전 실행 취소할 수 있습니다. 기존 학습과 인증 기록은 유지됩니다.</p>
      <template #footer
        ><button class="button secondary" @click="removeRequest = null">취소</button
        ><button class="button primary" @click="removeConfirmed">함께 제외</button></template
      ></AppDialog
    >
  </div>
</template>
