import {
  APIFY_ACTOR_ID,
  APIFY_ACTOR_MAX_PAGE,
  APIFY_ACTOR_MAX_RESULTS,
  APIFY_ACTOR_MODE,
  APIFY_ACTOR_RESULT_LIMIT_FIELD,
  APIFY_ACTOR_START_USD,
  APIFY_COMPANY_RESULT_USD,
  APIFY_COST_SETTLE_SECONDS,
  APIFY_JOB_AD_USD,
  APIFY_JOB_ADS_PER_SEARCH,
  APIFY_JOB_ADS_POSTED_WITHIN,
  APIFY_JOB_START_STALE_SECONDS,
  APIFY_JOBS_ACTOR_ID,
  APIFY_JOBS_START_USD,
  APIFY_PROVIDER_WAIT_SECONDS,
  APIFY_REQUEST_WAIT_SECONDS,
} from "@/lib/constants";
import { queryDb } from "@/lib/server/database";
import { requireServerEnv } from "@/lib/server/env";

import type { CompanyDiscoveryProvider, DiscoveryResult, DiscoverySearch } from "./types";

import { normalizeKeywords } from "./linkedin-filters";

export { linkedInCompanySizes, linkedInLocations, normalizeKeywords } from "./linkedin-filters";

type ApifyRun = {
  id?: string;
  status?: string;
  defaultDatasetId?: string;
  usageTotalUsd?: number;
  chargedEventCounts?: Record<string, number>;
  startedAt?: string;
};

type StoredJob = ApifyRun & {
  state?: "starting";
  claimed_at?: string;
  signature?: string;
  keywords?: string;
  start_page?: number;
  cost_recorded?: boolean;
};

type LinkedInCompany = {
  name?: unknown;
  website?: unknown;
  employeeCountRange?: { start?: number | null; end?: number | null } | null;
  employeeCount?: unknown;
  specialities?: unknown;
  companyType?: unknown;
  locations?: Array<{ country?: string | null; city?: string | null; geographicArea?: string | null; headquarter?: boolean | null }> | null;
  industries?: Array<{ name?: string | null }> | null;
  description?: unknown;
  tagline?: unknown;
  _meta?: { pagination?: { totalResultCount?: number } };
};

const NON_COMPANY_DOMAINS = new Set([
  "linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com",
  "youtube.com", "linktr.ee", "bit.ly", "google.com", "medium.com",
]);

function hostOf(value: string): string | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

export function companyDomain(website: unknown): string | null {
  if (typeof website !== "string" || !website.trim()) return null;
  const raw = website.trim();
  let host = hostOf(raw);
  if (host === "linkedin.com" || host?.endsWith(".linkedin.com")) {
    // LinkedIn wraps some company websites in a redirect page.
    try {
      const target = new URL(raw.startsWith("http") ? raw : `https://${raw}`).searchParams.get("url");
      host = target ? hostOf(target) : null;
    } catch {
      host = null;
    }
  }
  if (!host || !host.includes(".") || NON_COMPANY_DOMAINS.has(host)) return null;
  // Job ads often give a careers site (careers.next.co.uk); the company to
  // research is the site it belongs to.
  const [first, ...rest] = host.split(".");
  const parent = rest.join(".");
  if (CAREERS_SUBDOMAINS.has(first) && rest.length >= 2 && !TWO_PART_SUFFIXES.has(parent)) return parent;
  return host;
}

const CAREERS_SUBDOMAINS = new Set(["careers", "career", "jobs", "job", "join", "work", "apply", "talent", "hiring", "recruiting"]);
const TWO_PART_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "co.nz", "co.za", "com.br", "co.in", "co.jp", "com.sg"]);

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function sizeBand(range: LinkedInCompany["employeeCountRange"]): string | null {
  if (!range?.start) return null;
  return range.end ? `${range.start}-${range.end} employees` : `${range.start}+ employees`;
}

export function normalizeLinkedInCompanies(items: LinkedInCompany[], locations: string[]) {
  const seen = new Set<string>();
  const records: Array<{ record: Record<string, string | number>; hqMatch: boolean }> = [];
  let skippedNoWebsite = 0;
  for (const item of items) {
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const domain = companyDomain(item.website);
    if (!name || !domain) {
      skippedNoWebsite += 1;
      continue;
    }
    if (seen.has(domain)) continue;
    seen.add(domain);
    const hq = item.locations?.find((location) => location.headquarter) ?? item.locations?.[0];
    const location = [hq?.city, hq?.geographicArea, countryName(hq?.country)].filter(Boolean).join(", ");
    const description = String(item.description ?? item.tagline ?? "").replace(/\s+/g, " ").trim().slice(0, 700);
    const headcount = sizeBand(item.employeeCountRange);
    const industry = item.industries?.[0]?.name;
    // The size band is the company's own choice and often stale; this count of
    // people listing it as their employer is what makes a size filter provable.
    const members = typeof item.employeeCount === "number" && Number.isFinite(item.employeeCount) && item.employeeCount >= 0 ? Math.round(item.employeeCount) : null;
    const specialities = Array.isArray(item.specialities)
      ? item.specialities.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).join(", ").slice(0, 300)
      : "";
    const companyType = typeof item.companyType === "string" ? item.companyType.trim().slice(0, 60) : "";
    records.push({
      record: {
        company_name: name.slice(0, 160),
        domain,
        ...(headcount ? { headcount } : {}),
        ...(members !== null ? { linkedin_members: members } : {}),
        ...(industry ? { industry } : {}),
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
        ...(specialities ? { specialities } : {}),
        ...(companyType ? { company_type: companyType } : {}),
      },
      hqMatch: locations.length === 0 || locations.some((wanted) => location.toLowerCase().includes(wanted.toLowerCase())),
    });
  }
  // LinkedIn's location filter matches any office, so a US company with a
  // London office comes back for "United Kingdom". Headquarters matches are
  // researched first; the rest stay available rather than being dropped on a
  // guess about what the hard filter means.
  return {
    records: [...records.filter((item) => item.hqMatch), ...records.filter((item) => !item.hqMatch)].map((item) => item.record),
    skippedNoWebsite,
  };
}

export function discoverySignature(input: Pick<DiscoverySearch, "keywords" | "locations" | "companySizes" | "industryIds">): string {
  return JSON.stringify({
    k: normalizeKeywords(input.keywords).toLowerCase(),
    i: [...(input.industryIds ?? [])].sort(),
    l: [...input.locations].map((value) => value.toLowerCase()).sort(),
    s: [...input.companySizes].sort(),
  });
}

/**
 * Whether an earlier company search covered the same ground, so this one must
 * start on a later page. Sharing any industry counts: LinkedIn ranks a broad
 * shared industry ("Retail") first, and a search that added two more
 * industries to it returned the same 50 companies as the first search, all
 * already seen and all paid for again.
 */
export function overlapsEarlierSearch(earlier: string | undefined, current: string): boolean {
  if (!earlier) return false;
  try {
    const a = JSON.parse(earlier) as { src?: string; k?: string; i?: string[]; l?: string[]; s?: string[] };
    const b = JSON.parse(current) as typeof a;
    if (a.src || b.src) return false;
    const same = (x: string[] = [], y: string[] = []) => x.length === y.length && x.every((value, index) => value === y[index]);
    const industries = (a.i ?? []).length === 0 && (b.i ?? []).length === 0 || (a.i ?? []).some((id) => (b.i ?? []).includes(id));
    return normalizeKeywords(a.k ?? "").toLowerCase() === b.k && same(a.l, b.l) && same(a.s, b.s) && industries;
  } catch {
    return false;
  }
}

export function jobAdsSignature(keywords: string, location: string): string {
  return JSON.stringify({ src: "job_ads", k: normalizeKeywords(keywords).toLowerCase(), l: location.toLowerCase() });
}

/** How many company results the remaining real budget can pay for. */
export function affordableCompanyCount(remainingUsd: number, requested: number): number {
  const affordable = Math.floor((remainingUsd - APIFY_ACTOR_START_USD) / APIFY_COMPANY_RESULT_USD + 1e-9);
  return Math.max(0, Math.min(requested, affordable, APIFY_ACTOR_MAX_RESULTS));
}

/** How many job ads the remaining real budget can pay for. */
export function affordableJobAdCount(remainingUsd: number, requested: number): number {
  const affordable = Math.floor((remainingUsd - APIFY_JOBS_START_USD) / APIFY_JOB_AD_USD + 1e-9);
  return Math.max(0, Math.min(requested, affordable, APIFY_JOB_ADS_PER_SEARCH));
}

type LinkedInJob = {
  id?: unknown;
  title?: unknown;
  companyName?: unknown;
  companyWebsite?: unknown;
  companyEmployeesCount?: unknown;
  companyAddress?: { addressLocality?: string | null; addressRegion?: string | null; addressCountry?: string | null } | null;
  companyDescription?: unknown;
  industries?: unknown;
  location?: unknown;
  postedAt?: unknown;
};

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * One record per company behind a set of job ads. The ads themselves are kept
 * only as title, place, date and a clean public link: they are the evidence a
 * "hiring for this role" must-have rests on. The ad text and the poster are
 * not kept, because an ad can carry a recruiter's name and email.
 */
export function normalizeLinkedInJobs(items: LinkedInJob[], locations: string[]) {
  const byDomain = new Map<string, { record: Record<string, string | number>; ads: string[]; hqMatch: boolean }>();
  let skippedNoWebsite = 0;
  for (const item of items) {
    const name = clip(item.companyName, 160);
    const domain = companyDomain(item.companyWebsite);
    if (!name || !domain) {
      skippedNoWebsite += 1;
      continue;
    }
    const jobId = typeof item.id === "string" || typeof item.id === "number" ? String(item.id).replace(/\D/g, "") : "";
    const ad = [
      clip(item.title, 120),
      clip(item.location, 80),
      clip(item.postedAt, 10) && `posted ${clip(item.postedAt, 10)}`,
      jobId && `https://www.linkedin.com/jobs/view/${jobId}`,
    ].filter(Boolean).join(", ");
    const existing = byDomain.get(domain);
    if (existing) {
      if (existing.ads.length < 3 && ad) existing.ads.push(ad);
      continue;
    }
    const address = item.companyAddress ?? {};
    const hq = [address.addressLocality, address.addressRegion, countryName(address.addressCountry)].filter(Boolean).join(", ");
    const members = typeof item.companyEmployeesCount === "number" && Number.isFinite(item.companyEmployeesCount) ? Math.round(item.companyEmployeesCount) : null;
    const industry = clip(item.industries, 120);
    const description = clip(item.companyDescription, 700);
    byDomain.set(domain, {
      record: {
        company_name: name,
        domain,
        ...(members !== null ? { linkedin_members: members } : {}),
        ...(industry ? { industry } : {}),
        ...(hq ? { location: hq } : {}),
        ...(description ? { description } : {}),
        discovery_source: "linkedin_job_ads",
      },
      ads: ad ? [ad] : [],
      hqMatch: locations.length === 0 || locations.some((wanted) => hq.toLowerCase().includes(wanted.toLowerCase())),
    });
  }
  const records = [...byDomain.values()].map((entry) => {
    const record: Record<string, string | number> = { ...entry.record };
    if (entry.ads.length) record.hiring = entry.ads.join("; ");
    return { record, hqMatch: entry.hqMatch };
  });
  return {
    records: [...records.filter((item) => item.hqMatch), ...records.filter((item) => !item.hqMatch)].map((item) => item.record),
    skippedNoWebsite,
  };
}

function credentialSafe(message: string): string {
  return message
    .replace(/apify_api_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(?:token|key)=[^\s&]+/gi, "credential=[REDACTED]")
    .slice(0, 500);
}

async function apifyFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireServerEnv("APIFY_API_KEY")}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout((APIFY_REQUEST_WAIT_SECONDS + 10) * 1_000),
  });
}

async function getRun(runId: string, waitSeconds = 0): Promise<ApifyRun | undefined> {
  const response = await apifyFetch(`https://api.apify.com/v2/actor-runs/${runId}${waitSeconds ? `?waitForFinish=${waitSeconds}` : ""}`);
  if (!response.ok) return undefined;
  return ((await response.json()) as { data?: ApifyRun }).data;
}

function jobSnapshot(run: ApifyRun): ApifyRun {
  return {
    id: run.id,
    status: run.status,
    defaultDatasetId: run.defaultDatasetId,
    usageTotalUsd: run.usageTotalUsd,
    startedAt: run.startedAt,
  };
}

async function saveJob(runId: string, jobKey: string, patch: Record<string, unknown>): Promise<void> {
  await queryDb(
    `update lead_agent.runs
        set apify_jobs = jsonb_set(apify_jobs, array[$2::text],
              coalesce(apify_jobs -> ($2::text), '{}'::jsonb) || $3::jsonb, true),
            updated_at = now()
      where id = $1`,
    [runId, jobKey, JSON.stringify(patch)],
  );
}

/**
 * Reserve the step's job slot in one conditional update. The previous
 * read-then-write let two concurrent handlers both see an empty slot and both
 * start a paid actor run.
 */
async function claimJob(runId: string, jobKey: string, claim: Record<string, unknown>): Promise<boolean> {
  const result = await queryDb(
    `update lead_agent.runs
        set apify_jobs = jsonb_set(apify_jobs, array[$2::text], $3::jsonb, true),
            updated_at = now()
      where id = $1 and not (apify_jobs ? ($2::text))
      returning id`,
    [runId, jobKey, JSON.stringify(claim)],
  );
  return Boolean(result.rows[0]);
}

async function readJobs(runId: string): Promise<Record<string, StoredJob>> {
  const result = await queryDb<{ apify_jobs: Record<string, StoredJob> }>(
    "select apify_jobs from lead_agent.runs where id = $1",
    [runId],
  );
  return result.rows[0]?.apify_jobs ?? {};
}

type ActorSpec = {
  actorId: string;
  signature: string;
  /** Page to start on, from the jobs this run already paid for. */
  startPage: (earlier: StoredJob[]) => number;
  /** Refuses before any spend, for example a job search this run already ran. */
  refuse?: (earlier: StoredJob[]) => string | null;
  maxItems: number;
  claim: Record<string, unknown>;
  body: (startPage: number) => Record<string, unknown>;
  /** The event that proves each returned item was charged. */
  chargedEvent: string;
};

/**
 * One paid actor run per discovery step, shared by both searches: claim the
 * step's slot in one conditional update, store the actor run id so a timeout
 * resumes instead of starting a duplicate, cap results and total charge, and
 * wait for charged events before calling the cost complete.
 */
async function runDiscoveryActor<Item>(input: DiscoverySearch, spec: ActorSpec): Promise<{ items: Item[]; run: ApifyRun; settled: boolean; startPage: number }> {
  if (spec.maxItems < 1) throw new Error("Remaining Apify budget cannot pay for one result");
  const persist = Boolean(input.runId && input.jobKey);

  let run: ApifyRun | undefined;
  let startPage = 1;
  if (persist) {
    const jobs = await readJobs(input.runId!);
    const existing = jobs[input.jobKey!];
    const earlier = Object.entries(jobs).filter(([key]) => key !== input.jobKey).map(([, job]) => job);
    startPage = spec.startPage(earlier);
    if (existing?.id) {
      run = existing;
      startPage = existing.start_page ?? startPage;
    } else if (existing?.state === "starting") {
      const age = Date.now() - new Date(existing.claimed_at ?? 0).getTime();
      if (age > APIFY_JOB_START_STALE_SECONDS * 1_000) {
        throw new Error("A previous discovery start was interrupted before its Apify run id was saved; not starting a second paid run for this step");
      }
      throw new Error("Another runner is starting this discovery search; the next step will resume it");
    } else {
      const refusal = spec.refuse?.(earlier);
      if (refusal) throw new Error(refusal);
    }
  }
  if (startPage > APIFY_ACTOR_MAX_PAGE) throw new Error("LinkedIn has no further result pages for these filters");

  if (!run?.id) {
    if (persist) {
      const claimed = await claimJob(input.runId!, input.jobKey!, {
        ...spec.claim,
        state: "starting",
        claimed_at: new Date().toISOString(),
        signature: spec.signature,
        start_page: startPage,
        max_items: spec.maxItems,
      });
      if (!claimed) throw new Error("Another runner claimed this discovery search; the next step will resume it");
    }
    const params = new URLSearchParams({
      waitForFinish: String(APIFY_REQUEST_WAIT_SECONDS),
      maxItems: String(spec.maxItems),
      maxTotalChargeUsd: Math.max(0, input.maxChargeUsd ?? 0).toFixed(4),
    });
    const response = await apifyFetch(`https://api.apify.com/v2/acts/${spec.actorId}/runs?${params}`, {
      method: "POST",
      body: JSON.stringify(spec.body(startPage)),
    });
    const payload = (await response.json().catch(() => ({}))) as { data?: ApifyRun; error?: { message?: string } };
    if (!response.ok || !payload.data?.id) {
      throw new Error(`Apify run failed to start (${response.status}): ${credentialSafe(payload.error?.message ?? "no safe detail")}`);
    }
    run = payload.data;
    if (persist) await saveJob(input.runId!, input.jobKey!, { ...jobSnapshot(run), state: null });
  }

  const deadline = Date.now() + APIFY_PROVIDER_WAIT_SECONDS * 1_000;
  while (["READY", "RUNNING"].includes(run.status ?? "") && run.id && Date.now() < deadline) {
    run = (await getRun(run.id, APIFY_REQUEST_WAIT_SECONDS)) ?? run;
    if (persist) await saveJob(input.runId!, input.jobKey!, jobSnapshot(run));
  }
  if (["READY", "RUNNING"].includes(run.status ?? "")) {
    throw new Error("Apify run is still running; the next runner invocation will resume it without starting another paid actor run");
  }
  if (run.status !== "SUCCEEDED") throw new Error(`Apify run ended with status ${run.status ?? "UNKNOWN"}`);
  if (!run.defaultDatasetId) throw new Error("Apify run returned no dataset id");

  const itemsResponse = await apifyFetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&limit=${spec.maxItems}`);
  if (!itemsResponse.ok) throw new Error(`Apify dataset read failed (${itemsResponse.status})`);
  const items = (await itemsResponse.json()) as Item[];

  // Charged events land a few seconds after SUCCEEDED. Wait for them to
  // cover every returned item before calling the figure complete.
  let settled = false;
  const settleBy = Date.now() + APIFY_COST_SETTLE_SECONDS * 1_000;
  while (run.id) {
    const charged = run.chargedEventCounts?.[spec.chargedEvent] ?? 0;
    if (typeof run.usageTotalUsd === "number" && run.usageTotalUsd > 0 && charged >= items.length) {
      settled = true;
      break;
    }
    if (Date.now() > settleBy) break;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    run = (await getRun(run.id)) ?? run;
  }
  return { items, run, settled, startPage };
}

export class ApifyCompanyDiscoveryProvider implements CompanyDiscoveryProvider {
  async search(input: DiscoverySearch): Promise<DiscoveryResult> {
    const keywords = normalizeKeywords(input.keywords);
    const signature = discoverySignature({ ...input, keywords });
    const maxItems = affordableCompanyCount(input.maxChargeUsd ?? 0, Math.max(1, Math.floor(input.limit)));
    const { items, run, settled, startPage } = await runDiscoveryActor<LinkedInCompany>(input, {
      actorId: APIFY_ACTOR_ID,
      signature,
      // Paging past results this run already paid for, rather than buying the
      // same first page again with the same or overlapping filters.
      startPage: (earlier) => 1 + earlier.filter((job) => overlapsEarlierSearch(job.signature, signature)).length,
      maxItems,
      claim: { keywords, industry_ids: input.industryIds ?? [], locations: input.locations, company_sizes: input.companySizes },
      body: (page) => ({
        ...(keywords ? { searchQuery: keywords } : {}),
        ...(input.industryIds?.length ? { industryIds: input.industryIds } : {}),
        ...(input.locations.length ? { locations: input.locations } : {}),
        ...(input.companySizes.length ? { companySize: input.companySizes } : {}),
        [APIFY_ACTOR_RESULT_LIMIT_FIELD]: maxItems,
        scraperMode: APIFY_ACTOR_MODE,
        startPage: page,
      }),
      chargedEvent: `${APIFY_ACTOR_MODE}-company`,
    });

    const normalized = normalizeLinkedInCompanies(items, input.locations);
    const totalAvailable = items[0]?._meta?.pagination?.totalResultCount ?? (items.length === 0 ? 0 : null);
    if (input.runId && input.jobKey) {
      await saveJob(input.runId, input.jobKey, { ...jobSnapshot(run), returned_count: items.length, total_available: totalAvailable });
    }
    return {
      records: normalized.records,
      costUsd: typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : 0,
      costComplete: settled,
      runId: run.id,
      returnedCount: items.length,
      skippedNoWebsite: normalized.skippedNoWebsite,
      totalAvailable,
      startPage,
    };
  }
}

/**
 * Companies behind LinkedIn job ads for a role, in a place, posted in the last
 * month (`curious_coder/linkedin-jobs-scraper`, pay-per-event, $0.001 an ad on
 * the team's tier). Chosen on 2026-09-24 because a "hiring for X" must-have
 * could not be proven from company websites: in run 7716f37f it was unknown or
 * failed for all 29 companies researched. Every company found here is hiring
 * by construction, and its ad is the evidence. The job search from the same
 * vendor as the company search required full access to the team account.
 */
export class ApifyJobAdsDiscoveryProvider implements CompanyDiscoveryProvider {
  async search(input: DiscoverySearch): Promise<DiscoveryResult> {
    const keywords = normalizeKeywords(input.keywords);
    const location = input.locations[0] ?? "";
    const signature = jobAdsSignature(keywords, location);
    const maxItems = affordableJobAdCount(input.maxChargeUsd ?? 0, APIFY_JOB_ADS_PER_SEARCH);
    const { items, run, settled } = await runDiscoveryActor<LinkedInJob>(input, {
      actorId: APIFY_JOBS_ACTOR_ID,
      signature,
      startPage: () => 1,
      // This actor has no paging, so the same words and place return the same
      // ads. Refused before any spend so the agent varies the role title.
      refuse: (earlier) => earlier.some((job) => job.signature === signature)
        ? `Job ads for "${keywords}" in ${location || "any location"} were already searched in this run and would return the same ads. Use a different common title for the role, or a different sector word.`
        : null,
      maxItems,
      claim: { keywords, locations: input.locations, source: "job_ads" },
      body: () => ({
        urls: [],
        keywords,
        ...(location ? { location } : {}),
        datePosted: APIFY_JOB_ADS_POSTED_WITHIN,
        limitPerSource: maxItems,
        scrapeCompany: true,
      }),
      chargedEvent: "apify-default-dataset-item",
    });

    const normalized = normalizeLinkedInJobs(items, input.locations);
    if (input.runId && input.jobKey) {
      await saveJob(input.runId, input.jobKey, { ...jobSnapshot(run), returned_count: items.length, companies_found: normalized.records.length, total_available: null });
    }
    return {
      records: normalized.records.slice(0, Math.max(1, Math.floor(input.limit))),
      costUsd: typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : 0,
      costComplete: settled,
      runId: run.id,
      returnedCount: items.length,
      skippedNoWebsite: normalized.skippedNoWebsite,
      totalAvailable: null,
      startPage: 1,
    };
  }
}
