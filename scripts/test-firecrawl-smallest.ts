import "dotenv/config";

import { FirecrawlScraper } from "../src/lib/providers/firecrawl";

async function main() {
  const result = await new FirecrawlScraper().scrape("https://example.com");
  console.log(JSON.stringify({ url: result.url, fetchStatus: result.fetchStatus, httpStatus: result.httpStatus ?? null, markdownCharacters: result.markdown.length, fromCache: result.fromCache, error: result.error ?? null }, null, 2));
  if (result.fetchStatus !== "ok") process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Firecrawl test failed"); process.exitCode = 1; });
