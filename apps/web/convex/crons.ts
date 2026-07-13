import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Safety net: re-dispatch any due post whose run was lost (deploy mid-publish,
// crash, etc.). The exact-time scheduler is the primary mechanism.
crons.interval("sweep stalled posts", { minutes: 2 }, internal.publish.sweep, {});

// Long-lived platform tokens (Instagram: 60 days) — extend before they expire.
crons.interval("refresh platform tokens", { hours: 24 }, internal.oauth.refreshExpiringTokens, {});

// Social analytics refreshes: YouTube provides historical reports; TikTok
// provides cumulative counters that we normalize into observed daily deltas.
crons.interval("refresh YouTube analytics", { hours: 6 }, internal.youtubeAnalytics.refreshRecent, {});
crons.interval("refresh TikTok analytics", { hours: 6 }, internal.tiktokAnalytics.refreshRecent, {});

// Resonance: roll weekly RP every Monday just after the UTC week boundary.
crons.weekly("reset weekly points", { dayOfWeek: "monday", hourUTC: 0, minuteUTC: 5 }, internal.points.resetWeekly, {});

export default crons;
