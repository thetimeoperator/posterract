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

/** Platforms where one post can go to several accounts at once (e.g. two Instagram accounts). The rest take one. */
export const MULTI_ACCOUNT_PLATFORMS = ["instagram", "facebook", "threads"] as const satisfies readonly PlatformId[];
export const allowsSeveralAccounts = (platform: PlatformId): boolean =>
  (MULTI_ACCOUNT_PLATFORMS as readonly PlatformId[]).includes(platform);
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
  /** The business it was posted from, if any. */
  businessId?: string;
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
  /** Points this post has earned on its platform (Instagram, Facebook and Threads). */
  points?: number;
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

/**
 * A group of connected accounts the user made (a brand, a client), with an
 * optional small round logo. Any accounts can be in it, several on one
 * platform, and one account can be in several businesses. Posting to a
 * business posts to every account in it.
 */
export type BusinessDTO = {
  id: string;
  workspaceId: string;
  name: string;
  logoUrl?: string;
  accountIds: string[];
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

/** One account's stats for a period (the Businesses tab adds these up per business). */
export type AccountAnalyticsDTO = {
  accountId: string;
  provider: AnalyticsPlatformId;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  status: PortalStatus;
  /** Followers now, and the change during the period. */
  audience?: number;
  audienceDelta: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves?: number;
  watchMinutes?: number;
  /** Likes + comments + shares. */
  interactions: number;
  /** interactions ÷ views, when there were views. */
  engagementRate?: number;
  publishedPosts: number;
  /** Epoch ms of its most recent live post (any time). */
  lastPostAt?: number;
  points: number;
  /** Posts that failed or need a reconnect during the period. */
  failedPosts: number;
  daily: Array<{ date: string; views: number }>;
  /** The same stats for the period just before (not for "total"). */
  previous?: { views: number; interactions: number; audienceDelta: number; publishedPosts: number; points: number };
  lastSyncedAt?: number;
};

export type AccountAnalyticsResponseDTO = { rangeDays: AnalyticsRangeDays; accounts: AccountAnalyticsDTO[] };

/** The calendar's numbers for the month or week on screen (local dates, inclusive). */
export type PeriodStatsDTO = {
  from: string;
  to: string;
  timeZone: string;
  views: number;
  previousViews: number;
  dailyViews: Array<{ date: string; views: number }>;
  points: number;
  previousPoints: number;
  streak: { days: number; postedToday: boolean; next?: { days: number; points: number } };
};

export type AnalyticsDashboardDTO = {
  rangeDays: AnalyticsRangeDays;
  platforms: PlatformAnalyticsDTO[];
};

// ---------------------------------------------------------------------------
// Points, levels and ranks. One set of numbers for the scorer (the worker),
// the API and the Points tab, so what a post is said to earn is what it earns.
// Points are decimal: 3,540 views on Instagram are 3.54 points.
// ---------------------------------------------------------------------------

/** The platforms whose posts earn points; the rest earn nothing yet. */
export const POINTS_PLATFORMS = ["instagram", "facebook", "threads"] as const;
export type PointsPlatform = (typeof POINTS_PLATFORMS)[number];

/**
 * How many of a thing make one point, per platform. Threads counts a view
 * each time a post is displayed rather than played, so its views are worth
 * half. Watch time is hours per point.
 */
export const POINTS_RATES: Record<PointsPlatform, {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number | null;
  watchHours: number | null;
}> = {
  instagram: { views: 1_000, likes: 100, comments: 10, shares: 20, saves: 20, watchHours: 1 },
  facebook: { views: 1_000, likes: 100, comments: 10, shares: 20, saves: null, watchHours: 1 },
  threads: { views: 2_000, likes: 100, comments: 10, shares: 20, saves: null, watchHours: null },
};

/** Points for a post going live, per platform. */
export const POINTS_POST_LIVE = 1;

/**
 * Launch day, Sep 24 2026 (UTC). Points count from here: posts published
 * before it earn nothing, and streaks and follower growth start counting from
 * it, so everyone starts at level 1.
 */
export const POINTS_START_AT = Date.UTC(2026, 8, 24);

/**
 * Retention bonus on Instagram and Facebook: the share of the video watched
 * on average. Judged from day 3, for posts with 1,000+ views; the best tier
 * reached is kept, so the bonus is +5 at 50% and +10 in all at 75%.
 */
export const POINTS_RETENTION = {
  minViews: 1_000,
  minAgeHours: 72,
  tiers: [
    { share: 0.5, points: 5 },
    { share: 0.75, points: 10 },
  ],
} as const;

/** Streak milestones, each earned once per streak; a new streak earns them again. */
export const POINTS_STREAK_MILESTONES = [
  { days: 7, points: 10 },
  { days: 30, points: 1_000 },
  { days: 100, points: 5_000 },
  { days: 365, points: 10_000 },
] as const;

/**
 * Follower milestones per connected account: 1 point per 100 followers,
 * paid out as each is crossed. Only growth after the account was connected
 * counts, so an audience someone arrives with earns nothing by itself.
 */
export const POINTS_FOLLOWER_MILESTONES = [
  { followers: 1_000, points: 10 },
  { followers: 5_000, points: 40 },
  { followers: 10_000, points: 50 },
  { followers: 25_000, points: 150 },
  { followers: 50_000, points: 250 },
  { followers: 100_000, points: 500 },
  { followers: 250_000, points: 1_500 },
  { followers: 500_000, points: 2_500 },
  { followers: 1_000_000, points: 5_000 },
] as const;

/**
 * Personal bests per account, for posts with 1,000+ views after at least five
 * earlier posts: beating the account's best views is a record, and 3× its
 * usual views (the median of the 30 days before) is a breakout.
 */
export const POINTS_PERSONAL_BEST = {
  minViews: 1_000,
  minEarlierPosts: 5,
  record: 10,
  breakout: 5,
  breakoutMultiple: 3,
  breakoutWindowDays: 30,
} as const;

/**
 * Total points needed for each level, index 0 being level 1. Each level asks
 * about 13.7% more than the step before it: level 2 is 10 points, level 100
 * is 24.19 million — reached only by a top creator posting daily for years.
 */
export const LEVEL_THRESHOLDS: readonly number[] = [
  0, 10, 21, 34, 49, 66, 85, 105, 130, 160,
  190, 225, 270, 315, 365, 430, 495, 575, 665, 765,
  880, 1_010, 1_160, 1_330, 1_520, 1_740, 1_980, 2_260, 2_590, 2_950,
  3_360, 3_830, 4_370, 4_980, 5_670, 6_460, 7_350, 8_370, 9_520, 10_800,
  12_300, 14_000, 16_000, 18_200, 20_700, 23_500, 26_700, 30_400, 34_600, 39_300,
  44_700, 50_900, 57_800, 65_800, 74_800, 85_100, 96_700, 110_000, 125_000, 142_000,
  162_000, 184_000, 209_000, 238_000, 270_000, 307_000, 349_000, 397_000, 452_000, 514_000,
  584_000, 664_000, 755_000, 859_000, 976_000, 1_110_000, 1_260_000, 1_430_000, 1_630_000, 1_850_000,
  2_110_000, 2_400_000, 2_730_000, 3_100_000, 3_520_000, 4_010_000, 4_560_000, 5_180_000, 5_890_000, 6_700_000,
  7_620_000, 8_660_000, 9_850_000, 11_190_000, 12_730_000, 14_470_000, 16_450_000, 18_710_000, 21_270_000, 24_190_000,
];

export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

/** The level `points` have reached, 1 to 100. */
export function levelFor(points: number): number {
  let level = 1;
  for (let index = 1; index < LEVEL_THRESHOLDS.length; index += 1) {
    if (points >= LEVEL_THRESHOLDS[index]!) level = index + 1;
    else break;
  }
  return level;
}

/** Where `points` stand inside their level: its floor, the next level's floor (null at 100), and the share covered. */
export function levelProgress(points: number): { level: number; floor: number; next: number | null; progress: number } {
  const level = levelFor(points);
  const floor = LEVEL_THRESHOLDS[level - 1]!;
  const next = level < MAX_LEVEL ? LEVEL_THRESHOLDS[level]! : null;
  return { level, floor, next, progress: next === null ? 1 : (points - floor) / (next - floor) };
}

/**
 * Ranks, Call of Duty style: ten tiers of ten levels, each level a title
 * within its tier. Level 1 is Bronze Recruit, level 10 Bronze General, level
 * 11 Silver Recruit, and level 100 Legendary General.
 */
export const RANK_TIERS = [
  { id: "bronze", label: "Bronze" },
  { id: "silver", label: "Silver" },
  { id: "gold", label: "Gold" },
  { id: "platinum", label: "Platinum" },
  { id: "diamond", label: "Diamond" },
  { id: "master", label: "Master" },
  { id: "grandmaster", label: "Grandmaster" },
  { id: "titan", label: "Titan" },
  { id: "mythic", label: "Mythic" },
  { id: "legendary", label: "Legendary" },
] as const;
export type RankTierId = (typeof RANK_TIERS)[number]["id"];

/** The ten titles inside every tier, from its first level to its tenth. */
export const RANK_TITLES = [
  "Recruit",
  "Private",
  "Corporal",
  "Sergeant",
  "Lieutenant",
  "Captain",
  "Major",
  "Colonel",
  "Commander",
  "General",
] as const;

/** A level's rank, e.g. level 26 is Gold Captain. `minRP` is the points the level needs. */
export type Rank = {
  id: string;
  label: string;
  tier: RankTierId;
  tierIndex: number;
  title: (typeof RANK_TITLES)[number];
  titleIndex: number;
  minLevel: number;
  minRP: number;
};

export function rankForLevel(level: number): Rank {
  const clamped = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  const tierIndex = Math.floor((clamped - 1) / RANK_TITLES.length);
  const titleIndex = (clamped - 1) % RANK_TITLES.length;
  const tier = RANK_TIERS[tierIndex]!;
  const title = RANK_TITLES[titleIndex]!;
  return {
    id: `${tier.id}-${title.toLowerCase()}`,
    label: `${tier.label} ${title}`,
    tier: tier.id,
    tierIndex,
    title,
    titleIndex,
    minLevel: clamped,
    minRP: LEVEL_THRESHOLDS[clamped - 1]!,
  };
}

/** The first rank of every tier: the ladder from Bronze Recruit to Legendary Recruit. */
export const RANKS: Rank[] = RANK_TIERS.map((_, index) => rankForLevel(index * RANK_TITLES.length + 1));

export function rankFor(lifetimeRP: number): Rank {
  return rankForLevel(levelFor(lifetimeRP));
}

/** The rank of the next level, or undefined at level 100. */
export function nextRank(lifetimeRP: number): Rank | undefined {
  const level = levelFor(lifetimeRP);
  return level < MAX_LEVEL ? rankForLevel(level + 1) : undefined;
}

export type PointsSource =
  | "post"
  | "views"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "watch"
  | "retention"
  | "record"
  | "breakout"
  | "streak"
  | "followers"
  | "bonus"
  | "milestone";

/** What each kind of points is called on the Points tab. */
export const POINTS_SOURCE_LABELS: Record<PointsSource, string> = {
  post: "Post live",
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  watch: "Watch time",
  retention: "Retention bonus",
  record: "Personal record",
  breakout: "Breakout",
  streak: "Streak",
  followers: "Follower milestone",
  bonus: "Bonus",
  milestone: "Milestone",
};

export const BADGES: Record<string, string> = {
  first_transmission: "First Transmission",
  hexacast: "Hexacast",
  streak_7: "7-Day Streak",
  streak_30: "30-Day Streak",
  streak_100: "100-Day Streak",
  streak_365: "365-Day Streak",
  club_100k: "100k Club",
  record: "Record Breaker",
  breakout: "Breakout",
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

/** One post's points, rule by rule. */
export type PostPointsDTO = {
  projectionId: string;
  provider: PointsPlatform;
  title: string;
  url?: string;
  publishedAt?: number;
  total: number;
  parts: Array<{ source: PointsSource; points: number; value?: number }>;
};

export type FollowerMilestoneDTO = {
  accountId: string;
  provider: PointsPlatform;
  handle: string;
  avatarUrl?: string;
  followers: number;
  /** Followers when the account was connected: growth from here counts. */
  baseline: number;
  next?: { followers: number; points: number };
};

/** Everything the My Points tab shows. */
export type PointsDashboardDTO = {
  totalPoints: number;
  weekPoints: number;
  monthPoints: number;
  level: number;
  levelFloor: number;
  nextLevelAt: number | null;
  rank: { id: string; label: string };
  nextRank?: { id: string; label: string; minLevel: number };
  streak: { current: number; best: number; next?: { days: number; points: number } };
  followers: FollowerMilestoneDTO[];
  topPosts: PostPointsDTO[];
  recent: PointsEntryDTO[];
  badges: string[];
  timeZone?: string;
};

export type LeaderboardPeriod = "week" | "month" | "all";

export type LeaderboardEntryDTO = {
  position: number;
  name: string;
  avatarUrl?: string;
  level: number;
  rank: { id: string; label: string };
  points: number;
  isMe: boolean;
};

/** Everyone on the base plan or above, ranked by points in the period. */
export type LeaderboardDTO = {
  period: LeaderboardPeriod;
  entries: LeaderboardEntryDTO[];
  me?: LeaderboardEntryDTO;
  total: number;
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
  /** how access was granted: a paid subscription, or an AI FOR SAVAGES membership */
  entitledVia?: "subscription" | "aiforsavages";
  plan: {
    id?: "pro" | "allstar" | "superstar";
    unitAmount: number;
    currency: "usd";
    interval: BillingInterval;
  } | null;
  canManageBilling?: boolean;
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
