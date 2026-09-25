import {
  createSdkMcpServer,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { checkOutreachCopy } from "@/lib/checks/copy";
import type { RefinedIcp } from "@/lib/checks/icp";
import { checkQualification } from "@/lib/checks/qualification";
import { DISCOVERY_SOURCE_PREFIX, STAGE_MODELS } from "@/lib/constants";
import { clearlyAboveHeadcount, headquartersOutside, industryAffinity, industryIds, linkedInCompanySizes, linkedInLocations, normalizeKeywords } from "@/lib/providers/linkedin-filters";
import { fixtureDiscoveryProvider, fixtureSiteScraper } from "@/lib/providers/fixture";
import type { CompanyDiscoveryProvider, SiteScraper } from "@/lib/providers/types";

import { canonicalizeDomain, isCandidateDomain } from "./domain";
import { chunkMarkdown, discoveryEvidenceText } from "./excerpts";
import { scanForPromptInjection } from "./injection-scan";
import { safeErrorMessage } from "./redaction";
import type {
  LeadAgentToolRepository,
  ToolExecutionContext,
} from "./types";

type TextToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const WRITE_ANNOTATIONS = {
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
} as const;

// Company facts only. The member count, specialities and company type were
// added because without them a size filter could never be proven and every
// in-range company ended in review (run 12f27441). `hiring` is the company's
// open job ads as title, place, date and public link: the evidence for a
// "hiring for a role" must-have. None is contact-shaped; ad text and posters
// are never kept.
const DISCOVERY_ALLOWLIST = [
  "company_name",
  "domain",
  "headcount",
  "linkedin_members",
  "industry",
  "location",
  "description",
  "specialities",
  "company_type",
  "hiring",
  "discovery_source",
  "funding",
] as const;

const PAGE_PREVIEW_CHARS = 4_000;

type AllowedDiscoveryRecord = Partial<
  Record<(typeof DISCOVERY_ALLOWLIST)[number], string | number | null>
>;

function stripDiscoveryRecord(
  record: Record<string, unknown>,
): AllowedDiscoveryRecord {
  return Object.fromEntries(
    DISCOVERY_ALLOWLIST.filter((key) => key in record).map((key) => [key, record[key]]),
  ) as AllowedDiscoveryRecord;
}

function textResult(data: Record<string, unknown>): TextToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

async function executeLoggedTool(
  repository: LeadAgentToolRepository,
  context: ToolExecutionContext,
  toolName: string,
  purpose: string,
  input: Record<string, unknown>,
  operation: () => Promise<Record<string, unknown>>,
  summarize: (result: Record<string, unknown>) => Record<string, unknown> = (result) => result,
): Promise<TextToolResult> {
  const startedAt = Date.now();

  try {
    const result = await operation();
    await repository.logToolCall({
      ...context,
      toolName,
      purpose,
      inputSummary: input,
      resultSummary: summarize(result),
      status: "ok",
      durationMs: Date.now() - startedAt,
      costUsd: typeof result.provider_cost_usd === "number" ? result.provider_cost_usd : 0,
    });
    return textResult(result);
  } catch (error) {
    const safeError = safeErrorMessage(error);

    try {
      await repository.logToolCall({
        ...context,
        toolName,
        purpose,
        inputSummary: input,
        status: "error",
        error: safeError,
        durationMs: Date.now() - startedAt,
        costUsd: 0,
      });
    } catch {
      // The composed result still fails closed if the audit store is unavailable.
    }

    return {
      content: [
        {
          type: "text",
          text: `The ${toolName} tool failed safely: ${safeError}`,
        },
      ],
      isError: true,
    };
  }
}

export function createLeadAgentToolServer(
  context: ToolExecutionContext,
  repository: LeadAgentToolRepository,
  providers: {
    discovery?: CompanyDiscoveryProvider;
    jobAds?: CompanyDiscoveryProvider;
    scraper?: SiteScraper;
  } = {},
  onlyTools?: readonly string[],
) {
  const discoveryProvider = providers.discovery ?? fixtureDiscoveryProvider;
  const jobAdsProvider = providers.jobAds ?? fixtureDiscoveryProvider;
  const siteScraper = providers.scraper ?? fixtureSiteScraper;
  // Page text fetched in this stage, keyed by source id. store_excerpts chunks
  // from here so the agent cannot hand back text of its own as "evidence".
  const pageText = new Map<string, string>();

  /**
   * Shared by both searches, so the allowlist, the set-asides, the paid-cost
   * record and the audit shape are identical whichever one the agent chose.
   */
  async function ingestDiscovery(
    run: Awaited<ReturnType<LeadAgentToolRepository["getRunContext"]>>,
    jobKey: string,
    locations: string[],
    discovery: Awaited<ReturnType<CompanyDiscoveryProvider["search"]>>,
    filters: Record<string, unknown>,
  ) {
    const storedLimit = run.limits.max_candidates;
    const icp = (run.refinedIcp ?? {}) as Partial<RefinedIcp>;
    const excluded = new Set(run.excludedDomains.map((domain) => canonicalizeDomain(domain)));
    const companies = discovery.records
      .map((raw) => ({ ...raw, domain: raw.domain ?? raw.company_domain }))
      .map((record) => stripDiscoveryRecord(record))
      .filter((record) => typeof record.company_name === "string" && typeof record.domain === "string")
      .slice(0, storedLimit);
    const fresh = companies.filter((company) => !excluded.has(canonicalizeDomain(String(company.domain))));
    const origin = run.refillsUsed === 0 ? "discovery" : `refill_${run.refillsUsed}`;
    // What the record already rules out is set aside with its reason, not
    // researched: each research step costs about $0.06 to $0.09 to reach a
    // verdict the discovery record states. Unknown values are always researched.
    const headcountRange = String(icp.headcount_range ?? "");
    const setAsideFor = (company: AllowedDiscoveryRecord): { kind: "location" | "size"; reason: string } | null => {
      const location = typeof company.location === "string" ? company.location : undefined;
      if (headquartersOutside(location, locations)) {
        return { kind: "location", reason: `Headquartered in ${location}, outside ${locations.join(" / ")}. Set aside without spending research on it.` };
      }
      const size = clearlyAboveHeadcount(company.linkedin_members, headcountRange);
      return size ? { kind: "size", reason: size } : null;
    };
    const setAside = new Map(fresh.flatMap((company) => {
      const verdict = setAsideFor(company);
      return verdict ? [[canonicalizeDomain(String(company.domain)), verdict] as const] : [];
    }));
    const stored = await repository.insertCandidates(
      context.runId,
      origin,
      fresh.map((company) => {
        const domainCanonical = canonicalizeDomain(String(company.domain));
        const text = discoveryEvidenceText(company);
        const verdict = setAside.get(domainCanonical);
        return {
          companyName: String(company.company_name),
          domain: String(company.domain),
          domainCanonical,
          discoveryPayload: company,
          evidence: { url: `${DISCOVERY_SOURCE_PREFIX}${domainCanonical}`, text, injectionMatches: scanForPromptInjection(text) },
          ...(verdict ? { skipReason: verdict.reason } : { priority: industryAffinity(company.industry, icp) }),
        };
      }),
    );
    const outsideLocation = stored.filter((company) => setAside.get(company.domainCanonical)?.kind === "location").length;
    const tooLarge = stored.filter((company) => setAside.get(company.domainCanonical)?.kind === "size").length;
    const summary = {
      ...filters,
      locations,
      start_page: discovery.startPage ?? 1,
      returned_count: discovery.returnedCount ?? discovery.records.length,
      total_available: discovery.totalAvailable ?? null,
      stored_count: stored.length - outsideLocation - tooLarge,
      outside_location: outsideLocation,
      too_large: tooLarge,
    };
    await repository.addApifyCost(context.runId, discovery.costUsd, discovery.costComplete, jobKey, summary);
    return {
      fixture: discovery.runId === undefined && discovery.costUsd === 0,
      applied_limit: storedLimit,
      filters_applied: { ...filters, locations },
      results_returned: summary.returned_count,
      total_matching_on_linkedin: summary.total_available,
      skipped_without_website: discovery.skippedNoWebsite ?? 0,
      skipped_previously_decided: companies.length - fresh.length,
      skipped_already_in_run: fresh.length - stored.length,
      set_aside_headquartered_elsewhere: outsideLocation,
      set_aside_clearly_too_large: tooLarge,
      stored_count: summary.stored_count,
      companies: stored.filter((company) => !setAside.has(company.domainCanonical)).map((company) => ({ name: company.companyName, domain: company.domain })),
      provider_cost_usd: discovery.costUsd,
      cost_complete: discovery.costComplete,
    };
  }

  async function searchContext() {
    const run = await repository.getRunContext(context.runId);
    const storedLimit = run.limits.max_candidates;
    if (!Number.isSafeInteger(storedLimit) || storedLimit <= 0) {
      throw new Error("Stored candidate limit is invalid");
    }
    // Hard filters froze at confirmation, so geography and size come from the
    // stored ICP, never from the agent or anything it read.
    const icp = (run.refinedIcp ?? {}) as Partial<RefinedIcp>;
    return {
      run,
      jobKey: `discovery_${run.refillsUsed}`,
      locations: linkedInLocations(Array.isArray(icp.geography) ? icp.geography.map(String) : []),
      companySizes: linkedInCompanySizes(String(icp.headcount_range ?? "")),
      maxChargeUsd: Math.max(0, run.limits.apify_budget_usd - run.apifyCostUsd),
    };
  }

  const searchCompanies = tool(
    "search_companies",
    "Search LinkedIn company records through Apify. Choose 1 to 4 LinkedIn industry names (exact names from the list in your instructions); this is the main filter. Keywords are optional, at most 2 words, and match company names, so leave them empty unless the industry alone is too broad. Location and company-size filters are applied automatically from the confirmed ICP. The result cap comes from the stored run limit; requested_limit is logged but never trusted.",
    {
      purpose: z.string().min(1).max(300),
      industries: z.array(z.string().min(2).max(120)).max(4).default([]),
      keywords: z.string().max(40).default(""),
      requested_limit: z.number().int().positive().optional(),
    },
    async (args) =>
      executeLoggedTool(
        repository,
        context,
        "mcp__lead_agent__search_companies",
        args.purpose,
        args,
        async () => {
          const { run, jobKey, locations, companySizes, maxChargeUsd } = await searchContext();
          const industries = industryIds(args.industries);
          const keywords = normalizeKeywords(args.keywords).split(" ").filter(Boolean).slice(0, 3).join(" ");
          if (industries.ids.length === 0 && !keywords) {
            throw new Error(`Choose at least one LinkedIn industry from the list${industries.unknown.length ? ` (not recognised: ${industries.unknown.join(", ")})` : ""}, or give up to 2 keywords`);
          }
          const discovery = await discoveryProvider.search({
            keywords, industryIds: industries.ids, locations, companySizes,
            limit: run.limits.max_candidates, maxChargeUsd, runId: context.runId, jobKey,
          });
          const result = await ingestDiscovery(run, jobKey, locations, discovery, { keywords, industries: industries.labels, company_sizes: companySizes });
          return { ...result, requested_limit_ignored: args.requested_limit ?? null, industries_not_recognised: industries.unknown };
        },
      ),
    WRITE_ANNOTATIONS,
  );

  const searchJobAds = tool(
    "search_job_ads",
    "Search LinkedIn job ads posted in the last month in the confirmed ICP's location, and store the companies behind them. Use it when a must-have requires the company to be hiring for a role: every company found is hiring, and its ads are stored as evidence. Give the role as the job-title words an ad would use (for example \"customer service\") and, optionally, one sector word the ads would contain (for example \"ecommerce\"). Location, the ad cap and the company cap come from the run record; requested_limit is logged but never trusted.",
    {
      purpose: z.string().min(1).max(300),
      role: z.string().min(2).max(60),
      sector: z.string().max(30).default(""),
      requested_limit: z.number().int().positive().optional(),
    },
    async (args) =>
      executeLoggedTool(
        repository,
        context,
        "mcp__lead_agent__search_job_ads",
        args.purpose,
        args,
        async () => {
          const { run, jobKey, locations, maxChargeUsd } = await searchContext();
          const role = normalizeKeywords(args.role).split(" ").filter(Boolean).slice(0, 4).join(" ");
          const sector = normalizeKeywords(args.sector).split(" ").filter(Boolean).slice(0, 2).join(" ");
          if (!role) throw new Error("Give the role as job-title words, for example \"customer service\"");
          const keywords = [role, sector].filter(Boolean).join(" ");
          const discovery = await jobAdsProvider.search({
            keywords, locations, companySizes: [],
            limit: run.limits.max_candidates, maxChargeUsd, runId: context.runId, jobKey,
          });
          const result = await ingestDiscovery(run, jobKey, locations, discovery, { keywords, role, sector, source: "job_ads" });
          return { ...result, requested_limit_ignored: args.requested_limit ?? null };
        },
      ),
    WRITE_ANNOTATIONS,
  );

  const scrapeSite = tool(
    "scrape_site",
    "Fetch one page of the current candidate's own website through Firecrawl. Returns a preview of the page and a source_id; call store_excerpts with that source_id to receive citable excerpt labels.",
    {
      purpose: z.string().min(1).max(300),
      url: z.string().url(),
    },
    async (args) =>
      executeLoggedTool(
        repository,
        context,
        "mcp__lead_agent__scrape_site",
        args.purpose,
        args,
        async () => {
          if (!context.candidateId) throw new Error("Scraping requires a candidate");
          const candidate = await repository.getCandidate(context.candidateId);
          if (!isCandidateDomain(args.url, candidate.domainCanonical)) {
            throw new Error("URL is outside the candidate's registrable domain");
          }
          const scraped = await siteScraper.scrape(args.url);
          const matches = scanForPromptInjection(scraped.markdown);
          const sourceId = await repository.storeSource({
            runId: context.runId,
            candidateId: context.candidateId,
            url: scraped.url,
            fetchStatus: scraped.fetchStatus,
            httpStatus: scraped.httpStatus,
            markdownChars: scraped.markdown.length,
            fromCache: scraped.fromCache,
            injectionSuspected: matches.length > 0,
            injectionMatches: matches,
            fetchError: scraped.error,
          });
          if (scraped.markdown) pageText.set(sourceId, scraped.markdown);
          return {
            source_id: sourceId,
            url: scraped.url,
            fetch_status: scraped.fetchStatus,
            markdown_chars: scraped.markdown.length,
            preview: scraped.markdown
              ? `<untrusted_company_source>\n${scraped.markdown.slice(0, PAGE_PREVIEW_CHARS)}\n</untrusted_company_source>`
              : "",
            preview_truncated: scraped.markdown.length > PAGE_PREVIEW_CHARS,
            from_cache: scraped.fromCache,
            injection_suspected: matches.length > 0,
            ...(scraped.error ? { fetch_error: scraped.error } : {}),
          };
        },
        ({ preview: _, ...summary }) => summary,
      ),
    WRITE_ANNOTATIONS,
  );

  const storeExcerpts = tool(
    "store_excerpts",
    "Deterministically chunk the page text fetched for source_id in this stage and return stable excerpt labels (E2, E3, ...) for the current candidate. E1 is always the stored discovery record.",
    {
      purpose: z.string().min(1).max(300),
      source_id: z.string().uuid(),
    },
    async (args) =>
      executeLoggedTool(
        repository,
        context,
        "mcp__lead_agent__store_excerpts",
        args.purpose,
        args,
        async () => {
          if (!context.candidateId) throw new Error("Excerpt storage requires a candidate");
          const text = pageText.get(args.source_id);
          if (!text) throw new Error("No page text is held for that source in this step. Scrape the page first, then store its excerpts.");
          const chunks = chunkMarkdown(text);
          if (chunks.length === 0) throw new Error("The page had no citable text after removing navigation and links");
          const excerpts = await repository.storeExcerpts({ sourceId: args.source_id, candidateId: context.candidateId, excerpts: chunks });
          return {
            source_id: args.source_id,
            excerpts: excerpts.map((excerpt) => ({ label: excerpt.label, text: excerpt.text })),
          };
        },
        (result) => ({
          source_id: result.source_id,
          labels: (result.excerpts as Array<{ label: string }>).map((excerpt) => excerpt.label),
        }),
      ),
    WRITE_ANNOTATIONS,
  );

  const recordQualification = tool(
    "record_qualification",
    "Validate and record an evidence-backed qualification decision for the current candidate.",
    {
      purpose: z.string().min(1).max(300),
      status: z.enum(["qualified", "not_qualified", "needs_review"]),
      confidence: z.number().min(0).max(1),
      fit_reasons: z.array(
        z.object({
          text: z.string().min(1),
          excerpt_labels: z.array(z.string().regex(/^E\d+$/)).min(1),
        }),
      ),
      concerns: z.array(
        z.object({
          text: z.string().min(1),
          excerpt_labels: z.array(z.string().regex(/^E\d+$/)).min(1),
        }),
      ),
      hard_filter_results: z.array(
        z.object({
          criterion: z.string().min(1),
          verdict: z.enum(["pass", "fail", "unknown"]),
          excerpt_labels: z.array(z.string().regex(/^E\d+$/)),
        }),
      ),
      source_summary: z.string().min(1),
      why_now: z.string().optional(),
    },
    async (args) =>
      executeLoggedTool(
        repository,
        context,
        "mcp__lead_agent__record_qualification",
        args.purpose,
        args,
        async () => {
          if (!context.candidateId) throw new Error("Qualification requires a candidate");
          const [run, excerpts, hasWebsite] = await Promise.all([
            repository.getRunContext(context.runId),
            repository.getExcerpts(context.candidateId),
            repository.hasFetchedWebsite(context.candidateId),
          ]);
          const hardFilters = Array.isArray((run.refinedIcp as { hard_filters?: unknown[] } | null)?.hard_filters)
            ? ((run.refinedIcp as { hard_filters: unknown[] }).hard_filters.map(String))
            : [];
          const checked = checkQualification(args, hardFilters, excerpts, hasWebsite, JSON.stringify(run.refinedIcp ?? {}));
          if (!checked.accepted) throw new Error(`Qualification rejected: ${checked.errors.join("; ")}`);
          const attachIds = <T extends { excerpt_labels: string[] }>(claims: T[]) => claims.map((claim) => ({ ...claim, excerpt_ids: claim.excerpt_labels.map((label) => checked.excerptIdsByLabel[label]) }));
          await repository.saveQualification({
            context,
            status: checked.status,
            confidence: checked.confidence,
            fitReasons: attachIds(args.fit_reasons),
            concerns: attachIds(args.concerns),
            hardFilterResults: attachIds(args.hard_filter_results),
            sourceSummary: args.source_summary,
            whyNow: args.why_now,
            checks: { passed: true, requested_status: args.status, downgrades: checked.downgrades, adjustments: checked.adjustments },
            modelUsed: STAGE_MODELS.qualify_one,
          });
          return { accepted: true, status: checked.status, downgrades: checked.downgrades };
        },
      ),
    WRITE_ANNOTATIONS,
  );

  const recordOutreach = tool(
    "record_outreach",
    "Validate and record a three-email sequence plus a LinkedIn draft for the current qualified lead.",
    {
      purpose: z.string().min(1).max(300),
      drafts: z.array(
        z.object({
          channel: z.enum(["email", "linkedin"]),
          step: z.number().int().min(1).max(3),
          subject: z.string().optional(),
          body: z.string().min(1),
          personalization_note: z.string().min(1),
          excerpt_labels: z.array(z.string().regex(/^E\d+$/)).min(1),
        }),
      ).length(4),
    },
    async (args) =>
      executeLoggedTool(
        repository,
        context,
        "mcp__lead_agent__record_outreach",
        args.purpose,
        { purpose: args.purpose, draft_count: args.drafts.length },
        async () => {
          if (!context.candidateId) throw new Error("Outreach requires a candidate");
          const [run, candidate, excerpts] = await Promise.all([
            repository.getRunContext(context.runId),
            repository.getCandidate(context.candidateId),
            repository.getExcerpts(context.candidateId),
          ]);
          const checked = checkOutreachCopy(args.drafts, excerpts, [candidate.companyName, candidate.domain, JSON.stringify(candidate.discoveryPayload)], [JSON.stringify(run.refinedIcp)]);
          if (!checked.accepted) throw new Error(`Outreach rejected: ${checked.errors.join("; ")}`);
          const ids = Object.fromEntries(excerpts.map((excerpt) => [excerpt.label, excerpt.id]));
          await repository.saveOutreach({
            context,
            drafts: checked.drafts.map((draft) => ({
              channel: draft.channel,
              step: draft.step,
              subject: draft.subject,
              body: draft.body,
              personalizationNote: draft.personalization_note,
              citedExcerptIds: draft.excerpt_labels.map((label) => ids[label]).filter(Boolean),
              checks: { passed: true, removed_em_dashes: checked.removedEmDashes, removed_evidence_labels: checked.removedEvidenceLabels },
              modelUsed: STAGE_MODELS.draft_one,
            })),
          });
          return { accepted: true, draft_count: checked.drafts.length, removed_em_dashes: checked.removedEmDashes, removed_evidence_labels: checked.removedEvidenceLabels };
        },
      ),
    WRITE_ANNOTATIONS,
  );

  const getRunContext = tool(
    "get_run_context",
    "Read the confirmed ICP, stored limits, progress counts, and separate remaining budgets. This tool cannot change run data.",
    {
      purpose: z.string().min(1).max(300),
    },
    async (args) =>
      executeLoggedTool(
        repository,
        context,
        "mcp__lead_agent__get_run_context",
        args.purpose,
        args,
        async () => {
          const run = await repository.getRunContext(context.runId);
          return {
            refined_icp: run.refinedIcp,
            limits: run.limits,
            qualified_count: run.qualifiedCount,
            target_leads: run.targetLeads,
            refills_used: run.refillsUsed,
            agent_cost_estimate_usd: run.agentCostUsd,
            apify_cost_usd: run.apifyCostUsd,
            agent_budget_remaining_usd: Math.max(
              0,
              run.limits.agent_budget_usd - run.agentCostUsd,
            ),
            apify_budget_remaining_usd: Math.max(
              0,
              run.limits.apify_budget_usd - run.apifyCostUsd,
            ),
          };
        },
      ),
    WRITE_ANNOTATIONS,
  );

  const all = [searchCompanies, searchJobAds, scrapeSite, storeExcerpts, recordQualification, recordOutreach, getRunContext];
  return createSdkMcpServer({
    name: "lead_agent",
    version: "0.2.0",
    // A stage sees only its own tools. allowedTools already refused the rest,
    // but every drafting step still carried search and scrape definitions in
    // its context, and paid to cache them.
    tools: onlyTools ? all.filter((item) => onlyTools.includes(`mcp__lead_agent__${item.name}`)) : all,
  });
}

export { DISCOVERY_ALLOWLIST, stripDiscoveryRecord };
