# Posterract — Gamification Plan (“Resonance”)

*Turn posting into a game: creators earn points for transmitting and for the
views/engagement their posts pull back. Points charge the device, raise your
rank, and place you on a leaderboard. Themed into the existing world — the
reactor **charges**, analytics are **Echoes**, so points are **Resonance**.*

---

## 1. Core question answered: does it cost to check views per video?

To award points for views we must read each posted video’s view count from the
platform. Researched (June 2026) — **five of six platforms are free; only X
charges, and trivially.**

| Platform | How we read our own post’s views | Cost | Notes |
|---|---|---|---|
| **YouTube** | `videos.list?part=statistics` → `viewCount` | **Free** | 1 quota unit/call, **up to 50 video IDs per call**, 10k units/day. Effectively unlimited for us. Cache 1–6h. |
| **TikTok** | **Display API** `/v2/video/query/` → `view_count` | **Free** | Display API = your own authorized account (the Research API is academics-only). Rate-limited; stats can lag a few hours. |
| **Instagram** | Graph API media insights (`plays`/`views`, `reach`) | **Free** | Within Meta rate limits. Needs `instagram_manage_insights` + Professional account. |
| **Facebook** | Graph API video insights | **Free** | Pages, within rate limits. |
| **Threads** | `/threads/{id}/insights` → `views` | **Free** | Needs `threads_manage_insights`. |
| **X** | `GET /2/tweets` → `public_metrics.view_count` | **~$0.005 per read** | Pay-per-use since Feb 2026. **24-hour dedup** — you can’t be billed more than once/day for the same post. |

**Verdict:** the “points for views” mechanic is essentially **free**. The only
cost is X, and it’s ~half a cent per post per day *at most* (dedup caps it). We
control even that with polling rules (below). Reading views does **not** require
anything beyond the same OAuth connection we already need to *post* — the
insights scopes get bundled into each platform’s connect flow.

**X cost control (built into the design):**
- Only poll a post while it’s “young” (views plateau) — e.g. first 14 days, then stop.
- One check per post per day maximum — matches the daily points cron (X’s 24h dedup makes this free-safe anyway).
- Worst case: a power user with 100 live X posts in their 14-day window = ≤ $0.50/day for X view-tracking. Make X view-points opt-in per workspace if we ever want it strictly $0.

---

## 2. The currency: Resonance (RP)

One append-only points currency, **Resonance**. It visibly **charges the
device’s reactor** on the dashboard and fills toward your next **Rank**.

### Earning — Transmission points (posting)
Awarded when a **projection goes live** (not merely scheduled — real signal only):

| Action | RP |
|---|---|
| A projection goes live | **+10** per platform |
| Full 6-platform transmission (all live) | **+30** bonus (rewards the core “one post, six worlds” behavior) |
| Daily streak (consecutive days with ≥1 live post) | **+5 × streak day**, capped at +50/day |
| First-ever post, first automation used, etc. | one-time **milestone** bonuses |

Anti-spam: posting RP is capped per day (e.g. 200 RP/day from posting) and only
counts posts that actually reach `live`. Failed/blocked projections earn nothing.

### Earning — Echo points (views & engagement)
Awarded incrementally as platform-verified counts come back (delta since last
check), so numbers can only be earned by *real* reach — hard to fake:

| Signal | RP |
|---|---|
| Views | **+1 per 100 views** (delta) |
| Likes | **+1 per 10 likes** (delta) |
| Comments/replies | **+2 each** (delta) |

Diminishing returns curve per post (e.g. RP from a single post’s views soft-caps
so one viral hit doesn’t trivialize ranks; big hits still feel great via badges).

### Milestones & badges (one-time)
`First Transmission` · `Hexacast` (all 6 platforms in one post) · `First 1K
views` · `10K / 100K / 1M views` · `7/30/100-day streak` · `Automation Architect`
(N posts via a flow). Each grants a badge + RP bonus + a Signal toast.

---

## 3. Ranks (levels)

Total lifetime RP → a rank. Themed as ascent through the void. Shown as a ring
that charges around your avatar and the device.

| Rank | Lifetime RP | Vibe |
|---|---|---|
| Drifter | 0 | just arrived |
| Signalman | 500 | posting regularly |
| Navigator | 2,500 | multi-platform habit |
| Voyager | 10,000 | consistent reach |
| Luminary | 40,000 | real audience |
| Ascendant | 150,000 | power user |
| **Architect** | 500,000+ | legendary — the device is fully lit |

Rank is a pure function of lifetime RP (never decreases). The **weekly
leaderboard** uses *this-week RP* so newcomers can compete.

---

## 4. Leaderboard

- **Global, opt-in** (workspaces are single-user today; a public handle opts you in).
- Two boards: **This week** (weekly RP, resets Monday) and **All-time** (lifetime RP).
- Privacy-first: opt-in only; display name = chosen handle, never email.
- Later: friends/leagues, per-niche boards.

---

## 5. Technical design (backend-agnostic — works on Convex managed, Convex self-hosted, or a VPS)

The whole system is: **write points to an append-only ledger, aggregate into
per-user stats, and run a cron that reads platform insights and awards view
points.** It reuses two patterns we already have — the publish engine (hook the
`live` transition) and the scheduler/cron (the metrics poller).

### New data tables
- **`points_ledger`** (append-only, auditable): `{ workspaceId, userId, source: "post"|"views"|"likes"|"comments"|"streak"|"milestone", amount, refId (projectionId/transmissionId), note, at }`.
- **`user_stats`** (aggregate, one row/workspace): `{ workspaceId, lifetimeRP, weekRP, weekStartAt, rank, streakDays, lastPostDay, badges[], perPlatformRP }`.
- **`metric_snapshots`** (delta tracking): `{ projectionId, provider, views, likes, comments, fetchedAt }` — latest counted values so we award only the *increase*.

### Awarding posting points
Hook the publish engine: when a projection flips to **`live`**, insert a
`points_ledger` row (+10, +bonuses) and update `user_stats`. Idempotent by
`refId` so a retry/re-run never double-awards. (Works today on the simulated
connector; becomes real reach the moment real connectors land.)

### The metrics cron (view/engagement points)
A scheduled job **once daily** (founder decision; can stretch to every 2 days — views are awarded as deltas, so cadence only affects how often points land, never how many):
1. Select live projections younger than the tracking window (e.g. ≤14 days), per platform.
2. Call that platform’s insights endpoint (§1) with the user’s token — **batch** where possible (YouTube: 50 IDs/call).
3. Write a `metric_snapshots` row; compute `delta = new − lastCounted`.
4. Convert delta → RP (§2 curve), insert `points_ledger` rows, update `user_stats`, recompute rank.
5. Emit a Signal on notable jumps (“+120 Resonance — Reel crossed 10K views”).

X gets the young-posts-only + once/day rule to keep its per-read cost negligible.

### Ranks & leaderboard
Pure functions over `user_stats`; leaderboard = indexed query on `weekRP` /
`lifetimeRP`. Weekly reset is a cron that rolls `weekRP`→0 and stamps `weekStartAt`.

### Anti-abuse (built in)
- View/engagement RP comes only from **platform-verified** counts, not self-report.
- **Delta-based** awarding + `metric_snapshots` = no double counting.
- Per-post soft cap + per-day posting-RP cap.
- Idempotent ledger keyed by `refId`.
- Leaderboard opt-in; abusive handles removable.

---

## 6. UI surfaces (all in the existing black/neon-green world)

- **Dashboard device HUD:** the reactor’s **Charge** meter = progress to next rank; RP total + rank chip. The device visibly “levels up” at rank-ups (a bloom pulse).
- **New “Ascension” page** (sidebar, near Analytics): rank ladder, your badges, the leaderboard, streak flame.
- **Profile/Settings:** RP, rank, badges, public-handle opt-in toggle.
- **Post detail:** “Earned so far: +40 posting · +212 from 21.2K views.”
- **Signals/toasts:** real-time RP gains and milestone unlocks.

---

## 7. Phasing

- **P1 — Points that work today (no API cost, no connectors needed):** ledger + `user_stats` tables, posting points hooked to the `live` transition, ranks, streaks, Dashboard charge meter + Ascension page. Fully functional immediately on the current (simulated) publish engine; becomes real reach automatically when connectors land.
- **P2 — View/engagement points:** the metrics cron + `metric_snapshots`, insight scopes added to each connector’s OAuth, delta→RP awarding, X polling rules. Ships alongside / just after the real platform connectors.
- **P3 — Social layer:** global leaderboard, badges gallery, weekly leagues, device level-up animations, share-your-rank cards.

---

## 8. Dependencies & sequencing note

- **P1 needs nothing new** — it can be built now on top of the current backend.
- **P2 rides on the real connectors** (Phase 5/6): the same OAuth that lets us *post* is extended with the read-insights scopes, and the metrics cron reuses the connector interface. So view-points naturally land as each platform goes live.
- Backend choice (Convex managed vs Convex self-hosted vs VPS) does **not** affect this design — ledger + cron are identical everywhere.

### Meta permissions (locked in at app registration)
The Meta developer apps request the insights scopes **up front** so gamification needs no re-consent: `instagram_manage_insights`, `pages_read_engagement` + `read_insights` (FB), `threads_manage_insights`. YouTube/TikTok analytics ride on the same OAuth used for posting.

*Sources for §1: X API pay-per-use pricing (docs.x.com), TikTok Display API
overview (developers.tiktok.com), YouTube Data API 2026 quota guides. Reading
own-post view counts is free on YouTube/TikTok/Instagram/Facebook/Threads and
~$0.005/read (deduped daily) on X.*
