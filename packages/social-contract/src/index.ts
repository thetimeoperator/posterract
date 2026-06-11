export const PLATFORM_IDS = [
  "tiktok",
  "instagram",
  "youtube-shorts",
  "x",
  "threads",
  "facebook",
  "linkedin",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export type AccountConnectionStatus =
  | "connected"
  | "needs_connection"
  | "needs_reauth"
  | "pending_approval"
  | "unavailable";

export type ProviderApprovalStatus = "ready" | "pending_review" | "dev_only" | "blocked";

export type PublishJobStatus =
  | "draft"
  | "scheduled"
  | "claiming"
  | "uploading_media"
  | "publishing"
  | "processing"
  | "posted"
  | "failed"
  | "retrying"
  | "needs_reauth"
  | "blocked_by_platform";

export type ScheduleMode = "now" | "later";

export type AssetDTO = {
  id: string;
  workspaceId: string;
  capsuleId?: string;
  storageBucket: string;
  storagePath: string;
  publicPreviewUrl?: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  aspectRatio?: "9:16" | "1:1" | "16:9" | string;
  checksumSha256?: string;
  createdAt: string;
};

export type ContentCapsuleDTO = {
  id: string;
  workspaceId: string;
  modeId: string;
  status: "draft" | "ready" | "scheduled" | "posting" | "posted" | "failed";
  title: string;
  captionBase: string;
  thumbnailAssetId?: string;
  primaryAssetId?: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformAccountDTO = {
  id: string;
  workspaceId: string;
  provider: PlatformId;
  providerAccountId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  scopes: string[];
  status: AccountConnectionStatus;
  approvalStatus: ProviderApprovalStatus;
  tokenExpiresAt?: string;
  lastHealthCheckAt?: string;
};

export type PostPackageDTO = {
  id: string;
  workspaceId: string;
  capsuleId: string;
  platformAccountId: string;
  provider: PlatformId;
  title: string;
  caption: string;
  hashtags: string[];
  mediaAssetId?: string;
  mediaStoragePath?: string;
  validation?: ValidationResult;
  createdAt: string;
};

export type PublishJobDTO = {
  id: string;
  workspaceId: string;
  distributionRunId: string;
  capsuleId: string;
  packageId: string;
  platformAccountId: string;
  provider: PlatformId;
  status: PublishJobStatus;
  scheduledFor: string;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  platformMediaId?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  errorCategory?: string;
  errorSummary?: string;
};

export type PublishEventDTO = {
  id: string;
  workspaceId: string;
  distributionRunId?: string;
  jobId?: string;
  eventType: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type DistributionRunCreateRequest = {
  workspaceId: string;
  capsuleId: string;
  scheduleMode: ScheduleMode;
  scheduledFor: string;
  platformAccountIds: string[];
  packages: Array<{
    provider: PlatformId;
    platformAccountId: string;
    title: string;
    caption: string;
    hashtags: string[];
    mediaAssetId?: string;
    mediaStoragePath?: string;
  }>;
};

export type DistributionRunCreateResponse = {
  distributionRunId: string;
  jobs: PublishJobDTO[];
};

export type OAuthStartInput = {
  workspaceId: string;
  provider: PlatformId;
  redirectUri: string;
  requestedScopes?: string[];
  profileId?: string;
};

export type OAuthStart = {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
};

export type OAuthCallbackInput = {
  provider: PlatformId;
  code: string;
  state: string;
  redirectUri: string;
};

export type ConnectedAccount = {
  provider: PlatformId;
  providerAccountId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  scopes: string[];
  tokenExpiresAt?: string;
};

export type ValidationResult =
  | { ok: true; warnings?: string[] }
  | { ok: false; category: string; message: string; retryable: false };

export type PublishInput = {
  jobId: string;
  workspaceId: string;
  packageId: string;
  platformAccountId: string;
  provider: PlatformId;
};

export type PublishResult = {
  status: "posted" | "processing";
  platformMediaId?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  providerResponseSummary?: string;
};

export type PublishStatus = {
  status: PublishJobStatus;
  platformPostUrl?: string;
  providerResponseSummary?: string;
};

export type PlatformConnector = {
  provider: PlatformId;
  requiredScopes: string[];
  startOAuth(input: OAuthStartInput): OAuthStart;
  handleOAuthCallback(input: OAuthCallbackInput): Promise<ConnectedAccount>;
  refreshToken(accountId: string): Promise<void>;
  validatePackage(postPackage: PostPackageDTO): Promise<ValidationResult>;
  publish(input: PublishInput): Promise<PublishResult>;
  getStatus?(providerPostId: string): Promise<PublishStatus>;
  revoke(accountId: string): Promise<void>;
};
