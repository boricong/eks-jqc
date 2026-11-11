import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  copyFile,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { GroupFile, State } from "@eks/contracts";
import { demand } from "./errors.ts";

export class GroupFileStore {
  readonly root: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  constructor(
    stateFile: string,
    options: { maxBytes?: number; maxFiles?: number } = {},
  ) {
    this.root = `${stateFile}.group-files`;
    this.maxBytes =
      options.maxBytes ??
      Number(process.env.EKS_GROUP_FILE_MAX_BYTES || 20 * 1024 * 1024);
    this.maxFiles =
      options.maxFiles ?? Number(process.env.EKS_GROUP_FILES_PER_RUN || 20);
    if (
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1 ||
      this.maxBytes > 100 * 1024 * 1024 ||
      !Number.isSafeInteger(this.maxFiles) ||
      this.maxFiles < 1 ||
      this.maxFiles > 100
    )
      throw Error("그룹 파일 제한 설정을 확인해 주세요.");
  }
  blob(hash: string) {
    demand(
      /^[a-f0-9]{64}$/.test(hash),
      422,
      "파일 식별자가 올바르지 않습니다.",
    );
    return path.join(this.root, hash);
  }
  async save(
    stream: AsyncIterable<Buffer | string>,
    name: string,
    kind: "raw" | "report",
  ) {
    demand(
      name.length > 0 &&
        name.length <= 240 &&
        !/[\\/\x00-\x1f\x7f]/.test(name) &&
        name !== "." &&
        name !== "..",
      422,
      "파일명을 확인해 주세요.",
    );
    const ext = path.extname(name).toLowerCase();
    demand(
      kind === "raw" ? [".csv", ".xlsx"].includes(ext) : ext === ".pdf",
      422,
      "원자료는 CSV/XLSX, 분석 보고서는 PDF를 등록해 주세요.",
    );
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.root, `.upload-${randomUUID()}`),
      hash = createHash("sha256");
    const handle = await open(temporary, "wx", 0o600);
    let bytes = 0,
      prefix = Buffer.alloc(0);
    try {
      for await (const value of stream) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        bytes += chunk.length;
        demand(
          bytes <= this.maxBytes,
          413,
          "파일 크기 제한을 초과했습니다.",
          "GROUP_FILE_TOO_LARGE",
        );
        if (prefix.length < 1024)
          prefix = Buffer.concat([
            prefix,
            chunk.subarray(0, 1024 - prefix.length),
          ]);
        hash.update(chunk);
        await handle.writeFile(chunk);
      }
      demand(bytes > 0, 422, "빈 파일은 등록할 수 없습니다.");
      if (ext === ".pdf")
        demand(
          prefix.subarray(0, 5).toString() === "%PDF-",
          422,
          "PDF 파일 내용을 확인해 주세요.",
        );
      if (ext === ".xlsx")
        demand(
          prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
          422,
          "XLSX 파일 내용을 확인해 주세요.",
        );
      if (ext === ".csv")
        demand(!prefix.includes(0), 422, "CSV 텍스트 파일을 등록해 주세요.");
      await handle.sync();
      await handle.close();
      const sha256 = hash.digest("hex");
      await rename(temporary, this.blob(sha256));
      if (process.platform !== "win32") {
        const dir = await open(this.root, "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
      const mediaType: GroupFile["mediaType"] =
        ext === ".csv"
          ? "text/csv"
          : ext === ".xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf";
      return { name, sha256, bytes, mediaType };
    } finally {
      await handle.close().catch(() => {});
      await rm(temporary, { force: true });
    }
  }
  async verify(
    file: Pick<GroupFile, "sha256" | "bytes">,
    source = this.blob(file.sha256),
  ) {
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of createReadStream(source)) {
        bytes += chunk.length;
        hash.update(chunk);
      }
    } catch {
      demand(
        false,
        409,
        "근거 파일을 찾을 수 없습니다. 파일 포함 백업을 확인해 주세요.",
        "GROUP_FILE_MISSING",
      );
    }
    demand(
      bytes === file.bytes && hash.digest("hex") === file.sha256,
      409,
      "근거 파일의 크기 또는 해시가 일치하지 않습니다.",
      "GROUP_FILE_CHANGED",
    );
  }
  async verifyAll(files: GroupFile[]) {
    const seen = new Map<string, number>();
    for (const file of files) {
      if (seen.has(file.sha256))
        demand(
          seen.get(file.sha256) === file.bytes,
          409,
          "같은 파일 해시의 크기가 서로 다릅니다.",
          "GROUP_FILE_CHANGED",
        );
      else {
        await this.verify(file);
        seen.set(file.sha256, file.bytes);
      }
    }
  }
  private async sync(file: string, directory = false) {
    if (directory && process.platform === "win32") return;
    const handle = await open(file, directory ? "r" : "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async backup(source: string, state: State) {
    if (!state.groupAssessmentFiles.length) return;
    await this.verifyAll(state.groupAssessmentFiles);
    const target = `${source}.files`;
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const f of new Map(
      state.groupAssessmentFiles.map((f) => [f.sha256, f]),
    ).values()) {
      const output = path.join(target, f.sha256);
      await copyFile(this.blob(f.sha256), output);
      await this.sync(output);
    }
    await writeFile(
      path.join(target, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          files: state.groupAssessmentFiles.map(({ id, sha256, bytes }) => ({
            id,
            sha256,
            bytes,
          })),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await this.sync(path.join(target, "manifest.json"));
    await this.sync(target, true);
  }
  async restore(source: string, state: State) {
    if (!state.groupAssessmentFiles.length) return;
    const target = `${source}.files`;
    let manifest: {
      version: number;
      files: { id: string; sha256: string; bytes: number }[];
    };
    try {
      manifest = JSON.parse(
        await readFile(path.join(target, "manifest.json"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Automatic JSON snapshots share immutable, never-pruned blobs in this dataset.
      await this.verifyAll(state.groupAssessmentFiles);
      return;
    }
    demand(
      manifest.version === 1 &&
        Array.isArray(manifest.files) &&
        manifest.files.length === state.groupAssessmentFiles.length &&
        state.groupAssessmentFiles.every((f) =>
          manifest.files.some(
            (x) =>
              x.id === f.id && x.sha256 === f.sha256 && x.bytes === f.bytes,
          ),
        ),
      422,
      "업무 백업과 파일 목록이 일치하지 않습니다.",
    );
    for (const f of state.groupAssessmentFiles)
      await this.verify(f, path.join(target, f.sha256));
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const f of new Map(
      state.groupAssessmentFiles.map((f) => [f.sha256, f]),
    ).values()) {
      const temporary = path.join(this.root, `.restore-${randomUUID()}`);
      try {
        await copyFile(path.join(target, f.sha256), temporary);
        const h = await open(temporary, "r+");
        try {
          await h.sync();
        } finally {
          await h.close();
        }
        await rename(temporary, this.blob(f.sha256));
      } finally {
        await rm(temporary, { force: true });
      }
    }
    await this.sync(this.root, true);
  }
}
