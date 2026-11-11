import type {
  State,
  GroupAssessment,
  GroupRun,
  Completion,
  GroupPersonalProgress,
} from "@eks/contracts";
import { canonicalHash } from "./releases.ts";

export function groupSourceHash(
  s: State,
  group: GroupAssessment,
  run: GroupRun,
  byId = new Map(s.groupAssessmentFiles.map((f) => [f.id, f])),
) {
  return canonicalHash({
    groupId: group.id,
    courseHash: group.courseHash,
    members: group.members,
    runId: run.id,
    trials: run.trials.map((t) => ({
      ...t,
      evidence: t.evidence.map((e) => ({
        ...e,
        sha256: byId.get(e.fileId)?.sha256,
      })),
    })),
  });
}
export function groupEvidence(s: State, enrollmentId: string) {
  for (const group of s.groupAssessments) {
    if (!group.members.some((m) => m.enrollmentId === enrollmentId)) continue;
    for (const run of group.runs)
      if (
        run.status === "passed" &&
        run.decision?.result === "passed" &&
        !run.invalidation
      )
        return {
          groupId: group.id,
          runId: run.id,
          decisionId: run.decision.id,
          sourceHash: run.decision.sourceHash,
          evaluatorId: run.decision.decidedBy,
          environment: "trial" as const,
        };
  }
}
export function usableCompletion(s: State, completion: Completion | undefined) {
  if (!completion) return false;
  if (!completion.groupPractical) return true;
  const evidence = groupEvidence(s, completion.enrollmentId);
  return evidence?.decisionId === completion.groupPractical.decisionId;
}
export function personalGroupProgress(
  s: State,
  enrollmentId: string,
): GroupPersonalProgress | undefined {
  const group = [...s.groupAssessments]
    .reverse()
    .find((g) => g.members.some((m) => m.enrollmentId === enrollmentId));
  if (!group) return;
  const member = group.members.find((m) => m.enrollmentId === enrollmentId)!;
  const run = group.runs.at(-1);
  return {
    groupId: group.id,
    title: group.title,
    runNumber: run?.number || 0,
    status: group.status === "closed" ? "closed" : run?.status || "draft",
    completed:
      run?.trials.filter((t) => t.learnerId === member.learnerId && t.completed)
        .length || 0,
    blockers: [],
    result: run?.decision?.result,
    invalidated: !!run?.invalidation,
    environment: "trial",
  };
}
