"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TranscriptItem = {
  id: string;
  createdAt: string;
  seconds: number;
  text: string;
};

type Status = "idle" | "recording" | "transcribing" | "error";
type BackendState = "offline" | "loading" | "ready" | "error";

const BACKEND = process.env.NEXT_PUBLIC_PAPAGEI_BACKEND_URL ?? "http://127.0.0.1:8000";
const HISTORY_PAGE = 5;

type ToggleProps = {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
};

function Toggle({ label, checked, onChange, hint }: ToggleProps) {
  return (
    <div className="relative group">
      <label className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm cursor-pointer">
        <div className="min-w-0">
          <div className="font-medium text-slate-100">{label}</div>
        </div>
        <button
          type="button"
          onClick={() => onChange(!checked)}
          className={`relative h-6 w-11 rounded-full border border-white/15 transition ${
            checked ? "bg-cyan-400/80" : "bg-white/10"
          }`}
          aria-pressed={checked}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
              checked ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </label>
      {hint ? (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-slate-800 text-slate-200 text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
          {hint}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
        </div>
      ) : null}
    </div>
  );
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [history, setHistory] = useState<TranscriptItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState<number>(0);
  const [historyOffset, setHistoryOffset] = useState<number>(0);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyAll, setHistoryAll] = useState<TranscriptItem[]>([]);
  const [historyAllLoading, setHistoryAllLoading] = useState(false);
  const [historyAllError, setHistoryAllError] = useState<string | null>(null);
  const [historyAllLoaded, setHistoryAllLoaded] = useState(false);
  const [historyFilterText, setHistoryFilterText] = useState("");
  const [historyFilterFrom, setHistoryFilterFrom] = useState("");
  const [historyFilterTo, setHistoryFilterTo] = useState("");
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [backendState, setBackendState] = useState<BackendState>("offline");
  const [backendMessage, setBackendMessage] = useState<string>("");
  const [backendPhases, setBackendPhases] = useState<string[]>([]);
  const [backendPhaseIndex, setBackendPhaseIndex] = useState<number>(0);
  const [backendStartedAt, setBackendStartedAt] = useState<number | null>(null);
  const [backendUptime, setBackendUptime] = useState<number | null>(null);
  const [backendPid, setBackendPid] = useState<number | null>(null);
  const [backendProgress, setBackendProgress] = useState<number>(0);
  const [autoCopy, setAutoCopy] = useState(true);
  const [appendMode, setAppendMode] = useState(true);

  const transcriptRef = useRef<HTMLTextAreaElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const isRecording = status === "recording";
  const isBusy = status === "recording" || status === "transcribing";

  function formatDate(value: string) {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  function truncateText(text: string, maxWords = 10) {
    const trimmed = text.trim();
    if (!trimmed) return "";
    const words = trimmed.split(/\s+/);
    if (words.length <= maxWords) return trimmed;
    return `${words.slice(0, maxWords).join(" ")}...`;
  }

  async function checkHealth() {
    try {
      const r = await fetch(`${BACKEND}/health`, { cache: "no-store" });
      if (!r.ok) {
        setBackendOk(false);
        setBackendState("offline");
        setBackendMessage("Backend not reachable");
        return { ready: false, status: "offline", message: "Backend not reachable" };
      }
      const data = await r.json();
      const status = (data.status as BackendState | undefined) ?? (data.ready ? "ready" : "loading");
      const normalized: BackendState =
        status === "error" ? "error" : status === "ready" ? "ready" : "loading";
      const message =
        (data.message as string | undefined) ??
        (data.error as string | undefined) ??
        "";
      const phases = (data.phases as string[] | undefined) ?? [];
      const phaseIndex = Number.isFinite(data.phase_index) ? Number(data.phase_index) : 0;
      const startedAt = typeof data.started_at === "number" ? data.started_at : null;
      const uptime = typeof data.uptime_seconds === "number" ? data.uptime_seconds : null;
      const pid = typeof data.pid === "number" ? data.pid : null;
      const progress = typeof data.progress === "number" ? data.progress : 0;
      setBackendOk(true);
      setBackendState(normalized);
      setBackendMessage(message);
      setBackendPhases(phases);
      setBackendPhaseIndex(phaseIndex);
      setBackendStartedAt(startedAt);
      setBackendUptime(uptime);
      setBackendPid(pid);
      setBackendProgress(progress);
      return { ready: Boolean(data.ready), status: normalized, message };
    } catch {
      setBackendOk(false);
      setBackendState("offline");
      setBackendMessage("Backend not reachable");
      return { ready: false, status: "offline", message: "Backend not reachable" };
    }
  }

  useEffect(() => {
    checkHealth();
    function onFocus() {
      checkHealth();
    }
    function onVisibilityChange() {
      if (!document.hidden) checkHealth();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (backendState === "ready") return;
    const t = setInterval(checkHealth, 3000);
    return () => clearInterval(t);
  }, [backendState]);

  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        lastFocusedRef.current = target;
      }
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  async function loadHistory(reset = false) {
    if (historyLoading) return;
    setHistoryLoading(true);
    try {
      const offset = reset ? 0 : historyOffset;
      const r = await fetch(`${BACKEND}/history?limit=${HISTORY_PAGE}&offset=${offset}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error("Failed to load history");
      const data = await r.json();
      const items = (data.items as TranscriptItem[]) ?? [];
      setHistoryTotal(data.total ?? 0);
      if (reset) {
        setHistory(items);
        setHistoryOffset(items.length);
      } else {
        setHistory((h) => [...h, ...items]);
        setHistoryOffset((prev) => prev + items.length);
      }
    } catch {
      // ignore history fetch errors
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadAllHistory() {
    if (historyAllLoading) return;
    setHistoryAllLoading(true);
    setHistoryAllError(null);
    try {
      const r = await fetch(`${BACKEND}/history/all`, { cache: "no-store" });
      if (!r.ok) throw new Error("Failed to load history");
      const data = await r.json();
      const items = (data.items as TranscriptItem[]) ?? [];
      setHistoryAll(items);
      setHistoryAllLoaded(true);
      setHistoryTotal(data.total ?? items.length);
    } catch (e: any) {
      setHistoryAllError(e?.message ?? "Failed to load history");
    } finally {
      setHistoryAllLoading(false);
    }
  }

  async function deleteHistoryItem(itemId: string) {
    try {
      const r = await fetch(`${BACKEND}/history/${itemId}`, { method: "DELETE" });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(msg || `Delete failed (${r.status})`);
      }
      setHistory((h) => h.filter((item) => item.id !== itemId));
      if (historyAllLoaded) {
        setHistoryAll((items) => items.filter((item) => item.id !== itemId));
      }
      setHistoryTotal((prev) => Math.max(prev - 1, 0));
      setHistoryOffset((prev) => Math.max(prev - 1, 0));
      loadHistory(true);
    } catch (e: any) {
      setHistoryAllError(e?.message ?? "Delete failed");
    }
  }

  useEffect(() => {
    if (backendOk) {
      loadHistory(true);
    }
  }, [backendOk]);

  function isInsertable(target: HTMLElement) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    );
  }

  function insertIntoFocusedField(text: string) {
    const active = document.activeElement as HTMLElement | null;
    const target = active && isInsertable(active) ? active : lastFocusedRef.current;
    if (!target) return false;
    if (target === transcriptRef.current) {
      return false;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      const before = target.value.slice(0, start);
      const after = target.value.slice(end);
      const payload = appendMode && before.length > 0 ? ` ${text}` : text;
      const nextValue = before + payload + after;
      target.value = nextValue;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      const nextPos = start + payload.length;
      target.setSelectionRange(nextPos, nextPos);
      target.focus();
      return true;
    }

    if (target.isContentEditable) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      target.focus();
      return true;
    }

    return false;
  }

  function formatPhaseLabel(phase: string) {
    return phase.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function start() {
    setError(null);
    try {
      const status = await checkHealth();
      if (!status.ready) {
        setStatus("error");
        if (status.status === "loading") {
          setError(status.message || "Backend is loading the model. Please wait.");
        } else {
          setError("Backend is offline. Start it with: npm run dev:backend");
        }
        return;
      }
      const r = await fetch(`${BACKEND}/start`, { method: "POST" });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(msg || `start failed (${r.status})`);
      }
      setStatus("recording");
    } catch (e: any) {
      setStatus("error");
      setError(e?.message ?? String(e));
    }
  }

  async function stop() {
    setError(null);
    setStatus("transcribing");
    try {
      const r = await fetch(`${BACKEND}/stop`, { method: "POST" });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(msg || `stop failed (${r.status})`);
      }
      const data = await r.json();
      const text = (data.text as string) ?? "";
      if (!text) {
        setTranscript(text);
      } else if (appendMode) {
        setTranscript((prev) => {
          const base = prev.trimEnd();
          const spacer = base.length > 0 ? " " : "";
          return `${base}${spacer}${text}`;
        });
      } else {
        setTranscript(text);
      }

      const item = data.item as TranscriptItem | undefined;
      if (item) {
        setHistory((h) => [item, ...h].slice(0, HISTORY_PAGE));
        setHistoryOffset((prev) => prev + 1);
        setHistoryTotal((prev) => prev + 1);
        if (historyAllLoaded) {
          setHistoryAll((items) => [item, ...items]);
        }
      }
      setStatus("idle");

      if (autoCopy && text) {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // ignore clipboard errors
        }
      }

      let inserted = false;
      if (text) {
        inserted = insertIntoFocusedField(text);
      }
      if (!inserted) {
        requestAnimationFrame(() => transcriptRef.current?.focus());
      }
    } catch (e: any) {
      setStatus("error");
      setError(e?.message ?? String(e));
    }
  }

  async function toggle() {
    if (status === "recording") return stop();
    if (status === "idle" || status === "error") return start();
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(transcript);
    } catch {
      transcriptRef.current?.select();
      document.execCommand("copy");
    }
  }

  function clear() {
    setTranscript("");
    transcriptRef.current?.focus();
  }

  const summaryHistory = useMemo(() => history.slice(0, HISTORY_PAGE), [history]);

  const filteredHistory = useMemo(() => {
    const query = historyFilterText.trim().toLowerCase();
    const fromDate = historyFilterFrom ? new Date(`${historyFilterFrom}T00:00:00`) : null;
    const toDate = historyFilterTo ? new Date(`${historyFilterTo}T23:59:59.999`) : null;
    return historyAll.filter((item) => {
      if (query && !item.text.toLowerCase().includes(query)) return false;
      const created = new Date(item.createdAt);
      if (fromDate && created < fromDate) return false;
      if (toDate && created > toDate) return false;
      return true;
    });
  }, [historyAll, historyFilterText, historyFilterFrom, historyFilterTo]);

  const statusLabel = useMemo(() => {
    if (backendState === "offline") return "Backend offline";
    if (backendState === "loading") return "Loading model...";
    if (backendState === "error") return "Backend error";
    if (status === "idle") return "Ready";
    if (status === "recording") return "Recording...";
    if (status === "transcribing") return "Transcribing...";
    return "Error";
  }, [status, backendState]);

  const backendElapsed = useMemo(() => {
    if (!backendStartedAt) return null;
    const seconds = Math.max(0, Math.round(Date.now() / 1000 - backendStartedAt));
    return seconds;
  }, [backendStartedAt, backendState]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const active = document.activeElement?.tagName?.toLowerCase();
      if (active === "textarea" || active === "input") return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status]);

  useEffect(() => {
    if (!historyModalOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setHistoryModalOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyModalOpen]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Local speech to text</p>
            <h1 className="font-display text-4xl font-semibold text-white">Papagei Control Room</h1>
            <p className="max-w-2xl text-sm text-slate-300">
              Start and stop recording without restarting the script. Each session keeps the model warm and returns a
              transcript you can copy or drop directly into a focused field.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{statusLabel}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              Backend:{" "}
              {backendState === "ready"
                ? "READY"
                : backendState === "loading"
                ? "LOADING"
                : backendState === "error"
                ? "ERROR"
                : "OFFLINE"}
            </span>
          </div>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <section className="space-y-6">
            {backendState !== "ready" ? (
              <div
                className={`rounded-2xl border p-4 text-sm ${
                  backendState === "loading"
                    ? "border-sky-400/30 bg-sky-400/10 text-sky-100"
                    : backendState === "error"
                    ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
                    : "border-amber-400/30 bg-amber-400/10 text-amber-100"
                }`}
              >
                {backendState === "loading" ? (
                  <>
                    <div className="font-semibold">Backend is starting</div>
                    <p className="mt-1 text-xs text-sky-100/80">
                      Backend is reachable. Loading the local speech model can take ~30-90 seconds on CPU.
                    </p>
                    {backendMessage ? (
                      <div className="mt-2 rounded-lg border border-sky-400/20 bg-black/40 px-3 py-2 text-xs text-sky-100/90">
                        {backendMessage}
                      </div>
                    ) : null}
                    {backendPhases.length > 0 ? (
                      <div className="mt-3 grid gap-2 text-xs text-sky-100/80">
                        {backendPhases.map((phase, idx) => (
                          <div
                            key={`${phase}-${idx}`}
                            className={`flex items-center gap-2 ${
                              idx < backendPhaseIndex
                                ? "text-sky-100/90"
                                : idx === backendPhaseIndex
                                ? "text-sky-100"
                                : "text-sky-100/50"
                            }`}
                          >
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-sky-400/30 text-[10px]">
                              {idx < backendPhaseIndex ? "ok" : idx === backendPhaseIndex ? "..." : "-"}
                            </span>
                            <span>{formatPhaseLabel(phase)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-3 h-2 w-full rounded-full bg-black/40">
                      <div
                        className="h-2 rounded-full bg-sky-400/70 transition-all"
                        style={{ width: `${Math.round(backendProgress * 100)}%` }}
                      />
                    </div>
                    <div className="mt-2 text-[11px] text-sky-100/70">
                      {backendElapsed !== null ? `Elapsed: ${backendElapsed}s` : "Elapsed: ..."}
                      {backendPid ? ` · PID: ${backendPid}` : ""}
                      {backendUptime !== null ? ` · Uptime: ${Math.round(backendUptime)}s` : ""}
                    </div>
                    <button
                      className="mt-3 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs text-sky-100"
                      onClick={() => checkHealth()}
                    >
                      Refresh status
                    </button>
                  </>
                ) : backendState === "error" ? (
                  <>
                    <div className="font-semibold">Backend error</div>
                    <p className="mt-1 text-xs text-rose-100/80">
                      The backend reported a model load error. Check the backend console logs.
                    </p>
                    {backendMessage ? (
                      <div className="mt-2 rounded-lg border border-rose-400/20 bg-black/40 px-3 py-2 text-xs text-rose-100/90">
                        {backendMessage}
                      </div>
                    ) : null}
                    <button
                      className="mt-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-xs text-rose-100"
                      onClick={() => checkHealth()}
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  <>
                    <div className="font-semibold">Backend is offline</div>
                    <p className="mt-1 text-xs text-amber-100/80">
                      Start the backend in a separate terminal, then refresh this page.
                    </p>
                    <pre className="mt-3 rounded-lg border border-amber-400/20 bg-black/40 p-3 text-xs text-amber-100/90">
                      npm run dev:backend
                    </pre>
                    <p className="mt-2 text-xs text-amber-100/70">
                      Or run both together: <span className="font-semibold">npm run dev:all</span>
                    </p>
                    <button
                      className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-100"
                      onClick={() => checkHealth()}
                    >
                      Refresh status
                    </button>
                  </>
                )}
              </div>
            ) : null}
            <div className="rounded-2xl border border-white/10 bg-panel/80 p-6 shadow-xl backdrop-blur">
              <div className="flex flex-wrap items-center gap-4">
                <button
                  className={`rounded-xl px-6 py-3 text-sm font-semibold transition ${
                    isRecording
                      ? "bg-rose-500/90 text-white shadow-glow"
                      : "bg-cyan-400/90 text-slate-900 shadow-glow"
                  }`}
                  onClick={toggle}
                  disabled={status === "transcribing" || backendState !== "ready"}
                >
                  {isRecording ? "Stop" : "Start"}
                </button>
                <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                  Shortcut: Space
                </span>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <Toggle
                  label="Auto copy"
                  checked={autoCopy}
                  onChange={setAutoCopy}
                  hint="Copies transcript to clipboard after Stop."
                />
                <Toggle
                  label="Append mode"
                  checked={appendMode}
                  onChange={setAppendMode}
                  hint="Adds text instead of replacing."
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-panel/80 p-6 shadow-xl backdrop-blur">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-display text-lg text-white">Transcript</h2>
                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                    onClick={copyToClipboard}
                    disabled={!transcript}
                  >
                    Copy
                  </button>
                  <button
                    className="rounded-lg border border-white/10 bg-transparent px-3 py-1 text-xs text-slate-300"
                    onClick={clear}
                    disabled={!transcript}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <textarea
                ref={transcriptRef}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Your transcript will appear here..."
                className="mt-4 min-h-[220px] w-full resize-y rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-slate-100 outline-none focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
              />

              {error ? (
                <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {error}
                </p>
              ) : null}
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-panel/80 p-6 shadow-xl backdrop-blur">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg text-white">History</h2>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-400">
                  Latest {Math.min(historyTotal, HISTORY_PAGE)}
                </span>
                <div className="ml-auto">
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                    onClick={() => {
                      setHistoryModalOpen(true);
                      loadAllHistory();
                    }}
                  >
                    View all
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {summaryHistory.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
                    No transcripts yet. Start a session to populate this list.
                  </div>
                ) : (
                  summaryHistory.map((h) => (
                    <div key={h.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{formatDate(h.createdAt)}</span>
                        <span>{Math.round(h.seconds)}s</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-100 truncate">{truncateText(h.text, 10)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-200"
                          onClick={() => {
                            setTranscript(h.text);
                            requestAnimationFrame(() => transcriptRef.current?.focus());
                          }}
                        >
                          Load
                        </button>
                        <button
                          className="rounded-lg border border-white/10 bg-transparent px-2 py-0.5 text-[11px] text-slate-300"
                          onClick={() => navigator.clipboard.writeText(h.text)}
                        >
                          Copy
                        </button>
                        <button
                          className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200"
                          onClick={() => deleteHistoryItem(h.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </aside>
        </div>
      </div>
      {historyModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur"
          onClick={() => setHistoryModalOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-panel/95 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center gap-3 border-b border-white/10 px-6 py-4">
              <h3 className="font-display text-lg text-white">History</h3>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-400">
                {historyAll.length} items
              </span>
              <button
                className="ml-auto rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                onClick={() => setHistoryModalOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="px-6 py-4">
              <div className="grid gap-3 md:grid-cols-[1.5fr,1fr,1fr,auto]">
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
                  placeholder="Filter by words..."
                  value={historyFilterText}
                  onChange={(e) => setHistoryFilterText(e.target.value)}
                />
                <input
                  type="date"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
                  value={historyFilterFrom}
                  onChange={(e) => setHistoryFilterFrom(e.target.value)}
                />
                <input
                  type="date"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
                  value={historyFilterTo}
                  onChange={(e) => setHistoryFilterTo(e.target.value)}
                />
                <button
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200"
                  onClick={() => {
                    setHistoryFilterText("");
                    setHistoryFilterFrom("");
                    setHistoryFilterTo("");
                  }}
                >
                  Clear
                </button>
              </div>

              <div className="mt-3 text-xs text-slate-400">
                {historyAllLoading
                  ? "Loading history..."
                  : `Showing ${filteredHistory.length} of ${historyAll.length}`}
              </div>
              {historyAllError ? (
                <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {historyAllError}
                </p>
              ) : null}
            </div>

            <div className="max-h-[55vh] overflow-y-auto px-6 pb-6">
              {historyAllLoading ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
                  Loading history...
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
                  No history matches your filters.
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredHistory.map((h) => (
                    <div key={h.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{formatDate(h.createdAt)}</span>
                        <span>{Math.round(h.seconds)}s</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-100 whitespace-pre-wrap">{h.text}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                          onClick={() => {
                            setTranscript(h.text);
                            setHistoryModalOpen(false);
                            requestAnimationFrame(() => transcriptRef.current?.focus());
                          }}
                        >
                          Load
                        </button>
                        <button
                          className="rounded-lg border border-white/10 bg-transparent px-3 py-1 text-xs text-slate-300"
                          onClick={() => navigator.clipboard.writeText(h.text)}
                        >
                          Copy
                        </button>
                        <button
                          className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-xs text-rose-200"
                          onClick={() => deleteHistoryItem(h.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
