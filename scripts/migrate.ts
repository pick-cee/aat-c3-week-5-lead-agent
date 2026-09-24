import "dotenv/config";

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { closePool, getPool } from "../src/lib/server/database";

const MIGRATION_DIRECTORY = path.join(process.cwd(), "supabase", "migrations");
const MIGRATION_LOCK_KEY = "lead_agent:migrations:v1";

const BOOTSTRAP_SQL = `
  create schema if not exists lead_agent;

  revoke all on schema lead_agent from public, anon, authenticated;
  grant usage on schema lead_agent to service_role;

  create table if not exists lead_agent.schema_migrations (
    filename text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  );

  alter table lead_agent.schema_migrations enable row level security;
  revoke all on lead_agent.schema_migrations from public, anon, authenticated;
  grant select, insert on lead_agent.schema_migrations to service_role;

  alter default privileges in schema lead_agent revoke execute on functions from public;
`;

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function main(): Promise<void> {
  const client = await getPool().connect();

  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_KEY]);
    await client.query("begin");
    await client.query(BOOTSTRAP_SQL);
    await client.query("commit");

    const filenames = (await readdir(MIGRATION_DIRECTORY))
      .filter((filename) => /^\d+_[a-z0-9_]+\.sql$/.test(filename))
      .sort();

    for (const filename of filenames) {
      const sql = await readFile(path.join(MIGRATION_DIRECTORY, filename), "utf8");
      const digest = checksum(sql);
      const existing = await client.query<{ checksum: string }>(
        "select checksum from lead_agent.schema_migrations where filename = $1",
        [filename],
      );

      if (existing.rowCount === 1) {
        if (existing.rows[0]?.checksum !== digest) {
          throw new Error(`Applied migration checksum changed: ${filename}`);
        }

        console.log(`Already applied: ${filename}`);
        continue;
      }

      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into lead_agent.schema_migrations (filename, checksum) values ($1, $2)",
          [filename, digest],
        );
        await client.query("commit");
        console.log(`Applied: ${filename}`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // The migration error is more useful than a secondary rollback error.
    }
    throw error;
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error("Migration failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  })
  .finally(closePool);
