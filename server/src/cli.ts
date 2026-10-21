import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { JsonStore } from "./storage.ts";
import { seedState } from "./seed.ts";
import { migrateState } from "./migration.ts";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";
import {
  photoSetupApplied,
  photoSetupFingerprint,
  preparePhotoSetup,
} from "./photo-setup.ts";
import { PHOTO_FIXTURE_VERSION } from "./photo-certification-fixture.ts";
import { migrateAdministration } from "./administration-migration.ts";
import { migratePolicies } from "./policy-migration.ts";

const file = path.resolve(
  process.env.EKS_DATA_FILE ||
    fileURLToPath(new URL("../../data/runtime/state.json", import.meta.url)),
);
const store = new JsonStore(file),
  command = process.argv[2];
if (["migrate-policies", "migrate-administration"].includes(command)) {
  const transform =
    command === "migrate-administration"
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
          command === "migrate-administration" ? "administration" : "policies",
        ),
        null,
        2,
      ),
    );
  } else {
    if (options.some((v) => v !== "--dry-run"))
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
} else if (command === "setup-photo") {
  const options = process.argv.slice(3),
    value = (name: string) =>
      options.find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1),
    apply = options.includes("--apply");
  if (
    apply &&
    (!value("--expected-revision") ||
      !value("--expected-sha256") ||
      value("--confirm") !== "DELETE_ALL_PROGRESS")
  )
    throw new Error(
      "적용에는 --expected-revision=N --expected-sha256=HASH --confirm=DELETE_ALL_PROGRESS가 필요합니다.",
    );
  if (!apply && options.some((x) => x !== "--dry-run"))
    throw new Error(
      "미리보기는 --dry-run, 실제 적용은 --apply와 확인 옵션을 사용하세요.",
    );
  const stateBytes = await readFile(file),
    stateSha256 = createHash("sha256").update(stateBytes).digest("hex"),
    orgBytes = await readFile(store.organizations.file),
    orgSha256 = createHash("sha256").update(orgBytes).digest("hex"),
    organizations = validateOrganizations(
      JSON.parse(orgBytes.toString("utf8")),
    ),
    state = validateState(
      JSON.parse(stateBytes.toString("utf8")),
      organizations,
    ),
    actorId = "operator-1";
  if (!apply) {
    const result = photoSetupApplied(state)
      ? {
          alreadyApplied: true,
          version: PHOTO_FIXTURE_VERSION,
          fingerprint: photoSetupFingerprint,
          revision: state.revision,
        }
      : preparePhotoSetup(
          state,
          organizations,
          actorId,
          new Date().toISOString(),
        ).report;
    console.log(JSON.stringify({ stateSha256, orgSha256, ...result }, null, 2));
  } else {
    if (
      state.revision !== Number(value("--expected-revision")) ||
      stateSha256 !== value("--expected-sha256")
    )
      throw new Error(
        "미리보기 후 업무 데이터가 변경되었습니다. 새 미리보기를 확인하세요.",
      );
    await store.load();
    try {
      if (photoSetupApplied(store.snapshot())) {
        console.log(
          JSON.stringify(
            {
              alreadyApplied: true,
              version: PHOTO_FIXTURE_VERSION,
              revision: store.snapshot().revision,
            },
            null,
            2,
          ),
        );
      } else {
        const currentBytes = await readFile(file);
        if (
          createHash("sha256").update(currentBytes).digest("hex") !==
          stateSha256
        )
          throw new Error("저장소 잠금 이후 업무 데이터가 변경되었습니다.");
        const at = new Date().toISOString();
        const candidate = preparePhotoSetup(
          store.snapshot(),
          store.organizations.snapshot(),
          actorId,
          at,
        );
        const stateBackup = await store.backup();
        const organizationBackup = await store.organizations.backup();
        const report = await store.transact(
          actorId,
          `fixture:${PHOTO_FIXTURE_VERSION}`,
          photoSetupFingerprint,
          (latest) => {
            if (latest.revision !== state.revision || photoSetupApplied(latest))
              throw new Error("다른 작업으로 revision이 변경되었습니다.");
          },
          (latest) => {
            const next = preparePhotoSetup(
              latest,
              store.organizations.snapshot(),
              actorId,
              at,
            );
            Object.assign(latest, next.state);
            return { version: next.report.version, after: next.report.after };
          },
          {
            preserveBackup: true,
            backupPurpose: "photo-setup",
            action: "fixture.photo.apply",
            lv1OrganizationId: "org-photo",
          },
        );
        if (
          JSON.stringify(report.after) !==
          JSON.stringify(candidate.report.after)
        )
          throw new Error("적용 후 건수와 미리보기 건수가 일치하지 않습니다.");
        console.log(
          JSON.stringify(
            {
              ...candidate.report,
              stateBackup,
              organizationBackup,
              orgSha256,
              appliedRevision: store.snapshot().revision,
            },
            null,
            2,
          ),
        );
      }
    } finally {
      await store.close();
    }
  }
} else if (command === "migrate") {
  await store.migrate(migrateState);
  console.log("현행 업무 스키마 8 확인 완료");
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
    "init, migrate, migrate-policies, migrate-administration, setup-photo, backup, restore, organizations:restore, unlock 명령을 사용하세요.",
  );
