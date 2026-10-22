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
import type {
  State,
  OrganizationDocument,
  MaintenanceReceipt,
} from "@eks/contracts";
import {
  MaintenanceDocumentSchema,
  contentHash,
  clearedCounts,
  masterCounts,
  masterPayload,
} from "./master-data.ts";
import { seedOrganizations, validateOrganizations } from "./organizations.ts";
import { demand, DomainError } from "./errors.ts";
export { demand, DomainError } from "./errors.ts";
import { validateState } from "./integrity.ts";
import { reconcileNotifications } from "./notifications.ts";

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
        `저장소를 열 수 없습니다: ${this.file}. 자동 초기화하지 않습니다. 업무8은 data:migrate-lifecycle, 업무7은 data:migrate-administration, 업무6·조직1은 data:migrate-policies의 보존 이관을 확인하세요. 손상 파일은 백업 쌍 복구가 필요합니다. ${String(e)}`,
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
        | "course-delete"
        | "photo-setup"
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
              /^before-master-(reset|import)-/.test(path.basename(source)),
            422,
            "중단 표식의 백업 경로를 확인해 주세요.",
          );
        const state = await readFile(marker.backups.state),
          org = await readFile(marker.backups.organizations);
        validateState(
          JSON.parse(state.toString("utf8")),
          validateOrganizations(JSON.parse(org.toString("utf8"))),
        );
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
        await this.writeAtomic(this.maintenanceFile, metadata);
        await rm(this.replacementMarker);
        return {
          recovered: true,
          generation: metadata.generation,
          backups: marker.backups,
        };
      }),
    );
  }
  private maintenance = {
    schemaVersion: 1 as const,
    generation: randomUUID() as string,
    receipts: [] as MaintenanceReceipt[],
  };
  get generation() {
    return this.maintenance.generation;
  }
  maintenanceReceipt(key: string) {
    return structuredClone(
      this.maintenance.receipts.find((r) => r.key === key) || null,
    );
  }
  get maintenanceFile() {
    return `${this.file}.maintenance.json`;
  }
  get replacementMarker() {
    return `${this.file}.replacement.json`;
  }
  consistent<R>(
    read: (state: State, organizations: OrganizationDocument) => R,
  ): Promise<R> {
    return this.enqueue(() =>
      Promise.resolve(read(this.snapshot(), this.organizations.snapshot())),
    );
  }
  async replaceMaster(
    actorId: string,
    key: string,
    fingerprint: string,
    kind: MaintenanceReceipt["kind"],
    at: string,
    authorize: (state: State) => void,
    prepare: (
      state: State,
      organizations: OrganizationDocument,
    ) => { state: State; organizations: OrganizationDocument },
  ): Promise<MaintenanceReceipt> {
    return this.enqueue(async () => {
      authorize(this.snapshot());
      const previous = this.maintenance.receipts.find((r) => r.key === key);
      if (previous) {
        demand(
          previous.fingerprint === fingerprint && previous.kind === kind,
          409,
          "같은 실행 식별자로 다른 내용을 보냈습니다.",
          "IDEMPOTENCY_CONFLICT",
        );
        return structuredClone(previous);
      }
      const org = this.organizations.snapshot(),
        current = this.snapshot();
      const candidate = prepare(current, org);
      demand(
        candidate.state.revision === current.revision + 1 &&
          candidate.organizations.revision === org.revision + 1,
        422,
        "저장소 revision 증가가 필요합니다.",
      );
      validateState(
        candidate.state,
        validateOrganizations(candidate.organizations),
      );
      const stateBytes = await readFile(this.file),
        orgBytes = await readFile(this.organizations.file);
      demand(
        contentHash(this.validate(JSON.parse(stateBytes.toString("utf8")))) ===
          contentHash(current) &&
          contentHash(
            validateOrganizations(JSON.parse(orgBytes.toString("utf8"))),
          ) === contentHash(org),
        409,
        "저장소 파일이 변경되었습니다. 다시 확인해 주세요.",
        "REVISION_CONFLICT",
      );
      const suffix = randomUUID(),
        generation = randomUUID();
      const backups = {
        state: path.join(
          this.backupDir,
          `before-${kind}-${current.revision}-${suffix}.json`,
        ),
        organizations: path.join(
          this.organizations.backupDir,
          `before-${kind}-${org.revision}-${suffix}.json`,
        ),
      };
      await mkdir(this.backupDir, { recursive: true });
      await mkdir(this.organizations.backupDir, { recursive: true });
      await this.writeAtomic(backups.state, stateBytes);
      await this.writeAtomic(backups.organizations, orgBytes);
      const before = structuredClone(this.maintenance);
      const receipt: MaintenanceReceipt = {
        operationId: suffix,
        key,
        fingerprint,
        actorId,
        kind,
        completedAt: at,
        generation,
        previousGeneration: this.generation,
        stateRevision: candidate.state.revision,
        organizationRevision: candidate.organizations.revision,
        preserved: masterCounts(
          masterPayload(candidate.state, candidate.organizations),
        ),
        deleted: clearedCounts(current, org),
        backups,
      };
      const next = {
        schemaVersion: 1 as const,
        generation,
        receipts: [...before.receipts, receipt],
      };
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
        await this.writeAtomic(this.file, candidate.state);
        await this.writeAtomic(this.maintenanceFile, next);
        await rm(this.replacementMarker);
      } catch (error) {
        try {
          await this.writeAtomic(this.organizations.file, orgBytes);
          await this.writeAtomic(this.file, stateBytes);
          await this.writeAtomic(this.maintenanceFile, before);
          await rm(this.replacementMarker);
        } catch {
          this.block();
          this.organizations.block();
          throw new DomainError(
            503,
            "파일 교체와 복구를 완료하지 못했습니다. 서버를 중지하고 표시 파일의 백업 쌍으로 복구해 주세요.",
            "MAINTENANCE_RECOVERY_REQUIRED",
          );
        }
        throw error;
      }
      // No awaits: readers see either the old pair or the complete new pair.
      this.organizations.publishSnapshot(candidate.organizations);
      this.state = candidate.state;
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
        await this.writeAtomic(marker, {
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
        } catch (error) {
          // Preserve the marker if either rollback fails; normal startup refuses mixed pairs.
          await this.writeAtomic(this.organizations.file, orgBytes);
          await this.writeAtomic(this.file, stateBytes);
          await rm(marker);
          throw error;
        }
        await rm(marker);
        return {
          ...(candidate.report as object),
          stateBackup,
          organizationBackup,
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
      if (!reconcileNotifications(next, at)) return;
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
        raw.schemaVersion === 10,
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
