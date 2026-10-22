import { z } from "zod";

export const catalogTables = [
  "courses",
  "materials",
  "learning",
  "objective",
  "practical",
] as const;
export type CatalogTable = (typeof catalogTables)[number];
export type CatalogCell = string | number | boolean | null;
export type CatalogRow = Record<string, CatalogCell>;
const CatalogRowsSchema = z
  .array(
    z.record(
      z.string().max(100),
      z.union([
        z.string().max(20000),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    ),
  )
  .max(10000);
export const CatalogSheetSchema = z.object({
  legacyUnsupported: z.boolean().optional(),
  sheetName: z.string().max(100),
  mode: z.enum(["new", "revise"]),
  code: z.string().max(160),
  sourceId: z.string().max(160).optional(),
  sourceRevision: z.number().int().positive().optional(),
  title: z.string().max(300),
  englishName: z.string().max(300),
  description: z.string().max(20000),
  validityType: z.enum(["unknown", "months", "unlimited"]),
  months: z.number().int().min(1).max(1200).nullable(),
  renewalLeadMonths: z.number().int().min(1).max(1200).optional(),
  renewalNoticeDaysBefore: z.number().int().min(0).max(365).optional(),
  lifecycleStatus: z.enum(["Active", "Hold", "Revoke"]).optional(),
  reminderDays: z.array(z.number().int().min(1).max(36500)).max(20),
  tables: z
    .object({
      courses: CatalogRowsSchema,
      learning: CatalogRowsSchema,
      objective: CatalogRowsSchema,
      materials: CatalogRowsSchema,
      practical: CatalogRowsSchema,
    })
    .strict(),
});
export type CatalogSheet = z.infer<typeof CatalogSheetSchema>;
export const CatalogWorkbookSchema = z.object({
  format: z.enum(["eks-catalog-v3", "eks-catalog-v4", "eks-catalog-v5"]),
  lv1OrganizationId: z.string().min(1).max(160),
  sheets: z.array(CatalogSheetSchema).min(1).max(100),
});
export type CatalogWorkbook = z.infer<typeof CatalogWorkbookSchema>;
export interface CatalogIssue {
  sheet: string;
  code: string;
  table: CatalogTable | "metadata";
  row: number;
  column: string;
  cell?: string;
  value?: CatalogCell;
  message: string;
  severity: "structure" | "readiness";
  rowCode?: string;
  courseCode?: string;
  pathLabel?: string;
}
export interface CatalogFieldChange {
  table: CatalogTable | "metadata";
  kind: "added" | "changed" | "removed";
  label: string;
  field: string;
  before: CatalogCell;
  after: CatalogCell;
}
export interface CatalogDiff {
  code: string;
  title: string;
  kind: "new" | "changed" | "unchanged";
  version: number;
  details?: CatalogFieldChange[];
  courses: {
    added: number;
    changed: number;
    removed: number;
    unchanged: number;
  };
}
export interface CatalogPreview {
  workbook: CatalogWorkbook;
  issues: CatalogIssue[];
  changes: CatalogDiff[];
  fileHash?: string;
}
export const CatalogBatchSchema = z.object({
  id: z.string(),
  lv1OrganizationId: z.string(),
  actorId: z.string(),
  createdAt: z.iso.datetime(),
  contentHash: z.string(),
  qualificationIds: z.array(z.string()),
  courseIds: z.array(z.string()),
  status: z.enum(["draft", "partial", "published"]),
  publishedAt: z.iso.datetime().optional(),
  publishedQualificationIds: z.array(z.string()).optional(),
  publicationResults: z
    .array(
      z.object({
        qualificationId: z.string(),
        actorId: z.string(),
        publishedAt: z.string(),
      }),
    )
    .optional(),
  revisions: z.record(z.string(), z.number().int().positive()),
});
export type CatalogBatch = z.infer<typeof CatalogBatchSchema>;
export const catalogLabels: Record<CatalogTable, string> = {
  courses: "인증Set",
  learning: "학습 항목",
  objective: "지식 평가",
  materials: "학습자료",
  practical: "상황 대응 평가",
};
export const catalogColumns: Record<CatalogTable, [string, string][]> = {
  courses: [
    ["code", "인증Set코드"],
    ["order", "순서"],
    ["title", "인증Set명"],
    ["kinds", "필수 평가 유형"],
    ["passScore", "객관식 합격 기준"],
    ["practicalPassScore", "상황 대응 합격 기준"],
    ["sourceId", "원본 ID"],
    ["sourceRevision", "원본 revision"],
  ],
  learning: [
    ["courseCode", "인증Set코드"],
    ["code", "항목코드"],
    ["order", "순서"],
    ["type", "교육 종류"],
    ["title", "항목명"],
    ["required", "필수 여부"],
  ],
  objective: [
    ["courseCode", "인증Set코드"],
    ["code", "문항코드"],
    ["order", "순서"],
    ["prompt", "문항"],
    ["choice1", "선택지 1"],
    ["choice2", "선택지 2"],
    ["choice3", "선택지 3"],
    ["choice4", "선택지 4"],
    ["correct", "정답 번호"],
    ["points", "배점"],
  ],
  materials: [
    ["courseCode", "인증Set코드"],
    ["code", "자료코드"],
    ["order", "순서"],
    ["type", "자료 유형"],
    ["title", "자료명"],
    ["content", "본문"],
    ["url", "URL"],
    ["description", "설명"],
  ],
  practical: [
    ["courseCode", "인증Set코드"],
    ["code", "문항코드"],
    ["order", "순서"],
    ["scenario", "상황 설명"],
    ["prompt", "대응 질문"],
    ["choice1", "선택지 1"],
    ["choice2", "선택지 2"],
    ["choice3", "선택지 3"],
    ["choice4", "선택지 4"],
    ["correct", "정답 번호"],
    ["points", "배점"],
  ],
};
export function columnsFor(table: CatalogTable, rows: CatalogRow[]) {
  const columns = [...catalogColumns[table]];
  if (table === "objective" || table === "practical") {
    const count = Math.max(
      4,
      ...rows.flatMap((r) =>
        Object.keys(r)
          .filter((k) => /^choice\d+$/.test(k))
          .map((k) => Number(k.slice(6))),
      ),
    );
    for (let i = 5; i <= count; i++)
      columns.splice(columns.length - 2, 0, [`choice${i}`, `선택지 ${i}`]);
  }
  return columns;
}
