import { migrateObjectiveRenewals } from "./objective-renewal-migration.ts";
import { migratePlanningSchedule } from "./planning-schedule-migration.ts";
import { migrateRequirementExceptions } from "./requirement-exception-migration.ts";
import { migrateReleases } from "./release-migration.ts";
import { migrateQualificationPlans } from "./qualification-plan-migration.ts";
import { migrateAuditorPool } from "./auditor-pool-migration.ts";
import { migrateOrganizationNeeds } from "./organization-requirement-migration.ts";
import { migrateSubjective } from "./subjective-migration.ts";
import { migrateRequiredQualifications } from "./required-qualification-migration.ts";
import { migrateCommonCourses } from "./common-course-migration.ts";
import { migrateAutomaticCriteria } from "./automatic-criteria-migration.ts";
import { migrateReadyQualifications } from "./ready-qualification-migration.ts";
import { migrateAuditorProgram } from "./auditor-program-migration.ts";
import { migrateAuditorWorkflow } from "./auditor-migration.ts";
import { migrateCourseTypes } from "./course-type-migration.ts";
import { migrateQualificationTypes } from "./qualification-type-migration.ts";
import { migratePlanning } from "./planning-migration.ts";
import { migrateTemplates } from "./template-migration.ts";
import { migrateCatalogEditing } from "./catalog-editing-migration.ts";
import { migrateAssessmentFlow } from "./assessment-flow-migration.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { JsonStore } from "./storage.ts";
import { seedState } from "./seed.ts";
import { migrateState } from "./migration.ts";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";
import { migrateAdministration } from "./administration-migration.ts";
import { migratePolicies } from "./policy-migration.ts";
import { migrateLifecycle } from "./lifecycle-migration.ts";

const file = path.resolve(
  process.env.EKS_DATA_FILE ||
    fileURLToPath(new URL("../../data/runtime/state.json", import.meta.url)),
);
const store = new JsonStore(file),
  command = process.argv[2];
if (
  [
    "migrate-policies",
    "migrate-administration",
    "migrate-lifecycle",
    "migrate-assessment-flow",
    "migrate-catalog-editing",
    "migrate-templates",
    "migrate-planning",
    "migrate-qualification-types",
    "migrate-course-types",
    "migrate-auditor-workflow",
    "migrate-auditor-program",
    "migrate-automatic-criteria",
    "migrate-ready-qualifications",
    "migrate-common-courses",
    "migrate-remove-required-qualifications",
    "migrate-subjective",
    "migrate-organization-needs",
    "migrate-auditor-pool",
    "migrate-qualification-plans",
    "migrate-releases",
    "migrate-requirement-exceptions",
    "migrate-objective-renewals",
    "migrate-planning-schedule",
  ].includes(command)
) {
  const mappingFile = optionsMapping();
  function optionsMapping() {
    return optionsRaw()
      .find((v) => v.startsWith("--mapping="))
      ?.slice(10);
  }
  function optionsRaw() {
    return process.argv.slice(3);
  }
  const mapping = mappingFile
    ? JSON.parse(await readFile(path.resolve(mappingFile), "utf8"))
    : {};
  const transform =
    command === "migrate-planning-schedule"
      ? migratePlanningSchedule
      : command === "migrate-objective-renewals"
        ? migrateObjectiveRenewals
        : command === "migrate-requirement-exceptions"
          ? migrateRequirementExceptions
          : command === "migrate-releases"
            ? migrateReleases
            : command === "migrate-qualification-plans"
              ? migrateQualificationPlans
              : command === "migrate-auditor-pool"
                ? migrateAuditorPool
                : command === "migrate-organization-needs"
                  ? migrateOrganizationNeeds
                  : command === "migrate-subjective"
                    ? migrateSubjective
                    : command === "migrate-remove-required-qualifications"
                      ? migrateRequiredQualifications
                      : command === "migrate-common-courses"
                        ? migrateCommonCourses
                        : command === "migrate-ready-qualifications"
                          ? migrateReadyQualifications
                          : command === "migrate-automatic-criteria"
                            ? migrateAutomaticCriteria
                            : command === "migrate-auditor-program"
                              ? migrateAuditorProgram
                              : command === "migrate-auditor-workflow"
                                ? migrateAuditorWorkflow
                                : command === "migrate-course-types"
                                  ? migrateCourseTypes
                                  : command === "migrate-qualification-types"
                                    ? migrateQualificationTypes
                                    : command === "migrate-planning"
                                      ? migratePlanning
                                      : command === "migrate-templates"
                                        ? (a: unknown, b: unknown) =>
                                            migrateTemplates(
                                              a,
                                              b,
                                              undefined,
                                              mapping,
                                            )
                                        : command === "migrate-catalog-editing"
                                          ? migrateCatalogEditing
                                          : command ===
                                              "migrate-assessment-flow"
                                            ? migrateAssessmentFlow
                                            : command === "migrate-lifecycle"
                                              ? migrateLifecycle
                                              : command ===
                                                  "migrate-administration"
                                                ? migrateAdministration
                                                : migratePolicies;
  const options = process.argv.slice(3),
    value = (name: string) =>
      options.find((v) => v.startsWith(name + "="))?.slice(name.length + 1);
  const stateBytes = await readFile(file),
    orgBytes = await readFile(store.organizations.file);
  const stateHash = createHash("sha256").update(stateBytes).digest("hex"),
    organizationHash = createHash("sha256").update(orgBytes).digest("hex");
  if (options.includes("--apply")) {
    if (
      !value("--expected-revision") ||
      !value("--expected-sha256") ||
      !value("--organization-sha256")
    )
      throw new Error(
        "적용에는 업무 revision·SHA256·조직 SHA256이 필요합니다.",
      );
    console.log(
      JSON.stringify(
        await store.migratePolicies(
          {
            revision: Number(value("--expected-revision")),
            stateHash: value("--expected-sha256")!,
            organizationHash: value("--organization-sha256")!,
          },
          transform,
          command === "migrate-planning-schedule"
            ? "planning-schedule"
            : command === "migrate-objective-renewals"
              ? "objective-renewals"
              : command === "migrate-requirement-exceptions"
                ? "requirement-exceptions"
                : command === "migrate-releases"
                  ? "releases"
                  : command === "migrate-qualification-plans"
                    ? "qualification-plans"
                    : command === "migrate-auditor-pool"
                      ? "auditor-pool"
                      : command === "migrate-organization-needs"
                        ? "organization-needs"
                        : command === "migrate-subjective"
                          ? "subjective"
                          : command === "migrate-remove-required-qualifications"
                            ? "remove-required-qualifications"
                            : command === "migrate-common-courses"
                              ? "common-courses"
                              : command === "migrate-ready-qualifications"
                                ? "ready-qualifications"
                                : command === "migrate-automatic-criteria"
                                  ? "automatic-criteria"
                                  : command === "migrate-auditor-program" ||
                                      command === "migrate-auditor-workflow"
                                    ? "auditor-workflow"
                                    : command === "migrate-course-types"
                                      ? "course-types"
                                      : command ===
                                          "migrate-qualification-types"
                                        ? "qualification-types"
                                        : command === "migrate-planning"
                                          ? "planning"
                                          : command === "migrate-templates"
                                            ? "qualification-templates"
                                            : command ===
                                                "migrate-catalog-editing"
                                              ? "catalog-editing"
                                              : command ===
                                                  "migrate-assessment-flow"
                                                ? "assessment-flow"
                                                : command ===
                                                    "migrate-lifecycle"
                                                  ? "lifecycle"
                                                  : command ===
                                                      "migrate-administration"
                                                    ? "administration"
                                                    : "policies",
        ),
        null,
        2,
      ),
    );
  } else {
    if (options.some((v) => v !== "--dry-run" && !v.startsWith("--mapping=")))
      throw new Error("미리보기는 --dry-run을 사용하세요.");
    console.log(
      JSON.stringify(
        {
          expectedRevision: JSON.parse(stateBytes.toString("utf8")).revision,
          currentOrganizationRevision: JSON.parse(orgBytes.toString("utf8"))
            .revision,
          stateHash,
          organizationHash,
          ...transform(
            JSON.parse(stateBytes.toString("utf8")),
            JSON.parse(orgBytes.toString("utf8")),
          ).report,
        },
        null,
        2,
      ),
    );
  }
} else if (command === "transition-assessments") {
  throw new Error(
    "이전 무백업 전환 예외는 종료되었습니다. 스키마 6·조직 1은 data:migrate-policies를 사용하세요.",
  );
} else if (command === "recover-master") {
  console.log(JSON.stringify(await store.recoverMasterReplacement(), null, 2));
} else if (command === "migrate") {
  await store.migrate(migrateState);
  console.log("현행 업무 스키마 21 확인 완료");
} else if (command === "organizations:restore") {
  const source = process.argv[3];
  if (!source) throw new Error("조직 백업 경로가 필요합니다.");
  await store.restoreOrganizations(path.resolve(source));
  console.log("조직 백업 복구 완료");
} else if (command === "init") {
  await store.initialize(seedState());
  console.log(`초기 데이터 생성: ${file}`);
} else if (command === "restore") {
  const source = process.argv[3];
  if (!source) throw new Error("npm run data:restore -- <백업 경로>");
  await store.restore(path.resolve(source));
  console.log("백업 복구 완료");
} else if (command === "backup") {
  await store.load();
  try {
    console.log(await store.backup());
    console.log(await store.organizations.backup());
  } finally {
    await store.close();
  }
} else if (command === "unlock") {
  for (const target of [file, store.organizations.file]) {
    try {
      await JsonStore.unlock(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  console.log("종료된 프로세스의 잠금 해제 완료");
} else
  throw new Error(
    "init, migrate, migrate-policies, migrate-administration, backup, restore, organizations:restore, unlock 명령을 사용하세요.",
  );
