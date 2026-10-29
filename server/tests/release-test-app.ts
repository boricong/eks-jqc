import { buildApp as buildProductionApp } from "../src/app.ts";
import { criteriaFingerprint } from "../src/releases.ts";

/** Existing API scenarios use the current client contract. Boundary tests import app.ts directly. */
export async function buildApp(...args: Parameters<typeof buildProductionApp>) {
  const app = await buildProductionApp(...args),
    store = args[0],
    inject = app.inject.bind(app);
  const requests = new Map<string, unknown>();
  app.inject = ((options: any, ...rest: any[]) => {
    if (typeof options === "object") {
      options = {
        ...options,
        headers: { ...options.headers, "x-eks-release-contract": "2" },
      };
      const path = String(options.url || "");
      let body = options.payload;
      if (typeof body === "string") body = undefined;
      if (body && typeof body === "object") {
        const cacheKey = JSON.stringify({
          path,
          method: options.method,
          headers: options.headers,
          body,
        });
        if (requests.has(cacheKey)) options.payload = requests.get(cacheKey);
        else {
          const s = store.snapshot();
          let payload = { ...body };
          if (
            /^\/api\/system\/(common-courses|qualification-templates)(\/[^/]+)?$/.test(
              path,
            ) &&
            ["PUT", "POST"].includes(options.method)
          )
            payload = {
              ...payload,
              review: {
                stateRevision: s.revision,
                organizationRevision: store.organizations.snapshot().revision,
              },
            };
          if (
            path.startsWith("/api/organization-qualification-requirements") &&
            payload.changes
          )
            payload = {
              ...payload,
              contractVersion: 2,
              changes: payload.changes.map((c: any) => ({
                exclusions: [],
                removalReasons: [],
                ...c,
              })),
            };
          const m = path.match(/^\/api\/plans\/([^/]+)\/complete$/);
          if (m) {
            const p = s.plans.find((p) => p.id === m[1]);
            const q = s.qualifications.find((q) => q.id === p?.qualificationId);
            if (q) payload.criteriaToken = criteriaFingerprint(s, q);
          }
          options.payload = payload;
          requests.set(cacheKey, payload);
        }
      }
    }
    return (inject as any)(options, ...rest);
  }) as typeof app.inject;
  return app;
}
