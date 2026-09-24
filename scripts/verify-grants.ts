import "dotenv/config";

import { closePool, queryDb } from "../src/lib/server/database";

type GrantViolation = {
  object_name: string;
  grantee: string;
  violation: string;
};

async function main(): Promise<void> {
  const functionGrants = await queryDb<GrantViolation>(`
    select routine_schema || '.' || routine_name as object_name,
           grantee,
           'function_execute' as violation
      from information_schema.routine_privileges
     where routine_schema = 'lead_agent'
       and privilege_type = 'EXECUTE'
       and grantee in ('PUBLIC', 'anon')
  `);

  const defaultGrants = await queryDb<GrantViolation>(`
    select n.nspname || ' functions created by ' || owner_role.rolname as object_name,
           coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
           'default_function_execute' as violation
      from pg_default_acl d
      join pg_roles owner_role on owner_role.oid = d.defaclrole
      join pg_namespace n on n.oid = d.defaclnamespace
      cross join lateral aclexplode(d.defaclacl) acl
      left join pg_roles grantee_role on grantee_role.oid = acl.grantee
     where n.nspname = 'lead_agent'
       and d.defaclobjtype = 'f'
       and acl.privilege_type = 'EXECUTE'
       and (acl.grantee = 0 or grantee_role.rolname = 'anon')
  `);

  const rlsViolations = await queryDb<GrantViolation>(`
    select schemaname || '.' || tablename as object_name,
           'n/a' as grantee,
           'rls_disabled' as violation
      from pg_tables
     where schemaname = 'lead_agent'
       and not rowsecurity
  `);

  const violations = [
    ...functionGrants.rows,
    ...defaultGrants.rows,
    ...rlsViolations.rows,
  ];

  if (violations.length > 0) {
    console.error("Grant verification failed:");
    for (const violation of violations) {
      console.error(
        `  ${violation.violation}: ${violation.object_name} -> ${violation.grantee}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("Grant verification passed: lead_agent has RLS on every table and no function is executable by PUBLIC or anon.");
}

main()
  .catch((error: unknown) => {
    console.error("Grant verification failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  })
  .finally(closePool);
