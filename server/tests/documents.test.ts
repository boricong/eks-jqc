import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import { DocumentLibrary, defaultDocumentsRoot } from "../src/documents.ts";

const entry = (id = "one", sourcePath = "one.md") => ({
  id,
  sourcePath,
  title: `문서 ${id}`,
  description: "역량 증빙",
  updatedOn: "2026-10-25",
});
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-documents-")),
    root = path.join(dir, "docs");
  await mkdir(root);
  await writeFile(
    path.join(root, "document-catalog.json"),
    JSON.stringify([entry()]),
  );
  await writeFile(
    path.join(root, "one.md"),
    "# 문서 one\n\n| 기준 | 증거 |\n| --- | --- |\n| OJT | 실제 관찰 |\n",
  );
  const file = path.join(dir, "runtime", "state.json");
  await new JsonStore(file).initialize(seedState(true));
  const store = await new JsonStore(file).load(),
    app = await buildApp(store, { documentsRoot: root });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function call(url: string, who?: string) {
    let cookie = "";
    if (who) {
      const login = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: who },
      });
      cookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`;
    }
    return app.inject({
      method: "GET",
      url: `/api/system/documents${url}`,
      headers: { cookie },
    });
  }
  return {
    dir,
    root,
    store,
    app,
    call,
    file,
    library: new DocumentLibrary(root),
  };
}

test("운영자만 등록 목록·원문을 읽으며 조회는 업무·조직·원본을 변경하지 않는다", async (t) => {
  const f = await fixture(t),
    state = f.store.snapshot(),
    org = f.store.organizations.snapshot(),
    bytes = await readFile(f.file);
  for (const suffix of ["", "/one"]) {
    assert.equal((await f.call(suffix)).statusCode, 401);
    for (const actor of ["learner-1", "admin-1", "learner-2"])
      assert.equal((await f.call(suffix, actor)).statusCode, 403);
  }
  const list = await f.call("", "operator-1");
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json(), { items: [entry()] });
  const detail = await f.call("/one", "operator-1");
  assert.equal(detail.statusCode, 200);
  assert.match(detail.json().markdown, /OJT/);
  assert.equal(detail.headers["cache-control"], "no-store");
  assert.deepEqual(f.store.snapshot(), state);
  assert.deepEqual(f.store.organizations.snapshot(), org);
  assert.deepEqual(await readFile(f.file), bytes);
});

test("실제 IATF 보고서 원본만 등록되며 본문과 메타데이터가 일치한다", async () => {
  const library = new DocumentLibrary(),
    items = await library.list();
  const item = items.find((item) => item.id === "iatf16949-competence-review")!,
    doc = await library.read(item.id);
  assert.equal(
    doc.markdown,
    await readFile(path.join(defaultDocumentsRoot, item.sourcePath), "utf8"),
  );
  assert(doc.markdown.startsWith(`# ${item.title}`));
});

test("추가 문서·중첩 경로·최신순과 빈 목록을 지원하고 임의 ID/경로는 노출하지 않는다", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, "guides"));
  await writeFile(
    path.join(f.root, "guides", "two.md"),
    "# 두 번째\n[첫 문서](../one.md)",
  );
  const two = { ...entry("two", "guides/two.md"), updatedOn: "2026-10-26" };
  await writeFile(
    path.join(f.root, "document-catalog.json"),
    JSON.stringify([entry(), two]),
  );
  assert.deepEqual(
    (await f.library.list()).map((item) => item.id),
    ["two", "one"],
  );
  assert.match((await f.library.read("two")).markdown, /첫 문서/);
  for (const id of [
    "missing",
    "one.md",
    "%2e%2e%2fstate.json",
    "..%5Cstate.json",
  ])
    assert.equal((await f.call(`/${id}`, "operator-1")).statusCode, 404);
  await writeFile(path.join(f.root, "document-catalog.json"), "[]");
  assert.deepEqual(await f.library.list(), []);
});

test("등록 목록의 중복·경로 탈출·비Markdown·잘못된 날짜는 안전한 오류로 차단한다", async (t) => {
  const f = await fixture(t);
  for (const items of [
    [entry(), entry()],
    [entry("two", "../state.json")],
    [entry("two", "/etc/passwd")],
    [entry("two", "folder\\two.md")],
    [entry("two", "file.txt")],
    [{ ...entry(), updatedOn: "wrong" }],
  ]) {
    await writeFile(
      path.join(f.root, "document-catalog.json"),
      JSON.stringify(items),
    );
    const r = await f.call("", "operator-1");
    assert.equal(r.statusCode, 503);
    assert.equal(r.json().code, "DOCUMENT_CATALOG_UNAVAILABLE");
    assert(!r.body.includes(f.dir));
  }
});

test("문서 누락·디렉터리·외부 심볼릭 링크·인코딩/크기 오류와 목록 누락을 처리한다", async (t) => {
  const f = await fixture(t),
    file = path.join(f.root, "one.md");
  await rm(file);
  assert.equal(
    (await f.call("/one", "operator-1")).json().code,
    "DOCUMENT_UNAVAILABLE",
  );
  await mkdir(file);
  assert.equal((await f.call("/one", "operator-1")).statusCode, 503);
  await rm(file, { recursive: true });
  // Windows directory junctions exercise the same realpath boundary without
  // requiring the machine-wide file-symlink privilege.
  if (process.platform === "win32") {
    await writeFile(
      path.join(path.dirname(f.file), "outside.md"),
      "users: private runtime",
    );
    await symlink(
      path.dirname(f.file),
      path.join(f.root, "external"),
      "junction",
    );
    await writeFile(
      path.join(f.root, "document-catalog.json"),
      JSON.stringify([entry("one", "external/outside.md")]),
    );
  } else await symlink(f.file, file);
  const outside = await f.call("/one", "operator-1");
  assert.equal(outside.statusCode, 503);
  assert(!outside.body.includes("users"));
  if (process.platform === "win32")
    await writeFile(
      path.join(f.root, "document-catalog.json"),
      JSON.stringify([entry()]),
    );
  else await rm(file);
  await writeFile(file, Buffer.from([0xff, 0xfe]));
  assert.equal((await f.call("/one", "operator-1")).statusCode, 503);
  await writeFile(file, "x".repeat(2 * 1024 * 1024 + 1));
  assert.equal((await f.call("/one", "operator-1")).statusCode, 503);
  await rm(path.join(f.root, "document-catalog.json"));
  await symlink(
    process.platform === "win32" ? path.dirname(f.file) : f.file,
    path.join(f.root, "document-catalog.json"),
    process.platform === "win32" ? "junction" : "file",
  );
  assert.equal((await f.call("", "operator-1")).statusCode, 503);
  await rm(path.join(f.root, "document-catalog.json"), {
    recursive: process.platform === "win32",
  });
  assert.equal((await f.call("", "operator-1")).statusCode, 503);
});

test("이미 발급한 세션도 역할 회수 뒤 문서 조회를 거부한다", async (t) => {
  const f = await fixture(t),
    login = await f.app.inject({
      method: "POST",
      url: "/api/session",
      payload: { actorId: "operator-1" },
    });
  const cookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`;
  await f.store.transact(
    "operator-1",
    "remove-role",
    "remove-role",
    () => {},
    (s) => {
      s.users.find((u) => u.id === "admin-1")!.roles.push("system_operator");
      s.users.find((u) => u.id === "operator-1")!.roles = ["learner"];
      return {};
    },
  );
  assert.equal(
    (
      await f.app.inject({
        method: "GET",
        url: "/api/system/documents/one",
        headers: { cookie },
      })
    ).statusCode,
    403,
  );
});
