-- Durable Stripe Billing state. Stripe remains the payment source of truth;
-- PostgreSQL stores the workspace linkage and the minimum state required to
-- authorize Posterract features without trusting browser redirects.

create table if not exists billing_customers (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing_subscriptions (
  stripe_subscription_id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_product_id text,
  stripe_price_id text,
  billing_interval text check (billing_interval in ('month', 'year')),
  currency text,
  unit_amount integer check (unit_amount is null or unit_amount >= 0),
  status text not null,
  recognized_plan boolean not null default false,
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,
  last_invoice_id text,
  last_payment_status text,
  last_payment_at timestamptz,
  livemode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_subscriptions_workspace_idx
  on billing_subscriptions (workspace_id, updated_at desc);

create index if not exists billing_subscriptions_customer_idx
  on billing_subscriptions (stripe_customer_id);

create table if not exists billing_checkout_sessions (
  stripe_checkout_session_id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_product_id text not null,
  stripe_price_id text not null,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  status text not null,
  payment_status text,
  amount_total integer check (amount_total is null or amount_total >= 0),
  currency text,
  expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_checkout_sessions_workspace_idx
  on billing_checkout_sessions (workspace_id, created_at desc);

create table if not exists stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  api_version text,
  livemode boolean not null,
  stripe_created_at timestamptz,
  payload_sha256 text not null,
  workspace_id uuid references workspaces(id) on delete set null,
  stripe_object_id text,
  processing_status text not null check (
    processing_status in ('processed', 'ignored')
  ),
  received_at timestamptz not null default now(),
  processed_at timestamptz not null default now()
);

create index if not exists stripe_webhook_events_workspace_idx
  on stripe_webhook_events (workspace_id, received_at desc);

create index if not exists stripe_webhook_events_received_idx
  on stripe_webhook_events (received_at desc);
