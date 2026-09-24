import "dotenv/config";

import { closePool, queryDb } from "../src/lib/server/database";

async function main(): Promise<void> {
  const result = await queryDb<{
    run_id: string;
    run_status: string;
    stage: string;
    objective: string;
    apify_jobs: unknown;
    tool_status: string | null;
    tool_error: string | null;
    input_summary: unknown;
    created_at: string;
  }>(`
    select r.id as run_id, r.status as run_status, r.stage, r.objective,
           r.apify_jobs, t.status as tool_status, t.error as tool_error,
           t.input_summary, coalesce(t.created_at, r.created_at) as created_at
      from lead_agent.runs r
      left join lateral (
        select status, error, input_summary, created_at
          from lead_agent.tool_calls
         where run_id = r.id and tool_name like '%search_companies'
         order by created_at desc
         limit 1
      ) t on true
     order by r.created_at desc
     limit 10
  `);

  console.log(JSON.stringify(result.rows, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Recent-run inspection failed");
    process.exitCode = 1;
  })
  .finally(closePool);
