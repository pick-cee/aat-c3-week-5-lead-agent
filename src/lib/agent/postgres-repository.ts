import { queryDb, withTransaction } from "@/lib/server/database";

import { redactForLog } from "./redaction";
import type {
  LeadAgentToolRepository,
  NewCandidate,
  ReservationDecision,
  StoredRunContext,
  ToolCallLog,
  ToolExecutionContext,
} from "./types";

type ReservationRow = {
  allowed: boolean;
  reason: string | null;
  current_value: string;
  limit_value: string;
};

type RunContextRow = {
  refined_icp: unknown;
  limits: Record<string, number>;
  qualified_count: number;
  target_leads: number;
  agent_cost_usd: string;
  apify_cost_usd: string;
  refills_used: number;
  excluded_domains: string[];
};

type CandidateRow = {
  id: string;
  company_name: string;
  domain: string;
  domain_canonical: string;
  discovery_payload: Record<string, unknown>;
};

function mapCandidate(row: CandidateRow) {
  return {
    id: row.id,
    companyName: row.company_name,
    domain: row.domain,
    domainCanonical: row.domain_canonical,
    discoveryPayload: row.discovery_payload,
  };
}

export class PostgresLeadAgentRepository implements LeadAgentToolRepository {
  async reserveToolUse(
    context: ToolExecutionContext,
    toolName: string,
  ): Promise<ReservationDecision> {
    const result = await queryDb<ReservationRow>(
      "select * from lead_agent.reserve_tool_call($1, $2, $3)",
      [context.runId, context.candidateId ?? null, toolName],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("Usage reservation returned no decision");
    }

    return {
      allowed: row.allowed,
      reason: row.reason ?? undefined,
      currentValue: Number(row.current_value),
      limitValue: Number(row.limit_value),
    };
  }

  async logToolCall(call: ToolCallLog): Promise<void> {
    await queryDb(
      `insert into lead_agent.tool_calls (
         run_id, candidate_id, stage, tool_name, purpose,
         input_summary, result_summary, status, error, cost_usd, duration_ms
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)`,
      [
        call.runId,
        call.candidateId ?? null,
        call.stage,
        call.toolName,
        call.purpose,
        JSON.stringify(redactForLog(call.inputSummary)),
        call.resultSummary ? JSON.stringify(redactForLog(call.resultSummary)) : null,
        call.status,
        call.error ?? null,
        call.costUsd ?? 0,
        call.durationMs ?? null,
      ],
    );
  }

  async getRunContext(runId: string): Promise<StoredRunContext> {
    const result = await queryDb<RunContextRow>(
      `select refined_icp, limits, qualified_count, target_leads,
              agent_cost_usd, apify_cost_usd, refills_used, excluded_domains
         from lead_agent.runs
        where id = $1`,
      [runId],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("Run not found");
    }

    return {
      refinedIcp: row.refined_icp,
      limits: row.limits,
      qualifiedCount: row.qualified_count,
      targetLeads: row.target_leads,
      agentCostUsd: Number(row.agent_cost_usd),
      apifyCostUsd: Number(row.apify_cost_usd),
      refillsUsed: row.refills_used,
      excludedDomains: Array.isArray(row.excluded_domains) ? row.excluded_domains.map(String) : [],
    };
  }

  async addApifyCost(runId: string, costUsd: number, complete: boolean, jobKey: string, summary: Record<string, unknown> = {}): Promise<void> {
    // $2 is cast explicitly: beside the literal 0, Postgres inferred integer
    // and rejected a real $0.00005 charge (run 815b1dda).
    await queryDb(
      `update lead_agent.runs
          set apify_cost_usd = apify_cost_usd + case
                when coalesce((apify_jobs -> ($4::text) ->> 'cost_recorded')::boolean,false) then 0::numeric else $2::numeric end,
              cost_complete = cost_complete and $3::boolean,
              apify_jobs = jsonb_set(apify_jobs,array[$4::text],
                coalesce(apify_jobs -> ($4::text),'{}'::jsonb) || $5::jsonb || jsonb_build_object('cost_recorded',true),true),
              updated_at = now()
        where id = $1`,
      [runId, costUsd, complete, jobKey, JSON.stringify(summary)],
    );
  }

  async hasFetchedWebsite(candidateId: string): Promise<boolean> {
    const result = await queryDb<{ fetched: boolean }>(
      `select exists (
         select 1 from lead_agent.sources
          where candidate_id = $1 and fetch_status in ('ok','too_large') and url not like 'discovery://%'
       ) as fetched`,
      [candidateId],
    );
    return Boolean(result.rows[0]?.fetched);
  }

  async getCandidate(candidateId: string) {
    const result = await queryDb<CandidateRow>(
      `select id, company_name, domain, domain_canonical, discovery_payload
         from lead_agent.candidates where id = $1`,
      [candidateId],
    );
    if (!result.rows[0]) throw new Error("Candidate not found");
    return mapCandidate(result.rows[0]);
  }

  async insertCandidates(
    runId: string,
    origin: string,
    records: NewCandidate[],
  ) {
    const stored = [];
    for (const record of records) {
      // The discovery record becomes the candidate's first citable excerpt, so
      // size band and headquarters (rarely on a homepage) rest on stored
      // evidence instead of forcing every lead to needs_review.
      const row = await withTransaction(async (client) => {
        const result = await client.query<CandidateRow>(
          `insert into lead_agent.candidates
             (run_id, company_name, domain, domain_canonical, origin, discovery_payload, status, skip_reason)
           values ($1, $2, $3, $4, $5, $6::jsonb,
                   case when $7::text is null then 'discovered' else 'skipped' end::lead_agent.candidate_status, $7::text)
           on conflict (run_id, domain_canonical) do nothing
           returning id, company_name, domain, domain_canonical, discovery_payload`,
          [runId, record.companyName, record.domain, record.domainCanonical, origin, JSON.stringify(record.discoveryPayload), record.skipReason ?? null],
        );
        const candidate = result.rows[0];
        if (!candidate) return null;
        const source = await client.query<{ id: string }>(
          `insert into lead_agent.sources
             (candidate_id, run_id, url, fetch_status, markdown_chars, from_cache,
              injection_suspected, injection_matches)
           values ($1, $2, $3, 'ok', $4, false, $5, $6::jsonb)
           returning id`,
          [candidate.id, runId, record.evidence.url, record.evidence.text.length,
           record.evidence.injectionMatches.length > 0, JSON.stringify(record.evidence.injectionMatches)],
        );
        await client.query(
          `insert into lead_agent.excerpts (source_id, candidate_id, ordinal, text)
           values ($1, $2, 1, $3)`,
          [source.rows[0]!.id, candidate.id, record.evidence.text],
        );
        return candidate;
      });
      if (row) stored.push(mapCandidate(row));
    }
    return stored;
  }

  async storeSource(input: {
    runId: string;
    candidateId: string;
    url: string;
    fetchStatus: string;
    httpStatus?: number;
    markdownChars: number;
    fromCache: boolean;
    injectionSuspected: boolean;
    injectionMatches: string[];
    fetchError?: string;
  }): Promise<string> {
    const result = await queryDb<{ id: string }>(
      `insert into lead_agent.sources
         (candidate_id, run_id, url, fetch_status, http_status, markdown_chars,
          from_cache, injection_suspected, injection_matches, fetch_error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       on conflict (candidate_id, url) do update set
         fetch_status = excluded.fetch_status,
         http_status = excluded.http_status,
         markdown_chars = excluded.markdown_chars,
         from_cache = excluded.from_cache,
         injection_suspected = excluded.injection_suspected,
         injection_matches = excluded.injection_matches,
         fetch_error = excluded.fetch_error,
         fetched_at = now()
       returning id`,
      [input.candidateId, input.runId, input.url, input.fetchStatus, input.httpStatus ?? null,
       input.markdownChars, input.fromCache, input.injectionSuspected,
       JSON.stringify(input.injectionMatches), input.fetchError ?? null],
    );
    if (!result.rows[0]) throw new Error("Source was not stored");
    return result.rows[0].id;
  }

  async storeExcerpts(input: {
    sourceId: string;
    candidateId: string;
    excerpts: string[];
  }) {
    // Labels are append-only per candidate. The old upsert numbered every page
    // from E1, so a second page silently overwrote the text a first-page
    // citation pointed at.
    return withTransaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`excerpts:${input.candidateId}`]);
      const stored = [];
      for (const text of input.excerpts) {
        const existing = await client.query<{ id: string; ordinal: number; text: string }>(
          `select id, ordinal, text from lead_agent.excerpts
            where candidate_id = $1 and source_id = $2 and text = $3 limit 1`,
          [input.candidateId, input.sourceId, text],
        );
        const row = existing.rows[0] ?? (await client.query<{ id: string; ordinal: number; text: string }>(
          `insert into lead_agent.excerpts (source_id, candidate_id, ordinal, text)
           select $1, $2, coalesce(max(ordinal), 0) + 1, $3
             from lead_agent.excerpts where candidate_id = $2
           returning id, ordinal, text`,
          [input.sourceId, input.candidateId, text],
        )).rows[0];
        if (row) stored.push({ id: row.id, label: `E${row.ordinal}`, text: row.text });
      }
      return stored;
    });
  }

  async getExcerpts(candidateId: string) {
    const result = await queryDb<{ id: string; ordinal: number; text: string }>(
      "select id, ordinal, text from lead_agent.excerpts where candidate_id = $1 order by ordinal",
      [candidateId],
    );
    return result.rows.map((row) => ({ id: row.id, label: `E${row.ordinal}`, text: row.text }));
  }

  async saveQualification(input: {
    context: ToolExecutionContext;
    status: "qualified" | "not_qualified" | "needs_review";
    confidence: number;
    fitReasons: unknown;
    concerns: unknown;
    hardFilterResults: unknown;
    sourceSummary: string;
    whyNow?: string;
    checks: unknown;
    modelUsed: string;
  }): Promise<void> {
    if (!input.context.candidateId) throw new Error("Qualification requires a candidate");
    await queryDb(
      `insert into lead_agent.qualifications
        (candidate_id, run_id, status, confidence, fit_reasons, concerns,
         hard_filter_results, source_summary, why_now, checks, model_used)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11)
       on conflict (candidate_id) do update set
         status=excluded.status, confidence=excluded.confidence,
         fit_reasons=excluded.fit_reasons, concerns=excluded.concerns,
         hard_filter_results=excluded.hard_filter_results,
         source_summary=excluded.source_summary, why_now=excluded.why_now,
         checks=excluded.checks, model_used=excluded.model_used, created_at=now()`,
      [input.context.candidateId, input.context.runId, input.status, input.confidence,
       JSON.stringify(input.fitReasons), JSON.stringify(input.concerns),
       JSON.stringify(input.hardFilterResults), input.sourceSummary, input.whyNow ?? null,
       JSON.stringify(input.checks), input.modelUsed],
    );
    await queryDb(
      "update lead_agent.candidates set status = $1 where id = $2 and run_id = $3",
      [input.status, input.context.candidateId, input.context.runId],
    );
  }

  async saveOutreach(input: {
    context: ToolExecutionContext;
    drafts: Array<{ channel: "email" | "linkedin"; step: number; subject?: string; body: string; personalizationNote: string; citedExcerptIds: string[]; checks: unknown; modelUsed: string }>;
  }): Promise<void> {
    if (!input.context.candidateId) throw new Error("Outreach requires a candidate");
    for (const draft of input.drafts) {
      await queryDb(
        `insert into lead_agent.outreach_drafts
          (candidate_id, run_id, channel, step, subject, body, personalization_note,
           cited_excerpt_ids, checks, status, version, model_used)
         values ($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9::jsonb,'draft',1,$10)
         on conflict (candidate_id, channel, step, version) do update set
           subject=excluded.subject, body=excluded.body,
           personalization_note=excluded.personalization_note,
           cited_excerpt_ids=excluded.cited_excerpt_ids, checks=excluded.checks,
           model_used=excluded.model_used, created_at=now()`,
        [input.context.candidateId, input.context.runId, draft.channel, draft.step,
         draft.subject ?? null, draft.body, draft.personalizationNote,
         draft.citedExcerptIds, JSON.stringify(draft.checks), draft.modelUsed],
      );
    }
  }
}
