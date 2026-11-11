import { z } from "zod";
const id = z
  .string()
  .min(1)
  .max(160)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v));
const text = z.string().max(20000);
export const MentorPracticalConfigSchema = z
  .object({
    passScore: z.number().int().min(1).max(100).nullable(),
    questions: z
      .array(
        z
          .object({
            id,
            prompt: text,
            points: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type MentorPracticalConfig = z.infer<typeof MentorPracticalConfigSchema>;
export function mentorPracticalErrors(c: MentorPracticalConfig): string[] {
  return [
    !c.passScore && "실기(주관식) 합격 기준을 입력해 주세요.",
    !c.questions.length && "실기(주관식) 문항을 추가해 주세요.",
    c.questions.some((q) => !q.prompt.trim()) &&
      "실기(주관식) 문항 내용을 입력해 주세요.",
    new Set(c.questions.map((q) => q.id)).size !== c.questions.length &&
      "실기(주관식) 문항 식별자가 중복되었습니다.",
  ].filter((v): v is string => !!v);
}
export const MentorAssignmentSchema = z
  .object({
    enrollmentId: id,
    mentorId: id,
    revision: z.number().int().positive(),
    assignedBy: id,
    assignedAt: z.iso.datetime(),
    history: z.array(
      z
        .object({
          mentorId: id,
          changedBy: id,
          changedAt: z.iso.datetime(),
          reason: z.string().max(2000),
        })
        .strict(),
    ),
  })
  .strict();
export type MentorAssignment = z.infer<typeof MentorAssignmentSchema>;
export const MentorGradingSchema = z
  .object({
    scores: z.record(id, z.number().min(0).max(1000).multipleOf(0.01)),
    feedback: z.record(id, z.string().max(2000)),
    comment: z.string().max(4000),
    savedBy: id,
    savedAt: z.iso.datetime(),
  })
  .strict();
export const MentorAttemptSchema = z
  .object({
    id,
    enrollmentId: id,
    courseId: id,
    learnerId: id,
    revision: z.number().int().positive(),
    round: z.number().int().positive(),
    status: z.enum(["draft", "submitted", "graded"]),
    createdAt: z.iso.datetime(),
    submittedAt: z.iso.datetime().optional(),
    courseHash: z.string().regex(/^[a-f0-9]{64}$/),
    questions: MentorPracticalConfigSchema.shape.questions,
    passScore: z.number().int().min(1).max(100),
    answers: z.record(id, text),
    grading: MentorGradingSchema.optional(),
    previousGradings: z.array(MentorGradingSchema),
    gradedBy: id.optional(),
    gradedAt: z.iso.datetime().optional(),
    earned: z.number().nonnegative().optional(),
    total: z.number().positive().optional(),
    result: z.enum(["passed", "failed"]).optional(),
  })
  .strict();
export type MentorAttempt = z.infer<typeof MentorAttemptSchema>;
export const MentorCompletionSchema = z
  .object({
    attemptId: id,
    mentorId: id,
    earned: z.number().nonnegative(),
    total: z.number().positive(),
    passScore: z.number().int().min(1).max(100),
  })
  .strict();
export type MentorCompletion = z.infer<typeof MentorCompletionSchema>;
export interface MentorProgress {
  mentorId?: string;
  mentorName?: string;
  status: "unassigned" | "ready" | "draft" | "submitted" | "passed" | "failed";
  round: number;
  earned?: number;
  total?: number;
}
export interface MentorPreview {
  token: string;
  blockers: string[];
  earned: number;
  total: number;
  passScore: number;
  result: "passed" | "failed";
  wouldComplete: boolean;
  wouldCertify: boolean;
}
export const mentorStatusLabels: Record<MentorProgress["status"], string> = {
  unassigned: "멘토 지정 대기",
  ready: "수행 전",
  draft: "답변 작성 중",
  submitted: "멘토 채점 대기",
  passed: "합격",
  failed: "불합격 · 재응시 가능",
};
export interface MentorPracticalView {
  enrollmentId: string;
  assignmentId: string;
  course: {
    id: string;
    title: string;
    version: number;
    releaseVersion?: { major: number; minor: number } | null;
    mentorPractical?: MentorPracticalConfig;
  };
  learnerName: string;
  mentorName?: string;
  assignment?: MentorAssignment;
  attempts: MentorAttempt[];
  owner: boolean;
  manager: boolean;
  mentor: boolean;
  blockers: string[];
  canWrite: boolean;
  canGrade: boolean;
  completed: boolean;
}
export interface MentorPracticalList {
  enabled: boolean;
  rows: {
    enrollmentId: string;
    learnerId: string;
    learnerName: string;
    courseTitle: string;
    courseVersion: string;
    progress?: MentorProgress;
    completed: boolean;
  }[];
  mentors: { id: string; name: string }[];
}
