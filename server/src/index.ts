import {
  connectionCandidates,
  createNetworkPolicy,
  listenHost,
  listenPort,
} from "./network.ts";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JsonStore } from "./storage.ts";
import { buildApp } from "./app.ts";

const host = listenHost(process.env.API_HOST, "0.0.0.0");
const port = listenPort(process.env.API_PORT, 5187);
const origins = process.env.FRONTEND_ORIGIN
  ? [process.env.FRONTEND_ORIGIN]
  : [];
createNetworkPolicy(origins);

export const dataFile = path.resolve(
  process.env.EKS_DATA_FILE ||
    fileURLToPath(new URL("../../data/runtime/state.json", import.meta.url)),
);
const store = await new JsonStore(dataFile).load();
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  app = await buildApp(store, {
    logger: true,
    serveFrontend: true,
    origins,
  });
  await app.listen({
    host,
    port,
  });
  app.log.info(
    { host, port, urls: connectionCandidates(host, port) },
    "접속 후보 주소 (방화벽·WSL 전달 설정 별도 확인)",
  );
} catch (error) {
  if (app) await app.close();
  else await store.close();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app?.close();
    process.exit(0);
  });
