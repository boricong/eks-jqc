import ExcelJS from "exceljs";
import {
  catalogTables,
  catalogLabels,
  columnsFor,
  type CatalogWorkbook,
  type CatalogSheet,
  type CatalogIssue,
  type CatalogTable,
  type CatalogCell,
} from "./catalog-legacy-contracts.ts";
import { demand } from "./errors.ts";
import { emptyCatalog } from "./catalog.ts";
import { writeCatalogV2, readCatalogV2 } from "./catalog-workbook-legacy-v2.ts";

const metadata: [string, string][] = [
  ["format", "양식 버전"],
  ["lv1OrganizationId", "대상 Lv1 ID"],
  ["mode", "신규/개정 (new/revise)"],
  ["code", "자격코드"],
  ["title", "자격명"],
  ["englishName", "영문명"],
  ["description", "설명"],
  ["validityType", "기간 유형 (unknown/months/unlimited)"],
  ["months", "유효 개월 수"],
  ["reminderDays", "만료 전 알림 일수"],
  ["sourceId", "원본 자격 ID"],
  ["sourceRevision", "원본 revision"],
];
const blue = "2457D6",
  border = "D8E0EC";
export async function writeCatalogWorkbook(
  data: CatalogWorkbook,
  issues: CatalogIssue[] = [],
  version: 1 | 2 = 2,
) {
  if (version === 2) return writeCatalogV2(data, issues);
  const book = new ExcelJS.Workbook();
  book.creator = "EKS";
  book.created = new Date();
  const guide = book.addWorksheet("작성 안내");
  const lines = [
    ["EKS 자격 기준 · Excel 왕복 관리"],
    [
      "파일 하나는 한 Lv1만 관리합니다. 파란 셀은 입력, 회색 셀은 시스템 원본 정보입니다.",
    ],
    [
      "신규: new + 새 자격코드. 시트를 복제해도 sourceId는 신규 연결에 사용하지 않습니다.",
    ],
    [
      "개정: 내보낸 원본 ID/revision을 유지합니다. 포함 시트에서 지운 행은 새 개정안에서 제외됩니다.",
    ],
    [
      "포함하지 않은 자격은 유지됩니다. 표 자체를 지우거나 이름/열 제목을 바꾸면 오류입니다.",
    ],
    [
      "표의 행을 추가/삭제하고 정렬할 수 있습니다. 표 이름은 EKS_접두어를 유지해 주세요.",
    ],
    [
      "순서는 1 이상 정수, 코드는 텍스트, 객관식 정답은 1부터 시작합니다. 수식 대신 실제 값을 입력하세요.",
    ],
    [
      "교육: mtc/team/ojt · 평가 유형: objective,subjective,practical (쉼표 구분)",
    ],
    [
      "기간: unknown/months/unlimited · 필수 여부: true/false · 문항 종류: written/case",
    ],
    [
      "미정 기준은 초안 저장 후 수정할 수 있습니다. 구조 오류는 저장을 차단합니다. 사용 등록은 모든 기준 충족 후 별도 실행합니다.",
    ],
    [
      "과정/문항 코드가 연결을 결정합니다. 이름 또는 시트 이름을 식별자로 사용하지 않습니다.",
    ],
    [
      "회색 미사용 열은 표 폭 정렬용입니다. 비워 두세요. 같은 폭의 표이므로 행 추가 시 아래 표도 함께 이동합니다.",
    ],
    [
      "입력한 테스트 정답·채점 기준은 관리자용입니다. 파일을 관리 권한이 없는 사람에게 공유하지 마세요.",
    ],
  ];
  guide.addRows(lines);
  guide.getColumn(1).width = 115;
  guide.getRows(1, lines.length)?.forEach((r) => {
    r.height = 30;
    r.alignment = { wrapText: true, vertical: "middle" };
  });
  guide.getCell("A1").font = { bold: true, size: 20, color: { argb: blue } };
  const index = book.addWorksheet("자격 목록");
  index.columns = [
    { header: "자격코드", key: "code", width: 38 },
    { header: "전체 자격명", key: "title", width: 55 },
    { header: "시트", key: "sheet", width: 34 },
    { header: "작성 상태", key: "status", width: 18 },
  ];
  const usedNames = new Set(["작성 안내", "자격 목록"]);
  data.sheets.forEach((sheet, si) => {
    let name =
      sheet.sheetName.replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) ||
      `자격${si + 1}`;
    while (usedNames.has(name)) name = `${name.slice(0, 25)}_${si + 1}`;
    usedNames.add(name);
    const ws = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 15, xSplit: 2 }],
    });
    ws.getCell("A1").value = `${sheet.title || "새 자격"} · 기준 작성`;
    ws.getCell("A1").font = { bold: true, size: 17, color: { argb: blue } };
    ws.getRow(1).height = 30;
    const values: any = {
      ...sheet,
      format: data.format,
      lv1OrganizationId: data.lv1OrganizationId,
      reminderDays: sheet.reminderDays.join(","),
    };
    ws.addTable({
      name: `EKS_metadata_${si + 1}`,
      ref: "A3",
      headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: [{ name: "항목 코드" }, { name: "항목" }, { name: "입력값" }],
      rows: metadata.map(([key, label]) => [key, label, values[key] ?? ""]),
    });
    metadata.forEach(([key], i) => {
      const cell = ws.getCell(i + 4, 3);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: [
            "sourceId",
            "sourceRevision",
            "format",
            "lv1OrganizationId",
          ].includes(key)
            ? "EDF0F5"
            : "F0F5FF",
        },
      };
      if (["mode", "validityType"].includes(key))
        cell.dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: [
            key === "mode" ? '"new,revise"' : '"unknown,months,unlimited"',
          ],
          showErrorMessage: true,
          error: "목록에서 선택해 주세요.",
        };
      if (key === "months")
        cell.dataValidation = {
          type: "whole",
          operator: "between",
          formulae: [1, 1200],
          allowBlank: true,
          showErrorMessage: true,
        };
      issues
        .filter(
          (e) =>
            e.code === sheet.code && e.table === "metadata" && e.column === key,
        )
        .forEach((e) => (cell.note = e.message));
    });
    let row = 18;
    const tableWidth = Math.max(
      ...catalogTables.map((t) => columnsFor(t, sheet.tables[t]).length),
    );
    for (const table of catalogTables) {
      ws.getCell(row, 1).value = catalogLabels[table];
      ws.getCell(row, 1).font = { bold: true, size: 13, color: { argb: blue } };
      const columns = columnsFor(table, sheet.tables[table]);
      const usedColumns = columns.length;
      for (let i = usedColumns; i < tableWidth; i++)
        columns.push([
          `__unused${i - usedColumns + 1}`,
          `미사용 ${i - usedColumns + 1}`,
        ]);
      const start = row + 1;
      ws.addTable({
        name: `EKS_${table}_${si + 1}`,
        ref: `A${start}`,
        headerRow: true,
        style: { theme: "TableStyleMedium2", showRowStripes: true },
        columns: columns.map(([, name]) => ({ name, filterButton: true })),
        rows: sheet.tables[table].length
          ? sheet.tables[table].map((r) => columns.map(([k]) => r[k] ?? ""))
          : [columns.map(() => null)],
      });
      const count = Math.max(1, sheet.tables[table].length);
      columns.forEach(([key], ci) => {
        ws.getColumn(ci + 1).width = Math.max(
          ws.getColumn(ci + 1).width || 0,
          ["prompt", "material", "rubric", "criterion", "modelAnswer"].includes(
            key,
          )
            ? 55
            : ["title", "instruction"].includes(key)
              ? 36
              : 20,
        );
        for (let ri = 0; ri < count; ri++) {
          const cell = ws.getCell(start + 1 + ri, ci + 1);
          cell.alignment = { vertical: "top", wrapText: true };
          if (key.startsWith("__unused"))
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "EDF0F5" },
            };
          if (key === "code" || key === "courseCode" || key === "sourceId")
            cell.numFmt = "@";
          if (key.startsWith("source"))
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "EDF0F5" },
            };
          const lists: Record<string, string> = {
            type: "mtc,team,ojt",
            category: "written,case",
            required: "true,false",
            mandatory: "true,false",
          };
          if (lists[key])
            cell.dataValidation = {
              type: "list",
              allowBlank: false,
              formulae: [`"${lists[key]}"`],
              showErrorMessage: true,
              error: "목록에서 선택해 주세요.",
            };
          if (
            [
              "order",
              "points",
              "correct",
              "passScore",
              "subjectivePassScore",
            ].includes(key)
          )
            cell.dataValidation = {
              type: "whole",
              operator: "between",
              formulae: [
                1,
                key === "correct" ? 50 : key.includes("Score") ? 100 : 1000000,
              ],
              allowBlank: true,
              showErrorMessage: true,
            };
          const errors = issues.filter(
            (e) =>
              e.code === sheet.code &&
              e.table === table &&
              e.row === ri + 1 &&
              e.column === key,
          );
          if (errors.length) {
            cell.note = errors.map((e) => e.message).join("\n");
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF1DE" },
            };
          }
          cell.border = { bottom: { style: "hair", color: { argb: border } } };
        }
      });
      for (let i = 0; i < count; i++) ws.getRow(start + 1 + i).height = 34;
      row = start + count + 3;
    }
    index.addRow({
      code: sheet.code,
      title: sheet.title,
      sheet: { text: name, hyperlink: `#'${name.replace(/'/g, "''")}'!A1` },
      status: sheet.mode === "new" ? "신규 초안" : "개정 검토",
    });
    ws.getCell("E1").value = {
      text: "자격 목록으로",
      hyperlink: "#'자격 목록'!A1",
    };
  });
  if (issues.length) {
    const review = book.addWorksheet("검사 결과");
    review.columns = [
      { header: "시트", key: "sheet", width: 30 },
      { header: "표", key: "table", width: 18 },
      { header: "행", key: "row", width: 8 },
      { header: "열", key: "column", width: 24 },
      { header: "셀", key: "cell", width: 12 },
      { header: "현재 값", key: "value", width: 30 },
      { header: "수정 방법", key: "message", width: 80 },
    ];
    issues.forEach((i) =>
      review.addRow({ ...i, value: String(i.value ?? "") }),
    );
  }
  return Buffer.from(await book.xlsx.writeBuffer());
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
  if (book.subject === "eks-catalog-v2") return readCatalogV2(book, buffer);
  const result: CatalogWorkbook = {
    format: "eks-catalog-v1",
    lv1OrganizationId: "",
    sheets: [],
  };
  const issues: CatalogIssue[] = [],
    locations = new Map<string, string>();
  for (const ws of book.worksheets) {
    const tables = (ws.getTables() as any[]).map((t) => t.table);
    const metas = tables.filter((t) => /^EKS_metadata_/.test(t.name));
    if (!metas.length) {
      demand(
        !tables.some((t) =>
          /^EKS_(courses|learning|objective|subjective|practical)_/.test(
            t.name,
          ),
        ),
        422,
        `${ws.name}: 자격 메타정보 표가 없습니다.`,
      );
      continue;
    }
    demand(
      metas.length === 1,
      422,
      `${ws.name}: 메타정보 표는 하나여야 합니다.`,
    );
    const sheet: any = { ...emptyCatalog("temp").sheets[0]!, tables: { courses: [], learning: [], objective: [], subjective: [], practical: [] } };
    sheet.sheetName = ws.name;
    const valueOf = (
      cell: ExcelJS.Cell,
      table: CatalogIssue["table"],
      row: number,
      column: string,
    ): CatalogCell => {
      if (cell.type === ExcelJS.ValueType.Formula) {
        issues.push({
          sheet: ws.name,
          code: sheet.code,
          table,
          row,
          column,
          cell: cell.address,
          value: String(cell.formula),
          severity: "structure",
          message: "수식 대신 계산된 실제 값을 입력해 주세요.",
        });
        return "";
      }
      const v = cell.value;
      if (v === null || v === undefined) return "";
      if (typeof v === "object") {
        if ("richText" in v) return v.richText.map((r) => r.text).join("");
        if ("text" in v) return String(v.text);
        return String(cell.text);
      }
      return v as CatalogCell;
    };
    const bounds = (t: any) => {
      const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(t.tableRef || t.ref);
      demand(match, 422, `${ws.name}: 표 범위가 손상되었습니다.`);
      const col = (s: string) =>
        [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
      return {
        col: col(match[1]!),
        row: Number(match[2]),
        lastCol: col(match[3]!),
        lastRow: Number(match[4]) - (t.totalsRow ? 1 : 0),
      };
    };
    const mb = bounds(metas[0]);
    const values: Record<string, any> = {};
    for (let row = mb.row + 1; row <= mb.lastRow; row++) {
      const key = ws.getCell(row, mb.col).text;
      values[key] = valueOf(ws.getCell(row, mb.col + 2), "metadata", 0, key);
      locations.set(
        `${ws.name}/metadata/0/${key}`,
        ws.getCell(row, mb.col + 2).address,
      );
    }
    demand(
      values.format === "eks-catalog-v1",
      422,
      `${ws.name}: 지원하는 양식 버전이 아닙니다.`,
    );
    if (!result.lv1OrganizationId)
      result.lv1OrganizationId = String(values.lv1OrganizationId);
    demand(
      result.lv1OrganizationId === values.lv1OrganizationId,
      422,
      "여러 Lv1의 시트가 섞여 있습니다.",
    );
    Object.assign(sheet, {
      mode: values.mode,
      code: String(values.code || ""),
      title: String(values.title || ""),
      englishName: String(values.englishName || ""),
      description: String(values.description || ""),
      sourceId: values.sourceId ? String(values.sourceId) : undefined,
      sourceRevision: values.sourceRevision
        ? Number(values.sourceRevision)
        : undefined,
      validityType: values.validityType,
      months: values.months === "" ? null : Number(values.months),
      reminderDays: String(values.reminderDays || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map(Number),
    });
    for (const table of catalogTables) {
      const found = tables.filter((t) => t.name.startsWith(`EKS_${table}_`));
      demand(
        found.length === 1,
        422,
        `${ws.name}: ${catalogLabels[table]} 표가 없거나 중복되었습니다. 표 삭제를 행 전체 제외로 해석하지 않습니다.`,
      );
      const b = bounds(found[0]);
      const base = columnsFor(table, []);
      const cols = new Map<number, string>();
      for (let col = b.col; col <= b.lastCol; col++) {
        const label = ws.getCell(b.row, col).text;
        const extra = /^선택지 (\d+)$/.exec(label),
          unused = /^미사용 (\d+)$/.exec(label);
        const key =
          base.find(([, l]) => l === label)?.[0] ||
          (extra
            ? `choice${extra[1]}`
            : unused
              ? `__unused${unused[1]}`
              : undefined);
        demand(
          key,
          422,
          `${ws.name}/${catalogLabels[table]}: 알 수 없는 열 ${label}`,
        );
        cols.set(col, key);
      }
      demand(
        base.every(([key]) => [...cols.values()].includes(key)),
        422,
        `${ws.name}/${catalogLabels[table]}: 필수 열이 삭제되었습니다.`,
      );
      for (let row = b.row + 1; row <= b.lastRow; row++) {
        if (
          [...cols.keys()].every(
            (col) =>
              ws.getCell(row, col).value == null ||
              ws.getCell(row, col).value === "",
          )
        )
          continue;
        const ri = sheet.tables[table].length + 1;
        const record: Record<string, CatalogCell> = {};
        for (const [col, key] of cols) {
          const value = valueOf(ws.getCell(row, col), table, ri, key);
          if (key.startsWith("__unused")) {
            if (value !== "")
              issues.push({
                sheet: ws.name,
                code: sheet.code,
                table,
                row: ri,
                column: key,
                cell: ws.getCell(row, col).address,
                value,
                severity: "structure",
                message:
                  "미사용 열을 비워 주세요. 데이터는 이름이 있는 입력 열에 작성해 주세요.",
              });
            continue;
          }
          record[key] = value;
          locations.set(
            `${ws.name}/${table}/${ri}/${key}`,
            ws.getCell(row, col).address,
          );
        }
        sheet.tables[table].push(record);
      }
    }
    issues
      .filter((i) => i.sheet === ws.name)
      .forEach((i) => (i.code = sheet.code));
    result.sheets.push(sheet);
  }
  demand(
    result.sheets.length > 0 && result.sheets.length <= 100,
    422,
    "자격 시트를 1~100개 포함해 주세요.",
  );
  return { workbook: result, issues, locations };
}
