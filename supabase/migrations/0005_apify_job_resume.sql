alter table lead_agent.runs
  add column if not exists apify_jobs jsonb not null default '{}'::jsonb;

alter table lead_agent.runs
  add constraint runs_apify_jobs_object check (jsonb_typeof(apify_jobs) = 'object');
