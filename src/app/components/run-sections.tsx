import type { DashboardCandidate, DashboardData, DashboardRun } from "@/lib/runs/dashboard";
import { ago, isRetryable, JOURNEY, journeyPosition, money, readableFailure, STAGE_WORDS } from "@/lib/ui/labels";

import { Icon } from "./icons";
import { RerunButton, RetryRunButton } from "./run-actions";
import { Pill } from "./status";

export function Journey({ run }: { run: DashboardRun }) {
  const { index, stopped } = journeyPosition(run.status, run.stage, run.failure_stage);
  const finished = run.status === "complete" || run.status === "short_of_target";
  return <ol className="journey" aria-label="Run progress">
    {JOURNEY.map((step, position) => {
      const state = finished || position < index ? "done" : position === index ? (stopped ? "stopped" : "current") : "todo";
      return <li key={step.key} className={`journey-step is-${state}`} aria-current={state === "current" ? "step" : undefined}>
        <span className="journey-mark">{state === "done" ? <Icon name="check" size={13} /> : state === "stopped" ? "!" : position + 1}</span>
        <span className="journey-label">{step.label}</span>
      </li>;
    })}
  </ol>;
}

export function DraftingCriteria() {
  return <section className="card phase-card">
    <span className="spinner" aria-hidden="true" />
    <div><h2>Turning your brief into criteria</h2><p className="muted">This usually takes 10 to 30 seconds. Nothing is searched or spent on companies until you approve the result.</p></div>
  </section>;
}

function counts(candidates: DashboardCandidate[]) {
  const by = (status: string) => candidates.filter((candidate) => candidate.status === status).length;
  return {
    found: candidates.length,
    researched: candidates.filter((candidate) => !["discovered", "researching"].includes(candidate.status)).length,
    qualified: by("qualified"),
    review: by("needs_review"),
    rejected: by("not_qualified") + by("skipped"),
    failed: by("failed"),
    drafted: candidates.filter((candidate) => candidate.status === "qualified" && candidate.drafts.length >= 4).length,
  };
}

function searchLine(search: DashboardRun["searches"][number]): string {
  const what = [search.industries.join(" + "), search.keywords ? `"${search.keywords}"` : ""].filter(Boolean).join(", ") || "Search";
  const filters = [search.locations.join(", "), search.company_sizes.length ? `${search.company_sizes.join(", ")} employees` : ""].filter(Boolean).join(" · ");
  const found = search.returned_count === null ? "running" : `${search.returned_count} found, ${search.stored_count ?? 0} to research`;
  return `${what}${filters ? ` (${filters})` : ""}: ${found}${typeof search.total_available === "number" ? ` of ${search.total_available.toLocaleString()} matching on LinkedIn` : ""}`;
}

export function Spend({ run, qualified }: { run: DashboardRun; qualified: number }) {
  const apify = Number(run.apify_cost_usd);
  const agent = Number(run.agent_cost_usd);
  return <div className="spend">
    <div><span>Company search</span><b>{run.cost_complete ? "" : "at least "}{money(apify, 3)}</b><small>billed by Apify · cap {money(run.limits.apify_budget_usd ?? 0.5)}</small></div>
    <div><span>AI research</span><b>~{money(agent)}</b><small>estimate, not a bill · cap {money(run.limits.agent_budget_usd ?? 2)}</small></div>
    <div><span>Per qualified lead</span><b>{qualified ? `${money(apify / qualified, 3)} + ~${money(agent / qualified)}` : "-"}</b><small>search + AI estimate</small></div>
  </div>;
}

export function Progress({ data }: { data: DashboardData }) {
  const { run, candidates } = data;
  const c = counts(candidates);
  const researching = candidates.filter((candidate) => candidate.status === "researching").map((candidate) => candidate.company_name);
  const paused = run.status === "awaiting_budget";
  const headline = paused
    ? "Paused until you decide on budget"
    : run.status === "discovering"
      ? (run.refills_used ? `Searching again (search ${run.refills_used + 1}) to find more companies` : "Searching LinkedIn company records with your filters")
      : run.status === "researching"
        ? (researching.length > 1 ? `Researching ${researching.length} companies at once` : `Researching ${researching[0] ?? "the next company"}`)
        : `Writing outreach drafts: ${c.drafted} of ${c.qualified} leads done`;
  const target = run.target_leads;
  return <section className="card progress-card" aria-live="polite">
    <div className="progress-head">
      {paused ? <span className="outcome-icon"><Icon name="clock" size={18} /></span> : <span className="spinner" aria-hidden="true" />}
      <div><h2>{headline}</h2><p className="muted">{paused ? "Everything found so far is saved. Nothing more is spent until you choose." : researching.length > 1 ? researching.join(" · ") : "Each step finishes real work on several companies at once. Leave this tab open for the fastest progress; you can also leave and come back."}</p></div>
    </div>
    <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(c.qualified, target)} aria-label="Qualified leads toward the target">
      <span style={{ width: `${Math.min(100, (c.qualified / target) * 100)}%` }} />
    </div>
    <div className="tally">
      <div><b>{c.qualified}<span>/{target}</span></b><small>qualified</small></div>
      <div><b>{c.review}</b><small>need your review</small></div>
      <div><b>{c.researched}<span>/{c.found}</span></b><small>companies checked</small></div>
      <div><b>{c.rejected}</b><small>rejected</small></div>
    </div>
    {run.searches.length > 0 && <div className="searches"><h3>Searches</h3><ul>{run.searches.map((search) => <li key={search.key}><Icon name="search" size={14} />{searchLine(search)}</li>)}</ul></div>}
    <Spend run={run} qualified={c.qualified} />
  </section>;
}

function topFailingFilter(candidates: DashboardCandidate[]): { criterion: string; count: number } | null {
  const tally = new Map<string, number>();
  for (const candidate of candidates) {
    for (const result of candidate.qualification?.hard_filter_results ?? []) {
      if (result.verdict === "fail") tally.set(result.criterion, (tally.get(result.criterion) ?? 0) + 1);
    }
  }
  const top = [...tally.entries()].sort((left, right) => right[1] - left[1])[0];
  return top ? { criterion: top[0], count: top[1] } : null;
}

export function Outcome({ data }: { data: DashboardData }) {
  const { run, candidates } = data;
  const c = counts(candidates);
  const complete = run.status === "complete";
  const failing = topFailingFilter(candidates);
  return <section className={`card outcome ${complete ? "outcome-ok" : "outcome-short"}`}>
    <div className="outcome-head">
      <span className="outcome-icon"><Icon name={complete ? "check" : "info"} size={20} /></span>
      <div>
        <h2>{complete ? `${c.qualified} qualified leads are ready` : `${c.qualified} qualified lead${c.qualified === 1 ? "" : "s"}, short of ${run.target_leads}`}</h2>
        <p>{complete
          ? "Every lead has proven must-haves, cited evidence and outreach drafts. Review the drafts, then export."
          : `Koya researched ${c.researched} compan${c.researched === 1 ? "y" : "ies"} across ${run.searches.length} search${run.searches.length === 1 ? "" : "es"} and would not loosen your must-haves to reach the target.`}</p>
      </div>
    </div>
    {!complete && <div className="next-steps">
      <h3>What would get you more leads</h3>
      <ul>
        {c.review > 0 && <li><b>Review the {c.review} lead{c.review === 1 ? "" : "s"} marked for you.</b> Each is one unproven must-have away from qualifying; your judgement can settle it in minutes.</li>}
        {failing && <li><b>{failing.count} rejection{failing.count === 1 ? "" : "s"} failed &quot;{failing.criterion}&quot;.</b> If that is not truly required, run again and make it a nice-to-have.</li>}
        <li><b>Run again with these criteria.</b> The new run searches fresh companies and skips the {c.qualified + c.rejected} already decided, so you never pay to reject them twice.</li>
      </ul>
    </div>}
    <Spend run={run} qualified={c.qualified} />
    <div className="outcome-actions">
      <a className="button button-primary" href={`/api/runs/${run.id}/export?kind=qualified`}><Icon name="download" size={16} />Qualified leads (CSV)</a>
      <a className="button button-secondary" href={`/api/runs/${run.id}/export?kind=sample`}><Icon name="download" size={16} />Outreach pack (Markdown)</a>
      <a className="button button-ghost" href={`/api/runs/${run.id}/export?kind=rejected`}><Icon name="download" size={16} />Rejected and needs review (CSV)</a>
      {run.refined_icp && <RerunButton runId={run.id} />}
    </div>
  </section>;
}

export function Stopped({ run }: { run: DashboardRun }) {
  const budget = run.status === "budget_exceeded";
  const cancelled = run.status === "cancelled";
  const retryable = isRetryable(run.status, run.failure_reason);
  return <section className={`card stopped ${cancelled ? "stopped-neutral" : ""}`}>
    <div className="outcome-head">
      <span className="outcome-icon"><Icon name={cancelled ? "stop" : "alert"} size={20} /></span>
      <div>
        <h2>{cancelled ? "You stopped this run" : budget ? "Stopped at the spending cap" : `Stopped while ${STAGE_WORDS[run.failure_stage ?? run.stage] ?? "working"}`}</h2>
        <p>{cancelled ? "No further spend happens. Everything found before you stopped it is kept below." : readableFailure(run.failure_reason)}</p>
      </div>
    </div>
    {!cancelled && <p className="muted small">Everything found before this point is saved below.{budget ? " Caps are never raised automatically; a new run starts with fresh caps." : ""}</p>}
    <div className="outcome-actions">
      {retryable && <RetryRunButton runId={run.id} />}
      {run.refined_icp && run.icp_confirmed_at && <RerunButton runId={run.id} primary={!retryable} />}
    </div>
    {!retryable && run.status === "failed" && <p className="muted small">Retry is not offered because it would fail the same way.</p>}
    {run.failure_reason && <details className="technical"><summary>Technical detail for whoever runs Koya</summary><pre>{JSON.stringify({ stage: run.failure_stage, reason: run.failure_reason, detail: run.failure_detail }, null, 2)}</pre></details>}
  </section>;
}

export function CriteriaSummary({ run }: { run: DashboardRun }) {
  const icp = run.refined_icp ?? {};
  const list = (key: string) => (Array.isArray(icp[key]) ? (icp[key] as unknown[]).map(String) : []);
  const text = (key: string) => (typeof icp[key] === "string" ? String(icp[key]) : "");
  return <details className="card disclosure">
    <summary><span><Icon name="list" size={16} />Criteria this run used</span><small className="muted">{run.icp_confirmed_at ? `Approved ${ago(run.icp_confirmed_at)}` : "Not approved"}</small></summary>
    <div className="criteria-summary">
      <p><b>{text("target_company_type")}</b> in <b>{list("geography").join(", ") || "any location"}</b>, <b>{text("headcount_range")}</b>. Outreach for <b>{text("buyer_persona")}</b> about {text("business_problem")}</p>
      <div className="criteria-summary-grid">
        <div><h4>Must have</h4><ul>{list("hard_filters").map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h4>Nice to have</h4><ul>{list("soft_preferences").map((item) => <li key={item} className={run.soft_preferences_dropped.includes(item) ? "dropped" : ""}>{item}{run.soft_preferences_dropped.includes(item) && <Pill tone="neutral">dropped to widen the search</Pill>}</li>)}</ul></div>
        <div><h4>Reject if</h4><ul>{list("disqualifiers").map((item) => <li key={item}>{item}</li>)}</ul></div>
      </div>
    </div>
  </details>;
}

const TOOL_LABELS: Record<string, string> = {
  search_companies: "Company search (Apify)",
  scrape_site: "Read website (Firecrawl)",
  store_excerpts: "Store evidence",
  record_qualification: "Record decision",
  record_outreach: "Save outreach drafts",
  get_run_context: "Read run settings",
};

export function Activity({ data }: { data: DashboardData }) {
  const refused = data.toolCalls.filter((call) => call.status === "refused").length;
  const latest = data.events[0];
  return <details className="card disclosure">
    <summary><span><Icon name="clock" size={16} />Activity</span><small className="muted">{latest ? `${latest.message.replace(/\bICP\b/g, "criteria")} · ${ago(latest.created_at)}` : "No activity yet"}</small></summary>
    <ol className="timeline">{data.events.map((event) => <li key={event.id}>
      <span className="timeline-time" title={new Date(event.created_at).toLocaleString("en-GB")}>{new Date(event.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
      <span>{event.message.replace(/\bICP\b/g, "criteria")}</span>
    </li>)}</ol>
    <details className="audit">
      <summary>Tool-call audit: {data.toolCalls.length} call{data.toolCalls.length === 1 ? "" : "s"}{refused ? `, ${refused} refused by a limit` : ""}</summary>
      <p className="muted small">Every tool the research agent used, including calls refused because a limit was reached. Refusals are the proof the limits are real.</p>
      <div className="audit-table">{data.toolCalls.map((call) => {
        const short = call.tool_name.replace("mcp__lead_agent__", "");
        return <div className="audit-row" key={call.id}>
          <Pill tone={call.status === "ok" ? "ok" : call.status === "refused" ? "warn" : "danger"}>{call.status}</Pill>
          <span className="audit-tool">{TOOL_LABELS[short] ?? short}</span>
          <span className="audit-purpose">{call.purpose}{call.error ? <em> · {call.error}</em> : null}</span>
          <span className="audit-cost">{Number(call.cost_usd) ? money(call.cost_usd, 4) : ""}</span>
        </div>;
      })}</div>
    </details>
  </details>;
}
