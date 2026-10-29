import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { JsonStore } from "../src/storage.ts";
import { migratePlanningSchedule } from "../src/planning-schedule-migration.ts";
import { migrateWorkStatus } from "../src/work-status-migration.ts";
/** Old migration scenarios explicitly finish the 28→29 upgrade before opening today's server. */
export async function loadPlanningFixture(file: string) {
  const store = new JsonStore(file),
    bytes = await readFile(file),
    raw = JSON.parse(bytes.toString());
  if (raw.schemaVersion === 28) {
    const org = await readFile(store.organizations.file),
      hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    await store.migratePolicies(
      {
        revision: raw.revision,
        stateHash: hash(bytes),
        organizationHash: hash(org),
      },
      migratePlanningSchedule,
    );
  }
  const current = await readFile(file),
    state = JSON.parse(current.toString());
  if (state.schemaVersion === 29) {
    const org = await readFile(store.organizations.file),
      hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    await store.migratePolicies(
      {
        revision: state.revision,
        stateHash: hash(current),
        organizationHash: hash(org),
      },
      migrateWorkStatus,
    );
  }
  return store.load();
}
