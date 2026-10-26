// Preserved pre-v23 requests are test fixtures, not a supported creation API.
// Tests using this helper exercise ongoing legacy plans/learning and selection compatibility.
import { randomUUID, createHash } from "node:crypto";
import { defaultPlanningDueOn } from "@eks/contracts";
import { userView } from "../src/organizations.ts";
import { notify } from "../src/notifications.ts";
import type { JsonStore } from "../src/storage.ts";
export async function legacyRequestFixture(
  store: JsonStore,
  actorId: string,
  body: {
    learnerIds: string[];
    message: string;
    dueOn?: string;
    qualificationType?: "auditee" | "auditor";
  },
  key = randomUUID(),
) {
  const at = new Date().toISOString();
  return store.transact(
    actorId,
    key,
    createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    () => {},
    (s) => {
      const ids: string[] = [];
      for (const learnerId of body.learnerIds) {
        const learner = userView(
            s.users.find((u) => u.id === learnerId)!,
            store.organizations.snapshot(),
          ),
          id = randomUUID();
        ids.push(id);
        s.planningRequests.push({
          id,
          qualificationType: body.qualificationType || "auditee",
          lv1OrganizationId: learner.lv1OrganizationId,
          learnerId,
          requestedBy: actorId,
          organizationId: learner.organizationId,
          organizationPath: learner.organizationPath,
          selections: [],
          mode: "learner_choice",
          source: "requested",
          dueOn: body.dueOn || defaultPlanningDueOn(at),
          message: body.message,
          createdAt: at,
          revision: 1,
        });
        notify(
          s,
          {
            key: `planning:${id}`,
            recipientId: learnerId,
            lv1OrganizationId: learner.lv1OrganizationId,
            type: "planning",
            qualificationType: body.qualificationType || "auditee",
            title: "개인 인증 계획을 수립해 주세요",
            body: `계획 작성 기한 ${body.dueOn || defaultPlanningDueOn(at)} · ${body.message}`,
            href: `/plans?request=${id}`,
          },
          at,
        );
      }
      return { ids };
    },
  );
}
