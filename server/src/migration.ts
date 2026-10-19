import {
  unknownValidity,
  type OrganizationDocument,
  type State,
} from "@eks/contracts";
import { PHOTO_ID, organization } from "./organizations.ts";
import { validateState } from "./integrity.ts";
import { demand } from "./errors.ts";

export function migrateState(
  input: unknown,
  organizations: OrganizationDocument,
): State {
  const source = structuredClone(input) as any;
  if (source?.schemaVersion === 5) return validateState(source, organizations);
  if (source?.schemaVersion === 4) {
    source.schemaVersion = 5;
    source.catalogBatches = [];
    source.revision++;
    return validateState(source, organizations);
  }
  demand(
    [1, 2, 3].includes(source?.schemaVersion),
    422,
    "지원하지 않는 데이터 버전입니다.",
  );
  if (source.schemaVersion === 1) {
    const photo = organization(organizations, PHOTO_ID);
    demand(photo.level === 1, 422, "이관 대상 Photo Lv1 조직을 확인해 주세요.");
    for (const user of source.users) {
      user.organizationId = PHOTO_ID;
      user.revision = 1;
    }
    demand(
      !source.users.some((u: any) => u.id === "operator-1"),
      422,
      "operator-1 계정 ID가 이미 사용 중입니다.",
    );
    source.users.push({
      id: "operator-1",
      name: "시스템 운영자",
      roles: ["system_operator"],
      organizationId: PHOTO_ID,
      revision: 1,
    });
    for (const record of [
      ...source.courses,
      ...source.qualifications,
      ...source.assignments,
      ...source.notices,
    ])
      record.lv1OrganizationId = PHOTO_ID;
    for (const assignment of source.assignments) {
      assignment.organizationPath = photo.path;
      assignment.organizationSource = "migration";
    }
    for (const event of source.audits)
      if (event.action !== "progress.reset") event.lv1OrganizationId = PHOTO_ID;
    for (const request of source.requests) {
      const reset = source.audits.some(
        (ev: any) =>
          ev.action === "progress.reset" &&
          ev.targetId === request.response?.id,
      );
      request.action = reset ? "progress.reset" : "legacy";
      if (!reset) request.lv1OrganizationId = PHOTO_ID;
    }
  }
  if (source.schemaVersion < 3)
    for (const course of source.courses) {
      course.operationalStatus = "active";
      delete course.retiredAt;
      delete course.retiredBy;
      delete course.retirementReason;
    }
  for (const course of source.courses) {
    course.assessmentKinds =
      course.mode === "both" ? ["objective", "practical"] : [course.mode];
    delete course.mode;
    course.learningItems = [];
    course.subjectiveQuestions = [];
    course.subjectivePassScore = null;
  }
  for (const q of source.qualifications) {
    q.englishName = "";
    q.description = "";
    q.validity = unknownValidity();
  }
  for (const t of source.attempts)
    if (t.status === "submitted") {
      t.status = "graded";
      t.submittedAt = t.date;
    }
  for (const a of source.assignments) a.createdBy = a.ownerAdminId;
  for (const award of [...source.completions, ...source.certifications]) {
    const a = source.assignments.find(
      (a: any) =>
        a.id ===
        (award.assignmentId ||
          source.enrollments.find((e: any) => e.id === award.enrollmentId)
            ?.assignmentId),
    );
    const catalog = award.courseId
      ? source.courses.find((c: any) => c.id === award.courseId)
      : source.qualifications.find((q: any) => q.id === award.qualificationId);
    demand(a && catalog, 422, "이관할 인증 근거를 확인해 주세요.");
    award.snapshot = {
      learnerName: source.users.find((u: any) => u.id === award.learnerId)
        ?.name,
      organizationPath: a.organizationPath,
      title: catalog.title,
      version: catalog.version,
      source: "migration",
    };
    if (award.qualificationId) award.validity = unknownValidity();
  }
  source.planningRequests = [];
  source.plans = [];
  source.learningRecords = [];
  source.notifications = [];
  source.schemaVersion = 5;
  source.catalogBatches = [];
  source.revision++;
  return validateState(source, organizations);
}
