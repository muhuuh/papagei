import { spawn } from "child_process";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { URL } from "url";

const backendBase = process.env.NEXT_PUBLIC_PAPAGEI_BACKEND_URL || "http://127.0.0.1:8000";
const healthUrl = new URL("/health", backendBase);
const hotkeyScript = path.resolve("scripts", "papagei-hotkeys.ahk");

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

function runCommand(command) {
  const child = spawn(command, {
    stdio: "inherit",
    shell: true,
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

function startHotkeys() {
  if (process.platform !== "win32") {
    console.log("[dev:all:hotkeys] Hotkeys helper is Windows-only. Skipping.");
    return;
  }
  if (!fs.existsSync(hotkeyScript)) {
    console.log(`[dev:all:hotkeys] Missing ${hotkeyScript}. Skipping hotkeys.`);
    return;
  }
  const command = `cmd /c start "" "${hotkeyScript}"`;
  spawn(command, { stdio: "inherit", shell: true });
  console.log("[dev:all:hotkeys] Launched hotkeys helper.");
}

(async () => {
  startHotkeys();

  const health = await checkHealth();
  if (health.ok) {
    console.log(`[dev:all:hotkeys] Backend already running at ${backendBase}. Starting frontend only.`);
    runCommand("npm run dev");
    return;
  }

  runCommand("npx concurrently -k -n BACKEND,FRONTEND -c auto \"npm run dev:backend\" \"npm run dev\"");
})();
