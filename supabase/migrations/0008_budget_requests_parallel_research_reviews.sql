-- A run that needs more budget pauses and asks, instead of ending. Only a
-- person can raise a cap; the agent still never chooses one.
alter type lead_agent.run_status add value if not exists 'awaiting_budget';

alter table lead_agent.runs
  add column if not exists budget_request jsonb;

alter table lead_agent.runs
  add constraint runs_budget_request_object check (budget_request is null or jsonb_typeof(budget_request) = 'object');

-- Extra searches approved by a founder go beyond the original two refills.
alter table lead_agent.runs drop constraint if exists runs_refills_used_check;
alter table lead_agent.runs
  add constraint runs_refills_used_check check (refills_used between 0 and 10);

alter table lead_agent.candidates alter column origin drop default;
alter table lead_agent.candidates
  alter column origin type text using origin::text;
alter table lead_agent.candidates alter column origin set default 'discovery';
alter table lead_agent.candidates
  add constraint candidates_origin_shape check (origin ~ '^(discovery|refill_[0-9]{1,2})$');

-- Several companies are researched at once. The start time lets a later step
-- tell a company whose research died with its runner from one still running.
alter table lead_agent.candidates
  add column if not exists research_started_at timestamptz;
