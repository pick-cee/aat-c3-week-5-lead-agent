import "dotenv/config";

import { stripDiscoveryRecord } from "../src/lib/agent/tool-server";
import { ApifyCompanyDiscoveryProvider, linkedInCompanySizes, linkedInLocations } from "../src/lib/providers/apify";

const CONTACT_SHAPED = /(?:email|phone|contact|person|linkedin|first_name|last_name)/i;

// Paid: one actor start plus up to three company results (about $0.013 on the
// Starter tier). Run it deliberately, not as part of a test suite.
async function main() {
  const result = await new ApifyCompanyDiscoveryProvider().search({
    keywords: "SaaS",
    locations: linkedInLocations(["UK"]),
    companySizes: linkedInCompanySizes("50-500 employees"),
    limit: 3,
    maxChargeUsd: 0.02,
  });
  const raw = result.records[0] ?? {};
  const stripped = stripDiscoveryRecord(raw);
  console.log(JSON.stringify({
    runId: result.runId,
    measuredCostUsd: result.costUsd,
    costComplete: result.costComplete,
    returnedItems: result.returnedCount,
    totalMatching: result.totalAvailable,
    skippedNoWebsite: result.skippedNoWebsite,
    companies: result.records.map((record) => `${record.company_name} (${record.domain}) ${record.location ?? ""} ${record.headcount ?? ""}`),
    storedFieldsAfterAllowlist: Object.keys(stripped).sort(),
    contactShapedStoredFields: Object.keys(stripped).filter((key) => CONTACT_SHAPED.test(key)).sort(),
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown smallest-run failure";
    console.error(message.replace(/apify_api_[A-Za-z0-9_-]+/g, "[REDACTED]"));
    process.exit(1);
  });
