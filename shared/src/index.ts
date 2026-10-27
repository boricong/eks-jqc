import {
  QualificationPurposeSchema,
  RenewalBatchSchema,
} from "./renewal-batches.ts";
export * from "./renewal-batches.ts";
import {
  releaseVersionLabel,
  ReleaseVersionSchema,
  ReleaseInfoSchema,
  FrozenCriteriaSchema,
  CommonUpdateSchema,
  type ReleasePropagation,
} from "./releases.ts";
export * from "./releases.ts";
export * from "./test-data.ts";
import { AuditorCriteriaSchema } from "./auditor.ts";
import { OrganizationQualificationRequirementSchema } from "./organization-requirements.ts";
export * from "./organization-requirements.ts";
export {
  currentTeamQualifications,
  latestQualification,
} from "./current-qualifications.ts";
import {
  QualificationTemplateSchema,
  QualificationMetadataSchema,
} from "./qualification-templates.ts";
export * from "./qualification-templates.ts";
export * from "./documents.ts";
export * from "./team-users.ts";
export * from "./qualification-version.ts";
import { z } from "zod";
import {
  AuditorProgramSchema,
  AuditorDesignationSchema,
  AuditorAssignmentSchema,
  AuditorCertificationSchema,
} from "./auditor.ts";
export * from "./auditor.ts";
import {
  QualificationTypeSchema,
  qualificationProcessErrors,
} from "./qualification-types.ts";
export * from "./qualification-types.ts";
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
  LegacyPersonalPlanSchema,
  QualificationPolicySnapshotSchema,
  type QualificationPolicySnapshot,
  type QualificationVersionMode,
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
} from "./organizations.ts";
export * from "./organizations.ts";

export const BaseRoleSchema = z.enum([
  "learner",
  "evaluator",
  "admin",
  "system_operator",
]);
export const RoleSchema = z.enum([
  "learner",
  "evaluator",
  "admin",
  "system_operator",
  "organization_admin",
]);
export type Role = z.infer<typeof RoleSchema>;
export const roleLabels: Record<Role, string> = {
  learner: "학습자",
  evaluator: "Auditor",
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
  auditorDesignation: AuditorDesignationSchema.optional(),
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
  description: text.default(""),
});
export type LearningMaterial = z.infer<typeof MaterialSchema>;
const revision = {
  releaseVersion: ReleaseVersionSchema.nullable().optional(),
  releaseInfo: ReleaseInfoSchema.optional(),
  id,
  catalogCode: z.string().max(160).optional(),
  lv1OrganizationId: id,
  entityId: id,
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  title: z.string().max(300),
  parentId: id.optional(),
  deletedAt: z.iso.datetime().optional(),
  deletedBy: id.optional(),
  deletionReason: z.string().trim().min(1).max(2000).optional(),
};
export const SubjectiveQuestionSchema = z.object({ id, prompt: text }).strict();
export type SubjectiveQuestion = z.infer<typeof SubjectiveQuestionSchema>;
export const SubjectiveResponseSchema = z
  .object({
    id,
    enrollmentId: id,
    courseId: id,
    learnerId: id,
    revision: z.number().int().positive(),
    status: z.enum(["draft", "submitted"]),
    questions: z.array(SubjectiveQuestionSchema).min(1).max(500),
    answers: z.record(id, text),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    submittedAt: z.iso.datetime().optional(),
  })
  .strict();
export type SubjectiveResponse = z.infer<typeof SubjectiveResponseSchema>;
export interface SubjectiveResponseView {
  response: SubjectiveResponse | null;
  canWrite: boolean;
  reason: string;
  status: "unstarted" | "draft" | "submitted" | "closed";
}
export const CourseContentSchema = z.object({
  subjectiveEnabled: z.boolean().default(false),
  subjectiveQuestions: z.array(SubjectiveQuestionSchema).max(500).default([]),
  qualificationType: QualificationTypeSchema.default("auditee"),
  title: z.string().max(300),
  assessmentKinds: z.array(KindSchema).max(2),
  learningItems: z.array(LearningItemSchema).max(100).default([]),
  practicalPassScore: z.number().int().min(1).max(100).nullable(),
  passScore: z.number().int().min(1).max(100).nullable(),
  materials: z.array(MaterialSchema).max(100),
  questions: z.array(QuestionSchema).max(500),
  practicalQuestions: z.array(PracticalQuestionSchema).max(500),
});
export type CourseContent = z.infer<typeof CourseContentSchema>;
export const CommonCourseSchema = CourseContentSchema.extend({
  releaseVersion: ReleaseVersionSchema.optional(),
  headReleaseId: z.string().optional(),
  id,
  revision: z.number().int().positive(),
  operationalStatus: z.enum(["active", "retired"]),
  createdAt: z.iso.datetime(),
  createdBy: id,
  updatedAt: z.iso.datetime(),
  updatedBy: id,
});
export type CommonCourse = z.infer<typeof CommonCourseSchema>;
export const CommonCourseReleaseSchema = CourseContentSchema.extend({
  id: z.string(),
  commonCourseId: z.string(),
  sequence: z.number().int().positive(),
  releaseVersion: ReleaseVersionSchema,
  releaseInfo: ReleaseInfoSchema,
});
export const CourseSchema = CourseContentSchema.extend({
  ...revision,
  category: z.enum(["common", "specialized"]).default("specialized"),
  commonCourseSource: z
    .object({
      id,
      revision: z.number().int().positive(),
      baselineHash: z.string().regex(/^[a-f0-9]{64}$/),
      releaseId: z.string().optional(),
      releaseVersion: ReleaseVersionSchema.optional(),
    })
    .optional(),
  operationalStatus: z.enum(["active", "retired"]),
  retiredAt: z.iso.datetime().optional(),
  retiredBy: id.optional(),
  retirementReason: z.string().trim().min(1).max(2000).optional(),
});
export type Course = z.infer<typeof CourseSchema>;
export const QualificationSchema = z.object({
  purpose: QualificationPurposeSchema.optional(),
  auditorCriteria: AuditorCriteriaSchema.optional(),
  qualificationType: QualificationTypeSchema.default("auditee"),
  ...revision,
  version: z.number().int().positive().nullable(),
  lifecycleStatus: z.enum(["Ready", "Active", "Hold", "Revoke"]).optional(),
  renewalLeadMonths: RenewalLeadSchema.optional(),
  renewalNoticeDaysBefore: RenewalNoticeDaysSchema.optional(),
  commonCourseEntityIds: z.array(id).max(100).default([]),
  courseIds: z.array(id).max(100),
  englishName: z.string().max(300).default(""),
  description: text.default(""),
  validity: ValiditySchema.default(unknownValidity),
  templateId: id,
  templateRevision: z.number().int().positive(),
});
export type Qualification = z.infer<typeof QualificationSchema>;
export const qualificationPolicySnapshot = (
  q: Qualification,
): QualificationPolicySnapshot => QualificationPolicySnapshotSchema.parse(q);
// Only frozen content is overlaid: live status, deletion and permissions remain live.
export function qualificationForRecord(
  q: Qualification,
  record: {
    qualificationMetadata?: Partial<Qualification>;
    qualificationPolicySnapshot?: QualificationPolicySnapshot;
  },
): Qualification {
  return {
    ...q,
    ...record.qualificationMetadata,
    ...record.qualificationPolicySnapshot,
  };
}
export interface CatalogItemSavePreview {
  propagation?: ReleasePropagation;
  releaseChange?: {
    kind: "none" | "initial" | "minor" | "major";
    before: string;
    after: string;
    reasons: string[];
  };
  candidate: Course | Qualification;
  changes: { label: string; before: string; after: string }[];
  unchanged: boolean;
  newVersion: boolean;
  initialConfiguration?: boolean;
  references: Record<string, number>;
  stateRevision: number;
  organizationRevision: number;
  readiness: string[];
  linkedQualifications: {
    id: string;
    title: string;
    version: number | null;
    releaseVersion?: { major: number; minor: number } | null;
  }[];
  versionPolicy?: {
    changeKind: "none" | "minor" | "major";
    requiresNewVersion: boolean;
    effectiveMode: QualificationVersionMode;
    nextVersion: number;
  };
}
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
  renewalBatchId: z.string().optional(),
  frozenCriteria: FrozenCriteriaSchema.optional(),
  auditor: AuditorAssignmentSchema.optional(),
  qualificationMetadata: QualificationMetadataSchema.optional(),
  qualificationPolicySnapshot: QualificationPolicySnapshotSchema.optional(),
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
export const LearningConfirmationSchema = z.object({
  itemId: id,
  title: z.string().max(300),
  type: LearningItemSchema.shape.type,
  required: z.boolean(),
  confirmedBy: id,
  confirmedAt: z.iso.datetime(),
});
export const LearningChecklistSchema = z.object({
  enrollmentId: id,
  revision: z.number().int().nonnegative(),
  items: z.array(LearningConfirmationSchema).max(100),
});
export type LearningChecklist = z.infer<typeof LearningChecklistSchema>;
export const CompletionSchema = z.object({
  method: z.enum(["assessment", "self_confirmation"]).default("assessment"),
  learningEvidence: z.array(LearningConfirmationSchema).max(100).default([]),
  id,
  enrollmentId: id,
  learnerId: id,
  courseId: id,
  date: z.iso.datetime(),
  snapshot: AwardSnapshotSchema.optional(),
  evidence: z.array(z.object({ kind: KindSchema, attemptId: id })),
});
export type Completion = z.infer<typeof CompletionSchema>;
export const CertificationSchema = z.object({
  frozenCriteria: FrozenCriteriaSchema.optional(),
  auditor: AuditorCertificationSchema.optional(),
  qualificationMetadata: QualificationMetadataSchema.optional(),
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
// Retired 2026-10-24: retained only to preserve schema-13 files and backups.
// No application view or mutation API exposes these historical records.
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
export const StateSchema = z.object({
  schemaVersion: z.union([
    z.literal(25),
    z.literal(26),
    z.literal(27),
    z.literal(28),
  ]),
  organizationQualificationRequirements: z
    .array(OrganizationQualificationRequirementSchema)
    .default([]),
  commonCourses: z.array(CommonCourseSchema),
  commonCourseReleases: z.array(CommonCourseReleaseSchema).default([]),
  commonUpdates: z.array(CommonUpdateSchema).default([]),
  auditorPrograms: z.array(AuditorProgramSchema).default([]),
  qualificationTemplates: z.array(QualificationTemplateSchema),
  revision: z.number().int().nonnegative(),
  users: z.array(UserSchema),
  courses: z.array(CourseSchema),
  qualifications: z.array(QualificationSchema),
  assignments: z.array(AssignmentSchema),
  enrollments: z.array(EnrollmentSchema),
  attempts: z.array(AttemptSchema),
  subjectiveResponses: z.array(SubjectiveResponseSchema).default([]),
  completions: z.array(CompletionSchema),
  certifications: z.array(CertificationSchema),
  notices: z.array(NoticeSchema),
  comparisons: z.array(ComparisonSchema),
  audits: z.array(AuditSchema),
  requests: z.array(RequestRecordSchema),
  planningRequests: z.array(PlanningRequestSchema),
  plans: z.array(PersonalPlanSchema),
  learningRecords: z.array(LearningRecordSchema),
  learningChecklists: z.array(LearningChecklistSchema).default([]),
  notifications: z.array(NotificationSchema),
  catalogBatches: z.array(CatalogBatchSchema).default([]),
  renewalBatches: z.array(RenewalBatchSchema).default([]),
  renewals: z.array(RenewalSchema).default([]),
  lifecycleEvents: z.array(LifecycleEventSchema).default([]),
});
export const LegacyStateSchema = StateSchema.extend({
  plans: z.array(LegacyPersonalPlanSchema),
  schemaVersion: z.literal(11),
  qualificationTemplates: z.array(QualificationTemplateSchema).optional(),
  qualifications: z.array(
    QualificationSchema.extend({
      templateId: id.optional(),
      templateRevision: z.number().int().positive().optional(),
    }),
  ),
});
export type State = z.infer<typeof StateSchema>;
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
  subjective?: SubjectiveResponseView;
  objective: AssessmentState;
  practical: AssessmentState;
  answers: Draft["answers"];
  history: Attempt[];
  activeAttempts: Partial<Record<Kind, AssessmentAttempt>>;
  completion?: Completion;
  checklist?: LearningChecklist;
}
export interface Assignment extends StoredAssignment {
  renewalBatch?: z.infer<typeof RenewalBatchSchema>;
  enrollments: Enrollment[];
  certifiedAt?: string;
  certification?: Certification;
}
export interface Workspace {
  currentQualifications: {
    lv1OrganizationId: string;
    entityId: string;
    qualificationId: string;
  }[];
  requestProgress: import("./organizations.ts").RequestProgress[];
  planningOptions: import("./organizations.ts").PlanningRequestView[];
  planningReadiness: {
    qualificationType: import("./qualification-types.ts").QualificationType;
    learnerId: string;
    canRequest: boolean;
    reason: string;
    count: number;
    draftCount: number;
  }[];
  planEligibility: { planId: string; reasons: string[] }[];
  actor: UserView;
  serverDate: string;
  management: {
    lv1OrganizationId: string | null;
    canManage: boolean;
    canManageOrganizationSettings: boolean;
    canManageEligibility: boolean;
    editableOrganizationIds: string[];
  };
  organizations: OrganizationEntry[];
  users: UserView[];
  courses: (Course & {
    teamModified?: boolean;
    typeEditing?: { canChangeType: boolean; typeChangeReason: string };
  })[];
  qualifications: Qualification[];
  assignments: Assignment[];
  notices: Notice[];
  homeNotices: Notice[];
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
  qualifications: Pick<Qualification, "id" | "title" | "version">[];
  successorVersions: { id: string; version: number }[];
  counts: {
    assignments: number;
    enrollments: number;
    attempts: number;
    subjectiveResponses: number;
    completions: number;
    certifications: number;
    comparisons: number;
  };
}
export type DemoState = Workspace;
export const requiredKinds = (
  course: Pick<Course, "assessmentKinds"> &
    Partial<Pick<Course, "qualificationType">>,
): Kind[] =>
  course.qualificationType === "auditor" ? [] : course.assessmentKinds;
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
export function courseErrors(course: CourseContent): string[] {
  const errors: string[] = [];
  if (!course.title.trim()) errors.push("인증Set명을 입력해 주세요.");
  if (
    course.qualificationType !== "auditor" &&
    (!course.assessmentKinds.length ||
      new Set(course.assessmentKinds).size !== course.assessmentKinds.length)
  )
    errors.push("필수 평가 유형을 중복 없이 선택해 주세요.");
  if (
    new Set(course.learningItems.map((i) => i.id)).size !==
      course.learningItems.length ||
    course.learningItems.some((i) => !i.title.trim())
  )
    errors.push("학습 정보 · 교육의 이름·식별자를 확인해 주세요.");
  const all = [...course.questions, ...course.practicalQuestions];
  if (new Set(all.map((q) => q.id)).size !== all.length)
    errors.push("항목 식별자가 중복되었습니다.");
  if (
    new Set(course.materials.map((m) => m.id)).size !== course.materials.length
  )
    errors.push("자료 식별자가 중복되었습니다.");
  course.materials.forEach((m, i) => {
    if (!m.title.trim() || (m.type === "text" ? !m.content.trim() : !m.url))
      errors.push(`학습 정보 · 자료 ${i + 1}번의 이름과 내용을 확인해 주세요.`);
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
// Auditee completion uses assessments; only Auditor requires self-confirmable education.
export function courseUseErrors(course: CourseContent): string[] {
  return [
    ...courseErrors(course),
    ...(course.qualificationType !== "auditor" &&
    course.assessmentKinds.includes("practical") &&
    !course.assessmentKinds.includes("objective")
      ? ["상황 대응 평가를 사용하려면 지식 평가도 필수로 설정해 주세요."]
      : []),
    ...(course.qualificationType === "auditor" &&
    !course.learningItems.some((item) => item.required)
      ? ["운영하려면 필수 교육을 하나 이상 설정해 주세요."]
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
    q.courseIds.some((id) => !courses.some((c) => c.id === id)) &&
      "연결된 인증Set을 찾을 수 없습니다.",
  ].filter(Boolean) as string[];
}

// Eligibility for NEW use only. Historical qualifications and awards remain valid.
export function retiredCourses(q: Qualification, courses: Course[]): Course[] {
  return courses.filter(
    (c) => q.courseIds.includes(c.id) && c.operationalStatus === "retired",
  );
}
export function qualificationReadinessErrors(
  q: Qualification,
  courses: Course[],
): string[] {
  return [
    ...qualificationErrors(q, courses),
    ...(q.purpose === "renewal"
      ? renewalQualificationErrors(q, courses)
      : validityErrors(q.validity)),
    ...courses
      .filter((c) => q.courseIds.includes(c.id))
      .flatMap((c) =>
        courseUseErrors(c).map(
          (error) => `${c.title || "이름 없는 인증Set"}: ${error}`,
        ),
      ),
  ];
}
export function qualificationUseErrors(
  q: Qualification,
  courses: Course[],
): string[] {
  return [
    ...(q.version === null || q.lifecycleStatus === "Ready"
      ? ["Ready · 대기 상태입니다. 최초 기준을 저장해 주세요."]
      : []),
    ...qualificationProcessErrors(q),
    ...(q.deletedAt
      ? ["삭제된 자격으로 신규 계획·재인증을 시작할 수 없습니다."]
      : []),
    ...(q.lifecycleStatus && q.lifecycleStatus !== "Active"
      ? [
          `자격 기준 ${q.lifecycleStatus} 상태로 신규 계획·재인증을 시작할 수 없습니다.`,
        ]
      : []),
    ...qualificationReadinessErrors(q, courses),
    ...retiredCourses(q, courses).map(
      (c) =>
        `운영 종료된 인증Set ${c.title} ${releaseVersionLabel(c)}을 제거하거나 대체해 주세요.`,
    ),
  ];
}

export function assessmentQuestions(
  course: CourseContent,
  kind: Kind,
): (Question | PracticalQuestion)[] {
  return kind === "objective" ? course.questions : course.practicalQuestions;
}
export function assessmentPassScore(course: CourseContent, kind: Kind) {
  return kind === "objective" ? course.passScore : course.practicalPassScore;
}

export * from "./dashboard.ts";

export const courseCategoryLabels = {
  common: "공통인증Set",
  specialized: "특화인증Set",
};
/** Stable content for comparison: item identity and transport codes are not curriculum. */
export function comparableCourseContent(course: CourseContent) {
  const content = CourseContentSchema.parse(course);
  // Empty disabled fields preserve pre-v22 common-copy hashes.
  const canonical = { ...content } as Partial<CourseContent>;
  if (!content.subjectiveEnabled && !content.subjectiveQuestions.length) {
    delete canonical.subjectiveEnabled;
    delete canonical.subjectiveQuestions;
  }
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => k !== "id" && k !== "catalogCode")
          .map(([k, v]) => [k, clean(v)]),
      );
    return value;
  };
  return clean(canonical);
}

export function subjectiveIssues(course: CourseContent): string[] {
  if (!course.subjectiveEnabled) return [];
  if (course.qualificationType !== "auditee")
    return ["주관식 평가는 Auditee에서만 사용합니다."];
  if (!course.subjectiveQuestions.length)
    return ["주관식 문항을 추가해 주세요."];
  return course.subjectiveQuestions.flatMap((q, i) =>
    q.prompt.trim() ? [] : [`주관식 ${i + 1}번 문제를 입력해 주세요.`],
  );
}

export function renewalQualificationErrors(
  q: Qualification,
  courses: Course[],
): string[] {
  if (q.purpose !== "renewal") return [];
  const c = courses.find((c) => c.id === q.courseIds[0]);
  return [
    q.qualificationType !== "auditee" && "재인증은 Auditee만 지원합니다.",
    q.courseIds.length !== 1 &&
      "재인증에는 객관식 인증Set 1개를 연결해 주세요.",
    c &&
      (c.assessmentKinds.length !== 1 ||
        c.assessmentKinds[0] !== "objective" ||
        c.practicalQuestions.length ||
        c.subjectiveEnabled ||
        c.subjectiveQuestions.length) &&
      "재인증 인증Set은 객관식 문항만 사용할 수 있습니다. 상황·주관식 문항을 제거해 주세요.",
  ].filter(Boolean) as string[];
}
