import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { User } from "@eks/contracts";
import { JsonStore, DomainError, demand } from "./storage.ts";
import { authorize, execute, workspace, attemptView } from "./domain.ts";

export async function buildApp(
  store: JsonStore,
  options: {
    logger?: boolean;
    origins?: string[];
    serveFrontend?: boolean;
  } = {},
) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
  });
  await app.register(cookie);
  const sessions = new Map<string, { actorId: string; expires: number }>();
  const origins = options.origins || [
    "http://127.0.0.1:5186",
    "http://127.0.0.1:5187",
  ];
  const actor = (request: FastifyRequest): User => {
    const sid = request.cookies.eks_session,
      session = sid ? sessions.get(sid) : undefined;
    demand(
      session && session.expires > Date.now(),
      401,
      "접속 계정을 선택해 주세요.",
      "SESSION_REQUIRED",
    );
    const u = store.snapshot().users.find((u) => u.id === session.actorId);
    demand(u, 401, "접속 계정을 선택해 주세요.");
    return u;
  };
  app.addHook("onRequest", async (request) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin
    )
      demand(
        origins.includes(request.headers.origin),
        403,
        "허용되지 않은 요청 출처입니다.",
      );
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError)
      return reply
        .status(error.status)
        .send({ code: error.code, message: error.message });
    if (error instanceof z.ZodError)
      return reply.status(422).send({
        code: "VALIDATION_ERROR",
        message: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n"),
      });
    const err = error as Error & { statusCode?: number };
    if (err.statusCode && err.statusCode < 500)
      return reply
        .status(err.statusCode)
        .send({
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
  app.get("/api/actors", async () => store.snapshot().users);
  app.get("/api/session", async (request) => ({ actor: actor(request) }));
  app.post("/api/session", async (request, reply) => {
    const { actorId } = z
        .object({ actorId: z.string().min(1) })
        .parse(request.body),
      u = store.snapshot().users.find((u) => u.id === actorId);
    demand(u, 422, "계정을 확인해 주세요.");
    if (request.cookies.eks_session)
      sessions.delete(request.cookies.eks_session);
    for (const [key, session] of sessions)
      if (session.expires < Date.now()) sessions.delete(key);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { actorId, expires: Date.now() + 8 * 60 * 60 * 1000 });
    reply.setCookie("eks_session", token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/api",
      maxAge: 8 * 60 * 60,
    });
    return { actor: u };
  });
  app.delete("/api/session", async (request, reply) => {
    if (request.cookies.eks_session)
      sessions.delete(request.cookies.eks_session);
    reply.clearCookie("eks_session", { path: "/api" });
    return { ok: true };
  });
  app.get("/api/workspace", async (request) =>
    workspace(store.snapshot(), actor(request)),
  );
  app.get("/api/home", async (request) => {
    const view = workspace(store.snapshot(), actor(request));
    return {
      assignments: view.assignments.filter((a) => !a.excludedReason),
      notices: view.notices.filter((n) => n.published),
    };
  });
  for (const name of [
    "courses",
    "qualifications",
    "assignments",
    "notices",
    "comparisons",
    "audits",
  ] as const) {
    app.get(
      `/api/${name}`,
      async (request) => workspace(store.snapshot(), actor(request))[name],
    );
    app.get(`/api/${name}/:id`, async (request) => {
      const view = workspace(store.snapshot(), actor(request)),
        id = (request.params as any).id,
        result = view[name].find((x) => x.id === id);
      demand(result, 404, "기록을 찾을 수 없습니다.");
      return result;
    });
  }
  app.get("/api/attempts/:id", async (request) => {
    const u = actor(request),
      s = store.snapshot(),
      t = s.attempts.find((t) => t.id === (request.params as any).id);
    demand(t, 404, "평가를 찾을 수 없습니다.");
    return attemptView(s, u, t);
  });
  app.get("/api/assignments/:id/results", async (request) => {
    const view = workspace(store.snapshot(), actor(request)),
      a = view.assignments.find((a) => a.id === (request.params as any).id);
    demand(a, 404, "과제를 찾을 수 없습니다.");
    return {
      assignment: a,
      audits: view.audits.filter((ev) => ev.assignmentId === a.id),
    };
  });
  app.get("/api/assignments/:id/certification", async (request) => {
    const view = workspace(store.snapshot(), actor(request)),
      a = view.assignments.find((a) => a.id === (request.params as any).id);
    demand(a?.certification, 404, "인증을 찾을 수 없습니다.");
    return {
      certification: a.certification,
      excludedReason: a.excludedReason,
      completions: a.enrollments.map((e) => e.completion),
    };
  });
  const mutation = (
    method: "POST" | "PUT",
    url: string,
    action: string,
    target?: (p: any) => string,
  ) =>
    app.route({
      method,
      url,
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
        return store.transact(
          u.id,
          key,
          fingerprint,
          (s) => authorize(s, u, action, targetId, payload),
          (s) => execute(s, u, action, targetId, payload),
        );
      },
    });
  for (const section of ["courses", "qualifications"]) {
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
  mutation("POST", "/api/assignments", "assignment.create", () => "");
  mutation("POST", "/api/assignments/:id/ft", "assignment.ft");
  mutation("POST", "/api/assignments/:id/exclusion", "assignment.exclude");
  mutation("POST", "/api/enrollments/:id/attempts", "attempt.start");
  mutation("PUT", "/api/attempts/:id/draft", "attempt.save");
  mutation("POST", "/api/attempts/:id/submit", "attempt.submit");
  mutation("POST", "/api/notices", "notice.save", () => "");
  mutation("POST", "/api/enrollments/:id/comparisons", "comparison.create");
  mutation("PUT", "/api/comparisons/:id", "comparison.save");
  mutation("POST", "/api/comparisons/:id/finalize", "comparison.finalize");
  mutation("POST", "/api/comparisons/:id/corrections", "comparison.correct");
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
    sessions.clear();
    await store.close();
  });
  return app;
}
