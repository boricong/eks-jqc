import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  WorkStatusSchema,
  workRevokesOn,
  kstDate,
  type State,
  type UserView,
  type WorkStatusPreview,
} from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import {
  authorizeWorkStatus,
  workStatusInfo,
  workTargets,
  workNotice,
} from "./work-status.ts";
import { demand } from "./errors.ts";

const inputSchema = z
  .object({
    status: WorkStatusSchema,
    reason: z.string().trim().min(1).max(2000).default("관리자 업무 상태 변경"),
    revision: z.number().int().positive(),
    organizationRevision: z.number().int().nonnegative(),
  })
  .strict();
export function registerWorkStatusRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
) {
  const tokens = new Map<
    string,
    {
      actorId: string;
      id: string;
      team: string;
      generation: string;
      stateRevision: number;
      input: z.infer<typeof inputSchema>;
      date: string;
      expiresAt: string;
    }
  >();
  const scope = (r: FastifyRequest) =>
    z.object({ lv1OrganizationId: z.string().optional() }).parse(r.query)
      .lv1OrganizationId;
  app.post("/api/team-users/:id/work-status/preview", async (r) =>
    store.consistent((s, doc): WorkStatusPreview => {
      const at = clock(),
        a = actor(r, s),
        id = (r.params as { id: string }).id;
      const { target, team } = authorizeWorkStatus(s, doc, a, id, scope(r));
      const input = inputSchema.parse(r.body);
      demand(
        input.revision === target.revision &&
          input.organizationRevision === doc.revision,
        409,
        "사용자 또는 조직이 변경되었습니다. 입력을 보존하고 다시 확인해 주세요.",
        "REVISION_CONFLICT",
      );
      const current = workStatusInfo(s, doc, a, target, at);
      demand(
        input.status !== "deactive" ||
          current.status === "deactive" ||
          current.canDeactivate,
        422,
        current.blockedReason || "유효 Auditee 인증이 필요합니다.",
        "WORK_STATUS_NOT_ELIGIBLE",
      );
      for (const [key, value] of tokens)
        if (value.expiresAt <= at || value.generation !== store.generation)
          tokens.delete(key);
      demand(
        tokens.size < 10000,
        503,
        "검토 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
      );
      const token = randomUUID(),
        expiresAt = new Date(Date.parse(at) + 15 * 60000).toISOString();
      tokens.set(token, {
        actorId: a.id,
        id,
        team,
        input,
        generation: store.generation,
        stateRevision: s.revision,
        date: kstDate(at),
        expiresAt,
      });
      const t = workTargets(s, id, team);
      return {
        token,
        expiresAt,
        current,
        next: input.status,
        reason: input.reason,
        revokesOn:
          current.revokesOn ||
          (input.status === "deactive"
            ? workRevokesOn(kstDate(at))
            : undefined),
        impacts: {
          certifications: t.certifications.filter(
            (c) => c.lifecycleStatus !== "Revoke",
          ).length,
          requests: t.requests.length,
          assignments: t.assignments.filter(
            (a) =>
              !a.acquisitionClosedAt &&
              !t.certifications.some((c) => c.assignmentId === a.id),
          ).length,
          renewals: t.renewals.length,
        },
      };
    }),
  );
  app.put("/api/team-users/:id/work-status", async (r) => {
    const input = z.object({ token: z.string().uuid() }).strict().parse(r.body);
    const id = (r.params as { id: string }).id,
      a = actor(r);
    const key = z.string().min(1).max(160).parse(r.headers["idempotency-key"]);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ id, scope: scope(r), input }))
      .digest("hex");
    return store.transact(
      a.id,
      key,
      fingerprint,
      (s) => {
        authorizeWorkStatus(
          s,
          store.organizations.snapshot(),
          actor(r, s),
          id,
          scope(r),
        );
      },
      (s) => {
        const at = clock(),
          doc = store.organizations.snapshot(),
          currentActor = actor(r, s);
        const { target, team } = authorizeWorkStatus(
          s,
          doc,
          currentActor,
          id,
          scope(r),
        );
        const review = tokens.get(input.token);
        demand(
          review &&
            review.actorId === currentActor.id &&
            review.id === id &&
            review.team === team &&
            review.generation === store.generation &&
            review.stateRevision === s.revision &&
            review.date === kstDate(at) &&
            review.expiresAt > at &&
            review.input.revision === target.revision &&
            review.input.organizationRevision === doc.revision,
          409,
          "검토 기준이 변경되었거나 만료되었습니다. 다시 확인해 주세요.",
          "WORK_STATUS_REVIEW_CHANGED",
        );
        const next = review.input.status,
          before = structuredClone({
            status: target.workStatus || "active",
            deactivation: target.workDeactivation || null,
          });
        if (before.status === next)
          return { id, revision: target.revision, status: next };
        const info = workStatusInfo(s, doc, currentActor, target, at);
        demand(
          next !== "deactive" || info.canDeactivate,
          422,
          info.blockedReason || "유효 Auditee 인증이 필요합니다.",
        );
        target.workStatus = next;
        if (next === "deactive")
          target.workDeactivation = {
            id: randomUUID(),
            startedAt: at,
            startedOn: kstDate(at),
            revokesOn: workRevokesOn(kstDate(at)),
            actorId: currentActor.id,
            reason: review.input.reason,
            processedTeams: [],
          };
        else delete target.workDeactivation;
        target.revision++;
        s.lifecycleEvents.push({
          id: randomUUID(),
          subject: "work_status",
          targetId: id,
          actorId: currentActor.id,
          lv1OrganizationId: team,
          organizationId: target.organizationId,
          action: "work-status.changed",
          reason: review.input.reason,
          effectiveAt: at,
          recordedAt: at,
          before,
          after: {
            status: next,
            deactivation: target.workDeactivation || null,
          },
        });
        workNotice(
          s,
          doc,
          target,
          team,
          at,
          `work-status:${id}:${target.revision}`,
          "업무 수행 상태가 변경되었습니다",
          `${target.name} · ${next === "active" ? "Active · 업무 수행" : "Deactive · 업무 미수행"} · ${review.input.reason}${next === "active" && info.reacquisitionRequired ? " · 기존 인증은 복원되지 않으며 새 계획과 평가가 필요합니다." : ""}`,
        );
        return { id, revision: target.revision, status: next };
      },
      { action: "work-status.change" },
    );
  });
}
