import { z } from "zod";
import {
  OrganizationPathSchema,
  RequestRecordSchema,
  type OrganizationEntry,
  type ResetScope,
} from "./organizations.ts";
export * from "./organizations.ts";

export const RoleSchema = z.enum(["learner", "ft", "admin", "system_operator"]);
export type Role = z.infer<typeof RoleSchema>;
export const roleLabels: Record<Role, string> = {
  learner: "학습자",
  ft: "FT",
  admin: "조직 관리자",
  system_operator: "시스템 운영자",
};
export const KindSchema = z.enum(["objective", "practical"]);
export type Kind = z.infer<typeof KindSchema>;
export type AssessmentState =
  "ready" | "draft" | "waiting" | "passed" | "failed";
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
  name: z.string().min(1).max(100),
  roles: z.array(RoleSchema).min(1),
  organizationId: id,
  revision: z.number().int().positive(),
});
export type User = z.infer<typeof UserSchema>;
export interface UserView extends User {
  lv1OrganizationId: string;
  organizationPath: { id: string; name: string }[];
  organizationActive: boolean;
}
export const QuestionSchema = z.object({
  id,
  prompt: text,
  choices: z.array(z.string().max(2000)).max(50),
  correct: z.number().int().nonnegative().nullable().optional(),
  points: z.number().int().min(1).max(1000000),
  category: z.enum(["written", "case"]),
});
export type Question = z.infer<typeof QuestionSchema>;
export const PracticalItemSchema = z.object({
  id,
  title: text,
  criterion: text,
  mandatory: z.boolean(),
});
export type PracticalItem = z.infer<typeof PracticalItemSchema>;
const revision = {
  id,
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
  mode: z.enum(["both", "objective", "practical"]),
  passScore: z.number().int().min(1).max(100).nullable(),
  material: text,
  materialUrl: url,
  instruction: text,
  questions: z.array(QuestionSchema).max(500),
  practicalItems: z.array(PracticalItemSchema).max(500),
});
export type Course = z.infer<typeof CourseSchema>;
export const QualificationSchema = z.object({
  ...revision,
  courseIds: z.array(id).max(100),
});
export type Qualification = z.infer<typeof QualificationSchema>;
export const VerdictSchema = z.object({
  value: z.enum(["pass", "fail", ""]),
  evidence: text,
});
export type Verdict = z.infer<typeof VerdictSchema>;
export const DraftSchema = z.object({
  answers: z.record(id, z.number().int().nonnegative()),
  verdicts: z.record(id, VerdictSchema),
});
export type Draft = z.infer<typeof DraftSchema>;
export const AttemptSchema = z.object({
  id,
  enrollmentId: id,
  courseId: id,
  learnerId: id,
  kind: KindSchema,
  round: z.number().int().positive(),
  status: z.enum(["in_progress", "submitted"]),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  date: z.iso.datetime().optional(),
  evaluatorId: id.optional(),
  result: z.enum(["passed", "failed"]).optional(),
  answers: DraftSchema.shape.answers,
  verdicts: DraftSchema.shape.verdicts,
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
  lv1OrganizationId: id,
  organizationPath: OrganizationPathSchema,
  organizationSource: z.enum(["assigned", "migration"]),
  qualificationId: id,
  learnerId: id,
  ftId: id.nullable(),
  ownerAdminId: id,
  assignedAt: z.iso.datetime(),
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
  evidence: z.array(z.object({ kind: KindSchema, attemptId: id })).min(1),
});
export type Completion = z.infer<typeof CompletionSchema>;
export const CertificationSchema = z.object({
  id,
  assignmentId: id,
  learnerId: id,
  qualificationId: id,
  date: z.iso.datetime(),
  evidence: z.array(z.object({ enrollmentId: id, completionId: id })).min(1),
});
export type Certification = z.infer<typeof CertificationSchema>;
export const NoticeSchema = z.object({
  id,
  lv1OrganizationId: id,
  title: z.string().min(1).max(300),
  body: text.min(1),
  date: z.iso.date(),
  published: z.boolean(),
  revision: z.number().int().positive(),
});
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
  schemaVersion: z.literal(3),
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
});
export type State = z.infer<typeof StateSchema>;
export interface ProgressSummary {
  revision: number;
  scope: ResetScope;
  counts: {
    objectiveAttempts: number;
    practicalAttempts: number;
    completions: number;
    certifications: number;
    comparisons: number;
  };
}

// Client projections contain only the fields accessible to the selected actor.
export interface Attempt extends Partial<Draft> {
  id: string;
  kind: Kind;
  round: number;
  result: "passed" | "failed";
  date: string;
  evaluatorId?: string;
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
  verdicts: Draft["verdicts"];
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
  actor: UserView;
  management: { lv1OrganizationId: string | null; canManage: boolean };
  organizations: OrganizationEntry[];
  users: UserView[];
  courses: Course[];
  qualifications: Qualification[];
  assignments: Assignment[];
  notices: Notice[];
  comparisons: Comparison[];
  audits: AuditEvent[];
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
export const requiredKinds = (course: Pick<Course, "mode">): Kind[] =>
  course.mode === "both" ? ["objective", "practical"] : [course.mode];
export function courseErrors(course: Course): string[] {
  const errors: string[] = [];
  if (!course.title.trim()) errors.push("과정명을 입력해 주세요.");
  if (
    new Set([...course.questions, ...course.practicalItems].map((i) => i.id))
      .size !==
    course.questions.length + course.practicalItems.length
  )
    errors.push("항목 식별자가 중복되었습니다.");
  if (requiredKinds(course).includes("objective")) {
    if (!course.passScore || course.passScore < 1 || course.passScore > 100)
      errors.push("객관식 합격 기준을 1~100으로 입력해 주세요.");
    if (!course.questions.length) errors.push("객관식 문항을 추가해 주세요.");
    course.questions.forEach((q, i) => {
      if (
        !q.prompt.trim() ||
        q.choices.length < 2 ||
        q.choices.some((v) => !v.trim()) ||
        q.correct == null ||
        !q.choices[q.correct] ||
        q.points <= 0
      )
        errors.push(
          `객관식 ${i + 1}번의 문항·선택지·정답·배점을 확인해 주세요.`,
        );
    });
  }
  if (requiredKinds(course).includes("practical")) {
    if (!course.practicalItems.some((i) => i.mandatory))
      errors.push("필수 실기 항목을 추가해 주세요.");
    if (
      course.practicalItems.some((i) => !i.title.trim() || !i.criterion.trim())
    )
      errors.push("실기 항목과 판정 기준을 입력해 주세요.");
  }
  return errors;
}
export function qualificationErrors(
  q: Qualification,
  courses: Course[],
): string[] {
  return [
    !q.title.trim() && "자격명을 입력해 주세요.",
    !q.courseIds.length && "필수 과정을 선택해 주세요.",
    new Set(q.courseIds).size !== q.courseIds.length &&
      "필수 과정이 중복되었습니다.",
    q.courseIds.some(
      (id) => courses.find((c) => c.id === id)?.status !== "published",
    ) && "필수 과정을 먼저 사용 등록해 주세요.",
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
    ...qualificationErrors(q, courses),
    ...retiredCourses(q, courses).map(
      (c) =>
        `운영 종료된 과정 ${c.title} v${c.version}을 제거하거나 대체해 주세요.`,
    ),
  ];
}
