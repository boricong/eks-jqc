import { auditorTemplateErrors } from "./auditor-pool.ts";
import { registerOrganizationRequirementRoutes } from "./organization-requirement-routes.ts";
import {
  subjectiveOwner,
  subjectiveView,
  readSubjective,
} from "./subjective.ts";
import { registerCommonCourseRoutes } from "./common-course-routes.ts";
import { commonCourseView } from "./common-courses.ts";
import type { OrganizationDocument } from "@eks/contracts";
import { createNetworkPolicy } from "./network.ts";
import { registerAuditorRoutes } from "./auditor-program-routes.ts";
import { registerTeamUserRoutes } from "./team-user-routes.ts";
import { canContinueType } from "./personal-access.ts";
import { planningView } from "./planning.ts";
import {
  prepareCatalogSave,
  qualificationDeletionImpact,
} from "./catalog-editing.ts";
import { registerMasterDataRoutes } from "./master-data-routes.ts";
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { z } from "zod";
import {
  ResetScopeSchema,
  organizationEntries,
  type UserView,
  type State,
} from "@eks/contracts";
import {
  userView,
  organization,
  systemOperator,
  changeOrganization,
  changeUser,
} from "./organizations.ts";
import { JsonStore, DomainError, demand } from "./storage.ts";
import { isManagementAction, managementScope } from "./management.ts";
import {
  policyScope,
  administratorsView,
  changeAdministrators,
} from "./organization-administrators.ts";
import { authorizeNotice, saveNotice } from "./notices.ts";
import { courseUsage } from "./course-lifecycle.ts";
import {
  saveTemplate,
  templateTypeEditing,
} from "./qualification-templates.ts";
import { registerCatalogRoutes } from "./catalog-routes.ts";
import { registerLifecycleRoutes } from "./lifecycle-routes.ts";
import { registerDashboardRoutes } from "./dashboard-routes.ts";
import { registerDocumentRoutes } from "./documents.ts";
import {
  organizationSettingsView,
  changeOrganizationSettings,
  validatePolicies,
} from "./organization-settings.ts";
import {
  authorize,
  execute,
  workspace,
  attemptView,
  progressSummary,
} from "./domain.ts";

export async function buildApp(
  store: JsonStore,
  options: {
    logger?: boolean;
    origins?: string[];
    serveFrontend?: boolean;
    clock?: () => string;
    documentsRoot?: string;
  } = {},
) {
  const network = createNetworkPolicy(options.origins);
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
  });
  await app.register(cookie);
  const clock = options.clock || (() => new Date().toISOString());
  const refreshNotifications = () => store.refreshNotifications(clock());
  await refreshNotifications();
  const notificationTimer = setInterval(() => {
    void refreshNotifications().catch((err) =>
      app.log.error({ err }, "notification reconciliation failed"),
    );
  }, 60000);
  notificationTimer.unref();
  const sessions = new Map<
    string,
    { actorId: string; expires: number; generation: string }
  >();
  function sessionCookie(request: FastifyRequest) {
    const tab = request.headers["x-session-tab"];
    if (tab === undefined) return "eks_session";
    const id = z.string().uuid().parse(tab);
    return `eks_session_${id}`;
  }
  const actor = (
    request: FastifyRequest,
    state: State = store.snapshot(),
  ): UserView => {
    const sid = request.cookies[sessionCookie(request)],
      session = sid ? sessions.get(sid) : undefined;
    demand(
      session && session.expires > Date.now(),
      401,
      "접속 계정을 선택해 주세요.",
      "SESSION_REQUIRED",
    );
    demand(
      session.generation === store.generation &&
        (!request.headers["x-eks-data-generation"] ||
          request.headers["x-eks-data-generation"] === store.generation),
      409,
      "데이터가 초기화 또는 교체되었습니다. 계정을 다시 선택해 주세요.",
      "DATASET_CHANGED",
    );
    const u = state.users.find((u) => u.id === session.actorId);
    demand(u, 401, "접속 계정을 선택해 주세요.");
    return userView(u, store.organizations.snapshot());
  };
  const requestGenerations = new WeakMap<FastifyRequest, string>();
  registerAuditorRoutes(app, store, actor, clock);
  registerTeamUserRoutes(app, store, actor);
  registerCommonCourseRoutes(app, store, actor);
  registerOrganizationRequirementRoutes(app, store, actor, clock);
  app.addHook("onRequest", async (request, reply) => {
    requestGenerations.set(request, store.generation);
    demand(
      network.acceptsHost(request.headers.host),
      403,
      "허용되지 않은 접속 주소입니다.",
    );
    reply.header("X-EKS-Data-Generation", store.generation);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin !== undefined
    )
      demand(
        network.acceptsOrigin(
          request.headers.host!,
          request.protocol,
          request.headers.origin,
        ),
        403,
        "허용되지 않은 요청 출처입니다.",
      );
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    if (requestGenerations.get(_request) !== store.generation) {
      reply.header("X-EKS-Data-Generation", store.generation);
      if (
        ![
          "/api/testing/master-reset",
          "/api/system/master-data/import",
        ].includes(_request.url)
      ) {
        reply.code(409).type("application/json");
        payload = JSON.stringify({
          code: "DATASET_CHANGED",
          message:
            "데이터가 초기화 또는 교체되었습니다. 계정을 다시 선택해 주세요.",
        });
      }
    }
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError)
      return reply.status(error.status).send({
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    if (error instanceof z.ZodError)
      return reply.status(422).send({
        code: "VALIDATION_ERROR",
        message: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n"),
      });
    const err = error as Error & { statusCode?: number };
    if (err.statusCode && err.statusCode < 500)
      return reply.status(err.statusCode).send({
        code: "INVALID_REQUEST",
        message: "요청 형식을 확인해 주세요.",
      });
    request.log.error({ err }, "request failed");
    return reply.status(503).send({
      code: "STORAGE_UNAVAILABLE",
      message:
        "저장하지 못했습니다. 입력을 유지한 상태에서 다시 시도해 주세요.",
    });
  });
  app.get("/api/health", async () => ({
    ok: true,
    revision: store.snapshot().revision,
  }));
  app.get("/api/actors", async () =>
    store
      .snapshot()
      .users.map((u) => userView(u, store.organizations.snapshot())),
  );
  app.get("/api/session", async (request) => ({ actor: actor(request) }));
  app.post("/api/session", async (request, reply) => {
    const { actorId } = z
        .object({ actorId: z.string().min(1) })
        .parse(request.body),
      u = store.snapshot().users.find((u) => u.id === actorId);
    demand(u, 422, "계정을 확인해 주세요.");
    const cookieName = sessionCookie(request);
    if (request.cookies[cookieName])
      sessions.delete(request.cookies[cookieName]);
    for (const [key, session] of sessions)
      if (session.expires < Date.now()) sessions.delete(key);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, {
      actorId,
      expires: Date.now() + 8 * 60 * 60 * 1000,
      generation: store.generation,
    });
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/api",
      maxAge: 8 * 60 * 60,
    });
    return { actor: userView(u, store.organizations.snapshot()) };
  });
  app.delete("/api/session", async (request, reply) => {
    const cookieName = sessionCookie(request);
    if (request.cookies[cookieName])
      sessions.delete(request.cookies[cookieName]);
    reply.clearCookie(cookieName, { path: "/api" });
    return { ok: true };
  });
  app.get("/api/workspace", async (request) =>
    workspace(
      store.snapshot(),
      actor(request),
      store.organizations.snapshot(),
      z
        .object({ lv1OrganizationId: z.string().optional() })
        .parse(request.query).lv1OrganizationId,
      clock(),
    ),
  );
  app.get("/api/testing/progress", async (request) => {
    systemOperator(actor(request));
    const query = z
      .object({
        scope: z.enum(["all", "organization"]),
        lv1OrganizationId: z.string().optional(),
      })
      .parse(request.query);
    const scope = ResetScopeSchema.parse({
      type: query.scope,
      lv1OrganizationId: query.lv1OrganizationId,
    });
    if (scope.type === "organization")
      demand(
        organization(store.organizations.snapshot(), scope.lv1OrganizationId)
          .level === 1,
        422,
        "Lv1 조직을 선택해 주세요.",
      );
    return progressSummary(store.snapshot(), scope);
  });
  app.get("/api/home", async (request) => {
    const view = workspace(
      store.snapshot(),
      actor(request),
      store.organizations.snapshot(),
      z
        .object({ lv1OrganizationId: z.string().optional() })
        .parse(request.query).lv1OrganizationId,
    );
    return {
      assignments: view.assignments.filter((a) => !a.excludedReason),
      notices: view.homeNotices,
    };
  });
  for (const name of [
    "courses",
    "qualifications",
    "assignments",
    "notices",
    "audits",
    "plans",
    "planningRequests",
    "notifications",
  ] as const) {
    app.get(
      `/api/${name}`,
      async (request) =>
        workspace(
          store.snapshot(),
          actor(request),
          store.organizations.snapshot(),
          z
            .object({ lv1OrganizationId: z.string().optional() })
            .parse(request.query).lv1OrganizationId,
        )[name],
    );
    app.get(`/api/${name}/:id`, async (request) => {
      const view = workspace(
          store.snapshot(),
          actor(request),
          store.organizations.snapshot(),
          z
            .object({ lv1OrganizationId: z.string().optional() })
            .parse(request.query).lv1OrganizationId,
        ),
        id = (request.params as any).id,
        result = view[name].find((x) => x.id === id);
      demand(result, 404, "기록을 찾을 수 없습니다.");
      return result;
    });
  }
  app.get("/api/enrollments/:id/subjective-response", async (request) => {
    const s = store.snapshot(),
      u = actor(request),
      id = (request.params as any).id;
    subjectiveOwner(s, u, id);
    return (
      subjectiveView(s, u, id) || {
        response: null,
        canWrite: false,
        status: "unstarted",
        reason: "주관식 평가가 설정되지 않았습니다.",
      }
    );
  });
  app.get("/api/subjective-responses/:id", async (request) =>
    readSubjective(
      store.snapshot(),
      actor(request),
      (request.params as any).id,
    ),
  );
  app.get("/api/attempts/:id", async (request) => {
    const u = actor(request),
      s = store.snapshot(),
      t = s.attempts.find((t) => t.id === (request.params as any).id);
    demand(t, 404, "평가를 찾을 수 없습니다.");
    return attemptView(s, u, t);
  });
  app.get("/api/qualification-templates", async (request) => {
    const scope = managementScope(
      actor(request),
      store.organizations.snapshot(),
      (request.query as any).lv1OrganizationId,
    );
    return store
      .snapshot()
      .qualificationTemplates.filter((t) => t.scope !== "team")
      .map((t) => ({
        ...t,
        auditorReadiness: auditorTemplateErrors(store.snapshot(), t),
        commonCourses: t.defaultCommonCourseIds.map((id) =>
          commonCourseView(
            store.snapshot(),
            store.snapshot().commonCourses.find((c) => c.id === id)!,
          ),
        ),
        imported: store
          .snapshot()
          .qualifications.some(
            (q) =>
              q.lv1OrganizationId === scope &&
              q.templateId === t.id &&
              !q.deletedAt,
          ),
      }));
  });
  app.get("/api/completions/:id", async (request) => {
    const view = workspace(
      store.snapshot(),
      actor(request),
      store.organizations.snapshot(),
      (request.query as any).lv1OrganizationId,
    );
    const assignment = view.assignments.find((a) =>
      a.enrollments.some(
        (e) => e.completion?.id === (request.params as any).id,
      ),
    );
    demand(assignment, 404, "수료증을 찾을 수 없습니다.");
    return {
      assignment,
      completion: assignment.enrollments.find(
        (e) => e.completion?.id === (request.params as any).id,
      )!.completion,
    };
  });
  app.get("/api/assignments/:id/results", async (request) => {
    const view = workspace(
        store.snapshot(),
        actor(request),
        store.organizations.snapshot(),
        z
          .object({ lv1OrganizationId: z.string().optional() })
          .parse(request.query).lv1OrganizationId,
      ),
      a = view.assignments.find((a) => a.id === (request.params as any).id);
    demand(a, 404, "과제를 찾을 수 없습니다.");
    return {
      assignment: a,
      audits: view.audits.filter((ev) => ev.assignmentId === a.id),
    };
  });
  app.get("/api/assignments/:id/certification", async (request) => {
    const view = workspace(
        store.snapshot(),
        actor(request),
        store.organizations.snapshot(),
        z
          .object({ lv1OrganizationId: z.string().optional() })
          .parse(request.query).lv1OrganizationId,
      ),
      a = view.assignments.find((a) => a.id === (request.params as any).id);
    demand(a?.certification, 404, "인증을 찾을 수 없습니다.");
    return {
      certification: a.certification,
      excludedReason: a.excludedReason,
      completions: a.enrollments.map((e) => e.completion),
    };
  });
  registerMasterDataRoutes(app, store, actor, clock, () => sessions.clear());
  registerCatalogRoutes(app, store, actor);
  registerLifecycleRoutes(app, store, actor, clock);
  registerDashboardRoutes(app, store, actor, clock);
  registerDocumentRoutes(app, actor, options.documentsRoot);
  const mutation = (
    method: "POST" | "PUT" | "DELETE",
    url: string,
    action: string,
    target?: (p: any) => string,
  ) =>
    app.route({
      method,
      url,
      bodyLimit:
        action === "subjective.save" || action.startsWith("catalog.")
          ? 64 * 1024 * 1024
          : undefined,
      handler: async (request) => {
        const u = actor(request),
          body = request.body || {},
          params = request.params as any;
        const key = z
          .string()
          .min(1)
          .max(160)
          .parse(request.headers["idempotency-key"]);
        const targetId = target ? target(params) : params.id;
        const payload =
          action.startsWith("catalog.") && params.id
            ? { ...(body as object), id: params.id }
            : body;
        const fingerprint = createHash("sha256")
          .update(JSON.stringify({ method, url: request.url, body: payload }))
          .digest("hex");
        const requestedScope = z
          .object({ lv1OrganizationId: z.string().optional() })
          .parse(request.query).lv1OrganizationId;
        let scope: string | undefined;
        const transactionOptions = {
          preserveBackup:
            action === "progress.reset" ||
            action === "course.delete" ||
            action === "qualification.delete",
          backupPurpose:
            action === "qualification.delete"
              ? ("qualification-delete" as const)
              : action === "course.delete"
                ? ("course-delete" as const)
                : undefined,
          action,
          lv1OrganizationId: undefined as string | undefined,
        };
        const transact = store.transact.bind(store);
        return transact(
          u.id,
          key,
          fingerprint,
          (s) => {
            const current = actor(request, s);
            scope = isManagementAction(action)
              ? managementScope(
                  current,
                  store.organizations.snapshot(),
                  requestedScope,
                )
              : undefined;
            transactionOptions.lv1OrganizationId =
              action === "progress.reset"
                ? undefined
                : scope || current.lv1OrganizationId;
            const previous = s.requests.find(
              (r) => r.actorId === current.id && r.key === key,
            );
            if (scope && previous) {
              demand(
                previous.fingerprint === fingerprint,
                409,
                "같은 요청 식별자로 다른 내용을 보냈습니다.",
                "IDEMPOTENCY_CONFLICT",
              );
              // Deleted drafts no longer exist. Authenticate against the stored original
              // scope before returning the successful response from the request ledger.
              if (
                ["course.delete", "qualification.delete"].includes(action) &&
                previous.action === action
              ) {
                demand(
                  previous.lv1OrganizationId === scope,
                  403,
                  "원래 요청의 관리 대상 조직을 확인해 주세요.",
                );
                return;
              }
            }
            authorize(s, current, action, targetId, payload, scope);
            if (action.startsWith("plan."))
              demand(
                ![
                  "schedules",
                  "targetOn",
                  "assessmentOn",
                  "learningStart",
                  "learningEnd",
                ].some((k) => Object.hasOwn(body as object, k)),
                410,
                "계획 입력 방식이 변경되었습니다. 새로고침 후 자격 시작일·종료일을 입력해 주세요.",
                "FEATURE_REMOVED",
              );
          },
          (s: State, org?: OrganizationDocument) =>
            execute(
              s,
              actor(request, s),
              action,
              targetId,
              payload,
              org || store.organizations.snapshot(),
              scope,
              clock(),
            ),
          transactionOptions,
        );
      },
    });
  app.route({
    method: "GET",
    url: "/api/me/required-qualifications",
    onRequest: async (request, reply) => {
      const u = actor(request);
      demand(
        canContinueType(store.snapshot(), u, "auditee") ||
          canContinueType(store.snapshot(), u, "auditor"),
        403,
        "개인 인증 조회 권한이 필요합니다.",
      );
      return reply.code(410).send({
        code: "FEATURE_REMOVED",
        message: "조직별 필수자격 기능이 종료되었습니다.",
      });
    },
    handler: async () => {},
  });

  for (const url of [
    "/api/organization-policies",
    "/api/organization-policies/*",
  ])
    app.route({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      url,
      onRequest: async (request, reply) => {
        const u = actor(request);
        const path = request.url.split("?")[0]!.split("/");
        policyScope(
          u,
          store.organizations.snapshot(),
          (request.query as any).lv1OrganizationId,
          path[3],
        );
        return reply.code(410).send({
          code: "FEATURE_REMOVED",
          message:
            "조직별 필수자격 기능이 종료되었습니다. 조직 정보·관리자 화면을 이용해 주세요.",
          replacementPath: "/admin/organization-settings",
        });
      },
      handler: async () => {},
    });
  app.get("/api/organization-settings", async (request) => {
    const scope = policyScope(
      actor(request),
      store.organizations.snapshot(),
      (request.query as any).lv1OrganizationId,
    );
    return organizationSettingsView(
      store.snapshot(),
      store.organizations.snapshot(),
      scope,
      actor(request),
    );
  });
  app.put("/api/organization-settings/:id", async (request) => {
    const u = actor(request),
      body = request.body,
      target = (request.params as any).id;
    const scope = policyScope(
      u,
      store.organizations.snapshot(),
      (request.query as any).lv1OrganizationId,
      target,
    );
    const key = z
      .string()
      .min(1)
      .max(160)
      .parse(request.headers["idempotency-key"]);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          action: "organization.settings",
          target,
          scope,
          body,
        }),
      )
      .digest("hex");
    return store.organizations.transact(
      u.id,
      key,
      fingerprint,
      (doc) => {
        policyScope(actor(request), doc, scope, target);
      },
      (doc) =>
        changeOrganizationSettings(
          store.snapshot(),
          doc,
          actor(request),
          scope,
          target,
          body,
        ),
      {
        action: "organization.settings",
        lv1OrganizationId: scope,
        preserveBackup: true,
      },
    );
  });
  app.get("/api/organization-settings/:id/administrators", async (request) =>
    administratorsView(
      store.snapshot(),
      store.organizations.snapshot(),
      actor(request),
      (request.params as any).id,
      (request.query as any).lv1OrganizationId,
    ),
  );
  app.put("/api/organization-settings/:id/administrators", async (request) => {
    const u = actor(request),
      doc = store.organizations.snapshot(),
      target = (request.params as any).id;
    const scope = managementScope(
      u,
      doc,
      (request.query as any).lv1OrganizationId,
    );
    const key = z
      .string()
      .min(1)
      .max(160)
      .parse(request.headers["idempotency-key"]);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          action: "administrators",
          target,
          scope,
          body: request.body,
        }),
      )
      .digest("hex");
    return store.transact(
      u.id,
      key,
      fingerprint,
      (s) => {
        const latest = actor(request, s);
        managementScope(latest, store.organizations.snapshot(), scope);
        policyScope(latest, store.organizations.snapshot(), scope, target);
      },
      (s) =>
        changeAdministrators(
          s,
          store.organizations.snapshot(),
          actor(request, s),
          target,
          scope,
          request.body,
        ),
      {
        action: "organization.administrators",
        lv1OrganizationId: scope,
        preserveBackup: true,
      },
    );
  });
  app.get("/api/system/qualification-templates", async (request) => {
    systemOperator(actor(request));
    const s = store.snapshot();
    return {
      commonCourses: s.commonCourses.map((c) => commonCourseView(s, c)),
      items: s.qualificationTemplates
        .filter((t) => t.scope !== "team")
        .map((t) => ({
          ...t,
          ...templateTypeEditing(s, t.id),
        })),
      audits: s.audits.filter((a) =>
        a.action.startsWith("qualification-template."),
      ),
    };
  });
  for (const method of ["POST", "PUT"] as const)
    app.route({
      method,
      url: `/api/system/qualification-templates${method === "PUT" ? "/:id" : ""}`,
      handler: async (request) => {
        const u = actor(request);
        systemOperator(u);
        const target =
          method === "PUT" ? (request.params as any).id : undefined;
        const key = z
          .string()
          .min(1)
          .max(160)
          .parse(request.headers["idempotency-key"]);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify({ method, target, body: request.body }))
          .digest("hex");
        return store.transact(
          u.id,
          key,
          fingerprint,
          (s) => systemOperator(actor(request, s)),
          (s) => saveTemplate(s, u.id, target, request.body),
          { action: "qualification-template.save", preserveBackup: true },
        );
      },
    });
  app.get("/api/system/notices", async (request) => {
    systemOperator(actor(request));
    return store.snapshot().notices.filter((n) => n.scope === "system");
  });
  app.post("/api/system/notices", async (request) => {
    const u = actor(request);
    systemOperator(u);
    const key = z
      .string()
      .min(1)
      .max(160)
      .parse(request.headers["idempotency-key"]);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({ action: "system.notice.save", body: request.body }),
      )
      .digest("hex");
    return store.transact(
      u.id,
      key,
      fingerprint,
      (s) => authorizeNotice(s, actor(request, s), request.body, "system"),
      (s) => saveNotice(s, actor(request, s), request.body, "system"),
      { action: "system.notice.save", preserveBackup: true },
    );
  });
  app.get("/api/system/organizations", async (request) => {
    systemOperator(actor(request));
    const doc = store.organizations.snapshot(),
      users = store.snapshot().users;
    const entries = organizationEntries(doc);
    return {
      revision: doc.revision,
      roots: doc.roots,
      audits: doc.audits,
      entries: entries.map((entry) => ({
        ...entry,
        userCount: users.filter((u) =>
          entries
            .find((e) => e.id === u.organizationId)
            ?.path.some((p) => p.id === entry.id),
        ).length,
      })),
    };
  });
  app.get("/api/system/users", async (request) => {
    systemOperator(actor(request));
    return store
      .snapshot()
      .users.map((u) => userView(u, store.organizations.snapshot()));
  });
  for (const section of ["organizations", "users"] as const) {
    for (const method of ["POST", "PATCH"] as const)
      app.route({
        method,
        url: `/api/system/${section}${method === "PATCH" ? "/:id" : ""}`,
        handler: async (request) => {
          const u = actor(request);
          systemOperator(u);
          const target =
            method === "PATCH"
              ? (request.params as { id: string }).id
              : undefined;
          const body = request.body || {};
          const key = z
            .string()
            .min(1)
            .max(160)
            .parse(request.headers["idempotency-key"]);
          const fingerprint = createHash("sha256")
            .update(JSON.stringify({ method, url: request.url, body }))
            .digest("hex");
          if (section === "organizations")
            return store.organizations.transact(
              u.id,
              key,
              fingerprint,
              () => systemOperator(actor(request)),
              (doc) => {
                const result = changeOrganization(
                  doc,
                  actor(request),
                  target,
                  body,
                );
                validatePolicies(store.snapshot(), doc);
                return result;
              },
              { action: "organization.change" },
            );
          return store.transact(
            u.id,
            key,
            fingerprint,
            (s) => systemOperator(actor(request, s)),
            (s) =>
              changeUser(
                s,
                store.organizations.snapshot(),
                actor(request, s),
                target,
                body,
              ),
            { action: "user.change" },
          );
        },
      });
  }
  for (const section of ["courses", "qualifications"] as const) {
    app.post(
      `/api/${section}/:id/save-preview`,
      { bodyLimit: 64 * 1024 * 1024 },
      async (request) => {
        const scope = managementScope(
          actor(request),
          store.organizations.snapshot(),
          (request.query as any).lv1OrganizationId,
        );
        return prepareCatalogSave(
          store.snapshot(),
          store.organizations.snapshot(),
          section,
          (request.params as any).id,
          request.body,
          scope,
        );
      },
    );
    mutation("POST", `/api/${section}`, "catalog.create", () => section);
    mutation("PUT", `/api/${section}/:id`, "catalog.save", () => section);
    mutation(
      "POST",
      `/api/${section}/:id/publish`,
      "catalog.publish",
      () => section,
    );
    mutation(
      "POST",
      `/api/${section}/:id/versions`,
      "catalog.clone",
      () => section,
    );
  }
  app.get("/api/courses/:id/usage", async (request) => {
    const scope = managementScope(
      actor(request),
      store.organizations.snapshot(),
      z
        .object({ lv1OrganizationId: z.string().optional() })
        .parse(request.query).lv1OrganizationId,
    );
    return courseUsage(
      store.snapshot(),
      (request.params as { id: string }).id,
      scope,
    );
  });
  app.get("/api/qualifications/:id/deletion-impact", async (request) => {
    const scope = managementScope(
      actor(request),
      store.organizations.snapshot(),
      (request.query as any).lv1OrganizationId,
    );
    return qualificationDeletionImpact(
      store.snapshot(),
      store.organizations.snapshot(),
      (request.params as any).id,
      scope,
    );
  });
  mutation("DELETE", "/api/qualifications/:id", "qualification.delete");
  mutation("DELETE", "/api/courses/:id", "course.delete");
  mutation("POST", "/api/courses/:id/retirement", "course.retire");
  mutation("POST", "/api/courses/:id/reactivation", "course.reactivate");
  mutation("POST", "/api/assignments", "assignment.create", () => "");
  mutation("POST", "/api/assignments/:id/ft", "assignment.ft");
  mutation("POST", "/api/assignments/:id/exclusion", "assignment.exclude");
  mutation("PUT", "/api/enrollments/:id/checklist", "checklist.update");
  mutation(
    "POST",
    "/api/enrollments/:id/subjective-response",
    "subjective.start",
  );
  mutation("PUT", "/api/subjective-responses/:id/draft", "subjective.save");
  mutation("POST", "/api/subjective-responses/:id/submit", "subjective.submit");
  mutation("POST", "/api/enrollments/:id/attempts", "attempt.start");
  mutation("PUT", "/api/attempts/:id/draft", "attempt.save");
  mutation("POST", "/api/attempts/:id/submit", "attempt.submit");
  mutation("PUT", "/api/attempts/:id/grading", "attempt.grade.save");
  mutation(
    "POST",
    "/api/attempts/:id/grading/finalize",
    "attempt.grade.finalize",
  );
  mutation(
    "POST",
    "/api/qualification-templates/import",
    "template.import",
    () => "",
  );
  mutation("POST", "/api/planning-requests", "planning.request", () => "");
  mutation("PUT", "/api/planning-requests/:id/selection", "planning.select");
  mutation("POST", "/api/planning-requests/:id/close", "planning.close");
  mutation("POST", "/api/planning-requests/:id/complete", "planning.complete");
  app.get("/api/planning-requests/:id/candidates", async (request) => {
    const u = actor(request),
      s = store.snapshot();
    const r = s.planningRequests.find(
      (r) => r.id === (request.params as any).id,
    );
    demand(
      r &&
        canContinueType(s, u, r.qualificationType) &&
        r.learnerId === u.id &&
        r.lv1OrganizationId === u.lv1OrganizationId,
      403,
      "본인의 계획 요청만 조회할 수 있습니다.",
    );
    return planningView(s, store.organizations.snapshot(), u, r, clock());
  });
  mutation("POST", "/api/plans", "plan.create", () => "");
  mutation("PUT", "/api/plans/:id", "plan.save");
  mutation(
    "POST",
    "/api/plans/:id/schedule-defaults",
    "plan.schedule-defaults",
  );
  mutation("DELETE", "/api/plans/:id", "plan.delete");
  mutation("POST", "/api/plans/:id/complete", "plan.complete");
  app.put("/api/enrollments/:id/learning", async (request, reply) => {
    const u = actor(request),
      s = store.snapshot(),
      e = s.enrollments.find((e) => e.id === (request.params as any).id);
    const a = s.assignments.find(
      (a) => a.id === e?.assignmentId && a.learnerId === u.id,
    );
    return reply.code(410).send({
      code: "FEATURE_REMOVED",
      message:
        "학습 완료 기록 기능은 종료되었습니다. 학습 안내에서 평가하기로 이동해 주세요.",
      href: a
        ? `/qualifications/${a.id}?course=${e!.courseId}`
        : "/qualifications",
    });
  });
  mutation("POST", "/api/notifications/:id/read", "notification.read");
  mutation("POST", "/api/notices", "notice.save", () => "");
  mutation("POST", "/api/testing/progress/reset", "progress.reset", () => "");
  if (options.serveFrontend) {
    const root = fileURLToPath(new URL("../../frontend/dist", import.meta.url));
    if (existsSync(root)) {
      await app.register(staticFiles, { root });
      app.setNotFoundHandler((request, reply) =>
        request.url.startsWith("/api/")
          ? reply.status(404).send({ message: "API를 찾을 수 없습니다." })
          : reply.sendFile("index.html"),
      );
    }
  }
  app.addHook("onClose", async () => {
    clearInterval(notificationTimer);
    sessions.clear();
    await store.close();
  });
  return app;
}
