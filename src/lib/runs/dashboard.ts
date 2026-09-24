import { queryDb } from "@/lib/server/database";

import type { BudgetRequest } from "./run-store";

export type Claim = { text: string; excerpt_ids?: string[]; excerpt_labels?: string[] };
export type HardFilterVerdict = { criterion: string; verdict: "pass" | "fail" | "unknown"; excerpt_ids?: string[]; excerpt_labels?: string[] };

export type DiscoverySearchSummary = {
  key: string;
  source: "company_search" | "job_ads";
  keywords: string | null;
  industries: string[];
  locations: string[];
  company_sizes: string[];
  returned_count: number | null;
  stored_count: number | null;
  set_aside_count: number;
  total_available: number | null;
  start_page: number | null;
  status: string | null;
};

export type DashboardRun = {
  id: string; objective: string; refined_icp: Record<string, unknown> | null;
  status: string; stage: string; target_leads: number; qualified_count: number;
  refills_used: number; soft_preferences_dropped: string[];
  agent_cost_usd: string; apify_cost_usd: string;
  cost_complete: boolean; quality_scorecard: Record<string, unknown> | null;
  failure_stage: string | null; failure_reason: string | null; failure_detail: Record<string, unknown> | null;
  limits: Record<string, number>; created_at: string; updated_at: string; icp_confirmed_at: string | null;
  deleted_at: string | null; notification_email: string | null; notify_on_success: boolean; notify_on_failure: boolean;
  source_run_id: string | null; excluded_count: number;
  budget_request: BudgetRequest | null;
  searches: DiscoverySearchSummary[];
};

export type DashboardCandidate = {
  id: string; company_name: string; domain: string; status: string; origin: string;
  skip_reason: string | null; research_attempts: number; draft_attempts: number;
  discovery_payload: Record<string, unknown>;
  qualification?: {
    status: string; confidence: string; fit_reasons: Claim[]; concerns: Claim[];
    hard_filter_results: HardFilterVerdict[]; source_summary: string; why_now: string | null;
    checks: { downgrades?: string[]; requested_status?: string; human_decision?: { decision: "approve" | "reject"; note: string; decided_at: string; previous_status: string } } | null;
  };
  sources: Array<{ id: string; url: string; fetch_status: string; injection_suspected: boolean; fetch_error: string | null }>;
  excerpts: Array<{ id: string; source_id: string; ordinal: number; text: string }>;
  drafts: Array<{ id: string; channel: string; step: number; subject: string | null; body: string; personalization_note: string; cited_excerpt_ids: string[] }>;
};

export type DashboardData = {
  run: DashboardRun;
  candidates: DashboardCandidate[];
  events: Array<{ id: string; from_status: string | null; to_status: string; stage: string; message: string; detail: Record<string, unknown>; created_at: string }>;
  toolCalls: Array<{ id: string; tool_name: string; purpose: string; status: string; error: string | null; cost_usd: string; input_summary: Record<string, unknown>; created_at: string }>;
};

type RunRow = Omit<DashboardRun, "searches" | "excluded_count"> & { apify_jobs: Record<string, Record<string, unknown>> | null; excluded_domains: string[] };

function searchesFrom(jobs: RunRow["apify_jobs"]): DiscoverySearchSummary[] {
  const numberOrNull = (value: unknown) => (typeof value === "number" ? value : null);
  return Object.entries(jobs ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, job]) => ({
      key,
      source: job.source === "job_ads" ? "job_ads" as const : "company_search" as const,
      keywords: typeof job.keywords === "string" ? job.keywords : null,
      industries: Array.isArray(job.industries) ? job.industries.map(String) : [],
      locations: Array.isArray(job.locations) ? job.locations.map(String) : [],
      company_sizes: Array.isArray(job.company_sizes) ? job.company_sizes.map(String) : [],
      returned_count: numberOrNull(job.returned_count),
      stored_count: numberOrNull(job.stored_count),
      set_aside_count: (numberOrNull(job.outside_location) ?? 0) + (numberOrNull(job.too_large) ?? 0),
      total_available: numberOrNull(job.total_available),
      start_page: numberOrNull(job.start_page),
      status: typeof job.status === "string" ? job.status : null,
    }));
}

export async function getDashboard(runId: string): Promise<DashboardData | null> {
  const runResult = await queryDb<RunRow>(
    `select id,objective,refined_icp,status,stage,target_leads,qualified_count,refills_used,soft_preferences_dropped,
            agent_cost_usd,apify_cost_usd,cost_complete,quality_scorecard,failure_stage,
            failure_reason,failure_detail,limits,created_at,updated_at,icp_confirmed_at,deleted_at,
            notification_email,notify_on_success,notify_on_failure,source_run_id,excluded_domains,apify_jobs,budget_request
       from lead_agent.runs where id=$1 and deleted_at is null`, [runId],
  );
  const row = runResult.rows[0];
  if (!row) return null;
  const { apify_jobs: jobs, excluded_domains: excluded, ...rest } = row;
  const run: DashboardRun = { ...rest, excluded_count: Array.isArray(excluded) ? excluded.length : 0, searches: searchesFrom(jobs) };

  const [candidateRows, qualifications, sources, excerpts, drafts, events, toolCalls] = await Promise.all([
    queryDb<Omit<DashboardCandidate, "qualification" | "sources" | "excerpts" | "drafts">>(
      `select id,company_name,domain,status,origin,skip_reason,research_attempts,draft_attempts,discovery_payload
         from lead_agent.candidates where run_id=$1 order by created_at`, [runId]),
    queryDb<NonNullable<DashboardCandidate["qualification"]> & { candidate_id: string }>(
      `select candidate_id,status,confidence,fit_reasons,concerns,hard_filter_results,source_summary,why_now,checks
         from lead_agent.qualifications where run_id=$1`, [runId]),
    queryDb<DashboardCandidate["sources"][number] & { candidate_id: string }>(
      `select id,candidate_id,url,fetch_status,injection_suspected,fetch_error from lead_agent.sources where run_id=$1 order by fetched_at`, [runId]),
    queryDb<DashboardCandidate["excerpts"][number] & { candidate_id: string }>(
      `select e.id,e.candidate_id,e.source_id,e.ordinal,e.text from lead_agent.excerpts e join lead_agent.candidates c on c.id=e.candidate_id where c.run_id=$1 order by e.candidate_id,e.ordinal`, [runId]),
    queryDb<DashboardCandidate["drafts"][number] & { candidate_id: string }>(
      `select id,candidate_id,channel,step,subject,body,personalization_note,cited_excerpt_ids from lead_agent.outreach_drafts where run_id=$1 order by candidate_id,channel,step`, [runId]),
    queryDb<DashboardData["events"][number]>(
      `select id,from_status,to_status,stage,message,detail,created_at from lead_agent.run_events where run_id=$1 order by created_at desc limit 60`, [runId]),
    queryDb<DashboardData["toolCalls"][number]>(
      `select id,tool_name,purpose,status,error,cost_usd,input_summary,created_at from lead_agent.tool_calls where run_id=$1 order by created_at desc limit 200`, [runId]),
  ]);
  const qualificationMap = new Map(qualifications.rows.map((item) => [item.candidate_id, item]));
  const candidates = candidateRows.rows.map((candidate) => ({
    ...candidate,
    qualification: qualificationMap.get(candidate.id),
    sources: sources.rows.filter((item) => item.candidate_id === candidate.id),
    excerpts: excerpts.rows.filter((item) => item.candidate_id === candidate.id),
    drafts: drafts.rows.filter((item) => item.candidate_id === candidate.id),
  }));
  return { run, candidates, events: events.rows, toolCalls: toolCalls.rows };
}

export type RunSummary = {
  id: string; objective: string; status: string; stage: string; qualified_count: number;
  target_leads: number; agent_cost_usd: string; apify_cost_usd: string; cost_complete: boolean;
  created_at: string; updated_at: string; needs_review_count: number; candidate_count: number;
  researched_count: number;
};

const SUMMARY_COLUMNS = `r.id,r.objective,r.status,r.stage,r.qualified_count,r.target_leads,r.agent_cost_usd,
  r.apify_cost_usd,r.cost_complete,r.created_at,r.updated_at,
  (select count(*)::int from lead_agent.qualifications q where q.run_id=r.id and q.status='needs_review') as needs_review_count,
  (select count(*)::int from lead_agent.candidates c where c.run_id=r.id) as candidate_count,
  (select count(*)::int from lead_agent.candidates c where c.run_id=r.id and c.status not in ('discovered','researching')) as researched_count`;

export async function listRunSummaries(limit = 200): Promise<RunSummary[]> {
  return (await queryDb<RunSummary>(
    `select ${SUMMARY_COLUMNS} from lead_agent.runs r where r.deleted_at is null order by r.created_at desc limit $1`,
    [limit],
  )).rows;
}

export async function listDeletedRunSummaries(): Promise<Array<RunSummary & { deleted_at: string }>> {
  return (await queryDb<RunSummary & { deleted_at: string }>(
    `select ${SUMMARY_COLUMNS}, r.deleted_at from lead_agent.runs r where r.deleted_at is not null order by r.deleted_at desc limit 100`,
  )).rows;
}

export async function monthSpend(): Promise<{ apify: number; agent: number; apifyComplete: boolean }> {
  // Deleted runs still cost real money, so they stay in the spend figure.
  const result = await queryDb<{ apify: string; agent: string; complete: boolean }>(
    `select coalesce(sum(apify_cost_usd),0) apify, coalesce(sum(agent_cost_usd),0) agent,
            coalesce(bool_and(cost_complete), true) complete
       from lead_agent.runs where created_at >= date_trunc('month', now())`,
  );
  const row = result.rows[0];
  return { apify: Number(row?.apify ?? 0), agent: Number(row?.agent ?? 0), apifyComplete: row?.complete ?? true };
}
