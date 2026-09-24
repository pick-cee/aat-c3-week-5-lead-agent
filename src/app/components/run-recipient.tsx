"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "./icons";

export function RunRecipient({ runId, email }: { runId: string; email: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/runs/${runId}/notifications`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value.trim() }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(data.error ?? "Could not save the address."); setBusy(false); return; }
      setEditing(false);
      setBusy(false);
      router.refresh();
    } catch {
      setError("The connection dropped. The address was not saved.");
      setBusy(false);
    }
  }

  if (!editing) {
    return <span className="recipient">
      <Icon name="bell" size={14} />
      {email ? <>Updates go to <b>{email}</b></> : "No email updates for this run"}
      <button type="button" className="link-button" onClick={() => { setValue(email ?? ""); setEditing(true); }}>{email ? "Change" : "Add an email"}</button>
    </span>;
  }
  return <form className="recipient-form" onSubmit={save}>
    <label className="sr-only" htmlFor={`recipient-${runId}`}>Email updates for this run to</label>
    <input id={`recipient-${runId}`} type="email" value={value} onChange={(event) => setValue(event.target.value)} placeholder="you@company.com" autoFocus autoComplete="email" />
    <button className="button button-primary button-small" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
    <button type="button" className="button button-ghost button-small" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Cancel</button>
    <small className="muted">Only this run. Leave empty to turn its emails off.</small>
    {error && <small className="form-hint-error" role="alert">{error}</small>}
  </form>;
}
