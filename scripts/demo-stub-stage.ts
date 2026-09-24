import "dotenv/config";

import { randomUUID } from "node:crypto";

import { advanceRun } from "../src/lib/runner/advance-run";
import { RunStore } from "../src/lib/runs/run-store";
import { closePool, queryDb } from "../src/lib/server/database";

async function main() {
  Reflect.set(process.env, "NODE_ENV", "test");
  const store = new RunStore();
  const runId = await store.createRun("[STUB DEMO] UK B2B SaaS companies hiring account executives", `stub-demo-${randomUUID()}`);
  const icp = {
    target_company_type: "B2B SaaS", industries: ["Software"], geography: ["United Kingdom"],
    headcount_range: "50-500", buyer_persona: "Founder", business_problem: "Revenue hiring",
    hard_filters: ["B2B SaaS", "United Kingdom"], soft_preferences: ["Hiring account executives"],
    disqualifiers: [], assumptions: [],
  };
  await queryDb(
    `update lead_agent.runs set refined_icp=$2::jsonb,status='discovering',stage='discover',
      icp_confirmed_at=now(),icp_confirmed_by='00000000-0000-4000-8000-000000000001' where id=$1`,
    [runId, JSON.stringify(icp)],
  );
  const outcome = await advanceRun({ runId });
  await queryDb("update lead_agent.runs set status='cancelled' where id=$1", [runId]);
  const log = await queryDb<{ tool_name: string; purpose: string; status: string; input_summary: unknown; result_summary: unknown; cost_usd: string }>(
    `select tool_name,purpose,status,input_summary,result_summary,cost_usd from lead_agent.tool_calls where run_id=$1 order by created_at`, [runId],
  );
  console.log(JSON.stringify({ runId, outcome, toolCallLog: log.rows }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Stub stage failed"); process.exitCode = 1; }).finally(closePool);
