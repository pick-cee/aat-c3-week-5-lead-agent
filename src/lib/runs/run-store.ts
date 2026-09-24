import { randomUUID } from "node:crypto";

import { APIFY_ACTOR_START_USD, APIFY_COMPANY_RESULT_USD, DEFAULT_RUN_LIMITS, EXTRA_SEARCH_APIFY_USD, LEAD_TARGET, MAX_REFILLS, MAX_REFILLS_CEILING, MAX_RESEARCH_ATTEMPTS, MIN_STAGE_BUDGET_USD, RUNNER_LEASE_SECONDS, STALE_RESEARCH_MINUTES, TEST_EMAIL_COOLDOWN_SECONDS } from "@/lib/constants";
import { computeListQuality } from "@/lib/checks/list-quality";
import { queryDb, withTransaction } from "@/lib/server/database";
import { notifyRun } from "@/lib/server/failure-notifier";

export type DiscoveryJob = {
  keywords?: string;
  industries?: string[];
  returned_count?: number;
  stored_count?: number;
  total_available?: number | null;
};

export type RunRecord = {
  id: string;
  objective: string;
  refined_icp: Record<string, unknown> | null;
  limits: Record<string, number>;
  status: string;
  stage: "refine_icp" | "discover" | "qualify_one" | "draft_one";
  stage_attempts: number;
  target_leads: number;
  qualified_count: number;
  refills_used: number;
  soft_preferences_dropped: unknown[];
  agent_cost_usd: string;
  apify_cost_usd: string;
  cost_complete: boolean;
  apify_jobs: Record<string, DiscoveryJob>;
  excluded_domains: string[];
  runner_lease_id: string | null;
  notification_email: string | null;
  notify_on_success: boolean;
  notify_on_failure: boolean;
  budget_request: BudgetRequest | null;
};

export type BudgetKind = "agent" | "apify" | "searches" | "tool_calls" | "scrapes";

/** What a paused run needs, in numbers the founder can act on. */
export type BudgetRequest = {
  kind: BudgetKind;
  reason: string;
  stage: RunRecord["stage"];
  qualified: number;
  target: number;
  pending: number;
  agent_used_usd: number;
  agent_budget_usd: number;
  apify_used_usd: number;
  apify_budget_usd: number;
  searches_used: number;
  searches_allowed: number;
  options: Array<{ label: string; searches: number; agent_usd: number }>;
  requested_at: string;
};

export type Candidate = { id: string; company_name: string; domain: string; discovery_evidence: string | null };

export type DraftContext = {
  whyNow: string | null;
  sourceSummary: string;
  fitReasons: Array<{ text: string; excerpt_labels?: string[] }>;
  concerns: Array<{ text: string; excerpt_labels?: string[] }>;
  excerpts: Array<{ label: string; text: string }>;
};

export type WorkspaceSettings = {
  notification_email: string | null;
  notify_on_success: boolean;
  notify_on_failure: boolean;
  last_test_email_at: string | null;
};

const WORKSPACE_USER_ID = "00000000-0000-4000-8000-000000000001";
export const ACTIVE_STATUSES = ["draft", "awaiting_icp_confirmation", "discovering", "researching", "drafting", "awaiting_budget"] as const;
const RUNNABLE_STATUSES = ["draft", "discovering", "researching", "drafting"] as const;
const STATUS_FOR_STAGE: Record<RunRecord["stage"], string> = {
  refine_icp: "draft",
  discover: "discovering",
  qualify_one: "researching",
  draft_one: "drafting",
};
const MAX_DRAFT_ATTEMPTS = 3;
const NOTE_LABEL = { success: "Completion", failure: "Failure", budget: "Budget request" } as const;
const DRAFT_EXCERPT_LIMIT = 30;

export class RunStore {
  async createRun(
    objective: string,
    submitToken: string = randomUUID(),
    // undefined: use the workspace default. null: no email for this run.
    // A string: this run's own recipient, which may not be the workspace's.
    options: { email?: string | null } = {},
  ): Promise<string> {
    const result = await queryDb<{ id: string; inserted: boolean }>(
      `insert into lead_agent.runs
        (created_by, objective, limits, target_leads, submit_token,
         notification_email, notify_on_success, notify_on_failure)
       select $1,$2,$3::jsonb,$4,$5,
              case when $6::boolean then s.notification_email else $7::text end,
              -- An address typed for this run means "tell me how it ends",
              -- whatever the workspace default toggles say.
              case when $6::boolean then coalesce(s.notify_on_success, true) else true end,
              case when $6::boolean then coalesce(s.notify_on_failure, true) else true end
         from (select 1) one
         left join lead_agent.workspace_settings s on s.id = 1
       on conflict (submit_token) do update set submit_token = excluded.submit_token
       returning id, (xmax = 0) as inserted`,
      [WORKSPACE_USER_ID, objective, JSON.stringify(DEFAULT_RUN_LIMITS), LEAD_TARGET, submitToken,
       options.email === undefined, options.email?.trim().toLowerCase() || null],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Run was not created");
    if (result.rows[0]?.inserted) await this.addEvent(id, null, "draft", "refine_icp", "Run created", {});
    return id;
  }

  /**
   * A confirmed ICP is the reusable asset. The copy still stops at the
   * approval gate: nothing is spent until a person confirms it again.
   */
  async createRerun(sourceRunId: string, submitToken: string): Promise<{ id: string; excluded: number }> {
    return withTransaction(async (client) => {
      const source = await client.query<{ objective: string; refined_icp: unknown; excluded_domains: string[] }>(
        `select objective, refined_icp, excluded_domains from lead_agent.runs
          where id=$1 and refined_icp is not null`,
        [sourceRunId],
      );
      const row = source.rows[0];
      if (!row) throw new Error("That run has no criteria to reuse");
      const decided = await client.query<{ domain_canonical: string }>(
        `select c.domain_canonical from lead_agent.candidates c
           join lead_agent.qualifications q on q.candidate_id = c.id
          where c.run_id=$1 and q.status in ('qualified','not_qualified')`,
        [sourceRunId],
      );
      const excluded = [...new Set([...(row.excluded_domains ?? []), ...decided.rows.map((item) => item.domain_canonical)])];
      const created = await client.query<{ id: string; inserted: boolean }>(
        `insert into lead_agent.runs
          (created_by, objective, refined_icp, limits, status, stage, target_leads, submit_token,
           source_run_id, excluded_domains, notification_email, notify_on_success, notify_on_failure)
         select $1,$2,$3::jsonb,$4::jsonb,'awaiting_icp_confirmation','refine_icp',$5,$6,$7,$8::jsonb,
                s.notification_email, coalesce(s.notify_on_success,true), coalesce(s.notify_on_failure,true)
           from (select 1) one
           left join lead_agent.workspace_settings s on s.id = 1
         on conflict (submit_token) do update set submit_token = excluded.submit_token
         returning id, (xmax = 0) as inserted`,
        [WORKSPACE_USER_ID, row.objective, JSON.stringify(row.refined_icp), JSON.stringify(DEFAULT_RUN_LIMITS),
         LEAD_TARGET, submitToken, sourceRunId, JSON.stringify(excluded)],
      );
      const id = created.rows[0]!.id;
      if (created.rows[0]!.inserted) {
        await client.query(
          `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message,detail)
           values ($1,null,'awaiting_icp_confirmation','refine_icp',$2,$3::jsonb)`,
          [id, `Created from an earlier run's criteria; ${excluded.length} previously decided compan${excluded.length === 1 ? "y is" : "ies are"} skipped`,
           JSON.stringify({ source_run_id: sourceRunId, excluded_domains: excluded.length })],
        );
      }
      return { id, excluded: excluded.length };
    });
  }

  async confirmIcp(runId: string): Promise<void> {
    await withTransaction(async (client) => {
      const updated = await client.query<{ status: string }>(
        `update lead_agent.runs
            set icp_confirmed_at=now(), icp_confirmed_by=$2,
                status='discovering', stage='discover', updated_at=now()
          where id=$1 and status='awaiting_icp_confirmation' and refined_icp is not null and deleted_at is null
          returning status`,
        [runId, WORKSPACE_USER_ID],
      );
      if (!updated.rows[0]) throw new Error("Run is not awaiting ICP confirmation");
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message)
         values ($1,'awaiting_icp_confirmation','discovering','discover','ICP confirmed; spend authorized')`,
        [runId],
      );
    });
  }

  async updateIcp(runId: string, refinedIcp: unknown): Promise<void> {
    // The version being replaced goes into the event, so the agent's original
    // criteria and assumptions stay reviewable after a founder edits them.
    await withTransaction(async (client) => {
      const result = await client.query<{ previous: unknown }>(
        `update lead_agent.runs r set refined_icp=$2::jsonb, updated_at=now()
           from (select refined_icp from lead_agent.runs where id=$1 for update) old
          where r.id=$1 and r.status='awaiting_icp_confirmation'
          returning old.refined_icp as previous`,
        [runId, JSON.stringify(refinedIcp)],
      );
      if (!result.rows[0]) throw new Error("Run is not awaiting ICP confirmation");
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message,detail)
         values ($1,'awaiting_icp_confirmation','awaiting_icp_confirmation','refine_icp','ICP criteria edited before spend',$2::jsonb)`,
        [runId, JSON.stringify({ previous_icp: result.rows[0].previous })],
      );
    });
  }

  async claim(runId?: string): Promise<RunRecord | null> {
    const leaseId = randomUUID();
    const result = await queryDb<RunRecord>(
      `with next_run as (
         select id from lead_agent.runs
          where ($1::uuid is null or id=$1)
            and status = any($4::lead_agent.run_status[])
            and deleted_at is null
            and (runner_lease_until is null or runner_lease_until < now())
          order by created_at
          limit 1
       )
       update lead_agent.runs r
          set runner_lease_until = now() + make_interval(secs => $2),
              runner_lease_id = $3,
              updated_at = now()
         from next_run n
        where r.id=n.id
          and (r.runner_lease_until is null or r.runner_lease_until < now())
       returning r.*`,
      [runId ?? null, RUNNER_LEASE_SECONDS, leaseId, RUNNABLE_STATUSES],
    );
    return result.rows[0] ?? null;
  }

  async release(runId: string, leaseId: string): Promise<void> {
    await queryDb(
      `update lead_agent.runs set runner_lease_until=null, runner_lease_id=null, updated_at=now()
        where id=$1 and runner_lease_id=$2`,
      [runId, leaseId],
    );
  }

  async addEvent(runId: string, fromStatus: string | null, toStatus: string, stage: string, message: string, detail: unknown): Promise<void> {
    await queryDb(
      `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message,detail)
       values ($1,$2,$3,$4,$5,$6::jsonb)`,
      [runId, fromStatus, toStatus, stage, message, JSON.stringify(detail)],
    );
  }

  /**
   * Every runner transition is conditional on the run not having been
   * cancelled meanwhile; a step that finishes after a founder pressed Cancel
   * must not quietly resurrect the run.
   */
  async transition(run: RunRecord, status: string, stage: RunRecord["stage"], message: string, detail: unknown = {}): Promise<boolean> {
    return withTransaction(async (client) => {
      const updated = await client.query(
        `update lead_agent.runs set status=$2, stage=$3, stage_attempts=0, updated_at=now()
          where id=$1 and status <> 'cancelled' returning id`,
        [run.id, status, stage],
      );
      if (!updated.rows[0]) return false;
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message,detail)
         values ($1,$2,$3,$4,$5,$6::jsonb)`,
        [run.id, run.status, status, stage, message, JSON.stringify(detail)],
      );
      return true;
    });
  }

  async saveRefinedIcp(run: RunRecord, refinedIcp: unknown): Promise<void> {
    await withTransaction(async (client) => {
      const updated = await client.query(
        `update lead_agent.runs set refined_icp=$2::jsonb,
          status='awaiting_icp_confirmation', updated_at=now() where id=$1 and status <> 'cancelled' returning id`,
        [run.id, JSON.stringify(refinedIcp)],
      );
      if (!updated.rows[0]) return;
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message)
         values ($1,$2,'awaiting_icp_confirmation','refine_icp','ICP refined; waiting for human confirmation')`,
        [run.id, run.status],
      );
    });
  }

  async recordStage(input: { run: RunRecord; candidateId?: string; sessionId?: string; turns?: number; inputTokens?: number; outputTokens?: number; costUsd?: number; resultSubtype?: string; error?: string }): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `insert into lead_agent.stage_runs
          (run_id,stage,candidate_id,session_id,turns,input_tokens,output_tokens,cost_usd,result_subtype,error)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [input.run.id, input.run.stage, input.candidateId ?? null, input.sessionId ?? null,
         input.turns ?? 0, input.inputTokens ?? 0, input.outputTokens ?? 0,
         input.costUsd ?? 0, input.resultSubtype ?? null, input.error ?? null],
      );
      await client.query(
        `update lead_agent.runs set agent_cost_usd=agent_cost_usd+$2::numeric,
          stage_attempts=stage_attempts+1, updated_at=now() where id=$1`,
        [input.run.id, input.costUsd ?? 0],
      );
    });
  }

  /**
   * Claims up to `count` companies for one step in a single update. A company
   * still marked researching is only taken again once its start is older than
   * any step could run, so a live step's companies are never picked twice.
   */
  async nextCandidates(runId: string, count: number): Promise<Candidate[]> {
    const result = await queryDb<Candidate>(
      `with picked as (
         select id from lead_agent.candidates
          where run_id=$1
            and (status='discovered'
                 or (status='researching' and (research_started_at is null or research_started_at < now() - make_interval(mins => $3))))
          order by created_at
          limit $2
          for update skip locked
       )
       update lead_agent.candidates c
          set status='researching', research_started_at=now()
         from picked
        where c.id=picked.id
       returning c.id, c.company_name, c.domain,
         (select e.text from lead_agent.excerpts e where e.candidate_id=c.id and e.ordinal=1) as discovery_evidence`,
      [runId, count, STALE_RESEARCH_MINUTES],
    );
    return result.rows;
  }

  /** Returns a company to the queue without counting an attempt against it. */
  async releaseCandidate(candidateId: string): Promise<void> {
    await queryDb("update lead_agent.candidates set status='discovered', research_started_at=null where id=$1 and status='researching'", [candidateId]);
  }

  async countPendingCandidates(runId: string): Promise<number> {
    const result = await queryDb<{ count: number }>(
      "select count(*)::int as count from lead_agent.candidates where run_id=$1 and status in ('discovered','researching')",
      [runId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async hasQualification(candidateId: string): Promise<boolean> {
    const result = await queryDb<{ found: boolean }>(
      "select exists (select 1 from lead_agent.qualifications where candidate_id=$1) as found",
      [candidateId],
    );
    return Boolean(result.rows[0]?.found);
  }

  async hasDrafts(candidateId: string): Promise<boolean> {
    const result = await queryDb<{ count: number }>(
      "select count(*)::int as count from lead_agent.outreach_drafts where candidate_id=$1",
      [candidateId],
    );
    return (result.rows[0]?.count ?? 0) >= 4;
  }

  async nextDraftCandidates(runId: string, count: number): Promise<Array<{ id: string; company_name: string; domain: string }>> {
    const result = await queryDb<{ id: string; company_name: string; domain: string }>(
      `select c.id,c.company_name,c.domain from lead_agent.candidates c
        join lead_agent.qualifications q on q.candidate_id=c.id and q.status='qualified'
        where c.run_id=$1
          and c.draft_attempts < $2
          and (select count(*) from lead_agent.outreach_drafts d where d.candidate_id=c.id) < 4
        order by q.confidence desc, c.created_at limit $3`,
      [runId, MAX_DRAFT_ATTEMPTS, count],
    );
    return result.rows;
  }

  async draftContext(candidateId: string): Promise<DraftContext> {
    const [qualification, excerpts] = await Promise.all([
      queryDb<{ why_now: string | null; source_summary: string; fit_reasons: DraftContext["fitReasons"]; concerns: DraftContext["concerns"] }>(
        "select why_now, source_summary, fit_reasons, concerns from lead_agent.qualifications where candidate_id=$1",
        [candidateId],
      ),
      queryDb<{ ordinal: number; text: string }>(
        "select ordinal, text from lead_agent.excerpts where candidate_id=$1 order by ordinal limit $2",
        [candidateId, DRAFT_EXCERPT_LIMIT],
      ),
    ]);
    const row = qualification.rows[0];
    if (!row) throw new Error("Qualified lead has no stored qualification");
    return {
      whyNow: row.why_now,
      sourceSummary: row.source_summary,
      fitReasons: row.fit_reasons,
      concerns: row.concerns,
      excerpts: excerpts.rows.map((excerpt) => ({ label: `E${excerpt.ordinal}`, text: excerpt.text })),
    };
  }

  async markDraftFailure(candidateId: string, reason: string): Promise<void> {
    await queryDb(
      "update lead_agent.candidates set draft_attempts=least(draft_attempts+1,$3), skip_reason=$2 where id=$1",
      [candidateId, `Outreach drafting: ${reason}`.slice(0, 500), MAX_DRAFT_ATTEMPTS],
    );
  }

  async refreshQualifiedCount(runId: string): Promise<number> {
    const result = await queryDb<{ count: number }>(
      `with tally as (select count(*)::int count from lead_agent.qualifications where run_id=$1 and status='qualified')
       update lead_agent.runs r set qualified_count=t.count, updated_at=now() from tally t where r.id=$1 returning t.count`,
      [runId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async prepareRefill(run: RunRecord): Promise<void> {
    const next = Math.min(run.refills_used + 1, run.limits.max_refills ?? MAX_REFILLS);
    const soft = Array.isArray(run.refined_icp?.soft_preferences) ? run.refined_icp.soft_preferences : [];
    const dropped = soft[next - 1] ? [soft[next - 1]] : [];
    await withTransaction(async (client) => {
      const updated = await client.query(
        `update lead_agent.runs set refills_used=$2,
          soft_preferences_dropped=soft_preferences_dropped || $3::jsonb,
          status='discovering', stage='discover', updated_at=now() where id=$1 and status <> 'cancelled' returning id`,
        [run.id, next, JSON.stringify(dropped)],
      );
      if (!updated.rows[0]) return;
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message,detail)
         values ($1,$2,'discovering','discover','Refill started without relaxing hard filters',$3::jsonb)`,
        [run.id, run.status, JSON.stringify({ refill: next, soft_preferences_dropped: dropped })],
      );
    });
  }

  async markCandidateFailure(candidateId: string, reason: string): Promise<void> {
    await queryDb(
      `update lead_agent.candidates set
        research_attempts=least(research_attempts+1,$3), research_started_at=null,
        status=case when research_attempts+1 >= $3 then 'failed'::lead_agent.candidate_status else 'discovered'::lead_agent.candidate_status end,
        skip_reason=$2 where id=$1`,
      [candidateId, reason, MAX_RESEARCH_ATTEMPTS],
    );
  }

  async finalize(run: RunRecord): Promise<void> {
    const stats = await queryDb<{
      qualified_count: number; total_candidates: number; unique_domains: number;
      evidence_complete: number; drafts_complete: number; needs_review_counted: number;
    }>(
      `select
        count(*) filter (where q.status='qualified')::int qualified_count,
        count(distinct c.id)::int total_candidates,
        count(distinct c.domain_canonical)::int unique_domains,
        count(*) filter (where q.status='qualified' and jsonb_array_length(q.fit_reasons)>=2)::int evidence_complete,
        count(*) filter (where q.status='qualified' and (select count(*) from lead_agent.outreach_drafts d where d.candidate_id=c.id)>=4)::int drafts_complete,
        0::int needs_review_counted
       from lead_agent.candidates c left join lead_agent.qualifications q on q.candidate_id=c.id
       where c.run_id=$1`,
      [run.id],
    );
    const s = stats.rows[0] ?? { qualified_count: 0, total_candidates: 0, unique_domains: 0, evidence_complete: 0, drafts_complete: 0, needs_review_counted: 0 };
    const score = computeListQuality({ targetLeads: run.target_leads, qualifiedCount: s.qualified_count, totalCandidates: s.total_candidates, uniqueDomains: s.unique_domains, qualifiedWithCompleteEvidence: s.evidence_complete, qualifiedWithDrafts: s.drafts_complete, needsReviewCountedAsQualified: s.needs_review_counted });
    const status = s.qualified_count >= run.target_leads ? "complete" : "short_of_target";
    const finalized = await withTransaction(async (client) => {
      const updated = await client.query(
        `update lead_agent.runs set status=$2, qualified_count=$3,
          quality_scorecard=$4::jsonb, updated_at=now() where id=$1 and status <> 'cancelled' returning id`,
        [run.id, status, s.qualified_count, JSON.stringify(score)],
      );
      if (!updated.rows[0]) return false;
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message,detail)
         values ($1,$2,$3,'draft_one',$4,$5::jsonb)`,
        [run.id, run.status, status, status === "complete" ? "Target reached" : "Run completed honestly below target", JSON.stringify(score)],
      );
      return true;
    });
    if (!finalized) return;
    await this.notify(run, "success", status === "complete"
      ? `Your research finished with ${s.qualified_count} qualified leads, each with cited evidence and outreach drafts ready for review.`
      : `Your research finished with ${s.qualified_count} qualified lead${s.qualified_count === 1 ? "" : "s"}, short of the target of ${run.target_leads}. Koya kept your hard filters rather than padding the list.`);
  }

  async failRun(run: RunRecord, reason: string, detail: unknown, budgetExceeded = false): Promise<void> {
    const status = budgetExceeded ? "budget_exceeded" : "failed";
    const updated = await queryDb(
      `update lead_agent.runs set status=$2, failure_stage=$3, failure_reason=$4,
        failure_detail=$5::jsonb, updated_at=now() where id=$1 and status <> 'cancelled' returning id`,
      [run.id, status, run.stage, reason, JSON.stringify(detail)],
    );
    if (!updated.rows[0]) return;
    await this.addEvent(run.id, run.status, status, run.stage, reason, detail);
    await this.notify(run, "failure", reason);
  }

  private async notify(run: RunRecord, kind: "success" | "failure" | "budget", reason: string): Promise<void> {
    const wanted = kind === "success" ? run.notify_on_success : run.notify_on_failure;
    if (!run.notification_email || !wanted) return;
    const notification = await notifyRun({ to: run.notification_email, kind, runId: run.id, objective: run.objective, stage: run.stage, reason });
    await this.addNote(
      run.id,
      notification.sent
        ? `${NOTE_LABEL[kind]} email sent`
        : `${NOTE_LABEL[kind]} email could not be sent`,
      notification,
    );
  }

  /** An event that records something happening to the run without moving it. */
  private async addNote(runId: string, message: string, detail: unknown = {}): Promise<void> {
    await queryDb(
      `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message,detail)
       select id, status, status, stage, $2, $3::jsonb from lead_agent.runs where id=$1`,
      [runId, message, JSON.stringify(detail)],
    );
  }

  /** Stops a run from spending more. Work already stored stays visible. */
  async cancel(runId: string): Promise<boolean> {
    return withTransaction(async (client) => {
      const current = await client.query<{ status: string; stage: string }>(
        "select status, stage from lead_agent.runs where id=$1 and deleted_at is null for update",
        [runId],
      );
      const row = current.rows[0];
      if (!row || !(ACTIVE_STATUSES as readonly string[]).includes(row.status)) return false;
      await client.query(
        "update lead_agent.runs set status='cancelled', updated_at=now() where id=$1",
        [runId],
      );
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message)
         values ($1,$2,'cancelled',$3,'Cancelled by the founder; no further spend')`,
        [runId, row.status, row.stage],
      );
      return true;
    });
  }

  /** Resumes a failed run from the stage that failed. Budgets are unchanged. */
  async retry(runId: string): Promise<boolean> {
    return withTransaction(async (client) => {
      const current = await client.query<{ status: string; stage: RunRecord["stage"] }>(
        "select status, stage from lead_agent.runs where id=$1 and deleted_at is null for update",
        [runId],
      );
      const row = current.rows[0];
      if (!row || row.status !== "failed") return false;
      const status = STATUS_FOR_STAGE[row.stage];
      await client.query(
        `update lead_agent.runs set status=$2, stage_attempts=0, failure_stage=null,
          failure_reason=null, failure_detail=null, runner_lease_until=null, runner_lease_id=null,
          updated_at=now() where id=$1`,
        [runId, status],
      );
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message)
         values ($1,'failed',$2,$3,'Retried by the founder from the failed step')`,
        [runId, status, row.stage],
      );
      return true;
    });
  }

  async softDelete(runId: string): Promise<boolean> {
    const result = await queryDb(
      `update lead_agent.runs
          set deleted_at=coalesce(deleted_at,now()), runner_lease_until=null,
              runner_lease_id=null, updated_at=now()
        where id=$1 and deleted_at is null returning id`,
      [runId],
    );
    if (result.rows[0]) await this.addNote(runId, "Moved to the recycle bin");
    return Boolean(result.rows[0]);
  }

  async restore(runId: string): Promise<boolean> {
    const result = await queryDb(
      "update lead_agent.runs set deleted_at=null,updated_at=now() where id=$1 and deleted_at is not null returning id",
      [runId],
    );
    if (result.rows[0]) await this.addNote(runId, "Restored from the recycle bin");
    return Boolean(result.rows[0]);
  }

  async getWorkspaceSettings(): Promise<WorkspaceSettings> {
    const result = await queryDb<WorkspaceSettings>(
      "select notification_email, notify_on_success, notify_on_failure, last_test_email_at from lead_agent.workspace_settings where id=1",
    );
    return result.rows[0] ?? { notification_email: null, notify_on_success: true, notify_on_failure: true, last_test_email_at: null };
  }

  /**
   * Saves the defaults and applies them to unfinished runs that were still
   * using the previous default. A run started with its own recipient keeps it:
   * the person who started it may not be the person on the workspace address.
   */
  async saveWorkspaceSettings(input: { email: string | null; onSuccess: boolean; onFailure: boolean }): Promise<number> {
    return withTransaction(async (client) => {
      const previous = await client.query<{ notification_email: string | null }>(
        "select notification_email from lead_agent.workspace_settings where id=1 for update",
      );
      await client.query(
        `insert into lead_agent.workspace_settings (id, notification_email, notify_on_success, notify_on_failure, updated_at)
         values (1, $1, $2, $3, now())
         on conflict (id) do update set notification_email=excluded.notification_email,
           notify_on_success=excluded.notify_on_success, notify_on_failure=excluded.notify_on_failure, updated_at=now()`,
        [input.email, input.onSuccess, input.onFailure],
      );
      const updated = await client.query(
        `update lead_agent.runs set notification_email=$1, notify_on_success=$2, notify_on_failure=$3, updated_at=now()
          where status = any($4::lead_agent.run_status[]) and deleted_at is null
            and notification_email is not distinct from $5::text
          returning id`,
        [input.email, input.onSuccess, input.onFailure, ACTIVE_STATUSES, previous.rows[0]?.notification_email ?? null],
      );
      return updated.rowCount ?? 0;
    });
  }

  /** Changes who hears about one run, without touching the workspace default. */
  async setRunRecipient(runId: string, email: string | null): Promise<boolean> {
    const result = await queryDb(
      `update lead_agent.runs set notification_email=$2,
              notify_on_success = case when $2::text is null then notify_on_success else true end,
              notify_on_failure = case when $2::text is null then notify_on_failure else true end,
              updated_at=now()
        where id=$1 and deleted_at is null returning id`,
      [runId, email],
    );
    // The address itself stays out of the event log.
    if (result.rows[0]) await this.addNote(runId, email ? "Email updates for this run now go to a new address" : "Email updates for this run turned off");
    return Boolean(result.rows[0]);
  }

  /**
   * Reserve the test-email slot before sending. The endpoint has no login, so
   * without a cooldown it would be a free relay for our sending domain.
   */
  async reserveTestEmail(): Promise<string | null> {
    const result = await queryDb<{ notification_email: string }>(
      `update lead_agent.workspace_settings set last_test_email_at=now()
        where id=1 and notification_email is not null
          and (last_test_email_at is null or last_test_email_at < now() - make_interval(secs => $1))
        returning notification_email`,
      [TEST_EMAIL_COOLDOWN_SECONDS],
    );
    return result.rows[0]?.notification_email ?? null;
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const result = await queryDb<RunRecord>("select * from lead_agent.runs where id=$1", [runId]);
    return result.rows[0] ?? null;
  }

  /**
   * What, if anything, stops the next step from running within the run's caps.
   * Checked before a step starts, so a step never begins with too little
   * budget to finish and a company is never marked failed for running out.
   */
  async budgetShortage(runId: string, stage: RunRecord["stage"]): Promise<BudgetKind | null> {
    const result = await queryDb<{ limits: Record<string, number>; agent_cost_usd: string; apify_cost_usd: string; tool_calls: string | null; scrapes: string | null; apify_calls: string | null }>(
      `select r.limits, r.agent_cost_usd, r.apify_cost_usd,
              (select value from lead_agent.usage_counters u where u.run_id=r.id and u.scope='run' and u.counter_name='tool_calls_total') tool_calls,
              (select value from lead_agent.usage_counters u where u.run_id=r.id and u.scope='run' and u.counter_name='scrapes_total') scrapes,
              (select value from lead_agent.usage_counters u where u.run_id=r.id and u.scope='run' and u.counter_name='apify_calls') apify_calls
         from lead_agent.runs r where r.id=$1`,
      [runId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const limits = row.limits;
    if (limits.agent_budget_usd - Number(row.agent_cost_usd) < MIN_STAGE_BUDGET_USD) return "agent";
    // A step makes several calls; stop a few short rather than mid-company.
    if (Number(row.tool_calls ?? 0) >= limits.max_tool_calls - 6) return "tool_calls";
    if (stage === "qualify_one" && Number(row.scrapes ?? 0) >= limits.max_scrapes_total) return "scrapes";
    if (stage === "discover") {
      if (Number(row.apify_calls ?? 0) >= limits.max_apify_calls) return "searches";
      if (limits.apify_budget_usd - Number(row.apify_cost_usd) < APIFY_ACTOR_START_USD + APIFY_COMPANY_RESULT_USD) return "apify";
    }
    return null;
  }

  /** Pauses the run and asks the founder. Only a person can raise a cap. */
  async requestBudget(run: RunRecord, kind: BudgetKind): Promise<void> {
    const fresh = (await this.getRun(run.id)) ?? run;
    const counts = await queryDb<{ qualified: number; pending: number; apify_calls: string | null }>(
      `select (select count(*)::int from lead_agent.qualifications q where q.run_id=$1 and q.status='qualified') qualified,
              (select count(*)::int from lead_agent.candidates c where c.run_id=$1 and c.status in ('discovered','researching')) pending,
              (select value from lead_agent.usage_counters u where u.run_id=$1 and u.scope='run' and u.counter_name='apify_calls') apify_calls`,
      [run.id],
    );
    const { qualified, pending } = counts.rows[0] ?? { qualified: 0, pending: 0 };
    const searching = kind === "searches" || kind === "apify";
    const tally = `${qualified} of ${fresh.target_leads} leads qualified`;
    const waiting = pending ? ` and ${pending} companies still waiting` : "";
    const reasons: Record<BudgetKind, string> = {
      searches: `All ${fresh.limits.max_apify_calls} company searches are used with ${tally}. Another search brings up to ${fresh.limits.max_candidates} new companies to research.`,
      apify: `The company-search allowance ($${fresh.limits.apify_budget_usd.toFixed(2)}) is used up with ${tally}.`,
      agent: `The AI research allowance ($${fresh.limits.agent_budget_usd.toFixed(2)}) is used up with ${tally}${waiting}.`,
      tool_calls: `This run reached its safety limit on research actions with ${tally}${waiting}.`,
      scrapes: `This run reached its limit on website pages read with ${tally}${waiting}.`,
    };
    const request: BudgetRequest = {
      kind,
      reason: reasons[kind],
      stage: fresh.stage,
      qualified,
      target: fresh.target_leads,
      pending,
      agent_used_usd: Number(fresh.agent_cost_usd),
      agent_budget_usd: fresh.limits.agent_budget_usd,
      apify_used_usd: Number(fresh.apify_cost_usd),
      apify_budget_usd: fresh.limits.apify_budget_usd,
      searches_used: Number(counts.rows[0]?.apify_calls ?? 0),
      searches_allowed: fresh.limits.max_apify_calls,
      options: searching
        ? [{ label: "Keep going", searches: 2, agent_usd: 2 }, { label: "A little more", searches: 1, agent_usd: 1 }]
        : [{ label: "Keep going", searches: 0, agent_usd: 2 }, { label: "A little more", searches: 0, agent_usd: 1 }],
      requested_at: new Date().toISOString(),
    };
    const paused = await withTransaction(async (client) => {
      const updated = await client.query(
        `update lead_agent.runs set status='awaiting_budget', budget_request=$2::jsonb, updated_at=now()
          where id=$1 and status <> 'cancelled' returning id`,
        [run.id, JSON.stringify(request)],
      );
      if (!updated.rows[0]) return false;
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message,detail)
         values ($1,$2,'awaiting_budget',$3,'Paused to ask for more budget',$4::jsonb)`,
        [run.id, fresh.status, fresh.stage, JSON.stringify({ kind })],
      );
      return true;
    });
    if (paused) await this.notify(fresh, "budget", request.reason);
  }

  /** A founder raised the caps; the run picks up where it paused. */
  async raiseBudget(runId: string, input: { searches: number; agentUsd: number }): Promise<boolean> {
    return withTransaction(async (client) => {
      const current = await client.query<RunRecord>("select * from lead_agent.runs where id=$1 and deleted_at is null for update", [runId]);
      const run = current.rows[0];
      if (!run || run.status !== "awaiting_budget") return false;
      const limits = { ...run.limits };
      const maxRefills = limits.max_refills ?? MAX_REFILLS;
      const searches = Math.max(0, Math.min(Math.floor(input.searches), MAX_REFILLS_CEILING - maxRefills));
      const agentUsd = Math.max(0, input.agentUsd);
      limits.agent_budget_usd = Number((limits.agent_budget_usd + agentUsd).toFixed(2));
      // Secondary safety caps grow with the budget they protect.
      limits.max_tool_calls += Math.round(agentUsd * 80) + searches * 40;
      limits.max_scrapes_total += Math.round(agentUsd * 30);
      if (searches > 0) {
        limits.max_refills = maxRefills + searches;
        limits.max_apify_calls += searches;
        limits.apify_budget_usd = Number((limits.apify_budget_usd + searches * EXTRA_SEARCH_APIFY_USD).toFixed(2));
      }
      const pending = await client.query<{ n: number }>(
        "select count(*)::int n from lead_agent.candidates where run_id=$1 and status in ('discovered','researching')",
        [runId],
      );
      // Out of companies to research: the new allowance goes to a new search.
      const searchNext = searches > 0 && run.stage !== "draft_one" && (pending.rows[0]?.n ?? 0) === 0;
      const soft = Array.isArray(run.refined_icp?.soft_preferences) ? run.refined_icp.soft_preferences : [];
      const dropped = searchNext && soft[run.refills_used] ? [soft[run.refills_used]] : [];
      const stage = searchNext ? "discover" : run.stage;
      const status = STATUS_FOR_STAGE[stage];
      await client.query(
        `update lead_agent.runs set limits=$2::jsonb, status=$3, stage=$4, budget_request=null, stage_attempts=0,
           refills_used = case when $5::boolean then refills_used + 1 else refills_used end,
           soft_preferences_dropped = soft_preferences_dropped || $6::jsonb,
           runner_lease_until=null, runner_lease_id=null, updated_at=now()
         where id=$1`,
        [runId, JSON.stringify(limits), status, stage, searchNext, JSON.stringify(dropped)],
      );
      const parts = [
        searches ? `+${searches} search${searches === 1 ? "" : "es"} (+$${(searches * EXTRA_SEARCH_APIFY_USD).toFixed(2)} company search)` : "",
        agentUsd ? `+$${agentUsd.toFixed(2)} AI research` : "",
      ].filter(Boolean);
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message,detail)
         values ($1,'awaiting_budget',$2,$3,$4,$5::jsonb)`,
        [runId, status, stage, `Founder added budget: ${parts.join(", ") || "no change"}`, JSON.stringify({ searches, agent_usd: agentUsd, limits })],
      );
      return true;
    });
  }

  /**
   * Ends a paused run with what it has. Qualified leads still get their
   * drafts if the AI allowance allows; otherwise the run finishes as is.
   */
  async finishRun(runId: string): Promise<boolean> {
    const run = await this.getRun(runId);
    if (!run || run.status !== "awaiting_budget") return false;
    const waiting = await queryDb<{ n: number }>(
      `select count(*)::int n from lead_agent.candidates c join lead_agent.qualifications q on q.candidate_id=c.id and q.status='qualified'
        where c.run_id=$1 and c.draft_attempts < $2 and (select count(*) from lead_agent.outreach_drafts d where d.candidate_id=c.id) < 4`,
      [runId, MAX_DRAFT_ATTEMPTS],
    );
    const canDraft = run.stage !== "draft_one" && (waiting.rows[0]?.n ?? 0) > 0
      && run.limits.agent_budget_usd - Number(run.agent_cost_usd) >= MIN_STAGE_BUDGET_USD;
    await queryDb("update lead_agent.runs set budget_request=null, updated_at=now() where id=$1", [runId]);
    if (canDraft) {
      await this.transition(run, "drafting", "draft_one", "Founder chose to finish; drafting outreach for the qualified leads");
      return true;
    }
    await this.finalize(run);
    return true;
  }

  /**
   * A founder's call on a lead the checks could not settle. It is recorded as
   * the founder's decision, never as the model's, and an approved lead counts
   * toward the target and gets outreach drafted.
   */
  async decideCandidate(runId: string, candidateId: string, decision: "approve" | "reject", note: string): Promise<{ ok: boolean; companyName?: string }> {
    const company = await withTransaction(async (client) => {
      const status = decision === "approve" ? "qualified" : "not_qualified";
      const updated = await client.query<{ company_name: string }>(
        `update lead_agent.qualifications q
            set status=$3::lead_agent.qualification_status,
                checks = q.checks || jsonb_build_object('human_decision', jsonb_build_object(
                  'decision', $4::text, 'note', $5::text, 'decided_at', now(), 'previous_status', q.status))
           from lead_agent.candidates c
          where q.candidate_id=$2 and q.run_id=$1 and c.id=q.candidate_id and q.status='needs_review'
          returning c.company_name`,
        [runId, candidateId, status, decision, note.slice(0, 1000)],
      );
      const name = updated.rows[0]?.company_name;
      if (!name) return null;
      await client.query("update lead_agent.candidates set status=$2::lead_agent.candidate_status where id=$1", [candidateId, status]);
      await client.query(
        `insert into lead_agent.run_events (run_id,from_status,to_status,stage,message,detail)
         select id, status, status, stage, $2, $3::jsonb from lead_agent.runs where id=$1`,
        [runId, `Founder ${decision === "approve" ? "approved" : "rejected"} ${name} after review`, JSON.stringify({ candidate_id: candidateId, decision })],
      );
      return name;
    });
    if (!company) return { ok: false };
    await this.refreshQualifiedCount(runId);
    // A finished run gets outreach written for the lead the founder just approved.
    if (decision === "approve") {
      const run = await this.getRun(runId);
      if (run && (run.status === "complete" || run.status === "short_of_target")) {
        await this.transition(run, "drafting", "draft_one", `Drafting outreach for ${company}, approved by the founder`);
      }
    }
    return { ok: true, companyName: company };
  }
}
