import { migrateRequirementExceptions } from "./requirement-exception-migration.ts";
import { randomUUID } from "node:crypto";
import {
  CourseContentSchema,
  qualificationForRecord,
  currentTeamQualifications,
  type State,
} from "@eks/contracts";
import { releaseNumber, freezeCriteria, releaseInfo } from "./releases.ts";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";

/** Called only by initialization, explicit migration and legacy master-file import. */
export function initializeReleases(raw: any, at = new Date().toISOString()) {
  raw.commonCourseReleases ||= [];
  raw.commonUpdates ||= [];
  const legacyQualificationIds = new Set(
    raw.qualifications.filter((q: any) => !q.releaseInfo).map((q: any) => q.id),
  );
  const actorId =
    raw.users.find((u: any) => u.roles.includes("system_operator"))?.id ||
    "migration";
  for (const q of raw.qualifications) {
    q.releaseVersion ??=
      q.version === null ? null : { major: q.version, minor: 0 };
    q.releaseInfo ||= {
      ...releaseInfo("migration", actorId, "기존 버전 보존"),
      createdAt: at,
    };
  }
  for (const c of raw.courses) {
    c.releaseVersion ||= { major: c.version, minor: 0 };
    c.releaseInfo ||= {
      ...releaseInfo("migration", actorId, "기존 버전 보존"),
      createdAt: at,
    };
  }
  for (const c of raw.commonCourses) {
    if (c.headReleaseId) continue;
    const release = {
      ...CourseContentSchema.parse(c),
      id: `legacy-common:${c.id}:${c.revision}`,
      commonCourseId: c.id,
      sequence: 1,
      releaseVersion: { major: 1, minor: 0 },
      releaseInfo: {
        ...releaseInfo("migration", actorId, "이관 시 확보한 공통 원본"),
        createdAt: at,
      },
    };
    raw.commonCourseReleases.push(release);
    c.releaseVersion = release.releaseVersion;
    c.headReleaseId = release.id;
  }
  for (const record of [
    ...raw.plans,
    ...raw.assignments,
    ...raw.completions,
    ...raw.certifications,
  ]) {
    for (const snapshot of [
      record.snapshot,
      record.qualificationPolicySnapshot,
    ])
      if (snapshot?.version && !snapshot.releaseVersion)
        snapshot.releaseVersion = { major: snapshot.version, minor: 0 };
  }
  for (const a of raw.assignments) {
    const q = raw.qualifications.find((q: any) => q.id === a.qualificationId);
    if (!q) throw Error("기존 배정의 자격 참조를 확인해 주세요.");
    if (!a.frozenCriteria && q.version !== null)
      a.frozenCriteria = freezeCriteria(
        raw,
        qualificationForRecord(q, a),
        a.createdBy || actorId,
        "migration",
        a.assignedAt,
      );
    const p = raw.plans.find((p: any) => p.id === a.planId);
    if (p?.status === "completed" && !p.frozenCriteria)
      p.frozenCriteria = structuredClone(a.frozenCriteria);
    for (const cert of raw.certifications.filter(
      (c: any) => c.assignmentId === a.id,
    ))
      cert.frozenCriteria ||= structuredClone(a.frozenCriteria);
  }
  for (const ref of currentTeamQualifications(raw)) {
    const q = raw.qualifications.find((q: any) => q.id === ref.qualificationId);
    const t = raw.qualificationTemplates.find(
      (t: any) => t.id === q.templateId,
    );
    if (t && legacyQualificationIds.has(q.id))
      Object.assign(q, {
        title: t.title,
        englishName: t.englishName,
        description: t.description,
        templateRevision: t.revision,
      });
  }
  raw.schemaVersion = 26;
  return raw as State;
}
export function migrateReleases(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = structuredClone(input) as any,
    organizations = validateOrganizations(orgInput);
  if (![25, 26, 27, 28].includes(raw?.schemaVersion))
    throw Error("버전 이관은 업무25·26 또는 현행27 파일이 필요합니다.");
  const alreadyApplied = raw.schemaVersion >= 26;
  if (!alreadyApplied) {
    // Validate historical relationships before adding any metadata.
    validateState(raw, organizations);
    initializeReleases(raw, at);
    raw.revision++;
    raw.audits.push({
      id: randomUUID(),
      actorId: raw.users.find((u: any) => u.roles.includes("system_operator"))!
        .id,
      date: at,
      action: "migration.releases",
      targetId: "releases-v26",
      reason: "불변 메이저·마이너 버전과 당시 기준 보존",
      details: { fromSchema: 25, progressReset: false },
    });
  }
  const state = migrateRequirementExceptions(raw, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied: alreadyApplied && (input as any).schemaVersion === 28,
      schemaVersion: 28,
      revision: state.revision,
      organizationRevision: organizations.revision,
      progressReset: false,
      courses: state.courses.length,
      qualifications: state.qualifications.length,
      commonReleases: state.commonCourseReleases.length,
    },
  };
}
