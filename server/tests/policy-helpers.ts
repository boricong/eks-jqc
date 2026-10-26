import { randomUUID } from "node:crypto";
import {
  organizationEntries,
  qualificationReadinessErrors,
} from "@eks/contracts";
import { nodeFor } from "../src/organizations.ts";
import type { JsonStore } from "../src/storage.ts";
// Explicit test setup only: production installation never selects a pool.
export async function configureTestPolicies(
  store: JsonStore,
  root = "org-photo",
  organizationIds?: string[],
  qualificationIds?: string[],
) {
  const state = store.snapshot(),
    selected = state.qualifications.filter(
      (q) =>
        q.lv1OrganizationId === root &&
        !q.deletedAt &&
        !qualificationReadinessErrors(q, state.courses).length &&
        (!qualificationIds || qualificationIds.includes(q.id)),
    );
  const versions = [
    ...new Map(
      selected
        .sort((a, b) => (a.version ?? 0) - (b.version ?? 0))
        .map((q) => [q.entityId, q]),
    ).values(),
  ];
  await store.organizations.transact(
    "operator-1",
    randomUUID(),
    "test-policy",
    () => {},
    (doc) => {
      for (const e of organizationEntries(doc).filter(
        (e) =>
          e.lv1OrganizationId === root &&
          (!organizationIds || organizationIds.includes(e.id)),
      ))
        nodeFor(doc.roots, e.id)!.requiredQualifications = versions.map(
          (q) => q.entityId,
        );
      return {};
    },
  );
}
