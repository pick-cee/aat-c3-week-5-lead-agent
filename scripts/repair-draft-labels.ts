import "dotenv/config";

import { stripEvidenceLabels } from "../src/lib/checks/copy";
import { closePool, queryDb, withTransaction } from "../src/lib/server/database";

/**
 * Removes evidence labels ("(E2, E3)", "[E1]") from the subject and body of
 * drafts saved before the copy check stripped them at save. The labels stay in
 * each draft's cited_excerpt_ids, so the founder still sees the evidence.
 *
 *   npx tsx scripts/repair-draft-labels.ts           # dry run: counts and samples
 *   npx tsx scripts/repair-draft-labels.ts --apply   # writes, one event per run
 */
async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const rows = await queryDb<{ id: string; run_id: string; subject: string | null; body: string }>(
    "select id, run_id, subject, body from lead_agent.outreach_drafts where coalesce(subject,'') ~ 'E[0-9]' or body ~ 'E[0-9]'",
  );
  const changes = rows.rows.map((row) => {
    const subject = row.subject === null ? null : stripEvidenceLabels(row.subject);
    const body = stripEvidenceLabels(row.body);
    return { ...row, newSubject: subject?.text ?? null, newBody: body.text, removed: (subject?.removed ?? 0) + body.removed };
  }).filter((change) => change.removed > 0);

  const bare = changes.filter((change) => /\bE\d{1,3}\b/.test(`${change.newSubject ?? ""} ${change.newBody}`));
  console.log(`${rows.rows.length} drafts mention a label; ${changes.length} change, ${changes.reduce((sum, change) => sum + change.removed, 0)} labels removed; ${bare.length} would still show a bare label.`);
  for (const change of changes.slice(0, 3)) {
    console.log("\nBEFORE:", JSON.stringify(change.body.slice(0, 220)));
    console.log("AFTER: ", JSON.stringify(change.newBody.slice(0, 220)));
  }
  if (!apply) {
    console.log("\nDry run. Add --apply to write.");
    return;
  }

  const byRun = new Map<string, number>();
  await withTransaction(async (client) => {
    for (const change of changes) {
      await client.query(
        `update lead_agent.outreach_drafts
            set subject=$2, body=$3,
                checks = coalesce(checks,'{}'::jsonb) || jsonb_build_object('removed_evidence_labels', $4::int, 'labels_removed_by', 'repair 2026-09-25')
          where id=$1`,
        [change.id, change.newSubject, change.newBody, change.removed],
      );
      byRun.set(change.run_id, (byRun.get(change.run_id) ?? 0) + 1);
    }
    for (const [runId, count] of byRun) {
      await client.query(
        `insert into lead_agent.run_events (run_id, from_status, to_status, stage, message, detail)
         select id, status, status, stage, $2, $3::jsonb from lead_agent.runs where id=$1`,
        [runId, `Evidence labels removed from the text of ${count} saved draft${count === 1 ? "" : "s"}; each draft still lists the evidence it rests on`, JSON.stringify({ drafts: count })],
      );
    }
  });
  console.log(`\nApplied to ${changes.length} drafts across ${byRun.size} runs.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(closePool);
