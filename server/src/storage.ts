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
import { randomUUID } from "node:crypto";
import type { State, OrganizationDocument } from "@eks/contracts";
import { seedOrganizations, validateOrganizations } from "./organizations.ts";
import { demand, DomainError } from "./errors.ts";
export { demand, DomainError } from "./errors.ts";
import { validateState } from "./integrity.ts";
import { reconcileNotifications } from "./notifications.ts";

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => {});
    return next;
  }
  async idle() {
    await this.tail;
  }
}
type Document = { revision: number; requests: State["requests"] };
export class FileStore<T extends Document> {
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
        `저장소를 열 수 없습니다: ${this.file}. 자동 초기화하지 않습니다. 기존 v1/v2/v3 데이터는 data:migrate, 손상 파일은 백업 복구 절차를 확인하세요. ${String(e)}`,
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
  protected async writeAtomic(file: string, state: unknown) {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(state, null, 2) + "\n");
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
      backupPurpose?: "course-delete" | "photo-setup" | "catalog-import" | "catalog-publish";
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
    await this.organizations.load();
    try {
      await super.load();
      return this;
    } catch (error) {
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
      if ([1, 2, 3, 4].includes(raw.schemaVersion)) {
        await mkdir(this.backupDir, { recursive: true });
        await this.writeAtomic(
          path.join(
            this.backupDir,
            `before-migration-${Date.now()}-${randomUUID()}.json`,
          ),
          raw,
        );
      }
      try {
        await readFile(this.organizations.file);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" ||
          raw.schemaVersion !== 1
        )
          throw error;
        await this.organizations.initialize(seedOrganizations());
      }
      await this.organizations.load();
      orgLoaded = true;
      const next = transform(raw, this.organizations.snapshot());
      if (raw.schemaVersion === 5) return;
      await this.writeAtomic(this.file, this.validate(next));
    } finally {
      if (orgLoaded) await this.organizations.close();
      await this.release();
    }
  }
}
