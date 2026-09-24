-- One paid discovery search per step, judged by what actually ran.
--
-- 0007 counted reservations. The PreToolUse hook reserves before the tool
-- validates its input, so a malformed search_companies call that never ran
-- still counted. In run 12f27441 that left the counter one ahead: the first
-- extra search was refused as "already searched" without any search having
-- run, and the founder lost it. The cap now reads the stored actor runs
-- (apify_jobs), which exist only for searches that started. The apify_calls
-- counter is still written, as an audit of reservations, but no longer decides.
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
      -- The step's own job record is the fact: a search that started has an
      -- actor run id there. A reservation is not a search; counting those let
      -- one rejected call spend the next step's slot.
      if v_job is not null and (v_job ? 'id') then
        return query select false, 'One discovery search per step; this step already searched', 1::numeric, 1::numeric;
        return;
      end if;

      v_limit := (v_limits ->> 'max_apify_calls')::bigint;
      select count(*)
        into v_current
        from jsonb_each(coalesce(v_jobs, '{}'::jsonb)) j
       where jsonb_typeof(j.value) = 'object' and (j.value ? 'id');

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
