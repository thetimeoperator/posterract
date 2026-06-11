import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ContentCapsule,
  DistributionRun,
  ModeId,
  PlatformAccount,
  PlatformConnectionStatus,
  PlatformId,
  PostPackage,
  ProviderApprovalStatus,
  PublishJob,
  PublishJobStatus,
  ScheduleMode,
} from "./types";

type SocialBackendKind = "mock" | "supabase";

export type SocialBackendStatus = "mock" | "syncing" | "ready" | "failed";

export type SocialBackendSnapshot = {
  platformAccounts?: PlatformAccount[];
  publishJobs?: PublishJob[];
  capsules?: ContentCapsule[];
};

export type CreateDistributionRunInput = {
  capsule: ContentCapsule;
  caption: string;
  targets: PlatformAccount[];
  scheduleMode: ScheduleMode;
  scheduledFor: string;
};

export type CreateDistributionRunResult = {
  distributionRun: DistributionRun;
  postPackages: PostPackage[];
  publishJobs: PublishJob[];
  capsule: ContentCapsule;
};

export type SocialBackend = {
  kind: SocialBackendKind;
  configured: boolean;
  loadSnapshot: () => Promise<SocialBackendSnapshot>;
  saveCapsule: (capsule: ContentCapsule) => Promise<ContentCapsule>;
  createDistributionRun: (input: CreateDistributionRunInput) => Promise<CreateDistributionRunResult>;
};

type PlatformAccountRow = {
  id: string;
  provider: PlatformId;
  provider_account_id: string;
  handle: string;
  display_name?: string | null;
  avatar_url?: string | null;
  scopes: string[];
  status: PlatformConnectionStatus;
  approval_status: ProviderApprovalStatus;
  token_expires_at?: string | null;
  last_health_check_at?: string | null;
};

type PublishJobRow = {
  id: string;
  distribution_run_id: string;
  capsule_id: string;
  package_id: string;
  platform_account_id: string;
  provider: PlatformId;
  status: PublishJobStatus;
  scheduled_for: string;
  created_at: string;
  platform_post_url?: string | null;
  error_summary?: string | null;
};

type PostPackageRow = {
  id: string;
  capsule_id: string;
  platform_account_id: string;
  provider: PlatformId;
  title: string;
  caption: string;
  hashtags: string[];
  media_storage_path?: string | null;
};

type DistributionRunRow = {
  id: string;
  capsule_id: string;
  status: PublishJobStatus;
  created_at: string;
};

type ContentCapsuleRow = {
  id: string;
  client_ref?: string | null;
  mode_id: string;
  status: ContentCapsule["status"];
  title: string;
  summary?: string | null;
  caption_base: string;
  hashtags: string[];
  duration_ms?: number | null;
  aspect_ratio?: ContentCapsule["aspect"] | null;
  created_at: string;
};

const platformMeta: Record<
  PlatformId,
  {
    platform: string;
    color: string;
    fallbackHandle: string;
  }
> = {
  tiktok: { platform: "TikTok", color: "#7cf7ff", fallbackHandle: "Connect TikTok" },
  instagram: { platform: "Instagram", color: "#ff72d2", fallbackHandle: "Connect Instagram" },
  "youtube-shorts": { platform: "YouTube Shorts", color: "#ff5f5f", fallbackHandle: "Connect YouTube" },
  x: { platform: "X", color: "#f1f6ff", fallbackHandle: "Connect X" },
  threads: { platform: "Threads", color: "#d8dcff", fallbackHandle: "Connect Threads" },
  facebook: { platform: "Facebook", color: "#82a9ff", fallbackHandle: "Connect Facebook" },
  linkedin: { platform: "LinkedIn", color: "#77c9ff", fallbackHandle: "Connect LinkedIn" },
};

const statusCopy: Record<PlatformConnectionStatus, string> = {
  connected: "Connected",
  needs_connection: "Needs connection",
  needs_reauth: "Needs reauth",
  pending_approval: "Pending approval",
  unavailable: "Platform unavailable",
};

const isModeId = (modeId: string): modeId is ModeId =>
  ["news-character", "ugc-ad", "product-demo", "faceless-reel", "clip-repurposer"].includes(modeId);

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const durationLabel = (durationMs?: number | null) => {
  if (!durationMs) return "0:30";
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

const parseDurationMs = (duration: string) => {
  const [minutes = "0", seconds = "0"] = duration.split(":");
  const parsedMinutes = Number.parseInt(minutes, 10);
  const parsedSeconds = Number.parseInt(seconds, 10);
  if (!Number.isFinite(parsedMinutes) || !Number.isFinite(parsedSeconds)) return undefined;
  return (parsedMinutes * 60 + parsedSeconds) * 1000;
};

function mapPlatformAccount(row: PlatformAccountRow): PlatformAccount {
  const meta = platformMeta[row.provider];
  return {
    id: row.provider,
    accountId: row.id,
    platform: meta.platform,
    handle: row.handle || meta.fallbackHandle,
    connected: row.status === "connected",
    connectionStatus: row.status,
    approvalStatus: row.approval_status,
    scopes: row.scopes,
    tokenExpiresAt: row.token_expires_at ?? undefined,
    lastHealthCheckAt: row.last_health_check_at ?? undefined,
    color: meta.color,
    requirements: statusCopy[row.status],
  };
}

function mapPublishJob(row: PublishJobRow, accounts: PlatformAccount[]): PublishJob {
  const account = accounts.find((candidate) => candidate.accountId === row.platform_account_id);
  return {
    id: row.id,
    capsuleId: row.capsule_id,
    platformId: row.provider,
    packageId: row.package_id,
    status: row.status,
    scheduledFor: row.scheduled_for,
    createdAt: row.created_at,
    label: `${account?.platform ?? platformMeta[row.provider].platform} publish job`,
    platformPostUrl: row.platform_post_url ?? undefined,
    error: row.error_summary ?? undefined,
  };
}

function mapCapsule(row: ContentCapsuleRow): ContentCapsule {
  const modeId = isModeId(row.mode_id) ? row.mode_id : "news-character";
  return {
    id: row.client_ref ?? row.id,
    backendId: row.id,
    title: row.title,
    modeId,
    status: row.status,
    summary: row.summary ?? "Synced Vidtryx capsule.",
    duration: durationLabel(row.duration_ms),
    aspect: row.aspect_ratio ?? "9:16",
    thumbnailTone: "#65ff9a",
    caption: row.caption_base,
    hashtags: row.hashtags,
    createdAt: row.created_at,
  };
}

function mapPostPackage(row: PostPackageRow, localCapsuleId: string): PostPackage {
  return {
    id: row.id,
    capsuleId: localCapsuleId,
    platformId: row.provider,
    title: row.title,
    caption: row.caption,
    hashtags: row.hashtags,
    mediaUrl: row.media_storage_path ?? undefined,
  };
}

class SupabaseSocialBackend implements SocialBackend {
  readonly kind = "supabase";
  readonly configured = true;
  private readonly client: SupabaseClient;
  private readonly workspaceId: string;

  constructor(client: SupabaseClient, workspaceId: string) {
    this.client = client;
    this.workspaceId = workspaceId;
  }

  async loadSnapshot(): Promise<SocialBackendSnapshot> {
    const [accountsResult, jobsResult, capsulesResult] = await Promise.all([
      this.client
        .from("platform_accounts")
        .select("id,provider,provider_account_id,handle,display_name,avatar_url,scopes,status,approval_status,token_expires_at,last_health_check_at")
        .eq("workspace_id", this.workspaceId),
      this.client
        .from("publish_jobs")
        .select("id,distribution_run_id,capsule_id,package_id,platform_account_id,provider,status,scheduled_for,created_at,platform_post_url,error_summary")
        .eq("workspace_id", this.workspaceId)
        .order("created_at", { ascending: false })
        .limit(20),
      this.client
        .from("content_capsules")
        .select("id,client_ref,mode_id,status,title,summary,caption_base,hashtags,duration_ms,aspect_ratio,created_at")
        .eq("workspace_id", this.workspaceId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (accountsResult.error) throw accountsResult.error;
    if (jobsResult.error) throw jobsResult.error;
    if (capsulesResult.error) throw capsulesResult.error;

    const platformAccounts = ((accountsResult.data ?? []) as PlatformAccountRow[]).map(mapPlatformAccount);
    return {
      platformAccounts,
      publishJobs: ((jobsResult.data ?? []) as PublishJobRow[]).map((row) => mapPublishJob(row, platformAccounts)),
      capsules: ((capsulesResult.data ?? []) as ContentCapsuleRow[]).map(mapCapsule),
    };
  }

  async saveCapsule(capsule: ContentCapsule): Promise<ContentCapsule> {
    const backendId = await this.ensureCapsule(capsule);
    return { ...capsule, backendId };
  }

  async createDistributionRun(input: CreateDistributionRunInput): Promise<CreateDistributionRunResult> {
    const backendCapsuleId = await this.ensureCapsule(input.capsule);
    const targetAccountIds = input.targets.map((target) => target.accountId);
    if (targetAccountIds.some((accountId) => !accountId)) {
      throw new Error("Connected platform accounts must be synced from Supabase before scheduling.");
    }

    const runResult = await this.client
      .from("distribution_runs")
      .insert({
        workspace_id: this.workspaceId,
        capsule_id: backendCapsuleId,
        status: "scheduled",
        schedule_mode: input.scheduleMode,
        scheduled_for: input.scheduledFor,
      })
      .select("id,capsule_id,status,created_at")
      .single();

    if (runResult.error) throw runResult.error;
    const run = runResult.data as DistributionRunRow;

    const packageRows = input.targets.map((target) => ({
      workspace_id: this.workspaceId,
      capsule_id: backendCapsuleId,
      platform_account_id: target.accountId,
      provider: target.id,
      title: input.capsule.title,
      caption: input.caption,
      hashtags: input.capsule.hashtags,
      media_storage_path: input.capsule.mediaStoragePath,
    }));

    const packagesResult = await this.client
      .from("post_packages")
      .insert(packageRows)
      .select("id,capsule_id,platform_account_id,provider,title,caption,hashtags,media_storage_path");

    if (packagesResult.error) throw packagesResult.error;
    const packages = packagesResult.data as PostPackageRow[];

    const jobRows = packages.map((postPackage) => ({
      workspace_id: this.workspaceId,
      distribution_run_id: run.id,
      capsule_id: backendCapsuleId,
      package_id: postPackage.id,
      platform_account_id: postPackage.platform_account_id,
      provider: postPackage.provider,
      status: "scheduled",
      scheduled_for: input.scheduledFor,
    }));

    const jobsResult = await this.client
      .from("publish_jobs")
      .insert(jobRows)
      .select("id,distribution_run_id,capsule_id,package_id,platform_account_id,provider,status,scheduled_for,created_at,platform_post_url,error_summary");

    if (jobsResult.error) throw jobsResult.error;

    const localCapsule = { ...input.capsule, backendId: backendCapsuleId };
    const platformAccounts = input.targets;
    const jobs = (jobsResult.data as PublishJobRow[]).map((row) => ({
      ...mapPublishJob(row, platformAccounts),
      capsuleId: input.capsule.id,
    }));

    return {
      capsule: localCapsule,
      postPackages: packages.map((row) => mapPostPackage(row, input.capsule.id)),
      publishJobs: jobs,
      distributionRun: {
        id: run.id,
        capsuleId: input.capsule.id,
        jobIds: jobs.map((job) => job.id),
        createdAt: run.created_at,
        status: run.status === "posted" || run.status === "failed" ? run.status : "scheduled",
      },
    };
  }

  private async ensureCapsule(capsule: ContentCapsule): Promise<string> {
    if (capsule.backendId && isUuid(capsule.backendId)) return capsule.backendId;
    if (isUuid(capsule.id)) return capsule.id;

    const existing = await this.client
      .from("content_capsules")
      .select("id")
      .eq("workspace_id", this.workspaceId)
      .eq("client_ref", capsule.id)
      .maybeSingle();

    if (existing.error) throw existing.error;
    if (existing.data?.id) return existing.data.id as string;

    const inserted = await this.client
      .from("content_capsules")
      .insert({
        workspace_id: this.workspaceId,
        client_ref: capsule.id,
        mode_id: capsule.modeId,
        status: capsule.status,
        title: capsule.title,
        summary: capsule.summary,
        caption_base: capsule.caption,
        hashtags: capsule.hashtags,
        duration_ms: parseDurationMs(capsule.duration),
        aspect_ratio: capsule.aspect,
      })
      .select("id")
      .single();

    if (inserted.error) throw inserted.error;
    return inserted.data.id as string;
  }
}

const mockBackend: SocialBackend = {
  kind: "mock",
  configured: false,
  async loadSnapshot() {
    return {};
  },
  async saveCapsule(capsule) {
    return capsule;
  },
  async createDistributionRun() {
    throw new Error("Supabase social backend is not configured.");
  },
};

function createSocialBackend(): SocialBackend {
  const mode = import.meta.env.VITE_VIDTRYX_SOCIAL_BACKEND;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const workspaceId = import.meta.env.VITE_VIDTRYX_WORKSPACE_ID;

  if (mode !== "supabase" || !supabaseUrl || !anonKey || !workspaceId) return mockBackend;

  return new SupabaseSocialBackend(
    createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    }),
    workspaceId,
  );
}

const socialBackend = createSocialBackend();

export function getSocialBackend() {
  return socialBackend;
}
