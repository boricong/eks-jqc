import { createHash } from "node:crypto";
import {
  type OrganizationDocument,
  type State,
  CourseSchema,
} from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { photoCourseSpecs } from "./photo-certification-fixture.ts";

export const ASSESSMENT_TRANSITION = "self-assessment-v6";
// Historical conversion kept for fixture verification only. The one-time
// no-backup CLI is closed; v6 is subsequently migrated with a backed-up pair.
function validateV6(value: any, organizations: OrganizationDocument): State {
  const checked = validateState(
    {
      ...value,
      schemaVersion: 10,
      notices: value.notices.map((n: any) => ({ ...n, scope: "team" })),
    },
    organizations,
  );
  return { ...checked, schemaVersion: 6 } as unknown as State;
}
export function scenarioQuestions(id: string, title: string, checks: string[]) {
  return checks.map((answer, n) => {
    const scenario = [
      `가상 사례: ${title} 준비 중입니다. 전달받은 자료와 현장의 대상 식별 정보가 달라 어느 자료를 적용해야 할지 확인되지 않았습니다. 확인 없이 이전 기록을 재사용하자는 제안이 나왔습니다.`,
      `가상 사례: ${title}의 준비를 마쳤지만 이번 대상의 실행·검증은 아직 끝나지 않았습니다. 일정 단축을 위해 이번 확인을 생략하고 이전 결과로 대체하자는 제안이 나왔습니다.`,
      `가상 사례: ${title} 확인을 마쳤지만 인계 기록에 이번 대상과 결과를 연결할 근거가 빠져 있습니다. 다음 담당자는 이전 작업의 기록만 볼 수 있습니다.`,
    ][n % 3]!;
    const correct = [2, 0, 3][n % 3]!;
    const choices = [
      "차이를 기록하지 않고 이전 결과를 재사용한다",
      "현재 확인을 생략하고 완료된 것으로 전달한다",
      "다른 대상의 정보를 복사하여 이번 기록으로 사용한다",
    ];
    choices.splice(correct, 0, answer);
    return {
      id: `${id}-scenario-${n + 1}`,
      scenario,
      prompt: `이 상황에서 ${title}의 다음 대응으로 적절한 것은 무엇인가요? [테스트 정답: ${correct + 1}번 ${answer}]`,
      choices,
      correct,
      points: 1,
    };
  });
}
export function convertCourseFields(input: any) {
  const c = structuredClone(input);
  c.assessmentKinds = (
    c.assessmentKinds ||
    (c.mode === "both" ? ["objective", "practical"] : [c.mode])
  ).filter((k: string) => ["objective", "practical"].includes(k));
  c.materials ??= [
    ...(c.material
      ? [
          {
            id: `${c.id}-text`,
            type: "text",
            title: "학습자료",
            content: c.material,
            url: "",
            description: "",
          },
        ]
      : []),
    ...(c.materialUrl
      ? [
          {
            id: `${c.id}-url`,
            type: "url",
            title: "참고 링크",
            content: "",
            url: c.materialUrl,
            description: "",
          },
        ]
      : []),
  ];
  c.practicalQuestions ??= [];
  c.practicalPassScore ??= null;
  c.questions = (c.questions || []).map(({ category, ...q }: any) => q);
  for (const field of [
    "mode",
    "material",
    "materialUrl",
    "instruction",
    "subjectiveQuestions",
    "subjectivePassScore",
    "practicalItems",
  ])
    delete c[field];
  return c;
}
export function transitionAssessments(
  input: unknown,
  organizations: OrganizationDocument,
  at = new Date().toISOString(),
) {
  const s = structuredClone(input) as any;
  if (s.schemaVersion === 6)
    return {
      state: validateV6(s, organizations),
      report: { alreadyApplied: true, revision: s.revision },
    };
  if (s.schemaVersion !== 5) throw new Error("스키마 5 전환 전용 명령입니다.");
  const keys = [
    "users",
    "courses",
    "qualifications",
    "assignments",
    "enrollments",
    "attempts",
    "completions",
    "certifications",
    "plans",
    "planningRequests",
    "learningRecords",
    "notifications",
    "comparisons",
    "requests",
    "audits",
    "catalogBatches",
  ];
  for (const key of keys)
    if (!Array.isArray(s[key])) throw new Error(`원본 배열 누락: ${key}`);
  for (const key of keys.filter((k) => k !== "requests"))
    if (new Set(s[key].map((v: any) => v.id)).size !== s[key].length)
      throw new Error(`원본 ID 중복: ${key}`);
  const exists = (table: string, id: string) =>
    s[table].some((v: any) => v.id === id);
  for (const q of s.qualifications)
    if (!q.courseIds.every((id: string) => exists("courses", id)))
      throw new Error("원본 자격·과정 연결 오류");
  for (const a of s.assignments)
    if (
      !exists("users", a.learnerId) ||
      !exists("qualifications", a.qualificationId)
    )
      throw new Error("원본 배정 참조 오류");
  for (const e of s.enrollments)
    if (
      !exists("assignments", e.assignmentId) ||
      !exists("courses", e.courseId)
    )
      throw new Error("원본 수강 참조 오류");
  for (const t of s.attempts)
    if (!exists("enrollments", t.enrollmentId))
      throw new Error("원본 응시 참조 오류");
  if (s.catalogBatches.length)
    throw new Error(
      "저장된 일괄 개정안이 있습니다. 별도 보존·변환 검토가 필요합니다.",
    );
  const before = Object.fromEntries(
    Object.entries(s)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => [k, (v as any[]).length]),
  );
  for (const u of s.users) {
    if (u.roles.includes("ft")) {
      u.roles = u.roles.filter((r: string) => r !== "ft");
      if (!u.roles.length) u.roles = ["learner"];
      u.revision++;
    }
  }
  const specs = Object.values(photoCourseSpecs).flat();
  s.courses = s.courses.map((original: any) => {
    const c = convertCourseFields(original);
    if (
      c.id.startsWith("photo-process-v1-") &&
      c.lv1OrganizationId === "org-photo"
    ) {
      const spec = specs.find(([title]) => title === c.title);
      if (!spec || c.questions.length !== 3)
        throw new Error(`Photo 시험 기준이 달라졌습니다: ${c.id}`);
      c.practicalQuestions = scenarioQuestions(c.id, c.title, spec.slice(1));
      c.practicalPassScore = 100;
      c.assessmentKinds = ["objective", "practical"];
    } else if (original.practicalItems?.length)
      throw new Error(
        `시험 fixture 외 실기 기준을 먼저 검토해 주세요: ${c.id}`,
      );
    c.revision++;
    return CourseSchema.parse(c);
  });
  const progress = [
    "planningRequests",
    "plans",
    "assignments",
    "enrollments",
    "learningRecords",
    "attempts",
    "completions",
    "certifications",
    "comparisons",
    "notifications",
  ];
  for (const key of progress) s[key] = [];
  const obsolete =
    /^(assignment|attempt|plan|planning|learning|comparison|progress|notification)\./;
  s.audits = s.audits.filter(
    (e: any) => !e.assignmentId && !obsolete.test(e.action),
  );
  // Keep unrelated criterion/user operation retries; remove only progress/retired response payloads.
  const legacyResponse = (v: any): boolean =>
    !!v &&
    typeof v === "object" &&
    (Array.isArray(v)
      ? v.some(legacyResponse)
      : Object.entries(v).some(
          ([k, x]) =>
            [
              "ftId",
              "verdicts",
              "grades",
              "subjectiveQuestions",
              "practicalItems",
            ].includes(k) || legacyResponse(x),
        ));
  s.requests = s.requests.filter(
    (r: any) =>
      r.action && !obsolete.test(r.action) && !legacyResponse(r.response),
  );
  for (const n of s.notices)
    if (n.id === "notice-2") {
      n.body =
        "필수 학습 기록 후 지식 평가와 상황 대응 평가에 응시해 주세요. 두 평가는 서버가 자동 채점하며 유형별 통과 기준을 적용합니다.";
      n.revision++;
    }
  s.schemaVersion = 6;
  s.revision++;
  s.audits.push({
    id: ASSESSMENT_TRANSITION,
    actorId: "operator-1",
    date: at,
    action: "migration.assessment-v6",
    targetId: ASSESSMENT_TRANSITION,
    reason:
      "사용자 승인: FT·주관식 제거, 무백업 진행 초기화와 시험 기준 재구성",
    details: { before, backupCreated: false },
  });
  const state: State = validateV6(s, organizations);
  return {
    state,
    report: {
      alreadyApplied: false,
      revision: state.revision,
      before,
      after: Object.fromEntries(
        Object.entries(state)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => [k, (v as any[]).length]),
      ),
      backupCreated: false,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(state.courses))
        .digest("hex"),
    },
  };
}
