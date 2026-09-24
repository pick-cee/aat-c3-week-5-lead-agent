import "dotenv/config";

import { closePool, queryDb } from "../src/lib/server/database";

type ColumnRow = {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
};

type FunctionRow = {
  function_schema: string;
  function_name: string;
  arguments: string;
};

async function main(): Promise<void> {
  const columns = await queryDb<ColumnRow>(`
    select table_schema, table_name, column_name, data_type, is_nullable
      from information_schema.columns
     where table_schema not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', 'vault', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks')
     order by table_schema, table_name, ordinal_position
  `);

  const functions = await queryDb<FunctionRow>(`
    select n.nspname as function_schema,
           p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as arguments
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'realtime', 'vault', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks')
     order by n.nspname, p.proname, arguments
  `);

  const byTable = Map.groupBy(
    columns.rows,
    (column) => `${column.table_schema}.${column.table_name}`,
  );

  console.log("Existing application tables and columns:");
  for (const [table, tableColumns] of byTable) {
    console.log(`\n${table}`);
    for (const column of tableColumns) {
      console.log(
        `  ${column.column_name}: ${column.data_type}${column.is_nullable === "NO" ? " not null" : ""}`,
      );
    }
  }

  console.log("\nExisting application functions:");
  for (const fn of functions.rows) {
    console.log(`  ${fn.function_schema}.${fn.function_name}(${fn.arguments})`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("Database inspection failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  })
  .finally(closePool);
