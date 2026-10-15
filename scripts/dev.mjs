import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const viteBin = path.join(
  path.dirname(require.resolve("vite/package.json")),
  "bin/vite.js",
);
const children = [
  spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    stdio: "inherit",
  }),
  spawn(process.execPath, [viteBin, "--host", "127.0.0.1"], {
    cwd: new URL("../frontend/", import.meta.url),
    stdio: "inherit",
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((p) => p.kill("SIGTERM"));
  Promise.all(
    children.map((p) =>
      p.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => p.once("exit", resolve)),
    ),
  ).then(() => process.exit(code));
}
children.forEach((p) => p.on("exit", (code) => stop(code || 0)));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
