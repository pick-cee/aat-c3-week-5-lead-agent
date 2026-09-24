-- Research the likeliest fits first. A run's AI budget covers a fraction of
-- what a search returns (27 companies to research, 8 researched in the
-- 2026-09-24 replay), and companies were researched in the order LinkedIn
-- returned them, so a warehousing firm could take a slot ahead of a fashion
-- brand for an e-commerce brief. The priority is how well the company's own
-- LinkedIn industry matches the confirmed criteria; nothing is skipped by it.
alter table lead_agent.candidates
  add column if not exists research_priority smallint not null default 0;

create index if not exists candidates_research_queue
  on lead_agent.candidates (run_id, research_priority desc, created_at)
  where status in ('discovered', 'researching');
