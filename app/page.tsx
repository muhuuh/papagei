"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TranscriptItem = {
  id: string;
  createdAt: string;
  seconds: number;
  text: string;
};

type Status = "idle" | "recording" | "transcribing" | "error";
type BackendState = "offline" | "loading" | "ready";

const BACKEND = process.env.NEXT_PUBLIC_PAPAGEI_BACKEND_URL ?? "http://127.0.0.1:4380";
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
      <label className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5 text-[13px] cursor-pointer hover:bg-white/[0.06] transition-colors group/label">
        <span className="font-medium text-slate-300 group-hover/label:text-slate-100 transition-colors">{label}</span>
        <button
          type="button"
          onClick={() => onChange(!checked)}
          className={`relative h-5 w-9 rounded-full transition-all duration-300 ${
            checked ? "bg-cyan-500" : "bg-slate-700"
          }`}
          aria-pressed={checked}
        >
          <span
            className={`absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm transition-all duration-300 ${
              checked ? "left-5" : "left-1"
            }`}
          />
        </button>
      </label>
      {hint ? (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-900 border border-white/10 text-slate-200 text-[11px] rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none whitespace-nowrap z-10 shadow-xl translate-y-1 group-hover:translate-y-0">
          {hint}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
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
  const [autoCopy, setAutoCopy] = useState(true);
  const [appendMode, setAppendMode] = useState(true);

  const transcriptRef = useRef<HTMLTextAreaElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const isRecording = status === "recording";
  const isBusy = status === "recording" || status === "transcribing";

  function formatTimeAgo(value: string) {
    try {
      const date = new Date(value);
      const now = new Date();
      const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

      if (diffInSeconds < 60) return "just now";
      if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
      if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
      
      const diffInDays = Math.floor(diffInSeconds / 86400);
      if (diffInDays < 7) return `${diffInDays}d ago`;
      
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return value;
    }
  }

  function formatDate(value: string) {
    return formatTimeAgo(value);
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
      if (!r.ok) throw new Error("Backend not reachable");
      const data = await r.json();
      const ready = Boolean(data.ready);
      setBackendOk(true);
      setBackendState(ready ? "ready" : "loading");
      // message no longer used in UI
      return { ready, status: ready ? "ready" : "loading", message: ready ? "Ready" : "Loading model..." };
    } catch {
      setBackendOk(false);
      setBackendState("offline");
      return { ready: false, status: "offline", message: "Backend offline" };
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
    const t = setInterval(checkHealth, 2000);
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
    if (status === "idle") return "Ready";
    if (status === "recording") return "Recording...";
    if (status === "transcribing") return "Transcribing...";
    return "Error";
  }, [status, backendState]);

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
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr,0.8fr] items-stretch">
          <section className="flex flex-col gap-6">
            {backendState !== "ready" ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                {backendState === "loading"
                  ? "Backend is loading the model..."
                  : "Backend is offline."}
              </div>
            ) : null}
            <div className="rounded-2xl border border-white/10 bg-panel/80 p-6 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between mb-8">
                <h2 className="font-display text-lg text-white">Controls</h2>
                <div className="flex items-center gap-3">
                  <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                    isRecording ? "text-rose-400 border-rose-500/20 bg-rose-500/5" : 
                    status === "transcribing" ? "text-amber-400 border-amber-500/20 bg-amber-500/5" : 
                    "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      isRecording ? "bg-rose-500 animate-pulse" : 
                      status === "transcribing" ? "bg-amber-500 animate-bounce" : 
                      "bg-emerald-500"
                    }`} />
                    {statusLabel}
                  </span>
                  <span className="text-[11px] font-medium text-slate-400 bg-white/5 border border-white/10 px-2 py-1 rounded-md">
                    Space
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-5">
                <button
                  className={`w-full h-12 rounded-xl font-semibold transition-all duration-200 relative overflow-hidden group border ${
                    isRecording
                      ? "bg-rose-500/10 border-rose-500/30 text-rose-100"
                      : "bg-cyan-400 text-slate-950 border-cyan-400/50"
                  }`}
                  onClick={toggle}
                  disabled={status === "transcribing" || backendState !== "ready"}
                >
                  <div className="relative z-10 flex items-center justify-center gap-2.5">
                    {isRecording ? (
                      <>
                        <div className="flex gap-1">
                          <span className="w-1 h-3 bg-rose-200 animate-[pulse_1s_infinite_0ms]" />
                          <span className="w-1 h-3 bg-rose-200 animate-[pulse_1s_infinite_200ms]" />
                          <span className="w-1 h-3 bg-rose-200 animate-[pulse_1s_infinite_400ms]" />
                        </div>
                        Stop Recording
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                        </svg>
                        Start Recording
                      </>
                    )}
                  </div>
                  <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                <div className="grid grid-cols-2 gap-3">
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
            </div>

            <div className="rounded-2xl border border-white/10 bg-panel/80 p-6 shadow-xl backdrop-blur flex flex-col flex-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-lg text-white">Transcript</h2>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/10 transition"
                    onClick={copyToClipboard}
                    disabled={!transcript}
                  >
                    Copy
                  </button>
                  <button
                    className="rounded-lg border border-white/10 bg-transparent px-3 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition"
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
                className="mt-4 flex-1 min-h-[220px] w-full resize-none rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-slate-100 outline-none focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
              />

              {error ? (
                <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {error}
                </p>
              ) : null}
            </div>
          </section>

          <aside className="flex flex-col">
            <div className="rounded-2xl border border-white/10 bg-panel/80 p-6 shadow-xl backdrop-blur flex flex-col h-full">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg text-white">History</h2>
                  <span className="text-[10px] font-medium text-slate-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                    Latest {HISTORY_PAGE}
                  </span>
                </div>
                <button
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/10 transition"
                  onClick={() => {
                    setHistoryModalOpen(true);
                    loadAllHistory();
                  }}
                >
                  View all
                </button>
              </div>

              <div className="mt-4 space-y-3 flex-1 overflow-y-auto pr-1">
                {summaryHistory.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
                    No transcripts yet. Start a session to populate this list.
                  </div>
                ) : (
                  summaryHistory.map((h) => (
                    <div key={h.id} className="group relative rounded-xl border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/[0.07]">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
                          <span>{formatTimeAgo(h.createdAt)}</span>
                          <span className="opacity-30">•</span>
                          <span>{Math.round(h.seconds)}s</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            className="flex items-center justify-center rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                            title="Load into transcript"
                            onClick={() => {
                              setTranscript(h.text);
                              requestAnimationFrame(() => transcriptRef.current?.focus());
                            }}
                          >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                          </button>
                          <button
                            className="flex items-center justify-center rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                            title="Copy to clipboard"
                            onClick={() => navigator.clipboard.writeText(h.text)}
                          >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                          <button
                            className="flex items-center justify-center rounded-md border border-rose-500/20 bg-rose-500/5 p-1.5 text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Delete entry"
                            onClick={() => deleteHistoryItem(h.id)}
                          >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <p className="text-[13px] text-slate-200 leading-relaxed line-clamp-2">{h.text}</p>
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
                    <div key={h.id} className="group relative rounded-xl border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/[0.07]">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
                          <span>{formatTimeAgo(h.createdAt)}</span>
                          <span className="opacity-30">•</span>
                          <span>{Math.round(h.seconds)}s</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                            onClick={() => {
                              setTranscript(h.text);
                              setHistoryModalOpen(false);
                              requestAnimationFrame(() => transcriptRef.current?.focus());
                            }}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            Load
                          </button>
                          <button
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                            onClick={() => navigator.clipboard.writeText(h.text)}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            Copy
                          </button>
                          <button
                            className="flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-1.5 text-xs font-medium text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            onClick={() => deleteHistoryItem(h.id)}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            Delete
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed">{h.text}</p>
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
