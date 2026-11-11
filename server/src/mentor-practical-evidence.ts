import type { State, MentorCompletion, MentorProgress } from "@eks/contracts";
export function mentorEvidence(
  s: State,
  enrollmentId: string,
): MentorCompletion | undefined {
  const t = s.mentorAttempts.find(
    (t) => t.enrollmentId === enrollmentId && t.result === "passed",
  );
  return t
    ? {
        attemptId: t.id,
        mentorId: t.gradedBy!,
        earned: t.earned!,
        total: t.total!,
        passScore: t.passScore,
      }
    : undefined;
}
export function mentorProgress(
  s: State,
  enrollmentId: string,
): MentorProgress | undefined {
  const e = s.enrollments.find((e) => e.id === enrollmentId);
  if (!s.courses.find((c) => c.id === e?.courseId)?.mentorPractical) return;
  const assigned = s.mentorAssignments.find(
      (a) => a.enrollmentId === enrollmentId,
    ),
    t = s.mentorAttempts.filter((t) => t.enrollmentId === enrollmentId).at(-1);
  return {
    mentorId: assigned?.mentorId,
    mentorName: s.users.find((u) => u.id === assigned?.mentorId)?.name,
    status: t?.result || t?.status || (assigned ? "ready" : "unassigned"),
    round: t?.round || 0,
    earned: t?.earned,
    total: t?.total,
  } as MentorProgress;
}
