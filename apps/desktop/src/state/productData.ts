import { sampleOutputUrl } from "../lib/sampleOutput";
import { addMinutesIso, nowIso } from "../lib/timing";
import type { ContentCapsule, PlatformAccount, PublishJob } from "./types";

export const platformAccounts: PlatformAccount[] = [
  {
    id: "tiktok",
    platform: "TikTok",
    handle: "@vidtryx.lab",
    connected: true,
    color: "#7cf7ff",
    requirements: "Direct Post ready",
  },
  {
    id: "instagram",
    platform: "Instagram",
    handle: "@vidtryx.lab",
    connected: true,
    color: "#ff72d2",
    requirements: "Publishing allowed",
  },
  {
    id: "youtube-shorts",
    platform: "YouTube Shorts",
    handle: "Vidtryx Lab",
    connected: true,
    color: "#ff5f5f",
    requirements: "Upload scope ready",
  },
  {
    id: "x",
    platform: "X",
    handle: "@vidtryxlab",
    connected: true,
    color: "#f1f6ff",
    requirements: "Post access ready",
  },
  {
    id: "threads",
    platform: "Threads",
    handle: "Connect account",
    connected: false,
    color: "#d8dcff",
    requirements: "Needs connection",
  },
  {
    id: "facebook",
    platform: "Facebook",
    handle: "Connect page",
    connected: false,
    color: "#82a9ff",
    requirements: "Needs page access",
  },
  {
    id: "linkedin",
    platform: "LinkedIn",
    handle: "Connect profile",
    connected: false,
    color: "#77c9ff",
    requirements: "Needs connection",
  },
];

export const capsules: ContentCapsule[] = [
  {
    id: "capsule_ai_creator_shift",
    title: "AI Tools Are Rewiring Creator Workflows",
    modeId: "news-character",
    status: "ready",
    summary: "A fast character-led take on how creators are moving from editing timelines to directing AI systems.",
    duration: "0:42",
    aspect: "9:16",
    outputUrl: sampleOutputUrl,
    thumbnailTone: "#65ff9a",
    caption:
      "The creator workflow is changing fast: less manual editing, more directing systems that can write, render, and assemble.",
    hashtags: ["#AIvideo", "#CreatorTools", "#Vidtryx"],
    createdAt: nowIso(),
  },
  {
    id: "capsule_product_drop",
    title: "Launch Console Product Tease",
    modeId: "product-demo",
    status: "draft",
    summary: "A product-demo capsule waiting for final render output from the future Product Demo mode.",
    duration: "0:31",
    aspect: "9:16",
    thumbnailTone: "#66d7ff",
    caption: "A compact product teaser built for quick cross-platform launch day posting.",
    hashtags: ["#ProductLaunch", "#VideoAutomation"],
    createdAt: addMinutesIso(-55),
  },
  {
    id: "capsule_faceless_market",
    title: "Market Shift Faceless Reel",
    modeId: "faceless-reel",
    status: "scheduled",
    summary: "A faceless explainer capsule with caption variants already packaged for two platforms.",
    duration: "0:28",
    aspect: "9:16",
    thumbnailTone: "#b875ff",
    caption: "A tight faceless breakdown for people who want the signal without the production drag.",
    hashtags: ["#Shorts", "#CreatorEconomy"],
    createdAt: addMinutesIso(-110),
  },
];

export const publishJobs: PublishJob[] = [
  {
    id: "job_seed_tiktok",
    capsuleId: "capsule_faceless_market",
    platformId: "tiktok",
    packageId: "package_seed_tiktok",
    status: "scheduled",
    scheduledFor: addMinutesIso(145),
    createdAt: addMinutesIso(-20),
    label: "Market Shift Faceless Reel -> TikTok",
  },
  {
    id: "job_seed_youtube",
    capsuleId: "capsule_faceless_market",
    platformId: "youtube-shorts",
    packageId: "package_seed_youtube",
    status: "scheduled",
    scheduledFor: addMinutesIso(205),
    createdAt: addMinutesIso(-20),
    label: "Market Shift Faceless Reel -> YouTube Shorts",
  },
];
