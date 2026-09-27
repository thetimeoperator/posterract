# Posterract: businesses, the points HUD, recipes and systems — build plan

Status: Part A (businesses) and the header rank chip were built on Sep 26 2026. The calendar stat tiles in Part B were dropped: the founder said not to overcrowd the calendar, and asked only for a small points badge on each tile. Part C (recipes and systems) comes next, after businesses.

Every "today" fact below was verified this session, either in the code (four read-only studies, with file and line references) or in production data. New work covers Instagram, Facebook and Threads.

---

## 0. The asks, and the answer in one line each

| # | What the founder asked | The answer |
|---|---|---|
| 1 | "Businesses" replace "account sets". Show analytics overall or filtered by business, and organize the backend. | A business owns a group of connected accounts. Every read in the API takes one **scope**: everything, one business, or chosen accounts. |
| 1b | Filter by individual accounts too: with two Instagram accounts, see both together or just one. | This is the same scope: pick accounts inside a business or across all of them. |
| 2 | Recipes (UGC videos, Split-screen videos). A system for a whole page (an agents.md plus a knowledge graph). Turn Create into a system page. | Create becomes a page per business with three parts. **System**: instructions, identity, formats, characters, knowledge. **Recipes**. **Videos**. A new video is either Freeform or a Recipe. |
| 3 | Points and level in the top-right of every tab. On the calendar, key stats (views plus points for the month, or the week in week view), or something better. | A rank chip in the shared header. Four tiles on the calendar: **Views, Points, Posts, Streak**. |

---

## 1. What exists today

### 1.1 Accounts and account sets

- **`social_accounts`** is defined in `deploy/posterract/postgres/init/001-posterract.sql:21-37`, `002:34-44` and `010:6-15`.
  - A workspace can connect many accounts per platform, capped at 10 per platform (`apps/api/src/oauth.js:457-477`).
  - Signup writes six disconnected placeholder rows per workspace (`apps/api/src/auth.js:159-168`).
  - Disconnecting is a soft status change. The account's analytics snapshots are deleted (`oauth.js:625-646`).
- **`account_sets` and `account_set_members`** are defined in `010:17-43`.
  - Names are unique per workspace. A set holds 1–6 accounts, one per platform.
  - One account can sit in several sets.
- **The set API** is `apps/api/src/accountSets.js`: GET/POST/PUT/DELETE `/v1/account-sets`, registered at `server.js:1535`.
  - `POST /v1/posts` resolves `accountSetId` at `server.js:1886-1903`.
  - The post does not remember its set. The set ID survives only in `events.payload` (`:2017`) and audit metadata (`:2064`).
  - The UI composers always send `accountIds`, never a set (`WebComposer.tsx:202-215`, `compose.tsx:194-207`).
- **UI**:
  - The Social accounts page: `apps/web/src/routes/_app/portals.tsx` (sets panel `151-172`, dialog `56-100`, connections `177-201`).
  - The composer strip: `components/composer/WebAccountStrip.tsx:30-39,93`.
  - The desktop composer: `routes/_app/compose.tsx:386-408`.
  - The API Keys example: `routes/_app/uplink.tsx:35,200`.
- **The Muse connector**: `apps/api/src/mcp/tools/accounts.js` (`list_accounts` returns `account_sets`), `tools/posting.js` (`account_set_id`), `instructions.js:9` and `context.js:39-42`.
- **Workspaces**: one per user in practice (`server.js:353-371`). There is no switcher, no invites and no server-side rename.
- **Production (Sep 25)**:
  - There are **0 account sets** across 644 workspaces.
  - Only 4 workspaces have connected accounts, with 1, 4, 5 and 15 accounts.
  - So removing sets needs no data migration and no API aliases.

### 1.2 Analytics and points data

- **Per-post totals**: each sync appends lifetime totals per platform post to `publication_metric_snapshots` (`001:154-171`). That table has no account column; the account is reached through `projections.social_account_id`.
- **Per-account snapshots**: `account_metric_snapshots` (`001:173-184`).
- **Daily gains**: `daily_metric_snapshots` stores per-account, per-UTC-day gains, unique on `(social_account_id, metric_date)` (`001:186-202`).
  - It is written by `applyCumulativeAnalytics` in `apps/orchestrator/src/worker.js:542-691`.
  - The date is the **UTC date of the sync** (`:514-515`), not the day the views happened.
- **What gets tracked**: only posts published through Posterract, for 90 days (`worker.js:531-538`). Syncs run every 12 hours (`workflows.js:58`), plus after each publish.
- **`GET /v1/analytics?rangeDays=7|30|90|total`** is served from `server.js:1548-1563` and `apps/api/src/analytics.js:165-388`. It has no account, business, date or time-zone parameter.
- **A bug today**: `analytics.js:228-230` builds `new Map(rows.map(a => [a.provider, a]))` from an unordered query with no status filter.
  - Each platform ends up represented by **one arbitrary account**, which can be a disconnected placeholder.
  - Followers and daily charts are wrong for any workspace with two or more rows on a platform, while the post list sums every account.
- **Points**: `points_ledger` rows carry `social_account_id` for post rules and follower milestones. Streak rows carry no account (`points.js:533-556`).
  - `loadTotals` (`points.js:677-687`) returns the total, this week and this month, using UTC boundaries.
  - `/v1/bootstrap` returns the same total as `points.lifetimeRP` on every page load (`loadPointsSummary`, `points.js:714-732`).
- **Time zones**: the workspace time zone lives in `workspaces.time_zone` (`022:56-57`) and is used only for streak days. The calendar uses the browser's local time.

### 1.3 Shell, calendar and points UI

- **Header**: there is one fixed, shared header, `apps/web/src/shell/AppHeader.tsx`.
  - The right cluster (`45-62`) holds ⌘K, the bell and the account menu.
  - The middle of the header is empty at every width.
  - Navigation is the bottom dock at all widths (`shell/BottomDock.tsx`).
- **`components/PointsChip.tsx`** is a per-post "+N pts" pill, not a user total.
- **Level and rank data**:
  - `usePoints()` (`engine/postgres.ts:138`) exposes the bootstrap points summary, but no routed page uses it.
  - The contract helpers `levelProgress`, `rankForLevel` and `rankFor` (`packages/contract/src/index.ts:575-663`) turn a total into a level and rank. The API uses the same helpers.
- **`components/points/RankEmblem.tsx:168-287`** is SVG and renders at any size.
- **Calendar**: `routes/_app/continuum.tsx`.
  - The hero is at `251-278`. Its right side is empty, about 700 px at a 1440 px window.
  - The toolbar is at `280-308`: Week/Month, previous and next, and "N posts this month".
  - The view and date live in local state (`117-118`). Month is the default.
- **Desktop Create tab**: the editor iframe covers the web header (`create.tsx:108-296`). The editor's own header (`apps/editor-sandbox/src/app.tsx:15-53`) shows Projects | Exports and Back to Posterract at its top-right.

### 1.4 Editor, projects and skills

- **The Create page**:
  - On the web it is a download page (`create.tsx:60-101`).
  - On desktop it is the full-screen editor with its Projects and Exports dashboard (`editor-sandbox/src/components/dashboard/projects-view.tsx`, `exports-view.tsx`).
- **A new project** is always one empty 1080×1920 scene: `projects-view.tsx:223-245` calls `scaffold()` in `apps/desktop/src/projects.ts:625-661`, which uses the starter in `packages/video-compiler/src/starter.ts`.
  - A leftover "templates" view type has no UI (`dashboard/types.ts:5-15`).
- **Project storage**: projects sit flat in `~/Movies/Posterract Projects` (`projects.ts:180`).
  - The managed `AGENTS.md`, `CLAUDE.md` and Cursor/Codex files are rewritten on every open (`projects.ts:334,339,587-606`).
- **Skills** are folders: a `SKILL.md` plus an optional `posterract.json` (cover, format, duration, tags, requires, starter, recipes). They are read from three places (`apps/desktop/src/skills.ts:75-85,200-205,238-255`):
  - the project's `skills/` folder
  - `~/Posterract/Skills`
  - the bundled `apps/desktop/skills/*`, which are six stubs
- **Skills on scenes**:
  - A scene can carry `skill="…"`, and the agent is told the skill's path (`editor-sandbox/src/context/agent-api/context.ts:96-101,285-299`).
  - The Skill Deck picker exists, but only works on scenes that already exist.
  - The spec is `docs/editor-ui-and-skills-plan.md`.
- **Desktop channels**: the web app can already call `projects:list`, `projects:create`, `skills:list` and the rest through `window.desktop.request` (`apps/desktop/src/channels.ts:50-82`, `preload.ts:42-47`).
- **AI generation** uses the user's own keys (`apps/desktop/src/ai-local.ts`):
  - Gemini for images, text prompts only (`307-337`).
  - MiniMax-H3 for video, 4–15 s. The provider path accepts a first frame (`365-369`).
  - Fish for voice.
  - An OpenAI-compatible endpoint for transcription with word timings (`476-561`).
- **AI generation gaps**:
  - Reference images and start frames declared in code are dropped (`editor-sandbox/src/engine/local-genai.ts:125`).
  - The agent's video tool has no first-frame input (`packages/posterract-cli/src/mcp.ts:694-730`).
  - There is no talking-character provider.
- **The founder's manual system** lives in `posterract-marketing/` (untracked) and is the model for Systems.
  - Each brand has IDENTITY, STORYTELLING, FORMATS, PRODUCTION, VIDEO-RULES, POST-TEMPLATE and a schedule.
  - Its `learnings/` folder states "every file is a node, every `[[name]]` is an edge".
  - `marketing-system-template/` is a clean copy. `shared/templates/ugc-character/` is a UGC character template.
- **The founder's working recipe skills** live outside the repo:
  - **Split-screen** is `trending-news-character-skill`:
    - a HeyGen talking character in the bottom 1080×960
    - HyperFrames animations in the top 1080×960, within a 960×890 safe zone
    - a lower-third title under the face
    - 3-word JetBrains Mono captions above the divider
    - a ticker glued to the bottom of the top half
    - a 1.5× speed pass
  - **UGC** is `AI FOR SAVAGES/UGC-skill`. From an avatar photo plus an optional product photo, it makes 2×5 s blocks: a reference-consistent image, then image-to-video, then a burned caption, then a stitch.
  - Neither one builds a Posterract composition.

---

## Part A — Businesses (BUILT Sep 26 2026; the founder's corrected rules)

The first draft of this part got businesses wrong: one business per account, a default "My business", and one account per platform per post. The founder rejected all of it. What was built:

- **A business is a group, a data bucket that the user creates.** No workspace starts with one. It has a name and an optional small round logo.
- **Membership is open.** Any connected accounts can go in, including several on one platform, and one account can be in several businesses.
- **Posting to a business posts to every connected account in it,** including two Instagram accounts at once. A disconnected member is skipped.
  - Instagram, Facebook and Threads take several accounts per post.
  - Other platforms take one.
  - The shared list is `MULTI_ACCOUNT_PLATFORMS` in `packages/contract`.
- **A post remembers the business it was posted from** (`transmissions.business_id`).
  - The calendar tile shows that business's logo beside the title.
  - The tile's bottom-right shows a small points badge: trophy plus number, on published posts, 0 until the first stats arrive.
  - The tile stays the same size, with no stat tiles and no calendar filter.
- **Analytics** covers every account, one business, or picked accounts.
  - This is `?business=` and `?accounts=` on `/v1/analytics`, driven by the Business and Accounts menus on the page.
  - Every account on a platform is added up. This fixes the old bug where one arbitrary account stood in for the platform.
- **Header rank chip** on every tab except Points.

Where it lives:

| Piece | Where |
|---|---|
| Database | `024-businesses.sql`: `businesses` (with logo bytes and hash), `business_accounts`, `transmissions.business_id`; one platform post per account instead of per platform; account sets dropped (0 rows) |
| API | `apps/api/src/businesses/` (routes, store, logo, scope), `postTargets.js` (`resolvePostTargets`), `analytics.js` (`combineAccounts`, `combineDaily`, account filter) |
| Logos | `GET /v1/business-logos/:hash`, public, by content hash |
| App | Social accounts page (`portals.tsx`), composers (`WebComposer`, `WebAccountStrip`, `compose.tsx`, `AccountTargets`), calendar (`continuum.tsx`), Analytics (`components/analytics/ScopeFilters.tsx`), header (`components/points/RankChip.tsx`) |
| Muse | `list_accounts` returns businesses; `create_post` takes `business_id`; `get_analytics` takes `business_id` / `account_ids` |
| Tests | `apps/api/test/businesses.test.js`, `apps/web/tests/e2e/businesses.spec.ts` |

## Part B — Points in the header, stats on the calendar

### B1. The rank chip

- **What it looks like:**
  - `[emblem 24 px] GOLD SERGEANT · LVL 24`, with a 2 px line under the text showing progress to the next level.
  - The border is tinted with the tier colour (reuse `TIER_MATERIALS` and the `tierStyle` pattern from `points.tsx:785-792`).
  - It uses the header buttons' black glass (`.app-header-action`) at the same 36 px height.
- **New component:** `apps/web/src/components/points/RankChip.tsx`.
- **Hover card**, opening downward:
  - total points and points to the next level
  - this week's points
  - the current streak
  - Don't use `Hint`: it opens upward and would clip in the header.
  - **Clicking** the chip goes to `/points`.
- **Data:**
  - It uses `usePoints().lifetimeRP` → `levelProgress()` and `rankForLevel()` from the contract. There is no new request.
  - The total reloads with bootstrap, on focus and after every change.
  - It is the same sum the Points tab shows (`loadTotals`).
- **Placement:**
  - It is the first item of the header's right cluster (`AppHeader.tsx:45`) and needs `pointer-events-auto`.
  - From 640 px up it shows the full chip. Below 640 px it shows the emblem and level number only, about 64 px.
- **Where it shows:**
  - Every signed-in tab.
  - **Hidden on `/points`**, whose header already shows the same chip (`points.tsx:83-91`).
  - On desktop's Create tab the editor covers the web header, so the **editor's own header** gets a static version, placed left of Projects | Exports.
    - The host posts `{type: "posterract-points", total}` into the iframe on load and whenever the total changes.
    - This part ships with the next desktop build.
- **Level-up:** when the level rises between loads, the chip glows once for 600 ms. The "You made Silver!" notification already exists.

### B2. Calendar stats

**The tiles.** The ask was views plus points; I recommend four tiles (decision D7):

| Tile | Shows |
|---|---|
| **Views** | Views gained in the period, the change vs the previous period, and small daily bars |
| **Points** | Points earned in the period, the change, and "660 to Level 25" |
| **Posts** | "12 posted · 8 scheduled" in the period |
| **Streak** | "9-day streak", plus "Post today to keep it" (or "Posted today ✓") |

The calendar is where you plan. Views and points say how the period went, posts say how much you shipped, and the streak turns the calendar into the game's daily loop.

**Which period:**

- The tiles follow the calendar exactly.
  - Month view is that calendar month.
  - Week view is that Monday–Sunday week, in the browser's time zone.
- Going back to August shows August.
- A future period shows "—" for views and points, and counts scheduled posts.

**Which accounts:** everything, or the calendar's business (D4).

**Layout:**

- On wide screens the tiles sit on the right side of the hero (`continuum.tsx:251-278`) as a 2×2 grid of tiles about 200×88 each, aligned to the hero's bottom.
- Below 1024 px they become a row between the hero and the toolbar.
- Extract one shared `components/stats/StatTile.tsx`, based on `SmallReadout` (`echoes.tsx:961-968`) and `Stat` (`uplink.tsx:224-232`).

**Clicks:**

- Views → Analytics for that period and scope.
- Points and Streak → the Points tab.

**Data:** a new endpoint, `GET /v1/stats/period?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=…&business=…&accounts=…` (`analytics:read`), returns:

```ts
type PeriodStatsDTO = {
  from: string; to: string; tz: string;
  views: number; previousViews: number; dailyViews: { date: string; views: number }[];
  points: number; previousPoints: number;
  streak: { days: number; postedToday: boolean; nextBonusAt?: number };
};
```

- **Views** = the sum of `daily_metric_snapshots.views` for the scope's accounts, with `metric_date` between from and to.
- **Points** = the sum of `points_ledger.amount` with `awarded_at` in [from 00:00 tz, to+1 00:00 tz), for the scope's accounts. Streak bonuses count only in the overall view.
- **Posts** are counted in the browser from what the calendar already loads.
- **Caching:** the engine caches results per scope and period, and refetches on focus.

**Honest labels:**

- The Views tooltip says "Views on posts published with Posterract, counted each time Posterract checks (twice a day)."
- Points started Sep 24 2026, so earlier periods show 0 with that note.
- With no accounts connected, the Views tile reads "Connect an account".

### B3. Tests

- **API:** period stats for a month, a week, a business and a single account. Points bucketed in a non-UTC time zone. Streak bonuses excluded from business totals.
- **Browser:** the chip appears on every tab except Points, and its level matches the Points tab. The tiles follow Week/Month and previous/next. A future month shows "—".
- **Before calling it done:** check the numbers against production for the founder's workspace.

---

## Part C — Recipes and systems (Create becomes the system page)

### C1. The model

```
Business (e.g. Pissed Off Sofia)
 ├─ System    what to make and how: AGENTS.md, Identity, Formats (recipes + cadence), Rules, Characters, Knowledge
 ├─ Recipes   the video formats it uses (UGC video, Split-screen video, …)
 ├─ Videos    the projects and exports made for it
 └─ Accounts  where they get posted (Part A)
```

**The loop:**

1. The System says what's due today.
2. A Recipe makes the video.
3. It gets posted to the business's accounts.
4. Analytics come back.
5. The results become Knowledge.
6. The System makes the next video better.

This is the founder's `posterract-marketing/` system, turned into a product.

### C2. Recipes

**What a recipe is.** A recipe is a skill folder in the format the app already reads: `SKILL.md` plus `posterract.json` (`apps/desktop/src/skills.ts`; spec in `docs/editor-ui-and-skills-plan.md` §1.1). It adds:

```jsonc
{
  "kind": "recipe",
  "title": "Split-screen video",
  "format": "9:16",
  "duration": [20, 60],
  "starter": "starter/index.tsx",          // a real Posterract composition with named slots
  "inputs": [                               // what the New video form asks
    { "id": "topic", "label": "Topic or script", "type": "text" },
    { "id": "character", "label": "Character", "type": "character" },
    { "id": "title", "label": "Title on screen", "type": "text", "optional": true }
  ],
  "requires": ["heygen", "transcribe"],     // your own keys; the card shows which are missing
  "cover": "assets/cover.png"
}
```

`SKILL.md` holds the agent's step-by-step workflow and rules.

**Where recipes come from:**

- bundled with the app (the first two)
- your library, `~/Posterract/Skills`
- a business's System (C5, synced from the cloud)
- a project's `skills/` folder

**Making a video from a recipe.** `projects:create` gets a new option, `{recipe, businessId, inputs}`, in `apps/desktop/src/projects.ts`. It:

- copies the starter into `src/index.tsx` and sets `<scene skill="split-screen">`
- writes `recipe.json` (recipe, version, inputs), and `businessId` into `posterract.json`
- creates the project under `<projects root>/<Business>/`. Existing projects stay where they are.
- adds a "This video" section to the managed `AGENTS.md`: business, recipe, inputs, and "Read ../System/AGENTS.md first".

**Who runs it.** The user's agent does the creative work. The app supplies the template, the tools, the keys and the checks. This is the product's thesis.

- A **Make with agent** button hands the agent a starting prompt, e.g. "Make this Split-screen video for Pissed Off Sofia about <topic>".
- The agent receives `recipe` and `business` in `posterract_get_context`, plus one line in the MCP instructions.

### C3. The first two recipes

**1. UGC video** (from `UGC-skill` and Pissed Off Sofia's `VIDEO-RULES.md`)

- **Output:** 1080×1920, 10–20 s. That's 2–3 shots of the same person, 5–7 s each (your rule), with a caption on each shot, an optional voiceover, and a hook in the first 1.5 s.
- **Inputs:**
  - topic or script (or "let the agent write it")
  - a character from the business's Characters, or your own clip
  - a product photo (optional)
  - caption style
  - voice (optional)
- **Starter:** a `<sequence>` of shot slots, each a `<video>` with a caption zone. The caption style is an `@inspect` variable, so `posterract batch` can make variants.
- **Per shot:**
  1. A reference-consistent image: Gemini, using the character's approved images as references.
  2. Image to video: MiniMax-H3 with a first frame.
  3. Captions: timed from the script, or from a transcript if voiced.
  4. Stitch in the composition.
- **Keys:** Gemini and MiniMax, plus Fish if voiced.

**2. Split-screen video** (from `trending-news-character-skill`)

- **Output:** 1080×1920.
  - **Bottom half, 1080×960:** the talking character, fitted without stretching.
  - **Top half, 1080×960:** animations inside the 960×890 safe zone (x 60–1020, y 35–925).
  - A lower-third title under the face, 3-word captions just above the divider, and a story ticker glued to the bottom of the top half.
  - An optional 1.5× speed pass, using the clip speed control that already exists.
- **Inputs:** topic or script, character, animation style, title.
- **Starter:** a `TopHalf` region (scenes, diagrams, Lottie) and a `BottomHalf` region (the character video), with slots for captions, title and ticker.
- **Pipeline:**
  1. The approved script.
  2. The talking-character clip: HeyGen with the user's key (D5), or your own recording.
  3. A transcript with word timings, using your own transcription key.
  4. The agent builds 3–4 top-half beats timed to the transcript, **in Posterract** (this replaces HyperFrames).
  5. Captions, then speed, then export.
- **Keys:** HeyGen (or none if you record yourself), plus transcription.

### C4. Engine gaps the recipes need (desktop build)

1. **Reference images:**
   - Send reference images to Gemini (`ai-local.ts:307-337`).
   - Resolve code-declared references in `local-genai.ts`.
   - Read Gemini's image-input docs first. Never test with the founder's keys.
2. **Start frame:**
   - Stop dropping `startFrame` (`local-genai.ts:125`).
   - Add a first-frame input to the agent's video tool (`packages/posterract-cli/src/mcp.ts:694-730`).
3. **Talking character** (if D5 is yes): add a HeyGen provider to `ai-local.ts` and the Keys card, built from HeyGen's public docs.
4. **Clip length:** MiniMax makes 4–15 s clips. Recipes trim to 5–7 s in the composition, so no provider change is needed.
5. **New project from a recipe:** in `projects.ts` and the new Create page (C7).
6. **Provenance:**
   - Record recipe, business and character on every export. That includes agent and CLI exports, which the library doesn't record today.
   - Record them on the uploaded media asset: a new migration alongside `012-provenance.sql`.
   - This is what makes "which recipe performs best" answerable.
7. **Stale docs:**
   - The skill references say transcription costs credits (`posterract-skill/references/workflow.md:15`, `mcp.md:42-44`), and the MCP generation tools still describe credits. Both are wrong: it's the user's own keys.
   - The docs call a root `index.tsx` canonical, but the scaffold writes `src/index.tsx`.

### C5. Systems

Each business has one System. It is a set of files, like `posterract-marketing/`:

| File | What it holds | Who writes it |
|---|---|---|
| `AGENTS.md` | The system file: what this business makes, the order to work in, links to everything below | The set-up form, then you or the agent |
| `IDENTITY.md` | Who it is: audience, voice, do's and don'ts, look (colours, fonts), character canon | You or the agent |
| `FORMATS.md` | Which recipes on which platforms, and the cadence ("UGC video · daily 9:00 · Instagram + Threads") | You or the agent |
| `RULES.md` | Dated decisions (G-001 …) | The agent, after asking |
| `characters/<name>/` | `CHARACTER.md` (persona, voice ID, avatar ID) plus approved reference images | You |
| `knowledge/` | The graph (C6) | Posterract (automatic) and the agent |

**Storage is in the cloud** (D6), so the web app, the desktop agent and Muse all read the same system.

- **`025-business-systems.sql`** adds:
  - `business_files (id, business_id, path, body, revision, updated_at, updated_by_kind user|agent|posterract, updated_by)`
  - `business_file_revisions`
  - `business_assets (business_id, path, media_asset_id)`: character images, kept out of the 24-hour unattached-media purge
  - Size limits: 200 KB per file, 500 files per business.
- **API:**

  | Route | What it does |
  |---|---|
  | `GET /v1/businesses/:id/system` | The system's file tree |
  | `GET /v1/businesses/:id/system/files/*path` | Read one file |
  | `PUT /v1/businesses/:id/system/files/*path` with `revision` | Write one file; 409 if someone changed it first |
  | `POST …/knowledge` | Add a learning |
  | `GET …/knowledge/graph` | The graph's nodes and edges |
  | `GET …/knowledge/search?q=` | Search the knowledge |
- **Desktop mirror:**
  - On sign-in and whenever the system changes, Desktop writes it to `<projects root>/<Business>/System/` as managed, read-only files. They carry a marker line, like the project `AGENTS.md`.
  - Local agents read these files natively.
  - Writes go through the CLI or MCP (`posterract system write | learn`), which call the API and then refresh the mirror. There is **no two-way file sync**.
- **Agent wiring:**
  - The project's `AGENTS.md` says "This video belongs to <Business>. Read ../System/AGENTS.md before anything else."
  - `posterract_get_context` returns `business {id, name, systemPath}` and `recipe`.
  - The MCP instructions gain one line.
- **Muse:**
  - New connector tools: `get_system(business)`, `get_recipe(name)`, `add_learning(business, …)`, `search_knowledge(business, query)`.
  - Muse makes videos in its own cloud following the same system, then uploads them with the upload tools that already exist.
- **Set-up:** a **"Set up this business's system"** form writes a starter system from templates, with no AI needed. The agent refines it later. The five questions:
  1. What is it?
  2. Who is it for?
  3. What's its voice?
  4. Which recipes, and how often?
  5. Which characters?

### C6. The knowledge graph

- **Format:** Markdown notes with a frontmatter `type:` and `[[links]]`. Every note is a node and every link is an edge, which is `posterract-marketing`'s own convention.
- **Node types:** post, format, character, technique (what works), failure (what didn't, and the fix), topic, weekly.
- **Written by Posterract automatically:** on the server, after each analytics sync. This is deterministic, with no AI.
  - `knowledge/posts/<date>-<slug>.md`, one per published post: platforms, views, engagement, points, recipe, character, the hook (first caption line), and links such as `[[format:ugc-video]] [[character:sofia]]`.
  - `knowledge/weekly/<year>-W<nn>.md`: best posts, averages by recipe and by hook length, best posting hours.
- **Written by the agent:** technique and failure notes, through `add_learning`. Each must cite the post notes it comes from.
- **Read by the agent** before making a video: `AGENTS.md` links the index, and the agent can run `search_knowledge`.
- **UI:** System → Knowledge shows a list and a graph view (nodes coloured by type; click one to open the note), with counts such as "24 notes · 3 new this week".
- **The chain that makes it work:** project (recipe, business, character) → export → media asset → post → platform post → metrics. Most links already exist; C4.6 adds the rest.

### C7. The new Create page (the system page)

- **The web app owns the page** on both web and desktop. The editor iframe opens only when you open a video.
  - Desktop's `projects:list` and `projects:create` channels are already callable from the web app.
  - The editor's own dashboard (`projects-view.tsx`, `exports-view.tsx`) stays reachable from inside the editor as "All projects", but is no longer where you land.
- **Layout:**
  - **Top:** a business switcher (chips with colour dots) and **New business**.
  - **Left column, the System:**
    - identity summary
    - formats with their cadence
    - characters
    - Knowledge (a count, plus Open graph)
    - Edit system
  - **Main area:**
    - **Today:** formats due from the cadence, e.g. "UGC video · 9:00 · not made yet — Make it".
    - **New video:** Freeform · UGC video · Split-screen video · your library's recipes, as cards in the Skill Deck style.
    - **Videos:** this business's projects and exports. Post and Schedule open the composer with this business preselected.
- **On the web (no editor):** System, Knowledge, Recipes and uploaded videos are all viewable and editable. **New video** reads "Opens in Posterract Desktop".
- **Projects without a business** appear under "No business", with a "Move to business" action.
- **Labels:** the dock still says **Create**. Inside, the tabs are **System · Videos**.

### C8. Cadence on the calendar (later)

- The cadence in `FORMATS.md` appears on the calendar as planned slots: ghost cards such as "UGC video · Pissed Off Sofia · 9:00".
- A slot fills when a post lands in it. The Streak tile reads these slots.
- **Make today's videos** hands the agent the slots that are due.

### C9. Seeding from `posterract-marketing`

- Import Posterract Main and Pissed Off Sofia as the first two businesses' systems.
- This is a read-only copy; the marketing folder is not touched.
- It tests the feature on real material from day one.

---

## 5. Build order

| Phase | What | Where it ships | Size |
|---|---|---|---|
| 0 | Analytics fix: sum every account on a platform; make the queries scope-ready | API (VPS) | S |
| 1 | Rank chip in the header; calendar tiles plus `/v1/stats/period` | Web and API (VPS). The editor-header chip ships with the next desktop build | S–M |
| 2 | Businesses: migration 024, API, Social accounts page, composer, analytics filters (business and accounts), calendar business filter, connector | API and web (VPS) | M–L |
| 3 | Recipes v1: the New video chooser, the recipe format, UGC and Split-screen recipes, generation fixes, provenance | Desktop build, plus web | L |
| 4 | Systems v1: cloud system files, the set-up form, the new Create page, the desktop mirror, agent and Muse wiring, seeding (C9) | API, web and desktop build | L |
| 5 | Knowledge graph: automatic post and weekly notes, the learnings tool, the graph view | API and web | M |
| 6 | Cadence on the calendar; Make today's videos | Web and desktop | M |

- **When a phase is done:** it must be visible and correct in the running product, checked against production data for the founder's workspace.
- **Phases 1–2** reach desktop users with the next desktop build, because installed apps bundle their own copy of the web UI.
- **Before replacing any app bundle,** say whether it is a dev copy or the signed app.

## 6. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Can one account belong to two businesses? | **No.** One business per account keeps totals adding up |
| D2 | Should every workspace start with a business? | **Yes, "My business".** Filters appear only once there are 2+ businesses or 2+ accounts |
| D3 | A business with two Instagram accounts: one per post, or both at once? | **One per post for now.** Both at once changes publishing, the calendar and analytics |
| D4 | Business filter on the calendar too? | **Yes.** It's small, and the tiles follow it |
| D5 | Talking character for Split-screen | **HeyGen with the user's own key** (what your skill uses), plus "use my own recording" |
| D6 | Where do systems live? | **In the cloud**, mirrored to Desktop, so web, local agents and Muse share one |
| D7 | Calendar tiles | **Views, Points, Posts, Streak** |

## 7. Risks and limits

- **Views per period:**
  - They count only posts published through Posterract, within 90 days.
  - They are counted when Posterract checks (twice a day), bucketed by UTC date.
  - A day at a month's edge can land in the neighbouring month. The labels say so.
  - Writing `metric_date` in the workspace's time zone would be a later change.
- **Streak bonuses** belong to no account, so business totals leave them out.
- **Disconnecting an account** deletes its snapshots (today's behaviour). Its analytics history disappears from every view.
- **Installed desktop apps:**
  - Keep `accountSets: []` and `rangeDays` working until the next desktop release is the minimum.
  - Recipes and systems need a desktop build.
- **Recipe costs:** recipes rely on the user's own provider keys, so the user pays the providers.
- **Provider integrations** are built from public docs only, never tested with the founder's keys.

## 8. Files by phase

- **Phase 0:**
  - `apps/api/src/analytics.js` → `apps/api/src/analytics/dashboard.js`
  - `apps/api/test/analytics*.test.js`
- **Phase 1:**
  - `apps/web/src/shell/AppHeader.tsx`
  - new `apps/web/src/components/points/RankChip.tsx`
  - new `apps/web/src/components/stats/StatTile.tsx`
  - `apps/web/src/routes/_app/continuum.tsx`
  - new `apps/api/src/analytics/period.js` and its route in `server.js`
  - `packages/contract` (`PeriodStatsDTO`)
  - `apps/web/src/engine/postgres.ts`
  - `apps/editor-sandbox/src/app.tsx` (editor-header chip)
- **Phase 2:**
  - `deploy/posterract/postgres/init/024-businesses.sql`
  - new `apps/api/src/businesses/*`
  - `apps/api/src/server.js`, `domain.js`, `oauth.js`, `auth.js`, `meta.js`
  - `apps/hub/src/provisioning.js`
  - `apps/api/src/mcp/tools/{accounts,posting,analytics}.js`, `instructions.js`, `context.js`
  - `packages/contract`
  - web: `portals.tsx`, `WebAccountStrip.tsx`, `WebComposer.tsx`, `compose.tsx`, `echoes.tsx`, `continuum.tsx`, `uplink.tsx`
  - engine: `postgres.ts`, `store.ts`, `local.ts`, `cloud.ts`, `useEngine.ts`
  - tests and docs as listed in A7–A8
- **Phase 3:**
  - `apps/desktop/src/{projects,skills,ai-local,exports-library}.ts`
  - `apps/desktop/skills/{ugc-video,split-screen}/`
  - `apps/editor-sandbox/src/engine/local-genai.ts`
  - `packages/posterract-cli/src/mcp.ts`
  - `apps/web/src/routes/_app/create.tsx`
  - a provenance migration
  - `posterract-skill/references/*`
- **Phase 4:**
  - `025-business-systems.sql`
  - new `apps/api/src/systems/*`
  - the web Create page (new `components/create/*`)
  - desktop mirror (`apps/desktop/src/system-mirror.ts`)
  - CLI and MCP `system` commands
  - connector tools
- **Phase 5:**
  - `apps/api/src/systems/knowledge.js` (automatic notes, called after each analytics sync from `apps/orchestrator/src/worker.js`)
  - the graph view in the web app
- **Phase 6:**
  - `continuum.tsx` (planned slots)
  - the Create page's Today section
  - an agent hand-off
