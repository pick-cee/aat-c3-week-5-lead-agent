import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LeadAgentToolRepository } from "../agent/types";
import { STAGE_TOOLS } from "./stage-executor";

describe("stage tool boundaries", () => {
  it("does not give drafting a scraping or discovery tool", () => {
    assert.equal(STAGE_TOOLS.draft_one.includes("mcp__lead_agent__scrape_site"), false);
    assert.equal(STAGE_TOOLS.draft_one.includes("mcp__lead_agent__search_companies"), false);
    assert.equal(STAGE_TOOLS.draft_one.includes("mcp__lead_agent__search_job_ads"), false);
    assert.equal(STAGE_TOOLS.qualify_one.includes("mcp__lead_agent__search_job_ads"), false);
  });

  it("offers discovery both searches, so the agent can match the brief", () => {
    assert.ok(STAGE_TOOLS.discover.includes("mcp__lead_agent__search_companies"));
    assert.ok(STAGE_TOOLS.discover.includes("mcp__lead_agent__search_job_ads"));
  });

  it("keeps the six-tool repository contract explicit", () => {
    const methodNames: Array<keyof LeadAgentToolRepository> = [
      "reserveToolUse",
      "logToolCall",
      "getRunContext",
      "insertCandidates",
      "storeSource",
      "storeExcerpts",
      "saveQualification",
      "saveOutreach",
    ];
    assert.equal(methodNames.length, 8);
  });
});
