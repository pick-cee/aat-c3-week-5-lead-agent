import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/app/components/auto-refresh";
import { BudgetRequestPanel } from "@/app/components/budget-request";
import { IcpCheckpoint } from "@/app/components/icp-checkpoint";
import { Icon } from "@/app/components/icons";
import { LeadBoard } from "@/app/components/lead-board";
import { CancelRunButton, DeleteRunButton } from "@/app/components/run-actions";
import { RunRecipient } from "@/app/components/run-recipient";
import { Activity, CriteriaSummary, DraftingCriteria, Journey, Outcome, Progress, Stopped } from "@/app/components/run-sections";
import { RunStatusPill } from "@/app/components/status";
import { getDashboard } from "@/lib/runs/dashboard";
import { ago, RUNNING_STATUSES, runStatus, TERMINAL_STATUSES } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDashboard(id);
  if (!data) notFound();
  const { run, candidates } = data;
  const running = RUNNING_STATUSES.has(run.status);
  const awaiting = run.status === "awaiting_icp_confirmation";
  const terminal = TERMINAL_STATUSES.has(run.status);
  const finished = run.status === "complete" || run.status === "short_of_target";

  return <div className="page run-page">
    <AutoRefresh active={running} runId={run.id} />
    <nav className="crumb" aria-label="Breadcrumb"><Link href="/history"><Icon name="back" size={15} />Research runs</Link></nav>
    <header className="run-head">
      <div className="run-head-main">
        <div className="run-head-meta"><RunStatusPill status={run.status} /><span className="muted small">Started {ago(run.created_at)}</span>{!terminal && <RunRecipient runId={run.id} email={run.notify_on_success || run.notify_on_failure ? run.notification_email : null} />}</div>
        <h1 className="run-title">{run.objective}</h1>
        <p className="muted">{runStatus(run.status).hint}</p>
      </div>
      <div className="run-head-actions">
        {(running || run.status === "awaiting_budget") && <CancelRunButton runId={run.id} />}
        {terminal && <DeleteRunButton runId={run.id} redirectTo="/history" />}
      </div>
    </header>
    <Journey run={run} />

    {run.status === "draft" && <DraftingCriteria />}
    {awaiting && run.refined_icp && <IcpCheckpoint runId={run.id} objective={run.objective} initial={run.refined_icp} limits={run.limits} notificationEmail={run.notify_on_success || run.notify_on_failure ? run.notification_email : null} excludedCount={run.excluded_count} />}
    {run.status === "awaiting_budget" && run.budget_request && <BudgetRequestPanel runId={run.id} request={run.budget_request} />}
    {(running || run.status === "awaiting_budget") && run.status !== "draft" && <Progress data={data} />}
    {finished && <Outcome data={data} />}
    {(run.status === "failed" || run.status === "budget_exceeded" || run.status === "cancelled") && <Stopped run={run} />}

    {candidates.length > 0 && <section className="section">
      <div className="section-head"><div><h2>Leads</h2><p className="muted">Click any reason to see the exact evidence behind it.</p></div></div>
      <LeadBoard runId={run.id} candidates={candidates} />
    </section>}

    {!awaiting && run.refined_icp && <CriteriaSummary run={run} />}
    <Activity data={data} />
  </div>;
}
