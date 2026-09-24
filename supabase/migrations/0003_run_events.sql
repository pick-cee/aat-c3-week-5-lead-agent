create table lead_agent.run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references lead_agent.runs(id) on delete cascade,
  from_status lead_agent.run_status,
  to_status lead_agent.run_status not null,
  stage lead_agent.run_stage not null,
  message text not null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);

create index run_events_run_created_idx on lead_agent.run_events (run_id, created_at);

alter table lead_agent.run_events enable row level security;
revoke all on lead_agent.run_events from public, anon, authenticated;
grant select, insert on lead_agent.run_events to service_role;
