import assert from "node:assert/strict";
import {
  constants,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { JsonStore } from "../server/src/storage.ts";
import { validateState } from "../server/src/integrity.ts";
import { validateOrganizations } from "../server/src/organizations.ts";

// No migration or business-data write: this release adds optional schema-5 fields.
const stateFile = "data/runtime/state.json",
  organizationFile = "data/master/organizations.json";
const reportFile = "data/runtime/plan-theme-deployment-verification.json";
const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
const [stateRaw, organizationRaw] = await Promise.all([
  readFile(stateFile),
  readFile(organizationFile),
]);
const organizations = validateOrganizations(
  JSON.parse(organizationRaw.toString("utf8")),
);
const state = validateState(
  JSON.parse(stateRaw.toString("utf8")),
  organizations,
);
assert.equal(state.schemaVersion, 5);
if (process.argv[2] === "verify") {
  const report = JSON.parse(await readFile(reportFile, "utf8"));
  assert.equal(
    hash(stateRaw),
    report.beforeHash,
    "Business data changed after backup: review the difference.",
  );
  assert.equal(
    hash(organizationRaw),
    report.organizationHash,
    "Organization master changed.",
  );
  assert.equal(state.revision, report.revision);
  Object.assign(report, {
    verifiedAt: new Date().toISOString(),
    afterHash: hash(stateRaw),
    allRecordsPreserved: true,
    organizationUnchanged: true,
  });
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} else {
  const expected = Number(process.argv[2]);
  assert.ok(
    Number.isInteger(expected) && process.argv[3],
    "Pass reviewed revision and SHA-256; stop the development server first.",
  );
  assert.equal(
    state.revision,
    expected,
    "Review the updated revision before deployment.",
  );
  assert.equal(
    hash(stateRaw),
    process.argv[3],
    "Review the updated data before deployment.",
  );
  const store = await new JsonStore(stateFile).load();
  try {
    assert.deepEqual(store.snapshot(), state);
    const atKst = new Date()
      .toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })
      .replace(/[-: ]/g, "");
    const stateBackup = `data/backups/state/before-plan-theme-${atKst}.json`;
    const organizationBackup = `data/backups/organizations/before-plan-theme-${atKst}.json`;
    await mkdir("data/backups/state", { recursive: true });
    await mkdir("data/backups/organizations", { recursive: true });
    await copyFile(stateFile, stateBackup, constants.COPYFILE_EXCL);
    await copyFile(
      organizationFile,
      organizationBackup,
      constants.COPYFILE_EXCL,
    );
    assert.equal(hash(await readFile(stateBackup)), hash(stateRaw));
    assert.equal(
      hash(await readFile(organizationBackup)),
      hash(organizationRaw),
    );
    assert.equal(hash(await readFile(stateFile)), hash(stateRaw));
    assert.equal(hash(await readFile(organizationFile)), hash(organizationRaw));
    const report = {
      atKst,
      revision: state.revision,
      schemaVersion: state.schemaVersion,
      stateBackup,
      organizationBackup,
      beforeHash: hash(stateRaw),
      organizationHash: hash(organizationRaw),
      counts: Object.fromEntries(
        Object.entries(state)
          .filter(([, value]) => Array.isArray(value))
          .map(([key, value]) => [key, (value as unknown[]).length]),
      ),
      migrationRequired: false,
    };
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await store.close();
  }
}
