import Link from "next/link";

import { Icon } from "@/app/components/icons";
import { RunTable } from "@/app/components/run-table";
import { needsYou } from "@/lib/ui/run-filters";
import { RunStatusPill } from "@/app/components/status";
import { listRunSummaries, monthSpend } from "@/lib/runs/dashboard";
import { RunStore } from "@/lib/runs/run-store";
import { money, RUNNING_STATUSES } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

function actionFor(status: string, reviewCount: number): string {
  if (status === "awaiting_icp_confirmation") return "Approve criteria";
  if (status === "awaiting_budget") return "Decide on budget";
  if (status === "failed" || status === "budget_exceeded") return "See what happened";
  return `Review ${reviewCount} lead${reviewCount === 1 ? "" : "s"}`;
}

export default async function OverviewPage() {
  const [runs, spend, settings] = await Promise.all([listRunSummaries(), monthSpend(), new RunStore().getWorkspaceSettings()]);
  const attention = runs.filter(needsYou);
  const running = runs.filter((run) => RUNNING_STATUSES.has(run.status));
  const qualified = runs.reduce((sum, run) => sum + run.qualified_count, 0);
  const awaitingApproval = runs.filter((run) => run.status === "awaiting_icp_confirmation").length;

  if (runs.length === 0) {
    return <div className="page">
      <header className="page-head"><div><p className="eyebrow">Overview</p><h1>Find the companies worth your time.</h1><p className="muted">Describe who you want to reach. Koya drafts the criteria, you approve them, and it returns qualified leads with the evidence and outreach drafts attached.</p></div></header>
      <section className="card empty-hero">
        <ol className="how-steps">
          <li><span>1</span><b>Describe the target</b><small>Plain English, like briefing a researcher.</small></li>
          <li><span>2</span><b>Approve the criteria</b><small>Nothing is spent on company search before this.</small></li>
          <li><span>3</span><b>Review ten leads</b><small>Each with cited evidence and three drafted emails.</small></li>
        </ol>
        <Link href="/runs/new" className="button button-primary button-large">Start your first research <Icon name="arrow" size={17} /></Link>
      </section>
    </div>;
  }

  return <div className="page">
    <header className="page-head"><div><p className="eyebrow">Overview</p><h1>Your lead research</h1><p className="muted">What needs you, what is running and what is ready.</p></div></header>

    <section className={`card attention ${attention.length ? "" : "is-clear"}`} aria-labelledby="attention-title">
      <div className="section-head"><div><h2 id="attention-title">{attention.length ? `${attention.length} thing${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} you` : "Nothing needs you right now"}</h2>
        <p className="muted">{attention.length ? "Approvals, stopped runs and leads waiting for your judgement." : running.length ? `${running.length} run${running.length === 1 ? " is" : "s are"} working. You will be notified when ${running.length === 1 ? "it finishes" : "they finish"}.` : "Start a new research run whenever you are ready."}</p></div></div>
      {attention.length > 0 && <ul className="attention-list">{attention.slice(0, 5).map((run) => <li key={run.id}>
        <RunStatusPill status={run.status} />
        <Link href={`/runs/${run.id}`} className="attention-brief">{run.objective}</Link>
        <Link href={`/runs/${run.id}`} className="button button-secondary button-small">{actionFor(run.status, run.needs_review_count)}<Icon name="arrow" size={14} /></Link>
      </li>)}</ul>}
    </section>

    <section className="tiles" aria-label="Summary">
      <Link href="/history?filter=needs-you" className="tile"><span>Waiting for approval</span><b>{awaitingApproval}</b><small>criteria to check before spend</small></Link>
      <Link href="/history?filter=running" className="tile"><span>Running now</span><b>{running.length}</b><small>{running.length ? "researching in the background" : "nothing is spending"}</small></Link>
      <Link href="/history?filter=ready" className="tile"><span>Qualified leads</span><b>{qualified}</b><small>across {runs.length} run{runs.length === 1 ? "" : "s"}</small></Link>
      <div className="tile"><span>Spend this month</span><b>{spend.apifyComplete ? "" : "at least "}{money(spend.apify)}</b><small>company search billed · plus ~{money(spend.agent)} AI estimate</small></div>
    </section>

    <section className="card" aria-labelledby="recent-title">
      <div className="section-head"><div><h2 id="recent-title">Recent research</h2></div><Link href="/history" className="text-link">All research runs <Icon name="arrow" size={14} /></Link></div>
      <RunTable runs={runs} compact />
    </section>

    {!settings.notification_email && <p className="notice notice-info"><Icon name="bell" size={16} />Get an email when research finishes or stops. <Link href="/settings">Add your address</Link>.</p>}
  </div>;
}
