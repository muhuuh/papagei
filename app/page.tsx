"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TranscriptItem = {
  id: string;
  createdAt: string;
  seconds: number;
  text: string;
};

type Status = "idle" | "recording" | "transcribing" | "error";

const BACKEND = process.env.NEXT_PUBLIC_PAPAGEI_BACKEND_URL ?? "http://127.0.0.1:8000";

function nowId() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

type ToggleProps = {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
};

function Toggle({ label, checked, onChange, hint }: ToggleProps) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium text-slate-100">{label}</div>
        {hint ? <div className="text-xs text-slate-400">{hint}</div> : null}
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
  );
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [history, setHistory] = useState<TranscriptItem[]>([]);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [autoCopy, setAutoCopy] = useState(true);
  const [autoInsert, setAutoInsert] = useState(true);
  const [appendMode, setAppendMode] = useState(true);

  const transcriptRef = useRef<HTMLTextAreaElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const isRecording = status === "recording";
  const isBusy = status === "recording" || status === "transcribing";

  async function checkHealth() {
    try {
      const r = await fetch(`${BACKEND}/health`, { cache: "no-store" });
      setBackendOk(r.ok);
    } catch {
      setBackendOk(false);
    }
  }

  useEffect(() => {
    checkHealth();
    const t = setInterval(checkHealth, 4000);
    return () => clearInterval(t);
  }, []);

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
      setTranscript(text);

      const item: TranscriptItem = {
        id: nowId(),
        createdAt: new Date().toISOString(),
        seconds: data.seconds ?? 0,
        text,
      };
      setHistory((h) => [item, ...h]);
      setStatus("idle");

      if (autoCopy && text) {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // ignore clipboard errors
        }
      }

      if (autoInsert && text) {
        insertIntoFocusedField(text);
      } else {
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

  const statusLabel = useMemo(() => {
    if (backendOk === false) return "Backend offline";
    if (status === "idle") return "Ready";
    if (status === "recording") return "Recording...";
    if (status === "transcribing") return "Transcribing...";
    return "Error";
  }, [status, backendOk]);

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
              Backend: {backendOk === null ? "..." : backendOk ? "OK" : "OFFLINE"}
            </span>
          </div>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <section className="space-y-6">
            {backendOk === false ? (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
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
                  disabled={status === "transcribing" || backendOk === false}
                >
                  {isRecording ? "Stop" : "Start"}
                </button>
                <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                  Shortcut: Space
                </span>
                <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                  {isBusy ? "Session active" : "Idle"}
                </span>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <Toggle
                  label="Auto copy"
                  checked={autoCopy}
                  onChange={setAutoCopy}
                  hint="Copies transcript to clipboard after Stop."
                />
                <Toggle
                  label="Auto insert"
                  checked={autoInsert}
                  onChange={setAutoInsert}
                  hint="Inserts into the focused field in this window."
                />
                <Toggle
                  label="Append mode"
                  checked={appendMode}
                  onChange={setAppendMode}
                  hint="Adds text instead of replacing."
                />
              </div>

              <p className="mt-4 text-xs text-slate-400">
                Tip: Browser security prevents direct typing into other apps. Use Auto copy and paste anywhere.
              </p>
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
                  {history.length} items
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {history.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
                    No transcripts yet. Start a session to populate this list.
                  </div>
                ) : (
                  history.map((h) => (
                    <div key={h.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{new Date(h.createdAt).toLocaleString()}</span>
                        <span>{Math.round(h.seconds)}s</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-100 whitespace-pre-wrap">{h.text}</p>
                      <div className="mt-3 flex gap-2">
                        <button
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                          onClick={() => {
                            setTranscript(h.text);
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
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-panel/80 p-6 shadow-xl backdrop-blur">
              <h2 className="font-display text-lg text-white">Paste target</h2>
              <p className="mt-2 text-xs text-slate-400">
                Click inside this field (or the Transcript box) before stopping. Auto insert will drop the text where
                your cursor is.
              </p>
              <input
                className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20"
                placeholder="Click here to set the insert target"
              />
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
