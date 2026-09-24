import type { RunSummary } from "@/lib/runs/dashboard";

import { RUNNING_STATUSES } from "./labels";

export const RUN_FILTERS = [
  { key: "all", label: "All" },
  { key: "needs-you", label: "Needs you" },
  { key: "running", label: "Running" },
  { key: "ready", label: "Ready" },
  { key: "stopped", label: "Stopped" },
] as const;

export type RunFilter = (typeof RUN_FILTERS)[number]["key"];

// Leads to review only make a run "need you" once it has finished. A run the
// founder stopped was their decision; its leads stay reviewable on the run page
// but it is not a task.
export function needsYou(run: Pick<RunSummary, "status" | "needs_review_count">): boolean {
  return ["awaiting_icp_confirmation", "awaiting_budget", "failed", "budget_exceeded"].includes(run.status)
    || (run.needs_review_count > 0 && (run.status === "complete" || run.status === "short_of_target"));
}

export function matchesFilter(run: RunSummary, filter: RunFilter): boolean {
  switch (filter) {
    case "needs-you": return needsYou(run);
    case "running": return RUNNING_STATUSES.has(run.status);
    case "ready": return run.status === "complete" || run.status === "short_of_target";
    case "stopped": return ["failed", "budget_exceeded", "cancelled"].includes(run.status);
    default: return true;
  }
}
