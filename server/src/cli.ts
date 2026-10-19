import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./storage.ts";
import { seedState } from "./seed.ts";
import { migrateState } from "./migration.ts";

const file = path.resolve(
  process.env.EKS_DATA_FILE ||
    fileURLToPath(new URL("../../data/runtime/state.json", import.meta.url)),
);
const store = new JsonStore(file),
  command = process.argv[2];
if (command === "migrate") {
  await store.migrate(migrateState);
  console.log("업무 스키마 3 이관 완료 (조직·기존 기록 보존)");
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
    "init, migrate, backup, restore, organizations:restore, unlock 명령을 사용하세요.",
  );
