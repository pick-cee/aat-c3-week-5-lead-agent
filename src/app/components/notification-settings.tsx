"use client";

import { useState, type FormEvent } from "react";

import { Icon } from "./icons";
import { Pill } from "./status";

type Settings = { email: string; onSuccess: boolean; onFailure: boolean };

export function NotificationSettings({ initial, deliveryConfigured }: { initial: Settings; deliveryConfigured: boolean }) {
  const [value, setValue] = useState<Settings>(initial);
  const [saved, setSaved] = useState<Settings>(initial);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const data = await response.json() as { error?: string; applied_to_active_runs?: number };
      if (!response.ok) setMessage({ tone: "error", text: data.error ?? "Could not save." });
      else {
        setSaved(value);
        const applied = data.applied_to_active_runs ?? 0;
        setMessage({ tone: "ok", text: `${value.email ? `Saved. New runs will start with ${value.email}` : "Saved. New runs will start with no email"}${applied ? `. ${applied} unfinished run${applied === 1 ? " was" : "s were"} still on the old default and now follow${applied === 1 ? "s" : ""} this one` : ""}. Runs given their own address keep it.` });
      }
    } catch {
      setMessage({ tone: "error", text: "The connection dropped. Your settings were not saved." });
    }
    setBusy(null);
  }

  async function sendTest() {
    setBusy("test");
    setMessage(null);
    try {
      const response = await fetch("/api/settings/notifications/test", { method: "POST" });
      const data = await response.json() as { error?: string; to?: string };
      setMessage(response.ok ? { tone: "ok", text: `Test email sent to ${data.to}. Check your inbox (and spam folder).` } : { tone: "error", text: data.error ?? "The test email could not be sent." });
    } catch {
      setMessage({ tone: "error", text: "The connection dropped before the test email was sent." });
    }
    setBusy(null);
  }

  return <form className="card settings-card" onSubmit={save}>
    <div className="settings-head">
      <span className="settings-icon"><Icon name="mail" size={20} /></span>
      <div><h2>Default email for new runs</h2><p className="muted">Every new run starts with this address, and whoever starts a run can change it for that run. Koya emails it when the research finishes or stops, with a link straight to the run.</p></div>
      {deliveryConfigured ? <Pill tone="ok">Email delivery ready</Pill> : <Pill tone="warn" title="The server needs RESEND_API_KEY and RESEND_FROM_EMAIL">Email delivery not set up</Pill>}
    </div>
    <label className="field">
      <span className="field-label">Default email</span>
      <input type="email" value={value.email} onChange={(event) => setValue({ ...value, email: event.target.value })} placeholder="you@company.com" autoComplete="email" />
      <small className="muted">Leave empty for no default. Addresses are never shown to the research agent.</small>
    </label>
    <fieldset className="toggle-list">
      <legend className="field-label">Send an email when</legend>
      <label className="check-row"><input type="checkbox" checked={value.onSuccess} onChange={(event) => setValue({ ...value, onSuccess: event.target.checked })} /><span><b>Results are ready</b><small>Including runs that finish with fewer leads than the target.</small></span></label>
      <label className="check-row"><input type="checkbox" checked={value.onFailure} onChange={(event) => setValue({ ...value, onFailure: event.target.checked })} /><span><b>A run stops</b><small>A failed step or a spending cap reached, with what you can do next.</small></span></label>
    </fieldset>
    {message && <p className={message.tone === "ok" ? "form-success" : "form-error"} role="status">{message.text}</p>}
    <div className="form-actions">
      <button type="button" className="button button-secondary" disabled={busy !== null || !saved.email || dirty || !deliveryConfigured} onClick={sendTest} title={dirty ? "Save first" : undefined}>{busy === "test" ? "Sending..." : "Send a test email"}</button>
      <button className="button button-primary" disabled={busy !== null || !dirty}>{busy === "save" ? "Saving..." : "Save"}</button>
    </div>
  </form>;
}
