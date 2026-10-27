import { randomUUID } from "node:crypto";
import {
  StateSchema,
  CourseContentSchema,
  CommonCourseSchema,
  CommonCourseReleaseSchema,
  CourseSchema,
  QualificationSchema,
  QualificationTemplateSchema,
  organizationEntries,
  TEST_DATA_RECIPE_VERSION,
  type State,
  type OrganizationDocument,
  type CourseContent,
  type TestDataCounts,
  type TestDataStatus,
} from "@eks/contracts";
import { TEST_DATA_TEMPLATES } from "./test-data-templates.ts";
import { copyCommonCourses } from "./common-courses.ts";
import { releaseInfo } from "./releases.ts";
import { auditorTemplateErrors } from "./auditor-pool.ts";
import { validateState } from "./integrity.ts";
import { demand } from "./errors.ts";

export function testDataCounts(
  s: State,
  o: OrganizationDocument,
  legacySnapshot = false,
): TestDataCounts {
  return {
    ...Object.fromEntries(
      Object.entries(s)
        .filter(([k, v]) => k !== "users" && Array.isArray(v))
        .map(([k, v]) => [k, (v as unknown[]).length]),
    ),
    organizationDetails: organizationEntries(o).filter(
      (n) => n.description || n.duties,
    ).length,
    organizationAudits: o.audits.length,
    organizationRequests: o.requests.length,
    legacySnapshots: legacySnapshot ? 1 : 0,
  } as TestDataCounts;
}
export function resetTestData(s: State, o: OrganizationDocument) {
  const state = StateSchema.parse({
    ...structuredClone(s),
    ...Object.fromEntries(
      Object.entries(s)
        .filter(([k, v]) => k !== "users" && Array.isArray(v))
        .map(([k]) => [k, []]),
    ),
    revision: s.revision + 1,
  });
  const strip = (
    nodes: OrganizationDocument["roots"],
  ): OrganizationDocument["roots"] =>
    nodes.map((n) => ({
      id: n.id,
      name: n.name,
      active: n.active,
      description: "",
      duties: "",
      children: strip(n.children),
    }));
  return {
    state,
    organizations: {
      ...structuredClone(o),
      revision: o.revision + 1,
      roots: strip(o.roots),
      audits: [],
      requests: [],
    },
  };
}
export function testDataStatus(
  s: State,
  o: OrganizationDocument,
  legacySnapshot = false,
): TestDataStatus {
  const counts = testDataCounts(s, o, legacySnapshot),
    entries = organizationEntries(o),
    teams = entries.filter((n) => n.level === 1 && n.effectiveActive);
  const hasData = Object.values(counts).some((n) => n > 0),
    blockers: string[] = [];
  if (hasData)
    blockers.push(
      "계정·조직 구조 외의 데이터가 있습니다. 먼저 전체 데이터 초기화를 실행해 주세요.",
    );
  if (!teams.length) blockers.push("활성 팀이 없어 로드할 수 없습니다.");
  for (const t of TEST_DATA_TEMPLATES)
    if (
      t.ownerLv1OrganizationId &&
      !entries.some((n) => n.id === t.ownerLv1OrganizationId && n.level === 1)
    )
      blockers.push(
        `${t.title}: 내장 원본의 소유 팀이 없어 로드할 수 없습니다.`,
      );
  const warnings = TEST_DATA_TEMPLATES.flatMap((t) =>
    auditorTemplateErrors(
      { qualificationTemplates: TEST_DATA_TEMPLATES },
      t,
    ).map((e) => `${t.title}: ${e}`),
  );
  if (!TEST_DATA_TEMPLATES.some((t) => t.auditorLevel === "main"))
    warnings.push(
      "내장 원본에는 메인 Auditor 기본자격이 없습니다. 필요하면 일반 사용자·기본자격 관리에서 시험할 기준을 설정해 주세요.",
    );
  if (!s.users.some((u) => u.roles.includes("evaluator")))
    warnings.push(
      "Auditor 지정 계정이 없습니다. 기존 사용자 관리에서 역할을 지정한 뒤 시험해 주세요.",
    );
  const total = teams.reduce(
    (n, team) =>
      n +
      TEST_DATA_TEMPLATES.filter(
        (t) => t.scope !== "team" || t.ownerLv1OrganizationId === team.id,
      ).length,
    0,
  );
  const latest = new Map<string, State["qualifications"][number]>();
  for (const q of s.qualifications)
    if (
      !q.deletedAt &&
      (!latest.has(q.entityId) ||
        (latest.get(q.entityId)!.version || 0) < (q.version || 0))
    )
      latest.set(q.entityId, q);
  return {
    canLoad: !blockers.length,
    canReset: hasData,
    counts,
    preserved: { users: s.users.length, organizations: entries.length },
    teams: teams.map(({ id, name }) => ({ id, name })),
    blockers,
    warnings: [...new Set(warnings)],
    recipe: {
      version: TEST_DATA_RECIPE_VERSION,
      templates: TEST_DATA_TEMPLATES.length,
      commonOriginals: 5,
      specializedPerTeam: 10,
      specialized: teams.length * 10,
      qualifications: total,
      commonCopies: total,
    },
    qualifications: [...latest.values()].map((q) => ({
      id: q.id,
      title: q.title,
      teamId: q.lv1OrganizationId,
      qualificationType: q.qualificationType,
    })),
  };
}

const koreanTopics = [
  "작업 전 안전 확인",
  "표준 절차와 변경 관리",
  "이상 징후와 보고",
  "품질 판정과 기록",
  "복구와 재발 방지",
  "설비 점검",
  "공정 조건 확인",
  "측정과 교정",
  "인수인계",
  "독립 수행 검증",
];
export function testCourseContent(
  index: number,
  common = false,
): CourseContent {
  const topic = koreanTopics[index % koreanTopics.length]!,
    type = common
      ? index < 3
        ? "auditee"
        : "auditor"
      : index < 6
        ? "auditee"
        : "auditor";
  const item = (prompt: string, questionIndex: number) => {
    const correct = 0;
    return {
      id: randomUUID(),
      prompt: `${prompt} (정답: ${correct + 1}번)`,
      points: questionIndex === 0 ? 34 : 33,
      correct,
      choices: [
        "표준과 현장 상태를 확인·기록하고 승인된 절차로 진행한다.",
        "확인 없이 이전 작업 조건을 적용한다.",
        "이상 내용을 기록하지 않고 계속한다.",
        "권한 없이 기준을 변경한다.",
      ],
    };
  };
  return CourseContentSchema.parse({
    qualificationType: type,
    title: `[테스트] ${common ? "공통" : "특화"} ${index + 1} · ${topic}`,
    assessmentKinds: type === "auditee" ? ["objective", "practical"] : [],
    passScore: type === "auditee" ? 100 : null,
    practicalPassScore: type === "auditee" ? 100 : null,
    subjectiveEnabled: type === "auditee",
    subjectiveQuestions:
      type === "auditee"
        ? [
            {
              id: randomUUID(),
              prompt: `${topic}의 확인 사항과 이상 보고 절차를 설명해 주세요.`,
            },
          ]
        : [],
    questions:
      type === "auditee"
        ? ["작업 전 확인", "작업 중 이상 대응", "작업 후 기록"].map(
            (phase, i) =>
              item(`${topic} — ${phase}에 적절한 행동은 무엇입니까?`, i),
          )
        : [],
    practicalQuestions:
      type === "auditee"
        ? ["기준과 다른 조건", "품질 이상", "복구 후 재개"].map((phase, i) => ({
            ...item(`${phase} 상황에서 적절한 조치를 선택하세요.`, i),
            scenario: `${topic} 작업 중 ${phase} 상황입니다. 생산 일정과 안전·품질 기준을 함께 확인해야 합니다.`,
          }))
        : [],
    learningItems: (["mtc", "team", "ojt"] as const).map((type, i) => ({
      id: randomUUID(),
      type,
      title: `${topic} ${["기초 교육", "팀 절차 교육", "현장 실습"][i]}`,
      required: i !== 1,
    })),
    materials: (["text", "edm", "confluence", "url"] as const).map((type) => ({
      id: randomUUID(),
      type,
      title: `${topic} ${type === "text" ? "학습 안내" : type + " 예시 자료"}`,
      content:
        type === "text"
          ? `${topic}의 표준과 점검 항목을 확인합니다. 이상 발생 시 작업을 멈추고 보고하며 승인된 복구 절차를 따릅니다. 테스트 문항의 정답은 모두 첫 번째 선택지입니다.`
          : "",
      url:
        type === "text"
          ? ""
          : `https://example.com/eks-test/${type}/${index + 1}`,
      description:
        type === "text"
          ? "시스템 내장 학습자료"
          : "링크 유형 편집용 예시 주소입니다. 실제 사내 자료가 아닙니다.",
    })),
  });
}
export function loadTestData(
  source: State,
  org: OrganizationDocument,
  actorId: string,
  at: string,
) {
  const status = testDataStatus(source, org);
  demand(
    status.canLoad,
    409,
    status.blockers.join(" · "),
    "TEST_DATA_NOT_EMPTY",
  );
  const state = structuredClone(source),
    organizations = structuredClone(org);
  state.qualificationTemplates = TEST_DATA_TEMPLATES.map((t) =>
    QualificationTemplateSchema.parse({
      ...structuredClone(t),
      revision: 1,
      updatedAt: at,
      updatedBy: actorId,
    }),
  );
  const info = () => ({
    ...releaseInfo("initial", actorId, "내장 테스트 데이터 로드"),
    createdAt: at,
  });
  const commonIds = Array.from({ length: 5 }, (_, i) => {
    const id = randomUUID(),
      releaseId = randomUUID(),
      content = testCourseContent(i, true);
    state.commonCourses.push(
      CommonCourseSchema.parse({
        ...content,
        id,
        revision: 1,
        releaseVersion: { major: 1, minor: 0 },
        headReleaseId: releaseId,
        operationalStatus: "active",
        createdAt: at,
        updatedAt: at,
        createdBy: actorId,
        updatedBy: actorId,
      }),
    );
    state.commonCourseReleases.push(
      CommonCourseReleaseSchema.parse({
        ...content,
        id: releaseId,
        commonCourseId: id,
        sequence: 1,
        releaseVersion: { major: 1, minor: 0 },
        releaseInfo: info(),
      }),
    );
    return id;
  });
  for (const team of status.teams) {
    const specialized = Array.from({ length: 10 }, (_, i) => {
      const id = randomUUID(),
        c = CourseSchema.parse({
          ...testCourseContent(i),
          id,
          entityId: id,
          lv1OrganizationId: team.id,
          version: 1,
          revision: 1,
          releaseVersion: { major: 1, minor: 0 },
          releaseInfo: info(),
          category: "specialized",
          operationalStatus: "active",
        });
      state.courses.push(c);
      return c;
    });
    const activeLevels = new Set<string>();
    const templates = state.qualificationTemplates.filter(
      (t) => t.scope !== "team" || t.ownerLv1OrganizationId === team.id,
    );
    for (const [i, t] of templates.entries()) {
      const originals = commonIds.filter(
        (id) =>
          state.commonCourses.find((c) => c.id === id)!.qualificationType ===
          t.qualificationType,
      );
      const copies = copyCommonCourses(
        state,
        [originals[i % originals.length]!],
        team.id,
      );
      copies.forEach((c) => (c.releaseInfo = info()));
      const choices = specialized.filter(
          (c) => c.qualificationType === t.qualificationType,
        ),
        id = randomUUID();
      const active =
        t.qualificationType === "auditee" ||
        (!auditorTemplateErrors(state, t).length &&
          !activeLevels.has(t.auditorLevel!));
      if (active && t.auditorLevel) activeLevels.add(t.auditorLevel);
      state.qualifications.push(
        QualificationSchema.parse({
          id,
          entityId: id,
          lv1OrganizationId: team.id,
          version: 1,
          revision: 1,
          releaseVersion: { major: 1, minor: 0 },
          releaseInfo: info(),
          qualificationType: t.qualificationType,
          templateId: t.id,
          templateRevision: t.revision,
          title: t.title,
          englishName: t.englishName,
          description: t.description,
          lifecycleStatus: active ? "Active" : "Hold",
          ...(t.auditorLevel
            ? {
                auditorCriteria: {
                  level: t.auditorLevel,
                  ...(t.prerequisiteTemplateId
                    ? { prerequisiteTemplateId: t.prerequisiteTemplateId }
                    : {}),
                },
              }
            : {}),
          commonCourseEntityIds: copies.map((c) => c.entityId),
          courseIds: [
            ...copies.map((c) => c.id),
            choices[i % choices.length]!.id,
          ],
          validity:
            i % 2
              ? { type: "unlimited", months: null, reminderDays: [] }
              : { type: "months", months: 12, reminderDays: [30, 7] },
          renewalLeadMonths: 3,
          renewalNoticeDaysBefore: 7,
        }),
      );
    }
    const first = state.qualifications.find(
      (q) =>
        q.lv1OrganizationId === team.id &&
        q.qualificationType === "auditee" &&
        q.lifecycleStatus === "Active",
    );
    if (first)
      state.organizationQualificationRequirements.push({
        organizationId: team.id,
        entityIds: [first.entityId],
        revision: 1,
        updatedAt: at,
        updatedBy: actorId,
      });
    state.auditorPrograms.push({
      lv1OrganizationId: team.id,
      revision: 1,
      notice: {
        revision: 1,
        title: "테스트 Auditor 학습 안내",
        body: "학습 정보를 확인한 뒤 필수 교육을 본인 확인해 주세요. 계정 역할과 자격 등급은 관리자가 기존 기능에서 지정합니다.",
        links: [],
      },
      updatedAt: at,
      updatedBy: actorId,
    });
  }
  state.revision = source.revision + 1;
  organizations.revision = org.revision + 1;
  return { state: validateState(state, organizations), organizations };
}
