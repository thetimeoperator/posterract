import type { PlatformId } from "./index";

/**
 * Platform capability registry — drives Composer character counters,
 * pre-flight checks, Portals quirk notes, and connector validation.
 *
 * Values reflect documented platform API constraints as of mid-2026.
 * Connectors may tighten these at publish time (e.g. TikTok exposes
 * per-creator limits via creator_info); these are the static baselines.
 */

export type MediaIngestMode = "pull_url" | "upload" | "both";

export type PlatformCapabilities = {
  id: PlatformId;
  label: string;
  /** Primary accent for chips/faces; Instagram uses a gradient (start color here). */
  accent: string;
  accentSecondary?: string;
  captionMaxChars: number;
  titleMaxChars?: number;
  hashtagsMax?: number;
  video: {
    minDurationS: number;
    maxDurationS: number;
    maxSizeMB: number;
    /** Recommended aspect for short-form on this platform. */
    preferredAspect: "9:16";
    formats: string[];
  };
  mediaMode: MediaIngestMode;
  /** Documented API posting cap, for the rolling-window meter. */
  apiWindowCap?: { posts: number; windowHours: number };
  /** Per-post platform fee in USD cents (X pay-per-use). */
  feeCentsPerPost?: number;
  /** Requirements before posts are publicly visible for arbitrary users. */
  approval: {
    devModeWorks: boolean;
    publicRequires?: string;
  };
  notes: string[];
};

export const PLATFORM_CAPABILITIES: Record<PlatformId, PlatformCapabilities> = {
  instagram: {
    id: "instagram",
    label: "Instagram",
    accent: "#FF0069",
    accentSecondary: "#7638FA",
    captionMaxChars: 2200,
    hashtagsMax: 30,
    video: {
      minDurationS: 3,
      maxDurationS: 900,
      maxSizeMB: 1000,
      preferredAspect: "9:16",
      formats: ["video/mp4", "video/quicktime"],
    },
    mediaMode: "pull_url",
    apiWindowCap: { posts: 100, windowHours: 24 },
    approval: {
      devModeWorks: true,
      publicRequires: "Meta App Review + business verification",
    },
    notes: [
      "Requires an Instagram Professional (Business/Creator) account.",
      "Video is ingested from a public URL; publish is a two-step container flow.",
    ],
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    accent: "#25F4EE",
    accentSecondary: "#FE2C55",
    captionMaxChars: 2200,
    video: {
      minDurationS: 3,
      maxDurationS: 600,
      maxSizeMB: 4096,
      preferredAspect: "9:16",
      formats: ["video/mp4", "video/quicktime", "video/webm"],
    },
    mediaMode: "both",
    apiWindowCap: { posts: 15, windowHours: 24 },
    approval: {
      devModeWorks: true,
      publicRequires: "TikTok Content Posting API audit (2–6 weeks)",
    },
    notes: [
      "Until the app is audited, API posts are forced to SELF_ONLY (private) visibility.",
      "Pull-from-URL requires a verified domain; privacy/duet/stitch controls must be shown in the composer.",
      "Per-creator limits come from creator_info and can be lower than the static cap.",
    ],
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    accent: "#0866FF",
    captionMaxChars: 63206,
    video: {
      minDurationS: 3,
      maxDurationS: 90,
      maxSizeMB: 1000,
      preferredAspect: "9:16",
      formats: ["video/mp4", "video/quicktime"],
    },
    mediaMode: "both",
    approval: {
      devModeWorks: true,
      publicRequires: "Meta App Review",
    },
    notes: [
      "Posts go to Facebook Pages (not personal profiles).",
      "Short-form publishes via the Reels endpoint (3–90s).",
    ],
  },
  threads: {
    id: "threads",
    label: "Threads",
    accent: "#FFFFFF",
    captionMaxChars: 500,
    video: {
      minDurationS: 1,
      maxDurationS: 300,
      maxSizeMB: 1000,
      preferredAspect: "9:16",
      formats: ["video/mp4", "video/quicktime"],
    },
    mediaMode: "pull_url",
    apiWindowCap: { posts: 250, windowHours: 24 },
    approval: {
      devModeWorks: true,
      publicRequires: "Meta App Review",
    },
    notes: ["Video is ingested from a public URL via a container flow, like Instagram."],
  },
  x: {
    id: "x",
    label: "X",
    accent: "#E7E9EA",
    captionMaxChars: 280,
    video: {
      minDurationS: 1,
      maxDurationS: 140,
      maxSizeMB: 512,
      preferredAspect: "9:16",
      formats: ["video/mp4"],
    },
    mediaMode: "upload",
    feeCentsPerPost: 1,
    approval: {
      devModeWorks: true,
      publicRequires: "X API pay-per-use billing enabled",
    },
    notes: [
      "X charges ~$0.01 per post created via API (pay-per-use, since Feb 2026).",
      "Media uploads use the chunked INIT/APPEND/FINALIZE flow.",
    ],
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    accent: "#FF0033",
    captionMaxChars: 5000,
    titleMaxChars: 100,
    video: {
      minDurationS: 1,
      maxDurationS: 180,
      maxSizeMB: 10240,
      preferredAspect: "9:16",
      formats: ["video/mp4", "video/quicktime", "video/webm"],
    },
    mediaMode: "upload",
    apiWindowCap: { posts: 6, windowHours: 24 },
    approval: {
      devModeWorks: true,
      publicRequires: "Google OAuth verification + YouTube API audit",
    },
    notes: [
      "Vertical video ≤ 3 minutes is automatically a Short.",
      "Default API quota (10k units/day) allows ≈6 uploads/day; uploads from unverified API projects are locked private.",
    ],
  },
};

export const PLATFORM_ORDER: PlatformId[] = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "threads",
  "facebook",
];
