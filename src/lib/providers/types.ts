export type DiscoveryResult = {
  records: Record<string, unknown>[];
  costUsd: number;
  costComplete: boolean;
  runId?: string;
  returnedCount?: number;
  skippedNoWebsite?: number;
  totalAvailable?: number | null;
  startPage?: number;
};

export type DiscoverySearch = {
  keywords: string;
  industryIds?: string[];
  locations: string[];
  companySizes: string[];
  limit: number;
  maxChargeUsd?: number;
  runId?: string;
  jobKey?: string;
};

export interface CompanyDiscoveryProvider {
  search(input: DiscoverySearch): Promise<DiscoveryResult>;
}

export type ScrapeResult = {
  url: string;
  markdown: string;
  fetchStatus: "ok" | "fetch_failed" | "blocked" | "paywalled" | "empty" | "unsupported_type" | "too_large";
  httpStatus?: number;
  fromCache: boolean;
  error?: string;
};

export interface SiteScraper {
  scrape(url: string): Promise<ScrapeResult>;
}
