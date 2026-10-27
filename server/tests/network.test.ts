import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { createNetworkPolicy, listenHost, listenPort } from "../src/network.ts";

async function fixture(t: TestContext, origins?: string[]) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-network-"));
  const file = path.join(dir, "runtime", "state.json");
  await new JsonStore(file).initialize(seedState(true));
  const store = await new JsonStore(file).load();
  const app = await buildApp(store, { origins, serveFrontend: true });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { app, store };
}

test("Host는 정규 사설 IPv4/루프백만 자동 허용하고 다른 표기를 거부한다", () => {
  const policy = createNetworkPolicy();
  for (const host of [
    "localhost:5187",
    "LOCALHOST:5187",
    "127.0.0.1",
    "127.1.2.3",
    "[::1]:5187",
    "10.0.0.0",
    "10.255.255.255",
    "172.16.0.0",
    "172.31.255.255",
    "192.168.0.0",
    "192.168.255.255",
  ])
    assert.equal(policy.acceptsHost(host), true, host);
  for (const host of [
    undefined,
    "",
    "172.15.255.255",
    "172.32.0.0",
    "192.169.0.1",
    "8.8.8.8",
    "0.0.0.0",
    "169.254.1.1",
    "evil.example",
    "localhost.evil.example",
    "127.1",
    "2130706433",
    "0x7f000001",
    "127.000.0.1",
    "localhost:0",
    "localhost:65536",
    "localhost/path",
    "localhost@evil.example",
    "localhost,evil.example",
    "localhost\n",
    "[::ffff:127.0.0.1]",
  ])
    assert.equal(policy.acceptsHost(host), false, String(host));
});

test("명시 출처와 수신 환경변수는 검증되며 잘못된 설정은 시작 전에 실패한다", () => {
  const policy = createNetworkPolicy(["https://eks.example:8443"]);
  assert.ok(policy.acceptsHost("eks.example:8443"));
  assert.ok(
    policy.acceptsOrigin("localhost:5187", "http", "https://eks.example:8443"),
  );
  assert.equal(
    policy.acceptsOrigin("localhost:5187", "http", "https://eks.example:8444"),
    false,
  );
  for (const value of [
    "*",
    "null",
    "https://eks.example/path",
    "https://user@eks.example",
    "http://127.1",
    "https://eks.example?x=1",
  ])
    assert.throws(() => createNetworkPolicy([value]));
  assert.equal(listenHost(undefined, "0.0.0.0"), "0.0.0.0");
  assert.equal(listenHost("127.0.0.1", "0.0.0.0"), "127.0.0.1");
  assert.equal(listenPort("5297", 5187), 5297);
  for (const port of ["0", "-1", "65536", "NaN", "1.5", ""])
    assert.throws(() => listenPort(port, 5187));
  assert.throws(() => listenHost("bad host", "0.0.0.0"));
});

test("IP 변경·동일 출처 로그인 성공, 다른 출처·위조 헤더는 거부하며 조회는 데이터를 보존한다", async (t) => {
  const { app, store } = await fixture(t);
  const before = store.snapshot();
  for (const host of [
    "192.168.0.20:5187",
    "10.20.30.40:8080",
    "172.31.10.2:5186",
    "localhost:5187",
  ]) {
    const login = await app.inject({
      method: "POST",
      url: "/api/session",
      headers: { host, origin: `http://${host}` },
      payload: { actorId: "learner-1" },
    });
    assert.equal(login.statusCode, 200, login.body);
    const cookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`;
    assert.equal(
      (await app.inject({ url: "/api/workspace", headers: { host, cookie } }))
        .statusCode,
      200,
    );
  }
  for (const origin of [
    "http://192.168.0.21:5187",
    "http://192.168.0.20:5186",
    "https://192.168.0.20:5187",
    "https://evil.example",
    "null",
    "",
    "http://192.168.0.20:5187/path",
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/session",
      headers: {
        host: "192.168.0.20:5187",
        origin,
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
        forwarded: "host=evil.example;proto=https",
      },
      payload: { actorId: "learner-1" },
    });
    assert.equal(response.statusCode, 403, origin);
  }
  assert.equal(
    (
      await app.inject({
        url: "/api/health",
        headers: { host: "evil.example", "x-forwarded-host": "localhost" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: "learner-1" },
      })
    ).statusCode,
    200,
  );
  assert.equal((await app.inject({ url: "/api/workspace" })).statusCode, 401);
  for (const url of [
    "/server/src/index.ts",
    "/data/runtime/state.json",
    "/.env",
  ]) {
    const response = await app.inject({ url });
    assert.ok(
      response.statusCode === 404 ||
        response.headers["content-type"]?.includes("text/html"),
    );
    assert.ok(!response.body.includes('"schemaVersion"'));
  }
  assert.deepEqual(store.snapshot(), before);
});

test("TCP 포트 전달은 외부 Host/Origin을 보존하고 내부 포트와 달라도 세션을 만든다", async (t) => {
  const { app } = await fixture(t);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const backendPort = (app.server.address() as AddressInfo).port;
  const proxy = createServer((client) => {
    const upstream = connect(backendPort, "127.0.0.1");
    client.pipe(upstream).pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => proxy.close(() => resolve())));
  const port = (proxy.address() as AddressInfo).port;
  const body = JSON.stringify({ actorId: "learner-1" });
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/session",
        method: "POST",
        headers: {
          Host: "192.168.1.50:8080",
          Origin: "http://192.168.1.50:8080",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Connection: "close",
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
  assert.equal(status, 200);
});
