import { createHash, randomUUID } from "node:crypto";
import {
  CatalogWorkbookSchema,
  CourseSchema,
  QualificationSchema,
  catalogTables,
  courseUseErrors,
  qualificationUseErrors,
  type CatalogWorkbook,
  type CatalogSheet,
  type CatalogRow,
  type CatalogIssue,
  type CatalogDiff,
  type State,
  type Course,
  type Qualification,
  type CatalogBatch,
} from "@eks/contracts";
import { demand } from "./errors.ts";
import { describeChanges, describeIssues } from "./catalog-presentation.ts";

const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown, fallback: number | null = null) =>
  v === "" || v == null ? fallback : Number(v);
const bool = (v: unknown) =>
  v === true || v === "true" || v === "Y" || v === "예";
const codeOf = (v: { id: string; catalogCode?: string }) =>
  v.catalogCode || v.id;
const ordered = (rows: CatalogRow[]) =>
  [...rows].sort((a, b) => Number(a.order) - Number(b.order));
export function catalogHash(v: unknown): string {
  const canonical = (value: any): any =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .filter((k) => value[k] !== undefined)
              .map((k) => [k, canonical(value[k])]),
          )
        : value;
  return createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
}
export function exportCatalog(
  s: State,
  scope: string,
  ids: string[],
): CatalogWorkbook {
  demand(
    ids.length > 0 && ids.length <= 100 && new Set(ids).size === ids.length,
    422,
    "자격을 1~100개 선택해 주세요.",
  );
  return {
    format: "eks-catalog-v5",
    lv1OrganizationId: scope,
    sheets: ids.map((id, qi) => {
      const q = s.qualifications.find((q) => q.id === id);
      demand(
        q && q.lv1OrganizationId === scope,
        403,
        "선택 조직의 자격만 내보낼 수 있습니다.",
      );
      const tables: CatalogSheet["tables"] = {
        courses: [],
        learning: [],
        objective: [],
        materials: [],
        practical: [],
      };
      q.courseIds.forEach((id, ci) => {
        const c = s.courses.find((c) => c.id === id)!;
        const code = codeOf(c);
        tables.courses.push({
          code,
          order: ci + 1,
          title: c.title,
          kinds: c.assessmentKinds.join(","),
          passScore: c.passScore,
          practicalPassScore: c.practicalPassScore,
          sourceId: c.id,
          sourceRevision: c.revision,
        });
        c.learningItems.forEach((i, n) =>
          tables.learning.push({
            courseCode: code,
            code: codeOf(i),
            order: n + 1,
            type: i.type,
            title: i.title,
            required: i.required,
          }),
        );
        c.questions.forEach((i, n) =>
          tables.objective.push({
            courseCode: code,
            code: codeOf(i),
            order: n + 1,
            prompt: i.prompt,
            ...Object.fromEntries(
              i.choices.map((v, j) => [`choice${j + 1}`, v]),
            ),
            correct: i.correct == null ? null : i.correct + 1,
            points: i.points,
          }),
        );
        c.materials.forEach((m, n) =>
          tables.materials.push({
            courseCode: code,
            code: codeOf(m),
            order: n + 1,
            type: m.type,
            title: m.title,
            content: m.content,
            url: m.url,
            description: m.description,
          }),
        );
        c.practicalQuestions.forEach((q, n) =>
          tables.practical.push({
            courseCode: code,
            code: codeOf(q),
            order: n + 1,
            scenario: q.scenario,
            prompt: q.prompt,
            ...Object.fromEntries(
              q.choices.map((v, j) => [`choice${j + 1}`, v]),
            ),
            correct: q.correct == null ? null : q.correct + 1,
            points: q.points,
          }),
        );
      });
      return {
        sheetName: `${String(qi + 1).padStart(2, "0")}_${q.title}`
          .slice(0, 31)
          .replace(/[\\/?*\[\]:]/g, "_"),
        mode: "revise",
        code: codeOf(q),
        sourceId: q.id,
        sourceRevision: q.revision,
        title: q.title,
        englishName: q.englishName,
        description: q.description,
        validityType: q.validity.type,
        months: q.validity.months,
        reminderDays: [],
        renewalLeadMonths: q.renewalLeadMonths ?? 3,
        renewalNoticeDaysBefore: q.renewalNoticeDaysBefore ?? 7,
        lifecycleStatus: q.lifecycleStatus || "Active",
        tables,
      };
    }),
  };
}
export function emptyCatalog(scope: string): CatalogWorkbook {
  return {
    format: "eks-catalog-v5",
    lv1OrganizationId: scope,
    sheets: [
      {
        sheetName: "01_새자격",
        mode: "new",
        code: "QUAL-001",
        title: "",
        englishName: "",
        description: "",
        validityType: "unknown",
        months: null,
        reminderDays: [],
        renewalLeadMonths: 3,
        renewalNoticeDaysBefore: 7,
        lifecycleStatus: "Active",
        tables: {
          courses: [],
          learning: [],
          objective: [],
          materials: [],
          practical: [],
        },
      },
    ],
  };
}
function courseContent(c: Course) {
  return {
    title: c.title,
    assessmentKinds: [...c.assessmentKinds].sort(),
    passScore: c.passScore,
    practicalPassScore: c.practicalPassScore,
    ...Object.fromEntries(
      ["learningItems", "questions", "materials", "practicalQuestions"].map(
        (k) => [
          k,
          (c[k as "questions"] as any[]).map(
            ({ id, catalogCode, ...item }) => ({
              ...item,
              ...(["questions", "practicalQuestions"].includes(k)
                ? { correct: item.correct ?? null }
                : {}),
              catalogCode: catalogCode || id,
            }),
          ),
        ],
      ),
    ),
  };
}
const same = (a: unknown, b: unknown) => catalogHash(a) === catalogHash(b);
export function prepareCatalog(s: State, input: unknown, scope: string) {
  const incoming = input as CatalogWorkbook;
  if (Array.isArray(incoming?.sheets)) {
    demand(
      incoming.sheets.length <= 100,
      422,
      "자격 시트는 100개까지 가능합니다. 파일을 나누어 주세요.",
    );
    demand(
      incoming.sheets.reduce(
        (n, q) =>
          n +
          (["objective", "practical"] as const).reduce(
            (sum, t) =>
              sum + (Array.isArray(q?.tables?.[t]) ? q.tables[t].length : 0),
            0,
          ),
        0,
      ) <= 10000,
      422,
      "평가 항목은 파일당 10,000행까지 가능합니다. 자격별로 분할해 주세요.",
    );
  }
  const parsedWorkbook = CatalogWorkbookSchema.safeParse(input);
  if (!parsedWorkbook.success) {
    const raw = input as CatalogWorkbook;
    if (
      ["eks-catalog-v3", "eks-catalog-v4", "eks-catalog-v5"].includes(
        raw?.format,
      ) &&
      raw.lv1OrganizationId === scope &&
      Array.isArray(raw.sheets) &&
      raw.sheets.length > 0 &&
      raw.sheets.length <= 100 &&
      raw.sheets.every(
        (q) =>
          q &&
          typeof q.title === "string" &&
          typeof q.description === "string" &&
          Array.isArray(q.reminderDays) &&
          catalogTables.every((t) => Array.isArray(q.tables?.[t])),
      )
    ) {
      const issues: CatalogIssue[] = parsedWorkbook.error.issues.map((e) => {
        const si = Number(e.path[1]),
          q = raw.sheets[si],
          isTable = e.path[2] === "tables";
        return {
          sheet: q?.sheetName || `자격 ${si + 1}`,
          code: q?.code || "",
          table: isTable ? (e.path[3] as CatalogIssue["table"]) : "metadata",
          row: isTable ? Number(e.path[4]) + 1 : 0,
          column: String(e.path[isTable ? 5 : 2] || ""),
          message: e.message,
          severity: "structure",
        };
      });
      return {
        workbook: raw,
        issues,
        changes: [] as CatalogDiff[],
        qualifications: [] as Qualification[],
        courses: [] as Course[],
      };
    }
    throw parsedWorkbook.error;
  }
  const workbook = parsedWorkbook.data;
  demand(
    workbook.lv1OrganizationId === scope,
    403,
    "파일의 Lv1과 관리 대상 조직이 다릅니다.",
  );
  demand(
    workbook.sheets.reduce(
      (n, q) => n + q.tables.objective.length + q.tables.practical.length,
      0,
    ) <= 10000,
    422,
    "평가 항목은 파일당 10,000행까지 가능합니다. 자격별로 분할해 주세요.",
  );
  const issues: CatalogIssue[] = [],
    changes: CatalogDiff[] = [];
  const qualifications: Qualification[] = [],
    courses: Course[] = [];
  const qCodes = new Set<string>(),
    qSources = new Set<string>();
  workbook.sheets.forEach((sheet) => {
    const issue = (
      table: CatalogIssue["table"],
      row: number,
      column: string,
      message: string,
      severity: CatalogIssue["severity"] = "structure",
    ) =>
      issues.push({
        sheet: sheet.sheetName,
        code: sheet.code,
        table,
        row,
        column,
        value:
          table === "metadata"
            ? str((sheet as any)[column])
            : sheet.tables[table][row - 1]?.[column],
        message,
        severity,
      });
    if (sheet.legacyUnsupported)
      issue(
        "metadata",
        0,
        "title",
        "구형 주관식·관찰식 실기가 포함되어 있습니다. 원본을 보관하고 새 양식 v3에서 작성해 주세요.",
      );
    for (const table of catalogTables)
      for (const [ri, row] of sheet.tables[table].entries())
        for (const field of [
          "category",
          "subjectivePassScore",
          "material",
          "materialUrl",
          "instruction",
          "mandatory",
          "criterion",
          "rubric",
          "modelAnswer",
        ])
          if (field in row)
            issue(
              table,
              ri + 1,
              field,
              "폐지된 입력 필드입니다. 새 양식 v5를 사용해 주세요.",
            );
    if (!sheet.code.trim() || qCodes.has(sheet.code))
      issue(
        "metadata",
        0,
        "code",
        "자격코드는 공백 없이 파일에서 고유해야 합니다.",
      );
    qCodes.add(sheet.code);
    let original: Qualification | undefined;
    if (sheet.mode === "revise") {
      original = s.qualifications.find((q) => q.id === sheet.sourceId);
      sheet.renewalLeadMonths ??= original?.renewalLeadMonths ?? 3;
      sheet.lifecycleStatus = original?.lifecycleStatus || "Active";
      sheet.renewalNoticeDaysBefore ??= original?.renewalNoticeDaysBefore ?? 7;
      sheet.reminderDays = original?.validity.reminderDays || [];
      if (!original || original.lv1OrganizationId !== scope)
        issue(
          "metadata",
          0,
          "sourceId",
          "이 조직의 원본 자격을 다시 내보내 주세요.",
        );
      else {
        if (original.revision !== sheet.sourceRevision)
          issue(
            "metadata",
            0,
            "sourceRevision",
            "원본이 변경되었습니다. 다시 내보내 주세요.",
          );
      }
      if (qSources.has(sheet.sourceId || ""))
        issue(
          "metadata",
          0,
          "sourceId",
          "같은 원본의 여러 버전을 한 번에 편집할 수 없습니다.",
        );
      qSources.add(sheet.sourceId || "");
    } else if (
      s.qualifications.some(
        (q) => q.lv1OrganizationId === scope && codeOf(q) === sheet.code,
      )
    )
      issue(
        "metadata",
        0,
        "code",
        "이미 사용한 자격코드입니다. 새 코드를 지정하거나 기존 기준을 내보내 주세요.",
      );
    if (
      original &&
      s.qualifications.some(
        (q) =>
          q.lv1OrganizationId === scope &&
          q.entityId !== original!.entityId &&
          codeOf(q) === sheet.code,
      )
    )
      issue("metadata", 0, "code", "다른 자격의 코드와 중복됩니다.");
    const cCodes = new Set<string>(),
      courseSources = new Set<string>();
    for (const table of catalogTables) {
      const keys = new Set<string>();
      sheet.tables[table].forEach((r, ri) => {
        const key =
          table === "courses" ? str(r.code) : `${r.courseCode}/${r.code}`;
        if (!str(r.code).trim() || keys.has(key))
          issue(table, ri + 1, "code", "코드를 입력하고 중복을 제거해 주세요.");
        if (
          str(r.code).length > 160 ||
          ["__proto__", "constructor", "prototype"].includes(str(r.code))
        )
          issue(
            table,
            ri + 1,
            "code",
            "코드는 160자 이내의 일반 식별자로 입력해 주세요.",
          );
        keys.add(key);
        if (table === "courses") cCodes.add(str(r.code));
        if (table === "courses" && sheet.mode === "revise" && r.sourceId) {
          if (courseSources.has(str(r.sourceId)))
            issue(
              table,
              ri + 1,
              "sourceId",
              "같은 원본 인증Set을 중복 연결할 수 없습니다. 복제 행의 원본 ID를 비워 새 인증Set으로 만드세요.",
            );
          courseSources.add(str(r.sourceId));
        }
        if (!Number.isInteger(num(r.order)) || Number(r.order) < 1)
          issue(
            table,
            ri + 1,
            "order",
            "순서는 1 이상의 정수로 입력해 주세요.",
          );
        for (const key of table === "learning" ? ["required"] : [])
          if (
            ![true, false, "true", "false", "Y", "N", "예", "아니오"].includes(
              r[key] as any,
            )
          )
            issue(table, ri + 1, key, "필수 또는 선택을 지정해 주세요.");
        if (
          table === "learning" &&
          !["mtc", "team", "ojt"].includes(str(r.type))
        )
          issue(
            table,
            ri + 1,
            "type",
            "교육 종류는 MTC교육, 팀 특화 교육, 현업 OJT 중 선택해 주세요.",
          );
        for (const field of table === "objective"
          ? ["prompt"]
          : table === "practical"
            ? ["scenario", "prompt"]
            : table === "materials"
              ? ["title", r.type === "text" ? "content" : "url"]
              : ["title"])
          if (!str(r[field]).trim())
            issue(
              table,
              ri + 1,
              field,
              "사용 등록 전 내용을 입력해 주세요.",
              "readiness",
            );
        if (
          ["objective", "practical"].includes(table) &&
          (!Number.isInteger(num(r.points)) ||
            Number(r.points) < 1 ||
            Number(r.points) > 1000000)
        )
          issue(
            table,
            ri + 1,
            "points",
            "배점은 1~1,000,000 정수로 입력해 주세요.",
          );
        if (table === "objective" || table === "practical") {
          const choices = Object.keys(r).filter(
            (k) => /^choice\d+$/.test(k) && str(r[k]) !== "",
          );
          const last = Math.max(0, ...choices.map((k) => Number(k.slice(6))));
          if (
            last > 50 ||
            Array.from({ length: last }, (_, i) => r[`choice${i + 1}`]).some(
              (v) => !str(v),
            )
          )
            issue(
              table,
              ri + 1,
              "choice1",
              "선택지는 중간 빈칸 없이 최대 50개까지 입력해 주세요.",
            );
          if (
            r.correct !== null &&
            r.correct !== "" &&
            (!Number.isInteger(num(r.correct)) ||
              Number(r.correct) < 1 ||
              Number(r.correct) > last)
          )
            issue(
              table,
              ri + 1,
              "correct",
              "정답 번호를 입력된 선택지 범위로 지정해 주세요.",
            );
          if (r.correct == null || r.correct === "")
            issue(
              table,
              ri + 1,
              "correct",
              "사용 등록 전 정답 번호를 지정해 주세요.",
              "readiness",
            );
        }
      });
    }
    for (const table of catalogTables.filter((t) => t !== "courses"))
      sheet.tables[table].forEach((r, i) => {
        if (!cCodes.has(str(r.courseCode)))
          issue(
            table,
            i + 1,
            "courseCode",
            "연결할 인증Set을 선택해 주세요. 제외한 인증Set의 항목이라면 함께 제외해 주세요.",
          );
      });
    const builtCourses: Course[] = [];
    let added = 0,
      changed = 0,
      unchanged = 0;
    for (const r of ordered(sheet.tables.courses)) {
      const ri = sheet.tables.courses.indexOf(r) + 1,
        code = str(r.code);
      const source =
        sheet.mode === "revise"
          ? s.courses.find((c) => c.id === r.sourceId)
          : undefined;
      if (
        sheet.mode === "revise" &&
        r.sourceId &&
        (!source ||
          source.lv1OrganizationId !== scope ||
          !original?.courseIds.includes(source.id))
      )
        issue(
          "courses",
          ri,
          "sourceId",
          "원본 자격에 연결된 같은 조직의 인증Set만 개정할 수 있습니다.",
        );
      if (source && source.revision !== Number(r.sourceRevision))
        issue(
          "courses",
          ri,
          "sourceRevision",
          "인증Set 원본이 변경되었습니다. 다시 내보내 주세요.",
        );
      const shared =
        source &&
        s.qualifications.some(
          (q) =>
            q.entityId !== original?.entityId &&
            q.courseIds.includes(source.id),
        );
      const identity = (
        table: "learning" | "objective" | "materials" | "practical",
        row: CatalogRow,
      ) => {
        const collection =
          source?.[
            (
              {
                learning: "learningItems",
                objective: "questions",
                materials: "materials",
                practical: "practicalQuestions",
              } as const
            )[table]
          ];
        return {
          id:
            collection?.find((i) => codeOf(i) === row.code)?.id || randomUUID(),
          catalogCode: str(row.code),
        };
      };
      const rows = (t: (typeof catalogTables)[number]) =>
        ordered(sheet.tables[t].filter((i) => i.courseCode === code));
      const kinds = str(r.kinds)
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      if (
        kinds.some((k) => !["objective", "practical"].includes(k)) ||
        new Set(kinds).size !== kinds.length
      )
        issue(
          "courses",
          ri,
          "kinds",
          "필수 평가 유형에서 지식 평가·상황 대응 평가를 선택해 주세요.",
        );
      const raw = {
        ...(source || {}),
        id: source?.id || randomUUID(),
        entityId: source?.entityId || randomUUID(),
        lv1OrganizationId: scope,
        version: source?.version || 1,
        revision: source?.revision || 1,
        status: "draft",
        operationalStatus: source?.operationalStatus || "active",
        catalogCode: code,
        title: str(r.title),
        assessmentKinds: kinds,
        passScore: num(r.passScore),
        practicalPassScore: num(r.practicalPassScore),
        learningItems: rows("learning").map((i) => ({
          ...identity("learning", i),
          title: str(i.title),
          type: i.type,
          required: bool(i.required),
        })),
        questions: rows("objective").map((i) => {
          const choices = Object.keys(i)
            .filter((k) => /^choice\d+$/.test(k))
            .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))
            .map((k) => str(i[k]));
          while (choices.length && !choices.at(-1)) choices.pop();
          return {
            ...identity("objective", i),
            prompt: str(i.prompt),
            choices,
            correct: num(i.correct) == null ? null : Number(i.correct) - 1,
            points: num(i.points, 1),
          };
        }),
        materials: rows("materials").map((i) => ({
          ...identity("materials", i),
          type: i.type,
          title: str(i.title),
          content: str(i.content),
          url: str(i.url),
          description: str(i.description),
        })),
        practicalQuestions: rows("practical").map((i) => {
          const choices = Object.keys(i)
            .filter((k) => /^choice\d+$/.test(k))
            .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))
            .map((k) => str(i[k]));
          while (choices.length && !choices.at(-1)) choices.pop();
          return {
            ...identity("practical", i),
            scenario: str(i.scenario),
            prompt: str(i.prompt),
            choices,
            correct: num(i.correct) == null ? null : Number(i.correct) - 1,
            points: num(i.points, 1),
          };
        }),
      };
      const parsed = CourseSchema.safeParse(raw);
      if (!parsed.success) {
        for (const e of parsed.error.issues)
          issue("courses", ri, String(e.path[0]), e.message);
        continue;
      }
      let c = parsed.data;
      if (
        source &&
        same(courseContent(c), courseContent(source)) &&
        code === codeOf(source)
      ) {
        c = source;
        unchanged++;
        if (c.status === "draft") courses.push(c);
      } else {
        if (
          source &&
          s.courses.some(
            (c) =>
              c.entityId === source.entityId &&
              c.id !== source.id &&
              c.status === "draft",
          )
        )
          issue(
            "courses",
            ri,
            "sourceRevision",
            "다른 인증Set 초안 개정안이 있습니다. 해당 초안을 먼저 확인해 주세요.",
          );
        if (source) changed++;
        else added++;
        if (source?.status === "published" || shared) {
          c = {
            ...c,
            id: randomUUID(),
            entityId: shared ? randomUUID() : source!.entityId,
            parentId: shared ? undefined : source!.id,
            version: shared
              ? 1
              : Math.max(
                  ...s.courses
                    .filter((i) => i.entityId === source!.entityId)
                    .map((i) => i.version),
                ) + 1,
            revision: 1,
            status: "draft",
            operationalStatus: "active",
          };
          delete c.publishedAt;
          delete c.retiredAt;
          delete c.retiredBy;
          delete c.retirementReason;
        } else if (source) c = { ...c, revision: source.revision + 1 };
        courses.push(c);
      }
      builtCourses.push(c);
      courseUseErrors(c).forEach((m) =>
        issue(
          "courses",
          ri,
          m.includes("상황")
            ? "practicalPassScore"
            : m.includes("객관식")
              ? "passScore"
              : "title",
          m,
          "readiness",
        ),
      );
    }
    const removed = (original?.courseIds || []).filter(
      (id) => !builtCourses.some((c) => c.id === id || c.parentId === id),
    ).length;
    let q = QualificationSchema.parse({
      ...(original || {}),
      id: original?.id || randomUUID(),
      entityId: original?.entityId || randomUUID(),
      lv1OrganizationId: scope,
      version: original?.version || 1,
      revision: original?.revision || 1,
      status: "draft",
      catalogCode: sheet.code,
      title: sheet.title,
      englishName: sheet.englishName,
      description: sheet.description,
      lifecycleStatus: original?.lifecycleStatus || "Active",
      renewalNoticeDaysBefore:
        sheet.renewalNoticeDaysBefore ?? original?.renewalNoticeDaysBefore ?? 7,
      renewalLeadMonths:
        sheet.renewalLeadMonths ?? original?.renewalLeadMonths ?? 3,
      validity: {
        type: sheet.validityType,
        months: sheet.months,
        reminderDays: original?.validity.reminderDays || [],
      },
      courseIds: builtCourses.map((c) => c.id),
    });
    const qContent = (v: Qualification) => ({
      title: v.title,
      englishName: v.englishName,
      description: v.description,
      validity: v.validity,
      renewalLeadMonths: v.renewalLeadMonths ?? 3,
      renewalNoticeDaysBefore: v.renewalNoticeDaysBefore ?? 7,
      courseIds: v.courseIds,
    });
    const noChange =
      original &&
      same(qContent(q), qContent(original)) &&
      sheet.code === codeOf(original);
    if (noChange) {
      q = original!;
      if (q.status === "draft") qualifications.push(q);
    } else {
      if (
        original &&
        s.qualifications.some(
          (q) =>
            q.entityId === original.entityId &&
            q.status === "draft" &&
            q.id !== original.id,
        )
      )
        issue(
          "metadata",
          0,
          "sourceId",
          "다른 초안 개정안이 있습니다. 해당 초안을 먼저 확인해 주세요.",
        );
      if (original?.status === "published") {
        q = {
          ...q,
          id: randomUUID(),
          parentId: original.id,
          lifecycleStatus: "Active",
          version:
            Math.max(
              ...s.qualifications
                .filter((i) => i.entityId === original!.entityId)
                .map((i) => i.version),
            ) + 1,
          revision: 1,
        };
        delete q.publishedAt;
      } else if (original) q.revision++;
      qualifications.push(q);
    }
    qualificationUseErrors(
      q,
      builtCourses.map((c) => ({ ...c, status: "published" })),
    ).forEach((m) =>
      issue(
        "metadata",
        0,
        m.includes("기간") || m.includes("알림")
          ? "validityType"
          : m.includes("설명")
            ? "description"
            : "title",
        m,
        "readiness",
      ),
    );
    changes.push({
      code: sheet.code,
      title: sheet.title,
      kind: !original ? "new" : noChange ? "unchanged" : "changed",
      version: q.version,
      details: describeChanges(
        original ? exportCatalog(s, scope, [original.id]).sheets[0] : undefined,
        sheet,
      ),
      courses: { added, changed, removed, unchanged },
    });
    describeIssues(sheet, issues);
  });
  return { workbook, issues, changes, qualifications, courses };
}
export function saveCatalogBatch(
  s: State,
  input: unknown,
  scope: string,
  actorId: string,
  fileHash?: string,
) {
  const prepared = prepareCatalog(s, input, scope);
  demand(
    !prepared.issues.some((i) => i.severity === "structure"),
    409,
    prepared.issues
      .filter((i) => i.severity === "structure")
      .map((i) => `${i.sheet}/${i.table}/${i.row}/${i.column}: ${i.message}`)
      .join("\n"),
    "CATALOG_CONFLICT",
  );
  const { qualifications, courses } = prepared;
  const resultWorkbook = () =>
    exportCatalog(
      s,
      scope,
      prepared.workbook.sheets.map(
        (sheet) =>
          qualifications.find((q) => q.catalogCode === sheet.code)?.id ||
          sheet.sourceId!,
      ),
    );
  if (!qualifications.length && !courses.length)
    return {
      id: "unchanged",
      qualificationIds: [],
      courseIds: [],
      unchanged: true,
      workbook: resultWorkbook(),
    };
  for (const c of courses) {
    const i = s.courses.findIndex((v) => v.id === c.id);
    if (i < 0) s.courses.push(c);
    else s.courses[i] = c;
  }
  for (const q of qualifications) {
    const i = s.qualifications.findIndex((v) => v.id === q.id);
    if (i < 0) s.qualifications.push(q);
    else s.qualifications[i] = q;
  }
  const batch: CatalogBatch = {
    id: randomUUID(),
    lv1OrganizationId: scope,
    actorId,
    createdAt: new Date().toISOString(),
    contentHash: catalogHash(prepared.workbook),
    qualificationIds: qualifications.map((q) => q.id),
    courseIds: courses.map((c) => c.id),
    status: "draft",
    revisions: Object.fromEntries(
      [...qualifications, ...courses].map((v) => [v.id, v.revision]),
    ),
  };
  s.catalogBatches.push(batch);
  s.audits.push({
    id: randomUUID(),
    actorId,
    date: batch.createdAt,
    action: "catalog.batch.save",
    targetId: batch.id,
    lv1OrganizationId: scope,
    reason: "Excel/웹 표 기준 초안 일괄 저장",
    details: {
      fileHash: fileHash || "",
      contentHash: batch.contentHash,
      qualifications: qualifications.length,
      courses: courses.length,
      resultIds: [...batch.qualificationIds, ...batch.courseIds],
    },
  });
  return {
    id: batch.id,
    qualificationIds: batch.qualificationIds,
    courseIds: batch.courseIds,
    unchanged: false,
    workbook: resultWorkbook(),
  };
}
export function publishCatalogBatch(
  s: State,
  id: string,
  scope: string,
  actorId: string,
  selectedIds?: string[],
) {
  const batch = s.catalogBatches.find((b) => b.id === id);
  demand(
    batch && batch.lv1OrganizationId === scope,
    404,
    "선택 조직의 저장 배치를 찾을 수 없습니다.",
  );
  const requested = selectedIds || batch.qualificationIds;
  demand(
    requested.length > 0 &&
      new Set(requested).size === requested.length &&
      requested.every((q) => batch.qualificationIds.includes(q)),
    422,
    "이 작업에 저장한 자격을 선택해 주세요.",
  );
  const published = new Set(
    batch.publishedQualificationIds ||
      (batch.status === "published" ? batch.qualificationIds : []),
  );
  const pending = requested.filter((q) => !published.has(q));
  if (!pending.length)
    return {
      id,
      status: batch.status,
      qualificationIds: requested,
      workbook: exportCatalog(s, scope, requested),
    };
  const qualifications = pending.map((id) =>
    s.qualifications.find((q) => q.id === id)!,
  );
  demand(
    qualifications.every(Boolean),
    409,
    "저장한 자격을 찾을 수 없습니다. 최신 기준을 확인해 주세요.",
  );
  const courseIds = new Set(qualifications.flatMap((q) => q.courseIds));
  const courses = s.courses.filter(
    (c) =>
      courseIds.has(c.id) &&
      batch.courseIds.includes(c.id) &&
      c.status === "draft",
  );
  // A course already published by another operation must still match this batch's evidence.
  for (const cid of courseIds) {
    const c = s.courses.find((c) => c.id === cid);
    demand(
      c && c.lv1OrganizationId === scope,
      409,
      "연결된 인증Set을 다시 확인해 주세요.",
    );
    if (batch.courseIds.includes(cid) && c.status === "published")
      demand(
        c.revision === batch.revisions[cid]! + 1 &&
          batch.publicationResults?.some((r) =>
            s.qualifications
              .find((q) => q.id === r.qualificationId)
              ?.courseIds.includes(cid),
          ),
        409,
        "저장 이후 인증Set이 변경되었습니다. 다시 확인해 주세요.",
        "REVISION_CONFLICT",
      );
  }
  for (const item of [...courses, ...qualifications])
    demand(
      item &&
        item.revision === batch.revisions[item.id] &&
        item.status === "draft",
      409,
      "저장 이후 기준이 변경되었습니다. 다시 확인해 주세요.",
      "REVISION_CONFLICT",
    );
  for (const c of courses)
    demand(!courseUseErrors(c).length, 422, courseUseErrors(c).join("\n"));
  for (const c of courses) {
    c.status = "published";
    c.revision++;
    c.publishedAt = new Date().toISOString();
  }
  for (const q of qualifications)
    demand(
      !qualificationUseErrors(q, s.courses).length,
      422,
      qualificationUseErrors(q, s.courses).join("\n"),
    );
  for (const q of qualifications) {
    q.status = "published";
    q.revision++;
    q.publishedAt = new Date().toISOString();
  }
  const publishedAt = new Date().toISOString();
  pending.forEach((q) => published.add(q));
  batch.publishedQualificationIds = [...published];
  batch.publicationResults = [
    ...(batch.publicationResults || []),
    ...pending.map((qualificationId) => ({
      qualificationId,
      actorId,
      publishedAt,
    })),
  ];
  batch.status =
    published.size === batch.qualificationIds.length ? "published" : "partial";
  if (batch.status === "published") batch.publishedAt = publishedAt;
  s.audits.push({
    id: randomUUID(),
    actorId,
    date: publishedAt,
    action: "catalog.batch.publish",
    targetId: id,
    lv1OrganizationId: scope,
    reason: "관련 인증Set과 자격 원자적 사용 등록",
    details: {
      qualificationIds: pending,
      courseIds: courses.map((c) => c.id),
    },
  });
  return {
    id,
    status: batch.status,
    qualificationIds: requested,
    workbook: exportCatalog(s, scope, requested),
  };
}
