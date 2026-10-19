import type { OrganizationDocument, State } from "@eks/contracts";
import { PHOTO_ID, organization } from "./organizations.ts";
import { validateState } from "./integrity.ts";
import { demand } from "./errors.ts";

export function migrateState(
  input: unknown,
  organizations: OrganizationDocument,
): State {
  const source = structuredClone(input) as any;
  if (source?.schemaVersion === 3) return validateState(source, organizations);
  demand(
    [1, 2].includes(source?.schemaVersion),
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
  source.schemaVersion = 3;
  source.revision++;
  for (const course of source.courses) {
    course.operationalStatus = "active";
    delete course.retiredAt;
    delete course.retiredBy;
    delete course.retirementReason;
  }
  return validateState(source, organizations);
}
