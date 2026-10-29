import { migrateAdministration } from "./administration-migration.ts";
import {
  type State,
  type OrganizationDocument,
  organizationEntries,
} from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";

export function migratePolicies(raw: any, organizationRaw: any) {
  if (raw?.schemaVersion === 29) {
    const organizations = validateOrganizations(organizationRaw),
      state = validateState(raw, organizations);
    return {
      state,
      organizations,
      report: {
        alreadyApplied: true,
        revision: state.revision,
        organizationRevision: organizations.revision,
      },
    };
  }
  if (
    [
      7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28,
    ].includes(raw.schemaVersion) &&
    [2, 3, 4].includes(organizationRaw.schemaVersion)
  ) {
    const organizations = validateOrganizations(organizationRaw),
      state = migrateAdministration(raw, organizations).state;
    return {
      state,
      organizations,
      report: {
        alreadyApplied: raw.schemaVersion >= 25,
        revision: state.revision,
        organizationRevision: organizations.revision,
      },
    };
  }
  if (raw.schemaVersion !== 6 || organizationRaw.schemaVersion !== 1)
    throw new Error(
      "업무 스키마6·조직 스키마1의 일치하는 파일 쌍이 필요합니다. 부분 이관은 백업 쌍으로 복구해 주세요.",
    );
  const organizations: OrganizationDocument = validateOrganizations({
    ...structuredClone(organizationRaw),
    schemaVersion: 2,
    qualificationPools: [],
    revision: organizationRaw.revision + 1,
  });
  const next = structuredClone(raw);
  next.schemaVersion = 7;
  next.revision++;
  const entries = organizationEntries(organizations);
  for (const r of next.planningRequests) {
    const user = next.users.find((u: any) => u.id === r.learnerId);
    const selected = next.plans
      .filter((p: any) => p.requestId === r.id)
      .map((p: any) =>
        next.qualifications.find((q: any) => q.id === p.qualificationId),
      );
    r.organizationId = user.organizationId;
    r.organizationPath = entries.find(
      (e) => e.id === user.organizationId,
    )!.path;
    r.targets = [
      ...new Map(
        selected.map((q: any) => [
          q.entityId,
          {
            entityId: q.entityId,
            qualificationId: q.id,
            title: q.title,
            version: q.version,
          },
        ]),
      ).values(),
    ];
    r.source = "migration";
  }
  for (const p of next.plans)
    p.organizationId = next.planningRequests.find(
      (r: any) => r.id === p.requestId,
    )?.organizationId;
  const notice = next.notices.find(
    (n: any) =>
      n.id === "notice-2" && /필수 학습 기록 후|학습 완료 기록 후/.test(n.body),
  );
  if (notice) {
    notice.body =
      "학습 안내에서 범위와 자료를 확인한 뒤 지식·상황 대응 평가에 응시해 주세요. 별도 학습 완료 기록 없이 유형별 통과 시 수료됩니다.";
    notice.revision++;
  }
  next.audits.push({
    id: "organization-policies-v7",
    actorId: next.users.find((u: any) => u.roles.includes("system_operator"))
      .id,
    date: new Date().toISOString(),
    action: "migration.organization-policies",
    targetId: "organization-policies-v7",
    reason:
      "조직별 필수 자격·학습 안내 전환. 기존 진행과 과거 학습 기록 보존, 필수 목록은 관리자가 선정.",
    details: { fromSchema: 6, fromOrganizationSchema: 1 },
  });
  const state: State = migrateAdministration(next, organizations).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied: false,
      revision: state.revision,
      organizationRevision: organizations.revision,
      counts: Object.fromEntries(
        Object.entries(state)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => [k, (v as unknown[]).length]),
      ),
      learningRecordsPreserved: state.learningRecords.length,
    },
  };
}
