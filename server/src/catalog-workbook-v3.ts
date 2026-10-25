import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import {
  catalogTables,
  catalogLabels,
  columnsFor,
  type CatalogWorkbook,
  type CatalogSheet,
  type CatalogRow,
  type CatalogIssue,
} from "@eks/contracts";
import { demand } from "./errors.ts";

const meta: [string, string][] = [
  ["title", "자격명"],
  ["englishName", "영문명"],
  ["description", "자격 설명"],
  ["mode", "작성 방식"],
  ["validityType", "인증기간"],
  ["months", "유효 개월 수"],
  ["renewalNoticeDaysBefore", "재인증 시작 N일 전 알림"],
  ["renewalLeadMonths", "재인증 시작 · 만료 전 개월"],
  ["lifecycleStatus", "기준 운영 상태 · 참고용"],
  ["format", "양식 연결"],
  ["lv1OrganizationId", "조직 연결"],
  ["code", "자격 연결"],
  ["sourceId", "원본 연결"],
  ["sourceRevision", "변경 확인"],
  ["templateId", "기본자격 ID"],
  ["templateRevision", "공통 정보 수정 번호"],
  ["qualificationType", "인증 유형 · 읽기 전용"],
];
const systemKeys = [
  "code",
  "courseCode",
  "sourceId",
  "sourceRevision",
  "originalCourseName",
];
const systemTitles = [
  "관리 코드",
  "관리 인증Set 연결",
  "관리 원본",
  "관리 변경 번호",
  "관리 이전 인증Set명",
];
const translations: Record<string, Record<string, string>> = {
  type: {
    mtc: "MTC교육",
    team: "팀 특화 교육",
    ojt: "현업 OJT",
    text: "직접 작성",
    edm: "EDM Link",
    confluence: "Confluence",
    url: "일반 URL",
  },

  required: { true: "필수", false: "선택" },

  mode: { new: "새 자격", revise: "기존 자격 수정" },
  validityType: { unknown: "미정", months: "기간제", unlimited: "무기한" },
};
const shown = (k: string, v: unknown) =>
  translations[k]?.[String(v)] ?? v ?? "";
const internal = (k: string, v: unknown) =>
  Object.entries(translations[k] || {}).find(([, label]) => label === v)?.[0] ??
  v;
function visibleColumns(
  table: (typeof catalogTables)[number],
  rows: CatalogRow[],
): [string, string][] {
  return columnsFor(table, rows)
    .filter(([k]) => !systemKeys.includes(k))
    .flatMap(([k, label]) =>
      k === "kinds"
        ? ([
            ["useObjective", "객관식 사용"],
            ["usePractical", "실기 사용"],
          ] as [string, string][])
        : ([[k, label]] as [string, string][]),
    );
}
export async function writeCatalogV3(
  data: CatalogWorkbook,
  issues: CatalogIssue[] = [],
) {
  const book = new ExcelJS.Workbook();
  book.creator = "EKS";
  book.subject = "eks-catalog-v10";
  const guide = book.addWorksheet("작성 안내");
  guide.addRows([
    ["EKS 자격 기준 · 등록된 팀 자격 양식 v10"],
    [
      "Auditor는 필수 학습항목 본인 확인으로 수료합니다. 기존 평가 칸은 비활성 보존용이며 변경할 수 없습니다.",
    ],
    [
      "1. 등록된 팀 자격의 기간·인증Set을 수정합니다. 공통 이름·영문명·설명은 참고용입니다.",
    ],
    [
      "2. 학습·평가 표의 인증Set 선택에서 연결할 인증Set명을 고르세요. 새 인증Set도 목록에 반영됩니다.",
    ],
    [
      "3. 파란 입력칸을 작성하세요. 연결 정보는 접힌 관리 영역에서 보존하므로 수정할 필요가 없습니다.",
    ],
    [
      "4. 새로운 행의 관리 코드는 비워 두면 가져올 때 자동 생성합니다. 인증Set명이 같아 연결이 모호하면 웹에서 선택하세요.",
    ],
    [
      "5. 새 자격·독립 사본을 생성할 수 없습니다. 팀 자격 관리에서 기본자격을 먼저 등록해 주세요.",
    ],
    [
      "6. 포함한 자격의 제외한 인증Set·문항은 새 개정안에서 빠집니다. 기존 학습과 인증은 유지됩니다.",
    ],
    [
      "7. 표 자체나 열 제목은 지우지 마세요. 표 안에서 행 추가·삭제·정렬을 사용하세요. 수식 대신 값을 입력하세요.",
    ],
    [
      "8. 가져오기 → 보완 항목 확인 → 변경 검토 → 기준 저장 순서입니다. 파일을 가져오는 것만으로 반영되지 않습니다.",
    ],
    [
      "한 파일은 한 조직 · .xlsx 10MB · 자격 100개 · 평가 10,000행. 정답과 채점 기준이 포함된 관리자용 파일입니다.",
    ],
  ]);
  guide.getColumn(1).width = 115;
  guide.eachRow((r) => {
    r.height = 36;
    r.alignment = { wrapText: true, vertical: "middle" };
  });
  const index = book.addWorksheet("자격 목록");
  index.columns = [
    { header: "자격명", key: "title", width: 55 },
    { header: "작성 방식", key: "mode", width: 22 },
    { header: "인증Set 수", key: "count", width: 12 },
    { header: "바로가기", key: "link", width: 32 },
  ];
  const names = new Set(["작성 안내", "자격 목록"]);
  data.sheets.forEach((q, si) => {
    let name =
      q.sheetName.replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) ||
      `${si + 1}_새자격`;
    while (names.has(name)) name = `${name.slice(0, 25)}_${si + 1}`;
    names.add(name);
    const ws = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1, xSplit: 1 }],
      properties: {
        outlineProperties: { summaryRight: false, summaryBelow: false },
      },
    });
    const visible = Object.fromEntries(
      catalogTables.map((t) => [
        t,
        t === "courses"
          ? visibleColumns(t, q.tables[t])
          : [["courseName", "인증Set 선택"], ...visibleColumns(t, q.tables[t])],
      ]),
    ) as Record<(typeof catalogTables)[number], [string, string][]>;
    const width = Math.max(...catalogTables.map((t) => visible[t].length));
    const technicalStart = width + 1;
    const allColumns = (cols: [string, string][]) => [
      ...cols,
      ...Array.from(
        { length: width - cols.length },
        (_, i) =>
          [`__unused${i + 1}`, `입력하지 않음 ${i + 1}`] as [string, string],
      ),
      ...systemKeys.map((k, i) => [k, systemTitles[i]!] as [string, string]),
    ];
    ws.getCell("A1").value = `${q.title || "새 자격"} · 기준 작성`;
    ws.getCell("A1").font = { bold: true, size: 17, color: { argb: "2457D6" } };
    ws.getRow(1).height = 32;
    const values: Record<string, unknown> = {
      ...q,
      format: "eks-catalog-v10",
      lv1OrganizationId: data.lv1OrganizationId,
      renewalNoticeDaysBefore: q.renewalNoticeDaysBefore ?? 7,
    };
    const metaCols = allColumns([
      ["label", "항목"],
      ["value", "입력값"],
    ]);
    ws.addTable({
      name: `EKS_metadata_${si + 1}`,
      ref: "A3",
      headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: metaCols.map(([, name]) => ({ name, filterButton: false })),
      rows: meta.map(([k, label]) =>
        metaCols.map(([field]) =>
          field === "label"
            ? label
            : field === "value"
              ? shown(k, values[k])
              : field === "code"
                ? k
                : "",
        ),
      ),
    });
    meta.forEach(([k], i) => {
      const row = i + 4,
        cell = ws.getCell(row, 2);
      if (i >= 9) {
        ws.getRow(row).outlineLevel = 1;
        ws.getRow(row).hidden = true;
      }
      if (translations[k])
        cell.dataValidation = {
          type: "list",
          formulae: [
            `"${k === "mode" ? translations.mode!.revise : Object.values(translations[k]!).join(",")}"`,
          ],
          allowBlank: false,
          showErrorMessage: true,
          error: "목록에서 선택해 주세요.",
        };
      if (k === "renewalNoticeDaysBefore")
        cell.dataValidation = {
          type: "whole",
          operator: "between",
          formulae: [0, 365],
          allowBlank: false,
          showErrorMessage: true,
          error: "0~365일을 입력해 주세요.",
        };
      if (k === "renewalLeadMonths")
        cell.dataValidation = {
          type: "whole",
          operator: "between",
          formulae: [1, 1200],
          allowBlank: false,
          showErrorMessage: true,
          error: "1~1200의 개월 수를 입력해 주세요.",
        };
      if (
        [
          "title",
          "englishName",
          "description",
          "templateId",
          "templateRevision",
          "qualificationType",
        ].includes(k)
      ) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "F6F9FC" },
        };
        cell.font = { color: { argb: "61718A" } };
        cell.note =
          "참고용 공통 정보입니다. 기본자격 관리에서만 변경할 수 있으며 파일에서 변경하면 저장이 차단됩니다.";
      }
      if (k === "lifecycleStatus")
        cell.note =
          "참고용 상태입니다. 변경은 시스템의 운영 상태 변경에서 수행하세요.";
      cell.alignment = { wrapText: true, vertical: "top" };
      ws.getRow(row).height = k === "description" ? 64 : 28;
      for (const issue of issues.filter(
        (e) => e.code === q.code && e.table === "metadata" && e.column === k,
      ))
        cell.note = issue.message;
    });
    let row = meta.length + 6;
    for (const table of catalogTables) {
      ws.getCell(row, 1).value = catalogLabels[table];
      ws.getCell(row, 1).font = {
        bold: true,
        size: 13,
        color: { argb: "2457D6" },
      };
      const cols = allColumns(visible[table]);
      const records = q.tables[table].length ? q.tables[table] : [{}];
      ws.addTable({
        name: `EKS_${table}_${si + 1}`,
        ref: `A${row + 1}`,
        headerRow: true,
        style: { theme: "TableStyleMedium2", showRowStripes: true },
        columns: cols.map(([, name]) => ({ name, filterButton: true })),
        rows: records.map((r) =>
          cols.map(([k]) => {
            if (k === "courseName" || k === "originalCourseName")
              return (
                q.tables.courses.find((c) => c.code === r.courseCode)?.title ||
                ""
              );
            if (k.startsWith("use"))
              return Object.keys(r).length
                ? String(r.kinds || "")
                    .split(",")
                    .includes(k.slice(3).toLowerCase())
                  ? "사용"
                  : "미사용"
                : "";
            return shown(k, r[k]);
          }),
        ),
      });
      for (let ri = 0; ri < records.length; ri++)
        for (let ci = 0; ci < cols.length; ci++) {
          const [k] = cols[ci]!,
            cell = ws.getCell(row + 2 + ri, ci + 1);
          cell.alignment = { wrapText: true, vertical: "top" };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb: k.startsWith("__") || ci >= width ? "EDF0F5" : "F0F5FF",
            },
          };
          if (translations[k] || k.startsWith("use"))
            cell.dataValidation = {
              type: "list",
              formulae: [
                `"${k.startsWith("use") ? "사용,미사용" : (k === "type" ? (table === "materials" ? ["직접 작성", "EDM Link", "Confluence", "일반 URL"] : ["MTC교육", "팀 특화 교육", "현업 OJT"]) : Object.values(translations[k]!)).join(",")}"`,
              ],
              allowBlank: true,
              showErrorMessage: true,
              error: "목록에서 선택해 주세요.",
            };
          if (k === "courseName")
            cell.dataValidation = {
              type: "list",
              formulae: [`INDIRECT("EKS_courses_${si + 1}[인증Set명]")`],
              allowBlank: true,
              showErrorMessage: true,
              error: "인증Set 표의 이름을 선택해 주세요.",
            };
          if (
            [
              "order",
              "points",
              "correct",
              "passScore",
              "practicalPassScore",
            ].includes(k)
          )
            cell.dataValidation = {
              type: "whole",
              operator: "between",
              formulae: [
                k.includes("Score") ? 0 : 1,
                k === "correct" ? 50 : k.includes("Score") ? 100 : 1000000,
              ],
              allowBlank: true,
              showErrorMessage: true,
              error: "허용 범위의 정수를 입력해 주세요.",
            };
          if (
            q.qualificationType === "auditor" &&
            (["objective", "practical"].includes(table) ||
              ["kinds", "passScore", "practicalPassScore"].includes(k))
          ) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFE3E8EE" },
            };
            cell.note = "Auditor 비활성 평가 정보 · 변경 불가";
            cell.protection = { locked: true };
          }
          if (k === "qualificationType") {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFE3E8EE" },
            };
            cell.note =
              "인증 유형은 읽기 전용입니다. 연결된 기본자격의 유형을 사용합니다.";
          }
          if (systemKeys.includes(k))
            cell.numFmt = k === "sourceRevision" ? "0" : "@";
          for (const issue of issues.filter(
            (e) =>
              e.code === q.code &&
              e.table === table &&
              e.row === ri + 1 &&
              (e.column === k ||
                (e.column === "courseCode" && k === "courseName")),
          )) {
            cell.note = issue.message;
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF0CC" },
            };
          }
        }
      row += records.length + 4;
    }
    for (let ci = 1; ci <= width; ci++)
      ws.getColumn(ci).width = ci === 1 ? 30 : ci === 2 ? 45 : 26;
    for (
      let ci = technicalStart;
      ci < technicalStart + systemKeys.length;
      ci++
    ) {
      ws.getColumn(ci).width = 26;
      ws.getColumn(ci).outlineLevel = 1;
      ws.getColumn(ci).hidden = true;
    }
    index.addRow({
      title: q.title || "이름 없는 자격",
      mode: shown("mode", q.mode),
      count: q.tables.courses.length,
      link: { text: name, hyperlink: `#'${name.replaceAll("'", "''")}'!A1` },
    });
  });
  if (issues.length) {
    const review = book.addWorksheet("수정할 항목");
    review.columns = [
      { header: "자격", key: "sheet", width: 32 },
      { header: "수정 위치", key: "pathLabel", width: 80 },
      { header: "Excel 셀", key: "cell", width: 14 },
      { header: "수정 방법", key: "message", width: 80 },
    ];
    review.addRows(issues);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function readCatalogV3(book: ExcelJS.Workbook, buffer: Buffer) {
  const workbook: CatalogWorkbook = {
    format: "eks-catalog-v10",
    lv1OrganizationId: "",
    sheets: [],
  };
  const issues: CatalogIssue[] = [],
    locations = new Map<string, string>();
  const seed = createHash("sha256").update(buffer).digest("hex").slice(0, 20);
  for (const ws of book.worksheets) {
    const tables = (ws.getTables() as any[]).map((t) => t.table),
      metas = tables.filter((t) => /^EKS_metadata_/.test(t.name));
    if (!metas.length) {
      demand(
        !tables.some((t) =>
          /^EKS_(courses|materials|learning|objective|practical)_/.test(t.name),
        ),
        422,
        `${ws.name}: 자격 기본정보 표가 없습니다.`,
      );
      continue;
    }
    demand(
      metas.length === 1,
      422,
      `${ws.name}: 자격 기본정보 표가 중복되었습니다.`,
    );
    const bounds = (t: any) => {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(t.tableRef || t.ref);
      demand(m, 422, "표 범위를 확인해 주세요.");
      const col = (v: string) =>
        [...v].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
      return {
        c: col(m[1]!),
        r: Number(m[2]),
        end: Number(m[4]) - (t.totalsRow ? 1 : 0),
        last: col(m[3]!),
      };
    };
    let q: CatalogSheet;
    const value = (
      r: number,
      c: number,
      table: CatalogIssue["table"],
      row: number,
      column: string,
    ) => {
      const cell = ws.getCell(r, c);
      locations.set(`${ws.name}/${table}/${row}/${column}`, cell.address);
      if (cell.type === ExcelJS.ValueType.Formula) {
        issues.push({
          sheet: ws.name,
          code: q?.code || "",
          table,
          row,
          column,
          cell: cell.address,
          severity: "structure",
          message: "수식 대신 실제 값을 입력해 주세요.",
        });
        return "";
      }
      if (cell.value == null) return "";
      return typeof cell.value === "object" ? cell.text : cell.value;
    };
    const mb = bounds(metas[0]);
    const keyCol = Array.from(
      { length: mb.last - mb.c + 1 },
      (_, i) => mb.c + i,
    ).find((c) => ws.getCell(mb.r, c).text === "관리 코드");
    demand(keyCol, 422, `${ws.name}: 자격 연결 정보가 없습니다.`);
    const m: Record<string, any> = {};
    for (let r = mb.r + 1; r <= mb.end; r++) {
      const key = ws.getCell(r, keyCol).text;
      m[key] = value(r, mb.c + 1, "metadata", 0, key);
    }
    demand(
      [
        "eks-catalog-v3",
        "eks-catalog-v4",
        "eks-catalog-v5",
        "eks-catalog-v6",
        "eks-catalog-v7",
        "eks-catalog-v8",
        "eks-catalog-v9",
        "eks-catalog-v10",
      ].includes(m.format),
      422,
      `${ws.name}: 양식 버전을 확인해 주세요.`,
    );
    if (!workbook.lv1OrganizationId)
      workbook.lv1OrganizationId = String(m.lv1OrganizationId);
    demand(
      workbook.lv1OrganizationId === m.lv1OrganizationId,
      422,
      "여러 조직의 시트가 섞여 있습니다.",
    );
    const mode = internal("mode", m.mode) as CatalogSheet["mode"];
    q = {
      ...(m.qualificationType !== undefined && m.qualificationType !== ""
        ? { qualificationType: m.qualificationType }
        : {}),
      sheetName: ws.name,
      mode,
      code: String(m.code || `Q-${seed}-${workbook.sheets.length + 1}`),
      title: String(m.title || ""),
      englishName: String(m.englishName || ""),
      description: String(m.description || ""),
      validityType: internal(
        "validityType",
        m.validityType,
      ) as CatalogSheet["validityType"],
      months: m.months === "" ? null : Number(m.months),
      ...(m.renewalLeadMonths !== undefined && m.renewalLeadMonths !== ""
        ? { renewalLeadMonths: Number(m.renewalLeadMonths) }
        : {}),
      ...(m.renewalNoticeDaysBefore !== undefined &&
      m.renewalNoticeDaysBefore !== ""
        ? { renewalNoticeDaysBefore: Number(m.renewalNoticeDaysBefore) }
        : {}),
      ...(m.lifecycleStatus ? { lifecycleStatus: m.lifecycleStatus } : {}),
      reminderDays: String(m.reminderDays || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number),
      tables: {
        courses: [],
        learning: [],
        objective: [],
        materials: [],
        practical: [],
      },
    };
    if (mode === "revise") {
      q.sourceId = m.sourceId ? String(m.sourceId) : undefined;
      q.templateId = m.templateId || undefined;
      q.templateRevision = m.templateRevision
        ? Number(m.templateRevision)
        : undefined;
      q.sourceRevision = m.sourceRevision
        ? Number(m.sourceRevision)
        : undefined;
    } else q.code = `Q-${seed}-${workbook.sheets.length + 1}`;
    for (const table of catalogTables) {
      const found = tables.filter((t) => t.name.startsWith(`EKS_${table}_`));
      demand(
        found.length === 1,
        422,
        `${ws.name}: ${catalogLabels[table]} 표가 없거나 중복되었습니다. 표 삭제를 전체 제외로 해석하지 않습니다.`,
      );
      const b = bounds(found[0]),
        cols = new Map<number, string>();
      for (let c = b.c; c <= b.last; c++) {
        const label = ws.getCell(b.r, c).text.replaceAll("과정", "인증Set");
        const key =
          label === "인증Set 선택"
            ? "courseName"
            : systemTitles.includes(label)
              ? systemKeys[systemTitles.indexOf(label)]
              : /^입력하지 않음 \d+$/.test(label)
                ? `__unused${c}`
                : /^선택지 \d+$/.test(label)
                  ? `choice${label.split(" ")[1]}`
                  : visibleColumns(table, []).find(([, l]) => l === label)?.[0];
        demand(
          key,
          422,
          `${ws.name}/${catalogLabels[table]}: 열 제목 '${label}'을 확인해 주세요.`,
        );
        cols.set(c, key);
      }
      const required = [
        ...visibleColumns(table, []).map(([k]) => k),
        ...systemKeys,
        ...(table === "courses" ? [] : ["courseName"]),
      ];
      demand(
        required.every((k) => [...cols.values()].includes(k)),
        422,
        `${ws.name}/${catalogLabels[table]}: 필수 열이 삭제되었습니다.`,
      );
      for (let r = b.r + 1; r <= b.end; r++) {
        if (
          [...cols.keys()].every(
            (c) =>
              ws.getCell(r, c).value == null || ws.getCell(r, c).value === "",
          )
        )
          continue;
        const ri = q.tables[table].length + 1,
          record: CatalogRow = {};
        for (const [c, k] of cols) {
          const v = value(r, c, table, ri, k);
          if (k.startsWith("__unused")) {
            if (v !== "")
              issues.push({
                sheet: ws.name,
                code: q.code,
                table,
                row: ri,
                column: k,
                cell: ws.getCell(r, c).address,
                severity: "structure",
                message: "입력하지 않음 열을 비워 주세요.",
              });
            continue;
          }
          record[k] = internal(k, v) as any;
        }
        if (!record.code)
          record.code = `${table}-${seed}-${workbook.sheets.length + 1}-${ri}`;
        if (record.order === "") record.order = ri;
        if (table === "courses") {
          const uses = ["Objective", "Practical"];
          for (const k of uses)
            if (
              !["사용", "미사용", "", true, false].includes(
                record[`use${k}`] as any,
              )
            )
              issues.push({
                sheet: ws.name,
                code: q.code,
                table,
                row: ri,
                column: "kinds",
                cell: locations.get(`${ws.name}/${table}/${ri}/use${k}`),
                severity: "structure",
                message: "평가 사용 여부를 사용 또는 미사용으로 선택해 주세요.",
              });
          record.kinds = uses
            .filter(
              (k) => record[`use${k}`] === "사용" || record[`use${k}`] === true,
            )
            .map((k) => k.toLowerCase())
            .join(",");
          uses.forEach((k) => delete record[`use${k}`]);
          delete record.courseCode;
          delete record.originalCourseName;
          for (const k of ["passScore", "practicalPassScore", "sourceRevision"])
            if (record[k] === "") record[k] = null;
          if (mode === "new") {
            record.sourceId = "";
            record.sourceRevision = null;
          }
        } else {
          delete record.sourceId;
          delete record.sourceRevision;
          if (table === "objective" && record.correct === "")
            record.correct = null;
        }
        for (const k of ["required"])
          if (record[k] === "true" || record[k] === "false")
            record[k] = record[k] === "true";
        q.tables[table].push(record);
      }
    }
    for (const table of catalogTables.filter((t) => t !== "courses"))
      q.tables[table].forEach((r, i) => {
        const old = q.tables.courses.find((c) => c.code === r.courseCode);
        if (!(old && r.courseName === r.originalCourseName)) {
          const matches = q.tables.courses.filter(
            (c) =>
              c.title === r.courseName && String(r.courseName || "").trim(),
          );
          r.courseCode = matches.length === 1 ? matches[0]!.code : "";
        }
        // Preserve unresolved display text for the web course selector. Domain validation supplies a repairable error.
        if (r.courseCode) {
          delete r.courseName;
        } else
          locations.set(
            `${ws.name}/${table}/${i + 1}/courseCode`,
            locations.get(`${ws.name}/${table}/${i + 1}/courseName`)!,
          );
        delete r.originalCourseName;
      });
    issues.filter((i) => i.sheet === ws.name).forEach((i) => (i.code = q.code));
    workbook.sheets.push(q);
  }
  demand(
    workbook.sheets.length > 0 && workbook.sheets.length <= 100,
    422,
    "자격 시트를 1~100개 포함해 주세요.",
  );
  return { workbook, issues, locations };
}
