import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { requireServerEnv } from "@/lib/server/env";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireServerEnv("SUPABASE_DB_URL"),
      // Four parallel research stages, their hooks and the scheduler share it.
      max: 8,
      ssl: { rejectUnauthorized: false },
      // The Supabase pooler closes idle connections; handing one of those out
      // surfaced as "Connection terminated unexpectedly" on the next request.
      idleTimeoutMillis: 10_000,
      keepAlive: true,
    });
    // An idle client dropped by the server emits here. Without a listener the
    // event is an uncaught error; with one, the pool discards the client.
    pool.on("error", (error) => {
      console.error("Postgres idle client error (discarded):", error.message);
    });
  }

  return pool;
}

export async function queryDb<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, [...values]);
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
