import { spawn, spawnSync } from "child_process";
import path from "path";

const backendHost = process.env.PAPAGEI_BACKEND_HOST || "127.0.0.1";
const backendPort = process.env.PAPAGEI_BACKEND_PORT || "4380";
const useReload = process.argv.includes("--reload");
const pruneScript = path.resolve("scripts", "prune-history.mjs");

const args = [
  "-m",
  "uvicorn",
  "papagei_backend.server:app",
  "--host",
  backendHost,
  "--port",
  backendPort,
];

if (useReload) {
  args.push("--reload");
}

const prune = spawnSync(process.execPath, [pruneScript], {
  stdio: "inherit",
});
if (prune.status !== 0) {
  console.warn("[dev:backend] History pruning failed. Continuing backend startup.");
}

console.log(`[dev:backend] Starting backend at http://${backendHost}:${backendPort}${useReload ? " (reload)" : ""}`);

const child = spawn("python", args, {
  stdio: "inherit",
});

const shutdown = (signal) => {
  if (child.killed) return;
  child.kill(signal);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(0);
    return;
  }
  process.exit(code ?? 0);
});
