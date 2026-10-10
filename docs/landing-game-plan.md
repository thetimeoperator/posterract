# Landing page: the game for content

Status: plan, Sep 28 2026. Nothing is built yet. The live page is untouched.

## Why it changes

The founder's brief: reframe the landing as **the game for content** ("fantasy content"), sell the game more than the agent editor, make it much lighter and much more personal, strip the effects, and keep only the lever that switches the neon-green theme and the cyan-blue theme.

What the live page costs today (measured on www.posterract.app, Sep 28, first load, browser Performance API):

| | Today |
|---|---|
| Transferred | **12.6 MB** in 78 requests |
| Hero clips (8 MP4s in the scroll stack) | 11.7 MB, 93% of the page |
| JavaScript | 44 files, 267 KB compressed (737 KB raw) |
| Stylesheets | 2 files, 69 KB compressed (345 KB raw); 4,789 lines are a generated full copy of the landing CSS in cyan |
| Fonts | 3 files, 111 KB (Switzer, JetBrains Mono, Geist) |
| Platform logos | 5 PNGs, 264 KB (the Instagram logo alone is 174 KB) |
| Always running | 1 WebGL shader, plus stars, grid, aurora and vignette layers on a parallax scroll listener |

Two structural causes besides the clips:

- The landing is rendered by the app shell (`routes/_app.tsx`), which imports the whole app statically. A signed-out visitor downloads the app's engine, database client, IndexedDB layer, backdrop, dock and navigator, and framer-motion (about 52 KB compressed) with them. The dock, navigator, signals panel and backdrop all import framer-motion, so the landing cannot shed it on its own.
- The cyan theme is a second copy of every landing rule (`scripts/cyan-theme.mjs` → `landing-cyan.css`).

## The idea

Fantasy football turns real players' stats into points. Posterract turns your real posts' numbers into points. You post on Instagram, Facebook and Threads; views, likes, comments, shares, saves, watch time, streaks, records and follower milestones score; you climb 100 ranks from Bronze Recruit to Legendary General on one board with everyone else. Everyone started at zero on Sep 24, 2026.

The editor, the scheduler and your agent stop being the headline. They become your loadout: how you play.

Everything the page says about the game comes from the rules the scorer runs on (`packages/contract`: `POINTS_RATES`, `POINTS_STREAK_MILESTONES`, `POINTS_FOLLOWER_MILESTONES`, `POINTS_PERSONAL_BEST`, `LEVEL_THRESHOLDS`, `RANK_TIERS`, `RANK_TITLES`), and the emblems are the Points tab's own SVG `RankEmblem`. The page cannot promise points the scorer does not pay.

Personal, two ways: the page is the founder's (their voice, their real post scored, their row on the board, signed), and it is about the visitor (their projected rank on their own card).

## Inspiration

| Reference | What it lends |
|---|---|
| [Sleeper](https://sleeper.com/) | Its homepage is a live scoreboard of player stat lines ("5/7 REC, 59 REC YD, 1 REC TD"). The hero's stat line. |
| [PrizePicks](https://www.prizepicks.com/) | Real stat lines straight under the hero, before any explanation. |
| [Fantasy Premier League scoring](https://www.premierleague.com/en/news/2174909) | The rules printed as a plain Action / Points table. The rulebook section. |
| [TrustMRR](https://trustmrr.com/) | A leaderboard of real numbers with one sentence on where they come from and how often they refresh ("Data is updated hourly"). The board and its source line. |
| [HN Leaders](https://news.ycombinator.com/leaders), [Advent of Code](https://adventofcode.com/) | A bare numbered board; a text-only game site. How light the board can be. |
| [Duolingo leagues](https://blog.duolingo.com/duolingo-leagues-leaderboards/) | A named ladder, one fixed colour per tier. The ranks section (without the leagues). |
| [Basecamp](https://basecamp.com/), [levels.io](https://levels.io/) | A founder's letter on the landing, signed; a solo founder's own numbers. The personal layer. |
| [Pinboard](https://pinboard.in/) | One-line positioning and the price on the homepage, no tricks. Paid-only, said plainly. |
| [512KB Club](https://512kb.club/) | Page-weight budgets. Ours: under 300 KB. |

Precedents for fantasy scoring of real creators: Fantasy Top scored crypto influencers on their X engagement and shut at the end of June 2026 ([Decrypt](https://decrypt.co/368640/ethereum-crypto-influencer-game-fantasy-top-shutting-down)); Klout, BitClout and friend.tech died too. They scored people who never opted in, added money speculation, or hid the formula. Posterract does none of that: you score only your own posts, the whole rulebook is printed, there is nothing to bet. Avoid the fantasy apps' bonus-cash hero offers entirely.

## The page, top to bottom

Green by default; the lever turns the whole page cyan. All copy below is a draft for approval.

| # | Section | What it is |
|---|---|---|
| — | **Nav** | Unchanged: POSTERRACT left; Sign in and Sign up right (to `/gate`); nothing in the middle. |
| 1 | **Hero** | The lever above the H1, exactly as today. H1 *The game for content.* Mono kicker *FANTASY CONTENT // YOUR POSTS SCORE REAL POINTS*. Three lines in the founder's voice. One button, *Start playing*, opening the sign-up. Beside it (below it on phones): **the stat line**, the founder's best-scoring real post since Sep 24, printed like a receipt: each number next to the points it earned, the total, and the founder's rank emblem. Text only; the post links out to Instagram, Facebook or Threads. |
| 2 | **The rulebook** | The whole scoring table, FPL-style: actions down, Instagram / Facebook / Threads across (post live +1; views 1 per 1,000, Threads 1 per 2,000; likes 1 per 100; comments 1 per 10; shares 1 per 20; saves 1 per 20 on Instagram; watch time 1 per hour; retention +5 at 50%, +10 at 75%). The bonuses: record +10, breakout +5, streaks (7 days +10, 30 days +1,000, 100 days +5,000, 365 days +10,000), followers (1k to 1M). One source line: every point comes from the platforms' own numbers, checked twice a day. |
| 3 | **Your rank** | The visitor's projection: a typical post's views, likes and comments, and posts a week, in; points per post and per week, and **their card** (the real emblem) after 30 days and after a year, out. Same maths as the scorer, labelled as an estimate. Under it, the ladder: the ten tiers with the points each needs (Bronze 0 · Silver 190 · Gold 880 · Platinum 3,360 · Diamond 12,300 · Master 44,700 · Grandmaster 162,000 · Titan 584,000 · Mythic 2.11M · Legendary 7.62M; Level 100 is 24.19M) and the ten titles, Recruit to General. |
| 4 | **The board** | One board, a bare numbered table: #, emblem, player, level, points. Only the founder is named (pinned, labelled Founder); every other player shows as their rank, and their names never leave the API. Under it, the founder's signed note. |
| 5 | **Enter the game** | The one plan, read live from billing as today ($20 a month; yearly saves $40). The four approved feature lines become the loadout. *Your AI. Your API keys.* One button, *Start playing*. Paid only: no trial wording anywhere. |
| — | **Footer** | Unchanged. |

Only Instagram, Facebook and Threads appear anywhere on the page.

## Kept and stripped

**Kept:** the lever (same look, labels, position and throw), the two palettes (`#65ff9a`, `#5fdcff`), the nav, Sign in / Sign up to `/gate`, the sign-up dialog behind the main button, live pricing, the footer.

**Stripped:** the eight clips and the scroll stack; the tilted editor card and the 420vh sticky stage; the WebGL world (shader, stars, grid parallax, aurora, vignette); the self-typing terminal and the eight-logo network row; the letter-swap nav hover; the 3D and shiny buttons (flat buttons in the lever's material instead); entrance fades; the animated price counter; the generated cyan stylesheet (the lever flips a handful of CSS variables instead); the platform PNGs (three inline SVG marks).

**Motion left:** the lever's throw and the colour change it causes. With reduced motion, the colour changes without movement.

## Weight budget

Under 300 KB on first load (from 12.6 MB), under 30 requests (from 78), no video, no WebGL, no images in the first screen, two fonts (Switzer, JetBrains Mono). Measured before and after with the same method as the table above.

## Build list, in order

1. **The game page**: new files under `apps/web/src/marketing/game/`: hero and stat line, rulebook, your rank (projection, card, ladder), board and note, enter the game. One stylesheet; the two palettes are CSS variables on `.site`, flipped by `data-palette`. No framer-motion and no hyperkit on this page; the emblem is `RankEmblem`; rules and ranks are read from `@posterract/contract`.
2. **The lever**: same component and styles. Its spring (stiffness 260, damping 16, mass 0.7: about 10% overshoot, settled in 0.51 s) sampled into a CSS `linear()` easing, so the throw and the bounce stay the same without the animation library.
3. **One public endpoint in the API** returning only what the page shows: the board's top ten as position, rank, level and points (no names, except the founder's own row), the founder's card, the number of players. Cached, read-only, never an email. The api service is rebuilt with it.
4. **The app shell file**: the `AppShell` function in `routes/_app.tsx` moves to its own file and loads lazily, so a signed-out visitor downloads only the landing. The sign-in logic in `_app.tsx` is untouched. Signed-in users keep today's behaviour; their app starts downloading while the sign-in check runs.
5. **Work with me**: per decision 1.
6. **Page title and description**: *Posterract, the game for content*; the description names Instagram, Facebook and Threads only (today's still lists TikTok, YouTube and X).
7. **Verify**: typecheck and build; both themes; 375 px phone width; the lever by keyboard; reduced motion; the before/after weight table. Shown in the browser pane.
8. **On the founder's go**: the game page replaces the live one; web and api services only, per `AGENTS.md`; health checks; weight measured live.

## Decisions for the founder

1. **Work with me.** Keep it behind the lever as today (cyan; brief, tiles and form untouched; the WebGL background goes from it too, and its code loads only when the lever is thrown)? Or does the lever become only the colour switch on the game page, with Work with me gone from the landing?
2. ~~Other players' names in public~~ **Decided Sep 28: no.** Other players appear by rank only; only the founder is named.
