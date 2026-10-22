import { scenarioQuestions } from "./assessment-transition.ts";
import { createHash, randomUUID } from "node:crypto";
import {
  CourseSchema,
  QualificationSchema,
  courseUseErrors,
  qualificationUseErrors,
  type Course,
  type OrganizationDocument,
  type Qualification,
  type State,
} from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { PHOTO_ID } from "./organizations.ts";
import { qualificationTemplates } from "./workflow.ts";
import {
  PHOTO_FIXTURE_VERSION,
  photoCourseSpecs,
} from "./photo-certification-fixture.ts";

const progressAction =
  /^(assignment|attempt|plan|planning|learning|comparison|progress|notification)\./;
const testCourseEntities = new Set([
  "demo-course-1",
  "demo-course-2",
  "recipe-create",
  "recipe-edit",
]);
const testQualificationEntities = new Set(["demo-qualification", "recipe"]);
const oldNotice =
  "평가 흐름 체험은 가상의 평가 데이터입니다. Recipe Management는 미정 항목이 있는 초안으로 등록되어 있습니다.";
const oldAssessmentNotice =
  "배정된 인증Set의 객관식과 실기 평가를 진행해 주세요. 실기 평가는 지정된 FT가 담당합니다.";
export const photoSetupFingerprint = createHash("sha256")
  .update(
    JSON.stringify({
      version: PHOTO_FIXTURE_VERSION,
      photoCourseSpecs,
      qualificationTemplates,
    }),
  )
  .digest("hex");

type Counts = Record<string, number>;
const count = (state: State): Counts =>
  Object.fromEntries(
    (
      [
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
        "audits",
        "requests",
        "notices",
      ] as const
    ).map((key) => [key, state[key].length]),
  );

export interface PhotoSetupReport {
  version: string;
  fingerprint: string;
  alreadyApplied: boolean;
  sourceRevision: number;
  before: Counts;
  after: Counts;
  removedQualificationIds: string[];
  removedCourseIds: string[];
  retainedQualificationIds: string[];
  retainedCourseIds: string[];
  publishedQualificationIds: string[];
  publishedCourseIds: string[];
}

export function photoSetupApplied(state: State): boolean {
  return state.audits.some(
    (event) =>
      event.action === "fixture.photo.apply" &&
      event.targetId === PHOTO_FIXTURE_VERSION,
  );
}

function requirement(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Photo 시험 데이터 준비 중단: ${message}`);
}

function assessmentCourse(
  templateId: string,
  index: number,
  spec: readonly [string, string, string, string],
  at: string,
): Course {
  const [title, identify, act, record] = spec;
  const id = `${PHOTO_FIXTURE_VERSION}-${templateId}-${index + 1}`;
  const checkpoints = [identify, act, record];
  const phases = ["대상·기준 확인", "실행·이상 판단", "결과 검증·기록"];
  const choices = (answer: string, position: number) => {
    const variants = [
      "확인·기록 없이 완료 처리한다",
      "다른 대상의 이전 결과를 그대로 사용한다",
      "불일치를 무시하고 다음 단계로 진행한다",
    ];
    const result = variants.slice();
    result.splice(position, 0, answer);
    return result;
  };
  return CourseSchema.parse({
    id,
    entityId: id,
    lv1OrganizationId: PHOTO_ID,
    version: 1,
    revision: 1,
    title,
    status: "published",
    publishedAt: at,
    operationalStatus: "active",
    assessmentKinds: ["objective", "practical"],
    learningItems: [
      {
        id: `${id}-learning`,
        type: index < 2 ? "team" : index === 2 ? "mtc" : "ojt",
        title: `${title} · 기준과 가상 사례 학습`,
        required: true,
      },
    ],
    practicalPassScore: 100,
    passScore: 100,
    materials: [
      {
        id: `${id}-text`,
        type: "text",
        title: `${title} ????`,
        content: `???? ??? ?? ?????. ${checkpoints.join(" ? ")}`,
        url: "",
        description: "",
      },
    ],
    questions: checkpoints.map((answer, n) => {
      const position = [1, 2, 0][n]!;
      return {
        id: `${id}-objective-${n + 1}`,
        prompt: `${title}의 ${phases[n]} 단계에서 올바른 행동은 무엇인가요? [테스트 정답: ${position + 1}번 ${answer}]`,
        choices: choices(answer, position),
        correct: position,
        points: 1,
      };
    }),
    practicalQuestions: scenarioQuestions(id, title, checkpoints),
  });
}

export function preparePhotoSetup(
  source: State,
  organizations: OrganizationDocument,
  actorId: string,
  at: string,
): { state: State; report: PhotoSetupReport } {
  requirement(
    !photoSetupApplied(source),
    `${PHOTO_FIXTURE_VERSION}은 이미 적용되었습니다.`,
  );
  requirement(
    source.users.some(
      (u) => u.id === actorId && u.roles.includes("system_operator"),
    ),
    "시스템 운영자 계정이 필요합니다.",
  );
  requirement(
    organizations.roots.some((root) => root.id === PHOTO_ID),
    "Photo팀 Lv1 조직을 찾지 못했습니다.",
  );
  requirement(
    qualificationTemplates.length === 15 &&
      Object.keys(photoCourseSpecs).length === 15,
    "15종 템플릿과 인증Set 구성이 일치하지 않습니다.",
  );
  const state = structuredClone(source);
  const before = count(state);
  const removedQualifications = state.qualifications.filter(
    (q) =>
      q.lv1OrganizationId === PHOTO_ID &&
      (testQualificationEntities.has(q.entityId) ||
        (q.templateId === "eqp-backup" &&
          q.courseIds.includes("recipe-create"))),
  );
  const removedQualificationIds = new Set(
    removedQualifications.map((q) => q.id),
  );
  const removedCourses = state.courses.filter(
    (c) =>
      c.lv1OrganizationId === PHOTO_ID && testCourseEntities.has(c.entityId),
  );
  const removedCourseIds = new Set(removedCourses.map((c) => c.id));
  requirement(
    [...testQualificationEntities].every((id) =>
      removedQualifications.some((q) => q.entityId === id),
    ) &&
      [...testCourseEntities].every((id) =>
        removedCourses.some((c) => c.entityId === id),
      ),
    "기존 체험 자격·인증Set의 ID 계보가 예상과 다릅니다.",
  );
  requirement(
    removedQualifications.filter((q) => q.templateId === "eqp-backup")
      .length === 1,
    "Recipe 인증Set을 참조하는 설비 Backup 시험 버전이 예상과 다릅니다.",
  );
  requirement(
    state.qualifications.every(
      (q) =>
        removedQualificationIds.has(q.id) ||
        q.courseIds.every((id) => !removedCourseIds.has(id)),
    ),
    "삭제할 인증Set이 예상 밖의 자격에서 사용 중입니다.",
  );
  const oldProgressIds = new Set([
    ...state.assignments.map((x) => x.id),
    ...state.enrollments.map((x) => x.id),
    ...state.attempts.map((x) => x.id),
    ...state.completions.map((x) => x.id),
    ...state.certifications.map((x) => x.id),
    ...state.plans.map((x) => x.id),
    ...state.planningRequests.map((x) => x.id),
    ...state.learningRecords.map((x) => x.id),
    ...state.notifications.map((x) => x.id),
    ...state.comparisons.map((x) => x.id),
    ...removedQualificationIds,
    ...removedCourseIds,
    "notice-3",
  ]);
  state.qualifications = state.qualifications.filter(
    (q) => !removedQualificationIds.has(q.id),
  );
  state.courses = state.courses.filter((c) => !removedCourseIds.has(c.id));
  state.assignments = [];
  state.enrollments = [];
  state.attempts = [];
  state.completions = [];
  state.certifications = [];
  state.plans = [];
  state.planningRequests = [];
  state.learningRecords = [];
  state.notifications = [];
  state.comparisons = [];
  state.audits = state.audits.filter(
    (event) =>
      !progressAction.test(event.action) &&
      !oldProgressIds.has(event.targetId) &&
      (!event.assignmentId || !oldProgressIds.has(event.assignmentId)),
  );
  state.requests = state.requests.filter(
    (request) =>
      !progressAction.test(request.action || "") &&
      ![...oldProgressIds].some((id) =>
        JSON.stringify(request.response).includes(id),
      ),
  );
  const staleNotice = state.notices.find((n) => n.id === "notice-3");
  if (staleNotice) {
    requirement(
      staleNotice.title === "체험 데이터 안내" &&
        staleNotice.body === oldNotice,
      "체험 데이터 공지가 변경되었습니다.",
    );
    state.notices = state.notices.filter((n) => n.id !== staleNotice.id);
  }
  const notice = state.notices.find((n) => n.id === "notice-2");
  if (notice && notice.body === oldAssessmentNotice) {
    notice.body =
      "학습 안내에서 범위와 자료를 확인한 뒤 지식 평가와 상황 대응 평가에 응시해 주세요. 별도 학습 완료 기록 없이 서버가 자동 채점합니다.";
    notice.revision++;
  }
  const publishedQualificationIds: string[] = [];
  const publishedCourseIds: string[] = [];
  for (const template of qualificationTemplates) {
    const specs = photoCourseSpecs[template.id];
    requirement(
      specs?.length === 5,
      `${template.title} 인증Set이 5개가 아닙니다.`,
    );
    const courses = specs.map((spec, index) =>
      assessmentCourse(template.id, index, spec, at),
    );
    for (const course of courses) {
      requirement(
        !state.courses.some(
          (c) =>
            c.id === course.id ||
            (c.entityId === course.entityId && c.version === 1),
        ),
        `${course.title} ID가 이미 사용 중입니다.`,
      );
      requirement(
        !courseUseErrors(course).length,
        `${course.title} 사용 등록 기준이 부족합니다.`,
      );
      state.courses.push(course);
      publishedCourseIds.push(course.id);
    }
    const existing = state.qualifications.filter(
      (q) => q.lv1OrganizationId === PHOTO_ID && q.templateId === template.id,
    );
    requirement(
      existing.length <= 1,
      `${template.title} 템플릿이 중복 등록되었습니다.`,
    );
    const draft = existing[0];
    if (draft)
      requirement(
        draft.status === "draft" &&
          draft.version === 1 &&
          !draft.courseIds.length &&
          !draft.parentId &&
          !draft.description.trim() &&
          draft.validity.type === "unknown",
        `${template.title} 초안이 변경되었습니다. 덮어쓰지 않습니다.`,
      );
    const id = draft?.id || `${PHOTO_FIXTURE_VERSION}-${template.id}`;
    const qualification = QualificationSchema.parse({
      ...(draft || {
        id,
        entityId: id,
        lv1OrganizationId: PHOTO_ID,
        version: 1,
        revision: 1,
      }),
      title: template.title,
      englishName: template.englishName,
      description: `[프로세스 검증용] ${template.title}의 학습·평가·수료·인증 흐름을 시험하는 가상 기준입니다. 실제 사내 자격 기준으로 사용하지 않습니다.`,
      validity: { type: "months", months: 36, reminderDays: [90, 30, 7] },
      courseIds: courses.map((course) => course.id),
      status: "published",
      publishedAt: at,
      templateId: template.id,
      revision: draft ? draft.revision + 1 : 1,
    });
    requirement(
      !qualificationUseErrors(qualification, state.courses).length,
      `${template.title} 사용 등록 기준이 부족합니다.`,
    );
    if (draft) Object.assign(draft, qualification);
    else state.qualifications.push(qualification);
    publishedQualificationIds.push(id);
  }
  const publishedOrder = new Map(
    publishedQualificationIds.map((id, index) => [id, index]),
  );
  state.qualifications.sort(
    (a, b) =>
      (publishedOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (publishedOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  state.audits.push({
    id: randomUUID(),
    lv1OrganizationId: PHOTO_ID,
    actorId,
    date: at,
    action: "fixture.photo.apply",
    targetId: PHOTO_FIXTURE_VERSION,
    reason:
      "사용자 승인: 전 조직 학습 진행 정리 및 Photo팀 15종 시험 기준 구성",
    details: {
      version: PHOTO_FIXTURE_VERSION,
      fingerprint: photoSetupFingerprint,
      removedQualificationCount: removedQualificationIds.size,
      removedCourseCount: removedCourseIds.size,
      clearedProgress: Object.fromEntries(
        [
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
        ].map((key) => [key, before[key] || 0]),
      ),
      createdCourses: publishedCourseIds.length,
      publishedQualifications: publishedQualificationIds.length,
    },
  });
  validateState({ ...state, revision: state.revision + 1 }, organizations);
  return {
    state,
    report: {
      version: PHOTO_FIXTURE_VERSION,
      fingerprint: photoSetupFingerprint,
      alreadyApplied: false,
      sourceRevision: source.revision,
      before,
      after: count(state),
      removedQualificationIds: [...removedQualificationIds],
      removedCourseIds: [...removedCourseIds],
      retainedQualificationIds: source.qualifications
        .filter((q) => !removedQualificationIds.has(q.id))
        .map((q) => q.id),
      retainedCourseIds: source.courses
        .filter((c) => !removedCourseIds.has(c.id))
        .map((c) => c.id),
      publishedQualificationIds,
      publishedCourseIds,
    },
  };
}
