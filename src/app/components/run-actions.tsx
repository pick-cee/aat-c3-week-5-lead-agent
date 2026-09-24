"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "./icons";

async function post(url: string, method = "POST", body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, data };
  } catch {
    return { ok: false, data: { error: "The connection dropped. Refresh to see the saved state before trying again." } };
  }
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(url: string, options: { method?: string; body?: unknown; onDone?: (data: Record<string, unknown>) => void } = {}) {
    setBusy(true);
    setError("");
    const result = await post(url, options.method, options.body);
    if (!result.ok) {
      setError(String(result.data.error ?? "That did not work. Try again."));
      setBusy(false);
      return;
    }
    if (options.onDone) options.onDone(result.data);
    else {
      router.refresh();
      setBusy(false);
    }
  }
  return { busy, error, run, router };
}

export function DeleteRunButton({ runId, label = "Delete", redirectTo }: { runId: string; label?: string; redirectTo?: string }) {
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run, router } = useAction();
  if (!confirming) {
    return <span className="action-wrap"><button type="button" className="button button-ghost button-small" aria-label={label || "Delete run"} title={label ? undefined : "Move to the recycle bin"} onClick={() => setConfirming(true)}><Icon name="trash" size={15} />{label}</button>{error && <span className="action-error" role="alert">{error}</span>}</span>;
  }
  return <span className="confirm-inline" role="group" aria-label="Confirm delete">
    <span>Move to the recycle bin?</span>
    <button type="button" className="button button-danger button-small" disabled={busy} onClick={() => run(`/api/runs/${runId}`, { method: "DELETE", onDone: redirectTo ? () => router.push(redirectTo) : undefined })}>{busy ? "Moving..." : "Yes, delete"}</button>
    <button type="button" className="button button-ghost button-small" disabled={busy} onClick={() => setConfirming(false)}>Keep</button>
    {error && <span className="action-error" role="alert">{error}</span>}
  </span>;
}

export function RestoreRunButton({ runId }: { runId: string }) {
  const { busy, error, run } = useAction();
  return <span className="action-wrap"><button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => run(`/api/runs/${runId}/restore`)}><Icon name="undo" size={15} />{busy ? "Restoring..." : "Restore"}</button>{error && <span className="action-error" role="alert">{error}</span>}</span>;
}

export function CancelRunButton({ runId }: { runId: string }) {
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();
  if (!confirming) return <button type="button" className="button button-ghost button-small" onClick={() => setConfirming(true)}><Icon name="stop" size={14} />Stop run</button>;
  return <span className="confirm-inline" role="group" aria-label="Confirm stop">
    <span>Stop spending on this run? What it found stays.</span>
    <button type="button" className="button button-danger button-small" disabled={busy} onClick={() => run(`/api/runs/${runId}/cancel`)}>{busy ? "Stopping..." : "Yes, stop"}</button>
    <button type="button" className="button button-ghost button-small" disabled={busy} onClick={() => setConfirming(false)}>Keep going</button>
    {error && <span className="action-error" role="alert">{error}</span>}
  </span>;
}

export function RetryRunButton({ runId }: { runId: string }) {
  const { busy, error, run } = useAction();
  return <span className="action-wrap"><button type="button" className="button button-primary" disabled={busy} onClick={() => run(`/api/runs/${runId}/retry`)}><Icon name="refresh" size={16} />{busy ? "Retrying..." : "Retry the step that stopped"}</button>{error && <span className="action-error" role="alert">{error}</span>}</span>;
}

export function RerunButton({ runId, primary = false, label = "Run again with these criteria" }: { runId: string; primary?: boolean; label?: string }) {
  const token = useRef<string>("");
  const { busy, error, run, router } = useAction();
  return <span className="action-wrap"><button type="button" className={`button ${primary ? "button-primary" : "button-secondary"}`} disabled={busy} onClick={() => {
    token.current ||= crypto.randomUUID();
    run(`/api/runs/${runId}/rerun`, { body: { submitToken: token.current }, onDone: (data) => router.push(`/runs/${String(data.id)}`) });
  }}><Icon name="repeat" size={16} />{busy ? "Preparing..." : label}</button>{error && <span className="action-error" role="alert">{error}</span>}</span>;
}
