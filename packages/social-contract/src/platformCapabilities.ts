import type { PlatformId, ProviderApprovalStatus } from "./index";

export type PlatformCapability = {
  provider: PlatformId;
  label: string;
  requiredScopes: string[];
  approvalStatus: ProviderApprovalStatus;
  mediaMode: "direct_upload" | "pull_from_url" | "mixed";
  notes: string[];
};

export const PLATFORM_CAPABILITIES: PlatformCapability[] = [
  {
    provider: "youtube-shorts",
    label: "YouTube Shorts",
    requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"],
    approvalStatus: "dev_only",
    mediaMode: "direct_upload",
    notes: ["Uses YouTube Data API videos.insert. Unverified apps can be constrained by Google review state."],
  },
  {
    provider: "x",
    label: "X",
    requiredScopes: ["tweet.write", "tweet.read", "users.read", "media.write", "offline.access"],
    approvalStatus: "dev_only",
    mediaMode: "direct_upload",
    notes: ["Uploads media first, then creates the post with the returned media id."],
  },
  {
    provider: "tiktok",
    label: "TikTok",
    requiredScopes: ["video.publish"],
    approvalStatus: "pending_review",
    mediaMode: "mixed",
    notes: ["Direct Post requires TikTok Content Posting API approval and explicit creator consent."],
  },
  {
    provider: "instagram",
    label: "Instagram",
    requiredScopes: ["instagram_content_publish"],
    approvalStatus: "pending_review",
    mediaMode: "pull_from_url",
    notes: ["Requires Meta app review and current professional account/page requirements to be verified."],
  },
  {
    provider: "facebook",
    label: "Facebook",
    requiredScopes: ["pages_manage_posts", "pages_read_engagement"],
    approvalStatus: "pending_review",
    mediaMode: "mixed",
    notes: ["Requires Meta app review and page permissions."],
  },
  {
    provider: "linkedin",
    label: "LinkedIn",
    requiredScopes: ["w_member_social"],
    approvalStatus: "dev_only",
    mediaMode: "direct_upload",
    notes: ["Uses LinkedIn upload registration plus post creation with versioned API headers."],
  },
  {
    provider: "threads",
    label: "Threads",
    requiredScopes: [],
    approvalStatus: "pending_review",
    mediaMode: "pull_from_url",
    notes: ["Add after Meta auth and publishing are already stable."],
  },
];
