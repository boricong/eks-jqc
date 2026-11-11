import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { State, UserView } from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { demand } from "./errors.ts";
import { canonicalHash } from "./releases.ts";
import { groupSourceHash } from "./group-practical-evidence.ts";
import {
  groupContext,
  groupReader,
  groupManager,
  groupEvaluator,
  groupCandidates,
  groupPreview,
  groupBlockers,
  editableRun,
  executeGroup,
  invalidationPreview,
  requireGroupDataset,
} from "./group-practical.ts";

export function registerGroupPracticalRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
  enabled: boolean,
) {
  const files = store.groupFiles;
  const requireEnabled = (s = store.snapshot()) => {
    demand(
      enabled,
      409,
      "그룹 실기는 별도 시험환경에서만 활성화할 수 있습니다.",
      "GROUP_DISABLED",
    );
    requireGroupDataset(s);
  };
  const params = (r: FastifyRequest) =>
    r.params as {
      id: string;
      runId?: string;
      fileId?: string;
      action?: string;
    };
  app.get("/api/group-assessments/status", async (r) => {
    actor(r);
    const s = store.snapshot();
    return {
      enabled:
        enabled &&
        s.schemaVersion >= 33 &&
        s.groupPracticalEnvironment === "trial",
      environment: s.groupPracticalEnvironment || null,
      maxFileBytes: files.maxBytes,
      maxFilesPerRun: files.maxFiles,
    };
  });
  app.get("/api/group-assessments/candidates", async (r) => {
    const u = actor(r);
    requireEnabled();
    return store.consistent((s, doc) =>
      groupCandidates(
        s,
        doc,
        actor(r, s),
        (r.query as { lv1OrganizationId?: string }).lv1OrganizationId,
      ),
    );
  });
  app.get("/api/group-assessments", async (r) => {
    const s = store.snapshot(),
      doc = store.organizations.snapshot(),
      u = actor(r, s);
    const team = (r.query as { lv1OrganizationId?: string }).lv1OrganizationId;
    if (u.roles.includes("system_operator"))
      demand(team, 403, "관리할 팀을 선택해 주세요.");
    const scope = u.roles.includes("system_operator")
      ? team
      : u.lv1OrganizationId;
    const management =
      u.roles.includes("admin") || u.roles.includes("system_operator");
    return s.groupAssessments
      .filter(
        (g) =>
          g.lv1OrganizationId === scope &&
          (management || g.members.some((m) => m.learnerId === u.id)),
      )
      .map((g) => ({
        id: g.id,
        title: g.title,
        status: g.status,
        courseTitle: s.courses.find((c) => c.id === g.courseId)?.title,
        memberCount: g.members.length,
        runNumber: g.runs.at(-1)?.number || 0,
        runStatus: g.runs.at(-1)?.status,
        completedTrials:
          g.runs.at(-1)?.trials.filter((t) => t.completed).length || 0,
        environment: "trial",
      }));
  });
  app.get("/api/group-assessments/:id", async (r) => {
    const s = store.snapshot(),
      doc = store.organizations.snapshot(),
      u = actor(r, s),
      { group } = groupContext(s, params(r).id);
    const management = groupReader(u, doc, group),
      c = s.courses.find((c) => c.id === group.courseId)!;
    const blockers = ["draft", "active"].includes(group.status)
      ? groupBlockers(s, doc, group)
      : [];
    const copy = structuredClone(group);
    if (!management) {
      copy.members = copy.members.filter((m) => m.learnerId === u.id);
      copy.runs = copy.runs.map((run) => ({
        ...run,
        trials: run.trials
          .filter((t) => t.learnerId === u.id)
          .map((t) => ({ ...t, evidence: [], note: "" })),
        analysis: undefined,
        previousAnalyses: [],
      }));
    }
    return {
      group: copy,
      management,
      canEvaluate:
        enabled &&
        u.id === group.evaluatorId &&
        u.roles.includes("admin") &&
        u.organizationActive &&
        u.workStatus !== "deactive",
      enabled,
      blockers: management
        ? blockers
        : blockers.length
          ? ["그룹 진행 조건을 확인 중입니다. 담당 평가자에게 문의해 주세요."]
          : [],
      course: {
        id: c.id,
        title: c.title,
        releaseVersion: c.releaseVersion,
        version: c.version,
        groupPractical: c.groupPractical,
      },
      evaluatorName: s.users.find((u) => u.id === group.evaluatorId)?.name,
      files: management
        ? s.groupAssessmentFiles.filter((f) => f.groupId === group.id)
        : [],
      sourceHashes: management
        ? Object.fromEntries(
            group.runs.map((run) => [run.id, groupSourceHash(s, group, run)]),
          )
        : {},
    };
  });
  app.post("/api/group-assessments/:id/runs/:runId/preview", async (r) => {
    requireEnabled();
    const s = store.snapshot(),
      { group, run } = groupContext(s, params(r).id, params(r).runId);
    groupEvaluator(actor(r, s), group);
    await files.verifyAll(
      s.groupAssessmentFiles.filter(
        (f) => f.groupId === group.id && f.runId === run!.id,
      ),
    );
    return store.consistent((current, doc) => {
      const ctx = groupContext(current, group.id, run!.id);
      groupEvaluator(actor(r, current), ctx.group);
      return groupPreview(current, doc, ctx.group, ctx.run!);
    });
  });
  app.post(
    "/api/group-assessments/:id/runs/:runId/invalidate-preview",
    async (r) => {
      requireEnabled();
      const input = z
        .object({ reason: z.string().trim().min(1).max(2000) })
        .strict()
        .parse(r.body);
      return store.consistent((s, doc) => {
        const { group, run } = groupContext(s, params(r).id, params(r).runId),
          u = actor(r, s);
        groupManager(u, doc, group);
        demand(
          !group.members.some((m) => m.learnerId === u.id),
          403,
          "본인이 포함된 그룹은 무효화할 수 없습니다.",
        );
        demand(
          run?.decision && !run.invalidation,
          409,
          "무효화할 확정 판정이 없습니다.",
        );
        return invalidationPreview(s, group, run, input.reason);
      });
    },
  );
  const mutate = async (r: FastifyRequest, action: string) => {
    requireEnabled();
    const u = actor(r),
      p = params(r);
    if (action === "finalize") {
      const s = store.snapshot();
      groupEvaluator(actor(r, s), groupContext(s, p.id, p.runId).group);
      await files.verifyAll(
        s.groupAssessmentFiles.filter(
          (f) => f.groupId === p.id && f.runId === p.runId,
        ),
      );
    }
    const key = z.string().min(1).max(160).parse(r.headers["idempotency-key"]);
    return store.transact(
      u.id,
      key,
      canonicalHash({ action, id: p.id, runId: p.runId, body: r.body }),
      (s) => {
        requireEnabled(s);
        const current = actor(r, s);
        if (action === "create")
          groupCandidates(
            s,
            store.organizations.snapshot(),
            current,
            (r.body as { lv1OrganizationId: string }).lv1OrganizationId,
          );
        else {
          const { group } = groupContext(s, p.id, p.runId);
          if (["trial", "analysis", "finalize"].includes(action))
            groupEvaluator(current, group);
          else groupManager(current, store.organizations.snapshot(), group);
        }
      },
      (s) =>
        executeGroup(
          s,
          store.organizations.snapshot(),
          actor(r, s),
          action,
          p.id,
          p.runId,
          r.body,
          clock(),
        ),
      { action: `group-practical.${action}` },
    );
  };
  app.post("/api/group-assessments", (r) => mutate(r, "create"));
  for (const action of ["start", "close", "evaluator", "retry"])
    app.post(`/api/group-assessments/:id/${action}`, (r) => mutate(r, action));
  for (const action of ["trial", "analysis", "finalize", "invalidate"])
    app.post(`/api/group-assessments/:id/runs/:runId/${action}`, (r) =>
      mutate(r, action),
    );
  app.addContentTypeParser("application/octet-stream", (_r, payload, done) =>
    done(null, payload),
  );
  app.post("/api/group-assessments/:id/runs/:runId/files", async (r) => {
    requireEnabled();
    const p = params(r),
      s = store.snapshot(),
      { group, run } = groupContext(s, p.id, p.runId);
    groupEvaluator(actor(r, s), group);
    const input = z
      .object({
        name: z.string().min(1).max(240),
        kind: z.enum(["raw", "report"]),
      })
      .strict()
      .parse(r.query);
    const key = z.string().min(1).max(160).parse(r.headers["idempotency-key"]);
    demand(
      r.headers["content-type"]?.split(";")[0] === "application/octet-stream",
      415,
      "파일 본문 형식을 확인해 주세요.",
    );
    const stored = await files.save(
        r.body as AsyncIterable<Buffer>,
        input.name,
        input.kind,
      ),
      u = actor(r);
    return store.transact(
      u.id,
      key,
      canonicalHash({
        action: "group-file.upload",
        groupId: p.id,
        runId: p.runId,
        kind: input.kind,
        ...stored,
      }),
      (s) => {
        requireEnabled(s);
        groupEvaluator(actor(r, s), groupContext(s, p.id, p.runId).group);
      },
      (s) => {
        const { group, run } = groupContext(s, p.id, p.runId);
        editableRun(group, run);
        demand(
          s.groupAssessmentFiles.filter((f) => f.runId === run!.id).length <
            files.maxFiles,
          422,
          "평가 차수의 파일 개수 제한을 초과했습니다.",
        );
        const file = {
          id: randomUUID(),
          groupId: group.id,
          runId: run!.id,
          kind: input.kind,
          ...stored,
          uploadedBy: u.id,
          uploadedAt: clock(),
        };
        s.groupAssessmentFiles.push(file);
        s.audits.push({
          id: randomUUID(),
          actorId: u.id,
          date: clock(),
          action: "group-practical.file",
          targetId: group.id,
          lv1OrganizationId: group.lv1OrganizationId,
          reason: "그룹 실기 근거 파일 등록",
          details: { fileId: file.id, sha256: file.sha256, bytes: file.bytes },
        });
        return file;
      },
      { action: "group-practical.file" },
    );
  });
  app.get("/api/group-assessment-files/:fileId", async (r, reply) => {
    const s = store.snapshot(),
      u = actor(r, s),
      file = s.groupAssessmentFiles.find((f) => f.id === params(r).fileId);
    demand(file, 404, "근거 파일을 찾을 수 없습니다.");
    groupManager(
      u,
      store.organizations.snapshot(),
      groupContext(s, file.groupId).group,
    );
    await files.verify(file);
    return reply
      .type(file.mediaType)
      .header(
        "Content-Disposition",
        `attachment; filename="evidence${file.mediaType === "application/pdf" ? ".pdf" : file.mediaType === "text/csv" ? ".csv" : ".xlsx"}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      )
      .send(createReadStream(files.blob(file.sha256)));
  });
}
