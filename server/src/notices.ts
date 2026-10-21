import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  NoticeSchema,
  kstDate,
  type State,
  type UserView,
} from "@eks/contracts";
import { demand } from "./errors.ts";
import { systemOperator } from "./organizations.ts";

export function authorizeNotice(
  s: State,
  u: UserView,
  body: any,
  scope: "team" | "system",
  lv1?: string,
) {
  body ??= {};
  if (scope === "system") systemOperator(u);
  else
    demand(
      (u.roles.includes("admin") || u.roles.includes("system_operator")) && lv1,
      403,
      "팀 공지 관리 권한이 필요합니다.",
    );
  demand(
    body.scope === undefined || body.scope === scope,
    422,
    "공지 구분을 변경할 수 없습니다.",
  );
  demand(
    body.lv1OrganizationId === undefined ||
      (scope === "team" && body.lv1OrganizationId === lv1),
    403,
    "공지 게시 대상을 변경할 수 없습니다.",
  );
  if (body.id) {
    const current = s.notices.find((n) => n.id === body.id);
    demand(current, 404, "공지를 찾을 수 없습니다.");
    demand(
      current.scope === scope &&
        (scope === "system" || current.lv1OrganizationId === lv1),
      403,
      "이 게시 대상의 공지를 수정할 수 없습니다.",
    );
  }
}
export function saveNotice(
  s: State,
  u: UserView,
  body: unknown,
  scope: "team" | "system",
  lv1?: string,
) {
  const input = z
    .object({
      id: z.string().optional(),
      title: z.string().trim().min(1).max(300),
      body: z.string().trim().min(1).max(20000),
      date: z.iso.date().optional(),
      published: z.boolean(),
      revision: z.number().int().positive().optional(),
      scope: z.enum(["team", "system"]).optional(),
      lv1OrganizationId: z.string().optional(),
    })
    .strict()
    .parse(body);
  authorizeNotice(s, u, input, scope, lv1);
  const old = s.notices.find((n) => n.id === input.id);
  if (old)
    demand(
      old.revision === input.revision,
      409,
      "다른 창에서 공지가 변경되었습니다. 다시 불러와 주세요.",
      "REVISION_CONFLICT",
    );
  const before = old ? structuredClone(old) : null;
  const next = NoticeSchema.parse({
    ...input,
    id: old?.id || randomUUID(),
    scope,
    lv1OrganizationId: scope === "team" ? lv1 : undefined,
    date: input.date || kstDate(),
    revision: (old?.revision || 0) + 1,
  });
  if (old) Object.assign(old, next);
  else s.notices.push(next);
  s.audits.push({
    id: randomUUID(),
    actorId: u.id,
    date: new Date().toISOString(),
    action: scope === "team" ? "notice.save" : "system.notice.save",
    targetId: next.id,
    ...(scope === "team" ? { lv1OrganizationId: lv1 } : {}),
    reason: scope === "team" ? "팀 공지 저장" : "전 조직 시스템 공지 저장",
    details: JSON.parse(JSON.stringify({ before, after: next })),
  });
  return { id: next.id, revision: next.revision };
}
