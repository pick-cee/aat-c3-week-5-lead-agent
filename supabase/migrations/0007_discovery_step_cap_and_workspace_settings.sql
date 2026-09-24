-- One paid discovery search per discovery step. The prompt asked for "exactly
-- once", yet run 815b1dda recorded three Apify reservations for one executed
-- search, which spent both refills before either ran. A prompt is a request;
-- this function is the fact. Resuming an actor run that already started for the
-- current step is not a new paid start, so it is allowed without counting.
create or replace function lead_agent.reserve_tool_call(
  p_run_id uuid,
  p_candidate_id uuid,
  p_tool_name text
)
returns table (
  allowed boolean,
  reason text,
  current_value numeric,
  limit_value numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits jsonb;
  v_agent_cost numeric;
  v_apify_cost numeric;
  v_refills integer;
  v_jobs jsonb;
  v_job jsonb;
  v_is_resume boolean := false;
  v_current bigint;
  v_limit bigint;
  v_scope text;
  v_is_apify boolean := right(p_tool_name, length('search_companies')) = 'search_companies';
  v_is_scrape boolean := right(p_tool_name, length('scrape_site')) = 'scrape_site';
begin
  select r.limits, r.agent_cost_usd, r.apify_cost_usd, r.refills_used, r.apify_jobs
    into v_limits, v_agent_cost, v_apify_cost, v_refills, v_jobs
    from lead_agent.runs r
   where r.id = p_run_id
   for update;

  if not found then
    return query select false, 'Run not found', 0::numeric, 0::numeric;
    return;
  end if;

  if not (v_limits ? 'max_tool_calls') or not (v_limits ? 'agent_budget_usd') then
    return query select false, 'Run limits are incomplete', 0::numeric, 0::numeric;
    return;
  end if;

  v_limit := (v_limits ->> 'max_tool_calls')::bigint;
  select coalesce(uc.value, 0)
    into v_current
    from lead_agent.usage_counters uc
   where uc.run_id = p_run_id
     and uc.scope = 'run'
     and uc.counter_name = 'tool_calls_total';

  v_current := coalesce(v_current, 0);
  if v_current >= v_limit then
    return query select false, 'Maximum tool-call count reached', v_current::numeric, v_limit::numeric;
    return;
  end if;

  if v_agent_cost >= (v_limits ->> 'agent_budget_usd')::numeric then
    return query select false, 'Agent budget reached', v_agent_cost, (v_limits ->> 'agent_budget_usd')::numeric;
    return;
  end if;

  if v_is_apify then
    if not (v_limits ? 'max_apify_calls') or not (v_limits ? 'apify_budget_usd') then
      return query select false, 'Apify limits are incomplete', 0::numeric, 0::numeric;
      return;
    end if;

    v_job := coalesce(v_jobs, '{}'::jsonb) -> ('discovery_' || v_refills::text);
    v_is_resume := v_job is not null
      and (v_job ? 'id')
      and not coalesce((v_job ->> 'cost_recorded')::boolean, false);

    if not v_is_resume then
      v_limit := (v_limits ->> 'max_apify_calls')::bigint;
      select coalesce(uc.value, 0)
        into v_current
        from lead_agent.usage_counters uc
       where uc.run_id = p_run_id
         and uc.scope = 'run'
         and uc.counter_name = 'apify_calls';

      v_current := coalesce(v_current, 0);
      if v_current >= v_limit then
        return query select false, 'Maximum Apify call count reached', v_current::numeric, v_limit::numeric;
        return;
      end if;

      if v_current >= v_refills + 1 then
        return query select false, 'One discovery search per step; this step already searched', v_current::numeric, (v_refills + 1)::numeric;
        return;
      end if;

      if v_apify_cost >= (v_limits ->> 'apify_budget_usd')::numeric then
        return query select false, 'Apify budget reached', v_apify_cost, (v_limits ->> 'apify_budget_usd')::numeric;
        return;
      end if;
    end if;
  end if;

  if v_is_scrape then
    if not (v_limits ? 'max_scrapes_total') or not (v_limits ? 'max_scrapes_per_company') then
      return query select false, 'Scrape limits are incomplete', 0::numeric, 0::numeric;
      return;
    end if;

    v_limit := (v_limits ->> 'max_scrapes_total')::bigint;
    select coalesce(uc.value, 0)
      into v_current
      from lead_agent.usage_counters uc
     where uc.run_id = p_run_id
       and uc.scope = 'run'
       and uc.counter_name = 'scrapes_total';

    v_current := coalesce(v_current, 0);
    if v_current >= v_limit then
      return query select false, 'Maximum total scrape count reached', v_current::numeric, v_limit::numeric;
      return;
    end if;

    if p_candidate_id is null then
      return query select false, 'A candidate is required for scraping', 0::numeric, 0::numeric;
      return;
    end if;

    v_scope := 'candidate:' || p_candidate_id::text;
    v_limit := (v_limits ->> 'max_scrapes_per_company')::bigint;
    select coalesce(uc.value, 0)
      into v_current
      from lead_agent.usage_counters uc
     where uc.run_id = p_run_id
       and uc.scope = v_scope
       and uc.counter_name = 'scrapes';

    v_current := coalesce(v_current, 0);
    if v_current >= v_limit then
      return query select false, 'Maximum scrape count for candidate reached', v_current::numeric, v_limit::numeric;
      return;
    end if;
  end if;

  insert into lead_agent.usage_counters (run_id, scope, counter_name, value)
  values (p_run_id, 'run', 'tool_calls_total', 1)
  on conflict (run_id, scope, counter_name)
  do update set value = lead_agent.usage_counters.value + 1, updated_at = now();

  if v_is_apify and not v_is_resume then
    insert into lead_agent.usage_counters (run_id, scope, counter_name, value)
    values (p_run_id, 'run', 'apify_calls', 1)
    on conflict (run_id, scope, counter_name)
    do update set value = lead_agent.usage_counters.value + 1, updated_at = now();
  end if;

  if v_is_scrape then
    insert into lead_agent.usage_counters (run_id, scope, counter_name, value)
    values (p_run_id, 'run', 'scrapes_total', 1)
    on conflict (run_id, scope, counter_name)
    do update set value = lead_agent.usage_counters.value + 1, updated_at = now();

    insert into lead_agent.usage_counters (run_id, scope, counter_name, value)
    values (p_run_id, v_scope, 'scrapes', 1)
    on conflict (run_id, scope, counter_name)
    do update set value = lead_agent.usage_counters.value + 1, updated_at = now();
  end if;

  return query select true, null::text, (v_current + 1)::numeric, v_limit::numeric;
end;
$$;

revoke all on function lead_agent.reserve_tool_call(uuid, uuid, text) from public, anon, authenticated;
grant execute on function lead_agent.reserve_tool_call(uuid, uuid, text) to service_role;

-- Notification defaults live with the workspace rather than in one browser's
-- localStorage, so the server-side runner can read them and a founder on a
-- second device sees the same address.
create table if not exists lead_agent.workspace_settings (
  id smallint primary key default 1 check (id = 1),
  notification_email text check (
    notification_email is null
    or (length(notification_email) between 3 and 320 and position('@' in notification_email) > 1)
  ),
  notify_on_success boolean not null default true,
  notify_on_failure boolean not null default true,
  last_test_email_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into lead_agent.workspace_settings (id) values (1) on conflict (id) do nothing;

alter table lead_agent.workspace_settings enable row level security;
revoke all on lead_agent.workspace_settings from public, anon, authenticated;
grant select, insert, update on lead_agent.workspace_settings to service_role;

-- A confirmed ICP is re-runnable. Companies the earlier run already decided on
-- are excluded so a founder never pays research cost to reject them twice.
alter table lead_agent.runs
  add column if not exists source_run_id uuid references lead_agent.runs(id) on delete set null,
  add column if not exists excluded_domains jsonb not null default '[]'::jsonb;

alter table lead_agent.runs
  add constraint runs_excluded_domains_array check (jsonb_typeof(excluded_domains) = 'array');

-- One lead whose drafts fail validation no longer fails the whole run; it is
-- retried a bounded number of times and then marked, like research failures.
alter table lead_agent.candidates
  add column if not exists draft_attempts integer not null default 0
  check (draft_attempts between 0 and 3);
