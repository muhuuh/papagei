import { spawn } from "child_process";
import http from "http";
import https from "https";
import { URL } from "url";

const configuredBackendUrl = process.env.NEXT_PUBLIC_PAPAGEI_BACKEND_URL;
const backendBase = configuredBackendUrl || `http://127.0.0.1:${process.env.PAPAGEI_BACKEND_PORT || "4380"}`;
const healthUrl = new URL("/health", backendBase);
const backendHost = process.env.PAPAGEI_BACKEND_HOST || healthUrl.hostname || "127.0.0.1";
const backendPort =
  process.env.PAPAGEI_BACKEND_PORT ||
  healthUrl.port ||
  (healthUrl.protocol === "https:" ? "443" : "80");
const childEnv = {
  ...process.env,
  PAPAGEI_BACKEND_HOST: backendHost,
  PAPAGEI_BACKEND_PORT: backendPort,
  NEXT_PUBLIC_PAPAGEI_BACKEND_URL: backendBase,
};

function checkHealth(timeoutMs = 800) {
  return new Promise((resolve) => {
    const lib = healthUrl.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: healthUrl.hostname,
        port: healthUrl.port,
        path: healthUrl.pathname,
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            resolve({ ok: res.statusCode === 200 && data.ok === true, status: res.statusCode });
          } catch {
            resolve({ ok: false, status: res.statusCode });
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, timeout: true });
    });
    req.on("error", () => resolve({ ok: false, status: 0 }));
    req.end();
  });
}

function runCommand(command, env = process.env) {
  const child = spawn(command, {
    stdio: "inherit",
    shell: true,
    env,
  });

  const shutdown = () => {
    if (!child.killed) {
      child.kill("SIGINT");
      setTimeout(() => child.kill("SIGTERM"), 500);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

(async () => {
  const health = await checkHealth();
  if (health.ok) {
    console.log(`[dev:all] Backend already running at ${backendBase}. Starting frontend only.`);
    runCommand("npm run dev", childEnv);
    return;
  }

  runCommand("npx concurrently -k -n BACKEND,FRONTEND -c auto \"npm run dev:backend\" \"npm run dev\"", childEnv);
})();
