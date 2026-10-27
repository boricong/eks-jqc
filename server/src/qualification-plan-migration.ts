import { migrateReleases } from "./release-migration.ts";
import { randomUUID } from "node:crypto";
import { LegacyPersonalPlanSchema, WORKFLOW_VERSION } from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";

const legacyPlan = LegacyPersonalPlanSchema.strict();

/** Explicit maintenance only. Preserve original schedules and every business relationship. */
export function migrateQualificationPlans(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = structuredClone(input) as any;
  const organizations = validateOrganizations(orgInput);
  if (![24, 25, 26, 27, 28].includes(raw?.schemaVersion))
    throw Error(
      "자격 단위 계획 이관은 업무24·조직4 또는 현행 파일이 필요합니다.",
    );
  const alreadyApplied = raw.schemaVersion >= 25;
  if (!alreadyApplied) {
    const actorId = raw.users.find((u: any) =>
      u.roles.includes("system_operator"),
    )?.id;
    if (!actorId) throw Error("시스템 운영자가 필요합니다.");
    const changes = [];
    for (const rawPlan of raw.plans) {
      const p = legacyPlan.parse(rawPlan);
      const q = raw.qualifications.find((q: any) => q.id === p.qualificationId);
      if (
        !q ||
        p.schedules.length !== q.courseIds.length ||
        new Set(p.schedules.map((s) => s.courseId)).size !==
          q.courseIds.length ||
        p.schedules.some((s) => !q.courseIds.includes(s.courseId))
      )
        throw Error("이전 계획의 인증Set 참조가 올바르지 않습니다.");
      if (
        p.status === "completed" &&
        (!p.targetOn ||
          p.schedules.some(
            (s) =>
              !s.learningStart ||
              !s.learningEnd ||
              s.learningStart > s.learningEnd ||
              (q.qualificationType === "auditee"
                ? !s.assessmentOn ||
                  s.learningEnd > s.assessmentOn ||
                  s.assessmentOn > p.targetOn
                : s.learningEnd > p.targetOn),
          ))
      )
        throw Error("이전 확정 계획의 날짜가 올바르지 않습니다.");
      const goals = p.schedules.filter((s) => s.goal.trim());
      const goal =
        goals.length === 1
          ? goals[0]!.goal
          : goals
              .map(
                (s) =>
                  `${raw.courses.find((c: any) => c.id === s.courseId)?.title || s.courseId}\n${s.goal}`,
              )
              .join("\n\n");
      const before = structuredClone(rawPlan);
      rawPlan.startOn =
        p.schedules
          .map((s) => s.learningStart)
          .filter(Boolean)
          .sort()[0] || "";
      rawPlan.endOn =
        p.targetOn ||
        p.schedules
          .flatMap((s) => [s.learningEnd, s.assessmentOn])
          .filter(Boolean)
          .sort()
          .at(-1) ||
        "";
      rawPlan.goal = goal.length <= 2000 ? goal : "";
      rawPlan.previousSchedule = {
        workflowVersion: p.workflowVersion,
        targetOn: p.targetOn,
        schedules: p.schedules,
        migratedAt: at,
        goalNeedsReview: goal.length > 2000,
      };
      rawPlan.workflowVersion = WORKFLOW_VERSION;
      rawPlan.revision++;
      rawPlan.updatedAt = at;
      // Missing legacy dates must remain empty until the learner explicitly edits them.
      rawPlan.scheduleDefaultsAppliedAt ||= at;
      delete rawPlan.targetOn;
      delete rawPlan.schedules;
      changes.push({ before, after: structuredClone(rawPlan) });
    }
    raw.schemaVersion = 25;
    raw.revision++;
    raw.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.qualification-plans",
      targetId: "qualification-plans-v25",
      reason: "자격 단위 일정·목표 전환 및 원본 계획 보존",
      details: { fromSchema: 24, changes, progressReset: false },
    });
  }
  const state = migrateReleases(raw, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied: alreadyApplied && (input as any).schemaVersion === 28,
      schemaVersion: 28,
      organizationSchemaVersion: 4,
      revision: state.revision,
      organizationRevision: organizations.revision,
      convertedPlans: alreadyApplied ? 0 : state.plans.length,
      progressReset: false,
    },
  };
}
