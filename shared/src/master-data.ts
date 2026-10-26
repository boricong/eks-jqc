import type { State } from "./index.ts";
import type { OrganizationDocument } from "./organizations.ts";

export const masterCountLabels = {
  organizationQualificationRequirements: "조직 필요자격 지정",
  commonCourses: "공통인증Set 원본",
  qualificationTemplates: "기본자격",
  users: "사용자",
  organizations: "조직",
  qualifications: "자격 버전",
  courses: "인증Set 버전",
  knowledgeQuestions: "지식 평가 문항",
  subjectiveQuestions: "주관식 문항",
  scenarioQuestions: "상황 대응 문항",
  learningItems: "학습 항목",
  materials: "학습자료",
  administrators: "세부 관리자 지정",
};
export type MasterCounts = Record<keyof typeof masterCountLabels, number>;
export const clearedDataLabels = {
  planningRequests: "계획 요청",
  plans: "개인 계획",
  assignments: "배정",
  enrollments: "수강",
  subjectiveResponses: "주관식 답변",
  attempts: "평가 응시",
  completions: "인증Set 수료",
  certifications: "개인 인증",
  renewals: "재인증",
  comparisons: "이전 수행 비교 기록(보존 자료)",
  learningRecords: "과거 학습 기록",
  learningChecklists: "Auditor 학습 확인",
  notices: "시스템·팀 공지",
  notifications: "개인 알림",
  audits: "업무 변경 이력",
  requests: "업무 재시도 기록",
  catalogBatches: "일괄 관리 이력",
  lifecycleEvents: "상태 변경 이력",
  organizationAudits: "조직 변경 이력",
  organizationRequests: "조직 재시도 기록",
};
export type ClearedCounts = Record<keyof typeof clearedDataLabels, number>;
export interface MasterPayload {
  organizationQualificationRequirements: State["organizationQualificationRequirements"];
  commonCourses: State["commonCourses"];
  auditorPrograms?: State["auditorPrograms"];
  qualificationTemplates: State["qualificationTemplates"];
  users: State["users"];
  qualifications: State["qualifications"];
  courses: State["courses"];
  organizations: Pick<OrganizationDocument, "roots">;
}
export interface MasterFile {
  format: "eks-master";
  formatVersion: 14;
  stateSchemaVersion: 24 | 25;
  organizationSchemaVersion: 4;
  createdAt: string;
  counts: MasterCounts;
  sha256: string;
  payload: MasterPayload;
}
export interface MasterPreview {
  previewId: string;
  expiresAt: string;
  generation: string;
  stateRevision: number;
  organizationRevision: number;
  current: MasterCounts;
  preserved: MasterCounts;
  deleted: ClearedCounts;
  fileHash: string;
  fileCreatedAt?: string;
  compatibility?: string;
}
export interface MaintenanceReceipt {
  operationId: string;
  key: string;
  fingerprint: string;
  actorId: string;
  kind: "master-reset" | "master-import";
  completedAt: string;
  generation: string;
  previousGeneration: string;
  stateRevision: number;
  organizationRevision: number;
  preserved: MasterCounts;
  deleted: ClearedCounts;
  backups: { state: string; organizations: string };
}
