import type {
  PlatformAccountDTO,
  PostPackageDTO,
  PublishInput,
  PublishJobStatus,
} from "@vidtryx/social-contract";
import type { ConnectorMode, WorkerEnv } from "../env";
import { ConnectorExecutionError } from "../connectors/base";
import { getConnector } from "../connectors/providerConnectors";
import type { PlatformAccountRow, PostPackageRow, PublishJobRow } from "./types";
import type { SupabaseRestClient } from "./supabaseRest";

type RunWorkerTickInput = {
  env: WorkerEnv;
  db: SupabaseRestClient;
};

type NormalizedFailure = {
  status: PublishJobStatus;
  category: string;
  message: string;
  retryable: boolean;
};

const retryDelayMs = (attemptCount: number) => Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));

const nextAttemptIso = (attemptCount: number) => new Date(Date.now() + retryDelayMs(attemptCount)).toISOString();

const normalizeFailure = (error: unknown): NormalizedFailure => {
  if (error instanceof ConnectorExecutionError) {
    return {
      status: error.status,
      category: error.category,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (error instanceof Error) {
    return {
      status: "retrying",
      category: "worker_error",
      message: error.message,
      retryable: true,
    };
  }

  return {
    status: "retrying",
    category: "unknown_worker_error",
    message: "Unknown worker error",
    retryable: true,
  };
};

const mapPostPackage = (row: PostPackageRow): PostPackageDTO => ({
  id: row.id,
  workspaceId: row.workspace_id,
  capsuleId: row.capsule_id,
  platformAccountId: row.platform_account_id,
  provider: row.provider,
  title: row.title,
  caption: row.caption,
  hashtags: row.hashtags,
  mediaAssetId: row.media_asset_id ?? undefined,
  mediaStoragePath: row.media_storage_path ?? undefined,
  validation: { ok: true },
  createdAt: row.created_at,
});

const mapPlatformAccount = (row: PlatformAccountRow): PlatformAccountDTO => ({
  id: row.id,
  workspaceId: row.workspace_id,
  provider: row.provider,
  providerAccountId: row.provider_account_id,
  handle: row.handle,
  displayName: row.display_name ?? undefined,
  avatarUrl: row.avatar_url ?? undefined,
  scopes: row.scopes,
  status: row.status,
  approvalStatus: row.approval_status,
  tokenExpiresAt: row.token_expires_at ?? undefined,
  lastHealthCheckAt: row.last_health_check_at ?? undefined,
});

function assertJobDependencies(job: PublishJobRow, postPackage: PostPackageDTO, account: PlatformAccountDTO) {
  const mismatches: string[] = [];

  if (postPackage.id !== job.package_id) mismatches.push("package id");
  if (postPackage.workspaceId !== job.workspace_id) mismatches.push("package workspace");
  if (postPackage.platformAccountId !== job.platform_account_id) mismatches.push("package account");
  if (postPackage.provider !== job.provider) mismatches.push("package provider");
  if (account.id !== job.platform_account_id) mismatches.push("account id");
  if (account.workspaceId !== job.workspace_id) mismatches.push("account workspace");
  if (account.provider !== job.provider) mismatches.push("account provider");

  if (mismatches.length > 0) {
    throw new ConnectorExecutionError(
      `Publish job dependencies do not match the claimed job: ${mismatches.join(", ")}.`,
      "job_dependency_mismatch",
      false,
      "blocked_by_platform",
    );
  }
}

async function setJobStatus(db: SupabaseRestClient, job: PublishJobRow, status: PublishJobStatus) {
  await db.updatePublishJob(job.id, { status });
  await db.insertPublishEvent({
    workspace_id: job.workspace_id,
    distribution_run_id: job.distribution_run_id,
    job_id: job.id,
    event_type: `publish.${status}`,
    message: `Publish job moved to ${status}.`,
    payload: { provider: job.provider },
  });
}

async function processJob(job: PublishJobRow, db: SupabaseRestClient, connectorMode: ConnectorMode) {
  const connector = getConnector(job.provider, connectorMode);
  const [postPackageRow, accountRow] = await Promise.all([
    db.getPostPackage(job.package_id),
    db.getPlatformAccount(job.platform_account_id),
  ]);
  const postPackage = mapPostPackage(postPackageRow);
  const account = mapPlatformAccount(accountRow);

  assertJobDependencies(job, postPackage, account);

  if (account.status === "needs_reauth") {
    throw new ConnectorExecutionError("Platform account needs reauthorization.", "needs_reauth", false, "needs_reauth");
  }

  if (account.status !== "connected") {
    throw new ConnectorExecutionError(
      `Platform account is ${account.status}.`,
      "account_not_connected",
      false,
      "blocked_by_platform",
    );
  }

  const validation = await connector.validatePackage(postPackage);
  if (!validation.ok) {
    throw new ConnectorExecutionError(validation.message, validation.category, false, "blocked_by_platform");
  }

  await setJobStatus(db, job, "uploading_media");

  const publishInput: PublishInput = {
    jobId: job.id,
    workspaceId: job.workspace_id,
    packageId: job.package_id,
    platformAccountId: job.platform_account_id,
    provider: job.provider,
  };

  await setJobStatus(db, job, "publishing");
  const result = await connector.publish(publishInput);
  const attemptNumber = job.attempt_count + 1;

  await db.updatePublishJob(job.id, {
    status: result.status,
    attempt_count: attemptNumber,
    next_attempt_at: null,
    platform_media_id: result.platformMediaId,
    platform_post_id: result.platformPostId,
    platform_post_url: result.platformPostUrl,
    error_category: null,
    error_summary: null,
  });
  await db.insertPublishAttempt({
    workspace_id: job.workspace_id,
    job_id: job.id,
    attempt_number: attemptNumber,
    status: result.status,
    response_summary: result.providerResponseSummary,
  });
  await db.insertPublishEvent({
    workspace_id: job.workspace_id,
    distribution_run_id: job.distribution_run_id,
    job_id: job.id,
    event_type: `publish.${result.status}`,
    message: result.status === "posted" ? "Post published." : "Post is processing on the platform.",
    payload: {
      provider: job.provider,
      platformPostUrl: result.platformPostUrl,
    },
  });
}

async function markFailed(job: PublishJobRow, db: SupabaseRestClient, failure: NormalizedFailure) {
  const attemptCount = job.attempt_count + 1;
  await db.updatePublishJob(job.id, {
    status: failure.status,
    attempt_count: attemptCount,
    next_attempt_at: failure.retryable ? nextAttemptIso(attemptCount) : null,
    error_category: failure.category,
    error_summary: failure.message,
  });
  await db.insertPublishAttempt({
    workspace_id: job.workspace_id,
    job_id: job.id,
    attempt_number: attemptCount,
    status: failure.status,
    error_category: failure.category,
    response_summary: failure.message,
  });
  await db.insertPublishEvent({
    workspace_id: job.workspace_id,
    distribution_run_id: job.distribution_run_id,
    job_id: job.id,
    event_type: `publish.${failure.status}`,
    message: failure.message,
    payload: {
      provider: job.provider,
      category: failure.category,
      retryable: failure.retryable,
    },
  });
}

export async function runPublishWorkerTick({ env, db }: RunWorkerTickInput): Promise<number> {
  const claimedJobs = await db.claimDuePublishJobs(env.maxJobs, env.workerId);

  for (const job of claimedJobs) {
    try {
      await db.insertPublishEvent({
        workspace_id: job.workspace_id,
        distribution_run_id: job.distribution_run_id,
        job_id: job.id,
        event_type: "publish.claimed",
        message: "Worker claimed publish job.",
        payload: { provider: job.provider, workerId: env.workerId },
      });
      await processJob(job, db, env.connectorMode);
    } catch (error) {
      await markFailed(job, db, normalizeFailure(error));
    }
  }

  return claimedJobs.length;
}
