import { z } from "zod";
export const TEST_DATA_RECIPE_VERSION = 2 as const;
export const testDataCountLabels = {
  qualificationTemplates: "기본자격",
  qualifications: "팀 자격 버전",
  commonCourses: "공통인증Set 원본",
  commonCourseReleases: "공통 원본 버전",
  courses: "팀 인증Set 버전",
  commonUpdates: "공통 반영 보류·처리",
  auditorPrograms: "Auditor 안내·운영 설정",
  organizationQualificationRequirements: "조직 필요자격 지정",
  planningRequests: "계획 요청",
  plans: "개인 계획",
  assignments: "배정",
  enrollments: "수강",
  attempts: "평가 응시",
  subjectiveResponses: "주관식 답변",
  completions: "인증Set 수료",
  certifications: "자격 인증",
  renewals: "재인증",
  learningRecords: "과거 학습 기록",
  learningChecklists: "교육 본인 확인",
  comparisons: "과거 수행 비교",
  notices: "공지",
  notifications: "알림",
  audits: "업무 변경 이력",
  requests: "업무 재시도 기록",
  catalogBatches: "과거 일괄 관리 이력",
  lifecycleEvents: "상태 변경 이력",
  organizationDetails: "조직 설명·담당 업무",
  organizationAudits: "조직 변경 이력",
  organizationRequests: "조직 재시도 기록",
  legacySnapshots: "과거 테스트 보존 사본",
};
export type TestDataCounts = Record<keyof typeof testDataCountLabels, number>;
export const TestDataActionSchema = z.enum(["load", "reset"]);
export type TestDataAction = z.infer<typeof TestDataActionSchema>;
export const TestDataReceiptSchema = z
  .object({
    operationId: z.string().uuid(),
    key: z.string().min(1).max(160),
    actorId: z.string().min(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    action: TestDataActionSchema,
    completedAt: z.iso.datetime(),
    generation: z.string().uuid(),
    recipeVersion: z.union([z.literal(1), z.literal(TEST_DATA_RECIPE_VERSION)]),
    stateRevision: z.number().int().nonnegative(),
    organizationRevision: z.number().int().nonnegative(),
    before: z.record(z.string(), z.number().int().nonnegative()),
    after: z.record(z.string(), z.number().int().nonnegative()),
    backups: z
      .object({
        state: z.string(),
        organizations: z.string(),
        maintenance: z.string(),
      })
      .strict(),
  })
  .strict();
export type TestDataReceipt = z.infer<typeof TestDataReceiptSchema>;
export interface TestDataStatus {
  canLoad: boolean;
  canReset: boolean;
  counts: TestDataCounts;
  preserved: { users: number; organizations: number };
  teams: { id: string; name: string }[];
  blockers: string[];
  warnings: string[];
  recipe: {
    version: typeof TEST_DATA_RECIPE_VERSION;
    templates: number;
    commonOriginals: number;
    specializedPerTeam: number;
    specialized: number;
    qualifications: number;
    commonCopies: number;
  };
  qualifications: {
    id: string;
    title: string;
    teamId: string;
    qualificationType: string;
  }[];
  operation?: TestDataReceipt | null;
}
export interface TestDataPreview {
  previewId: string;
  action: TestDataAction;
  expiresAt: string;
  before: TestDataCounts;
  after: TestDataCounts;
  preserved: TestDataStatus["preserved"];
  warnings: string[];
  recipe: TestDataStatus["recipe"];
}
