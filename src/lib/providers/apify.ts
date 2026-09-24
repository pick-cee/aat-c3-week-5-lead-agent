import {
  APIFY_ACTOR_ID,
  APIFY_ACTOR_MAX_PAGE,
  APIFY_ACTOR_MAX_RESULTS,
  APIFY_ACTOR_MODE,
  APIFY_ACTOR_RESULT_LIMIT_FIELD,
  APIFY_ACTOR_START_USD,
  APIFY_COMPANY_RESULT_USD,
  APIFY_COST_SETTLE_SECONDS,
  APIFY_JOB_START_STALE_SECONDS,
  APIFY_PROVIDER_WAIT_SECONDS,
  APIFY_REQUEST_WAIT_SECONDS,
} from "@/lib/constants";
import { queryDb } from "@/lib/server/database";
import { requireServerEnv } from "@/lib/server/env";

import type { CompanyDiscoveryProvider, DiscoveryResult, DiscoverySearch } from "./types";

export { linkedInCompanySizes, linkedInLocations } from "./linkedin-filters";

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
  return host;
}

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
  const records: Array<{ record: Record<string, string>; hqMatch: boolean }> = [];
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
    records.push({
      record: {
        company_name: name.slice(0, 160),
        domain,
        ...(headcount ? { headcount } : {}),
        ...(industry ? { industry } : {}),
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
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
    k: input.keywords.trim().toLowerCase().replace(/\s+/g, " "),
    i: [...(input.industryIds ?? [])].sort(),
    l: [...input.locations].map((value) => value.toLowerCase()).sort(),
    s: [...input.companySizes].sort(),
  });
}

/** How many company results the remaining real budget can pay for. */
export function affordableCompanyCount(remainingUsd: number, requested: number): number {
  const affordable = Math.floor((remainingUsd - APIFY_ACTOR_START_USD) / APIFY_COMPANY_RESULT_USD + 1e-9);
  return Math.max(0, Math.min(requested, affordable, APIFY_ACTOR_MAX_RESULTS));
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

export class ApifyCompanyDiscoveryProvider implements CompanyDiscoveryProvider {
  async search(input: DiscoverySearch): Promise<DiscoveryResult> {
    const requested = Math.max(1, Math.floor(input.limit));
    const maxItems = affordableCompanyCount(input.maxChargeUsd ?? 0, requested);
    if (maxItems < 1) throw new Error("Remaining Apify budget cannot pay for one company result");
    const keywords = input.keywords.trim().replace(/\s+/g, " ");
    const signature = discoverySignature({ ...input, keywords });
    const persist = Boolean(input.runId && input.jobKey);

    let run: ApifyRun | undefined;
    let startPage = 1;
    if (persist) {
      const jobs = await readJobs(input.runId!);
      const existing = jobs[input.jobKey!];
      // Paging past results this run already paid for, rather than buying the
      // same first page again with the same filters.
      startPage = 1 + Object.entries(jobs).filter(([key, job]) => key !== input.jobKey && job.signature === signature).length;
      if (existing?.id) {
        run = existing;
        startPage = existing.start_page ?? startPage;
      } else if (existing?.state === "starting") {
        const age = Date.now() - new Date(existing.claimed_at ?? 0).getTime();
        if (age > APIFY_JOB_START_STALE_SECONDS * 1_000) {
          throw new Error("A previous discovery start was interrupted before its Apify run id was saved; not starting a second paid run for this step");
        }
        throw new Error("Another runner is starting this discovery search; the next step will resume it");
      }
    }
    if (startPage > APIFY_ACTOR_MAX_PAGE) throw new Error("LinkedIn has no further result pages for these filters");

    if (!run?.id) {
      if (persist) {
        const claimed = await claimJob(input.runId!, input.jobKey!, {
          state: "starting",
          claimed_at: new Date().toISOString(),
          signature,
          keywords,
          industry_ids: input.industryIds ?? [],
          locations: input.locations,
          company_sizes: input.companySizes,
          start_page: startPage,
          max_items: maxItems,
        });
        if (!claimed) throw new Error("Another runner claimed this discovery search; the next step will resume it");
      }
      const params = new URLSearchParams({
        waitForFinish: String(APIFY_REQUEST_WAIT_SECONDS),
        maxItems: String(maxItems),
        maxTotalChargeUsd: Math.max(0, input.maxChargeUsd ?? 0).toFixed(4),
      });
      const response = await apifyFetch(`https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?${params}`, {
        method: "POST",
        body: JSON.stringify({
          ...(keywords ? { searchQuery: keywords } : {}),
          ...(input.industryIds?.length ? { industryIds: input.industryIds } : {}),
          ...(input.locations.length ? { locations: input.locations } : {}),
          ...(input.companySizes.length ? { companySize: input.companySizes } : {}),
          [APIFY_ACTOR_RESULT_LIMIT_FIELD]: maxItems,
          scraperMode: APIFY_ACTOR_MODE,
          startPage,
        }),
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

    const itemsResponse = await apifyFetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&limit=${APIFY_ACTOR_MAX_RESULTS}`);
    if (!itemsResponse.ok) throw new Error(`Apify dataset read failed (${itemsResponse.status})`);
    const items = (await itemsResponse.json()) as LinkedInCompany[];

    // Charged events land a few seconds after SUCCEEDED. Wait for them to
    // cover every returned company before calling the figure complete.
    let settled = false;
    const settleBy = Date.now() + APIFY_COST_SETTLE_SECONDS * 1_000;
    while (run.id) {
      const charged = run.chargedEventCounts?.[`${APIFY_ACTOR_MODE}-company`] ?? 0;
      if (typeof run.usageTotalUsd === "number" && run.usageTotalUsd > 0 && charged >= items.length) {
        settled = true;
        break;
      }
      if (Date.now() > settleBy) break;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      run = (await getRun(run.id)) ?? run;
    }

    const normalized = normalizeLinkedInCompanies(items, input.locations);
    const totalAvailable = items[0]?._meta?.pagination?.totalResultCount ?? (items.length === 0 ? 0 : null);
    if (persist) {
      await saveJob(input.runId!, input.jobKey!, {
        ...jobSnapshot(run),
        returned_count: items.length,
        total_available: totalAvailable,
      });
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
