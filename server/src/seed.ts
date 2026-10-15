import { readFileSync } from "node:fs";
import {
  StateSchema,
  type State,
  type AssessmentAttempt,
} from "@eks/contracts";
import { validateState } from "./integrity.ts";

export function seedState(): State {
  const source = JSON.parse(
    readFileSync(new URL("./seed-source.json", import.meta.url), "utf8"),
  );
  const state: State = {
    schemaVersion: 1,
    revision: 0,
    users: source.users.map((u: any) => ({
      id: u.id,
      name: u.name,
      roles: u.roles || [u.role],
    })),
    courses: source.courses.map((c: any) => ({
      ...c,
      entityId: c.id,
      revision: 1,
      materialUrl: "",
      questions: c.questions.map((q: any) => ({
        ...q,
        category: q.category || "written",
      })),
      ...(c.status === "published"
        ? { publishedAt: "2026-10-15T00:00:00.000Z" }
        : {}),
    })),
    qualifications: source.qualifications.map((q: any) => ({
      ...q,
      entityId: q.id,
      revision: 1,
      ...(q.status === "published"
        ? { publishedAt: "2026-10-15T00:00:00.000Z" }
        : {}),
    })),
    assignments: [],
    enrollments: [],
    attempts: [],
    completions: [],
    certifications: [],
    notices: source.notices.map((n: any) => ({ ...n, revision: 1 })),
    comparisons: [],
    audits: [],
    requests: [],
  };
  for (const a of source.assignments) {
    state.assignments.push({
      id: a.id,
      qualificationId: a.qualificationId,
      learnerId: a.learnerId,
      ftId: a.ftId,
      ownerAdminId: "admin-1",
      assignedAt: `${a.assignedAt}T00:00:00.000Z`,
      revision: 1,
    });
    for (const e of a.enrollments) {
      const id = `${a.id}:${e.courseId}`;
      state.enrollments.push({ id, assignmentId: a.id, courseId: e.courseId });
      for (const h of e.history) {
        const t: AssessmentAttempt = {
          ...h,
          enrollmentId: id,
          courseId: e.courseId,
          learnerId: a.learnerId,
          revision: 1,
          status: "submitted",
          createdAt: h.date,
          answers: h.answers || {},
          verdicts: h.verdicts || {},
          ...(h.kind === "practical" ? { evaluatorId: a.ftId } : {}),
        };
        if (t.kind === "objective") {
          const c = state.courses.find((c) => c.id === e.courseId)!;
          t.itemResults = c.questions.map((q) => ({
            itemId: q.id,
            correct: t.answers[q.id] === q.correct,
            earned: t.answers[q.id] === q.correct ? q.points : 0,
            possible: q.points,
          }));
          t.earned = t.itemResults.reduce((n, r) => n + r.earned, 0);
          t.total = c.questions.reduce((n, q) => n + q.points, 0);
        }
        state.attempts.push(t);
      }
    }
  }
  state.audits.push({
    id: "seed-event",
    actorId: "admin-1",
    date: "2026-10-15T00:00:00.000Z",
    action: "seed",
    targetId: "assignment-1",
    assignmentId: "assignment-1",
    reason: "가상 데이터 초기화",
    details: { fictional: true },
  });
  return validateState(StateSchema.parse(state));
}
