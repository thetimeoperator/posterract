/**
 * @posterract/contract — shared types for the web app, Convex backend,
 * connectors, and (later) the CLI/MCP surfaces.
 *
 * Vocabulary:
 *   Transmission — a post: one piece of content + a schedule, fanned out to platforms
 *   Projection   — the per-platform variant of a transmission (caption, status, result)
 *   Artifact     — an uploaded video file
 *   Portal       — a connected social account
 */

export const PLATFORM_IDS = [
  "instagram",
  "tiktok",
  "facebook",
  "threads",
  "x",
  "youtube",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

/** Product availability is deliberately separate from connector presence. */
export const PUBLISHING_PLATFORM_IDS = ["instagram", "tiktok", "facebook", "threads"] as const satisfies readonly PlatformId[];
export const ANALYTICS_PLATFORM_IDS = ["instagram", "tiktok", "facebook", "threads"] as const satisfies readonly PlatformId[];
export const COMING_SOON_PLATFORM_IDS = ["youtube", "x"] as const satisfies readonly PlatformId[];

export type PublishingPlatformId = (typeof PUBLISHING_PLATFORM_IDS)[number];
export type AnalyticsPlatformId = (typeof ANALYTICS_PLATFORM_IDS)[number];

export function isPlatformId(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

/** Master post lifecycle. `partial` = some projections live, some failed. */
export type TransmissionStatus =
  | "draft"
  | "scheduled"
  | "transmitting"
  | "awaiting_user"
  | "live"
  | "partial"
  | "failed"
  | "canceled";

/** Per-platform publish lifecycle. */
export type ProjectionStatus =
  | "pending"
  | "scheduled"
  | "uploading"
  | "publishing"
  | "processing"
  | "awaiting_user"
  | "live"
  | "failed"
  | "retrying"
  | "needs_reauth"
  | "blocked"
  | "canceled";

export type PortalStatus =
  | "connected"
  | "needs_reauth"
  | "pending_approval"
  | "error"
  | "disconnected";

export type ErrorCategory =
  | "auth"
  | "validation"
  | "platform"
  | "rate_limit"
  | "transient"
  | "config";

export type ScheduleMode = "now" | "at" | "next_slot";

// ---------------------------------------------------------------------------
// Core DTOs (client-facing; ids are backend document ids as strings)
// ---------------------------------------------------------------------------

export type ArtifactDTO = {
  id: string;
  workspaceId: string;
  fileName: string;
  r2Key: string;
  /** Publicly resolvable URL (R2 custom domain) used for pull-from-URL platforms. */
  publicUrl?: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  status: "uploading" | "ready" | "failed";
  createdAt: number;
};

export type TransmissionDTO = {
  id: string;
  workspaceId: string;
  title: string;
  baseCaption: string;
  hashtags: string[];
  artifactId?: string;
  status: TransmissionStatus;
  scheduleMode: ScheduleMode;
  /** Epoch ms. Unset for drafts. */
  scheduledFor?: number;
  source: "ui" | "api";
  createdAt: number;
  updatedAt: number;
};

export type ProjectionDTO = {
  id: string;
  transmissionId: string;
  workspaceId: string;
  portalId: string;
  provider: PlatformId;
  caption: string;
  hashtags: string[];
  /** Platform-specific options (privacy level, duet/stitch, madeForKids, ...). */
  platformOptions: Record<string, unknown>;
  status: ProjectionStatus;
  attemptCount: number;
  nextAttemptAt?: number;
  platformMediaId?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  errorCategory?: ErrorCategory;
  errorSummary?: string;
  updatedAt: number;
};

export type PortalDTO = {
  id: string;
  workspaceId: string;
  provider: PlatformId;
  providerAccountId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  scopes: string[];
  status: PortalStatus;
  tokenExpiresAt?: number;
  lastHealthCheckAt?: number;
  /** Posts made through the API in the current rolling window, for cap display. */
  windowUsage?: { used: number; cap: number; windowHours: number };
};

/** A reusable publishing target with at most one connected account per platform. */
export type AccountSetDTO = {
  id: string;
  workspaceId: string;
  name: string;
  accounts: PortalDTO[];
  createdAt: number;
  updatedAt: number;
};

export type EventDTO = {
  id: string;
  workspaceId: string;
  transmissionId?: string;
  projectionId?: string;
  type: string;
  message: string;
  at: number;
};

// ---------------------------------------------------------------------------
// Validation (pre-flight checks)
// ---------------------------------------------------------------------------

export type PreflightCheck = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
};

export type ValidationResult =
  | { ok: true; warnings?: string[] }
  | { ok: false; category: ErrorCategory; message: string; retryable: boolean };

// ---------------------------------------------------------------------------
// OAuth & tokens (connector-facing; never sent to clients)
// ---------------------------------------------------------------------------

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt?: number;
  scopes: string[];
};

export type OAuthStartInput = {
  workspaceId: string;
  redirectUri: string;
  state: string;
  /** PKCE code challenge (S256), for providers that require it (X, TikTok). */
  codeChallenge?: string;
};

export type OAuthStart = {
  authorizationUrl: string;
};

export type OAuthCallbackInput = {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
};

export type ConnectedPortal = {
  provider: PlatformId;
  providerAccountId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  tokens: TokenSet;
};

// ---------------------------------------------------------------------------
// Connector interface — implemented per platform, executed in backend actions.
// Tokens are fetched + decrypted by the caller and passed in explicitly.
// ---------------------------------------------------------------------------

export type ArtifactMeta = {
  publicUrl?: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  /** Reads the artifact bytes as a stream for push-upload platforms. */
  getStream?: () => Promise<ReadableStream<Uint8Array>>;
};

export type ProjectionDraft = {
  caption: string;
  hashtags: string[];
  title?: string;
  platformOptions: Record<string, unknown>;
};

export type PublishInput = {
  projection: ProjectionDraft;
  artifact: ArtifactMeta;
  tokens: TokenSet;
  /** Stable key for idempotent publish attempts. */
  idempotencyKey: string;
  onProgress?: (stage: "uploading" | "publishing" | "processing", detail?: string) => void;
};

export type PublishResult = {
  status: "live" | "processing" | "awaiting_user";
  platformMediaId?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  summary?: string;
};

export type PublishStatusResult = {
  status: "processing" | "awaiting_user" | "live" | "failed";
  platformPostUrl?: string;
  summary?: string;
};

export type ConnectorError = {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
};

export type PlatformConnector = {
  provider: PlatformId;
  requiredScopes: string[];
  buildAuthUrl(input: OAuthStartInput): OAuthStart;
  exchangeCode(input: OAuthCallbackInput): Promise<ConnectedPortal>;
  refreshTokens(tokens: TokenSet): Promise<TokenSet>;
  validate(projection: ProjectionDraft, artifact: ArtifactMeta): ValidationResult;
  publish(input: PublishInput): Promise<PublishResult>;
  /** For platforms with async processing (IG containers, TikTok). */
  checkStatus?(platformMediaId: string, tokens: TokenSet): Promise<PublishStatusResult>;
  revoke?(tokens: TokenSet): Promise<void>;
};

// ---------------------------------------------------------------------------
// Public API (Uplink) request/response shapes
// ---------------------------------------------------------------------------

export type CreateTransmissionRequest = {
  title?: string;
  caption: string;
  hashtags?: string[];
  /** Either an already-uploaded artifact id, or a URL we should ingest. */
  artifactId?: string;
  videoUrl?: string;
  platforms: PlatformId[];
  /** Per-platform caption/option overrides. */
  perPlatform?: Partial<
    Record<PlatformId, { caption?: string; hashtags?: string[]; options?: Record<string, unknown> }>
  >;
  /** ISO-8601 timestamp, or "now". */
  scheduledFor: string;
};

export type CreateTransmissionResponse = {
  transmissionId: string;
  status: TransmissionStatus;
  projections: Array<{ projectionId: string; provider: PlatformId; status: ProjectionStatus }>;
};

// ---------------------------------------------------------------------------
// Retry policy (shared by engine + tests)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Resonance — the points system. RP is earned when projections go live, and
// (later) from platform-verified views/engagement deltas. One append-only
// ledger; rank is a pure function of lifetime RP.
// ---------------------------------------------------------------------------

export const RP_PER_LIVE_PROJECTION = 10;
/** Bonus when all six platforms are live on one transmission. */
export const RP_HEXACAST_BONUS = 30;
export const RP_STREAK_PER_DAY = 5;
export const RP_STREAK_DAILY_CAP = 50;
/** Max RP earnable per day from posting (post + streak + bonus). */
export const RP_POSTING_DAILY_CAP = 200;
export const RP_PER_100_VIEWS = 1;
export const RP_PER_10_LIKES = 1;
export const RP_PER_COMMENT = 2;
/** Echo points only track posts younger than this. */
export const METRICS_WINDOW_DAYS = 14;

// ---------------------------------------------------------------------------
// Echoes — normalized cross-platform analytics. Providers expose different
// metric vocabularies; the UI consumes this shared shape without pretending
// that every signal is available on every network.
// ---------------------------------------------------------------------------

/** A fixed reporting window, or every metric currently available for the account. */
export type AnalyticsRangeDays = "total" | 7 | 30 | 90;

export type AnalyticsDailyPointDTO = {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reach?: number;
  saves?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  clicks?: number;
  watchMinutes?: number;
  audienceGained: number;
  audienceLost: number;
};

export type AnalyticsPostDTO = {
  projectionId: string;
  transmissionId: string;
  provider: PlatformId;
  title: string;
  publishedAt?: number;
  platformPostUrl?: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reach?: number;
  saves?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  clicks?: number;
  replays?: number;
  watchMinutes?: number;
  averageWatchSeconds?: number;
  skipRate?: number;
  durationSeconds?: number;
};

export type AnalyticsPeriodSummaryDTO = {
  /** Point-in-time audience recorded at the end of the comparison period. */
  audience?: number;
  audienceDelta: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  reach?: number;
  saves?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  clicks?: number;
  watchMinutes?: number;
  publishedPosts: number;
};

export type PlatformAnalyticsDTO = {
  provider: PlatformId;
  connected: boolean;
  ready: boolean;
  missingScopes: string[];
  handle?: string;
  audienceLabel: "Subscribers" | "Followers";
  audience?: number;
  audienceDelta: number;
  following?: number;
  totalLikes?: number;
  publishedVideos?: number;
  reach?: number;
  saves?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  clicks?: number;
  replays?: number;
  profileViews?: number;
  accountsEngaged?: number;
  totalInteractions?: number;
  averageWatchSeconds?: number;
  skipRate?: number;
  /** Facebook Page-level views returned by the Page Insights API. */
  pageViews?: number;
  /** Total views on Facebook posts published through Posterract. */
  postViews?: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchMinutes?: number;
  publishedPosts: number;
  lastSyncedAt?: number;
  /** Signals available through the provider's approved analytics integration. */
  availableMetrics: string[];
  /** Honest provider-specific limitations and connection guidance. */
  metricNotes: string[];
  daily: AnalyticsDailyPointDTO[];
  posts: AnalyticsPostDTO[];
  /** Same-length period immediately preceding the selected range. */
  previousPeriod?: AnalyticsPeriodSummaryDTO;
};

export type AnalyticsDashboardDTO = {
  rangeDays: AnalyticsRangeDays;
  platforms: PlatformAnalyticsDTO[];
};

export type Rank = { id: string; label: string; minRP: number };

export const RANKS: Rank[] = [
  { id: "drifter", label: "Drifter", minRP: 0 },
  { id: "signalman", label: "Signalman", minRP: 500 },
  { id: "navigator", label: "Navigator", minRP: 2_500 },
  { id: "voyager", label: "Voyager", minRP: 10_000 },
  { id: "luminary", label: "Luminary", minRP: 40_000 },
  { id: "ascendant", label: "Ascendant", minRP: 150_000 },
  { id: "architect", label: "Architect", minRP: 500_000 },
];

export function rankFor(lifetimeRP: number): Rank {
  let current = RANKS[0];
  for (const rank of RANKS) if (lifetimeRP >= rank.minRP) current = rank;
  return current;
}

/** The rank above the current one, or undefined at the top. */
export function nextRank(lifetimeRP: number): Rank | undefined {
  return RANKS.find((r) => r.minRP > lifetimeRP);
}

export type PointsSource = "post" | "bonus" | "streak" | "milestone" | "views" | "likes" | "comments";

export const BADGES: Record<string, string> = {
  first_transmission: "First Transmission",
  hexacast: "Hexacast",
  streak_7: "7-Day Streak",
  streak_30: "30-Day Streak",
  streak_100: "100-Day Streak",
};

export type PointsEntryDTO = {
  id: string;
  source: PointsSource;
  amount: number;
  note?: string;
  at: number;
};

export type PointsSummaryDTO = {
  lifetimeRP: number;
  weekRP: number;
  streakDays: number;
  badges: string[];
  recent: PointsEntryDTO[];
};

// ---------------------------------------------------------------------------
// Billing — public catalog and workspace subscription state. Stripe customer,
// subscription, and invoice identifiers intentionally stay server-side.
// ---------------------------------------------------------------------------

export type BillingInterval = "month" | "year";

export type BillingPlanDTO = {
  priceId: string;
  amount: number;
  currency: "usd";
  interval: BillingInterval;
};

/** One purchasable tier, as the API advertises it. */
export type BillingCreditPlanDTO = {
  /** Stripe price for the monthly interval. */
  priceId: string;
  /** Stripe price for the yearly interval, when the tier is sold that way. */
  yearlyPriceId?: string;
  /** Monthly amount in cents, as Stripe holds it. */
  amount: number;
  /**
   * Yearly amount in cents, read from Stripe rather than derived. Absent when the
   * catalog could not be read: a client must not present a yearly price it had to
   * guess, since the guess is not what the card is charged.
   */
  yearlyAmount?: number;
  currency: "usd";
  interval: "month";
  /** Generation allowance per month. Zero means the tier includes no generation. */
  credits: number;
};

export type BillingConfigDTO = {
  configured: boolean;
  publishableKey?: string;
  productId?: string;
  plans?: {
    monthly: BillingPlanDTO;
    yearly: BillingPlanDTO;
  };
  /**
   * The purchasable tiers, keyed by plan id (`pro`, `allstar`, `superstar`).
   * `plans` above describes the base subscription, which is the Pro tier.
   */
  creditPlans?: Record<string, BillingCreditPlanDTO>;
};

export type BillingSubscriptionDTO = {
  status: string;
  accessState: "active" | "inactive";
  entitled: boolean;
  plan: {
    unitAmount: number;
    currency: "usd";
    interval: BillingInterval;
  } | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  trialEnd?: number;
  cancelAt?: number;
  canceledAt?: number;
  lastPaymentStatus?: string;
  lastPaymentAt?: number;
  updatedAt?: number;
};

export type BillingCheckoutDTO = {
  sessionId: string;
  url: string;
  status?: string;
  expiresAt?: number;
  replayed?: boolean;
};

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

export const RETRY_BASE_DELAY_MS = 30_000;
export const RETRY_MAX_DELAY_MS = 60 * 60_000;
export const RETRY_MAX_ATTEMPTS = 5;

export function retryDelayMs(attempt: number): number {
  const delay = RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, RETRY_MAX_DELAY_MS);
}

export * from "./capabilities";
