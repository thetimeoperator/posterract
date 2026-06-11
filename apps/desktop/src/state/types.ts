export type VidtryxPhase =
  | "idle"
  | "selecting"
  | "armed"
  | "input"
  | "running"
  | "complete"
  | "failed";

export type ProductSurface = "home" | "create" | "post" | "capsule-detail" | "schedule";

export type ModeId =
  | "news-character"
  | "ugc-ad"
  | "product-demo"
  | "faceless-reel"
  | "clip-repurposer";

export type RunStageId =
  | "script"
  | "visual-plan"
  | "avatar"
  | "hyperframes"
  | "assembly"
  | "export";

export type RunStage = {
  id: RunStageId;
  label: string;
  durationMs: number;
};

export type RunMode = "fake";

export type VidtryxMode = {
  id: ModeId;
  name: string;
  shortName: string;
  color: string;
  description: string;
  enabled: boolean;
  runMode: RunMode;
  fakeStages: RunStage[];
};

export type ArtifactType = "script" | "preview" | "video";

export type AssetDTO = {
  id: string;
  type: ArtifactType;
  label: string;
  url?: string;
  createdAt: string;
};

export type RunArtifact = AssetDTO;

export type AttachedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
};

export type RunEvent =
  | { type: "run.started"; runId: string; modeId: string }
  | {
      type: "stage.started";
      runId: string;
      stageId: string;
      label: string;
      index: number;
    }
  | {
      type: "stage.progress";
      runId: string;
      stageId: string;
      progress: number;
    }
  | {
      type: "artifact.created";
      runId: string;
      artifactType: ArtifactType;
      label: string;
      url?: string;
    }
  | { type: "stage.completed"; runId: string; stageId: string }
  | { type: "run.completed"; runId: string; outputUrl?: string }
  | { type: "run.failed"; runId: string; message: string };

export type RunEventEnvelope = {
  runId: string;
  runMode: RunMode;
  sequence: number;
  emittedAt: string;
  payload: RunEvent;
};

export type RunModeHandle = {
  id: string;
  runMode: RunMode;
  cancel: () => void;
};

export type RunLogEntry = {
  id: string;
  label: string;
  status: "queued" | "active" | "complete" | "failed";
  progress: number;
};

export type CapsuleStatus = "draft" | "ready" | "scheduled" | "posting" | "posted" | "failed";

export type ContentCapsuleDTO = {
  id: string;
  backendId?: string;
  title: string;
  modeId: ModeId;
  status: CapsuleStatus;
  summary: string;
  duration: string;
  aspect: "9:16" | "1:1" | "16:9";
  outputUrl?: string;
  primaryAssetId?: string;
  mediaStoragePath?: string;
  thumbnailTone: string;
  caption: string;
  hashtags: string[];
  createdAt: string;
};

export type ContentCapsule = ContentCapsuleDTO;

export type PlatformId =
  | "tiktok"
  | "instagram"
  | "youtube-shorts"
  | "x"
  | "threads"
  | "facebook"
  | "linkedin";

export type PlatformConnectionStatus =
  | "connected"
  | "needs_connection"
  | "needs_reauth"
  | "pending_approval"
  | "unavailable";

export type ProviderApprovalStatus = "ready" | "pending_review" | "dev_only" | "blocked";

export type PlatformAccount = {
  id: PlatformId;
  accountId?: string;
  platform: string;
  handle: string;
  connected: boolean;
  connectionStatus?: PlatformConnectionStatus;
  approvalStatus?: ProviderApprovalStatus;
  scopes?: string[];
  tokenExpiresAt?: string;
  lastHealthCheckAt?: string;
  color: string;
  requirements: string;
};

export type PostPackage = {
  id: string;
  capsuleId: string;
  platformId: PlatformId;
  title: string;
  caption: string;
  hashtags: string[];
  mediaUrl?: string;
};

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
  | "blocked_by_platform"
  | "posting"
  | "needs-connection";

export type PublishJobDTO = {
  id: string;
  capsuleId: string;
  platformId: PlatformId;
  packageId: string;
  status: PublishJobStatus;
  scheduledFor: string;
  createdAt: string;
  label: string;
  platformPostUrl?: string;
  error?: string;
};

export type PublishJob = PublishJobDTO;

export type DistributionRun = {
  id: string;
  capsuleId: string;
  jobIds: string[];
  createdAt: string;
  status: "scheduled" | "posting" | "posted" | "failed";
};

export type ScheduleMode = "now" | "later";
