create type lead_agent.run_status as enum (
  'draft',
  'awaiting_icp_confirmation',
  'discovering',
  'researching',
  'drafting',
  'complete',
  'short_of_target',
  'budget_exceeded',
  'failed',
  'cancelled'
);

create type lead_agent.run_stage as enum (
  'refine_icp',
  'discover',
  'qualify_one',
  'draft_one'
);

create type lead_agent.candidate_origin as enum (
  'discovery',
  'refill_1',
  'refill_2'
);

create type lead_agent.candidate_status as enum (
  'discovered',
  'researching',
  'qualified',
  'not_qualified',
  'needs_review',
  'failed',
  'skipped'
);

create type lead_agent.fetch_status as enum (
  'ok',
  'fetch_failed',
  'blocked',
  'paywalled',
  'empty',
  'unsupported_type',
  'too_large'
);

create type lead_agent.qualification_status as enum (
  'qualified',
  'not_qualified',
  'needs_review'
);

create type lead_agent.outreach_channel as enum ('email', 'linkedin');

create type lead_agent.outreach_status as enum (
  'draft',
  'needs_review',
  'approved',
  'rejected'
);

create type lead_agent.tool_call_status as enum ('ok', 'error', 'refused');

create table lead_agent.runs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  objective text not null check (length(btrim(objective)) > 0),
  refined_icp jsonb,
  icp_confirmed_at timestamptz,
  icp_confirmed_by uuid,
  limits jsonb not null check (jsonb_typeof(limits) = 'object'),
  status lead_agent.run_status not null default 'draft',
  stage lead_agent.run_stage not null default 'refine_icp',
  stage_attempts integer not null default 0 check (stage_attempts >= 0),
  target_leads integer not null default 10 check (target_leads > 0),
  qualified_count integer not null default 0 check (qualified_count >= 0),
  refills_used integer not null default 0 check (refills_used between 0 and 2),
  soft_preferences_dropped jsonb not null default '[]'::jsonb
    check (jsonb_typeof(soft_preferences_dropped) = 'array'),
  failure_stage text,
  failure_reason text,
  failure_detail jsonb,
  agent_cost_usd numeric(12, 6) not null default 0 check (agent_cost_usd >= 0),
  apify_cost_usd numeric(12, 6) not null default 0 check (apify_cost_usd >= 0),
  cost_complete boolean not null default true,
  quality_scorecard jsonb,
  runner_lease_until timestamptz,
  runner_lease_id text,
  submit_token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint complete_requires_target check (
    status <> 'complete' or qualified_count >= target_leads
  ),
  constraint confirmed_icp_pair check (
    (icp_confirmed_at is null and icp_confirmed_by is null)
    or (icp_confirmed_at is not null and icp_confirmed_by is not null)
  )
);

create table lead_agent.candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references lead_agent.runs(id) on delete cascade,
  company_name text not null check (length(btrim(company_name)) > 0),
  domain text not null check (length(btrim(domain)) > 0),
  domain_canonical text not null check (length(btrim(domain_canonical)) > 0),
  origin lead_agent.candidate_origin not null default 'discovery',
  discovery_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(discovery_payload) = 'object'),
  status lead_agent.candidate_status not null default 'discovered',
  skip_reason text,
  created_at timestamptz not null default now(),
  unique (run_id, domain_canonical),
  unique (id, run_id)
);

create table lead_agent.sources (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null,
  run_id uuid not null,
  url text not null check (length(btrim(url)) > 0),
  fetch_status lead_agent.fetch_status not null,
  http_status integer check (http_status between 100 and 599),
  markdown_chars integer check (markdown_chars >= 0),
  from_cache boolean not null default false,
  injection_suspected boolean not null default false,
  injection_matches jsonb not null default '[]'::jsonb
    check (jsonb_typeof(injection_matches) = 'array'),
  fetch_error text,
  fetched_at timestamptz not null default now(),
  unique (candidate_id, url),
  unique (id, candidate_id),
  foreign key (candidate_id, run_id)
    references lead_agent.candidates(id, run_id) on delete cascade
);

create table lead_agent.excerpts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  candidate_id uuid not null references lead_agent.candidates(id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  text text not null check (length(btrim(text)) > 0),
  heading_path text,
  char_start integer check (char_start >= 0),
  char_end integer check (char_end >= 0),
  created_at timestamptz not null default now(),
  unique (candidate_id, ordinal),
  foreign key (source_id, candidate_id)
    references lead_agent.sources(id, candidate_id) on delete cascade,
  constraint excerpt_offsets_valid check (
    char_start is null or char_end is null or char_end >= char_start
  )
);

create table lead_agent.qualifications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique,
  run_id uuid not null,
  status lead_agent.qualification_status not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  fit_reasons jsonb not null check (jsonb_typeof(fit_reasons) = 'array'),
  concerns jsonb not null check (jsonb_typeof(concerns) = 'array'),
  hard_filter_results jsonb not null check (jsonb_typeof(hard_filter_results) = 'array'),
  source_summary text not null,
  why_now text,
  checks jsonb not null default '{}'::jsonb check (jsonb_typeof(checks) = 'object'),
  model_used text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  foreign key (candidate_id, run_id)
    references lead_agent.candidates(id, run_id) on delete cascade
);

create table lead_agent.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null,
  run_id uuid not null,
  channel lead_agent.outreach_channel not null,
  step integer not null check (step between 1 and 3),
  subject text,
  body text not null check (length(btrim(body)) > 0),
  personalization_note text not null,
  cited_excerpt_ids uuid[] not null check (cardinality(cited_excerpt_ids) > 0),
  checks jsonb not null default '{}'::jsonb check (jsonb_typeof(checks) = 'object'),
  status lead_agent.outreach_status not null default 'draft',
  version integer not null default 1 check (version > 0),
  model_used text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  unique (candidate_id, channel, step, version),
  constraint outreach_channel_step check (
    (channel = 'email' and step between 1 and 3)
    or (channel = 'linkedin' and step = 1)
  ),
  foreign key (candidate_id, run_id)
    references lead_agent.candidates(id, run_id) on delete cascade
);

create table lead_agent.tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references lead_agent.runs(id) on delete cascade,
  candidate_id uuid,
  stage lead_agent.run_stage not null,
  tool_name text not null,
  purpose text not null,
  input_summary jsonb not null default '{}'::jsonb,
  result_summary jsonb,
  status lead_agent.tool_call_status not null,
  error text,
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  duration_ms integer check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  foreign key (candidate_id, run_id)
    references lead_agent.candidates(id, run_id) on delete restrict
);

create table lead_agent.stage_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references lead_agent.runs(id) on delete cascade,
  stage lead_agent.run_stage not null,
  candidate_id uuid,
  session_id text,
  turns integer not null default 0 check (turns >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  result_subtype text,
  error text,
  created_at timestamptz not null default now(),
  foreign key (candidate_id, run_id)
    references lead_agent.candidates(id, run_id) on delete restrict
);

create table lead_agent.usage_counters (
  run_id uuid not null references lead_agent.runs(id) on delete cascade,
  scope text not null check (length(btrim(scope)) > 0),
  counter_name text not null check (length(btrim(counter_name)) > 0),
  value bigint not null default 0 check (value >= 0),
  updated_at timestamptz not null default now(),
  primary key (run_id, scope, counter_name)
);

create index candidates_run_status_idx on lead_agent.candidates (run_id, status);
create index sources_candidate_idx on lead_agent.sources (candidate_id);
create index excerpts_candidate_idx on lead_agent.excerpts (candidate_id, ordinal);
create index qualifications_run_status_idx on lead_agent.qualifications (run_id, status);
create index outreach_drafts_run_idx on lead_agent.outreach_drafts (run_id);
create index tool_calls_run_created_idx on lead_agent.tool_calls (run_id, created_at);
create index stage_runs_run_created_idx on lead_agent.stage_runs (run_id, created_at);

alter table lead_agent.runs enable row level security;
alter table lead_agent.candidates enable row level security;
alter table lead_agent.sources enable row level security;
alter table lead_agent.excerpts enable row level security;
alter table lead_agent.qualifications enable row level security;
alter table lead_agent.outreach_drafts enable row level security;
alter table lead_agent.tool_calls enable row level security;
alter table lead_agent.stage_runs enable row level security;
alter table lead_agent.usage_counters enable row level security;

revoke all on all tables in schema lead_agent from public, anon, authenticated;
grant usage on schema lead_agent to service_role;
grant select, insert, update, delete on all tables in schema lead_agent to service_role;

alter default privileges in schema lead_agent revoke execute on functions from public;
alter default privileges in schema lead_agent revoke all on tables from public, anon, authenticated;
alter default privileges in schema lead_agent grant select, insert, update, delete on tables to service_role;
