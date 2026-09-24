alter table lead_agent.runs
  add column if not exists notification_email text,
  add column if not exists notify_on_success boolean not null default true,
  add column if not exists notify_on_failure boolean not null default true,
  add column if not exists deleted_at timestamptz;

alter table lead_agent.runs
  add constraint runs_notification_email_shape check (
    notification_email is null
    or (
      length(notification_email) between 3 and 320
      and position('@' in notification_email) > 1
    )
  );

create index runs_active_created_idx
  on lead_agent.runs (created_at desc)
  where deleted_at is null;

create index runs_deleted_created_idx
  on lead_agent.runs (deleted_at desc)
  where deleted_at is not null;

revoke all on lead_agent.runs from public, anon, authenticated;
grant select, insert, update, delete on lead_agent.runs to service_role;
