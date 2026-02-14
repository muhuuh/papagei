import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DEFAULT_RETENTION_DAYS = 60;
const MAX_RETENTION_DAYS = 3650;
const dryRun = process.argv.includes("--dry-run");

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const historyDir = path.join(rootDir, "history");
const historyFile = path.join(historyDir, "history.json");
const settingsFile = path.join(historyDir, "settings.json");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function resolveRetentionDays() {
  const settings = readJson(settingsFile, {});
  const value = Number.parseInt(String(settings?.historyRetentionDays ?? DEFAULT_RETENTION_DAYS), 10);
  if (!Number.isFinite(value) || value < 1 || value > MAX_RETENTION_DAYS) {
    return DEFAULT_RETENTION_DAYS;
  }
  return value;
}

function toTimestamp(value) {
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function prune() {
  if (!fs.existsSync(historyFile)) {
    console.log("[prune-history] No history file found. Skipping.");
    return 0;
  }

  const history = readJson(historyFile, []);
  if (!Array.isArray(history)) {
    console.log("[prune-history] History file is invalid. Skipping.");
    return 1;
  }

  const days = resolveRetentionDays();
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  let removed = 0;
  const kept = history.filter((item) => {
    const createdAtMs = toTimestamp(item?.createdAt);
    if (createdAtMs === null) {
      return true;
    }
    if (createdAtMs < cutoffMs) {
      removed += 1;
      return false;
    }
    return true;
  });

  if (removed === 0) {
    console.log(`[prune-history] No entries older than ${days} days.`);
    return 0;
  }

  if (dryRun) {
    console.log(
      `[prune-history] Dry run: would remove ${removed} of ${history.length} entries (retention ${days} days).`
    );
    return 0;
  }

  fs.mkdirSync(historyDir, { recursive: true });
  const tempPath = `${historyFile}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(kept, null, 2), "utf8");
  fs.renameSync(tempPath, historyFile);
  console.log(`[prune-history] Removed ${removed} old entries. Kept ${kept.length}.`);
  return 0;
}

process.exitCode = prune();
