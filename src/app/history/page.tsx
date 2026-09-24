import Link from "next/link";

import { Icon } from "@/app/components/icons";
import { RunTable } from "@/app/components/run-table";
import { RUN_FILTERS, type RunFilter } from "@/lib/ui/run-filters";
import { listRunSummaries } from "@/lib/runs/dashboard";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const initial = (RUN_FILTERS.find((item) => item.key === filter)?.key ?? "all") as RunFilter;
  const runs = await listRunSummaries();
  return <div className="page">
    <header className="page-head"><div><p className="eyebrow">Research runs</p><h1>Every run, kept</h1><p className="muted">Outcomes, costs and failures stay visible. Deleting moves a run to the recycle bin, where you can restore it.</p></div></header>
    <section className="card"><RunTable runs={runs} initialFilter={initial} /></section>
    <p className="muted small page-foot"><Link href="/recycle-bin" className="text-link"><Icon name="trash" size={14} />Recycle bin</Link></p>
  </div>;
}
