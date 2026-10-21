import { randomUUID } from "node:crypto";
import { organizationEntries } from "@eks/contracts";
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
        q.status === "published" &&
        (!qualificationIds || qualificationIds.includes(q.id)),
    );
  const versions = [
    ...new Map(
      selected
        .sort((a, b) => a.version - b.version)
        .map((q) => [q.entityId, q]),
    ).values(),
  ];
  await store.organizations.transact(
    "operator-1",
    randomUUID(),
    "test-policy",
    () => {},
    (doc) => {
      doc.qualificationPools = [
        ...doc.qualificationPools.filter((p) => p.lv1OrganizationId !== root),
        ...versions.map((q) => ({
          lv1OrganizationId: root,
          entityId: q.entityId,
          qualificationId: q.id,
        })),
      ];
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
