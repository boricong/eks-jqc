import ExcelJS from "exceljs";
import { type CatalogWorkbook, type CatalogIssue } from "@eks/contracts";
import { demand } from "./errors.ts";
import { writeCatalogV3, readCatalogV3 } from "./catalog-workbook-v3.ts";
import { readCatalogWorkbook as readLegacy } from "./catalog-workbook-legacy.ts";
export async function writeCatalogWorkbook(
  data: CatalogWorkbook,
  issues: CatalogIssue[] = [],
  version: 1 | 2 | 3 = 3,
) {
  demand(version === 3, 422, "새 기준은 사용자 양식 v11로 내보내 주세요.");
  return writeCatalogV3(data, issues);
}
export async function readCatalogWorkbook(buffer: Buffer) {
  demand(
    buffer.length <= 10 * 1024 * 1024,
    413,
    "XLSX 파일은 10MB 이하로 나누어 주세요.",
  );
  // Check central-directory expansion before ExcelJS inflates the archive.
  let expanded = 0;
  for (let i = 0; i < buffer.length - 46; i++)
    if (buffer.readUInt32LE(i) === 0x02014b50) {
      expanded += buffer.readUInt32LE(i + 24);
      i +=
        45 +
        buffer.readUInt16LE(i + 28) +
        buffer.readUInt16LE(i + 30) +
        buffer.readUInt16LE(i + 32);
    }
  demand(
    expanded <= 125 * 1024 * 1024,
    413,
    "압축 해제된 문서가 너무 큽니다. 자격별로 나누어 주세요.",
  );
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as any);
  } catch {
    demand(false, 422, "정상적인 .xlsx 파일을 선택해 주세요.");
  }
  if (
    [
      "eks-catalog-v3",
      "eks-catalog-v4",
      "eks-catalog-v5",
      "eks-catalog-v6",
      "eks-catalog-v7",
      "eks-catalog-v8",
      "eks-catalog-v9",
      "eks-catalog-v10",
      "eks-catalog-v11",
    ].includes(book.subject)
  )
    return readCatalogV3(book, buffer);
  const legacy = await readLegacy(buffer);
  const issues: CatalogIssue[] = legacy.issues.map((i) => ({
    ...i,
    table: i.table === "subjective" ? "practical" : i.table,
  }));
  const workbook: CatalogWorkbook = {
    format: "eks-catalog-v11",
    lv1OrganizationId: legacy.workbook.lv1OrganizationId,
    sheets: [],
  };
  for (const q of legacy.workbook.sheets) {
    for (const t of ["subjective", "practical"] as const)
      for (const [i, row] of q.tables[t].entries())
        issues.push({
          sheet: q.sheetName,
          code: q.code,
          table: "practical",
          row: i + 1,
          column: "scenario",
          cell: legacy.locations.get(
            `${q.sheetName}/${t}/${i + 1}/${t === "subjective" ? "prompt" : "title"}`,
          ),
          severity: "structure",
          message: `구형 ${t === "subjective" ? "주관식" : "관찰식 실기"} 내용이 있습니다. 원본을 보관하고 새 양식에서 상황 대응 문항을 작성해 주세요.`,
          value: String(row.prompt || row.title || ""),
        });
    const materials: any[] = [];
    const courses = q.tables.courses.map((c) => {
      const {
        material,
        materialUrl,
        instruction,
        subjectivePassScore,
        ...rest
      } = c;
      if (material)
        materials.push({
          courseCode: c.code,
          code: `${c.code}-text`,
          order: 1,
          type: "text",
          title: "학습자료",
          content: material,
          url: "",
          description: "",
        });
      if (materialUrl)
        materials.push({
          courseCode: c.code,
          code: `${c.code}-url`,
          order: materials.filter((m) => m.courseCode === c.code).length + 1,
          type: "url",
          title: "참고 링크",
          content: "",
          url: materialUrl,
          description: "",
        });
      if (String(c.kinds).includes("subjective"))
        issues.push({
          sheet: q.sheetName,
          code: q.code,
          table: "courses",
          row: q.tables.courses.indexOf(c) + 1,
          column: "kinds",
          severity: "structure",
          message: "폐지된 주관식 평가 설정을 새 양식에서 변경해 주세요.",
        });
      return {
        ...rest,
        kinds: String(c.kinds || "")
          .split(",")
          .filter((k) => k !== "subjective")
          .join(","),
        practicalPassScore: null,
      };
    });
    workbook.sheets.push({
      ...q,
      legacyUnsupported:
        q.tables.subjective.length > 0 ||
        q.tables.practical.length > 0 ||
        q.tables.courses.some((c) => String(c.kinds).includes("subjective")),
      tables: {
        courses,
        materials,
        learning: q.tables.learning,
        objective: q.tables.objective.map(({ category, ...r }) => r),
        practical: [],
      },
    });
  }
  return { workbook, issues, locations: legacy.locations };
}
