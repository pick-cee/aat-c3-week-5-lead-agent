"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { Claim, DashboardCandidate, HardFilterVerdict } from "@/lib/runs/dashboard";
import { isDiscoverySource, money, readableCandidateReason } from "@/lib/ui/labels";

import { Icon } from "./icons";
import { CandidateStatusPill, FetchStatusPill, Pill } from "./status";

type Tab = "review" | "qualified" | "rejected" | "filtered" | "failed";

function Evidence({ ids, candidate }: { ids: string[]; candidate: DashboardCandidate }) {
  const cited = candidate.excerpts.filter((excerpt) => ids.includes(excerpt.id));
  if (!cited.length) return <p className="muted small">No stored excerpt was cited.</p>;
  return <div className="evidence">{cited.map((excerpt) => {
    const source = candidate.sources.find((item) => item.id === excerpt.source_id);
    return <blockquote key={excerpt.id}>
      <span className="excerpt-label">E{excerpt.ordinal}</span>
      <p>{excerpt.text}</p>
      {source && (isDiscoverySource(source.url)
        ? <small className="muted">From the LinkedIn company record (via Apify)</small>
        : <a href={source.url} target="_blank" rel="noreferrer">{source.url.replace(/^https?:\/\//, "")} <Icon name="external" size={12} /></a>)}
    </blockquote>;
  })}</div>;
}

function ClaimList({ title, claims, candidate, tone }: { title: string; claims: Claim[]; candidate: DashboardCandidate; tone: "fit" | "concern" }) {
  if (!claims.length) return null;
  return <div className={`claims claims-${tone}`}>
    <h4>{title}</h4>
    {claims.map((claim, index) => <details className="claim" key={`${claim.text}-${index}`}>
      <summary><span>{claim.text}</span><span className="claim-cite">{(claim.excerpt_labels ?? []).join(" ")} <Icon name="arrow" size={12} /></span></summary>
      <Evidence ids={claim.excerpt_ids ?? []} candidate={candidate} />
    </details>)}
  </div>;
}

function HardFilters({ results, candidate }: { results: HardFilterVerdict[]; candidate: DashboardCandidate }) {
  if (!results.length) return null;
  return <div className="must-haves">
    <h4>Must-haves</h4>
    {results.map((result, index) => {
      const proven = (result.excerpt_labels ?? []).length > 0;
      const verdict = result.verdict === "pass" && proven ? "pass" : result.verdict === "fail" && proven ? "fail" : "unknown";
      return <details className={`must-have must-${verdict}`} key={`${result.criterion}-${index}`}>
        <summary>
          <span className="verdict-icon" aria-hidden="true">{verdict === "pass" ? <Icon name="check" size={13} /> : verdict === "fail" ? <Icon name="close" size={13} /> : "?"}</span>
          <span>{result.criterion}</span>
          <span className="sr-only">{verdict === "pass" ? "met" : verdict === "fail" ? "not met" : "not proven"}</span>
          <small>{verdict === "unknown" ? "Not proven" : (result.excerpt_labels ?? []).join(" ")}</small>
        </summary>
        <Evidence ids={result.excerpt_ids ?? []} candidate={candidate} />
      </details>;
    })}
  </div>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="button button-ghost button-small" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1_800); } catch { setCopied(false); }
  }}><Icon name={copied ? "check" : "copy"} size={14} />{copied ? "Copied" : "Copy"}</button>;
}

function OutreachPack({ candidate }: { candidate: DashboardCandidate }) {
  const drafts = [...candidate.drafts].sort((left, right) => (left.channel === right.channel ? left.step - right.step : left.channel === "email" ? -1 : 1));
  const [active, setActive] = useState(0);
  if (!drafts.length) return null;
  const draft = drafts[Math.min(active, drafts.length - 1)];
  const full = `${draft.subject ? `Subject: ${draft.subject}\n\n` : ""}${draft.body}`;
  return <div className="outreach">
    <div className="outreach-head"><h4>Outreach drafts</h4><small className="muted">Review before use. Koya never sends anything.</small></div>
    <div className="segmented small" role="tablist" aria-label={`Drafts for ${candidate.company_name}`}>
      {drafts.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={index === active} onClick={() => setActive(index)}>{item.channel === "linkedin" ? "LinkedIn" : `Email ${item.step}`}</button>)}
    </div>
    <div className="draft">
      {draft.subject && <p className="draft-subject"><span>Subject</span>{draft.subject}</p>}
      <p className="draft-body">{draft.body}</p>
      <div className="draft-foot"><small className="muted">Personalised from: {draft.personalization_note}</small><CopyButton text={full} /></div>
      <details className="draft-evidence"><summary>Evidence this draft rests on</summary><Evidence ids={draft.cited_excerpt_ids} candidate={candidate} /></details>
    </div>
  </div>;
}

function Facts({ candidate }: { candidate: DashboardCandidate }) {
  const payload = candidate.discovery_payload ?? {};
  const facts = [payload.location, payload.headcount, payload.industry].filter((value): value is string => typeof value === "string" && value.length > 0);
  return <span className="lead-facts">{facts.map((fact) => <span key={fact}>{fact}</span>)}</span>;
}

/**
 * The founder settles a lead the checks could not. Approving counts it toward
 * the target and gets outreach drafted; the decision is stored as the
 * founder's, beside the reasons the checks gave.
 */
function ReviewDecision({ runId, candidate, approveAddsUsd }: { runId: string; candidate: DashboardCandidate; approveAddsUsd: number }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError("");
    try {
      const response = await fetch(`/api/runs/${runId}/candidates/${candidate.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(data.error ?? "That did not work."); setBusy(null); return; }
      router.refresh();
    } catch {
      setError("The connection dropped. Refresh to see whether your decision was saved.");
      setBusy(null);
    }
  }
  return <div className="review-decision">
    <h4>Your call</h4>
    <p className="muted small">Checked the evidence below? Approving counts {candidate.company_name} toward your target and writes its outreach drafts{approveAddsUsd > 0 ? `, adding up to ${money(approveAddsUsd)} of AI budget for them (an estimate, not a bill)` : ""}. Rejecting keeps it in the rejected list with your reason.</p>
    <label className="sr-only" htmlFor={`note-${candidate.id}`}>Why (optional)</label>
    <textarea id={`note-${candidate.id}`} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why? Optional, kept with the lead. For example: I know they sell to businesses." />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="review-actions">
      <button type="button" className="button button-primary button-small" disabled={busy !== null} onClick={() => decide("approve")}><Icon name="check" size={14} />{busy === "approve" ? "Approving..." : "Approve and write outreach"}</button>
      <button type="button" className="button button-secondary button-small" disabled={busy !== null} onClick={() => decide("reject")}><Icon name="close" size={14} />{busy === "reject" ? "Rejecting..." : "Reject"}</button>
    </div>
  </div>;
}

function mainReason(candidate: DashboardCandidate): string {
  const q = candidate.qualification;
  if (!q) return readableCandidateReason(candidate.skip_reason) ?? "No decision recorded";
  const failed = q.hard_filter_results.find((result) => result.verdict === "fail");
  if (failed) return `Did not meet: ${failed.criterion}`;
  return q.concerns[0]?.text ?? q.source_summary;
}

function LeadCard({ runId, candidate, open, approveAddsUsd }: { runId: string; candidate: DashboardCandidate; open: boolean; approveAddsUsd: number }) {
  const q = candidate.qualification;
  const website = `https://${candidate.domain}`;
  const downgrades = q?.checks?.downgrades ?? [];
  const flagged = candidate.sources.some((source) => source.injection_suspected);
  const human = q?.checks?.human_decision;
  return <details className={`lead-card lead-${candidate.status}`} open={open}>
    <summary className="lead-summary">
      <span className="lead-monogram" aria-hidden="true">{candidate.company_name.slice(0, 1).toUpperCase()}</span>
      <span className="lead-title"><b>{candidate.company_name}</b><Facts candidate={candidate} />{(candidate.status === "not_qualified" || candidate.status === "failed" || candidate.status === "skipped") && <small className="lead-reason">{mainReason(candidate)}</small>}</span>
      <span className="lead-side">
        {q && <span className="confidence" title="How sure the research is, from 0 to 100"><b>{Math.round(Number(q.confidence) * 100)}</b><small>confidence</small></span>}
        {human ? <Pill tone={human.decision === "approve" ? "ok" : "neutral"} title={human.note || undefined}>{human.decision === "approve" ? "Approved by you" : "Rejected by you"}</Pill> : <CandidateStatusPill status={candidate.status} />}
      </span>
    </summary>
    <div className="lead-body">
      <p className="lead-links"><a href={website} target="_blank" rel="noreferrer">{candidate.domain} <Icon name="external" size={12} /></a>{flagged && <Pill tone="warn" title="A page contained instruction-like text. It was kept as data and never followed.">Suspicious page text flagged</Pill>}</p>
      {candidate.status === "needs_review" && <div className="needs-you">
        <h4><Icon name="alert" size={15} />Why this needs you</h4>
        <ul>{(downgrades.length ? downgrades : ["The research could not settle every must-have from evidence."]).map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <ReviewDecision runId={runId} candidate={candidate} approveAddsUsd={approveAddsUsd} />
      </div>}
      {human && <p className="notice notice-info"><Icon name="info" size={15} />{human.decision === "approve" ? "You approved this lead after review" : "You rejected this lead after review"}{human.note ? `: "${human.note}"` : "."} The checks' original reasons are kept below.</p>}
      {q?.why_now && <p className="why-now"><span>Why now</span>{q.why_now}</p>}
      {q && <p className="lead-summary-text">{q.source_summary}</p>}
      {q && <HardFilters results={q.hard_filter_results} candidate={candidate} />}
      {q && <ClaimList title="Why it fits" claims={q.fit_reasons} candidate={candidate} tone="fit" />}
      {q && <ClaimList title="Concerns" claims={q.concerns} candidate={candidate} tone="concern" />}
      <OutreachPack candidate={candidate} />
      {candidate.skip_reason && candidate.status !== "qualified" && <p className={`notice ${candidate.status === "skipped" ? "notice-info" : "notice-danger"}`}><Icon name={candidate.status === "skipped" ? "info" : "alert"} size={15} />{readableCandidateReason(candidate.skip_reason)}</p>}
      <details className="sources">
        <summary>Sources ({candidate.sources.length})</summary>
        <ul>{candidate.sources.map((source) => <li key={source.id}>
          <FetchStatusPill status={source.fetch_status} />
          {isDiscoverySource(source.url) ? <span>{candidate.discovery_payload.discovery_source === "linkedin_job_ads" ? "LinkedIn job ads and company record (via Apify)" : "LinkedIn company record (via Apify)"}</span> : <a href={source.url} target="_blank" rel="noreferrer">{source.url.replace(/^https?:\/\//, "")}</a>}
          {source.fetch_error && <small className="muted">{source.fetch_error}</small>}
        </li>)}</ul>
      </details>
    </div>
  </details>;
}

export function LeadBoard({ runId, candidates, approveAddsUsd = 0 }: { runId: string; candidates: DashboardCandidate[]; approveAddsUsd?: number }) {
  const groups = useMemo(() => ({
    review: candidates.filter((candidate) => candidate.status === "needs_review"),
    qualified: [...candidates.filter((candidate) => candidate.status === "qualified")].sort((left, right) => Number(right.qualification?.confidence ?? 0) - Number(left.qualification?.confidence ?? 0)),
    rejected: candidates.filter((candidate) => candidate.status === "not_qualified"),
    filtered: candidates.filter((candidate) => candidate.status === "skipped"),
    failed: candidates.filter((candidate) => candidate.status === "failed"),
  }), [candidates]);
  const initial: Tab = groups.review.length ? "review" : groups.qualified.length ? "qualified" : groups.rejected.length ? "rejected" : groups.filtered.length ? "filtered" : "failed";
  const [tab, setTab] = useState<Tab>(initial);
  const tabs: Array<{ key: Tab; label: string; hint: string }> = [
    { key: "review", label: "Needs your review", hint: "A must-have could not be proven. Five minutes of your judgement is worth most here." },
    { key: "qualified", label: "Qualified", hint: "Every must-have proven from cited evidence, with outreach drafts." },
    { key: "rejected", label: "Rejected", hint: "Researched and ruled out, with the evidence. Kept on purpose: a future run skips these instead of paying to reject them again." },
    { key: "filtered", label: "Filtered out", hint: "LinkedIn returned these for the search, but their own record already shows they miss your criteria: headquarters outside your locations, or far more staff than your limit. They were never researched; each cost only its $0.004 search result." },
    { key: "failed", label: "Couldn't research", hint: "The website could not be read after several tries. The run carried on without them." },
  ];
  const visible = groups[tab];
  const active = tabs.find((item) => item.key === tab)!;

  return <section className="lead-board" aria-labelledby="leads-title">
    <div className="segmented" role="tablist" aria-label="Lead groups">
      {tabs.filter((item) => (item.key !== "failed" && item.key !== "filtered") || groups[item.key].length).map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={item.key === "review" && groups.review.length ? "has-attention" : ""} onClick={() => setTab(item.key)}>{item.label}<span className="count">{groups[item.key].length}</span></button>)}
    </div>
    <p className="muted small tab-hint" id="leads-title">{active.hint}</p>
    {visible.length === 0
      ? <div className="empty-state compact"><b>Nothing here{tab === "qualified" ? " yet" : ""}</b><span>{tab === "review" ? "No lead needs your judgement." : tab === "qualified" ? "Qualified leads appear here as research finishes each company." : "Companies land here as research rules them out."}</span></div>
      : <div className="lead-list">{visible.map((candidate, index) => <LeadCard key={candidate.id} runId={runId} candidate={candidate} approveAddsUsd={approveAddsUsd} open={(tab === "review" || tab === "qualified") && index === 0} />)}</div>}
  </section>;
}
