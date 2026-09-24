import { RunTable } from "@/app/components/run-table";
import { listDeletedRunSummaries } from "@/lib/runs/dashboard";

export const dynamic = "force-dynamic";

export default async function RecycleBinPage() {
  const runs = await listDeletedRunSummaries();
  return <div className="page">
    <header className="page-head"><div><p className="eyebrow">Recycle bin</p><h1>Deleted runs</h1><p className="muted">Deleting hides a run; it never destroys the research or the audit trail. Restore puts it back exactly as it was. Spend on deleted runs still counts toward the month.</p></div></header>
    <section className="card"><RunTable runs={runs} mode="deleted" /></section>
  </div>;
}
