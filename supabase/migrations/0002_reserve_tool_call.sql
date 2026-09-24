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
  v_current bigint;
  v_limit bigint;
  v_scope text;
  v_is_apify boolean := right(p_tool_name, length('search_companies')) = 'search_companies';
  v_is_scrape boolean := right(p_tool_name, length('scrape_site')) = 'scrape_site';
begin
  select r.limits, r.agent_cost_usd, r.apify_cost_usd
    into v_limits, v_agent_cost, v_apify_cost
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

    if v_apify_cost >= (v_limits ->> 'apify_budget_usd')::numeric then
      return query select false, 'Apify budget reached', v_apify_cost, (v_limits ->> 'apify_budget_usd')::numeric;
      return;
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

  if v_is_apify then
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
