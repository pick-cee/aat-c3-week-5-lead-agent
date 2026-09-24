import { requireServerEnv } from "@/lib/server/env";

import type { SiteScraper } from "./types";

type FirecrawlResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    metadata?: { statusCode?: number; sourceURL?: string };
  };
};

export class FirecrawlScraper implements SiteScraper {
  async scrape(url: string) {
    try {
      const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireServerEnv("FIRECRAWL_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: ["markdown"],
          onlyMainContent: true,
          maxAge: 604_800_000,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = (await response.json()) as FirecrawlResponse;
      const markdown = payload.data?.markdown?.trim() ?? "";
      const status = payload.data?.metadata?.statusCode ?? response.status;

      if (!response.ok) {
        return { url, markdown: "", fetchStatus: response.status === 403 ? "blocked" as const : "fetch_failed" as const, httpStatus: status, fromCache: false, error: `Firecrawl returned HTTP ${response.status}` };
      }
      if (!markdown) return { url, markdown: "", fetchStatus: "empty" as const, httpStatus: status, fromCache: false };
      if (markdown.length > 500_000) return { url, markdown: markdown.slice(0, 500_000), fetchStatus: "too_large" as const, httpStatus: status, fromCache: false };
      return { url, markdown, fetchStatus: "ok" as const, httpStatus: status, fromCache: false };
    } catch (error) {
      return {
        url,
        markdown: "",
        fetchStatus: "fetch_failed" as const,
        fromCache: false,
        error: error instanceof Error ? error.message.replace(/(?:token|key)=[^\s&]+/gi, "credential=[REDACTED]") : "Firecrawl request failed",
      };
    }
  }
}
