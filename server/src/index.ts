import { fileURLToPath } from "node:url";
import path from "node:path";
import { JsonStore } from "./storage.ts";
import { buildApp } from "./app.ts";

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
    origins: [
      process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5186",
      "http://127.0.0.1:5187",
    ],
  });
  await app.listen({
    host: "127.0.0.1",
    port: Number(process.env.API_PORT || 5187),
  });
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
