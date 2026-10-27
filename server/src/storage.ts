import { migrateState } from "./migration.ts";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  rm,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { TEST_DATA_RECIPE_VERSION } from "@eks/contracts";
import type {
  State,
  OrganizationDocument,
  TestDataAction,
  TestDataReceipt,
} from "@eks/contracts";
import { MaintenanceDocumentSchema, contentHash } from "./maintenance.ts";
import { seedOrganizations, validateOrganizations } from "./organizations.ts";
import { demand, DomainError } from "./errors.ts";
export { demand, DomainError } from "./errors.ts";
import { validateState } from "./integrity.ts";
import { reconcileNotifications } from "./notifications.ts";
import { reconcilePendingAuditor } from "./domain.ts";

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  invalidate() {
    this.epoch++;
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    const next = this.tail.then(() => {
      demand(
        epoch === this.epoch,
        409,
        "데이터가 초기화 또는 교체되었습니다. 계정을 다시 선택해 주세요.",
        "DATASET_CHANGED",
      );
      return operation();
    });
    this.tail = next.catch(() => {});
    return next;
  }
  async idle() {
    await this.tail;
  }
}
type Document = { revision: number; requests: State["requests"] };
export class FileStore<T extends Document> {
  async withMaintenanceLock<R>(operation: () => Promise<R>): Promise<R> {
    await this.lock();
    try {
      return await operation();
    } finally {
      await this.release();
    }
  }
  protected state!: T;
  private token = randomUUID();
  protected closed = false;
  readonly lockPath: string;
  readonly backupDir: string;
  beforeReplace?: () => void | Promise<void>;
  constructor(
    readonly file: string,
    protected validate: (input: unknown) => T,
    protected queue = new SerialQueue(),
  ) {
    this.lockPath = `${file}.lock`;
    this.backupDir = path.resolve(
      path.dirname(file),
      "../backups",
      path.basename(file, ".json"),
    );
  }
  protected async lock() {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      await mkdir(this.lockPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(
          "저장소가 잠겨 있습니다. 실행 중인 서버를 확인하거나 data:unlock을 사용하세요.",
        );
      throw e;
    }
    try {
      await writeFile(
        path.join(this.lockPath, "owner.json"),
        JSON.stringify({ pid: process.pid, token: this.token }),
      );
    } catch (e) {
      await rm(this.lockPath, { recursive: true, force: true });
      throw e;
    }
  }
  async load() {
    await this.lock();
    try {
      this.state = this.validate(JSON.parse(await readFile(this.file, "utf8")));
    } catch (e) {
      await this.release();
      throw new Error(
        `저장소를 열 수 없습니다: ${this.file}. 자동 초기화하지 않습니다. 업무24는 data:migrate-qualification-plans, 업무23은 data:migrate-auditor-pool, 업무22는 data:migrate-organization-needs, 업무21은 data:migrate-subjective, 업무20은 data:migrate-remove-required-qualifications, 업무8은 data:migrate-lifecycle, 업무7은 data:migrate-administration, 업무6·조직1은 data:migrate-policies의 보존 이관을 확인하세요. 손상 파일은 백업 쌍 복구가 필요합니다. ${String(e)}`,
      );
    }
    return this;
  }
  async initialize(state: T) {
    await this.lock();
    try {
      try {
        await readFile(this.file);
        throw new Error("기존 저장소는 초기화하지 않습니다.");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      this.state = this.validate(state);
      await this.writeAtomic(this.file, this.state);
    } finally {
      await this.release();
    }
  }
  snapshot(): T {
    if (this.closed) throw new DomainError(503, "저장소가 닫혔습니다.");
    return structuredClone(this.state);
  }
  // Publish only after a coordinated replacement has made every file durable.
  publishSnapshot(value: T) {
    this.state = this.validate(value);
  }
  block() {
    this.closed = true;
  }
  protected async writeAtomic(file: string, state: unknown) {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(
          Buffer.isBuffer(state)
            ? state
            : JSON.stringify(state, null, 2) + "\n",
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, file);
      // Windows does not support fsync on directory handles.
      if (process.platform !== "win32") {
        const dir = await open(path.dirname(file), "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
    } finally {
      await rm(temp, { force: true });
    }
  }
  protected enqueue<R>(operation: () => Promise<R>): Promise<R> {
    return this.queue.run(operation);
  }
  async transact<R>(
    actorId: string,
    key: string,
    fingerprint: string,
    authorize: (s: T) => void,
    update: (s: T) => R,
    options: {
      preserveBackup?: boolean;
      backupPurpose?:
        | "qualification-delete"
        | "course-delete"
        | "catalog-import"
        | "catalog-publish"
        | "qualification-lifecycle";
      action?: string;
      lv1OrganizationId?: string;
    } = {},
  ): Promise<R> {
    return this.enqueue(async () => {
      demand(!this.closed, 503, "저장소가 닫혔습니다.");
      authorize(this.state);
      const previous = this.state.requests.find(
        (r) => r.actorId === actorId && r.key === key,
      );
      if (previous) {
        demand(
          previous.fingerprint === fingerprint,
          409,
          "같은 요청 식별자로 다른 내용을 보냈습니다.",
          "IDEMPOTENCY_CONFLICT",
        );
        return structuredClone(previous.response) as R;
      }
      const next = structuredClone(this.state),
        response = update(next);
      next.revision++;
      next.requests.push({
        actorId,
        key,
        fingerprint,
        response: JSON.parse(JSON.stringify(response)),
        date: new Date().toISOString(),
        action: options.action,
        lv1OrganizationId: options.lv1OrganizationId,
      });
      const checked = this.validate(next);
      await mkdir(this.backupDir, { recursive: true });
      await this.writeAtomic(
        path.join(
          this.backupDir,
          options.preserveBackup
            ? `before-${options.backupPurpose || "reset"}-${this.state.revision}-${randomUUID()}.json`
            : `state-${this.state.revision}.json`,
        ),
        this.state,
      );
      await this.beforeReplace?.();
      try {
        await this.writeAtomic(this.file, checked);
      } catch (e) {
        // A directory sync can fail after rename. Reconcile memory with the actual file
        // so retrying the same request cannot apply a committed mutation twice.
        try {
          this.state = this.validate(
            JSON.parse(await readFile(this.file, "utf8")),
          );
        } catch {
          this.closed = true;
        }
        throw e;
      }
      this.state = checked;
      await this.pruneBackups();
      return structuredClone(response);
    });
  }
  protected async pruneBackups() {
    // Keep autosave backups bounded; manual and pre-restore copies are never pruned.
    try {
      const files = (await readdir(this.backupDir))
        .filter((name) => /^state-\d+\.json$/.test(name))
        .sort((a, b) => Number(b.slice(6, -5)) - Number(a.slice(6, -5)));
      await Promise.all(
        files.slice(20).map((name) => rm(path.join(this.backupDir, name))),
      );
    } catch {
      process.emitWarning(
        "자동 백업 정리를 완료하지 못했습니다. 현재 저장은 완료되었습니다.",
      );
    }
  }
  async backup() {
    return this.enqueue(async () => {
      await mkdir(this.backupDir, { recursive: true });
      const file = path.join(this.backupDir, `manual-${Date.now()}.json`);
      await this.writeAtomic(file, this.state);
      return file;
    });
  }
  async restore(source: string, check?: (next: T) => void) {
    await this.lock();
    try {
      const restored = this.validate(
        JSON.parse(await readFile(source, "utf8")),
      );
      check?.(restored);
      await mkdir(this.backupDir, { recursive: true });
      try {
        const current = await readFile(this.file);
        await writeFile(
          path.join(this.backupDir, `before-restore-${Date.now()}.json`),
          current,
          {
            mode: 0o600,
          },
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await this.writeAtomic(this.file, restored);
    } finally {
      await this.release();
    }
  }
  protected async release() {
    const owner = JSON.parse(
      await readFile(path.join(this.lockPath, "owner.json"), "utf8"),
    );
    if (owner.token === this.token)
      await rm(this.lockPath, { recursive: true, force: true });
  }
  async close() {
    await this.queue.idle();
    this.closed = true;
    await this.release();
  }
  static async unlock(file: string) {
    const lock = `${file}.lock`,
      owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8"));
    try {
      process.kill(owner.pid, 0);
      throw new Error("저장소를 사용하는 프로세스가 실행 중입니다.");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
    }
    await rm(lock, { recursive: true });
  }
}

export class JsonStore extends FileStore<State> {
  async recoverMasterReplacement() {
    return this.withMaintenanceLock(() =>
      this.organizations.withMaintenanceLock(async () => {
        const marker = JSON.parse(
          await readFile(this.replacementMarker, "utf8"),
        );
        const metadata = MaintenanceDocumentSchema.parse(
          marker.maintenanceBefore,
        );
        for (const [source, dir] of [
          [marker.backups?.state, this.backupDir],
          [marker.backups?.organizations, this.organizations.backupDir],
        ])
          demand(
            typeof source === "string" &&
              path.dirname(path.resolve(source)).toLowerCase() ===
                path.resolve(dir!).toLowerCase() &&
              /^before-(master-(reset|import)|test-(load|reset|reload|delete)|test-data-(load|reset))-/.test(
                path.basename(source),
              ),
            422,
            "중단 표식의 백업 경로를 확인해 주세요.",
          );
        const state = await readFile(marker.backups.state),
          org = await readFile(marker.backups.organizations);
        validateState(
          JSON.parse(state.toString("utf8")),
          validateOrganizations(JSON.parse(org.toString("utf8"))),
        );
        let maintenanceBytes: Buffer | undefined;
        if (marker.backups.maintenance) {
          const file = marker.backups.maintenance;
          demand(
            typeof file === "string" &&
              path.dirname(path.resolve(file)).toLowerCase() ===
                path.resolve(this.backupDir).toLowerCase() &&
              /^before-test-data-(load|reset)-maintenance-/.test(
                path.basename(file),
              ),
            422,
            "관리 정보의 백업 경로를 확인해 주세요.",
          );
          maintenanceBytes = await readFile(file);
          const saved = MaintenanceDocumentSchema.parse(
            JSON.parse(maintenanceBytes.toString("utf8")),
          );
          demand(
            contentHash(saved) === contentHash(metadata),
            422,
            "관리 정보 백업이 중단 표식과 다릅니다.",
          );
        }
        // Preserve the interrupted files before recovery; the original pair remains intact.
        const suffix = randomUUID();
        for (const [source, dir, label] of [
          [this.file, this.backupDir, "state"],
          [
            this.organizations.file,
            this.organizations.backupDir,
            "organizations",
          ],
          [this.maintenanceFile, this.backupDir, "maintenance"],
          [this.replacementMarker, this.backupDir, "marker"],
        ]) {
          try {
            await this.writeAtomic(
              path.join(dir!, `before-master-recovery-${label}-${suffix}.json`),
              await readFile(source!),
            );
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
        }
        await this.writeAtomic(this.organizations.file, org);
        await this.writeAtomic(this.file, state);
        await this.writeAtomic(
          this.maintenanceFile,
          maintenanceBytes || marker.maintenanceBefore,
        );
        await rm(this.replacementMarker);
        return {
          recovered: true,
          generation: metadata.generation,
          backups: marker.backups,
        };
      }),
    );
  }
  private maintenance: import("zod").infer<typeof MaintenanceDocumentSchema> = {
    schemaVersion: 1,
    generation: randomUUID(),
    receipts: [],
    testDataOperations: [],
  };
  get generation() {
    return this.maintenance.generation;
  }
  get hasLegacyTestSnapshot() {
    return Object.hasOwn(this.maintenance, "testEnvironment");
  }
  testDataOperation(key: string, actorId: string): TestDataReceipt | null {
    const receipt = this.maintenance.testDataOperations.find(
      (r) => r.key === key,
    );
    demand(
      !receipt || receipt.actorId === actorId,
      403,
      "이 작업을 실행한 운영자 계정으로 확인해 주세요.",
    );
    return receipt ? structuredClone(receipt) : null;
  }
  beforeMaintenanceReplace?: () => void | Promise<void>;
  get maintenanceFile() {
    return `${this.file}.maintenance.json`;
  }
  get replacementMarker() {
    return `${this.file}.replacement.json`;
  }
  get transactionMarker() {
    return `${this.file}.transaction.json`;
  }
  /** A durable undo record protects the pair until both files have been committed. */
  async transactPair<R>(
    actorId: string,
    key: string,
    fingerprint: string,
    authorize: (state: State) => void,
    update: (state: State, organizations: OrganizationDocument) => R,
    options: { action?: string; lv1OrganizationId?: string } = {},
  ): Promise<R> {
    return this.enqueue(async () => {
      demand(!this.closed, 503, "저장소가 닫혔습니다.");
      authorize(this.state);
      const previous = this.state.requests.find(
        (r) => r.actorId === actorId && r.key === key,
      );
      if (previous) {
        demand(
          previous.fingerprint === fingerprint,
          409,
          "같은 요청 식별자로 다른 내용을 보냈습니다.",
          "IDEMPOTENCY_CONFLICT",
        );
        return structuredClone(previous.response) as R;
      }
      const before = {
        schemaVersion: 1,
        state: this.snapshot(),
        organizations: this.organizations.snapshot(),
      };
      const next = structuredClone(before);
      const response = update(next.state, next.organizations);
      next.state.revision++;
      next.organizations.revision++;
      next.state.requests.push({
        actorId,
        key,
        fingerprint,
        response: JSON.parse(JSON.stringify(response)),
        date: new Date().toISOString(),
        ...options,
      });
      validateState(next.state, validateOrganizations(next.organizations));
      // Detect external changes before replacing either file.
      demand(
        contentHash(JSON.parse(await readFile(this.file, "utf8"))) ===
          contentHash(before.state) &&
          contentHash(
            JSON.parse(await readFile(this.organizations.file, "utf8")),
          ) === contentHash(before.organizations),
        409,
        "파일이 변경되었습니다. 다시 확인해 주세요.",
        "REVISION_CONFLICT",
      );
      await mkdir(this.backupDir, { recursive: true });
      await mkdir(this.organizations.backupDir, { recursive: true });
      const suffix = randomUUID();
      await this.writeAtomic(
        path.join(this.backupDir, `before-qualification-delete-${suffix}.json`),
        before.state,
      );
      await this.writeAtomic(
        path.join(
          this.organizations.backupDir,
          `before-qualification-delete-${suffix}.json`,
        ),
        before.organizations,
      );
      try {
        await this.writeAtomic(this.transactionMarker, before);
        await this.organizations.beforeReplace?.();
        await this.writeAtomic(this.organizations.file, next.organizations);
        await this.beforeReplace?.();
        await this.writeAtomic(this.file, next.state);
        await rm(this.transactionMarker);
      } catch (error) {
        try {
          await this.writeAtomic(this.organizations.file, before.organizations);
          await this.writeAtomic(this.file, before.state);
          await rm(this.transactionMarker, { force: true });
        } catch {
          this.block();
          this.organizations.block();
          throw new DomainError(
            503,
            "삭제 저장이 중단되었습니다. 서버 재시작 시 원본 쌍을 복구합니다.",
            "TRANSACTION_RECOVERY_REQUIRED",
          );
        }
        throw error;
      }
      this.state = next.state;
      this.organizations.publishSnapshot(next.organizations);
      return structuredClone(response);
    });
  }
  private async recoverTransaction() {
    try {
      await readFile(this.transactionMarker);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    await this.withMaintenanceLock(() =>
      this.organizations.withMaintenanceLock(async () => {
        const before = JSON.parse(
          await readFile(this.transactionMarker, "utf8"),
        );
        demand(
          before.schemaVersion === 1,
          422,
          "삭제 복구 표식 형식이 잘못되었습니다.",
        );
        validateState(
          before.state,
          validateOrganizations(before.organizations),
        );
        await this.writeAtomic(this.organizations.file, before.organizations);
        await this.writeAtomic(this.file, before.state);
        await rm(this.transactionMarker);
      }),
    );
  }
  consistent<R>(
    read: (state: State, organizations: OrganizationDocument) => R,
  ): Promise<R> {
    return this.enqueue(() =>
      Promise.resolve(read(this.snapshot(), this.organizations.snapshot())),
    );
  }
  async replaceTestData(
    actorId: string,
    key: string,
    fingerprint: string,
    action: TestDataAction,
    at: string,
    authorize: (s: State) => void,
    prepare: (
      s: State,
      o: OrganizationDocument,
    ) => {
      state: State;
      organizations: OrganizationDocument;
      before: Record<string, number>;
      after: Record<string, number>;
    },
  ): Promise<TestDataReceipt> {
    return this.enqueue(async () => {
      demand(!this.closed, 503, "저장소가 닫혔습니다.");
      authorize(this.snapshot());
      const previous = this.maintenance.testDataOperations.find(
        (r) => r.key === key,
      );
      if (previous) {
        demand(
          previous.actorId === actorId &&
            previous.fingerprint === fingerprint &&
            previous.action === action,
          409,
          "같은 실행 식별자로 다른 내용을 보냈습니다.",
          "IDEMPOTENCY_CONFLICT",
        );
        return structuredClone(previous);
      }
      const current = this.snapshot(),
        org = this.organizations.snapshot(),
        candidate = prepare(current, org);
      const structure = (nodes: OrganizationDocument["roots"]): unknown =>
        nodes.map((n) => ({
          id: n.id,
          name: n.name,
          active: n.active,
          children: structure(n.children),
        }));
      demand(
        candidate.state.revision === current.revision + 1 &&
          candidate.organizations.revision === org.revision + 1,
        422,
        "저장소 revision 증가가 필요합니다.",
      );
      demand(
        contentHash(current.users) === contentHash(candidate.state.users) &&
          contentHash(structure(org.roots)) ===
            contentHash(structure(candidate.organizations.roots)),
        422,
        "계정 정보와 조직 구조는 변경할 수 없습니다.",
      );
      const checked = validateState(
        candidate.state,
        validateOrganizations(candidate.organizations),
      );
      const [stateBytes, orgBytes, maintenanceBytes] = await Promise.all([
        readFile(this.file),
        readFile(this.organizations.file),
        readFile(this.maintenanceFile),
      ]);
      demand(
        contentHash(this.validate(JSON.parse(stateBytes.toString("utf8")))) ===
          contentHash(current) &&
          contentHash(
            validateOrganizations(JSON.parse(orgBytes.toString("utf8"))),
          ) === contentHash(org) &&
          contentHash(
            MaintenanceDocumentSchema.parse(
              JSON.parse(maintenanceBytes.toString("utf8")),
            ),
          ) === contentHash(this.maintenance),
        409,
        "저장소 파일이 변경되었습니다. 다시 확인해 주세요.",
        "REVISION_CONFLICT",
      );
      const operationId = randomUUID(),
        generation = randomUUID(),
        suffix = `${current.revision}-${operationId}`;
      const backups = {
        state: path.join(
          this.backupDir,
          `before-test-data-${action}-${suffix}.json`,
        ),
        organizations: path.join(
          this.organizations.backupDir,
          `before-test-data-${action}-${suffix}.json`,
        ),
        maintenance: path.join(
          this.backupDir,
          `before-test-data-${action}-maintenance-${suffix}.json`,
        ),
      };
      await mkdir(this.backupDir, { recursive: true });
      await mkdir(this.organizations.backupDir, { recursive: true });
      await this.writeAtomic(backups.state, stateBytes);
      await this.writeAtomic(backups.organizations, orgBytes);
      await this.writeAtomic(backups.maintenance, maintenanceBytes);
      const receipt: TestDataReceipt = {
        operationId,
        key,
        actorId,
        fingerprint,
        action,
        completedAt: at,
        generation,
        recipeVersion: TEST_DATA_RECIPE_VERSION,
        stateRevision: checked.revision,
        organizationRevision: candidate.organizations.revision,
        before: candidate.before,
        after: candidate.after,
        backups,
      };
      const before = structuredClone(this.maintenance),
        next = {
          ...before,
          generation,
          testDataOperations: [...before.testDataOperations, receipt],
        };
      if (action === "reset") delete next.testEnvironment;
      MaintenanceDocumentSchema.parse(next);
      try {
        await this.writeAtomic(this.replacementMarker, {
          backups,
          maintenanceBefore: before,
          receipt,
        });
        await this.organizations.beforeReplace?.();
        await this.writeAtomic(
          this.organizations.file,
          candidate.organizations,
        );
        await this.beforeReplace?.();
        await this.writeAtomic(this.file, checked);
        await this.beforeMaintenanceReplace?.();
        await this.writeAtomic(this.maintenanceFile, next);
        await rm(this.replacementMarker);
      } catch (error) {
        try {
          await this.writeAtomic(this.organizations.file, orgBytes);
          await this.writeAtomic(this.file, stateBytes);
          await this.writeAtomic(this.maintenanceFile, maintenanceBytes);
          await rm(this.replacementMarker, { force: true });
        } catch {
          this.block();
          this.organizations.block();
          throw new DomainError(
            503,
            "데이터 교체와 복구를 완료하지 못했습니다. 서버를 중지하고 data:recover-master로 복구해 주세요.",
            "MAINTENANCE_RECOVERY_REQUIRED",
          );
        }
        throw error;
      }
      this.organizations.publishSnapshot(candidate.organizations);
      this.state = checked;
      this.maintenance = next;
      this.queue.invalidate();
      return structuredClone(receipt);
    });
  }
  async migratePolicies(
    expected: { revision: number; stateHash: string; organizationHash: string },
    transform: (
      state: unknown,
      org: unknown,
    ) => { state: State; organizations: OrganizationDocument; report: unknown },
    purpose = "policies",
  ) {
    return this.withMaintenanceLock(() =>
      this.organizations.withMaintenanceLock(async () => {
        const marker = `${this.file}.policy-migration.json`;
        try {
          await readFile(marker);
          throw new Error(
            "이전 이관이 완료되지 않았습니다. 표시 파일의 백업 쌍으로 복구해 주세요.",
          );
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        const stateBytes = await readFile(this.file),
          orgBytes = await readFile(this.organizations.file);
        const raw = JSON.parse(stateBytes.toString("utf8")),
          org = JSON.parse(orgBytes.toString("utf8"));
        const hash = (b: Buffer) =>
          createHash("sha256").update(b).digest("hex");
        demand(
          raw.revision === expected.revision &&
            hash(stateBytes) === expected.stateHash &&
            hash(orgBytes) === expected.organizationHash,
          409,
          "미리보기 이후 데이터가 바뀌었습니다. 다시 확인해 주세요.",
        );
        const candidate = transform(raw, org);
        validateState(
          candidate.state,
          validateOrganizations(candidate.organizations),
        );
        if (
          JSON.stringify(raw) === JSON.stringify(candidate.state) &&
          JSON.stringify(org) === JSON.stringify(candidate.organizations)
        )
          return candidate.report;
        const generationChange =
          raw.schemaVersion !== candidate.state.schemaVersion;
        const maintenanceBytes = generationChange
          ? await readFile(this.maintenanceFile).catch((e) => {
              if (e.code === "ENOENT") return undefined;
              throw e;
            })
          : undefined;
        const maintenance = generationChange
          ? maintenanceBytes
            ? MaintenanceDocumentSchema.parse(
                JSON.parse(maintenanceBytes.toString("utf8")),
              )
            : {
                schemaVersion: 1 as const,
                generation: randomUUID(),
                receipts: [],
              }
          : undefined;
        const suffix = randomUUID(),
          stateBackup = path.join(
            this.backupDir,
            `before-${purpose}-${raw.revision}-${suffix}.json`,
          ),
          organizationBackup = path.join(
            this.organizations.backupDir,
            `before-${purpose}-${org.revision}-${suffix}.json`,
          );
        await mkdir(this.backupDir, { recursive: true });
        await mkdir(this.organizations.backupDir, { recursive: true });
        await this.writeAtomic(stateBackup, stateBytes);
        await this.writeAtomic(organizationBackup, orgBytes);
        const maintenanceBackup = maintenanceBytes
          ? path.join(
              this.backupDir,
              `before-${purpose}-maintenance-${suffix}.json`,
            )
          : undefined;
        if (maintenanceBackup)
          await this.writeAtomic(maintenanceBackup, maintenanceBytes!);
        await this.writeAtomic(marker, {
          maintenanceBackup,
          stateBackup,
          organizationBackup,
          expected,
        });
        try {
          demand(
            hash(await readFile(this.file)) === expected.stateHash &&
              hash(await readFile(this.organizations.file)) ===
                expected.organizationHash,
            409,
            "잠금 후 파일이 변경되었습니다.",
          );
          if (JSON.stringify(org) !== JSON.stringify(candidate.organizations))
            await this.writeAtomic(
              this.organizations.file,
              candidate.organizations,
            );
          await this.beforeReplace?.();
          await this.writeAtomic(this.file, candidate.state);
          if (maintenance)
            await this.writeAtomic(this.maintenanceFile, {
              ...maintenance,
              generation: randomUUID(),
            });
        } catch (error) {
          // Preserve the marker if either rollback fails; normal startup refuses mixed pairs.
          await this.writeAtomic(this.organizations.file, orgBytes);
          await this.writeAtomic(this.file, stateBytes);
          if (maintenanceBytes)
            await this.writeAtomic(this.maintenanceFile, maintenanceBytes);
          else if (maintenance) await rm(this.maintenanceFile, { force: true });
          await rm(marker);
          throw error;
        }
        await rm(marker);
        return {
          ...(candidate.report as object),
          stateBackup,
          organizationBackup,
          maintenanceBackup,
        };
      }),
    );
  }
  // Explicit, user-approved reset exception. Normal writes/restore retain backups.
  async transitionWithoutBackup(
    expectedRevision: number,
    expectedHash: string,
    transform: (
      raw: unknown,
      organizations: OrganizationDocument,
    ) => { state: State; report: unknown },
  ) {
    throw new DomainError(
      410,
      "무백업 전환의 일회성 예외가 종료되었습니다. 업무 6·조직 1은 data:migrate-policies로 백업 후 이관하세요.",
      "FEATURE_REMOVED",
    );
  }
  async refreshNotifications(at = new Date().toISOString()) {
    return this.enqueue(async () => {
      demand(!this.closed, 503, "저장소가 닫혔습니다.");
      const next = structuredClone(this.state);
      const awarded = reconcilePendingAuditor(
        next,
        this.organizations.snapshot(),
        at,
      );
      if (!reconcileNotifications(next, at) && !awarded) return;
      next.revision++;
      const checked = this.validate(next);
      await mkdir(this.backupDir, { recursive: true });
      await this.writeAtomic(
        path.join(this.backupDir, `state-${this.state.revision}.json`),
        this.state,
      );
      await this.beforeReplace?.();
      try {
        await this.writeAtomic(this.file, checked);
      } catch (error) {
        try {
          this.state = this.validate(
            JSON.parse(await readFile(this.file, "utf8")),
          );
        } catch {
          this.closed = true;
        }
        throw error;
      }
      this.state = checked;
      await this.pruneBackups();
    });
  }
  readonly organizations: FileStore<OrganizationDocument>;
  constructor(
    file: string,
    organizationsFile = process.env.EKS_ORGANIZATIONS_FILE ||
      path.resolve(path.dirname(file), "../master/organizations.json"),
  ) {
    const queue = new SerialQueue();
    let organizations: FileStore<OrganizationDocument>;
    super(
      file,
      (input) => validateState(input, organizations.snapshot()),
      queue,
    );
    this.organizations = organizations = new FileStore(
      organizationsFile,
      validateOrganizations,
      queue,
    );
  }
  override async load() {
    await this.recoverTransaction();
    try {
      await readFile(this.replacementMarker);
      throw new Error(
        "설정·기준 교체가 중단되었습니다. 서버를 중지한 채 교체 표시 파일의 백업 쌍과 관리 정보를 복구해 주세요.",
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    try {
      await readFile(`${this.file}.policy-migration.json`);
      throw new Error(
        "조직 정책 이관이 중단되었습니다. 이관 표시 파일의 백업 쌍으로 복구해 주세요.",
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await this.organizations.load();
    let loaded = false;
    try {
      let rawReleaseState;
      try {
        rawReleaseState = JSON.parse(await readFile(this.file, "utf8"));
      } catch (e) {
        throw new Error("저장소를 열 수 없습니다. 원본을 확인해 주세요.", {
          cause: e,
        });
      }
      migrateState(rawReleaseState, this.organizations.snapshot());
      await super.load();
      loaded = true;
      try {
        this.maintenance = MaintenanceDocumentSchema.parse(
          JSON.parse(await readFile(this.maintenanceFile, "utf8")),
        ) as typeof this.maintenance;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT")
          await this.writeAtomic(this.maintenanceFile, this.maintenance);
        else throw e;
      }
      return this;
    } catch (error) {
      if (loaded) await super.close();
      await this.organizations.close();
      throw error;
    }
  }
  override async initialize(state: State) {
    try {
      await readFile(this.file);
      throw new Error("기존 저장소는 초기화하지 않습니다.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await readFile(this.organizations.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.organizations.initialize(seedOrganizations());
    }
    await this.organizations.load();
    try {
      await super.initialize(state);
    } finally {
      await this.organizations.close();
    }
  }
  override async restore(source: string) {
    await this.organizations.load();
    try {
      await super.restore(source);
    } finally {
      await this.organizations.close();
    }
  }
  override async close() {
    await super.close();
    await this.organizations.close();
  }
  async restoreOrganizations(source: string) {
    // Maintenance command: validate the candidate against the locked runtime,
    // without loading a possibly missing/corrupt organization file first.
    await this.lock();
    try {
      const state = JSON.parse(await readFile(this.file, "utf8"));
      await this.organizations.restore(source, (doc) => {
        validateState(state, doc);
      });
    } finally {
      await this.release();
    }
  }
  async migrate(
    transform: (input: unknown, doc: OrganizationDocument) => State,
  ) {
    // Explicit maintenance only: the normal load path never seeds or migrates.
    await this.lock();
    let orgLoaded = false;
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8"));
      await this.organizations.load();
      orgLoaded = true;
      demand(
        raw.schemaVersion === 28,
        422,
        "업무 스키마 6·조직 스키마 1은 data:migrate-policies의 명시적 보존 이관을 사용하세요.",
      );
      transform(raw, this.organizations.snapshot());
    } finally {
      if (orgLoaded) await this.organizations.close();
      await this.release();
    }
  }
}
