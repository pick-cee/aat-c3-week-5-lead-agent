import { NewRunForm } from "@/app/components/new-run-form";
import { RunStore } from "@/lib/runs/run-store";
import { AGENT_BUDGET_USD, APIFY_BUDGET_USD, LEAD_TARGET } from "@/lib/constants";
import { money } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

export default async function NewRunPage() {
  const settings = await new RunStore().getWorkspaceSettings();
  return <div className="page narrow">
    <header className="page-head"><div><p className="eyebrow">New research</p><h1>Who is worth your time?</h1><p className="muted">Koya finds {LEAD_TARGET} companies that fit, proves why from their own websites, and drafts the outreach. You approve the criteria before it spends anything on company search.</p></div></header>
    <NewRunForm defaultEmail={settings.notify_on_success || settings.notify_on_failure ? settings.notification_email : null} />
    <aside className="card cost-note">
      <h2>What a run costs</h2>
      <ul>
        <li><b>Up to {money(APIFY_BUDGET_USD)}</b> of company search (real spend on Apify), usually about $0.12.</li>
        <li><b>Up to {money(AGENT_BUDGET_USD)}</b> of AI research. This figure is an estimate, not a bill.</li>
        <li>Both caps are hard stops. A run that hits one stops and keeps everything it found.</li>
      </ul>
    </aside>
  </div>;
}
