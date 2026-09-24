export const PRICES_VERIFIED_ON = "2026-09-24" as const;

export const LEAD_TARGET = 10;
export const DISCOVERY_POOL_MULTIPLIER = 3;
export const MAX_REFILLS = 2;
export const MAX_CANDIDATES = LEAD_TARGET * DISCOVERY_POOL_MULTIPLIER;
export const MAX_APIFY_CALLS = 1 + MAX_REFILLS;
// Sized from run 6cd3a95a: about 8 tool calls and 2 scrapes per company, and a
// 30-company pool plus refills. 120 calls ran out after 12 companies.
export const MAX_SCRAPES_TOTAL = 90;
export const MAX_SCRAPES_PER_COMPANY = 3;
export const MAX_TOOL_CALLS = 250;
export const MAX_RESEARCH_ATTEMPTS = 3;
// One step researches several companies at once and can take a few minutes;
// the lease must outlast it or a second runner starts the same work.
export const RUNNER_LEASE_SECONDS = 300;
export const RESEARCH_PARALLELISM = 4;
export const DRAFT_PARALLELISM = 3;
// A company still marked researching after this long lost its runner.
export const STALE_RESEARCH_MINUTES = 10;
export const MAIN_SERVER_SCHEDULER_INTERVAL_SECONDS = 15;

// Measured: about $0.10 of AI per researched company and $0.08 per drafted
// lead. Reaching ten qualified from ~25 researched needs roughly $3.
export const AGENT_BUDGET_USD = 3;
export const APIFY_BUDGET_USD = 0.5;
// Below this, a step is not started; the founder is asked for more instead.
export const MIN_STAGE_BUDGET_USD = 0.05;
// A founder-approved extra search: one 30-company page at $0.004 plus a start.
export const EXTRA_SEARCH_APIFY_USD = 0.15;
export const MAX_REFILLS_CEILING = 8;
export const AGENT_TOPUP_OPTIONS_USD = [1, 2] as const;
// Google Search returned encyclopaedia, job-board and video pages rather than
// companies (measured 2026-09-24), so each "candidate" cost a research step to
// reject. This actor returns company records with website, size band and HQ,
// and filters by location and size before anything is charged.
export const APIFY_ACTOR_ID = "harvestapi~linkedin-company-search";
export const APIFY_ACTOR_RESULT_LIMIT_FIELD = "maxItems";
export const APIFY_ACTOR_MODE = "full";
// Starter plan = BRONZE tier on the actor's published pay-per-event table.
export const APIFY_ACTOR_START_USD = 0.001;
export const APIFY_COMPANY_RESULT_USD = 0.004;
export const APIFY_RESULTS_PER_PAGE = 50;
export const APIFY_ACTOR_MAX_PAGE = 20;
export const APIFY_PROVIDER_WAIT_SECONDS = 240;
export const APIFY_REQUEST_WAIT_SECONDS = 60;
// Charged-event counts settle a few seconds after SUCCEEDED; reading cost at
// that instant recorded $0 for a run that cost $0.021.
export const APIFY_COST_SETTLE_SECONDS = 15;
export const APIFY_ACTOR_MAX_RESULTS = 50;
export const APIFY_JOB_START_STALE_SECONDS = 120;
export const LINKEDIN_COMPANY_SIZES = [
  { label: "1-10", min: 1, max: 10 },
  { label: "11-50", min: 11, max: 50 },
  { label: "51-200", min: 51, max: 200 },
  { label: "201-500", min: 201, max: 500 },
  { label: "501-1000", min: 501, max: 1_000 },
  { label: "1001-5000", min: 1_001, max: 5_000 },
  { label: "5001-10000", min: 5_001, max: 10_000 },
  { label: "10001+", min: 10_001, max: Number.POSITIVE_INFINITY },
] as const;
export const DISCOVERY_SOURCE_PREFIX = "discovery://linkedin-company-search/";
export const TEST_EMAIL_COOLDOWN_SECONDS = 60;

export const STAGE_LIMITS = {
  refine_icp: { maxTurns: 8, maxBudgetUsd: 0.15 },
  discover: { maxTurns: 8, maxBudgetUsd: 0.1 },
  // Successful research cost $0.06 to $0.12 in run 6cd3a95a, so a $0.12 cap
  // left no room for a single corrected attempt. The cap stops runaways.
  qualify_one: { maxTurns: 10, maxBudgetUsd: 0.25 },
  draft_one: { maxTurns: 8, maxBudgetUsd: 0.1 },
} as const;

export const CLAUDE_MODELS = {
  economical: "claude-haiku-4-5-20251001",
  judgment: "claude-sonnet-5",
} as const;

export const STAGE_MODELS = {
  refine_icp: CLAUDE_MODELS.economical,
  discover: CLAUDE_MODELS.economical,
  qualify_one: CLAUDE_MODELS.judgment,
  draft_one: CLAUDE_MODELS.judgment,
} as const;

export const CLAUDE_PRICES_USD_PER_MILLION_TOKENS = {
  [CLAUDE_MODELS.economical]: { input: 1, output: 5 },
  [CLAUDE_MODELS.judgment]: { input: 2, output: 10 },
} as const;

export const APIFY_UNIT_PRICE = {
  status: "verified_live_actor_pricing_and_paid_validation",
  pricingModel: "PAY_PER_EVENT",
  usdPerCompanyStarterTier: APIFY_COMPANY_RESULT_USD,
  usdPerActorStart: APIFY_ACTOR_START_USD,
  // One validation run: 5 companies, $0.021 billed, 5.4s.
  measuredValidationUsd: 0.021,
} as const;

export const DEFAULT_RUN_LIMITS = {
  max_candidates: MAX_CANDIDATES,
  max_apify_calls: MAX_APIFY_CALLS,
  max_scrapes_total: MAX_SCRAPES_TOTAL,
  max_scrapes_per_company: MAX_SCRAPES_PER_COMPANY,
  max_tool_calls: MAX_TOOL_CALLS,
  max_refills: MAX_REFILLS,
  agent_budget_usd: AGENT_BUDGET_USD,
  apify_budget_usd: APIFY_BUDGET_USD,
} as const;

export const MIN_QUALIFIED_FIT_REASONS = 2;
export const HIGH_CONFIDENCE_WITH_CONCERN = 0.8;
export const LOW_QUALIFIED_CONFIDENCE = 0.4;
export const MAX_EMAIL_WORDS = 150;
export const MAX_LINKEDIN_CHARACTERS = 300;

export const BANNED_OUTREACH_PHRASES = [
  "hope this finds you well",
  "loved what you are building",
  "your company looks impressive",
  "i saw your website",
  "act now",
  "limited time",
] as const;

export const DISALLOWED_AGENT_TOOLS = [
  "Bash",
  "WebFetch",
  "WebSearch",
  "Write",
  "Edit",
  "NotebookEdit",
] as const;

export const LEAD_AGENT_TOOL_NAMES = [
  "mcp__lead_agent__search_companies",
  "mcp__lead_agent__scrape_site",
  "mcp__lead_agent__store_excerpts",
  "mcp__lead_agent__record_qualification",
  "mcp__lead_agent__record_outreach",
  "mcp__lead_agent__get_run_context",
] as const;

export type LeadAgentStage = keyof typeof STAGE_LIMITS;
export type LeadAgentToolName = (typeof LEAD_AGENT_TOOL_NAMES)[number];
