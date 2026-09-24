import type { SiteScraper } from "@/lib/providers/types";

import { chunkMarkdown } from "./excerpts";
import { scanForPromptInjection } from "./injection-scan";
import { safeErrorMessage } from "./redaction";
import type { LeadAgentToolRepository, StoredExcerpt, ToolExecutionContext } from "./types";

export type Prefetched = { url: string; fetchStatus: string; excerpts: StoredExcerpt[]; error?: string };

/**
 * Reads the company's homepage before the agent starts. Every research step
 * began with the same two tool turns (scrape the homepage, store its
 * excerpts), and each extra turn re-sends the whole context. Doing it here
 * saves those turns and hands the agent citable labels immediately.
 *
 * It is still a scrape: it reserves against the same run and per-company
 * limits as the agent's tool and writes the same audit row.
 */
export async function prefetchHomepage(input: {
  context: ToolExecutionContext;
  domain: string;
  repository: LeadAgentToolRepository;
  scraper: SiteScraper;
}): Promise<Prefetched | null> {
  const { context, repository, scraper } = input;
  if (!context.candidateId) return null;
  const toolName = "mcp__lead_agent__scrape_site";
  const purpose = "Homepage read by the server before research";
  const url = `https://${input.domain}`;
  const startedAt = Date.now();

  const reservation = await repository.reserveToolUse(context, toolName);
  if (!reservation.allowed) {
    await repository.logToolCall({ ...context, toolName, purpose, inputSummary: { url }, status: "refused", error: reservation.reason ?? "Scrape limit reached", durationMs: Date.now() - startedAt });
    return null;
  }

  try {
    const scraped = await scraper.scrape(url);
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
    const chunks = scraped.markdown ? chunkMarkdown(scraped.markdown) : [];
    const excerpts = chunks.length ? await repository.storeExcerpts({ sourceId, candidateId: context.candidateId, excerpts: chunks }) : [];
    await repository.logToolCall({
      ...context, toolName, purpose, inputSummary: { url },
      resultSummary: { source_id: sourceId, fetch_status: scraped.fetchStatus, markdown_chars: scraped.markdown.length, labels: excerpts.map((excerpt) => excerpt.label), injection_suspected: matches.length > 0 },
      status: "ok", durationMs: Date.now() - startedAt,
    });
    return { url: scraped.url, fetchStatus: scraped.fetchStatus, excerpts, error: scraped.error };
  } catch (error) {
    const message = safeErrorMessage(error);
    await repository.logToolCall({ ...context, toolName, purpose, inputSummary: { url }, status: "error", error: message, durationMs: Date.now() - startedAt }).catch(() => undefined);
    return { url, fetchStatus: "fetch_failed", excerpts: [], error: message };
  }
}
