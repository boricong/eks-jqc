import { z } from "zod";
import { CatalogBatchSchema } from "./catalog.ts";
import {
  LifecycleStatusSchema,
  RenewalLeadSchema,
  RenewalNoticeDaysSchema,
  CertificationPeriodSchema,
  RenewalSchema,
  LifecycleEventSchema,
} from "./lifecycle.ts";
export * from "./lifecycle.ts";
export * from "./catalog.ts";
import {
  ValiditySchema,
  unknownValidity,
  validityErrors,
  LearningItemSchema,
  AwardSnapshotSchema,
  PlanningRequestSchema,
  PersonalPlanSchema,
  LearningRecordSchema,
  NotificationSchema,
  type PlanningRequest,
  type PersonalPlan,
  type LearningRecord,
  type Notification,
} from "./workflow.ts";
export * from "./workflow.ts";
import {
  OrganizationPathSchema,
  RequestRecordSchema,
  type OrganizationEntry,
  type ResetScope,
} from "./organizations.ts";
export * from "./organizations.ts";

export const BaseRoleSchema = z.enum(["learner", "admin", "system_operator"]);
export const RoleSchema = z.enum([
  "learner",
  "admin",
  "system_operator",
  "organization_admin",
]);
export type Role = z.infer<typeof RoleSchema>;
export const roleLabels: Record<Role, string> = {
  learner: "학습자",
  admin: "팀 조직 관리자",
  organization_admin: "세부 조직 관리자",
  system_operator: "시스템 운영자",
};
export const KindSchema = z.enum(["objective", "practical"]);
export type Kind = z.infer<typeof KindSchema>;
export const kindLabels: Record<Kind, string> = {
  objective: "객관식 · 지식 평가",
  practical: "실기 · 상황 대응 평가",
};
export type AssessmentState = "ready" | "draft" | "passed" | "failed";
const id = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
    "예약된 식별자입니다.",
  );
const text = z.string().max(20000);
const url = z.union([
  z.literal(""),
  z
    .url()
    .refine(
      (v) => ["http:", "https:"].includes(new URL(v).protocol),
      "HTTP(S) 주소를 입력해 주세요.",
    ),
]);
export const UserSchema = z.object({
  id,
  certificationEligibility: z.enum(["eligible", "hold"]).optional(),
  name: z.string().min(1).max(100),
  roles: z
    .array(RoleSchema)
    .min(1)
    .refine(
      (roles) => !roles.includes("organization_admin"),
      "세부 조직 관리자는 조직별 지정으로 관리합니다.",
    ),
  organizationId: id,
  revision: z.number().int().positive(),
  organizationAdministration: z
    .object({
      organizationId: id,
      grantedBy: id,
      grantedAt: z.iso.datetime(),
    })
    .optional(),
});
export type User = z.infer<typeof UserSchema>;
export interface UserView extends User {
  lv1OrganizationId: string;
  organizationPath: { id: string; name: string }[];
  organizationActive: boolean;
}
export const QuestionSchema = z.object({
  id,
  catalogCode: z.string().max(160).optional(),
  prompt: text,
  choices: z.array(z.string().max(2000)).max(50),
  correct: z.number().int().nonnegative().nullable().optional(),
  points: z.number().int().min(1).max(1000000),
});
export type Question = z.infer<typeof QuestionSchema>;
export const PracticalQuestionSchema = QuestionSchema.extend({
  scenario: text,
});
export type PracticalQuestion = z.infer<typeof PracticalQuestionSchema>;
export const materialTypeLabels = {
  text: "직접 작성",
  edm: "EDM Link",
  confluence: "Confluence",
  url: "일반 URL",
};
export const MaterialSchema = z.object({
  id,
  catalogCode: z.string().max(160).optional(),
  type: z.enum(["text", "edm", "confluence", "url"]),
  title: z.string().max(300),
  content: text,
  url,
  description: text,
});
export type LearningMaterial = z.infer<typeof MaterialSchema>;
const revision = {
  id,
  catalogCode: z.string().max(160).optional(),
  lv1OrganizationId: id,
  entityId: id,
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  title: z.string().max(300),
  status: z.enum(["draft", "published"]),
  parentId: id.optional(),
  publishedAt: z.iso.datetime().optional(),
};
export const CourseSchema = z.object({
  ...revision,
  operationalStatus: z.enum(["active", "retired"]),
  retiredAt: z.iso.datetime().optional(),
  retiredBy: id.optional(),
  retirementReason: z.string().trim().min(1).max(2000).optional(),
  assessmentKinds: z.array(KindSchema).max(2),
  learningItems: z.array(LearningItemSchema).max(100).default([]),
  practicalPassScore: z.number().int().min(1).max(100).nullable(),
  passScore: z.number().int().min(1).max(100).nullable(),
  materials: z.array(MaterialSchema).max(100),
  questions: z.array(QuestionSchema).max(500),
  practicalQuestions: z.array(PracticalQuestionSchema).max(500),
});
export type Course = z.infer<typeof CourseSchema>;
export const QualificationSchema = z.object({
  ...revision,
  lifecycleStatus: LifecycleStatusSchema.optional(),
  renewalLeadMonths: RenewalLeadSchema.optional(),
  renewalNoticeDaysBefore: RenewalNoticeDaysSchema.optional(),
  courseIds: z.array(id).max(100),
  englishName: z.string().max(300).default(""),
  description: text.default(""),
  validity: ValiditySchema.default(unknownValidity),
  templateId: id.optional(),
});
export type Qualification = z.infer<typeof QualificationSchema>;
export const DraftSchema = z.object({
  answers: z.record(id, z.number().int().nonnegative()),
});
export type Draft = z.infer<typeof DraftSchema>;
export const AttemptSchema = z.object({
  id,
  enrollmentId: id,
  courseId: id,
  learnerId: id,
  kind: KindSchema,
  round: z.number().int().positive(),
  status: z.enum(["in_progress", "graded"]),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  date: z.iso.datetime().optional(),
  submittedAt: z.iso.datetime().optional(),
  result: z.enum(["passed", "failed"]).optional(),
  answers: DraftSchema.shape.answers,
  earned: z.number().nonnegative().optional(),
  total: z.number().positive().optional(),
  itemResults: z
    .array(
      z.object({
        itemId: id,
        correct: z.boolean(),
        earned: z.number().nonnegative(),
        possible: z.number().positive(),
      }),
    )
    .optional(),
});
export type AssessmentAttempt = z.infer<typeof AttemptSchema>;
export const EnrollmentSchema = z.object({
  id,
  assignmentId: id,
  courseId: id,
});
export const AssignmentSchema = z.object({
  id,
  acquisitionCycleId: id.optional(),
  previousCertificationId: id.optional(),
  acquisitionClosedAt: z.iso.datetime().optional(),
  resetPreviousCertificationId: id.optional(),
  lv1OrganizationId: id,
  organizationPath: OrganizationPathSchema,
  organizationSource: z.enum(["assigned", "migration"]),
  qualificationId: id,
  learnerId: id,
  ownerAdminId: id,
  assignedAt: z.iso.datetime(),
  planId: id.optional(),
  createdBy: id.optional(),
  revision: z.number().int().positive(),
  excludedReason: z.string().min(1).max(2000).optional(),
  excludedAt: z.iso.datetime().optional(),
});
export type StoredAssignment = z.infer<typeof AssignmentSchema>;
export const CompletionSchema = z.object({
  id,
  enrollmentId: id,
  learnerId: id,
  courseId: id,
  date: z.iso.datetime(),
  snapshot: AwardSnapshotSchema.optional(),
  evidence: z.array(z.object({ kind: KindSchema, attemptId: id })).min(1),
});
export type Completion = z.infer<typeof CompletionSchema>;
export const CertificationSchema = z.object({
  id,
  lifecycleStatus: LifecycleStatusSchema.optional(),
  revision: z.number().int().positive().optional(),
  periods: z.array(CertificationPeriodSchema).optional(),
  previousCertificationId: id.optional(),
  validityNeedsCorrection: z.boolean().optional(),
  assignmentId: id,
  learnerId: id,
  qualificationId: id,
  date: z.iso.datetime(),
  snapshot: AwardSnapshotSchema.optional(),
  validity: ValiditySchema.optional(),
  expiresOn: z.iso.date().optional(),
  evidence: z.array(z.object({ enrollmentId: id, completionId: id })).min(1),
});
export type Certification = z.infer<typeof CertificationSchema>;
const NoticeFields = z.object({
  id,
  title: z.string().min(1).max(300),
  body: text.min(1),
  date: z.iso.date(),
  published: z.boolean(),
  revision: z.number().int().positive(),
});
export const NoticeSchema = z.discriminatedUnion("scope", [
  NoticeFields.extend({ scope: z.literal("team"), lv1OrganizationId: id }),
  NoticeFields.extend({
    scope: z.literal("system"),
    lv1OrganizationId: z.undefined().optional(),
  }),
]);
export type Notice = z.infer<typeof NoticeSchema>;
export const AuditSchema = z.object({
  id,
  lv1OrganizationId: id.optional(),
  actorId: id,
  date: z.iso.datetime(),
  action: id,
  targetId: id,
  assignmentId: id.optional(),
  reason: text,
  details: z.record(z.string(), z.json()),
});
export type AuditEvent = z.infer<typeof AuditSchema>;
export const ComparisonSchema = z.object({
  id,
  enrollmentId: id,
  courseId: id,
  learnerId: id,
  ownerAdminId: id,
  revision: z.number().int().positive(),
  status: z.enum(["draft", "final"]),
  attemptIds: z.array(id).max(2),
  observedAt: z.union([z.literal(""), z.iso.date()]),
  observer: z.string().max(200),
  task: text,
  criterion: text,
  evidence: text,
  evidenceUrl: url,
  independence: z.enum(["independent", "same_assessment", "unknown"]),
  performance: z.enum(["met", "unmet", "unknown"]),
  outcome: z
    .enum([
      "both_met",
      "assessment_only",
      "performance_only",
      "neither_met",
      "pending",
    ])
    .optional(),
  createdAt: z.iso.datetime(),
  finalizedAt: z.iso.datetime().optional(),
  supersedesId: id.optional(),
  correctionReason: text,
});
export type Comparison = z.infer<typeof ComparisonSchema>;
export const comparisonLabels = {
  both_met: "양쪽 충족",
  assessment_only: "평가만 충족",
  performance_only: "실제 수행만 충족",
  neither_met: "양쪽 미충족",
  pending: "비교 보류",
};
export const StateSchema = z.object({
  schemaVersion: z.literal(10),
  revision: z.number().int().nonnegative(),
  users: z.array(UserSchema),
  courses: z.array(CourseSchema),
  qualifications: z.array(QualificationSchema),
  assignments: z.array(AssignmentSchema),
  enrollments: z.array(EnrollmentSchema),
  attempts: z.array(AttemptSchema),
  completions: z.array(CompletionSchema),
  certifications: z.array(CertificationSchema),
  notices: z.array(NoticeSchema),
  comparisons: z.array(ComparisonSchema),
  audits: z.array(AuditSchema),
  requests: z.array(RequestRecordSchema),
  planningRequests: z.array(PlanningRequestSchema),
  plans: z.array(PersonalPlanSchema),
  learningRecords: z.array(LearningRecordSchema),
  notifications: z.array(NotificationSchema),
  catalogBatches: z.array(CatalogBatchSchema).default([]),
  renewals: z.array(RenewalSchema).default([]),
  lifecycleEvents: z.array(LifecycleEventSchema).default([]),
});
export type State = z.infer<typeof StateSchema>;
export interface ProgressSummary {
  revision: number;
  scope: ResetScope;
  counts: {
    objectiveAttempts: number;
    practicalAttempts: number;
    learningRecords: number;
    notifications: number;
    completions: number;
    certifications: number;
    comparisons: number;
    renewals: number;
    certificationPeriods: number;
    credentialEvents: number;
  };
}

// Client projections contain only the fields accessible to the selected actor.
export interface Attempt extends Partial<Draft> {
  id: string;
  kind: Kind;
  round: number;
  result: "passed" | "failed";
  date: string;
  earned?: number;
  total?: number;
  itemResults?: AssessmentAttempt["itemResults"];
}
export interface Enrollment {
  id: string;
  courseId: string;
  objective: AssessmentState;
  practical: AssessmentState;
  answers: Draft["answers"];
  history: Attempt[];
  activeAttempts: Partial<Record<Kind, AssessmentAttempt>>;
  completion?: Completion;
}
export interface Assignment extends StoredAssignment {
  enrollments: Enrollment[];
  certifiedAt?: string;
  certification?: Certification;
}
export interface Workspace {
  requiredQualifications:
    import("./organizations.ts").RequiredQualificationsView | null;
  requestProgress: import("./organizations.ts").RequestProgress[];
  planningReadiness: {
    learnerId: string;
    canRequest: boolean;
    reason: string;
    count: number;
  }[];
  planEligibility: { planId: string; reasons: string[] }[];
  actor: UserView;
  serverDate: string;
  management: {
    lv1OrganizationId: string | null;
    canManage: boolean;
    canManagePolicies: boolean;
    canManageEligibility: boolean;
    editableOrganizationIds: string[];
  };
  organizations: OrganizationEntry[];
  users: UserView[];
  courses: Course[];
  qualifications: Qualification[];
  assignments: Assignment[];
  notices: Notice[];
  homeNotices: Notice[];
  comparisons: Comparison[];
  audits: AuditEvent[];
  planningRequests: PlanningRequest[];
  plans: PersonalPlan[];
  notifications: Notification[];
  eligibilitySummary: { eligible: number; held: number };
}

export interface CourseUsage {
  courseId: string;
  lv1OrganizationId: string;
  courseRevision: number;
  stateRevision: number;
  canDelete: boolean;
  blockers: string[];
  qualifications: Pick<Qualification, "id" | "title" | "version" | "status">[];
  successorVersions: { id: string; version: number }[];
  counts: {
    assignments: number;
    enrollments: number;
    attempts: number;
    completions: number;
    certifications: number;
    comparisons: number;
  };
}
export type DemoState = Workspace;
export const requiredKinds = (
  course: Pick<Course, "assessmentKinds">,
): Kind[] => course.assessmentKinds;
export function assessmentPrerequisite(
  course: Pick<Course, "assessmentKinds">,
  kind: Kind,
  knowledgePassed: boolean,
) {
  return kind === "practical" &&
    (!course.assessmentKinds.includes("objective") || !knowledgePassed)
    ? {
        code: "ASSESSMENT_PREREQUISITE_NOT_PASSED",
        message: "지식 평가를 먼저 통과해 주세요.",
      }
    : undefined;
}
export function courseErrors(course: Course): string[] {
  const errors: string[] = [];
  if (!course.title.trim()) errors.push("인증Set명을 입력해 주세요.");
  if (
    !course.assessmentKinds.length ||
    new Set(course.assessmentKinds).size !== course.assessmentKinds.length
  )
    errors.push("필수 평가 유형을 중복 없이 선택해 주세요.");
  if (
    new Set(course.learningItems.map((i) => i.id)).size !==
      course.learningItems.length ||
    course.learningItems.some((i) => !i.title.trim())
  )
    errors.push("학습 항목의 이름·식별자를 확인해 주세요.");
  const all = [...course.questions, ...course.practicalQuestions];
  if (new Set(all.map((q) => q.id)).size !== all.length)
    errors.push("항목 식별자가 중복되었습니다.");
  if (
    new Set(course.materials.map((m) => m.id)).size !== course.materials.length
  )
    errors.push("자료 식별자가 중복되었습니다.");
  course.materials.forEach((m, i) => {
    if (!m.title.trim() || (m.type === "text" ? !m.content.trim() : !m.url))
      errors.push(`${i + 1}번째 학습자료의 이름과 내용을 확인해 주세요.`);
  });
  for (const kind of requiredKinds(course)) {
    const score = assessmentPassScore(course, kind),
      questions = assessmentQuestions(course, kind);
    if (!score || score < 1 || score > 100)
      errors.push(`${kindLabels[kind]} 합격 기준을 1~100으로 입력해 주세요.`);
    if (!questions.length)
      errors.push(`${kindLabels[kind]} 문항을 추가해 주세요.`);
    questions.forEach((q, i) => {
      if (
        !q.prompt.trim() ||
        q.choices.length < 2 ||
        q.choices.some((v) => !v.trim()) ||
        q.correct == null ||
        !q.choices[q.correct] ||
        q.points <= 0 ||
        (kind === "practical" && !(q as PracticalQuestion).scenario.trim())
      )
        errors.push(
          `${kindLabels[kind]} ${i + 1}번의 상황·문항·선택지·정답·배점을 확인해 주세요.`,
        );
    });
  }
  return errors;
}
// Publication/new plans require a learner-recordable prerequisite; legacy
// published versions keep their original structure for existing assignments.
export function courseUseErrors(course: Course): string[] {
  return [
    ...courseErrors(course),
    ...(course.assessmentKinds.includes("practical") &&
    !course.assessmentKinds.includes("objective")
      ? ["상황 대응 평가를 사용하려면 지식 평가도 필수로 설정해 주세요."]
      : []),
    ...(!course.learningItems.some((item) => item.required)
      ? ["필수 학습 항목을 하나 이상 설정해 주세요."]
      : []),
  ];
}
export function qualificationErrors(
  q: Qualification,
  courses: Course[],
): string[] {
  return [
    !q.title.trim() && "자격명을 입력해 주세요.",
    !q.courseIds.length && "필수 인증Set을 선택해 주세요.",
    new Set(q.courseIds).size !== q.courseIds.length &&
      "필수 인증Set이 중복되었습니다.",
    q.courseIds.some(
      (id) => courses.find((c) => c.id === id)?.status !== "published",
    ) && "필수 인증Set을 먼저 사용 등록해 주세요.",
  ].filter(Boolean) as string[];
}

// Eligibility for NEW use only. Historical qualifications and awards remain valid.
export function retiredCourses(q: Qualification, courses: Course[]): Course[] {
  return courses.filter(
    (c) => q.courseIds.includes(c.id) && c.operationalStatus === "retired",
  );
}
export function qualificationUseErrors(
  q: Qualification,
  courses: Course[],
): string[] {
  return [
    ...(q.lifecycleStatus && q.lifecycleStatus !== "Active"
      ? [
          `자격 기준 ${q.lifecycleStatus} 상태로 신규 계획·재인증을 시작할 수 없습니다.`,
        ]
      : []),
    ...qualificationErrors(q, courses),
    ...(!q.description.trim() ? ["자격 설명을 입력해 주세요."] : []),
    ...validityErrors(q.validity),
    ...courses
      .filter(
        (c) =>
          q.courseIds.includes(c.id) &&
          !c.learningItems.some((i) => i.required),
      )
      .map(
        (c) =>
          `${c.title} v${c.version}에 필수 학습 항목이 없습니다. 새 인증Set 버전에서 학습 항목을 준비해 주세요.`,
      ),
    ...retiredCourses(q, courses).map(
      (c) =>
        `운영 종료된 인증Set ${c.title} v${c.version}을 제거하거나 대체해 주세요.`,
    ),
  ];
}

export function assessmentQuestions(
  course: Course,
  kind: Kind,
): (Question | PracticalQuestion)[] {
  return kind === "objective" ? course.questions : course.practicalQuestions;
}
export function assessmentPassScore(course: Course, kind: Kind) {
  return kind === "objective" ? course.passScore : course.practicalPassScore;
}
