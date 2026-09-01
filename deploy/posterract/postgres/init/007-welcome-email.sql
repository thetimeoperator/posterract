-- Queue a welcome email exactly once after Better Auth verifies a user.

alter table app_users
  add column if not exists welcome_email_sent_at timestamptz;

create unique index if not exists outbox_one_welcome_email_per_user_idx
  on outbox_events (aggregate_type, aggregate_id, event_type)
  where event_type = 'auth.welcome_email_requested';
