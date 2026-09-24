// One vocabulary for the founder-facing screens. Stage and status identifiers
// stay in the database and the audit trail; nothing a founder reads should say
// "qualify_one" or "awaiting_icp_confirmation".

export type Tone = "ok" | "warn" | "danger" | "accent" | "neutral" | "info";

export const RUN_STATUS: Record<string, { label: string; tone: Tone; hint: string }> = {
  draft: { label: "Drafting criteria", tone: "accent", hint: "Turning your brief into criteria. Nothing is spent yet." },
  awaiting_icp_confirmation: { label: "Needs your approval", tone: "warn", hint: "Check the criteria. Nothing is spent until you approve." },
  discovering: { label: "Finding companies", tone: "accent", hint: "Searching LinkedIn company records with your filters." },
  researching: { label: "Researching", tone: "accent", hint: "Reading each company's website and judging it against your criteria." },
  drafting: { label: "Writing outreach", tone: "accent", hint: "Drafting three emails and a LinkedIn note for each qualified lead." },
  awaiting_budget: { label: "Needs more budget", tone: "warn", hint: "Paused, not stopped. Add budget to keep going, or finish with what it found." },
  complete: { label: "Ready", tone: "ok", hint: "The target was reached. Every lead has evidence and drafts." },
  short_of_target: { label: "Ready, fewer than target", tone: "info", hint: "Finished honestly below the target. Your must-haves were never loosened." },
  budget_exceeded: { label: "Stopped at spend cap", tone: "danger", hint: "Stopped before spending more. Everything found so far is kept." },
  failed: { label: "Stopped", tone: "danger", hint: "A step failed. Everything found so far is kept." },
  cancelled: { label: "Cancelled", tone: "neutral", hint: "Stopped by you. Everything found so far is kept." },
};

export function runStatus(status: string) {
  return RUN_STATUS[status] ?? { label: status.replaceAll("_", " "), tone: "neutral" as Tone, hint: "" };
}

export const RUNNING_STATUSES = new Set(["draft", "discovering", "researching", "drafting"]);
export const TERMINAL_STATUSES = new Set(["complete", "short_of_target", "budget_exceeded", "failed", "cancelled"]);
export const STOPPED_STATUSES = new Set(["budget_exceeded", "failed"]);

export const JOURNEY = [
  { key: "criteria", label: "Criteria" },
  { key: "approval", label: "Your approval" },
  { key: "find", label: "Find companies" },
  { key: "research", label: "Research" },
  { key: "outreach", label: "Outreach drafts" },
  { key: "ready", label: "Ready" },
] as const;

const STAGE_TO_STEP: Record<string, number> = { refine_icp: 0, discover: 2, qualify_one: 3, draft_one: 4 };
const STATUS_TO_STEP: Record<string, number> = { draft: 0, awaiting_icp_confirmation: 1, discovering: 2, researching: 3, drafting: 4, complete: 5, short_of_target: 5 };

/** Where the run is on the journey, and whether that step ended badly. */
export function journeyPosition(status: string, stage: string, failureStage: string | null): { index: number; stopped: boolean } {
  if (status in STATUS_TO_STEP) return { index: STATUS_TO_STEP[status], stopped: false };
  if (status === "awaiting_budget") return { index: STAGE_TO_STEP[stage] ?? 3, stopped: false };
  const index = STAGE_TO_STEP[failureStage ?? stage] ?? 0;
  return { index: status === "cancelled" && stage === "refine_icp" ? 1 : index, stopped: true };
}

export const STAGE_WORDS: Record<string, string> = {
  refine_icp: "drafting criteria",
  discover: "finding companies",
  qualify_one: "researching companies",
  draft_one: "writing outreach",
};

export const CANDIDATE_STATUS: Record<string, { label: string; tone: Tone }> = {
  discovered: { label: "Queued", tone: "neutral" },
  researching: { label: "Researching now", tone: "accent" },
  qualified: { label: "Qualified", tone: "ok" },
  not_qualified: { label: "Rejected", tone: "neutral" },
  needs_review: { label: "Needs your review", tone: "warn" },
  failed: { label: "Could not research", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
};

export const FETCH_STATUS: Record<string, { label: string; tone: Tone; hint: string }> = {
  ok: { label: "Read", tone: "ok", hint: "Fetched and stored." },
  fetch_failed: { label: "Could not fetch", tone: "danger", hint: "The page was never retrieved: a 404, a timeout or a refusal." },
  blocked: { label: "Blocked", tone: "danger", hint: "The site refused the request." },
  paywalled: { label: "Paywalled", tone: "warn", hint: "A login or subscription wall came back instead of the page." },
  empty: { label: "No text", tone: "warn", hint: "The page was fetched but had no readable text. Not the same as a failed fetch." },
  unsupported_type: { label: "Not readable", tone: "warn", hint: "Not an HTML, PDF or text page." },
  too_large: { label: "Truncated", tone: "warn", hint: "Longer than the limit; truncated and still used." },
};

/** The failure in the founder's terms. The raw reason stays in the activity log. */
export function readableFailure(raw: string | null): string {
  const reason = raw ?? "";
  if (!reason) return "No reason was recorded, which is itself worth reporting to whoever runs Koya for you.";
  if (/apify budget|cannot pay for one company/i.test(reason)) return "The company-search spending cap for this run was reached, so Koya stopped before spending more.";
  if (/agent budget|budget/i.test(reason)) return "The AI research spending cap for this run was reached, so Koya stopped before spending more.";
  if (/max_turns|maximum number of turns/i.test(reason)) return "The AI took more steps than a single step allows and was stopped. Retrying usually works.";
  if (/rate limit|429|overloaded/i.test(reason)) return "An AI or search provider was busy and turned the request away. Retrying in a minute usually works.";
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(reason)) return "A provider took too long to answer. Retrying usually works.";
  if (/Refined ICP rejected/i.test(reason)) return `Koya could not turn the brief into usable criteria: ${reason.replace(/^.*Refined ICP rejected:\s*/i, "")}. Start a new run with a more specific brief.`;
  if (/Missing required server environment variable/i.test(reason)) return "A server setting is missing, so this step cannot run. This needs whoever set up Koya; retrying will not help.";
  if (/still running/i.test(reason)) return "The company search is still running on Apify. Retrying picks it up without paying for a second search.";
  return reason;
}

export function isRetryable(status: string, reason: string | null): boolean {
  if (status !== "failed") return false;
  return !/Missing required server environment variable|Refined ICP rejected/i.test(reason ?? "");
}

export function money(value: number | string, digits = 2): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  if (amount > 0 && amount < 0.01) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(digits)}`;
}

export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10_080) return `${Math.floor(minutes / 1_440)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Reasons stored before plain wording existed still read plainly. */
export function readableCandidateReason(reason: string | null): string | null {
  if (!reason) return null;
  if (/Claude Code returned an error result|maximum budget/i.test(reason)) return "Research used its AI allowance for this company before recording a decision.";
  if (/maximum number of turns|max_turns/i.test(reason)) return "Research took more steps than one company allows.";
  return reason;
}

export function isDiscoverySource(url: string): boolean {
  return url.startsWith("discovery://");
}
