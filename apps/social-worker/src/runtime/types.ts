import type { PlatformId, PublishJobStatus } from "@vidtryx/social-contract";

export type PublishJobRow = {
  id: string;
  workspace_id: string;
  distribution_run_id: string;
  capsule_id: string;
  package_id: string;
  platform_account_id: string;
  provider: PlatformId;
  status: PublishJobStatus;
  scheduled_for: string;
  claimed_by?: string | null;
  claimed_at?: string | null;
  attempt_count: number;
  next_attempt_at?: string | null;
  idempotency_key: string;
  platform_media_id?: string | null;
  platform_post_id?: string | null;
  platform_post_url?: string | null;
  error_category?: string | null;
  error_summary?: string | null;
  created_at: string;
  updated_at: string;
};

export type PostPackageRow = {
  id: string;
  workspace_id: string;
  capsule_id: string;
  platform_account_id: string;
  provider: PlatformId;
  title: string;
  caption: string;
  hashtags: string[];
  media_asset_id?: string | null;
  media_storage_path?: string | null;
  validation: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PlatformAccountRow = {
  id: string;
  workspace_id: string;
  provider: PlatformId;
  provider_account_id: string;
  handle: string;
  display_name?: string | null;
  avatar_url?: string | null;
  scopes: string[];
  status: "connected" | "needs_connection" | "needs_reauth" | "pending_approval" | "unavailable";
  approval_status: "ready" | "pending_review" | "dev_only" | "blocked";
  token_expires_at?: string | null;
  last_health_check_at?: string | null;
};

export type PublishAttemptInsert = {
  workspace_id: string;
  job_id: string;
  attempt_number: number;
  status: PublishJobStatus;
  provider_request_id?: string;
  error_category?: string;
  response_summary?: string;
};

export type PublishEventInsert = {
  workspace_id: string;
  distribution_run_id?: string;
  job_id?: string;
  event_type: string;
  message: string;
  payload?: Record<string, unknown>;
};
