import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { State, UserView } from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { canonicalHash } from "./releases.ts";
import { managementScope } from "./management.ts";
import { userView } from "./organizations.ts";
import { mentorProgress } from "./mentor-practical-evidence.ts";
import {
  authorizeMentorAction,
  executeMentor,
  mentorDataset,
  mentorPreview,
  mentorView,
} from "./mentor-practical.ts";

export function registerMentorPracticalRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
) {
  const id = (r: FastifyRequest) => (r.params as { id: string }).id;
  app.get("/api/mentor-practicals", (r) =>
    store.consistent((s, doc) => {
      const u = actor(r, s),
        query = z
          .object({
            management: z.enum(["true"]).optional(),
            lv1OrganizationId: z.string().optional(),
          })
          .parse(r.query);
      const scope = query.management
        ? managementScope(u, doc, query.lv1OrganizationId)
        : undefined;
      const rows = s.enrollments.flatMap((e) => {
        const a = s.assignments.find((a) => a.id === e.assignmentId)!,
          c = s.courses.find((c) => c.id === e.courseId)!;
        if (
          !c.mentorPractical ||
          (scope
            ? a.lv1OrganizationId !== scope
            : !u.roles.includes("ft") ||
              u.lv1OrganizationId !== a.lv1OrganizationId ||
              !s.mentorAssignments.some(
                (m) => m.enrollmentId === e.id && m.mentorId === u.id,
              ) ||
              a.learnerId === u.id)
        )
          return [];
        return [
          {
            enrollmentId: e.id,
            learnerId: a.learnerId,
            learnerName: s.users.find((v) => v.id === a.learnerId)!.name,
            courseTitle: c.title,
            courseVersion: `${c.releaseVersion?.major || c.version}.${c.releaseVersion?.minor || 0}`,
            progress: mentorProgress(s, e.id),
            completed: s.completions.some((co) => co.enrollmentId === e.id),
          },
        ];
      });
      return {
        enabled: s.schemaVersion >= 34,
        rows,
        mentors: scope
          ? s.users
              .map((v) => userView(v, doc))
              .filter(
                (v) =>
                  v.roles.includes("ft") &&
                  v.lv1OrganizationId === scope &&
                  v.organizationActive &&
                  v.workStatus !== "deactive",
              )
              .map((v) => ({ id: v.id, name: v.name }))
          : [],
      };
    }),
  );
  app.get("/api/mentor-practicals/:id", (r) =>
    store.consistent((s, doc) => mentorView(s, doc, actor(r, s), id(r))),
  );
  app.post("/api/mentor-practicals/:id/preview", (r) =>
    store.consistent((s, doc) => {
      authorizeMentorAction(s, doc, actor(r, s), id(r), "preview");
      return mentorPreview(s, doc, id(r));
    }),
  );
  for (const action of [
    "assign",
    "start",
    "save",
    "submit",
    "grade",
    "finalize",
  ])
    app.post(
      `/api/mentor-practicals/:id/${action}`,
      { bodyLimit: action === "save" ? 16 * 1024 * 1024 : 2 * 1024 * 1024 },
      (r) => {
        const u = actor(r),
          key = z.string().min(1).max(160).parse(r.headers["idempotency-key"]);
        mentorDataset(store.snapshot());
        return store.transact(
          u.id,
          key,
          canonicalHash({ action, enrollmentId: id(r), body: r.body }),
          (s) =>
            authorizeMentorAction(
              s,
              store.organizations.snapshot(),
              actor(r, s),
              id(r),
              action,
            ),
          (s) =>
            executeMentor(
              s,
              store.organizations.snapshot(),
              actor(r, s),
              id(r),
              action,
              r.body,
              clock(),
            ),
          { action: `mentor-practical.${action}` },
        );
      },
    );
}
