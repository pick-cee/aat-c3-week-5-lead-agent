"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { EXTRA_SEARCH_APIFY_USD } from "@/lib/constants";
import type { BudgetRequest } from "@/lib/runs/run-store";
import { money } from "@/lib/ui/labels";

import { Icon } from "./icons";

/**
 * A paused run asks, it does not stop. The founder sees what ran out, what was
 * found so far, and exactly what each option allows, then decides. Only this
 * decision raises a cap; the agent never can.
 */
export function BudgetRequestPanel({ runId, request }: { runId: string; request: BudgetRequest }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [choice, setChoice] = useState(0);
  const [busy, setBusy] = useState<"raise" | "finish" | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const option = request.options[choice] ?? request.options[0];

  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function act(kind: "raise" | "finish") {
    setBusy(kind);
    setError("");
    try {
      const response = await fetch(`/api/runs/${runId}/${kind === "raise" ? "budget" : "finish"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: kind === "raise" ? JSON.stringify({ searches: option.searches, agentUsd: option.agent_usd }) : undefined,
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(data.error ?? "That did not work. Refresh and try again."); setBusy(null); return; }
      router.refresh();
    } catch {
      setError("The connection dropped. Refresh to see whether the change was saved.");
      setBusy(null);
    }
  }

  const banner = <section className="card budget-banner" aria-labelledby="budget-banner-title">
    <span className="outcome-icon"><Icon name="alert" size={20} /></span>
    <div>
      <h2 id="budget-banner-title">Paused: Koya needs more budget to keep going</h2>
      <p className="muted">{request.reason} Nothing more is spent until you decide.</p>
    </div>
    <button type="button" className="button button-primary" onClick={() => setOpen(true)}>Decide</button>
  </section>;

  if (!open) return banner;

  return <>
    {banner}
    <div className="modal-backdrop" onClick={() => setOpen(false)} />
    <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="budget-title">
      <button type="button" className="icon-button modal-close" aria-label="Close" onClick={() => setOpen(false)}><Icon name="close" size={16} /></button>
      <p className="eyebrow">Paused, not stopped</p>
      <h2 id="budget-title">Keep going with more budget?</h2>
      <p>{request.reason}</p>
      <dl className="budget-facts">
        <div><dt>Qualified so far</dt><dd>{request.qualified} of {request.target}</dd></div>
        <div><dt>AI research used</dt><dd>~{money(request.agent_used_usd)} of {money(request.agent_budget_usd)}</dd></div>
        <div><dt>Company search used</dt><dd>{money(request.apify_used_usd, 3)} of {money(request.apify_budget_usd)}</dd></div>
        <div><dt>Searches used</dt><dd>{request.searches_used} of {request.searches_allowed}</dd></div>
      </dl>
      <fieldset className="budget-options">
        <legend className="field-label">Add</legend>
        {request.options.map((item, index) => <label key={item.label} className={`budget-option ${index === choice ? "is-selected" : ""}`}>
          <input type="radio" name="budget-option" checked={index === choice} onChange={() => setChoice(index)} />
          <span>
            <b>{item.label}</b>
            <small>{[
              item.searches ? `${item.searches} more search${item.searches === 1 ? "" : "es"}, up to ${money(item.searches * EXTRA_SEARCH_APIFY_USD)} of company search (real Apify spend)` : "",
              item.agent_usd ? `up to ${money(item.agent_usd)} more AI research (an estimate, not a bill)` : "",
            ].filter(Boolean).join(" and ")}</small>
          </span>
        </label>)}
      </fieldset>
      <p className="muted small">These are ceilings, not charges: Koya stops as soon as it has {request.target} qualified leads.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="button button-ghost" disabled={busy !== null} onClick={() => act("finish")}>{busy === "finish" ? "Finishing..." : `Finish with ${request.qualified} lead${request.qualified === 1 ? "" : "s"}`}</button>
        <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => act("raise")}>{busy === "raise" ? "Adding..." : "Add budget and keep going"}<Icon name="arrow" size={16} /></button>
      </div>
    </div>
  </>;
}
