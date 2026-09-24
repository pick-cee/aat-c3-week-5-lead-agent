"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { RunSummary } from "@/lib/runs/dashboard";
import { ago, money, RUNNING_STATUSES } from "@/lib/ui/labels";
import { matchesFilter as matches, RUN_FILTERS, type RunFilter } from "@/lib/ui/run-filters";

import { Icon } from "./icons";
import { DeleteRunButton, RestoreRunButton } from "./run-actions";
import { RunStatusPill } from "./status";

function nextStep(run: RunSummary): string {
  if (run.status === "awaiting_icp_confirmation") return "Approve the criteria";
  if (run.status === "awaiting_budget") return "Decide on more budget";
  if (run.status === "failed" || run.status === "budget_exceeded") return "See what happened";
  if (run.status === "cancelled") return "Stopped by you";
  if (run.needs_review_count > 0 && !RUNNING_STATUSES.has(run.status)) return `Review ${run.needs_review_count} lead${run.needs_review_count === 1 ? "" : "s"}`;
  if (RUNNING_STATUSES.has(run.status)) return run.candidate_count ? `${run.researched_count} of ${run.candidate_count} researched` : "Working";
  return "Open results";
}

export function RunTable({
  runs,
  compact = false,
  initialFilter = "all",
  mode = "active",
}: {
  runs: Array<RunSummary & { deleted_at?: string }>;
  compact?: boolean;
  initialFilter?: RunFilter;
  mode?: "active" | "deleted";
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RunFilter>(initialFilter);
  const counts = useMemo(() => Object.fromEntries(RUN_FILTERS.map((item) => [item.key, runs.filter((run) => matches(run, item.key)).length])), [runs]);
  const visible = useMemo(() => runs
    .filter((run) => mode === "deleted" || matches(run, filter))
    .filter((run) => run.objective.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, compact ? 5 : undefined), [compact, filter, mode, query, runs]);

  return <div className="run-table">
    {!compact && <div className="table-toolbar">
      {mode === "active" && <div className="segmented" role="tablist" aria-label="Filter runs">
        {RUN_FILTERS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}<span className="count">{counts[item.key]}</span></button>)}
      </div>}
      <label className="search-field"><Icon name="search" size={16} /><span className="sr-only">Search runs</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by brief..." /></label>
    </div>}
    {visible.length === 0
      ? <div className="empty-state compact"><b>{query || filter !== "all" ? "No runs match this view" : mode === "deleted" ? "The recycle bin is empty" : "No research yet"}</b><span>{query || filter !== "all" ? "Try another filter or search." : mode === "deleted" ? "Deleted runs land here and can be restored at any time." : "Start a research run to see it here."}</span></div>
      : <div className="table" role="table" aria-label="Research runs">
        <div className="table-head" role="row"><span role="columnheader">Research brief</span><span role="columnheader">Status</span><span role="columnheader">Leads</span><span role="columnheader">Spend</span><span role="columnheader"><span className="sr-only">Actions</span></span></div>
        {visible.map((run) => <div className="table-row" role="row" key={run.id}>
          <div className="cell-brief" role="cell">
            {mode === "deleted" ? <span className="row-link">{run.objective}</span> : <Link href={`/runs/${run.id}`} className="row-link">{run.objective}</Link>}
            <small suppressHydrationWarning>{mode === "deleted" && run.deleted_at ? `Deleted ${ago(run.deleted_at)}` : `Started ${ago(run.created_at)}`}</small>
          </div>
          <div className="cell-status" role="cell"><RunStatusPill status={run.status} />{mode === "active" && <small>{nextStep(run)}</small>}</div>
          <div className="cell-leads" role="cell"><b>{run.qualified_count}<span>/{run.target_leads}</span></b><small>{run.needs_review_count ? `+${run.needs_review_count} to review` : "qualified"}</small></div>
          <div className="cell-spend" role="cell"><b>{money(run.apify_cost_usd)}</b><small>+ {money(run.agent_cost_usd)} AI est.</small></div>
          <div className="cell-actions" role="cell">
            {mode === "deleted"
              ? <RestoreRunButton runId={run.id} />
              : <>{!compact && <DeleteRunButton runId={run.id} />}<Link href={`/runs/${run.id}`} className="button button-secondary button-small">Open</Link>{compact && <DeleteRunButton runId={run.id} label="" />}</>}
          </div>
        </div>)}
      </div>}
  </div>;
}
