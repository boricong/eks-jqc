import { randomUUID } from './uuid';
import {
  catalogTables,
  columnsFor,
  type CatalogWorkbook,
  type CatalogSheet,
  type CatalogRow,
  type CatalogTable,
} from '@eks/contracts';
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export const rowKey = (r: CatalogRow) => String(r.__row);
export function decorate(w: CatalogWorkbook) {
  for (const s of w.sheets)
    for (const t of catalogTables) for (const r of s.tables[t]) r.__row ||= randomUUID();
  return w;
}
export function clean(w: CatalogWorkbook): CatalogWorkbook {
  const out = clone(w);
  for (const s of out.sheets)
    for (const t of catalogTables)
      for (const r of s.tables[t]) {
        delete r.__row;
        delete r.courseName;
      }
  return out;
}
export const fingerprint = (s: CatalogSheet) =>
  JSON.stringify(
    clean({ format: 'eks-catalog-v11', lv1OrganizationId: 'local', sheets: [s] }).sheets[0],
  );
export function newRow(table: CatalogTable, rows: CatalogRow[], courseCode = ''): CatalogRow {
  const r: CatalogRow = Object.fromEntries(columnsFor(table, rows).map(([k]) => [k, '']));
  Object.assign(r, {
    code: randomUUID(),
    __row: randomUUID(),
    order:
      Math.max(
        0,
        ...rows
          .filter((r) => table === 'courses' || r.courseCode === courseCode)
          .map((r) => Number(r.order) || 0),
      ) + 1,
  });
  if (table !== 'courses') r.courseCode = courseCode;
  if (table === 'learning') {
    r.type = 'ojt';
    r.required = true;
  }
  if (table === 'objective' || table === 'practical') {
    r.points = 1;
    r.correct = null;
  }
  if (table === 'materials') r.type = 'text';
  if (table === 'courses') {
    r.sourceRevision = null;
    r.passScore = null;
    r.practicalPassScore = null;
  }
  return r;
}
export function newSheet(): CatalogSheet {
  return {
    sheetName: '새 자격',
    mode: 'new',
    code: randomUUID(),
    title: '',
    englishName: '',
    description: '',
    validityType: 'unknown',
    months: null,
    reminderDays: [],
    renewalLeadMonths: 3,
    renewalNoticeDaysBefore: 7,
    lifecycleStatus: 'Active',
    tables: { courses: [], learning: [], objective: [], materials: [], practical: [] },
  };
}
// Hidden rows retain position and content when the displayed projection changes.
export function mergeVisible(all: CatalogRow[], visible: CatalogRow[], next: CatalogRow[]) {
  const keys = new Set(visible.map(rowKey)),
    updates = new Map(next.map((r) => [rowKey(r), r]));
  const result = all.flatMap((r) =>
    keys.has(rowKey(r)) ? (updates.has(rowKey(r)) ? [updates.get(rowKey(r))!] : []) : [r],
  );
  const known = new Set(all.map(rowKey));
  return [...result, ...next.filter((r) => !known.has(rowKey(r)))];
}
export function duplicateRows(s: CatalogSheet, table: CatalogTable, keys: string[]) {
  const selected = s.tables[table].filter((r) => keys.includes(rowKey(r))),
    copies: CatalogRow[] = [];
  for (const r of selected) {
    const c: CatalogRow = {
      ...clone(r),
      code: randomUUID(),
      __row: randomUUID(),
      order: Math.max(0, ...s.tables[table].map((v) => Number(v.order) || 0)) + copies.length + 1,
    };
    if (table === 'courses') {
      c.sourceId = '';
      c.sourceRevision = null;
      c.title = `${r.title || '새 인증Set'} 사본`;
      for (const child of catalogTables.filter((t) => t !== 'courses'))
        s.tables[child].push(
          ...s.tables[child]
            .filter((v) => v.courseCode === r.code)
            .map((v) => ({
              ...clone(v),
              code: randomUUID(),
              __row: randomUUID(),
              courseCode: c.code,
            })),
        );
    }
    copies.push(c);
  }
  s.tables[table].push(...copies);
  return copies;
}
