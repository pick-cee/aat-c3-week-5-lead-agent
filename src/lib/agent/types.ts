import type { LeadAgentStage } from "@/lib/constants";

export type ToolCallStatus = "ok" | "error" | "refused";

export type ToolExecutionContext = {
  runId: string;
  candidateId?: string;
  stage: LeadAgentStage;
};

export type ToolCallLog = ToolExecutionContext & {
  toolName: string;
  purpose: string;
  inputSummary: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  status: ToolCallStatus;
  error?: string;
  costUsd?: number;
  durationMs?: number;
};

export type ReservationDecision = {
  allowed: boolean;
  reason?: string;
  currentValue: number;
  limitValue: number;
};

export interface UsageGuardRepository {
  reserveToolUse(
    context: ToolExecutionContext,
    toolName: string,
  ): Promise<ReservationDecision>;
  logToolCall(call: ToolCallLog): Promise<void>;
}

export type StoredRunContext = {
  refinedIcp: unknown;
  limits: Record<string, number>;
  qualifiedCount: number;
  targetLeads: number;
  agentCostUsd: number;
  apifyCostUsd: number;
  refillsUsed: number;
  excludedDomains: string[];
};

export type NewCandidate = {
  companyName: string;
  domain: string;
  domainCanonical: string;
  discoveryPayload: Record<string, unknown>;
  evidence: { url: string; text: string; injectionMatches: string[] };
  /** Stored but not researched, with the reason shown to the founder. */
  skipReason?: string;
};

export type CandidateRecord = {
  id: string;
  companyName: string;
  domain: string;
  domainCanonical: string;
  discoveryPayload: Record<string, unknown>;
};

export type StoredExcerpt = {
  id: string;
  label: string;
  text: string;
};

export interface LeadAgentToolRepository extends UsageGuardRepository {
  getRunContext(runId: string): Promise<StoredRunContext>;
  addApifyCost(runId: string, costUsd: number, complete: boolean, jobKey: string, summary?: Record<string, unknown>): Promise<void>;
  getCandidate(candidateId: string): Promise<CandidateRecord>;
  insertCandidates(
    runId: string,
    origin: string,
    records: NewCandidate[],
  ): Promise<CandidateRecord[]>;
  hasFetchedWebsite(candidateId: string): Promise<boolean>;
  storeSource(input: {
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
  }): Promise<string>;
  storeExcerpts(input: {
    sourceId: string;
    candidateId: string;
    excerpts: string[];
  }): Promise<StoredExcerpt[]>;
  getExcerpts(candidateId: string): Promise<StoredExcerpt[]>;
  saveQualification(input: {
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
  }): Promise<void>;
  saveOutreach(input: {
    context: ToolExecutionContext;
    drafts: Array<{
      channel: "email" | "linkedin";
      step: number;
      subject?: string;
      body: string;
      personalizationNote: string;
      citedExcerptIds: string[];
      checks: unknown;
      modelUsed: string;
    }>;
  }): Promise<void>;
}
