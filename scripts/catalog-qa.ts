// Read-only development-data export and native Excel round-trip verification.
// Generated workbooks are disposable QA copies; this script never opens a store for writing.
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { transitionAssessments } from "../server/src/assessment-transition.ts";
import { exportCatalog, prepareCatalog } from "../server/src/catalog.ts";
import {
  writeCatalogWorkbook,
  readCatalogWorkbook,
} from "../server/src/catalog-workbook.ts";
const organizations = JSON.parse(
  await readFile("data/master/organizations.json", "utf8"),
);
// Build a disposable schema6 candidate in memory; never replace development JSON.
const state = transitionAssessments(
  JSON.parse(await readFile("data/runtime/state.json", "utf8")),
  organizations,
).state;
const data = exportCatalog(
  state,
  "org-photo",
  state.qualifications
    .filter(
      (q) => q.lv1OrganizationId === "org-photo" && q.status === "published",
    )
    .map((q) => q.id),
);
if (process.argv[2] === "generate") {
  await writeFile(
    "data/runtime/catalog-qa.xlsx",
    await writeCatalogWorkbook(data),
  );
  console.log(
    JSON.stringify({
      sheets: data.sheets.length,
      courses: data.sheets.reduce((n, q) => n + q.tables.courses.length, 0),
    }),
  );
} else {
  const start = performance.now(),
    parsed = await readCatalogWorkbook(
      await readFile(
        process.argv[2] || "data/runtime/catalog-excel-resaved.xlsx",
      ),
    );
  const result = prepareCatalog(state, parsed.workbook, "org-photo");
  const summary = {
    sheets: parsed.workbook.sheets.length,
    issues: [...parsed.issues, ...result.issues],
    changes: result.changes,
    elapsedMs: performance.now() - start,
  };
  await writeFile(
    "data/runtime/catalog-native-excel-verification.json",
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}
