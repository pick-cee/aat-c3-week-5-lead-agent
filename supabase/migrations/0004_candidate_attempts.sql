alter table lead_agent.candidates
  add column research_attempts integer not null default 0
  check (research_attempts between 0 and 3);
