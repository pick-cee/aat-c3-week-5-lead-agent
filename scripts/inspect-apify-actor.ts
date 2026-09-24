import "dotenv/config";

import { APIFY_ACTOR_ID } from "../src/lib/constants";
import { requireServerEnv } from "../src/lib/server/env";

const ACTOR_ID = process.argv[2]?.trim() || APIFY_ACTOR_ID;

async function getJson(url: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requireServerEnv("APIFY_API_KEY")}` },
  });
  if (!response.ok) throw new Error(`Apify metadata request failed (${response.status})`);
  return response.json() as Promise<{ data?: Record<string, unknown> }>;
}

async function main() {
  const actor = (await getJson(`https://api.apify.com/v2/acts/${ACTOR_ID}`)).data ?? {};
  const builds = (actor.taggedBuilds ?? {}) as Record<string, { buildId?: string }>;
  const buildId = builds.latest?.buildId;
  if (!buildId) throw new Error("The actor does not expose a latest build id");

  const build = (await getJson(`https://api.apify.com/v2/actor-builds/${buildId}`)).data ?? {};
  console.log(JSON.stringify({
    actorId: ACTOR_ID,
    actorName: actor.name,
    username: actor.username,
    inputSchema: build.inputSchema ?? build.inputSchemaJson ?? null,
    pricing: actor.pricingInfos ?? actor.pricingInfo ?? null,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown actor inspection failure";
  console.error(message.replace(/(?:token|key)=[^\s&]+/gi, "credential=[REDACTED]"));
  process.exitCode = 1;
});
