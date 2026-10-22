import {
  catalogTables,
  columnsFor,
  catalogLabels,
  type CatalogSheet,
  type CatalogIssue,
  type CatalogFieldChange,
  type CatalogCell,
} from "@eks/contracts";

const metadataLabels: Record<string, string> = {
  templateId: "기본자격 연결",
  templateRevision: "공통 정보 수정 번호",
  title: "자격명",
  englishName: "영문명",
  description: "자격 설명",
  validityType: "인증기간",
  months: "유효 개월 수",
  reminderDays: "이전 만료 알림 · 이력",
  renewalNoticeDaysBefore: "재인증 시작 전 알림 일수",
  renewalLeadMonths: "재인증 시작 개월",
  code: "자격 연결",
  sourceId: "원본 기준",
  sourceRevision: "원본 변경",
  mode: "작성 방식",
};
const cell = (v: unknown): CatalogCell =>
  Array.isArray(v)
    ? v.join(", ")
    : v == null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : (v as CatalogCell);
const labels: Record<string, string> = {
  objective: "객관식",
  materials: "학습자료",
  practical: "실기",
  mtc: "MTC교육",
  team: "팀 특화 교육",
  ojt: "현업 OJT",
  text: "직접 작성",
  edm: "EDM Link",
  confluence: "Confluence",
  url: "일반 URL",
  unknown: "미정",
  months: "기간제",
  unlimited: "무기한",
};
function display(v: unknown, field: string): CatalogCell {
  if (["required", "mandatory"].includes(field))
    return v === true || v === "true" ? "필수" : "선택";
  if (field === "kinds")
    return String(v || "")
      .split(",")
      .map((k) => labels[k] || k)
      .join(" · ");
  return labels[String(v)] || cell(v);
}
export function describeIssues(sheet: CatalogSheet, issues: CatalogIssue[]) {
  for (const i of issues.filter((i) => i.code === sheet.code)) {
    const row =
      i.table === "metadata" ? undefined : sheet.tables[i.table][i.row - 1];
    const courseCode = String(
      i.table === "courses" ? row?.code : row?.courseCode || "",
    );
    const course = sheet.tables.courses.find((c) => c.code === courseCode);
    i.rowCode = row ? String(row.code) : undefined;
    i.courseCode = courseCode || undefined;
    const field =
      i.table === "metadata"
        ? metadataLabels[i.column]
        : columnsFor(i.table, []).find(([k]) => k === i.column)?.[1];
    const localIndex =
      row && i.table !== "metadata"
        ? sheet.tables[i.table]
            .filter((r) => r.courseCode === row.courseCode)
            .indexOf(row) + 1
        : 0;
    i.pathLabel = [
      sheet.title || "이름 없는 자격",
      course?.title || (courseCode ? "연결할 인증Set 선택" : ""),
      i.table === "metadata"
        ? "기본정보"
        : i.table === "courses"
          ? "인증Set 정보"
          : `${catalogLabels[i.table]} ${localIndex}번`,
      field || "내용",
    ]
      .filter(Boolean)
      .join(" → ");
  }
}
export function describeChanges(
  before: CatalogSheet | undefined,
  after: CatalogSheet,
): CatalogFieldChange[] {
  const details: CatalogFieldChange[] = [];
  const push = (
    table: CatalogFieldChange["table"],
    kind: CatalogFieldChange["kind"],
    label: string,
    field: string,
    a: unknown,
    b: unknown,
  ) => {
    if (JSON.stringify(cell(a)) !== JSON.stringify(cell(b)))
      details.push({
        table,
        kind,
        label,
        field,
        before: display(a, field),
        after: display(b, field),
      });
  };
  for (const key of [
    "title",
    "englishName",
    "description",
    "validityType",
    "months",
    "renewalNoticeDaysBefore",
    "renewalLeadMonths",
  ] as const)
    push(
      "metadata",
      before ? "changed" : "added",
      metadataLabels[key]!,
      key,
      before?.[key],
      after[key],
    );
  for (const table of catalogTables) {
    const old = before?.tables[table] || [],
      next = after.tables[table];
    const identity = (r: (typeof old)[number]) =>
      table === "courses" ? String(r.code) : `${r.courseCode}/${r.code}`;
    const oldMap = new Map(old.map((r) => [identity(r), r])),
      nextMap = new Map(next.map((r) => [identity(r), r]));
    for (const key of new Set([...oldMap.keys(), ...nextMap.keys()])) {
      const a = oldMap.get(key),
        b = nextMap.get(key),
        r = b || a!;
      const course =
        after.tables.courses.find(
          (c) => c.code === (table === "courses" ? r.code : r.courseCode),
        ) ||
        before?.tables.courses.find(
          (c) => c.code === (table === "courses" ? r.code : r.courseCode),
        );
      const label = `${course?.title || "이름 없는 인증Set"}${table === "courses" ? "" : ` · ${catalogLabels[table]} ${r.order}번`}`;
      if (!a || !b) {
        details.push({
          table,
          kind: a ? "removed" : "added",
          label,
          field: "항목",
          before: a ? String(a.prompt || a.title || "항목") : "",
          after: b ? String(b.prompt || b.title || "항목") : "",
        });
        continue;
      }
      for (const [field, title] of columnsFor(table, [a, b]).filter(
        ([k]) => !["code", "sourceId", "sourceRevision"].includes(k),
      )) {
        if (field === "courseCode") {
          push(
            table,
            "changed",
            `${label} · ${title}`,
            field,
            before?.tables.courses.find((c) => c.code === a[field])?.title,
            after.tables.courses.find((c) => c.code === b[field])?.title,
          );
        } else
          push(
            table,
            "changed",
            `${label} · ${title}`,
            field,
            a[field],
            b[field],
          );
      }
    }
  }
  return details;
}
