import { migrateSubjective } from "./subjective-migration.ts";
import { randomUUID } from "node:crypto";
import {
  LegacyOrganizationNodeSchema,
  StateSchema,
  LegacyPersonalPlanSchema,
  PlanningRequestSchema,
  PlanningTargetSchema,
} from "@eks/contracts";
import { z } from "zod";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";

/** Explicit maintenance/import only. Current loads reject old organization documents. */
export function migrateOrganizationRequirements(
  input: unknown,
  actorId = "migration",
  at = new Date().toISOString(),
) {
  const doc = structuredClone(input) as any;
  if (doc?.schemaVersion === 3) {
    const roots = z.array(LegacyOrganizationNodeSchema).parse(doc.roots);
    const before: {
      organizationId: string;
      requiredQualifications: string[] | null;
    }[] = [];
    const pending: any[] = roots.slice();
    while (pending.length) {
      const node = pending.pop()!;
      before.push({
        organizationId: node.id,
        requiredQualifications: node.requiredQualifications ?? null,
      });
      delete node.requiredQualifications;
      pending.push(...node.children);
    }
    doc.roots = roots;
    doc.schemaVersion = 4;
    doc.revision++;
    doc.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      targetId: "organization-requirements-v4",
      action: "migration.remove-required-qualifications",
      before,
      after: { requirementsRemoved: true },
    });
  }
  return validateOrganizations(doc);
}

export function migrateRequiredQualifications(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
  allowUpgradedOrganization = false,
) {
  const raw = structuredClone(input) as any;
  if (![20, 21, 22, 23, 24, 25].includes(raw?.schemaVersion))
    throw new Error(
      "필수자격 종료 이관에는 업무20·조직3 또는 현행 파일 쌍이 필요합니다.",
    );
  if (
    raw.schemaVersion === 20 &&
    (orgInput as any)?.schemaVersion !== 3 &&
    !allowUpgradedOrganization
  )
    throw new Error(
      "업무20·조직3의 일치하는 파일 쌍이 필요합니다. 부분 이관은 백업 쌍으로 복구해 주세요.",
    );
  if (raw.schemaVersion >= 21) return migrateSubjective(raw, orgInput, at);
  // Parse all former fields before conversion; do not silently discard a target snapshot.
  const LegacyState20 = StateSchema.extend({
    schemaVersion: z.literal(20),
    plans: z.array(LegacyPersonalPlanSchema),
    planningRequests: z.array(
      PlanningRequestSchema.extend({
        targets: z.array(PlanningTargetSchema).optional(),
      }),
    ),
  });
  const state = LegacyState20.parse(raw) as any;
  const actorId = state.users.find((u: any) =>
    u.roles.includes("system_operator"),
  )?.id;
  if (!actorId) throw new Error("시스템 운영자가 필요합니다.");
  const organizations = migrateOrganizationRequirements(orgInput, actorId, at);
  let convertedRequests = 0;
  for (const request of state.planningRequests) {
    const before = structuredClone(request);
    const selections = new Map<string, any>();
    for (const target of [...(request.targets || []), ...request.selections]) {
      if (selections.has(target.entityId))
        throw new Error(
          "요청 대상과 선택 목록이 중복되었습니다. 원본을 확인해 주세요.",
        );
      selections.set(target.entityId, target);
    }
    // Preserve a legacy request's known draft/confirmed plan inclusion even if it had no target list.
    if (!request.completion)
      for (const plan of state.plans.filter(
        (p: any) => p.requestId === request.id && !p.deletedAt,
      )) {
        const q = state.qualifications.find(
          (q: any) => q.id === plan.qualificationId,
        );
        if (q && !selections.has(q.entityId))
          selections.set(q.entityId, {
            entityId: q.entityId,
            qualificationId: q.id,
            title: plan.qualificationMetadata?.title || q.title,
            version: q.version,
            ...(plan.previousCertificationId
              ? { previousCertificationId: plan.previousCertificationId }
              : {}),
          });
      }
    request.selections = [...selections.values()];
    delete request.targets;
    if (!request.completion) {
      request.mode = "learner_choice";
      request.revision++;
    }
    state.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.planning-choice",
      targetId: request.id,
      lv1OrganizationId: request.lv1OrganizationId,
      reason: "조직 필수 대상의 선택 항목 전환·기존 계획과 완료 근거 보존",
      details: { before, after: structuredClone(request) },
    });
    convertedRequests++;
  }
  state.schemaVersion = 21;
  state.revision++;
  state.audits.push({
    id: randomUUID(),
    actorId,
    date: at,
    action: "migration.remove-required-qualifications",
    targetId: "requirements-v21",
    reason: "조직 필수자격 종료·선택형 요청과 기존 업무 기록 보존",
    details: { fromSchema: 20, convertedRequests, progressReset: false },
  });
  const upgraded = migrateSubjective(state, organizations, at);
  const checked = upgraded.state;
  return {
    state: checked,
    organizations,
    report: {
      alreadyApplied: false,
      schemaVersion: 25,
      revision: checked.revision,
      organizationSchemaVersion: 4,
      organizationRevision: organizations.revision,
      convertedRequests,
      progressReset: false,
    },
  };
}
