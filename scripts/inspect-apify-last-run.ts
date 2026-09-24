import "dotenv/config";

import { stripDiscoveryRecord } from "../src/lib/agent/tool-server";
import { APIFY_ACTOR_ID } from "../src/lib/constants";
import { requireServerEnv } from "../src/lib/server/env";
import { normalizeLinkedInCompanies } from "../src/lib/providers/apify";

const CONTACT_SHAPED = /(?:email|phone|contact|person|linkedin|first_name|last_name)/i;

// Free: reads the most recent run of the configured actor, never starts one.
async function getJson(url: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${requireServerEnv("APIFY_API_KEY")}` } });
  if (!response.ok) throw new Error(`Apify read failed (${response.status})`);
  return response.json() as Promise<{ data?: Record<string, unknown> }>;
}

async function main() {
  const list = (await getJson(`https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?limit=1&desc=true`)).data as { items?: Array<Record<string, unknown>> } | undefined;
  const run = list?.items?.[0];
  if (!run) throw new Error("No actor run found");
  const current = (await getJson(`https://api.apify.com/v2/actor-runs/${String(run.id)}`)).data ?? run;
  const datasetId = String(current.defaultDatasetId ?? "");
  const items = datasetId
    ? await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=50`, { headers: { Authorization: `Bearer ${requireServerEnv("APIFY_API_KEY")}` } }).then((response) => response.json()) as Record<string, unknown>[]
    : [];
  const normalized = normalizeLinkedInCompanies(items, []);
  const stripped = stripDiscoveryRecord(normalized.records[0] ?? {});
  console.log(JSON.stringify({
    runId: run.id,
    status: current.status,
    measuredCostUsd: current.usageTotalUsd ?? null,
    chargedEvents: current.chargedEventCounts ?? null,
    returnedItems: items.length,
    rawFields: Object.keys(items[0] ?? {}).sort(),
    contactShapedRawFields: Object.keys(items[0] ?? {}).filter((key) => CONTACT_SHAPED.test(key)).sort(),
    normalizedCompanies: normalized.records.length,
    skippedNoWebsite: normalized.skippedNoWebsite,
    storedFieldsAfterAllowlist: Object.keys(stripped).sort(),
    contactShapedStoredFields: Object.keys(stripped).filter((key) => CONTACT_SHAPED.test(key)).sort(),
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown Apify inspection failure");
    process.exit(1);
  });
