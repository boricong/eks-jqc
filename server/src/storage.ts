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
import type { State } from "@eks/contracts";
import { validateState } from "./integrity.ts";

export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}
export function demand(
  value: unknown,
  status: number,
  message: string,
  code?: string,
): asserts value {
  if (!value) throw new DomainError(status, message, code);
}
export class JsonStore {
  private state!: State;
  private queue: Promise<unknown> = Promise.resolve();
  private token = randomUUID();
  private closed = false;
  readonly lockPath: string;
  readonly backupDir: string;
  beforeReplace?: () => void | Promise<void>;
  constructor(readonly file: string) {
    this.lockPath = `${file}.lock`;
    this.backupDir = path.resolve(
      path.dirname(file),
      "../backups",
      path.basename(file, ".json"),
    );
  }
  private async lock() {
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
      this.state = validateState(JSON.parse(await readFile(this.file, "utf8")));
    } catch (e) {
      await this.release();
      throw new Error(
        `저장소를 열 수 없습니다. data:init 또는 data:restore를 확인하세요. ${String(e)}`,
      );
    }
    return this;
  }
  async initialize(state: State) {
    await this.lock();
    try {
      try {
        await readFile(this.file);
        throw new Error("기존 저장소는 초기화하지 않습니다.");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      this.state = validateState(state);
      await this.writeAtomic(this.file, this.state);
    } finally {
      await this.release();
    }
  }
  snapshot(): State {
    if (this.closed) throw new DomainError(503, "저장소가 닫혔습니다.");
    return structuredClone(this.state);
  }
  private async writeAtomic(file: string, state: State) {
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
      const dir = await open(path.dirname(file), "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      await rm(temp, { force: true });
    }
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }
  async transact<T>(
    actorId: string,
    key: string,
    fingerprint: string,
    authorize: (s: State) => void,
    update: (s: State) => T,
  ): Promise<T> {
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
        return structuredClone(previous.response) as T;
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
      });
      const checked = validateState(next);
      await mkdir(this.backupDir, { recursive: true });
      await this.writeAtomic(
        path.join(this.backupDir, `state-${this.state.revision}.json`),
        this.state,
      );
      await this.beforeReplace?.();
      try {
        await this.writeAtomic(this.file, checked);
      } catch (e) {
        // A directory sync can fail after rename. Reconcile memory with the actual file
        // so retrying the same request cannot apply a committed mutation twice.
        try {
          this.state = validateState(
            JSON.parse(await readFile(this.file, "utf8")),
          );
        } catch {
          this.closed = true;
        }
        throw e;
      }
      this.state = checked;
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
      return structuredClone(response);
    });
  }
  async backup() {
    return this.enqueue(async () => {
      await mkdir(this.backupDir, { recursive: true });
      const file = path.join(this.backupDir, `manual-${Date.now()}.json`);
      await this.writeAtomic(file, this.state);
      return file;
    });
  }
  async restore(source: string) {
    await this.lock();
    try {
      const restored = validateState(
        JSON.parse(await readFile(source, "utf8")),
      );
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
  private async release() {
    const owner = JSON.parse(
      await readFile(path.join(this.lockPath, "owner.json"), "utf8"),
    );
    if (owner.token === this.token)
      await rm(this.lockPath, { recursive: true, force: true });
  }
  async close() {
    await this.queue;
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
